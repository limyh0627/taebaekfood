import { beforeEach, expect, it } from 'vitest';
import { financialOpeningTestStore } from '../test/financialOpeningTestStore';
import { cashOriginalHash } from './cashMutationReceipt';
import { cancelPendingReturn, type PendingReturnCancellationInput } from './cancelPendingReturnCommand';
import { updatePendingReturnQuantity } from './updatePendingReturnQuantityCommand';
const state = { rows: new Map<string, Record<string, any>>(), writes: [] as Array<{path: string; patch: Record<string, unknown>}>, afterQuery: null };
const db = financialOpeningTestStore(state);
const actor = { uid: 'admin-uid', token: { companyId: 'taebaek', isAdmin: true, employeeId: 'admin-employee' } };
const body = () => ({ companyId: 'taebaek', partnerId: 'partner', status: 'pending', returnType: '매출', totalAmount: 100,
  items: [{itemId: 'item', quantity: 2, supply: 100, tax: 0, accountCode: '404'}] });
const command = (): PendingReturnCancellationInput => ({ companyId: 'taebaek', requestId: 'request', operationId: 'cancel-request', expectedRequest: state.rows.get('returnRequests/request')! });
beforeEach(() => {
  state.rows.clear(); state.writes = [];
  const request = body(), requestHash = cashOriginalHash(request);
  state.rows.set('returnRequests/request', { ...request, submissionReceipt: {version: 1, actorId: 'creator', requestId: 'request', requestHash, request} });
  state.rows.set('returnSubmissionOperations/request', {companyId: 'taebaek', actorId: 'creator', requestId: 'request', requestHash, request, status: 'accepted'});
});
it('취소는 원접수·금액·수량을 보존하며 동일 작업 재시도는 쓰기0이다', async () => {
  const input = command(), audit = state.rows.get('returnSubmissionOperations/request');
  expect(await cancelPendingReturn(db, actor, input)).toMatchObject({status: 'cancelled'});
  expect(state.writes).toHaveLength(1); expect(state.writes[0].path).toBe('returnRequests/request');
  expect(state.rows.get('returnRequests/request')).toMatchObject({...input.expectedRequest, cancelledBy: actor.uid});
  expect(state.rows.get('returnSubmissionOperations/request')).toEqual(audit);
  state.writes = []; expect(await cancelPendingReturn(db, actor, input)).toMatchObject({status: 'duplicate'}); expect(state.writes).toEqual([]);
});
it('권한·회사·다른 작업·원문 충돌을 거절한다', async () => {
  const input = command();
  for (const invalid of [undefined, {...actor, token: {...actor.token, isAdmin: false}}, {...actor, token: {...actor.token, companyId: 'punghoe'}}]) {
    await expect(cancelPendingReturn(db, invalid, input)).rejects.toThrow('관리자');
  }
  await cancelPendingReturn(db, actor, input); state.writes = [];
  const other=await cancelPendingReturn(db,actor,{...input,operationId:'other'}).catch(error=>error);expect(other.details.cancellationRejected).toMatchObject({terminalConfirmed:true});state.writes=[];
  await expect(cancelPendingReturn(db, {...actor, uid: 'other'}, input)).rejects.toThrow('다릅니다');
  expect(state.writes).toEqual([]);
});
it('legacy 또는 한쪽 접수증명·변조는 추정하지 않는다', async () => {
  const original = state.rows.get('returnRequests/request')!;
  for (const kind of ['legacy', 'missing-audit', 'tampered']) {
    state.rows.set('returnRequests/request', {...original});
    if (kind === 'legacy') { state.rows.set('returnRequests/request', body()); state.rows.delete('returnSubmissionOperations/request'); }
    if (kind === 'missing-audit') state.rows.delete('returnSubmissionOperations/request');
    if (kind === 'tampered') state.rows.set('returnSubmissionOperations/request', {status: 'accepted', request: {different: true}});
    await expect(cancelPendingReturn(db, actor, command())).rejects.toThrow('증명');
  }
  expect(state.writes).toEqual([]);
});
it('수량 변경 뒤 오래된 초안과 처리 완료·부분 처리 증거를 거절한다', async () => {
  const input = command(), original = state.rows.get('returnRequests/request')!;
  state.rows.set('returnRequests/request', {...original, totalAmount: 150, quantityRevision: 1});
  await expect(cancelPendingReturn(db, actor, input)).rejects.toThrow('변경');
  for (const patch of [{status: 'processed'}, {returnJournalId: 'journal'}, {processedAt: '2026-10-09'}]) {
    state.rows.set('returnRequests/request', {...original, ...patch});
    await expect(cancelPendingReturn(db, actor, command())).rejects.toThrow('대기');
  }
  expect(state.writes.every(row => Object.keys(row.patch).join() === 'cancellationOperations')).toBe(true);
});
it('canonical 처리·배분 감사가 있으면 대기 상태만 믿고 취소하지 않는다', async () => {
  state.rows.set('returnOperations/processing', {companyId: 'taebaek', returnRequestId: 'request', status: 'applied'});
  await expect(cancelPendingReturn(db, actor, command())).rejects.toThrow('처리 기록');
  state.rows.delete('returnOperations/processing'); const {cancellationOperations: _ops,...clean}=state.rows.get('returnRequests/request')!; state.rows.set('returnRequests/request',clean); state.rows.set('returnApplications/app', {companyId: 'taebaek', returnRequestId: 'request'});
  await expect(cancelPendingReturn(db, actor, command())).rejects.toThrow('처리 기록'); expect(state.writes.every(row => Object.keys(row.patch).join() === 'cancellationOperations')).toBe(true);
});
it('확정된 처리 거절은 취소를 막지 않지만 거절 증명 변조는 거절한다', async () => {
  const processCommand = {operationId: 'rejected', returnRequestId: 'request', tradeDate: '2026-10-09', expectedPartnerRevision: 0, releaseId: 'release'};
  const rejected = {companyId: 'taebaek', returnRequestId: 'request', operationId: 'rejected', status: 'rejected', command: processCommand,
    requestHash: cashOriginalHash(processCommand), createdBy: 'creator', failureCode: 'failed-precondition', failureMessage: '사전 거절'};
  state.rows.set('returnOperations/rejected', {...rejected, requestHash: 'wrong'});
  await expect(cancelPendingReturn(db, actor, command())).rejects.toThrow('처리 기록');
  const old=state.rows.get('returnRequests/request')!; const {cancellationOperations: _ops,...clean}=old; state.rows.set('returnRequests/request',clean);
  state.rows.set('returnOperations/rejected', rejected);
  expect(await cancelPendingReturn(db, actor, command())).toMatchObject({status: 'cancelled'});
});
it('취소 후 새 수량 작업은 거절하고 취소 원문을 보존한다', async () => {
  const cancelInput=command();await cancelPendingReturn(db, actor, cancelInput); const before = state.rows.get('returnRequests/request'); state.writes = [];
  await expect(updatePendingReturnQuantity(db, actor, {companyId: 'taebaek', requestId: 'request', operationId: 'quantity', updates: [{itemId: 'item', previousQuantity: 2, quantity: 3}]})).rejects.toThrow('취소');
  expect(state.rows.get('returnRequests/request')).toMatchObject(before!); expect(state.writes).toHaveLength(1);
  const saved=state.rows.get('returnRequests/request')!; expect(saved.quantityOperations.quantity.status).toBe('rejected');
  state.writes=[]; const error=await updatePendingReturnQuantity(db,actor,{companyId:'taebaek',requestId:'request',operationId:'quantity',updates:[{itemId:'item',previousQuantity:2,quantity:3}]}).catch(error=>error);
  expect(error.details.quantityRejected).toMatchObject({terminalConfirmed:true,status:'rejected'});expect(await cancelPendingReturn(db,actor,cancelInput)).toMatchObject({status:'duplicate'}); expect(state.writes).toEqual([]);
});
it('native commit unknown을 확정거절로 추정하지 않고 같은 원문으로 재개한다', async () => {
  const input = command(), failure = new Error('commit unknown');
  const transport = { collection: db.collection.bind(db), runTransaction: async (run: Parameters<typeof db.runTransaction>[0]) => { await db.runTransaction(run); throw failure; } } as typeof db;
  await expect(cancelPendingReturn(transport, actor, input)).rejects.toBe(failure);
  expect(await cancelPendingReturn(db, actor, input)).toMatchObject({status: 'duplicate'});
});

it('확정 거절은 같은 증명으로 재개하고 새 작업의 CAS는 거절 이력을 제외한다', async () => {
 const input=command(); state.rows.set('returnRequests/request',{...input.expectedRequest,totalAmount:150});
 const error=await cancelPendingReturn(db,actor,input).catch(error=>error);
 expect(error.details.cancellationRejected).toMatchObject({terminalConfirmed:true,status:'rejected',command:input});
 state.writes=[]; const replay=await cancelPendingReturn(db,actor,input).catch(error=>error);
 expect(replay.details).toEqual(error.details); expect(state.writes).toEqual([]);
 const next={...command(),operationId:'new-cancel'};
 expect(await cancelPendingReturn(db,actor,next)).toMatchObject({status:'cancelled'});
 expect(await cancelPendingReturn(db,actor,next)).toMatchObject({status:'duplicate'});
});

it('다른 취소 작업은 terminal 거절되고 최초 성공 재시도는 그대로 유지된다',async()=>{
 const first=command();await cancelPendingReturn(db,actor,first);const second={...first,operationId:'second'};
 const error=await cancelPendingReturn(db,actor,second).catch(error=>error);expect(error.details.cancellationRejected).toMatchObject({terminalConfirmed:true,command:second});
 state.writes=[];await expect(cancelPendingReturn(db,actor,second)).rejects.toThrow('이미 취소');expect(await cancelPendingReturn(db,actor,first)).toMatchObject({status:'duplicate'});expect(state.writes).toEqual([]);
});
