import { describe, expect, it, vi } from 'vitest';
import { OrderStatus, type Order, type OrderItem, type OrderItemInventoryState } from '../../../shared/types';
import { primaryCommitted } from '../../../shared/saveOutcome';
import { saveOrderEdit, type OrderEditDraft } from './orderEditService';

const line = (patch: Partial<OrderItem> = {}): OrderItem => ({itemId:'oil',lineId:'oil-line',name:'참기름',quantity:1,price:100,checked:false,...patch});
const appliedInventory = (): Record<string,OrderItemInventoryState> => ({'oil-line':{
 version:1,lineId:'oil-line',itemId:'oil',applied:true,attempt:1,rawConsumedLots:[],autoBuilt:[],producedUnits:[],
 production:{capturedAt:'2025-02-01T00:00:00Z',stockDeltas:[],bomLines:[]},
}});
const order = (patch: Partial<Order> = {}): Order => ({
 id:'order',companyId:'taebaek',partnerName:'합성 거래처',items:[line()],totalAmount:100,
 status:OrderStatus.PENDING,createdAt:'2025-02-01',deliveryDate:'2025-02-03T03:00:00Z',email:'',source:'일반',note:'기존 비고',...patch,
});
const draft = (patch: Partial<OrderEditDraft> = {}): OrderEditDraft => ({deliveryDate:'2025-02-03T00:00:00Z',items:[line({quantity:2})],note:'새 비고',noteImportant:true,...patch});
function deferred<T>() { let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve}; }
function harness(source = order()) {
 let current=true;
 const ports={isCurrent:()=>current,confirm:vi.fn(async()=>true),saveOrderPatch:vi.fn(async(_id:string,_patch:Partial<Order>)=>{}),appendItemHistory:vi.fn(async()=>{}),now:()=> '2025-02-02T01:00:00Z'};
 const input={order:source,companyId:'taebaek' as const,actorUid:'actor',actorName:'직원'};
 return {ports,input,stop:()=>{current=false;},save:(value=draft())=>saveOrderEdit({...input,edit:{kind:'draft',draft:value}},ports)};
}
describe('주문 수정 application 계약',()=>{
 it.each([[],[line({itemId:' '})],[line({quantity:0})],[line({quantity:-1})],[line({quantity:NaN})],[line({quantity:Infinity})],[line({isBoxUnit:true,boxQuantity:0})],[line({isBoxUnit:true,boxQuantity:NaN})]].map(items=>({items})))('전체 초안의 미선택·비유한·양수가 아닌 수량은 저장 전에 거절한다: $items',async({items})=>{
  const h=harness();expect((await h.save(draft({items}))).status).toBe('rejected');expect(h.ports.saveOrderPatch).not.toHaveBeenCalled();expect(h.ports.appendItemHistory).not.toHaveBeenCalled();
 });
 it('items 전용의 빈 배열·0·음수 기존 경로는 보존하고 비유한값·빈 ID만 거절한다',async()=>{
  for(const items of [[],[line({quantity:0})],[line({quantity:-1})]]){
   const h=harness();expect((await saveOrderEdit({...h.input,edit:{kind:'items',items}},h.ports)).status).toBe('saved');expect(h.ports.saveOrderPatch).toHaveBeenCalledOnce();
  }
  for(const items of [[line({quantity:NaN})],[line({itemId:''})]]){
   const h=harness();expect((await saveOrderEdit({...h.input,edit:{kind:'items',items}},h.ports)).status).toBe('rejected');expect(h.ports.saveOrderPatch).not.toHaveBeenCalled();
  }
 });
 it('박스 초안은 박스 수를 검증하고 원 낱개·박스 수량을 다시 계산하지 않는다',async()=>{
  const h=harness(),item=line({isBoxUnit:true,quantity:24,boxQuantity:2,unitsPerBox:12});expect((await h.save(draft({items:[item]}))).status).toBe('saved');
  expect(h.ports.saveOrderPatch.mock.calls[0][1].items?.[0]).toMatchObject({quantity:24,boxQuantity:2,unitsPerBox:12});
 });
 it('같은 출고일의 시각은 보존하고 날짜·품목·비고를 한 patch로 저장한 뒤에만 이력을 쓴다',async()=>{
  const h=harness(),ack=deferred<void>();h.ports.saveOrderPatch.mockImplementation(()=>ack.promise);
  const result=h.save();await Promise.resolve();
  expect(h.ports.saveOrderPatch).toHaveBeenCalledExactlyOnceWith('order',expect.objectContaining({items:[line({quantity:2})],note:'새 비고',noteImportant:true,noteBy:'직원',noteAt:'2025-02-02T01:00:00Z',status:OrderStatus.PENDING}));
  expect(h.ports.saveOrderPatch.mock.calls[0][1]).not.toHaveProperty('deliveryDate');expect(h.ports.appendItemHistory).not.toHaveBeenCalled();
  ack.resolve();expect(await result).toEqual({status:'saved'});
  expect(h.ports.appendItemHistory).toHaveBeenCalledWith(expect.objectContaining({orderId:'order',by:'직원',changes:[expect.stringContaining('1')] }));
 });
 it('다른 날만 날짜를 보내고 변경 없는 비고에는 새 작성자·시각을 찍지 않는다',async()=>{
  const h=harness();await h.save(draft({deliveryDate:'2025-02-04T00:00:00Z',note:'기존 비고',noteImportant:false}));
  expect(h.ports.saveOrderPatch.mock.calls[0][1]).toHaveProperty('deliveryDate','2025-02-04T00:00:00Z');
  expect(h.ports.saveOrderPatch.mock.calls[0][1]).not.toHaveProperty('noteBy');expect(h.ports.saveOrderPatch.mock.calls[0][1]).not.toHaveProperty('noteAt');
 });
 it.each(['2025-02-30','2025-13-01'])('잘못된 날짜 %s와 다른 회사 주문은 전송 전에 거절한다',async date=>{
  const h=harness();expect((await h.save(draft({deliveryDate:date}))).status).toBe('rejected');
  expect((await saveOrderEdit({...h.input,companyId:'punghoe',edit:{kind:'items',items:[line()]}},h.ports)).status).toBe('rejected');
  expect(h.ports.saveOrderPatch).not.toHaveBeenCalled();expect(h.ports.appendItemHistory).not.toHaveBeenCalled();
 });
 it('이미 재고 처리한 줄의 수량은 전체 초안에서도 막고 비고·날짜를 따로 쓰지 않는다',async()=>{
  const h=harness(order({items:[line({checked:true})],status:OrderStatus.DISPATCHED,itemInventory:appliedInventory()}));
  const result=await h.save(draft({items:[line({checked:true,quantity:2})]}));
  expect(result.status).toBe('rejected');expect(h.ports.confirm).not.toHaveBeenCalled();expect(h.ports.saveOrderPatch).not.toHaveBeenCalled();
 });
 it('완료 줄은 유지한 채 새 줄을 더하면 확인을 받고 작업중으로 돌아가며 재고 사본은 쓰지 않는다',async()=>{
  const old=line({checked:true}),added=line({itemId:'new',lineId:'new-line',name:'새 품목',quantity:2});
  const h=harness(order({items:[old],status:OrderStatus.DISPATCHED,itemInventory:appliedInventory()}));
  expect((await h.save(draft({items:[old,added]}))).status).toBe('saved');expect(h.ports.confirm).toHaveBeenCalledOnce();
  const patch=h.ports.saveOrderPatch.mock.calls[0][1];expect(patch).toMatchObject({items:[old,added],status:OrderStatus.PROCESSING});expect(patch).not.toHaveProperty('itemInventory');expect(patch).not.toHaveProperty('productConsumedLots');
 });
 it('추가 확인 취소와 확인 중 회사·로그인 변경은 어떤 업무나 이력도 쓰지 않는다',async()=>{
  for(const mode of ['cancel','scope']){
   const h=harness(order({status:OrderStatus.DISPATCHED,itemInventory:{}})),confirm=deferred<boolean>();h.ports.confirm.mockImplementation(()=>confirm.promise);
   const waiting=h.save(draft({items:[line(),line({itemId:'new',lineId:'new'})]}));if(mode==='scope')h.stop();confirm.resolve(mode!=='cancel');
   expect((await waiting).status).toBe('cancelled');expect(h.ports.saveOrderPatch).not.toHaveBeenCalled();expect(h.ports.appendItemHistory).not.toHaveBeenCalled();
  }
 });
 it('확인창 예외는 아직 저장하지 않은 거절로 안내하고 업무 결과 미확정으로 포장하지 않는다',async()=>{
  const h=harness(order({status:OrderStatus.DISPATCHED,itemInventory:{}}));h.ports.confirm.mockRejectedValue(new Error('dialog'));
  const result=await h.save(draft({items:[line(),line({itemId:'new',lineId:'new'})]}));
  expect(result).toMatchObject({status:'rejected',message:expect.stringContaining('저장하지 않았습니다'),nextAction:expect.stringContaining('다시 저장')});expect(h.ports.saveOrderPatch).not.toHaveBeenCalled();expect(h.ports.appendItemHistory).not.toHaveBeenCalled();
 });
 it('라벨 변경은 완료 품목에도 허용하고 해당 줄만 사람·시각을 찍으며 수량 이력을 만들지 않는다',async()=>{
  const original=line({checked:true,labelType:'대기'}),h=harness(order({items:[original],status:OrderStatus.DISPATCHED,itemInventory:appliedInventory()}));
  const before=JSON.stringify(h.input.order);const result=await saveOrderEdit({...h.input,edit:{kind:'items',items:[{...original,labelType:'날인'}]}},h.ports);
  expect(result.status).toBe('saved');expect(h.ports.saveOrderPatch.mock.calls[0][1].items?.[0]).toMatchObject({labelBy:'직원',labelAt:'2025-02-02T01:00:00Z',checked:true});
  expect(h.ports.appendItemHistory).not.toHaveBeenCalled();expect(JSON.stringify(h.input.order)).toBe(before);
 });
 it('업무 ACK를 받지 못하면 결과 미확정으로 초안 확인을 안내하고 이력·재전송을 하지 않는다',async()=>{
  const h=harness();h.ports.saveOrderPatch.mockRejectedValue(new Error('network'));
  const result=await h.save();expect(result).toMatchObject({status:'unknown',nextAction:expect.stringContaining('현재 주문을 확인')});expect(primaryCommitted(result,'order')).toBe(false);
  expect(h.ports.saveOrderPatch).toHaveBeenCalledOnce();expect(h.ports.appendItemHistory).not.toHaveBeenCalled();
 });
 it('업무 ACK 뒤 이력 응답 실패는 부분 완료이며 업무·이력을 자동 재시도하지 않는다',async()=>{
  const h=harness();h.ports.appendItemHistory.mockRejectedValue(new Error('audit response lost'));
  const result=await h.save();expect(result).toMatchObject({status:'partial',reason:'followup-unconfirmed',committedIds:['order'],unconfirmedIds:[],nextAction:expect.stringContaining('주문을 다시 저장하지 말고')});
  expect(primaryCommitted(result,'order')).toBe(true);expect(h.ports.saveOrderPatch).toHaveBeenCalledOnce();expect(h.ports.appendItemHistory).toHaveBeenCalledOnce();
 });
 it('업무 ACK 전 로그인 변경은 저장 완료를 잃지 않고 새 신원으로 이력을 쓰지 않는다',async()=>{
  const h=harness(),ack=deferred<void>();h.ports.saveOrderPatch.mockImplementation(()=>ack.promise);
  const pending=h.save();await Promise.resolve();h.stop();ack.resolve();const result=await pending;
  expect(primaryCommitted(result,'order')).toBe(true);expect(h.ports.appendItemHistory).not.toHaveBeenCalled();expect(h.ports.saveOrderPatch).toHaveBeenCalledOnce();
 });
});
