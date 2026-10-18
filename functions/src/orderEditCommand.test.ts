import {expect,it,vi} from 'vitest';
import {executeOrderEditCommand,orderEditReceiptId} from './orderEditCommand';
import {orderEditExpected} from './shared/orderEditCommand';
const actor={uid:'uid',token:{companyId:'taebaek',employeeId:'employee'}};
const request={version:1 as const,companyId:'taebaek' as const,planId:'plan',targetId:'order',expected:orderEditExpected({status:'PENDING',items:[]}),edit:{kind:'items' as const,items:[]},confirmedAddedToDispatched:false};
it('인증·회사·원문 형식 오류는 DB 접근 전에 거절한다',async()=>{
 const collection=vi.fn(()=>{throw Error('DB접근');}),db={collection} as any;
 await expect(executeOrderEditCommand(db,undefined,{mode:'apply',request})).rejects.toMatchObject({code:'unauthenticated'});
 await expect(executeOrderEditCommand(db,{...actor,token:{...actor.token,employeeId:''}},{mode:'apply',request})).rejects.toMatchObject({code:'permission-denied'});
 await expect(executeOrderEditCommand(db,actor,{mode:'apply',request:{...request,companyId:'punghoe'}})).rejects.toMatchObject({code:'permission-denied'});
 await expect(executeOrderEditCommand(db,actor,{mode:'apply',request:{...request,expected:['map',[['forged',['string','x']]]]}})).rejects.toMatchObject({code:'invalid-argument'});
 expect(collection).not.toHaveBeenCalled();
});
it('같은 계획의 영수증은 회사와 UID로 격리한다',()=>{
 const first=orderEditReceiptId('taebaek','u','p');expect(first).toMatch(/^[a-f0-9]{64}$/);expect(orderEditReceiptId('taebaek','u','p')).toBe(first);
 expect(orderEditReceiptId('punghoe','u','p')).not.toBe(first);expect(orderEditReceiptId('taebaek','v','p')).not.toBe(first);expect(orderEditReceiptId('taebaek','u','q')).not.toBe(first);
});

interface RuntimeRef {path:string;id:string}
function noteOnlyRuntime(company:'missing'|'null'|'foreign'|'same'){
 const row:Record<string,unknown>={status:'PENDING',items:[{itemId:'item',lineId:'line',quantity:1,checked:false}],deliveryDate:'2025-10-19',note:'원래 비고',noteImportant:false};
 if(company!=='missing')row.companyId=company==='null'?null:company==='foreign'?'punghoe':'taebaek';
 const rows=new Map<string,Record<string,unknown>>([['orders/order',row],['employees/employee',{companyId:'taebaek',name:'담당자'}]]);
 const reads:string[]=[],writes:{kind:string;path:string;data:Record<string,unknown>}[]=[];
 const ref=(path:string):RuntimeRef=>({path,id:path.split('/').at(-1)!});
 const snapshot=(r:RuntimeRef)=>{reads.push(r.path);const value=rows.get(r.path);return {exists:value!==undefined,data:()=>value,get:(key:string)=>value?.[key]};};
 const db={collection:(name:string)=>({doc:(id:string)=>ref(name+'/'+id)}),doc:ref,runTransaction:async<T>(run:(tx:unknown)=>Promise<T>)=>{
  const staged:{kind:string;path:string;data:Record<string,unknown>}[]=[];
  const tx={get:async(r:RuntimeRef)=>snapshot(r),getAll:async(...refs:RuntimeRef[])=>refs.map(snapshot),create:(r:RuntimeRef,data:Record<string,unknown>)=>{if(rows.has(r.path))throw Error('이미 존재');staged.push({kind:'create',path:r.path,data});},update:(r:RuntimeRef,data:Record<string,unknown>)=>{if(!rows.has(r.path))throw Error('부재');staged.push({kind:'update',path:r.path,data});}};
  const result=await run(tx);for(const write of staged){rows.set(write.path,write.kind==='update'?{...rows.get(write.path),...write.data}:write.data);writes.push(write);}return result;
 }};
 const input:import('./shared/orderEditCommand').OrderEditRequest={version:1,companyId:'taebaek',planId:'note-plan',targetId:'order',expected:orderEditExpected(row),edit:{kind:'draft',draft:{deliveryDate:'2025-10-19',items:row.items as import('./shared/orderEditCommand').OrderEditItem[],note:'바뀐 비고',noteImportant:true}},confirmedAddedToDispatched:false};
 return {db:db as unknown as import('firebase-admin').firestore.Firestore,rows,reads,writes,input,row};
}
it.each(['missing','null','foreign'] as const)('비고만 바꿔도 회사가 %s인 대상은 업무 쓰기 없이 거절 영수증만 남긴다',async company=>{
 const f=noteOnlyRuntime(company),before=JSON.stringify(f.row);const result=await executeOrderEditCommand(f.db,actor,{mode:'apply',request:f.input});
 expect(result.status).toBe('rejected');expect(JSON.stringify(f.rows.get('orders/order'))).toBe(before);expect(f.writes).toHaveLength(1);expect(f.writes[0].path).toBe('orderEditOperations/'+orderEditReceiptId('taebaek',actor.uid,f.input.planId));expect(f.writes[0].data).toMatchObject({status:'rejected',requestHash:result.requestHash});expect(f.reads.some(path=>path.startsWith('catalog')||path.startsWith('items/'))).toBe(false);
});
it('명시한 같은 회사의 비고 수정은 기존 품목·원가 경로 없이 정상 반영된다',async()=>{
 const f=noteOnlyRuntime('same');expect((await executeOrderEditCommand(f.db,actor,{mode:'apply',request:f.input})).status).toBe('applied');expect(f.rows.get('orders/order')).toMatchObject({note:'바뀐 비고',noteImportant:true,items:f.row.items});expect(f.writes.map(write=>write.path)).toEqual(['orders/order','orderEditOperations/'+orderEditReceiptId('taebaek',actor.uid,f.input.planId)]);expect(f.reads.some(path=>path.startsWith('catalog')||path.startsWith('items/'))).toBe(false);
});
it('이미 확정한 영수증은 나중에 대상 회사가 없어져도 먼저 반환하고 업무를 재전송하지 않는다',async()=>{
 const f=noteOnlyRuntime('same');await executeOrderEditCommand(f.db,actor,{mode:'apply',request:f.input});f.rows.get('orders/order')!.companyId=null;f.reads.length=0;const count=f.writes.length;
 expect((await executeOrderEditCommand(f.db,actor,{mode:'apply',request:f.input})).status).toBe('duplicate');expect((await executeOrderEditCommand(f.db,actor,{mode:'inspect',reference:{companyId:'taebaek',planId:f.input.planId,targetId:'order'}})).status).toBe('applied');expect(f.writes).toHaveLength(count);expect(f.reads.every(path=>path.startsWith('orderEditOperations/'))).toBe(true);
});
