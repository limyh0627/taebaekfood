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
  const update = async (patch: NonNullable<AccountManagementRequest['patch']>): Promise<AccountManagementRequest> => ({version:1,reference,action:'update',expectedVersion:(await open()).expectedVersion,patch});
  return { reference, target, data, create, open, deletion, update };
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
  it('dirty수정과영수증은동시확정되고다른필드와재전송뒤의후속내용을보존한다',async()=>{
    const f=await fixture('code',true);await f.target.update({normalBalance:'debit',legacy:{kept:true}});
    const request=await f.update({name:'수정된 이름'});expect((await run({mode:'apply',request})).status).toBe('applied');
    expect((await f.target.get()).data()).toEqual({name:'수정된 이름',code:'0',companyId:'taebaek',note:'미지 보존',normalBalance:'debit',legacy:{kept:true}});
    expect((await receipt(f.reference).get()).get('requestText')).toBe(serializeAccountManagementRequest(request));
    await f.target.update({name:'나중 변경'});expect((await run({mode:'apply',request})).status).toBe('applied');expect((await f.target.get()).get('name')).toBe('나중 변경');
    await f.target.delete();expect((await run({mode:'apply',request})).status).toBe('applied');expect((await f.target.get()).exists).toBe(false);
  });
  it('손익줄생략은보존하고명시null은필드만삭제하며미지필드를유지한다',async()=>{
    const f=await fixture('group',true);const first=await f.update({name:'첫 수정'});await run({mode:'apply',request:first});expect((await f.target.get()).get('plLine')).toBe('sgna');
    const reference={...f.reference,planId:randomUUID()};receipt(reference);const request={...await f.update({plLine:null}),reference};await run({mode:'apply',request});const row=(await f.target.get()).data()!;expect(row.plLine).toBeUndefined();expect(row).toMatchObject({name:'첫 수정',type:'비용',note:'미지 보존',companyId:'taebaek'});
  });
  it('같은회사그룹으로만이동하고legacy빈이름과명시미분류는보존한다',async()=>{
    const f=await fixture('code',true);await f.target.update({name:''});const group=own('accountGroups/'+randomUUID());await group.set({companyId:'taebaek',name:'이동 그룹'});
    const request=await f.update({groupId:group.id});await run({mode:'apply',request});expect((await f.target.get()).data()).toMatchObject({name:'',code:'0',groupId:group.id,note:'미지 보존'});
    const reference={...f.reference,planId:randomUUID()};receipt(reference);await run({mode:'apply',request:{...await f.update({groupId:''}),reference}});expect((await f.target.get()).get('groupId')).toBe('');
  });
  it.each(['missing','foreign','legacy'] as const)('%s그룹으로의수정은업무0·rejectedreceipt이고기존create정책은바꾸지않는다',async mode=>{
    const f=await fixture('code',true),group=own('accountGroups/'+randomUUID());if(mode!=='missing')await group.set({name:'다른 그룹',...(mode==='foreign'?{companyId:'punghoe'}:{})});
    const before=(await f.target.get()).data();const result=await run({mode:'apply',request:await f.update({groupId:group.id})});expect(result.status).toBe('rejected');expect((await f.target.get()).data()).toEqual(before);expect((await receipt(f.reference).get()).get('status')).toBe('rejected');
  });
  it('비수정필드변경과삭제재생성도전체native버전이달라수정하지않는다',async()=>{
    for(const change of ['hidden','recreate']){const f=await fixture('code',true),request=await f.update({name:'옛 초안'});const raw=(await f.target.get()).data()!;if(change==='hidden')await f.target.update({note:'숨은 변경'});else{await f.target.delete();await f.target.set(raw);}expect((await run({mode:'apply',request})).status).toBe('rejected');expect((await f.target.get()).get('name')).toBe('코드');}
  });
  it('없는수정대상은부활시키지않고회사불일치는rejectedreceipt로보존한다',async()=>{
    for(const company of [undefined,null,'punghoe']){const f=await fixture('code',true),request=await f.update({name:'변경'});const row={name:'원래 이름',code:'0',...(company===undefined?{}:{companyId:company})};await f.target.set(row);expect((await run({mode:'apply',request})).status).toBe('rejected');expect((await f.target.get()).data()).toEqual(row);}
    const f=await fixture('code',true),request=await f.update({name:'삭제후수정'});await f.target.delete();expect((await run({mode:'apply',request})).status).toBe('rejected');expect((await f.target.get()).exists).toBe(false);
  });
  it('같은열림버전의동시수정은한건만applied로나머지는충돌거절로확정된다',async()=>{
    const f=await fixture('code',true),first=await f.update({name:'A'}),ref={...f.reference,planId:randomUUID()};receipt(ref);const second={...first,reference:ref,patch:{name:'B'}};const results=await Promise.all([run({mode:'apply',request:first}),run({mode:'apply',request:second})]);expect(results.map(r=>r.status).sort()).toEqual(['applied','rejected']);expect(['A','B']).toContain((await f.target.get()).get('name'));
  },30000);
  it('수정응답유실은ref조회로확인하고직원삭제후에도기존ACK를우선한다',async()=>{
    const f=await fixture('code',true),request=await f.update({code:''});await run({mode:'apply',request});const hash=createHash('sha256').update(serializeAccountManagementRequest(request)).digest('hex');expect(await run({mode:'inspect',reference:f.reference})).toMatchObject({status:'applied',requestHash:hash});
    await db.doc('employees/account-admin').delete();try{expect((await run({mode:'apply',request})).status).toBe('applied');expect((await run({mode:'inspect',reference:f.reference})).status).toBe('applied');}finally{await db.doc('employees/account-admin').set({companyId:'taebaek',name:'합성 관리자'});}
    await expect(run({mode:'apply',request:{...request,patch:{code:'different'}}})).rejects.toMatchObject({code:'already-exists'});
  });
  it('수정이아직없으면unknown이며중단fence뒤늦은update는원문을변경하지않는다',async()=>{
    const f=await fixture('code',true),request=await f.update({name:'늦은 수정'}),before=(await f.target.get()).data();expect((await run({mode:'inspect',reference:f.reference})).status).toBe('unknown');expect((await receipt(f.reference).get()).exists).toBe(false);await run({mode:'cancel',reference:f.reference});expect((await run({mode:'apply',request})).status).toBe('cancelled');expect((await f.target.get()).data()).toEqual(before);
  });
  it('수정뒤receipt실제commit실패는대상수정과영수증을함께롤백한다',async()=>{
    const f=await fixture('code',true),request=await f.update({name:'롤백 대상'}),before=(await f.target.get()).data();
    const broken=new Proxy(db,{get(target,key){if(key==='runTransaction')return(callback:(tx:admin.firestore.Transaction)=>unknown)=>target.runTransaction(tx=>callback(new Proxy(tx,{get(transaction,method){if(method==='create')return(ref:admin.firestore.DocumentReference,data:admin.firestore.DocumentData)=>transaction.create(ref,ref.parent.id===ACCOUNT_MANAGEMENT_OPERATIONS?{...data,padding:'x'.repeat(1100000)}:data);const value=Reflect.get(transaction,method);return typeof value==='function'?value.bind(transaction):value;}})) as Promise<unknown>);const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
    await expect(run({mode:'apply',request},broken)).rejects.toThrow();expect((await f.target.get()).data()).toEqual(before);expect((await receipt(f.reference).get()).exists).toBe(false);
  });

});
