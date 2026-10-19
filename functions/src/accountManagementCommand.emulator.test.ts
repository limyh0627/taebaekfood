import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import * as admin from 'firebase-admin';
import { executeAccountManagementCommand, accountManagementReceiptId } from './accountManagementCommand';
import { ACCOUNT_MANAGEMENT_OPERATIONS, accountManagementOpening, normalizeAccountManagementOpenResult,
  normalizeAccountManagementResult, serializeAccountManagementRequest, type AccountManagementReference,
  type AccountManagementRequest, type AccountManagementCommand } from './shared/accountManagementCommand';
const enabled = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8182';
const actor = { uid: 'account-admin', token: { companyId: 'taebaek', employeeId: 'account-admin', isAdmin: true } };
let app: admin.app.App, db: admin.firestore.Firestore;
const owned = new Set<string>();
const own = (path: string) => { owned.add(path); return db.doc(path); };
const receipt = (ref: AccountManagementReference) => own(`${ACCOUNT_MANAGEMENT_OPERATIONS}/${accountManagementReceiptId(ref.companyId, actor.uid, ref.planId)}`);
const run = async (input: Exclude<AccountManagementCommand, { mode: 'open' }>, store = db) => {
  const ref = input.mode === 'apply' ? input.request.reference : input.reference;
  return normalizeAccountManagementResult(await executeAccountManagementCommand(store, actor, input), ref, actor.uid);
};
async function fixture(kind: AccountManagementReference['kind'] = 'code', exists = false) {
  const reference: AccountManagementReference = { companyId: 'taebaek', planId: randomUUID(), kind, targetId: `한글-${randomUUID()}` };
  const target = own(`${kind === 'code' ? 'accountCodes' : 'accountGroups'}/${reference.targetId}`); receipt(reference);
  const data = kind === 'code' ? { id: reference.targetId, name: '코드', code: '0' } : { id: reference.targetId, name: '그룹', type: '비용', plLine: 'sgna' };
  if (exists) { const { id: _id, ...fields } = data; await target.set({ ...fields, companyId: 'taebaek', note: '미지 보존' }); }
  const create: AccountManagementRequest = { version: 1, reference, action: 'create', expectedVersion: null, data };
  const open = async () => normalizeAccountManagementOpenResult(await executeAccountManagementCommand(db, actor,
    { mode: 'open', reference, opening: accountManagementOpening((await target.get()).data()!, kind) }), reference, actor.uid);
  const deletion = async (): Promise<AccountManagementRequest> => ({ version: 1, reference, action: 'delete', expectedVersion: (await open()).expectedVersion });
  return { reference, target, data, create, open, deletion };
}
describe.skipIf(!enabled)('계정 등록·삭제 실제 SDK 명령', () => {
  beforeAll(async () => {
    const projectId = `demo-account-command-${randomUUID().slice(0, 8)}`;
    app = admin.initializeApp({ projectId }, projectId); db = admin.firestore(app);
    await own('employees/account-admin').set({ companyId: 'taebaek', name: '합성 관리자' });
  });
  afterAll(async () => {
    if (!app) return;
    for (const path of owned) await db.doc(path).delete();
    await app.delete();
  });
  it('고정 ID 등록과 영수증은 함께 확정되고 사후 삭제·재생성 후 같은 요청이 덮지 않는다', async () => {
    const f = await fixture();
    expect((await run({ mode: 'apply', request: f.create })).status).toBe('applied');
    expect((await f.target.get()).data()).toEqual({ name: '코드', code: '0', companyId: 'taebaek' });
    await f.target.delete(); expect((await run({ mode: 'apply', request: f.create })).status).toBe('applied');
    expect((await f.target.get()).exists).toBe(false);
    await f.target.set({ companyId: 'taebaek', name: '재생성' });
    await run({ mode: 'apply', request: f.create }); expect((await f.target.get()).get('name')).toBe('재생성');
  });
  it('읽기 open은 쓰기0이며 삭제 ACK와 receipt 후 재생성 문서를 다시 삭제하지 않는다', async () => {
    const f = await fixture('group', true), request = await f.deletion();
    expect((await receipt(f.reference).get()).exists).toBe(false);
    expect((await f.target.get()).exists).toBe(true);
    expect((await run({ mode: 'apply', request })).status).toBe('applied');
    expect((await f.target.get()).exists).toBe(false);
    await f.target.set({ companyId: 'taebaek', name: '다시 만든 그룹' });
    await run({ mode: 'apply', request }); expect((await f.target.get()).exists).toBe(true);
  });
  it('선택 원문 변경은 open을 막고 숨김 메모만 바뀌어도 native CAS 삭제를 거절한다', async () => {
    const f = await fixture('code', true), request = await f.deletion();
    await f.target.update({ note: '다른 값' });
    expect((await run({ mode: 'apply', request })).status).toBe('rejected');
    expect((await f.target.get()).exists).toBe(true);
    await expect(executeAccountManagementCommand(db, actor, { mode: 'open', reference: f.reference,
      opening: accountManagementOpening({ name: '옛 이름', companyId: 'taebaek' }, 'code') })).rejects.toMatchObject({ code: 'failed-precondition' });
  });
  it('삭제 후 같은 ID 재생성도 버전이 달라 옛 삭제 요청을 거절한다', async () => {
    const f = await fixture('group', true), request = await f.deletion(), raw = (await f.target.get()).data()!;
    await f.target.delete(); await f.target.set(raw);
    expect((await run({ mode: 'apply', request })).status).toBe('rejected'); expect((await f.target.get()).exists).toBe(true);
  });
  it('없는 receipt 조회는 unknown이고 cancel fence 뒤 늦은 apply는 실행하지 않는다', async () => {
    const f = await fixture();
    expect((await run({ mode: 'inspect', reference: f.reference })).status).toBe('unknown');
    expect((await receipt(f.reference).get()).exists).toBe(false);
    expect((await run({ mode: 'cancel', reference: f.reference })).status).toBe('cancelled');
    expect((await run({ mode: 'apply', request: f.create })).status).toBe('cancelled'); expect((await f.target.get()).exists).toBe(false);
  });
  it('동시 apply·cancel은 applied 또는 cancelled 하나로 수렴한다', async () => {
    const f = await fixture();
    const results = await Promise.all([run({ mode: 'apply', request: f.create }), run({ mode: 'cancel', reference: f.reference })]);
    expect(results[0].status).toBe(results[1].status);
    expect((await f.target.get()).exists).toBe(results[0].status === 'applied');
  }, 30000);
  it('응답 유실 후 inspect는 같은 hash·회사·UID·대상의 성공을 반환한다', async () => {
    const f = await fixture('group'); await run({ mode: 'apply', request: f.create });
    const hash = createHash('sha256').update(serializeAccountManagementRequest(f.create)).digest('hex');
    expect(await run({ mode: 'inspect', reference: f.reference, requestHash: hash })).toMatchObject({ status: 'applied', requestHash: hash });
    await expect(run({ mode: 'apply', request: { ...f.create, data: { ...f.data, name: '다른 내용' } } })).rejects.toMatchObject({ code: 'already-exists' });
    const other = { ...actor, uid: '다른 UID' };
    expect(await executeAccountManagementCommand(db, other, { mode: 'inspect', reference: f.reference })).toMatchObject({ status: 'unknown' });
    await expect(executeAccountManagementCommand(db, { ...actor, token: { ...actor.token, companyId: 'punghoe' } }, { mode: 'inspect', reference: f.reference })).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('동일 ID가 이미 있으면 원문을 덮지 않고 유효 rejected receipt를 확정한다', async () => {
    const f = await fixture('code', true), before = (await f.target.get()).data();
    expect((await run({ mode: 'apply', request: f.create })).status).toBe('rejected');
    expect((await f.target.get()).data()).toEqual(before); expect((await receipt(f.reference).get()).get('status')).toBe('rejected');
  });
  it('누락·null·타회사 대상은 open·삭제 모두 허용하지 않는다', async () => {
    for (const companyId of [undefined, null, 'punghoe']) {
      const f = await fixture('code', true), raw: Record<string, unknown> = { name: '다른 자료', code: '0' };
      if (companyId !== undefined) raw.companyId = companyId;
      await f.target.set(raw);
      await expect(f.open()).rejects.toMatchObject({ code: 'failed-precondition' });
      expect((await run({ mode: 'apply', request: { version: 1, reference: f.reference, action: 'delete', expectedVersion: '0:000000000' } })).status).toBe('rejected');
      expect((await f.target.get()).data()).toEqual(raw);
    }
  });
  it('receipt 실제 commit 오류는 신규 업무도 원자 롤백하고 SDK 오류로 남긴다', async () => {
    const f = await fixture();
    const broken = new Proxy(db, { get(target, key) {
      if (key === 'runTransaction') return (callback: (tx: admin.firestore.Transaction) => unknown) => target.runTransaction(tx => callback(new Proxy(tx, { get(transaction, method) {
        if (method === 'create') return (ref: admin.firestore.DocumentReference, data: admin.firestore.DocumentData) => transaction.create(ref,
          ref.parent.id === ACCOUNT_MANAGEMENT_OPERATIONS ? { ...data, padding: 'x'.repeat(1100000) } : data);
        const value = Reflect.get(transaction, method); return typeof value === 'function' ? value.bind(transaction) : value;
      } })) as Promise<unknown>);
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
    await expect(run({ mode: 'apply', request: f.create }, broken)).rejects.toThrow();
    expect((await f.target.get()).exists).toBe(false); expect((await receipt(f.reference).get()).exists).toBe(false);
  });
});
