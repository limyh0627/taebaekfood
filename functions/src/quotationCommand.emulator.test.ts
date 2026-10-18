import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import * as admin from 'firebase-admin';
import {executeQuotationCommand,quotationReceiptId} from './quotationCommand';
import {QUOTATION_OPERATIONS,quotationOpening,quotationSnapshot,normalizeQuotationRequest,normalizeQuotationOpenResult,normalizeQuotationResult,type QuotationRequest,type QuotationReference,type QuotationCommand,type CatalogValueAdapter} from './shared/quotationCommand';
const active=process.env.FIRESTORE_EMULATOR_HOST==='127.0.0.1:8182';
const actor={uid:'quotation-admin',token:{employeeId:'quotation-admin',companyId:'taebaek',isAdmin:true}};
const codec:Pick<CatalogValueAdapter,'special'>={special:value=>value instanceof admin.firestore.Timestamp?['timestamp',value.seconds,value.nanoseconds]:undefined};
let app:admin.app.App,db:admin.firestore.Firestore;
const owned=new Set<string>();
const doc=(path:string)=>{owned.add(path);return db.doc(path);};
const receipt=(reference:QuotationReference)=>doc(QUOTATION_OPERATIONS+'/'+quotationReceiptId(reference.companyId,actor.uid,reference.planId));
const run=async(command:Exclude<QuotationCommand,{mode:'open'}>,database=db)=>{
 const reference=command.mode==='apply'?command.request.reference:command.reference;
 return normalizeQuotationResult(await executeQuotationCommand(database,actor,command),reference,actor.uid);
};
const apply=(request:QuotationRequest,database=db)=>run({mode:'apply',request},database);
async function fixture(existing=true){
 const reference:QuotationReference={companyId:'taebaek',planId:'plan-'+randomUUID(),targetId:'한글견적-'+randomUUID()};
 const target=doc('quotations/'+reference.targetId);receipt(reference);
 const raw={companyId:'taebaek',quoteNo:'과거 번호',date:'예전 문자열',partnerId:'',partnerName:'문의처',validUntil:'옛 기한',recipientPhone:'지울 연락처',attention:'담당',deliveryTerms:'납품',paymentTerms:'결제',lines:[{name:'품목',spec:'옛 규격',qty:2,price:-10,cost:0,isTaxExempt:false,opaque:{at:new admin.firestore.Timestamp(1,2000),nested:[{values:[1,0,-2]}]}}],totalSupply:-20,totalTax:-2,totalAmount:-22,totalCost:0,note:'지울 비고',createdAt:'과거 시각',createdBy:'직원',legacyHeader:{keep:true}};
 if(existing)await target.set(raw);
 const snapshot=quotationSnapshot({...raw,id:reference.targetId},codec);
 async function open(){return normalizeQuotationOpenResult(await executeQuotationCommand(db,actor,{mode:'open',reference,opening:quotationOpening(raw,codec)}),reference,actor.uid);}
 async function request(action:QuotationRequest['action']='update'){
  if(action==='create')return normalizeQuotationRequest({version:1,reference,action,expectedVersion:null,snapshot});
  const opened=await open();return normalizeQuotationRequest({version:1,reference,action,expectedVersion:opened.expectedVersion,...(action==='delete'?{}:{snapshot:opened.snapshot})});
 }
 return {reference,target,raw,snapshot,open,request};
}
describe.skipIf(!active)('견적 명령 실제 SDK 계약',()=>{
 beforeAll(async()=>{app=admin.initializeApp({projectId:'demo-quotation-'+randomUUID().slice(0,8)},'quotation-'+randomUUID());db=admin.firestore(app);await doc('employees/'+actor.token.employeeId).set({name:'legacy 관리자'});});
 afterAll(async()=>{if(!db)return;for(const path of owned)await db.doc(path).delete();await app.delete();},60000);
 it('열림은 identity가 없는 원문을 비교하고 native ns버전만 고정하며 업무·receipt를 쓰지 않는다',async()=>{
  const f=await fixture(),before=await f.target.get();expect(before.get('lines')).toEqual(f.raw.lines);const opened=await f.open();
  expect(opened.expectedVersion).toBe(`${before.updateTime!.seconds}:${String(before.updateTime!.nanoseconds).padStart(9,'0')}`);
  expect((await f.target.get()).data()).toEqual(before.data());expect((await receipt(f.reference).get()).exists).toBe(false);
  expect((await f.target.get()).get('id')).toBeUndefined();
  expect((opened.snapshot as unknown[])[0]).toBe('map');
 });
 it('createdAt 또는 줄 spec이 없는 과거 견적도 원문을 열어 삭제하며 같은 원문 저장 형식은 거절한다',async()=>{
  for(const missing of ['createdAt','line.spec']){
   const f=await fixture(),legacy={...f.raw,lines:f.raw.lines.map(line=>({...line}))} as Record<string,unknown>;
   if(missing==='createdAt')delete legacy.createdAt;else delete (legacy.lines as Record<string,unknown>[])[0].spec;
   await f.target.set(legacy);
   const opened=normalizeQuotationOpenResult(await executeQuotationCommand(db,actor,{mode:'open',reference:f.reference,opening:quotationOpening(legacy,codec)}),f.reference,actor.uid);
   expect((await receipt(f.reference).get()).exists).toBe(false);
   const update={version:1,reference:f.reference,action:'update',expectedVersion:opened.expectedVersion,snapshot:opened.snapshot};
   expect(()=>normalizeQuotationRequest(update)).toThrow();
   await expect(executeQuotationCommand(db,actor,{mode:'apply',request:update as QuotationRequest})).rejects.toMatchObject({code:'invalid-argument'});
   const request=normalizeQuotationRequest({version:1,reference:f.reference,action:'delete',expectedVersion:opened.expectedVersion});
   expect((await apply(request)).status).toBe('applied');expect((await f.target.get()).exists).toBe(false);expect((await receipt(f.reference).get()).get('status')).toBe('applied');
  }
 });
 it('신규 고정 ID와 같은 receipt 재호출은 후속 수정·삭제·재생성을 덮거나 부활시키지 않는다',async()=>{
  const f=await fixture(false),request=await f.request('create');expect((await apply(request)).status).toBe('applied');
  expect((await f.target.get()).get('companyId')).toBe('taebaek');expect((await f.target.get()).get('id')).toBeUndefined();
  const proof=await receipt(f.reference).get();await f.target.update({note:'후속 직접수정'});const later=await f.target.get();
  expect((await apply(request)).status).toBe('applied');expect((await f.target.get()).updateTime!.isEqual(later.updateTime!)).toBe(true);
  await f.target.delete();expect((await apply(request)).status).toBe('applied');expect((await f.target.get()).exists).toBe(false);
  expect((await receipt(f.reference).get()).updateTime!.isEqual(proof.updateTime!)).toBe(true);
 });
 it('수정은 선택필드를 지우고 상위 legacy·줄 Timestamp/배열·원가0·음수단가·옛 문자열을 그대로 보존한다',async()=>{
  const f=await fixture(),opened=await f.open(),replacement={...f.raw,id:f.reference.targetId} as Record<string,unknown>;
  delete replacement.note;delete replacement.recipientPhone;delete replacement.validUntil;
  const request=normalizeQuotationRequest({version:1,reference:f.reference,action:'update',expectedVersion:opened.expectedVersion,snapshot:quotationSnapshot(replacement,codec)});
  expect((await apply(request)).status).toBe('applied');const saved=(await f.target.get()).data()!;
  expect(saved).toMatchObject({legacyHeader:{keep:true},date:'예전 문자열',totalCost:0,totalSupply:-20});
  expect(saved.lines).toEqual(f.raw.lines);expect(saved).not.toHaveProperty('id');
  for(const field of ['note','recipientPhone','validUntil'])expect(saved).not.toHaveProperty(field);
 });
 it('같은 본문 id는 보존하고 잘못된 본문 id는 열림·apply 모두 거절한다',async()=>{
  const f=await fixture();await f.target.update({id:f.reference.targetId});expect((await apply(await f.request())).status).toBe('applied');expect((await f.target.get()).get('id')).toBe(f.reference.targetId);
  const broken=await fixture();await broken.target.update({id:'다른번호'});
  await expect(broken.open()).rejects.toMatchObject({code:'failed-precondition'});
  const current=await broken.target.get(),version=`${current.updateTime!.seconds}:${String(current.updateTime!.nanoseconds).padStart(9,'0')}`;
  expect((await apply(normalizeQuotationRequest({version:1,reference:broken.reference,action:'delete',expectedVersion:version}))).status).toBe('rejected');expect((await broken.target.get()).exists).toBe(true);
 });
 it('열림 내용이 다르면 묵시 교체하지 않으며 다른 회사·누락·null 대상은 업무0이다',async()=>{
  const stale=await fixture();await stale.target.update({note:'외부수정'});await expect(stale.open()).rejects.toMatchObject({code:'failed-precondition'});expect((await receipt(stale.reference).get()).exists).toBe(false);
  for(const company of [undefined,null,'punghoe']){
   const f=await fixture(),request=await f.request();await f.target.update({companyId:company===undefined?admin.firestore.FieldValue.delete():company});const before=await f.target.get();
   await expect(f.open()).rejects.toMatchObject({code:'failed-precondition'});expect((await apply(request)).status).toBe('rejected');expect((await f.target.get()).data()).toEqual(before.data());
  }
 });
 it('legacy 직접 변경과 삭제 재생성은 update/delete native CAS를 깨며 거절 receipt는 다시 승격되지 않는다',async()=>{
  for(const action of ['update','delete'] as const){
   const f=await fixture(),request=await f.request(action);await f.target.update({unowned:'추가된 값'});const changed=await f.target.get();
   expect((await apply(request)).status).toBe('rejected');expect((await f.target.get()).updateTime!.isEqual(changed.updateTime!)).toBe(true);
   expect((await run({mode:'inspect',reference:f.reference})).status).toBe('rejected');
  }
  const f=await fixture(),request=await f.request('delete');await f.target.delete();await f.target.set(f.raw);expect((await apply(request)).status).toBe('rejected');expect((await f.target.get()).exists).toBe(true);
 });
 it('삭제와 receipt가 함께 확정되고 같은 완료 요청은 같은 ID의 새 견적을 다시 지우지 않는다',async()=>{
  const f=await fixture(),request=await f.request('delete');expect((await apply(request)).status).toBe('applied');expect((await f.target.get()).exists).toBe(false);
  await f.target.set({...f.raw,note:'재생성'});const later=await f.target.get();expect((await apply(request)).status).toBe('applied');expect((await f.target.get()).updateTime!.isEqual(later.updateTime!)).toBe(true);
 });
 it('receipt 실제 1.1MB commit 오류는 견적 수정과 receipt를 모두 남기지 않는다',async()=>{
  const f=await fixture(),request=await f.request(),before=await f.target.get();
  const database=new Proxy(db,{get(target,key){
   if(key==='runTransaction')return (work:(tx:admin.firestore.Transaction)=>Promise<unknown>)=>target.runTransaction(tx=>work(new Proxy(tx,{get(transaction,method){
    if(method==='create')return (ref:admin.firestore.DocumentReference,data:Record<string,unknown>)=>transaction.create(ref,ref.parent.id===QUOTATION_OPERATIONS?{...data,padding:'x'.repeat(1100000)}:data);
    const value=Reflect.get(transaction,method);return typeof value==='function'?value.bind(transaction):value;
   }})));
   const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
  await expect(apply(request,database)).rejects.toThrow();expect((await f.target.get()).updateTime!.isEqual(before.updateTime!)).toBe(true);expect((await receipt(f.reference).get()).exists).toBe(false);
  expect((await apply(request)).status).toBe('applied');
 });
 it('부재 inspect는 unknown이며 opaque cancel과 late apply 경합은 한 결과만 확정한다',async()=>{
  const f=await fixture(false),request=await f.request('create');expect((await run({mode:'inspect',reference:f.reference})).status).toBe('unknown');expect((await receipt(f.reference).get()).exists).toBe(false);
  expect((await run({mode:'cancel',reference:f.reference})).status).toBe('cancelled');expect((await apply(request)).status).toBe('cancelled');expect((await f.target.get()).exists).toBe(false);
  const race=await fixture(false),next=await race.request('create');await Promise.all([apply(next),run({mode:'cancel',reference:race.reference})]);const result=await run({mode:'inspect',reference:race.reference});expect((await race.target.get()).exists).toBe(result.status==='applied');
 },60000);
 it('관리자 권한·실직원·hash를 지키고 종전 자기 ACK는 실직원 삭제 후에도 조회한다',async()=>{
  const f=await fixture(false),request=await f.request('create');await apply(request);await doc('employees/'+actor.token.employeeId).delete();
  try{
   expect((await run({mode:'inspect',reference:f.reference})).status).toBe('applied');expect((await apply(request)).status).toBe('applied');
   const fresh=await fixture(false);await expect(apply(await fresh.request('create'))).rejects.toMatchObject({code:'permission-denied'});
  }finally{await doc('employees/'+actor.token.employeeId).set({name:'legacy 관리자'});}
  await expect(executeQuotationCommand(db,{...actor,token:{...actor.token,isAdmin:false}},{mode:'inspect',reference:f.reference})).rejects.toMatchObject({code:'permission-denied'});
  await expect(run({mode:'inspect',reference:f.reference,requestHash:'a'.repeat(64)})).rejects.toMatchObject({code:'already-exists'});
  await receipt(f.reference).update({requestText:'손상'});await expect(run({mode:'inspect',reference:f.reference})).rejects.toMatchObject({code:'failed-precondition'});
 });
});
