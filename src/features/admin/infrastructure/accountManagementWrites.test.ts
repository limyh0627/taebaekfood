import { beforeEach, expect, it, vi } from 'vitest';
import { deleteField } from 'firebase/firestore';
const state = vi.hoisted(() => ({ uid: 'A', current: true, token: vi.fn(), write: vi.fn() }));
vi.mock('../../../shared/firebase', () => ({ authReady: Promise.resolve(), auth: {
  get currentUser() { return { uid: state.uid, getIdTokenResult: state.token }; },
} }));
vi.mock('../../../shared/services/firebaseService', () => ({ updateItem: state.write }));
import { saveAccountCodeEdit, saveAccountGroupEdit, type AccountEditContext } from './accountManagementWrites';
const context = (): AccountEditContext => ({ companyId: 'taebaek', actorUid: 'A', isCurrent: () => state.current });
beforeEach(() => {
  vi.clearAllMocks(); state.uid = 'A'; state.current = true;
  state.token.mockResolvedValue({ claims: { companyId: 'taebaek' } });
  state.write.mockResolvedValue(undefined);
});
it('손익 명시 해제만 deleteField로 전송하고 미지 필드는 허용하지 않는다', async () => {
  const patch = { name: '이름', plLine: null, note: '미지 원문', cfSection: 'investing' };
  expect(await saveAccountGroupEdit('g', patch, context())).toEqual({ status: 'saved' });
  expect(state.write).toHaveBeenCalledExactlyOnceWith('accountGroups', 'g', { name: '이름', plLine: deleteField() });
});
it('생략과 undefined는 그대로 두고 명시 코드 필드만 전송한다', async () => {
  await saveAccountGroupEdit('g', { name: '이름', plLine: undefined }, context());
  expect(state.write).toHaveBeenLastCalledWith('accountGroups', 'g', { name: '이름' });
  await saveAccountCodeEdit('c', { code: '0', name: '', groupId: undefined }, context());
  expect(state.write).toHaveBeenLastCalledWith('accountCodes', 'c', { code: '0', name: '' });
});
it('토큰 대기 중 UID 변경은 확정 미송신으로 분류한다', async () => {
  state.token.mockImplementation(async () => { state.uid = 'B'; return { claims: { companyId: 'taebaek' } }; });
  expect((await saveAccountGroupEdit('g', { plLine: null }, context())).status).toBe('rejected');
  expect(state.write).not.toHaveBeenCalled();
});
it('다른 회사 claim과 닫힌 창은 전송하지 않는다', async () => {
  state.token.mockResolvedValue({ claims: { companyId: 'punghoe' } });
  expect((await saveAccountCodeEdit('c', { name: '이름' }, context())).status).toBe('rejected');
  state.current = false;
  expect((await saveAccountGroupEdit('g', { name: '이름' }, context())).status).toBe('rejected');
  expect(state.write).not.toHaveBeenCalled();
});
it('실제 writer 응답 실패는 원인을 추측해 미저장으로 바꾸지 않는다', async () => {
  state.write.mockRejectedValueOnce(Error('응답 유실'));
  const result = await saveAccountGroupEdit('g', { name: '이름' }, context());
  expect(result.status).toBe('unknown');
  expect(state.write).toHaveBeenCalledOnce();
});
it('실제 업무 ACK 전에는 saved가 반환되지 않는다', async () => {
  let resolve!: () => void;
  state.write.mockReturnValue(new Promise<void>(done => { resolve = done; }));
  let settled = false;
  const saving = saveAccountCodeEdit('c', { groupId: 'g' }, context()).then(value => { settled = true; return value; });
  await vi.waitFor(() => expect(state.write).toHaveBeenCalledOnce());
  expect(settled).toBe(false); resolve(); expect(await saving).toEqual({ status: 'saved' });
});
