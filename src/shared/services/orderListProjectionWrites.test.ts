import {beforeEach,expect,it,vi} from 'vitest';
import {deleteField,serverTimestamp} from 'firebase/firestore';
const m=vi.hoisted(()=>({call:vi.fn(),uid:'uid',events:[] as string[]}));
vi.mock('../firebase',()=>({authReady:Promise.resolve(),auth:{get currentUser(){return {uid:m.uid};}},functions:{}}));
vi.mock('firebase/functions',()=>({httpsCallable:()=>m.call}));
vi.mock('firebase/firestore',async()=>({...await vi.importActual<object>('firebase/firestore'),doc:(_db:unknown,c:string,id:string)=>({path:c+'/'+id})}));
import {prepareCatalogOrderCommit} from './catalogOrderReferenceProof';
const time='2026-10-15T00:00:00.000Z',base={companyId:'taebaek',status:'DELIVERED',deliveredAt:time,deliveryDate:time,createdAt:time,items:[]};
const sentinel={version:1,candidateDay:'9999-12-31'},bounded={version:1,candidateDay:'2026-10-15'};
beforeEach(()=>{m.call.mockReset();m.events=[];m.uid='uid';});
it('catalog 불필요 earlyreturn도 최종 projection 사본을 반환하고 추가 읽기는 없다',async()=>{
 const tx={get:vi.fn()};const patch=Object.freeze({deliveredAt:'2026-10-16T00:00:00.000Z'});const result=await prepareCatalogOrderCommit({} as any,tx as any,'order',base,patch);expect(result).toEqual({...patch,orderListProjection:{version:1,candidateDay:'2026-10-16'}});expect(tx.get).not.toHaveBeenCalled();expect(patch).not.toHaveProperty('orderListProjection');
});
it('epoch 부재 earlyreturn도 신규 주문 projection을 같은 저장값에 붙인다',async()=>{
 const tx={get:vi.fn(async()=>({exists:()=>false}))};const patch={...base,status:'PENDING',items:[{itemId:'item'}]};expect(await prepareCatalogOrderCommit({} as any,tx as any,'order',undefined,patch,true)).toEqual({...patch,orderListProjection:sentinel});expect(tx.get).toHaveBeenCalledOnce();expect(m.call).not.toHaveBeenCalled();
});
it('proof read전후 원요청 projection과 업무본문을 섞지 않고 모든 read가 write앞이다',async()=>{
 const patch={...base,status:'PENDING',items:[{itemId:'item'}]};m.call.mockImplementation(async(request)=>{m.events.push('rpc');expect(request).not.toHaveProperty('orderListProjection');return {data:{catalogRevision:2,proofId:'proof'}};});
 const tx={get:vi.fn(async(ref:any)=>{m.events.push('read:'+ref.path);return ref.path.startsWith('catalogItemMergeState')?{exists:()=>true,data:()=>({companyId:'taebaek',revision:2})}:{exists:()=>true,data:()=>({companyId:'taebaek',actorUid:'uid',orderId:'order',catalogRevision:2,beforeRevision:0,orderExists:false,status:'PENDING',items:patch.items})};})};
 const result=await prepareCatalogOrderCommit({} as any,tx as any,'order',undefined,patch,true);m.events.push('write');expect(result).toEqual({...patch,orderListProjection:sentinel,catalogReferenceProofId:'proof'});expect(m.events).toEqual(['read:catalogItemMergeState/taebaek','rpc','read:catalogOrderReferenceProofs/proof','write']);expect(patch).not.toHaveProperty('orderListProjection');
});
it('실 SDK 공개 deleteField/isEqual adapter와 미지원 transform 차단',async()=>{
 const tx={get:vi.fn()},deleted=deleteField();const result=await prepareCatalogOrderCommit({} as any,tx as any,'order',base,{deliveredAt:deleted});expect(result.deliveredAt).toBe(deleted);expect(result.orderListProjection).toEqual(sentinel);
 await expect(prepareCatalogOrderCommit({} as any,tx as any,'order',base,{createdAt:serverTimestamp()})).rejects.toThrow('변환');expect(tx.get).not.toHaveBeenCalled();
});
it('purchaseOrders는 새 projection이나 사본을 추가하지 않는다',async()=>{const patch={note:'매입원문'},tx={get:vi.fn()};expect(await prepareCatalogOrderCommit({} as any,tx as any,'po',{companyId:'taebaek',items:[]},patch,false,'purchaseOrders')).toBe(patch);expect(tx.get).not.toHaveBeenCalled();});
