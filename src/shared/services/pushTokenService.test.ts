import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ employeeId: 'employee-own', uid: 'auth-different', anonymous: false, loggedIn: true, fail: false, writes: [] as unknown[][] }));
vi.mock('../firebase', () => ({ app: {}, db: {}, authReady: Promise.resolve(), auth: {
  get currentUser() { return state.loggedIn ? { uid: state.uid, isAnonymous: state.anonymous, getIdTokenResult: async () => ({ claims: { employeeId: state.employeeId } }) } : null; },
} }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => `${collection}/${id}`,
  arrayUnion: (token: string) => ({ union: token }), arrayRemove: (token: string) => ({ remove: token }), deleteField: () => ({ delete: true }),
  FieldPath: class { constructor(public parent: string, public token: string) {} },
  updateDoc: async (...args: unknown[]) => { if (state.fail) throw new Error('저장 실패'); state.writes.push(args); },
}));
vi.mock('firebase/messaging', () => ({ isSupported: async () => true, getMessaging: () => ({}), getToken: async () => 'token:with.dot' }));
vi.mock('../deviceLabel', () => ({ currentDeviceLabel: () => '합성 기기' }));
import { updateOwnPushToken } from './pushTokenService';
beforeEach(() => {
  state.employeeId = 'employee-own'; state.uid = 'auth-different'; state.anonymous = false; state.loggedIn = true; state.fail = false; state.writes = [];
  vi.stubEnv('VITE_FIREBASE_VAPID_KEY', 'synthetic');
  vi.stubGlobal('Notification', { permission: 'granted' });
  vi.stubGlobal('navigator', { serviceWorker: { register: async () => ({}) } });
  vi.stubGlobal('localStorage', { getItem: () => null });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it('UID와 다른 직원 문서 ID도 employeeId claim으로 확인하며 토큰·기기 정보를 한 번에 저장한다', async () => {
  await updateOwnPushToken('employee-own', 'token:with.dot', { name: '기기', at: '2026-10-07' });
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0]).toEqual(['employees/employee-own', 'fcmTokens', { union: 'token:with.dot' }, expect.objectContaining({ parent: 'fcmDevices', token: 'token:with.dot' }), { name: '기기', at: '2026-10-07' }]);
});
it('삭제도 토큰과 해당 기기 키만 하나의 update로 제거한다', async () => {
  await updateOwnPushToken('employee-own', 'token:with.dot');
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0]).toEqual(['employees/employee-own', 'fcmTokens', { remove: 'token:with.dot' }, expect.objectContaining({ token: 'token:with.dot' }), { delete: true }]);
});
it('타직원 및 로그인 없는 요청은 쓰기 전에 거절한다', async () => {
  await expect(updateOwnPushToken('foreign', 't')).rejects.toThrow('본인');
  state.loggedIn = false; await expect(updateOwnPushToken('employee-own', 't')).rejects.toThrow('본인');
  state.loggedIn = true; state.anonymous = true; await expect(updateOwnPushToken('employee-own', 't')).rejects.toThrow('본인');
  expect(state.writes).toEqual([]);
});
it('저장 실패는 반쪽 토큰·기기 기록 없이 전달한다', async () => {
  state.fail = true;
  await expect(updateOwnPushToken('employee-own', 't', { name: '기기', at: 'now' })).rejects.toThrow('저장 실패');
  expect(state.writes).toEqual([]);
});
it('관리자 자동등록과 마이페이지가 쓰는 실제 registerPush 경로는 한 번만 저장한다', async () => {
  const { registerPush } = await import('../push');
  expect(await registerPush('employee-own')).toEqual({ ok: true, token: 'token:with.dot' });
  expect(state.writes).toHaveLength(1);
});
it('기존 로그아웃 삭제 경로는 실패를 삼키고 성공 시 두 필드를 함께 지운다', async () => {
  const { unregisterPush } = await import('../push');
  await unregisterPush('employee-own', 'token:with.dot'); expect(state.writes).toHaveLength(1);
  state.fail = true; await expect(unregisterPush('employee-own', 'token:with.dot')).resolves.toBeUndefined();
  expect(state.writes).toHaveLength(1);
});
