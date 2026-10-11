import { doc, runTransaction, type Firestore } from 'firebase/firestore';
import { COL } from '../collections';
import { commandHash, operationDocId, type RawInventoryJob } from '../rawInventoryCore';
import { normalizeRawMovement, prepareRawCommand, readRawCommandInTransaction, writePreparedRawCommand } from './rawInventoryService';
import { clearRawPressAttempt, rawPressText, saveRawPressAttempt, validateRawPressRequest, type RawPressRequest } from '../rawPressAttempt';
import { auth, authReady, db } from '../firebase';
import { withClaimCompany } from '../companyWriteBoundary';
import { companyOf } from '../types';

export type RawPressOutcome = { status: 'applied' | 'duplicate'; sourceAppliedKg: number; derivedAppliedKg: number }
  | { status: 'blocked'; sourceAppliedKg: 0; reason: string; retainPending: boolean };
type RawPressJob = RawInventoryJob & { actorUid: string; rawPressEvidence: RawPressRequest;
  sourceAppliedKg: number; derivedAppliedKg: number; derivedDisposition: 'received' | 'source-unapplied' | 'yield-zero' };
const prune = <T>(v: T): T => JSON.parse(JSON.stringify(v));
/** 둘의 이력과 완료 근거를 함께 저장한다. 기존 순차 job을 복구 완료로 추정하지 않는다. */
export async function executeRawPressWithDb(database: Firestore, request: RawPressRequest, assertScope?: () => Promise<void>): Promise<RawPressOutcome> {
  validateRawPressRequest(request);
  const source = request.sourceCommand, derived = request.derivedCommand;
  const jobRef = doc(database, COL.rawInventoryJobs, `raw-press-${operationDocId(source.operationId)}`);
  return runTransaction(database, async tx => {
    await assertScope?.();
    const [jobSnap, sourceRead, derivedRead] = await Promise.all([
      tx.get(jobRef), readRawCommandInTransaction(tx, database, source), readRawCommandInTransaction(tx, database, derived),
    ]);
    const blocked = (reason: string, retainPending = true): RawPressOutcome => ({ status: 'blocked', sourceAppliedKg: 0, reason, retainPending });
    const exists = (read: typeof sourceRead) => read.movementSnap.exists() || !!read.oldMovementSnap?.exists();
    if ((sourceRead.movementSnap.exists() && sourceRead.oldMovementSnap?.exists())
      || (derivedRead.movementSnap.exists() && derivedRead.oldMovementSnap?.exists())) return blocked('신·구 작업 이력이 동시에 있어 자동 처리하지 않았습니다.');
    const movement = (read: typeof sourceRead) => normalizeRawMovement((read.movementSnap.exists() ? read.movementSnap : read.oldMovementSnap)!.data()!);
    const receiptMatches = (read: typeof sourceRead, command: typeof source | typeof derived, applied: number): boolean => {
      if (!exists(read)) return false;
      const receipt = movement(read), reported = Math.round(command.kg * 1000) / 1000 * (command.kind === 'consume-lot' ? -1 : 1);
      return receipt.companyId === command.companyId && receipt.rawItemId === command.rawItemId
        && receipt.operationId === command.operationId && receipt.kind === command.kind
        && receipt.effectiveAt === command.effectiveAt
        && receipt.source?.type === command.source.type && receipt.source.id === command.source.id
        && receipt.commandHash === commandHash(command) && receipt.reportedDeltaKg === reported
        && Number.isFinite(receipt.appliedDeltaKg) && Number.isFinite(applied)
        && receipt.appliedDeltaKg === applied && (applied === 0 || applied === reported);
    };
    if (jobSnap.exists()) {
      const job = jobSnap.data() as RawPressJob;
      if (job.companyId !== request.companyId || job.actorUid !== request.actorUid || job.status !== 'complete'
        || job.id !== jobRef.id || job.source?.type !== 'production' || job.source.id !== request.entry.id
        || job.createdAt !== request.entry.createdAt || job.completedAt !== request.entry.createdAt
        || rawPressText(job.expectedOperationIds) !== rawPressText(job.derivedDisposition === 'received' ? [source.operationId, derived.operationId] : [source.operationId])
        || rawPressText(job.rawPressEvidence) !== rawPressText(request) || !exists(sourceRead)) return blocked('압착 완료 근거가 최초 원문과 일치하지 않습니다.');
      const sr = prepareRawCommand(source, sourceRead);
      if (sr.status !== 'duplicate' || !receiptMatches(sourceRead, source, job.sourceAppliedKg)) return blocked('원료 사용 완료 근거를 확인해 주세요.');
      const expectedDisposition = sr.movement.appliedDeltaKg === 0 ? 'source-unapplied' : derived.kg === 0 ? 'yield-zero' : 'received';
      if (job.derivedDisposition !== expectedDisposition) return blocked('원료 적용량과 파생 입고 근거가 일치하지 않습니다.');
      if (job.derivedDisposition === 'received') {
        const dr = prepareRawCommand(derived, derivedRead);
        if (dr.status !== 'duplicate' || !receiptMatches(derivedRead, derived, job.derivedAppliedKg)) return blocked('파생 입고 완료 근거를 확인해 주세요.');
      } else if (exists(derivedRead) || job.derivedAppliedKg !== 0
        || (job.derivedDisposition === 'source-unapplied' ? job.sourceAppliedKg !== 0 : job.derivedDisposition !== 'yield-zero' || derived.kg !== 0)) return blocked('압착 미적용 근거를 확인해 주세요.');
      return { status: 'duplicate', sourceAppliedKg: job.sourceAppliedKg, derivedAppliedKg: job.derivedAppliedKg };
    }
    if (exists(sourceRead) || exists(derivedRead)) return blocked('기존 부분 처리 이력이 있습니다. 자동으로 압착을 보완하지 않았습니다.');
    const sr = prepareRawCommand(source, sourceRead, { now: request.entry.createdAt });
    if (sr.status !== 'applied') return blocked(sr.status === 'rejected' ? sr.message : '원료 사용 요청을 확인해 주세요.', false);
    if (!derivedRead.itemSnap.exists() || companyOf(derivedRead.itemSnap.data()) !== request.companyId) return blocked('파생 입고 품목 회사를 확인해 주세요.', false);
    const disposition = sr.movement.appliedDeltaKg === 0 ? 'source-unapplied' : derived.kg === 0 ? 'yield-zero' : 'received';
    const dr = disposition === 'received' ? prepareRawCommand(derived, derivedRead, { now: request.entry.createdAt, newLotId: `lot-yield-${request.entry.id}` }) : null;
    if (dr && dr.status !== 'applied') return blocked(dr.status === 'rejected' ? dr.message : '파생 입고 요청을 확인해 주세요.', false);
    const sourceAppliedKg = sr.movement.appliedDeltaKg, derivedAppliedKg = dr?.status === 'applied' ? dr.movement.appliedDeltaKg : 0;
    await assertScope?.();
    writePreparedRawCommand(tx, source, sourceRead, sr, { legacy: request.sourceLegacy });
    if (dr?.status === 'applied') writePreparedRawCommand(tx, derived, derivedRead, dr, { legacy: request.derivedLegacy });
    const job: RawPressJob = { id: jobRef.id, companyId: request.companyId, actorUid: request.actorUid,
      // job은 압착 생산 업무이고, 두 수불의 source는 사용자 수동 기록 원문 그대로다.
      source: { type: 'production', id: request.entry.id }, expectedOperationIds: disposition === 'received' ? [source.operationId, derived.operationId] : [source.operationId],
      status: 'complete', createdAt: request.entry.createdAt, completedAt: request.entry.createdAt,
      rawPressEvidence: request, sourceAppliedKg, derivedAppliedKg, derivedDisposition: disposition };
    tx.set(jobRef, prune(job));
    return { status: 'applied', sourceAppliedKg, derivedAppliedKg };
  });
}
export async function executeRawPress(request: RawPressRequest): Promise<RawPressOutcome> {
  await authReady;
  const uid = auth.currentUser?.uid;
  if (!uid || uid !== request.actorUid) throw Error('압착 요청 로그인 계정을 확인해 주세요.');
  const assertScope = async () => {
    if (auth.currentUser?.uid !== uid) throw Error('로그인 계정이 바뀌어 압착 완료 여부를 확인해야 합니다.');
    const token = await auth.currentUser.getIdTokenResult();
    withClaimCompany(COL.rawInventoryJobs, { companyId: request.companyId }, { companyId: token.claims.companyId });
    if (auth.currentUser?.uid !== uid) throw Error('로그인 계정이 바뀌어 압착 완료 여부를 확인해야 합니다.');
  };
  await assertScope();
  const pending = saveRawPressAttempt(request);
  const outcome = await executeRawPressWithDb(db, request, assertScope);
  await assertScope();
  if ((outcome.status !== 'blocked' || !outcome.retainPending) && auth.currentUser?.uid === uid) clearRawPressAttempt(request.companyId, uid, pending.encoded);
  return outcome;
}
