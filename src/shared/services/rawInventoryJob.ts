import {runInventoryWriterTransaction,captureInventoryWriterContext} from '../inventoryWriterProtocol';
/**
 * **RawInventoryJob — 여러 원료를 묶는 업무의 진행표.**
 *
 * 설계: [원료실제원장-로트-원자화-설계.md](../../../로컬전용/docs/원료실제원장-로트-원자화-설계.md) §8
 *
 * 왜 필요한가 — 주문 하나가 원료 세 종류를 쓰는데, 둘까지만 명령이 성공하고 세 번째에서
 * 네트워크가 끊기면 화면은 그 상태를 못 안다. 이 표가 "무엇을 시도했고 무엇이 남았나"를
 * 적어 둔다. 완료 여부는 표의 `status` 를 믿지 않고 `expectedOperationIds` 하나하나에
 * 이력이 있는지로 다시 셀 수 있다.
 *
 * 이 파일은 저장·재개만 맡는다. 개별 원료 이동은 [executeRawInventoryCommand](./rawInventoryService.ts) 가 한다.
 */
import { doc, getDoc, getDocFromServer, runTransaction, type Firestore } from 'firebase/firestore';
import { COL } from '../collections';
import { legacyOperationDocId, operationDocId, commandHash, type RawInventoryCommand, type RawInventoryJob, type RawApplyResult } from '../rawInventoryCore';
import { executeRawInventoryCommand, type RawCommandOptions } from './rawInventoryService';
import {protectInventoryWriterPatch} from '../inventoryWriterProtocol';
import { normalizeRawMovement } from './rawInventoryService';

export interface JobCommandInput {
  command: RawInventoryCommand;
  options?: RawCommandOptions;
}

export type JobCommandResult = { input: JobCommandInput; result: RawApplyResult };

export interface RunJobOptions {
  assertScope?:()=>Promise<void>;
  now?: string;
  db?: Firestore;
}

export interface RunJobOutcome {
  job: RawInventoryJob;
  results: JobCommandResult[];
}

/**
 * 업무 한 건을 원료별 명령으로 나눠 순서대로 실행한다.
 *
 * ① 시작 전에 `jobs/{jobId}` 를 `pending → processing` 으로 세운다(있으면 그대로 재개).
 * ② 명령을 하나씩 실행한다. `applied`·`duplicate` 는 진행, `conflict`·`rejected` 면 멈춘다.
 * ③ 전부 통과하면 `complete`, 도중에 실패면 `failed` 로 남긴다.
 *
 * 완료 판정은 표 상태가 아니라 **`expectedOperationIds` 의 이력이 실제로 있는지**로도
 * 다시 셀 수 있게, 시작 전에 원장 문서 존재 여부로 이미 성공한 명령은 건너뛴다.
 */
export async function runRawInventoryJob(input: {
  jobId: string;
  companyId: RawInventoryJob['companyId'];
  source: RawInventoryJob['source'];
  commands: JobCommandInput[];
  options?: RunJobOptions;
}): Promise<RunJobOutcome> {
  await input.options?.assertScope?.();
  const database = input.options?.db ?? (await import('../firebase')).db;
  const now = input.options?.now ?? new Date().toISOString();
  const jobRef = doc(database, COL.rawInventoryJobs, input.jobId);

  const expected = input.commands.map(c => c.command.operationId);
  if (new Set(expected).size !== expected.length) {
    throw new Error(`job 안에 같은 작업 번호가 두 번 있다: ${input.jobId}`);
  }
  const wrongCompany = input.commands.find(c => c.command.companyId !== input.companyId);
  if (wrongCompany) {
    throw new Error(`job 회사와 명령 회사가 다르다: ${input.jobId} / ${wrongCompany.command.operationId}`);
  }

  //  ① 진행표 준비. 같은 jobId 로 재실행하면 `processing` 이 그대로 이어진다.
  const initial: RawInventoryJob = await runInventoryWriterTransaction(database,await captureInventoryWriterContext(database,{requestIdentity:JSON.stringify({jobId:input.jobId,companyId:input.companyId,source:input.source,expected}),companyId:input.companyId,isStillCurrent:async()=>{await input.options?.assertScope?.();return true;}}), async tx => {
    await input.options?.assertScope?.();
    const snap = await tx.get(jobRef);
    await input.options?.assertScope?.();
    if (snap.exists()) {
      const cur = snap.data() as RawInventoryJob;
      const 같은계약 = cur.companyId === input.companyId
        && cur.source.type === input.source.type
        && cur.source.id === input.source.id
        && JSON.stringify(cur.expectedOperationIds) === JSON.stringify(expected);
      if (!같은계약) {
        throw new Error(`같은 job 번호로 다른 업무를 실행할 수 없다: ${input.jobId}`);
      }
      const merged: RawInventoryJob = { ...cur, status: 'processing' };
      tx.set(jobRef, protectInventoryWriterPatch(snap.data(),merged));
      return merged;
    }
    const fresh: RawInventoryJob = {
      id: input.jobId,
      companyId: input.companyId,
      source: input.source,
      expectedOperationIds: expected,
      status: 'processing',
      createdAt: now,
    };
    tx.set(jobRef, protectInventoryWriterPatch(undefined,fresh));
    return fresh;
  });

  const results: JobCommandResult[] = [];
  let job = initial;

  for (const item of input.commands) {
    // job의 시각과 DB가 한 업무 안에서 갈리면 재개 결과를 믿을 수 없다.
    await input.options?.assertScope?.();
    const opts = { ...item.options, now, db: database,assertScope:input.options?.assertScope??item.options?.assertScope };
    const r = await executeRawInventoryCommand(item.command, opts);
    await input.options?.assertScope?.();
    results.push({ input: item, result: r });
    if (r.status === 'conflict' || r.status === 'rejected') {
      const failedMsg = r.status === 'conflict'
        ? `같은 작업 번호로 다른 내용이 이미 저장돼 있다: ${item.command.operationId}`
        : `${r.code}: ${r.message}`;
      job = await markJobStatus(database, jobRef, { status: 'failed', lastError: failedMsg, completedAt: undefined },input.options?.assertScope);
      return { job, results };
    }
  }

  job = await markJobStatus(database, jobRef, { status: 'complete', completedAt: now, lastError: undefined },input.options?.assertScope);
  return { job, results };
}

/** 완료 여부를 표가 아니라 실제 이력으로 다시 센다 — 표가 낡았을 때 감사용. */
export async function verifyRawInventoryJobComplete(
  jobId: string, database?: Firestore,
): Promise<{ job: RawInventoryJob | null; missing: string[] }> {
  const resolvedDb = database ?? (await import('../firebase')).db;
  const jobSnap = await getDoc(doc(resolvedDb, COL.rawInventoryJobs, jobId));
  if (!jobSnap.exists()) return { job: null, missing: [] };
  const job = jobSnap.data() as RawInventoryJob;
  const misses: string[] = [];
  for (const opId of job.expectedOperationIds) {
    const newId = operationDocId(opId);
    const oldId = legacyOperationDocId(opId);
    const snap = await getDoc(doc(resolvedDb, COL.rawMaterialLedger, newId));
    const oldSnap = oldId === newId ? null : await getDoc(doc(resolvedDb, COL.rawMaterialLedger, oldId));
    if (!snap.exists() && !oldSnap?.exists()) misses.push(opId);
  }
  return { job, missing: misses };
}

export interface RawInventoryJobEvidence {
    status: 'verified' | 'partial' | 'absent' | 'conflict' | 'unknown';
    job: RawInventoryJob | null;
    verifiedOperationIds: string[];
    missingOperationIds: string[];
    unknownOperationIds: string[];
    conflictingOperationIds: string[];
    message: string;
}
/** 진행표가 없어도 최초 명령별 이력으로 증명한다. 존재만으로 완료를 발명하지 않는다. */
export async function inspectRawInventoryJobEvidence(input: {
    jobId: string;
    companyId: RawInventoryJob['companyId'];
    source: RawInventoryJob['source'];
    commands: readonly RawInventoryCommand[];
    db: Firestore;
    assertScope?: () => Promise<void>;
}): Promise<RawInventoryJobEvidence> {
    const evidence: RawInventoryJobEvidence = {
        status: 'unknown', job: null, verifiedOperationIds: [], missingOperationIds: [], unknownOperationIds: [], conflictingOperationIds: [], message: ''
    };
    const expected = input.commands.map(command => command.operationId);
    const read = async (collection: string, id: string) => {
        await input.assertScope?.();
        const snapshot = await getDocFromServer(doc(input.db, collection, id));
        await input.assertScope?.();
        if (snapshot.metadata?.fromCache !== false || snapshot.metadata?.hasPendingWrites !== false)
            throw new Error('서버에서 확정되지 않은 원료 조회 결과입니다. 동기화 뒤 다시 확인해 주세요.');
        return snapshot;
    };
    try {
        if (!expected.length || new Set(expected).size !== expected.length || input.commands.some(command => command.companyId !== input.companyId || command.source.type !== input.source.type || command.source.id !== input.source.id)) {
            evidence.status = 'conflict';
            evidence.message = '최초 원료 명령의 회사·업무·작업 번호가 서로 다릅니다.';
            return evidence;
        }
        const jobSnapshot = await read(COL.rawInventoryJobs, input.jobId);
        if (jobSnapshot.exists()) {
            const job = jobSnapshot.data() as RawInventoryJob;
            evidence.job = job;
            if (job.companyId !== input.companyId || job.source?.type !== input.source.type || job.source?.id !== input.source.id || !Array.isArray(job.expectedOperationIds) || new Set(job.expectedOperationIds).size !== job.expectedOperationIds.length || JSON.stringify([...job.expectedOperationIds].sort()) !== JSON.stringify([...expected].sort())) {
                evidence.status = 'conflict';
                evidence.message = '원료 진행표의 회사·업무·기대 작업 목록이 최초 요청과 다릅니다.';
                return evidence;
            }
        }
        for (const command of input.commands) {
            const modernId = operationDocId(command.operationId), legacyId = legacyOperationDocId(command.operationId);
            const modern = await read(COL.rawMaterialLedger, modernId);
            const legacy = legacyId === modernId ? null : await read(COL.rawMaterialLedger, legacyId);
            const rows = [modern, legacy].filter(snapshot => snapshot?.exists()).map(snapshot => normalizeRawMovement(snapshot!.data()!));
            if (!rows.length) {
                evidence.missingOperationIds.push(command.operationId);
                continue;
            }
            let conflict = false, unknown = false;
            for (const row of rows) {
                for (const field of ['operationId', 'companyId', 'rawItemId'] as const) {
                    if (typeof row[field] !== 'string' || !row[field])
                        unknown = true;
                    else if (row[field] !== command[field])
                        conflict = true;
                }
                if (!row.source || typeof row.source.type !== 'string' || typeof row.source.id !== 'string')
                    unknown = true;
                else if (row.source.type !== command.source.type || row.source.id !== command.source.id)
                    conflict = true;
                if (!row.commandHash)
                    unknown = true;
                else if (row.commandHash !== commandHash(command))
                    conflict = true;
            }
            if (conflict)
                evidence.conflictingOperationIds.push(command.operationId);
            else if (unknown)
                evidence.unknownOperationIds.push(command.operationId);
            else
                evidence.verifiedOperationIds.push(command.operationId);
        }
        evidence.status = evidence.conflictingOperationIds.length ? 'conflict' : evidence.unknownOperationIds.length ? 'unknown' : evidence.verifiedOperationIds.length === expected.length ? 'verified' : evidence.verifiedOperationIds.length ? 'partial' : 'absent';
        evidence.message = evidence.status === 'verified' ? '최초 원료 명령과 일치하는 모든 출고 이력을 확인했습니다.'
            : evidence.status === 'partial' ? '일부 원료 출고만 확인했습니다. 같은 작업 번호의 남은 처리를 확인해 주세요.'
                : evidence.status === 'absent' ? '최초 요청에 해당하는 원료 출고 이력을 찾지 못했습니다. 완료로 처리하지 않았습니다.'
                    : evidence.status === 'conflict' ? '원료 출고 이력과 최초 요청의 회사·품목·업무 또는 명령 내용이 다릅니다.'
                        : '원료 이력의 명령 근거가 부족해 완료 여부를 확인하지 못했습니다. 원문과 이력을 보존해 주세요.';
    }
    catch (error) {
        await input.assertScope?.();
        evidence.status = 'unknown';
        evidence.message = error instanceof Error ? error.message : '원료 출고 근거를 읽지 못했습니다.';
    }
    return evidence;
}

async function markJobStatus(
  db: Firestore, jobRef: ReturnType<typeof doc>,
  patch: Partial<RawInventoryJob>,
  assertScope?:()=>Promise<void>,
): Promise<RawInventoryJob> {
  return runInventoryWriterTransaction(db,await captureInventoryWriterContext(db,{requestIdentity:JSON.stringify({jobId:jobRef.id,patch}),isStillCurrent:async()=>{await assertScope?.();return true;}}), async tx => {
    await assertScope?.();
    const snap = await tx.get(jobRef);
    await assertScope?.();
    if (!snap.exists()) throw new Error(`job 이 사라졌다: ${jobRef.id}`);
    const cur = snap.data() as RawInventoryJob;
    const next: RawInventoryJob = { ...cur, ...patch };
    //  `undefined` 필드는 Firestore 가 거부하므로 명시적으로 뺀다.
    for (const k of Object.keys(next) as (keyof RawInventoryJob)[]) {
      if (next[k] === undefined) delete next[k];
    }
    tx.set(jobRef, protectInventoryWriterPatch(snap.data(),next));
    return next;
  });
}
