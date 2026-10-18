import {it,expect,vi} from 'vitest';
import {executeQuotationCommand,quotationReceiptId} from './quotationCommand';
import {quotationOpening,quotationSnapshot,normalizeQuotationOpenResult,type QuotationRequest} from './shared/quotationCommand';
import * as admin from 'firebase-admin';
const reference={companyId:'taebaek' as const,planId:'plan',targetId:'quotation'};
it('견적 관리자·회사·요청 형식은 DB 접근 전에 확인한다',async()=>{
 const runTransaction=vi.fn(),db={runTransaction} as never;
 await expect(executeQuotationCommand(db,undefined,{mode:'inspect',reference})).rejects.toMatchObject({code:'unauthenticated'});
 await expect(executeQuotationCommand(db,{uid:'u',token:{employeeId:'e',companyId:'taebaek',isAdmin:false}},{mode:'inspect',reference})).rejects.toMatchObject({code:'permission-denied'});
 const actor={uid:'u',token:{employeeId:'e',companyId:'taebaek',isAdmin:true}};
 await expect(executeQuotationCommand(db,actor,{mode:'inspect',reference:{...reference,companyId:'punghoe'}})).rejects.toMatchObject({code:'permission-denied'});
 await expect(executeQuotationCommand(db,actor,{mode:'apply',request:{}} as never)).rejects.toMatchObject({code:'invalid-argument'});
 expect(runTransaction).not.toHaveBeenCalled();
});
it('견적 영수증은 회사·UID·계획을 구분한다',()=>{
 const id=quotationReceiptId('taebaek','u','p');expect(id).toHaveLength(64);
 expect(id).not.toBe(quotationReceiptId('punghoe','u','p'));expect(id).not.toBe(quotationReceiptId('taebaek','other','p'));
});
const actor={uid:'u',token:{employeeId:'e',companyId:'taebaek',isAdmin:true}};
const quote={companyId:'taebaek',quoteNo:'옛번호',date:'옛날짜',partnerId:'',partnerName:'문의처',lines:[{name:'품목',spec:'',qty:1,price:-10,opaque:{keep:true}}],totalSupply:-10,totalTax:0,totalAmount:-10,createdAt:'옛시각',note:'원메모',unknownHeader:{keep:true}};
function runtime(current:Record<string,unknown>|undefined){
 const writes:{kind:string;path:string;data?:Record<string,unknown>}[]=[],reads:string[]=[];
 const tx={get:vi.fn(async(ref:{path:string})=>{
  reads.push(ref.path);
  if(ref.path.startsWith('quotationOperations/'))return {exists:false};
  if(ref.path==='employees/e')return {exists:true,get:()=>undefined};
  return {exists:current!==undefined,data:()=>current,get:(key:string)=>current?.[key],updateTime:{seconds:123,nanoseconds:1}};
 }),create:(ref:{path:string},data:Record<string,unknown>)=>writes.push({kind:'create',path:ref.path,data}),update:(ref:{path:string},data:Record<string,unknown>)=>writes.push({kind:'update',path:ref.path,data}),delete:(ref:{path:string})=>writes.push({kind:'delete',path:ref.path})};
 const db={collection:(name:string)=>({doc:(id:string)=>({path:name+'/'+id})}),runTransaction:async<T>(fn:(value:typeof tx)=>Promise<T>)=>fn(tx)} as never;
 return {db,writes,reads};
}
it('열림은 원문을 비교하고 identity를 응답에만 넣으며 업무·영수증은 쓰지 않는다',async()=>{
 const f=runtime(quote),result=normalizeQuotationOpenResult(await executeQuotationCommand(f.db,actor,{mode:'open',reference,opening:quotationOpening(quote)}),reference,actor.uid);
 expect(result.expectedVersion).toBe('123:000000001');expect(f.writes).toHaveLength(0);expect(f.reads).not.toContain('quotationOperations/'+quotationReceiptId('taebaek','u','plan'));
 await expect(executeQuotationCommand(f.db,actor,{mode:'open',reference,opening:quotationOpening({...quote,note:'수정초안'})})).rejects.toMatchObject({code:'failed-precondition'});
 expect(f.writes).toHaveLength(0);
});
it('create는 id를 본문에 만들지 않고 update는 선택필드 삭제와 상위 미지필드 보존 경계를 지킨다',async()=>{
 const data={...quote,id:reference.targetId};delete (data as Partial<typeof data>).note;
 const request:QuotationRequest={version:1,reference,action:'create',expectedVersion:null,snapshot:quotationSnapshot(data)};
 const fresh=runtime(undefined);await executeQuotationCommand(fresh.db,actor,{mode:'apply',request});
 expect(fresh.writes[0]).toMatchObject({kind:'create',path:'quotations/quotation',data:{companyId:'taebaek'}});expect(fresh.writes[0].data).not.toHaveProperty('id');
 const existing=runtime(quote);await executeQuotationCommand(existing.db,actor,{mode:'apply',request:{...request,action:'update',expectedVersion:'123:000000001'}});
 expect(existing.writes[0].kind).toBe('update');expect(existing.writes[0].data?.note).toEqual(admin.firestore.FieldValue.delete());
 expect(existing.writes[0].data).not.toHaveProperty('id');expect(existing.writes[0].data).not.toHaveProperty('unknownHeader');
});
it('회사 누락·null·타회사와 오래된 버전은 업무0·거절 영수증으로 종결한다',async()=>{
 for(const company of [undefined,null,'punghoe','taebaek']){
  const current={...quote,...(company===undefined?{}:{companyId:company})};if(company===undefined)delete (current as Record<string,unknown>).companyId;
  const f=runtime(current),request:QuotationRequest={version:1,reference,action:'delete',expectedVersion:company==='taebaek'?'122:000000001':'123:000000001'};
  const result=await executeQuotationCommand(f.db,actor,{mode:'apply',request});
  expect(result).toMatchObject({status:'rejected'});expect(f.writes).toHaveLength(1);expect(f.writes[0].path).toMatch(/^quotationOperations\//);
 }
});
