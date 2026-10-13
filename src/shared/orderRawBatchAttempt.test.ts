// @vitest-environment jsdom
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {archiveRetiredOrderRawBatchAttempt} from './orderRawBatchAttempt';
import {rawPressText} from './rawPressAttempt';
import {orderRawBatchOrderEvidence} from './orderRawBatchAttempt';
import {selectOrderRawBatchOrderEvidence} from '../../functions/src/shared/orderRawBatchOrderEvidence';
import {clearOrderRawBatchAttempt,orderRawBatchAttemptKey,orderRawBatchJobId,readOrderRawBatchAttempt,saveOrderRawBatchAttempt,validateOrderRawBatchRequest,type OrderRawBatchRequest} from './orderRawBatchAttempt';
const make=():OrderRawBatchRequest=>{
 const generation={contractVersion:1 as const,companyId:'taebaek' as const,orderId:'order',operationId:'first',actorUid:'employee',startedAt:'2026-10-12T00:00:00.000Z'};
 return {version:1,generation,recordedAt:generation.startedAt,jobId:orderRawBatchJobId(generation),legacyJobIds:[],business:{orderText:'original-order',lineId:'one',qty:2},plan:{unitKg:1},commands:[{command:{kind:'consume',companyId:'taebaek',rawItemId:'raw',operationId:'first-raw',effectiveAt:generation.startedAt,kg:2,materialSnapshot:'깨',source:{type:'production',id:'order'}}}]};
};
it('공용 업무 selector는 기존 golden 원문과 앱/서버 정렬·undefined 동치이다',async()=>{
 const order={id:'order',companyId:'taebaek',status:'PENDING',items:[{itemId:'p',quantity:2,checked:true,checkedAt:'ignored',checkedBy:'ignored'}],purpose:undefined,memo:'지문 제외'};
 const expected='{"companyId":"taebaek","id":"order","items":[{"checked":true,"itemId":"p","quantity":2}],"status":"PENDING"}';
 const {retirementText}=await import('../../functions/src/orderRequestRetirement');expect(orderRawBatchOrderEvidence(order as any)).toBe(expected);expect(selectOrderRawBatchOrderEvidence(order,retirementText)).toBe(expected);expect(selectOrderRawBatchOrderEvidence(order,rawPressText)).toBe(expected);
});
describe('first order raw batch approval',()=>{
 beforeEach(()=>{localStorage.clear();vi.restoreAllMocks();});
 it('next-day retry reuses first plan and command time, with no rewrite',()=>{
  const first=saveOrderRawBatchAttempt(make()),changed=make();changed.plan={unitKg:99};changed.commands[0].command.effectiveAt='2026-10-13T00:00:00.000Z';
  const writer=vi.spyOn(Storage.prototype,'setItem');expect(saveOrderRawBatchAttempt(changed)).toEqual(first);expect(writer).not.toHaveBeenCalled();
 });
 it('changed item quantity cannot replace approval',()=>{const first=saveOrderRawBatchAttempt(make()),other=make();other.business.qty=3;expect(()=>saveOrderRawBatchAttempt(other)).toThrow();expect(readOrderRawBatchAttempt('taebaek','employee','order')).toEqual(first);});
 it.each(['','{}','null'])('damaged encoded %j is preserved',encoded=>{const key=orderRawBatchAttemptKey('taebaek','employee','order');localStorage.setItem(key,encoded);expect(()=>saveOrderRawBatchAttempt(make())).toThrow();expect(localStorage.getItem(key)).toBe(encoded);});
 it('cleanup cannot remove a replacement request',()=>{const first=saveOrderRawBatchAttempt(make()),key=orderRawBatchAttemptKey('taebaek','employee','order');localStorage.setItem(key,'other');expect(()=>clearOrderRawBatchAttempt(first.request,first.encoded)).toThrow();expect(localStorage.getItem(key)).toBe('other');});
 it('requires plain finite JSON and limits before persistence',()=>{const request=make();request.plan={value:undefined};expect(()=>validateOrderRawBatchRequest(request)).toThrow();request.plan={value:new Date()};expect(()=>validateOrderRawBatchRequest(request)).toThrow();request.plan={value:'x'.repeat(700000)};expect(()=>validateOrderRawBatchRequest(request)).toThrow();expect(localStorage.length).toBe(0);});
 it('first storage failure does not fake retention',()=>{vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('quota');});expect(()=>saveOrderRawBatchAttempt(make())).toThrow('quota');expect(localStorage.length).toBe(0);});
});

describe('수동 unknown 퇴역 원문 보관',()=>{
 beforeEach(()=>{localStorage.clear();vi.restoreAllMocks();});
 const proof=(request:OrderRawBatchRequest)=>({status:'retired',inventoryApplied:'unknown',requestHash:'a'.repeat(64),requestText:rawPressText(request),retirementId:'receipt',generation:request.generation});
 it('처음 encoded·원문·unknown을 archive에 보존한 뒤 active만 제거한다',()=>{const first=saveOrderRawBatchAttempt(make());archiveRetiredOrderRawBatchAttempt(first.request,first.encoded,proof(first.request));expect(readOrderRawBatchAttempt('taebaek','employee','order')).toBeNull();expect(JSON.parse(localStorage.getItem('order-raw-batch-retired:receipt')!)).toMatchObject({encoded:first.encoded,requestText:rawPressText(first.request),inventoryApplied:'unknown'});});
 it.each(['none','other-text','new-generation','archive-conflict','active-conflict'])('%s에서는 원문을 보존한다',kind=>{const first=saveOrderRawBatchAttempt(make()),receipt=proof(first.request),key=orderRawBatchAttemptKey('taebaek','employee','order');if(kind==='none')receipt.inventoryApplied='none';if(kind==='other-text')receipt.requestText='other';if(kind==='new-generation')receipt.generation={...receipt.generation,operationId:'new'};if(kind==='archive-conflict')localStorage.setItem('order-raw-batch-retired:receipt','other');if(kind==='active-conflict')localStorage.setItem(key,'new');expect(()=>archiveRetiredOrderRawBatchAttempt(first.request,first.encoded,receipt)).toThrow();expect(localStorage.getItem(key)).toBe(kind==='active-conflict'?'new':first.encoded);});
 it('archive 보존 확인 사이 replacement가 생기면 제거하지 않는다',()=>{const first=saveOrderRawBatchAttempt(make()),key=orderRawBatchAttemptKey('taebaek','employee','order'),original=Storage.prototype.setItem;vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,k:string,v:string){original.call(this,k,v);if(k.startsWith('order-raw-batch-retired:'))original.call(this,key,'new');});expect(()=>archiveRetiredOrderRawBatchAttempt(first.request,first.encoded,proof(first.request))).toThrow();expect(localStorage.getItem(key)).toBe('new');});
});
