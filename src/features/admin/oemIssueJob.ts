import { doc, runTransaction, type Firestore } from 'firebase/firestore';
import { COL } from '../../shared/collections';
import type { RawInventoryCommand } from '../../shared/rawInventoryCore';
import { runRawInventoryJob, verifyRawInventoryJobComplete } from '../../shared/services/rawInventoryJob';
import { companyOf, type CompanyId, type PurchaseOrder } from '../../shared/types';

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
});

export const recoverableOemDrafts = (orders: readonly PurchaseOrder[], companyId: CompanyId): PurchaseOrder[] =>
  orders.filter(po => po.poType === 'oem' && po.status === 'pending' && companyOf(po) === companyId
    && (po.oemIssueStatus === 'processing' || po.oemIssueStatus === 'failed'));

export interface OemIssuePorts {
  prepareDraft: (input: OemIssueInput) => Promise<OemIssueDraft>;
  runRawSteps: (draft: OemIssueDraft) => Promise<void>;
  missingRawSteps: (draft: OemIssueDraft) => Promise<string[]>;
  finalizeDraft: (draft: OemIssueDraft) => Promise<void>;
  markFailed: (draft: OemIssueDraft, message: string) => Promise<void>;
}

/** 원료 job 완료와 발주 카드 확정은 별개다. 둘 다 끝나기 전에는 성공을 반환하지 않는다. */
export async function runOemIssueJob(input: OemIssueInput, ports: OemIssuePorts): Promise<{ poId: string }> {
  if (!input.jobId || !input.sent.length || new Set(input.sent.map(row => row.rawItemId)).size !== input.sent.length) {
    throw new Error('OEM 작업번호 또는 원료 목록이 잘못되었습니다. 같은 원료는 한 줄로 합쳐야 합니다.');
  }
  const draft = await ports.prepareDraft(input);
  if (draft.oemIssueStatus === 'complete' && draft.status === 'invoiced') {
    const missing = await ports.missingRawSteps(draft);
    if (missing.length > 0) throw new Error(`OEM 카드가 완료됐지만 원료 이력이 없습니다: ${missing.join(', ')}`);
    return { poId: draft.id };
  }
  try {
    await ports.runRawSteps(draft);
    const missing = await ports.missingRawSteps(draft);
    if (missing.length > 0) throw new Error(`OEM 원료 차감 이력이 아직 없습니다: ${missing.join(', ')}`);
    await ports.finalizeDraft(draft);
    return { poId: draft.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try { await ports.markFailed(draft, message); } catch { /* 원래 실패를 가리지 않는다. 초안은 남아 재개할 수 있다. */ }
    throw new Error(`OEM 외주 발주가 부분 완료됐을 수 있습니다. 새 발주를 만들지 말고 이 작업을 재개하세요 (${draft.id}): ${message}`);
  }
}

const jobIdOf = (poId: string) => `oem-issue:${poId}`;
const rawCommands = (draft: OemIssueDraft): RawInventoryCommand[] => draft.oemSent.map(row => ({
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

export function firestoreOemIssuePorts(db: Firestore): OemIssuePorts {
  return {
    prepareDraft: input => runTransaction(db, async tx => {
      const ref = doc(db, 'purchaseOrders', input.jobId);
      const snap = await tx.get(ref);
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
        itemId: '', itemName: '', quantity: 0, items: [], createdAt: now,
        ...(input.note ? { note: input.note } : {}),
      };
      // addItem(id)은 setDoc 덮어쓰기다. 여기는 반드시 '없을 때만 생성'한다.
      tx.set(ref, draft);
      return draft;
    }),
    runRawSteps: async draft => {
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
        options: { db },
      });
      if (result.job.status !== 'complete') throw new Error(result.job.lastError ?? 'OEM 원료 차감이 끝나지 않았습니다.');
    },
    missingRawSteps: async draft => (await verifyRawInventoryJobComplete(jobIdOf(draft.id), db)).missing,
    finalizeDraft: draft => runTransaction(db, async tx => {
      const ref = doc(db, 'purchaseOrders', draft.id);
      const snap = await tx.get(ref);
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
      const ref = doc(db, 'purchaseOrders', draft.id);
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      const current = snap.data() as OemIssueDraft;
      if (companyOf(current) !== draft.companyId || current.oemIssueFingerprint !== draft.oemIssueFingerprint) return;
      if (current.status === 'pending') tx.update(ref, { oemIssueStatus: 'failed', oemIssueError: message });
    }),
  };
}

export const issueOemBatchJob = (db: Firestore, input: OemIssueInput) => runOemIssueJob(input, firestoreOemIssuePorts(db));
