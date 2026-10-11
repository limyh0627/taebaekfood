import {describe,it,expect} from 'vitest';
import {assessCancellationLockRecovery,cancellationEvidenceText} from './orderCancellationEvidence';
const hash='a'.repeat(64),id='ORD-test',opId=`order-cancellation-cancel-shipment-${id}-${hash}`;
const order={id,status:'SHIPPED',items:[{itemId:'p',quantity:2}],inventoryOperation:{id:opId,state:'failed',kind:'status',stage:'final-stock',targetStatus:'DISPATCHED'}};
const assess=(patch:Partial<typeof order>={},completionExists=false)=>assessCancellationLockRecovery({order:{...order,...patch},failedOperationId:opId,evidenceHash:hash,completionExists});
describe('원자 취소 미반영 실패의 복구 경계',()=>{
 it('같은 실패 원문만 미반영 복구를 허용한다',()=>expect(assess()).toEqual({status:'ready',inventoryApplied:'none',action:'cancel-shipment'}));
 it('일반 상태 실패·진행 중·다른 operation은 원료 미반영이라고 단정하지 않는다',()=>{
  expect(assess({inventoryOperation:{...order.inventoryOperation,id:'order-status-ORD-test-123'}})).toMatchObject({status:'blocked',inventoryApplied:'unknown',reason:'OPERATION_CHANGED'});
  expect(assess({inventoryOperation:{...order.inventoryOperation,state:'processing'}})).toMatchObject({status:'blocked',reason:'OPERATION_NOT_FAILED'});
  expect(assess({inventoryOperation:{...order.inventoryOperation,stage:'raw-inventory'}})).toMatchObject({status:'blocked',reason:'LEGACY_OPERATION_UNPROVEN'});
 });
 it('완료표·변경된 승인 원문·달라진 상태를 보호한다',()=>{
  expect(assess({},true)).toMatchObject({status:'blocked',inventoryApplied:'complete'});
  expect(assessCancellationLockRecovery({order,failedOperationId:opId,evidenceHash:'b'.repeat(64),completionExists:false})).toMatchObject({status:'blocked',reason:'APPROVAL_EVIDENCE_CHANGED'});
  expect(assess({status:'DISPATCHED'})).toMatchObject({status:'blocked',reason:'ORDER_STATUS_CHANGED'});
 });
 it('삭제 실패도 원자 ID와 원문이 맞아야 허용한다',()=>{
  const failed=`order-cancellation-delete-${id}-${hash}`;
  expect(assessCancellationLockRecovery({order:{...order,status:'DISPATCHED',inventoryOperation:{...order.inventoryOperation,id:failed,targetStatus:'PENDING'}},failedOperationId:failed,evidenceHash:hash,completionExists:false})).toMatchObject({status:'ready',action:'delete'});
 });
 it('앱 취소 지문은 표시명/BOM은 제외하고 로트·스냅샷·수량을 보존한다',()=>{
  const before=cancellationEvidenceText(order,'cancel-shipment');
  const same=cancellationEvidenceText({...order,items:[{...order.items[0],lineId:undefined}]},'cancel-shipment');expect(same).toBe(before);
  expect(JSON.parse(before)).toEqual({action:'cancel-shipment',id,status:'SHIPPED',companyId:'taebaek',producedAt:'',shippedOut:false,items:[{lineId:'',itemId:'p',quantity:2,isBoxUnit:false,boxQuantity:null}],inventorySnapshots:null,itemInventory:null,rawConsumedLots:[],productConsumedLots:[]});
  expect(cancellationEvidenceText({...order,items:[{itemId:'p',quantity:3}]},'cancel-shipment')).not.toBe(before);
 });
});
