import {expect,it} from 'vitest';
import {selectOrderCopyDraft,orderCopyHash} from './orderCopyCommands';
export const draft=()=>({id:'ORD-test',cardNo:'ORD-261014-001',partnerId:'partner',partnerName:'거래처',createdAt:'2026-10-14T00:00:00Z',deliveryDate:'2026-10-15T00:00:00Z',source:'일반',shipMethod:'배송',items:[{lineId:'line',itemId:'oil',name:'기름',quantity:40,price:2000,boxQuantity:2,unitsPerBox:20,isBoxUnit:true,orderedAs:'기름2박스'}],totalAmount:80000,pallets:[],deliveryBoxes:[]});
it('확정 수량·가격·박스 원문은 재계산 없이 독립 사본으로 보존한다',()=>{const input=draft(),copy=selectOrderCopyDraft(input);input.items[0].quantity=99;expect(copy.items[0].quantity).toBe(40);expect(copy.items[0].boxQuantity).toBe(2);expect(copy.totalAmount).toBe(80000);});
it.each(['status','inventoryOperation','purpose','shippedOut','companyId','createdBy','inventoryReservations'])('생산 권한 %s 주입을 거절한다',key=>expect(()=>selectOrderCopyDraft({...draft(),[key]:key==='status'?'DELIVERED':true})).toThrow());
it('중복 줄ID와 비정상 수량을 거절한다',()=>{const d=draft();expect(()=>selectOrderCopyDraft({...d,items:[...d.items,...d.items]})).toThrow();expect(()=>selectOrderCopyDraft({...d,items:[{...d.items[0],quantity:Infinity}]})).toThrow();});
it('원문 해시는 문자와 공백 차이를 보존한다',()=>expect(orderCopyHash('원문 ')).not.toBe(orderCopyHash('원문')));
it.each([1,null,'2026-02-30T00:00:00.000Z','2026-10-14','2026-10-14T25:00:00Z'])('주문 날짜 %s는 최초 저장 계약에서 거절한다',value=>{for(const key of ['createdAt','deliveryDate'])expect(()=>selectOrderCopyDraft({...draft(),[key]:value})).toThrow('날짜');});
