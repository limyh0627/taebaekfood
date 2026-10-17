import { expect, it } from 'vitest';
import { executeCatalogOrderReferenceProof } from './catalogOrderReferenceProof';
import { encodeCatalogValue } from './shared/catalogOrderReferenceProof';
const request=()=>({version:1,companyId:'taebaek',orderId:'o',orderExists:false,beforeRevision:0,catalogRevision:1,status:'PENDING',items:encodeCatalogValue([{itemId:'i',nested:{seconds:1,nanoseconds:2}}])});
const actor={uid:'u',token:{companyId:'taebaek',employeeId:'e'}};
function store(rows:Record<string,any>){const writes:any[]=[];const db:any={doc:(path:string)=>({path}),collection:(c:string)=>({doc:(id:string)=>({path:c+'/'+id,id})}),runTransaction:async(fn:any)=>fn({get:async(ref:any)=>({exists:rows[ref.path]!==undefined,get:(key:string)=>rows[ref.path]?.[key],data:()=>rows[ref.path]}),create:(ref:any,data:any)=>{writes.push(data);rows[ref.path]=data;}})};return {db,writes};}
it('epoch 없음은 새 증거나 업무 쓰기 없이 기존 정책을 유지한다',async()=>{const {db,writes}=store({});expect(await executeCatalogOrderReferenceProof(db,actor,request())).toEqual({proofId:null,catalogRevision:0});expect(writes).toEqual([]);});
it('직원·회사·현재 품목과 epoch가 맞을 때 동일 요청 증거만 재사용한다',async()=>{const {db,writes}=store({'catalogItemMergeState/taebaek':{companyId:'taebaek',revision:1},'items/i':{companyId:'taebaek'}});const first=await executeCatalogOrderReferenceProof(db,actor,request());expect(first.proofId).toBeTruthy();expect(await executeCatalogOrderReferenceProof(db,actor,request())).toEqual(first);expect(writes).toHaveLength(1);expect(writes[0].items[0].nested).toEqual({seconds:1,nanoseconds:2});});
it('다른 회사·통합 tomb·epoch 경합은 proof 쓰기 전에 거절한다',async()=>{const {db,writes}=store({'catalogItemMergeState/taebaek':{companyId:'taebaek',revision:2},'items/i':{companyId:'taebaek'}});await expect(executeCatalogOrderReferenceProof(db,actor,request())).rejects.toMatchObject({code:'aborted'});await expect(executeCatalogOrderReferenceProof(db,{...actor,token:{...actor.token,companyId:'punghoe'}},request())).rejects.toMatchObject({code:'permission-denied'});expect(writes).toEqual([]);});
it('발주 before projection은 누락까지 CAS하며 revision 없이 실제 최종 참조를 검증한다',async()=>{
 const before={status:'pending',itemId:'i'},next={status:'invoiced',itemId:'i',items:[{itemId:'i',quantity:2}]};
 const {db,writes}=store({'catalogItemMergeState/taebaek':{companyId:'taebaek',revision:1},'purchaseOrders/o':{companyId:'taebaek',...before},'items/i':{companyId:'taebaek'}});
 const po={version:1,collection:'purchaseOrders',companyId:'taebaek',orderId:'o',orderExists:true,catalogRevision:1,beforeProjection:encodeCatalogValue({...before,oemSent:null}),nextProjection:encodeCatalogValue(next)};
 await expect(executeCatalogOrderReferenceProof(db,actor,po)).rejects.toMatchObject({code:'aborted'});expect(writes).toEqual([]);
 await executeCatalogOrderReferenceProof(db,actor,{...po,beforeProjection:encodeCatalogValue(before)});
 expect(writes[0].beforeProjection).toEqual(before);expect(writes[0].nextProjection).toEqual(next);expect(writes[0]).not.toHaveProperty('beforeRevision');
});
