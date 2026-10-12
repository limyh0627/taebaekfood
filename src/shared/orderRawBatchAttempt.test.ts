// @vitest-environment jsdom
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {clearOrderRawBatchAttempt,orderRawBatchAttemptKey,orderRawBatchJobId,readOrderRawBatchAttempt,saveOrderRawBatchAttempt,validateOrderRawBatchRequest,type OrderRawBatchRequest} from './orderRawBatchAttempt';
const make=():OrderRawBatchRequest=>{
 const generation={contractVersion:1 as const,companyId:'taebaek' as const,orderId:'order',operationId:'first',actorUid:'employee',startedAt:'2026-10-12T00:00:00.000Z'};
 return {version:1,generation,recordedAt:generation.startedAt,jobId:orderRawBatchJobId(generation),legacyJobIds:[],business:{orderText:'original-order',lineId:'one',qty:2},plan:{unitKg:1},commands:[{command:{kind:'consume',companyId:'taebaek',rawItemId:'raw',operationId:'first-raw',effectiveAt:generation.startedAt,kg:2,materialSnapshot:'깨',source:{type:'production',id:'order'}}}]};
};
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
