import { beforeEach, expect, it, vi } from 'vitest';
import { deleteField } from 'firebase/firestore';
import { createHash } from 'node:crypto';
import type { AccountGroup } from '../../../shared/types';
import { accountManagementOpening, serializeAccountManagementRequest, type AccountManagementCommand } from '../../../shared/accountManagementCommand';
const state = vi.hoisted(() => ({ uid: 'A', current: true, token: vi.fn(), write: vi.fn(), add: vi.fn(), remove: vi.fn(), command: vi.fn() }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => async (command: AccountManagementCommand) => ({ data: await state.command(command) }) }));
vi.mock('../../../shared/firebase', () => ({ functions: {}, authReady: Promise.resolve(), auth: {
  get currentUser() { return { uid: state.uid, getIdTokenResult: state.token }; },
} }));
vi.mock('../../../shared/services/firebaseService', () => ({ updateItem: state.write, addItem: state.add, deleteItem: state.remove }));
import { saveAccountCodeEdit, saveAccountGroupEdit, saveAccountCodeCreate, saveAccountGroupCreate,
  deleteAccountCode, deleteAccountGroup, captureAccountEditOpening, readAccountOperationReferences, readAccountOperation, retryAccountOperation, inspectAccountOperation, cancelAccountOperation, discardAccountOperationCopy, type AccountEditContext } from './accountManagementWrites';
const context = (): AccountEditContext => ({ companyId: 'taebaek', actorUid: 'A', isCurrent: () => state.current });
const editContext=(id:string,kind:'code'|'group')=>({...context(),planId:'edit-'+id,opening:{reference:{companyId:'taebaek' as const,planId:'edit-'+id,kind,targetId:id},actorUid:'A',expectedVersion:'1:000002000',opening:accountManagementOpening(kind==='group'?{id,name:'원그룹',type:'비용'}:{id,code:'0',name:'원코드'},kind)}});
beforeEach(() => {
  vi.clearAllMocks(); state.uid = 'A'; state.current = true;
  state.token.mockResolvedValue({ claims: { companyId: 'taebaek' } });
  state.write.mockResolvedValue(undefined);
  state.add.mockResolvedValue('fixed'); state.remove.mockResolvedValue(undefined);
  const stored = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    get length() { return stored.size; }, key: (index: number) => Array.from(stored.keys())[index] ?? null,
    getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { stored.set(key, value); }, removeItem: (key: string) => { stored.delete(key); },
  } });
  state.command.mockImplementation(async (command: AccountManagementCommand) => {
    if (command.mode === 'open') return { reference: command.reference, actorUid: 'A', opening: command.opening, expectedVersion: '1:000002000' };
    if (command.mode !== 'apply') throw Error('시험에 예상하지 않은 복구 요청입니다.');
    return { version: 1, reference: command.request.reference, actorUid: 'A', status: 'applied', requestHash: createHash('sha256').update(serializeAccountManagementRequest(command.request)).digest('hex'), message: '완료했습니다.' };
  });
});
it('손익 명시 해제만 deleteField로 전송하고 미지 필드는 허용하지 않는다', async () => {
  const patch = { name: '이름', plLine: null, note: '미지 원문', cfSection: 'investing' };
  expect(await saveAccountGroupEdit('g', patch, editContext('g','group'))).toEqual({ status: 'saved',requestFinalized:true });
  expect(state.command).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({mode:'apply',request:expect.objectContaining({action:'update',patch:{name:'이름',plLine:null}})}));expect(state.write).not.toHaveBeenCalled();
});
it('생략과 undefined는 그대로 두고 명시 코드 필드만 전송한다', async () => {
  await saveAccountGroupEdit('g', { name: '이름', plLine: undefined }, editContext('g','group'));
  expect(state.command.mock.calls.at(-1)?.[0]).toMatchObject({request:{patch:{name:'이름'}}});
  await saveAccountCodeEdit('c', { code: '', name: '코드', groupId: undefined }, editContext('c','code'));
  expect(state.command.mock.calls.at(-1)?.[0]).toMatchObject({request:{patch:{code:'',name:'코드'}}});
});
it('토큰 대기 중 UID 변경은 확정 미송신으로 분류한다', async () => {
  state.token.mockImplementation(async () => { state.uid = 'B'; return { claims: { companyId: 'taebaek' } }; });
  expect((await saveAccountGroupEdit('g', { plLine: null }, editContext('g','group'))).status).toBe('rejected');
  expect(state.write).not.toHaveBeenCalled();
});
it('다른 회사 claim과 닫힌 창은 전송하지 않는다', async () => {
  state.token.mockResolvedValue({ claims: { companyId: 'punghoe' } });
  expect((await saveAccountCodeEdit('c', { name: '이름' }, editContext('c','code'))).status).toBe('rejected');
  state.current = false;
  expect((await saveAccountGroupEdit('g', { name: '이름' }, editContext('g','group'))).status).toBe('rejected');
  expect(state.write).not.toHaveBeenCalled();
});
it('실제 writer 응답 실패는 원인을 추측해 미저장으로 바꾸지 않는다', async () => {
  state.command.mockRejectedValueOnce(Error('응답 유실'));
  const result = await saveAccountGroupEdit('g', { name: '이름' }, editContext('g','group'));
  expect(result.status).toBe('unknown');
  expect(state.command).toHaveBeenCalledOnce();
});
it('실제 업무 ACK 전에는 saved가 반환되지 않는다', async () => {
  let resolve!: () => void;
  const original=state.command.getMockImplementation()!;state.command.mockImplementationOnce(async command=>{await new Promise<void>(done=>{resolve=done;});return original(command);});
  let settled = false;
  const saving = saveAccountCodeEdit('c', { groupId: 'g' }, editContext('c','code')).then(value => { settled = true; return value; });
  await vi.waitFor(() => expect(state.command).toHaveBeenCalledOnce());
  expect(settled).toBe(false); resolve(); expect(await saving).toEqual({ status: 'saved',requestFinalized:true });
});
it('등록은 제출된 고정 ID와 표시 필드만 보내며 계정의 새 필수 정책을 만들지 않는다', async () => {
  await saveAccountCodeCreate({ id: 'ac-fixed', code: '0', name: '코드', groupId: 'g', note: '숨김', normalBalance: 'debit' }, { ...context(), planId: 'code-plan' });
  expect(state.command.mock.calls.at(-1)?.[0].request.data).toEqual({ id: 'ac-fixed', code: '0', name: '코드', groupId: 'g' });
  await saveAccountGroupCreate({ id: 'ag-fixed', name: '그룹', type: '비용', plLine: 'sgna', cfSection: 'operating', note: '숨김' }, { ...context(), planId: 'group-plan' });
  expect(state.command.mock.calls.at(-1)?.[0].request.data).toEqual({ id: 'ag-fixed', name: '그룹', type: '비용', plLine: 'sgna' });
});
it('등록·삭제는 실제 ACK를 기다리고 응답 실패는 unknown이며 자동 재호출하지 않는다', async () => {
  let resolve!: () => void;
  state.command.mockImplementationOnce(async (command: AccountManagementCommand) => {
    if (command.mode !== 'open') throw Error();
    return { reference: command.reference, actorUid: 'A', opening: command.opening, expectedVersion: '1:000002000' };
  }).mockImplementationOnce(async (command: AccountManagementCommand) => {
    if (command.mode !== 'apply') throw Error();
    await new Promise<void>(done => { resolve = done; });
    return { version: 1, reference: command.request.reference, actorUid: 'A', status: 'applied', requestHash: createHash('sha256').update(serializeAccountManagementRequest(command.request)).digest('hex'), message: '삭제 완료' };
  });
  let settled = false;
  const deleting = deleteAccountCode({ id: 'ac-fixed', code: '1', name: '삭제 원문' }, { ...context(), planId: 'delete-plan' }).then(value => { settled = true; return value; });
  await vi.waitFor(() => expect(state.command).toHaveBeenCalledTimes(2)); expect(settled).toBe(false);
  resolve(); expect(await deleting).toEqual({ status: 'saved' });
  state.command.mockRejectedValueOnce(Error('응답 유실'));
  expect((await saveAccountGroupCreate({ id: 'ag-fixed', name: '그룹', type: '비용' }, { ...context(), planId: 'lost-create' })).status).toBe('unknown');
  state.command.mockImplementationOnce(async (command: AccountManagementCommand) => {
    if (command.mode !== 'open') throw Error();
    return { reference: command.reference, actorUid: 'A', opening: command.opening, expectedVersion: '1:000002000' };
  }).mockRejectedValueOnce(Error('응답 유실'));
  expect((await deleteAccountGroup({ id: 'g', name: '그룹', type: '비용' }, { ...context(), planId: 'lost-delete' })).status).toBe('unknown');
  expect(state.command).toHaveBeenCalledTimes(5);
});
it('등록·삭제의 UID 변경은 공통 인증 단계에서 송신 전에 거절한다', async () => {
  state.token.mockImplementation(async () => { state.uid = 'B'; return { claims: { companyId: 'taebaek' } }; });
  expect((await saveAccountCodeCreate({ id: 'ac-fixed', code: '1', name: '코드' }, { ...context(), planId: 'uid-create' })).status).toBe('rejected');
  expect((await deleteAccountGroup({ id: 'g', name: '그룹', type: '비용' }, { ...context(), planId: 'uid-delete' })).status).toBe('rejected');
  expect(state.command).not.toHaveBeenCalled();
  expect(state.add).not.toHaveBeenCalled(); expect(state.remove).not.toHaveBeenCalled();
});

const durableContext = () => ({ ...context(), planId: 'durable-plan' });
const durableReference = { companyId: 'taebaek' as const, planId: 'durable-plan', kind: 'code' as const, targetId: 'ac-fixed' };
const seedUnknown = async () => {
  state.command.mockRejectedValueOnce(Error('응답 유실'));
  await saveAccountCodeCreate({ id: 'ac-fixed', code: '501', name: '첫 원문' }, durableContext());
  const key = localStorage.key(0)!;
  return { key, plan: JSON.parse(localStorage.getItem(key)!) };
};
it('영속 동일 요청 retry는 이후 폼이 아닌 첫 제출 원문만 사용한다', async () => {
  const { plan } = await seedUnknown();
  expect((await retryAccountOperation(durableReference, context())).status).toBe('saved');
  expect(state.command.mock.calls[1][0]).toEqual({ mode: 'apply', request: plan.request });
  expect(localStorage.length).toBe(0);
});
it('보관 set/readback 실패는 apply 전 거절이며 남은 원문을 임의 삭제하지 않는다', async () => {
  const storage = localStorage;
  const originalGet = storage.getItem;
  let written = false;
  const originalSet = storage.setItem;
  storage.setItem = (key, value) => { originalSet(key, value); written = true; };
  storage.getItem = key => { if (written) throw Error('readback 실패'); return originalGet(key); };
  expect((await saveAccountCodeCreate({ id: 'ac-fixed', code: '1', name: '원문' }, durableContext())).status).toBe('rejected');
  expect(state.command).not.toHaveBeenCalled();
  storage.getItem = originalGet;
  expect(storage.length).toBe(1);
});
it('브라우저가 localStorage getter 자체를 거절해도 실제 업무 송신0으로 안내한다', async () => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw Error('브라우저 저장소 차단'); } });
  expect((await saveAccountCodeCreate({ id: 'ac-fixed', code: '1', name: '원문' }, durableContext())).status).toBe('rejected');
  expect(state.command).not.toHaveBeenCalled();
});
it('key와 다른 본문 plan 및 hash 손상은 retry 금지이고 정확 ref 중단은 가능하다', async () => {
  const { key, plan } = await seedUnknown();
  plan.request.reference.planId = 'different-plan'; localStorage.setItem(key, JSON.stringify(plan));
  expect((await readAccountOperation(context(), durableReference)).status).toBe('corrupt');
  expect((await readAccountOperationReferences(context()))[0]).toMatchObject({ reference: durableReference, status: 'corrupt' });
  state.command.mockClear();
  expect((await retryAccountOperation(durableReference, context())).status).toBe('unknown');
  expect(state.command).not.toHaveBeenCalled();
  state.command.mockResolvedValueOnce({ version: 1, reference: durableReference, actorUid: 'A', status: 'cancelled', requestHash: null, message: '요청을 중단했습니다.' });
  expect((await cancelAccountOperation(durableReference, context())).status).toBe('rejected');
  expect(state.command.mock.calls[0][0]).toEqual({ mode: 'cancel', reference: durableReference });
  const observed=localStorage.getItem(key)!;
  expect(observed).not.toBeNull();
  state.command.mockResolvedValueOnce({ version: 1, reference: durableReference, actorUid: 'A', status: 'cancelled', requestHash: null, message: '요청을 중단했습니다.' });
  expect((await discardAccountOperationCopy(durableReference,observed,context())).status).toBe('saved');
  expect(localStorage.getItem(key)).toBeNull();
});
it('local missing은 미처리 확정이 아니며 서버 unknown 원인을 보존한다', async () => {
  expect((await retryAccountOperation(durableReference, context())).status).toBe('unknown');
  expect(state.command).not.toHaveBeenCalled();
  state.command.mockResolvedValueOnce({ version: 1, reference: durableReference, actorUid: 'A', status: 'unknown', requestHash: null, message: '이 요청의 처리 기록이 아직 없습니다.' });
  expect(await inspectAccountOperation(durableReference, context())).toMatchObject({ status: 'unknown', message: '이 요청의 처리 기록이 아직 없습니다.' });
});
it('서버 ACK 뒤 key 교체는 새 원문 삭제 없이 주업무 완료 partial로 보존한다', async () => {
  state.command.mockImplementationOnce(async (command: AccountManagementCommand) => {
    if (command.mode !== 'apply') throw Error();
    localStorage.setItem(localStorage.key(0)!, '교체된 보관 원문');
    return { version: 1, reference: command.request.reference, actorUid: 'A', status: 'applied', requestHash: createHash('sha256').update(serializeAccountManagementRequest(command.request)).digest('hex'), message: '완료' };
  });
  expect(await saveAccountCodeCreate({ id: 'ac-fixed', code: '1', name: '원문' }, durableContext())).toMatchObject({ status: 'partial', committedIds: ['ac-fixed'], unconfirmedIds: [] });
  expect(localStorage.getItem(localStorage.key(0)!)).toBe('교체된 보관 원문');
});
it('actor/hash 불일치는 성공으로 보지 않고 영속 원문을 보존한다', async () => {
  state.command.mockResolvedValueOnce({ version: 1, reference: durableReference, actorUid: 'B', status: 'applied', requestHash: '0'.repeat(64), message: '완료' });
  expect((await saveAccountCodeCreate({ id: 'ac-fixed', code: '1', name: '원문' }, durableContext())).status).toBe('unknown');
  expect(localStorage.length).toBe(1);
});
it('delete open 실패는 읽기 전용 미송신 거절이며 apply와 영속 생성이 없다', async () => {
  state.command.mockRejectedValueOnce(Error('선택 자료가 바뀌었습니다.'));
  expect((await deleteAccountCode({ id: 'ac-fixed', code: '1', name: '원문' }, durableContext())).status).toBe('rejected');
  expect(state.command).toHaveBeenCalledOnce(); expect(state.command.mock.calls[0][0].mode).toBe('open'); expect(localStorage.length).toBe(0);
});
it('같은 ref의 다른 유효 사본은 서버 원문 결과를 확인하고 명시 사본 정리만 가능하다', async () => {
  const { key, plan } = await seedUnknown();
  const originalHash = plan.requestHash;
  plan.request.data.name = '다른 유효 사본';
  plan.requestHash = createHash('sha256').update(serializeAccountManagementRequest(plan.request)).digest('hex');
  const observed = JSON.stringify(plan); localStorage.setItem(key, observed);
  const result = { version: 1, reference: durableReference, actorUid: 'A', status: 'applied', requestHash: originalHash, message: '최초 계정 등록은 완료됐습니다.' };
  state.command.mockResolvedValueOnce(result);
  const outcome = await inspectAccountOperation(durableReference, context());
  expect(outcome).toMatchObject({ status: 'rejected', message: expect.stringContaining('다른 내용이 먼저 확정') });
  expect(outcome.status !== 'saved' && outcome.message).toContain('최초 계정 등록은 완료');
  expect(state.command.mock.calls.at(-1)?.[0]).toEqual({ mode: 'inspect', reference: durableReference });
  expect(localStorage.getItem(key)).toBe(observed);
  expect((await readAccountOperationReferences(context()))[0].observedLocalText).toBe(observed);
  state.command.mockResolvedValueOnce(result);
  expect(await discardAccountOperationCopy(durableReference, observed, context())).toEqual({ status: 'saved' });
  expect(localStorage.getItem(key)).toBeNull();
  expect(state.command.mock.calls.filter(call => call[0].mode === 'apply')).toHaveLength(1);
});
it('서버 unknown이면 로컬 사본 정리는 거절하고 중단을 먼저 안내한다', async () => {
  const { key } = await seedUnknown(); const observed = localStorage.getItem(key)!;
  state.command.mockResolvedValueOnce({ version: 1, reference: durableReference, actorUid: 'A', status: 'unknown', requestHash: null, message: '아직 서버 기록이 없습니다.' });
  expect(await discardAccountOperationCopy(durableReference, observed, context())).toMatchObject({ status: 'rejected', nextAction: expect.stringContaining('먼저 미처리 요청 중단') });
  expect(localStorage.getItem(key)).toBe(observed);
});
it('명시 사본 정리의 서버 확인 중 다른 사본으로 교체되면 새 사본을 지우지 않는다', async () => {
  const { key, plan } = await seedUnknown(); const observed = localStorage.getItem(key)!;
  state.command.mockImplementationOnce(async () => {
    localStorage.setItem(key, '직전 교체된 새 사본');
    return { version: 1, reference: durableReference, actorUid: 'A', status: 'applied', requestHash: plan.requestHash, message: '완료' };
  });
  expect((await discardAccountOperationCopy(durableReference, observed, context())).status).toBe('rejected');
  expect(localStorage.getItem(key)).toBe('직전 교체된 새 사본');
});
it('편집 열기는 선택 원문을 읽기 전용 대조하고 native version을 고정한다',async()=>{
 const row:AccountGroup&{companyId:'taebaek'}={id:'g',name:'선택',type:'비용',companyId:'taebaek' as const};const fixed={...context(),planId:'opened'};
 const opening=await captureAccountEditOpening('group',row,fixed);expect(opening.expectedVersion).toBe('1:000002000');expect(state.command.mock.calls[0][0]).toEqual({mode:'open',reference:opening.reference,opening:accountManagementOpening(row,'group')});expect(localStorage.length).toBe(0);
 row.name='부모 최신 값';await saveAccountGroupEdit('g',{name:'수정'},{...fixed,opening});expect(state.command.mock.calls[1][0]).toMatchObject({request:{expectedVersion:'1:000002000',patch:{name:'수정'}}});expect(state.command.mock.calls.filter(call=>call[0].mode==='open')).toHaveLength(1);
});
it('편집 ACK 뒤 사본 정리 실패에는 종결 태그가 없고 같은 원문 확인 정리 성공에만 붙는다',async()=>{
 const original=localStorage.removeItem;localStorage.removeItem=()=>{throw Error('보관 잠금');};const fixed=editContext('g','group');
 const outcome=await saveAccountGroupEdit('g',{name:'수정'},fixed);expect(outcome).toMatchObject({status:'partial',committedIds:['g']});expect(outcome).not.toHaveProperty('requestFinalized');const raw=localStorage.getItem(localStorage.key(0)!)!,plan=JSON.parse(raw);
 localStorage.removeItem=original;state.command.mockResolvedValueOnce({version:1,reference:fixed.opening.reference,actorUid:'A',status:'applied',requestHash:plan.requestHash,message:'수정 완료'});
 expect(await inspectAccountOperation(fixed.opening.reference,context())).toMatchObject({status:'saved',requestFinalized:true});expect(localStorage.length).toBe(0);
});
it('unknown 편집은 action과 동일 원문을 보관하고 retry는 open 없이 그 원문만 전송한다',async()=>{
 state.command.mockRejectedValueOnce(Error('ACK 유실'));const fixed=editContext('c','code');expect((await saveAccountCodeEdit('c',{groupId:'g'},fixed)).status).toBe('unknown');const entry=(await readAccountOperationReferences(context()))[0];expect(entry.action).toBe('update');const plan=JSON.parse(entry.observedLocalText!);
 expect(await retryAccountOperation(fixed.opening.reference,context())).toMatchObject({status:'saved',requestFinalized:true});expect(state.command.mock.calls[1][0]).toEqual({mode:'apply',request:plan.request});expect(state.command.mock.calls.some(call=>call[0].mode==='open')).toBe(false);
});
