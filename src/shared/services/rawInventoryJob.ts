/**
 * **RawInventoryJob — 여러 원료를 묶는 업무의 진행표.**
 *
 * 설계: [원료실제원장-로트-원자화-설계.md](../../../docs/원료실제원장-로트-원자화-설계.md) §8
 *
 * 왜 필요한가 — 주문 하나가 원료 세 종류를 쓰는데, 둘까지만 명령이 성공하고 세 번째에서
 * 네트워크가 끊기면 화면은 그 상태를 못 안다. 이 표가 "무엇을 시도했고 무엇이 남았나"를
 * 적어 둔다. 완료 여부는 표의 `status` 를 믿지 않고 `expectedOperationIds` 하나하나에
 * 이력이 있는지로 다시 셀 수 있다.
 *
 * 이 파일은 저장·재개만 맡는다. 개별 원료 이동은 [executeRawInventoryCommand](./rawInventoryService.ts) 가 한다.
 */
import { doc, getDoc, runTransaction, type Firestore } from 'firebase/firestore';
import { COL } from '../collections';
import { legacyOperationDocId, operationDocId, type RawInventoryCommand, type RawInventoryJob, type RawApplyResult } from '../rawInventoryCore';
import { executeRawInventoryCommand, type RawCommandOptions } from './rawInventoryService';

export interface JobCommandInput {
  command: RawInventoryCommand;
  options?: RawCommandOptions;
}

export type JobCommandResult = { input: JobCommandInput; result: RawApplyResult };

export interface RunJobOptions {
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
  const initial: RawInventoryJob = await runTransaction(database, async tx => {
    const snap = await tx.get(jobRef);
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
      tx.set(jobRef, merged);
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
    tx.set(jobRef, fresh);
    return fresh;
  });

  const results: JobCommandResult[] = [];
  let job = initial;

  for (const item of input.commands) {
    // job의 시각과 DB가 한 업무 안에서 갈리면 재개 결과를 믿을 수 없다.
    const opts = { ...item.options, now, db: database };
    const r = await executeRawInventoryCommand(item.command, opts);
    results.push({ input: item, result: r });
    if (r.status === 'conflict' || r.status === 'rejected') {
      const failedMsg = r.status === 'conflict'
        ? `같은 작업 번호로 다른 내용이 이미 저장돼 있다: ${item.command.operationId}`
        : `${r.code}: ${r.message}`;
      job = await markJobStatus(database, jobRef, { status: 'failed', lastError: failedMsg, completedAt: undefined });
      return { job, results };
    }
  }

  job = await markJobStatus(database, jobRef, { status: 'complete', completedAt: now, lastError: undefined });
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

async function markJobStatus(
  db: Firestore, jobRef: ReturnType<typeof doc>,
  patch: Partial<RawInventoryJob>,
): Promise<RawInventoryJob> {
  return runTransaction(db, async tx => {
    const snap = await tx.get(jobRef);
    if (!snap.exists()) throw new Error(`job 이 사라졌다: ${jobRef.id}`);
    const cur = snap.data() as RawInventoryJob;
    const next: RawInventoryJob = { ...cur, ...patch };
    //  `undefined` 필드는 Firestore 가 거부하므로 명시적으로 뺀다.
    for (const k of Object.keys(next) as (keyof RawInventoryJob)[]) {
      if (next[k] === undefined) delete next[k];
    }
    tx.set(jobRef, next);
    return next;
  });
}
