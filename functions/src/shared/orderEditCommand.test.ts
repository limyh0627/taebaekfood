import {expect,it} from 'vitest';
import {orderEditExpected,normalizeOrderEditRequest,serializeOrderEditRequest,normalizeOrderEditResult,type OrderEditRequest} from './orderEditCommand';
import {protectInventoryWriterPatch as sharedProtect} from './inventoryWriterProtocol';
import {protectInventoryWriterPatch as clientProtect} from '../../../src/shared/inventoryWriterProtocol';
import {classifyOrderEdit as clientGuard} from '../../../src/shared/orderEditGuard';
import {classifyOrderEdit as serverGuard} from './orderEditGuard';
import {stampOrderItemEdits as clientStamp} from '../../../src/shared/stampOrderItemEdits';
import {stampOrderItemEdits as serverStamp} from './stampOrderItemEdits';
import {boxCountOf as clientBox,orderItemQuantityLabel as clientLabel} from '../../../src/shared/orderUnits';
import {boxCountOf as serverBox,orderItemQuantityLabel as serverLabel} from './orderEditUnits';
const item={lineId:'line',itemId:'item',name:'합성품목',quantity:1,price:0};
const reference={companyId:'taebaek' as const,planId:'plan',targetId:'order'};
const request=():OrderEditRequest=>({version:1,...reference,expected:orderEditExpected({companyId:'taebaek',status:'PENDING',items:[item]}),edit:{kind:'draft',draft:{deliveryDate:'2026-10-19',items:[item],note:'',noteImportant:false}},confirmedAddedToDispatched:false});
it('공유 이동은 같은 함수이며 메타데이터 변경은 재고 revision을 올리지 않는다',()=>{
 expect(clientProtect).toBe(sharedProtect);expect(clientGuard).toBe(serverGuard);expect(clientStamp).toBe(serverStamp);expect(clientBox).toBe(serverBox);expect(clientLabel).toBe(serverLabel);
 const before={inventoryWriterProtocolVersion:1,inventoryWriteRevision:7,items:[item],status:'PENDING'};
 expect(sharedProtect(before,{items:[item],status:'PENDING',note:'수정'},['items','status'])).toMatchObject({inventoryWriteRevision:7});
 expect(sharedProtect(before,{items:[{...item,quantity:2}]},['items','status'])).toMatchObject({inventoryWriteRevision:8});
});
it('비교 원문은 없는 값과 null·false·SDK timestamp를 구별한다',()=>{
 expect(orderEditExpected({status:'PENDING'})).not.toEqual(orderEditExpected({status:'PENDING',note:null}));
 const timestamp={marker:true};const encoded=orderEditExpected({noteAt:timestamp},{special:value=>value===timestamp?['timestamp',1,2]:undefined});
 expect(encoded).toEqual(['map',[['noteAt',['timestamp',1,2]]]]);
 expect(orderEditExpected({id:'synthetic',companyId:'taebaek',noteImportant:false})).toEqual(['map',[['companyId',['string','taebaek']],['noteImportant',['boolean',false]]]]);
});
it('고정 원문은 키 순서와 입력 사본을 보존하며 draft와 items의 수량 계약을 구분한다',()=>{
 const input=request(),copy=structuredClone(input);expect(serializeOrderEditRequest(input)).toBe(serializeOrderEditRequest({...input,edit:{...input.edit}}));expect(input).toEqual(copy);
 expect(()=>normalizeOrderEditRequest({...input,edit:{kind:'items',items:[{...item,quantity:0}]}})).not.toThrow();
 expect(()=>normalizeOrderEditRequest({...input,edit:{kind:'draft',draft:{deliveryDate:'2026-10-19',items:[{...item,quantity:0}],note:'',noteImportant:false}}})).toThrow();
 expect(()=>normalizeOrderEditRequest({...input,edit:{kind:'items',items:[{itemId:'legacy',quantity:1}]}})).not.toThrow();
});
it('새 입력의 손상 날짜·비유한수량·초과크기·추가필드·확인위조를 거절한다',()=>{
 const input=request();for(const patch of [{version:2},{targetId:'bad/id'},{confirmedAddedToDispatched:'true'},{extra:true}])expect(()=>normalizeOrderEditRequest({...input,...patch})).toThrow();
 expect(()=>normalizeOrderEditRequest({...input,edit:{kind:'items',items:[{...item,quantity:Infinity}]}})).toThrow();
 expect(()=>normalizeOrderEditRequest({...input,edit:{kind:'draft',draft:{deliveryDate:'2026-02-30',items:[item],note:'',noteImportant:false}}})).toThrow();
 expect(()=>normalizeOrderEditRequest({...input,edit:{kind:'draft',draft:{deliveryDate:'2026-10-19',items:[item],note:'한'.repeat(90000),noteImportant:false}}})).toThrow();
});
it('결과는 같은 회사·UID·대상·계획·해시와 opaque 중단만 확정한다',()=>{
 const good={...reference,actorUid:'u',status:'applied',requestHash:'a'.repeat(64),message:'완료'};
 expect(normalizeOrderEditResult(good,reference,'u','a'.repeat(64)).status).toBe('applied');
 for(const patch of [{targetId:'other'},{companyId:'punghoe'},{actorUid:'v'},{planId:'other'},{requestHash:'b'.repeat(64)},{requestHash:null},{status:'unknown'}])expect(()=>normalizeOrderEditResult({...good,...patch},reference,'u','a'.repeat(64))).toThrow();
 expect(normalizeOrderEditResult({...good,status:'cancelled',requestHash:null},reference,'u').status).toBe('cancelled');
 expect(()=>normalizeOrderEditResult({...good,status:'rejected',requestHash:null},reference,'u')).toThrow();
});
