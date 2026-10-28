import {describe,it,expect} from 'vitest';
import {validateFullShipmentIntent,fullShipmentTargetSha} from './orderStockFullShipmentPlan';
import {Timestamp} from 'firebase-admin/firestore';
const intent={version:1,requestId:'요청',companyId:'taebaek',orderId:'주문',action:'shipment-forward',targetStatus:'DELIVERED',expectedOrder:{version:1,nativeSha256:'a'.repeat(64)},deliveredAt:'2026-10-29T00:00:00.000Z'};
describe('출고 초안 입력 원문',()=>{
 it('유효 날짜·원 식별자를 보존한다',()=>{expect(validateFullShipmentIntent(intent)).toEqual(intent);expect(()=>validateFullShipmentIntent({...intent,targetStatus:'SHIPPED',deliveredAt:undefined})).toThrow();});
 it.each([{deliveredAt:'2026-02-30T00:00:00.000Z'},{deliveredAt:'2026-10-29T12:00:00.000Z'},{targetStatus:'SHIPPED'},{targetStatus:'PENDING'},{actorName:'위조'},{expectedOrder:{version:1,nativeSha256:'x'}},{requestId:'../'}])('잘못된 입력 %s를 거절한다',patch=>{expect(()=>validateFullShipmentIntent({...intent,...patch})).toThrow();});
 it('출고 대상 지문은 원 native·목표상태·회사에 묶인다',()=>{const db={projectId:'demo-shipment-test',databaseId:'(default)'} as never,order={companyId:'taebaek',native:new Timestamp(100,123)};const a=fullShipmentTargetSha(db,'taebaek','주문','SHIPPED',order);expect(a).toMatch(/^[a-f0-9]{64}$/);expect(fullShipmentTargetSha(db,'taebaek','주문','DELIVERED',order)).not.toBe(a);expect(fullShipmentTargetSha(db,'punghoe','주문','SHIPPED',order)).not.toBe(a);expect(fullShipmentTargetSha(db,'taebaek','주문','SHIPPED',{...order,native:new Timestamp(100,124)})).not.toBe(a);});
});
