import { validateAndMergeOemCostEvidence, type OemCostEvidence } from './oemCostEvidence';
import { doc, getDocFromServer, runTransaction, type Firestore } from 'firebase/firestore';
import { COL } from '../../shared/collections';
import type { RawInventoryCommand } from '../../shared/rawInventoryCore';
import { runRawInventoryJob, inspectRawInventoryJobEvidence, type RawInventoryJobEvidence } from '../../shared/services/rawInventoryJob';
import { companyOf, type CompanyId, type PurchaseOrder } from '../../shared/types';
import {assertOemIssueAttempt,acknowledgeOemIssueAttempt,clearOemIssueAttempt,markOemIssueFailure,type OemIssueRetained} from '../../shared/oemIssuePending';

export type OemIssueLine = { material: string; rawItemId: string; kg: number };
export interface OemIssueInput {
  jobId: string;
  companyId: CompanyId;
  partnerId: string;
  partnerName: string;
  sent: OemIssueLine[];
  date: string;
  note?: string;
  addedBy?: string;
  oemCostEvidence?: OemCostEvidence;
}

export type OemIssueDraft = PurchaseOrder & {
  oemIssueStatus: 'processing' | 'failed' | 'complete';
  oemIssueFingerprint: string;
  oemIssueDate: string;
  oemIssuedBy?: string;
  oemSent: OemIssueLine[];
};

export const oemIssueFingerprint = (input: OemIssueInput): string => JSON.stringify({
  companyId: input.companyId,
  partnerId: input.partnerId,
  sent: input.sent,
  date: input.date,
  note: input.note ?? '',
  ...(input.oemCostEvidence ? {oemCostEvidence:input.oemCostEvidence} : {}),
});

export const recoverableOemDrafts = (orders: readonly PurchaseOrder[], companyId: CompanyId): PurchaseOrder[] =>
  orders.filter(po => po.poType === 'oem' && po.status === 'pending' && companyOf(po) === companyId
    && (po.oemIssueStatus === 'processing' || po.oemIssueStatus === 'failed'));

export interface OemIssuePorts {
  prepareDraft: (input: OemIssueInput) => Promise<OemIssueDraft>;
  runRawSteps: (draft: OemIssueDraft) => Promise<void>;
  inspectEvidence: (input: OemIssueInput) => Promise<OemIssueInspection>;
  finalizeDraft: (draft: OemIssueDraft) => Promise<void>;
  markFailed: (draft: OemIssueDraft, message: string) => Promise<void>;
}

/** 원료 job 완료와 발주 카드 확정은 별개다. 둘 다 끝나기 전에는 성공을 반환하지 않는다. */
export async function runOemIssueJob(input: OemIssueInput, ports: OemIssuePorts, assertScope?:()=>Promise<void>): Promise<{ poId: string }> {
  input=JSON.parse(JSON.stringify(input));await assertScope?.();
  if (!input.jobId || !input.sent.length || new Set(input.sent.map(row => row.rawItemId)).size !== input.sent.length) {
    throw new Error('OEM 작업번호 또는 원료 목록이 잘못되었습니다. 같은 원료는 한 줄로 합쳐야 합니다.');
  }
  if(input.oemCostEvidence) input={...input,oemCostEvidence:validateAndMergeOemCostEvidence(input.oemCostEvidence,input.companyId,input.sent)};
  const before = await ports.inspectEvidence(input);
  await assertScope?.();
  if (!before.canResume) throw new Error(before.message + ' ' + before.nextAction);
  const draft = await ports.prepareDraft(input);
  await assertScope?.();
  // 첫 조회 뒤 다른 창이 카드를 완료했어도 근거 없는 원료 재실행을 허용하지 않는다.
  if (draft.status === 'invoiced' && draft.oemIssueStatus === 'complete') {
    const prepared = await ports.inspectEvidence(input);
    await assertScope?.();
    if (prepared.status !== 'verified') throw new Error(prepared.message + ' ' + prepared.nextAction);
  }
  try {
    await ports.runRawSteps(draft);
    await assertScope?.();
    const evidence = await ports.inspectEvidence(input);
    await assertScope?.();
    if (evidence.status !== 'verified') throw new Error(evidence.message + ' ' + evidence.nextAction);
    await ports.finalizeDraft(draft);
    await assertScope?.();
    return { poId: draft.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try { await assertScope?.();await ports.markFailed(draft, message); } catch { /* 원래 실패를 가리지 않는다. 초안은 남아 재개할 수 있다. */ }
    throw new Error(`OEM 외주 발주가 부분 완료됐을 수 있습니다. 새 발주를 만들지 말고 이 작업을 재개하세요 (${draft.id}): ${message}`);
  }
}

const jobIdOf = (poId: string) => `oem-issue:${poId}`;
const rawCommands = (draft: Pick<OemIssueDraft, 'id' | 'companyId' | 'oemSent' | 'oemIssueDate' | 'oemIssuedBy'>): RawInventoryCommand[] => draft.oemSent.map(row => ({
  operationId: `${jobIdOf(draft.id)}:${row.rawItemId}`,
  companyId: draft.companyId!,
  rawItemId: row.rawItemId ?? (() => { throw new Error('OEM 원료 품목 ID가 없는 초안입니다.'); })(),
  materialSnapshot: row.material,
  effectiveAt: `${draft.oemIssueDate}T12:00:00+09:00`,
  ...(draft.oemIssuedBy ? { actorName: draft.oemIssuedBy } : {}),
  source: { type: 'oem' as const, id: draft.id },
  kind: 'consume' as const,
  kg: row.kg,
}));

export interface OemIssueInspection {
    status: RawInventoryJobEvidence['status'];
    poId: string;
    cardStatus: 'missing' | 'pending' | 'complete' | 'unknown';
    verifiedOperationIds: string[];
    missingOperationIds: string[];
    unknownOperationIds: string[];
    conflictingOperationIds: string[];
    message: string;
    nextAction: string;
    canResume: boolean;
}
async function readOemIssueEvidence(db: Firestore, input: OemIssueInput, assertScope?: () => Promise<void>): Promise<OemIssueInspection> {
    const empty: OemIssueInspection = {
        status: 'unknown', poId: input.jobId, cardStatus: 'unknown', verifiedOperationIds: [], missingOperationIds: [], unknownOperationIds: [], conflictingOperationIds: [], message: '', nextAction: '최초 원문을 보존하고 같은 요청의 결과를 다시 확인해 주세요.', canResume: false
    };
    try {
        await assertScope?.();
        const snapshot = await getDocFromServer(doc(db, 'purchaseOrders', input.jobId));
        await assertScope?.();
        if (snapshot.metadata?.fromCache !== false || snapshot.metadata?.hasPendingWrites !== false)
            throw new Error('서버에서 확정되지 않은 OEM 카드 조회 결과입니다. 동기화 뒤 다시 확인해 주세요.');
        empty.cardStatus = 'missing';
        if (snapshot.exists()) {
            const row = snapshot.data();
            empty.cardStatus = row.status === 'invoiced' && row.oemIssueStatus === 'complete' ? 'complete' : 'pending';
            if (row.companyId !== input.companyId || row.poType !== 'oem' || row.oemIssueFingerprint !== oemIssueFingerprint(input) || row.oemCancelledAt || row.oemCancelOperationId || !(row.status === 'pending' || empty.cardStatus === 'complete')) {
                return {
                    ...empty, status: 'conflict', message: 'OEM 카드의 회사·최초 원문·상태가 선택한 출고 요청과 다릅니다.'
                };
            }
        }
        const commands = rawCommands({
            id: input.jobId, companyId: input.companyId, oemSent: input.sent, oemIssueDate: input.date, oemIssuedBy: input.addedBy
        });
        const evidence = await inspectRawInventoryJobEvidence({
            jobId: jobIdOf(input.jobId), companyId: input.companyId, source: {
                type: 'oem', id: input.jobId
            }, commands, db, assertScope
        });
        await assertScope?.();
        const { job: _job, ...result } = evidence;
        const canResume = evidence.status === 'verified' || empty.cardStatus !== 'complete' && (evidence.status === 'partial' || evidence.status === 'absent');
        return {
            ...empty, ...result, canResume, nextAction: canResume ? '같은 작업 번호로 남은 처리 재개를 선택해 주세요. 확인된 원료는 다시 차감하지 않습니다.' : empty.cardStatus === 'complete' ? '완료 카드의 원료 근거가 부족합니다. 새로 출고하지 말고 최초 요청과 원료 이력을 확인해 주세요.' : '회사·품목·명령 근거를 확인한 뒤 같은 요청의 결과를 다시 조회해 주세요. 자동으로 다시 출고하지 않습니다.'
        };
    }
    catch (error) {
        await assertScope?.();
        return {
            ...empty, message: error instanceof Error ? error.message : 'OEM 출고의 실제 근거를 읽지 못했습니다.'
        };
    }
}

export function firestoreOemIssuePorts(db: Firestore,assertScope?:()=>Promise<void>): OemIssuePorts {
  return {
    prepareDraft: input => runTransaction(db, async tx => {
      await assertScope?.();
      const ref = doc(db, 'purchaseOrders', input.jobId);
      const snap = await tx.get(ref);
      await assertScope?.();
      const fingerprint = oemIssueFingerprint(input);
      if (snap.exists()) {
        const previous = { id: snap.id, ...snap.data() } as OemIssueDraft;
        if (previous.oemCancelledAt || previous.oemCancelOperationId) throw new Error('취소된 OEM 발주는 재개할 수 없습니다.');
        if (companyOf(previous) !== input.companyId || previous.poType !== 'oem' || previous.oemIssueFingerprint !== fingerprint) {
          throw new Error('같은 OEM 작업번호의 회사나 내용이 다릅니다.');
        }
        return previous;
      }
      const now = new Date().toISOString();
      const draft: OemIssueDraft = {
        id: input.jobId, companyId: input.companyId,
        poType: 'oem', status: 'pending', oemIssueStatus: 'processing',
        oemIssueFingerprint: fingerprint, oemIssueDate: input.date,
        ...(input.addedBy ? { oemIssuedBy: input.addedBy } : {}),
        partnerId: input.partnerId, partnerName: input.partnerName, oemPartnerId: input.partnerId,
        oemSent: input.sent,
        ...(input.oemCostEvidence ? {oemCostEvidence:input.oemCostEvidence} : {}),
        itemId: '', itemName: '', quantity: 0, items: [], createdAt: now,
        ...(input.note ? { note: input.note } : {}),
      };
      // addItem(id)은 setDoc 덮어쓰기다. 여기는 반드시 '없을 때만 생성'한다.
      tx.set(ref, draft);
      return draft;
    }),
    runRawSteps: async draft => {
      await assertScope?.();
      const commands = rawCommands(draft);
      const result = await runRawInventoryJob({
        jobId: jobIdOf(draft.id), companyId: draft.companyId!, source: { type: 'oem', id: draft.id },
        commands: commands.map(command => ({
          command,
          options: {
            carryOverLotId: `carry-${command.operationId}`,
            legacy: { note: `OEM 외주출고 → ${draft.partnerName}`, type: 'auto' },
          },
        })),
        options: { db,assertScope },
      });
      if (result.job.status !== 'complete') throw new Error(result.job.lastError ?? 'OEM 원료 차감이 끝나지 않았습니다.');
    },
    inspectEvidence: input => readOemIssueEvidence(db, input, assertScope),
    finalizeDraft: draft => runTransaction(db, async tx => {
      await assertScope?.();
      const ref = doc(db, 'purchaseOrders', draft.id);
      const snap = await tx.get(ref);
      await assertScope?.();
      if (!snap.exists()) throw new Error('OEM 발주 초안이 사라졌습니다.');
      const current = snap.data() as OemIssueDraft;
      if (current.oemCancelledAt || current.oemCancelOperationId) throw new Error('취소된 OEM 발주는 확정할 수 없습니다.');
      if (companyOf(current) !== draft.companyId || current.oemIssueFingerprint !== draft.oemIssueFingerprint) {
        throw new Error('OEM 발주 초안의 회사나 내용이 바뀌었습니다.');
      }
      if (current.status === 'invoiced' && current.oemIssueStatus === 'complete') return;
      if (current.status !== 'pending') throw new Error('OEM 발주 초안 상태가 바뀌었습니다.');
      tx.update(ref, { status: 'invoiced', oemIssueStatus: 'complete', oemSentAt: new Date().toISOString() });
    }),
    markFailed: (draft, message) => runTransaction(db, async tx => {
      await assertScope?.();
      const ref = doc(db, 'purchaseOrders', draft.id);
      const snap = await tx.get(ref);
      await assertScope?.();
      if (!snap.exists()) return;
      const current = snap.data() as OemIssueDraft;
      if (companyOf(current) !== draft.companyId || current.oemIssueFingerprint !== draft.oemIssueFingerprint) return;
      if (current.status === 'pending') tx.update(ref, { oemIssueStatus: 'failed', oemIssueError: message });
    }),
  };
}

export interface OemIssueContext {
    actorUid: string;
    isCurrent: () => boolean;
    retained: OemIssueRetained;
}
async function issueContext(input: OemIssueInput, context: OemIssueContext) {
    const retained = JSON.parse(JSON.stringify(context.retained)) as OemIssueRetained;
    const actorUid = context.actorUid, companyId = retained.request.companyId, isCurrent = context.isCurrent;
    if (retained.request.actorUid !== actorUid || retained.request.companyId !== input.companyId
        || JSON.stringify(retained.request.input) !== JSON.stringify(input))
        throw Error('선택한 OEM 최초 송출 원문이나 계정이 다릅니다.');
    const { auth, authReady } = await import('../../shared/firebase');
    await authReady;
    const current = () => isCurrent() && auth.currentUser?.uid === actorUid;
    const check = async () => {
        if (!current())
            throw Error('OEM 송출 로그인 계정이 변경되었습니다.');
        assertOemIssueAttempt(retained);
        const token = await auth.currentUser!.getIdTokenResult();
        if (!current() || token.claims.companyId !== companyId)
            throw Error('OEM 송출 회사나 계정이 변경되었습니다.');
        assertOemIssueAttempt(retained);
    };
    await check();
    return {
        retained, current, check
    };
}
/** 원문·계정 검증 후 읽기만 한다. 조회는 업무 ACK나 기기 사본 정리가 아니다. */
export async function inspectOemIssueJob(db: Firestore, input: OemIssueInput, context: OemIssueContext): Promise<OemIssueInspection> {
    const { retained, check } = await issueContext(input, context);
    const result = await readOemIssueEvidence(db, retained.request.input, check);
    await check();
    return result;
}
export async function issueOemBatchJob(db: Firestore, input: OemIssueInput, context?: OemIssueContext) {
    if (!context)
        return runOemIssueJob(input, firestoreOemIssuePorts(db));
    const { retained, current, check } = await issueContext(input, context);
    try {
        const result = await runOemIssueJob(retained.request.input, firestoreOemIssuePorts(db, check), check);
        await check();
        acknowledgeOemIssueAttempt(retained);
        await clearOemIssueAttempt(retained, current);
        return result;
    }
    catch (error) {
        try {
            await check();
            await markOemIssueFailure(retained, error instanceof Error ? error.message : String(error), false, current);
        }
        catch { /* 계정이나 원문이 바뀌면 실패 표식도 덮어쓰지 않는다. */ }
        throw error;
    }
}
