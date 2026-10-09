import {describe,it,expect} from 'vitest';
import {pendingReturnQuantityPatch} from './pendingReturnQuantity';
const update=[{itemId:'a',previousQuantity:2,quantity:3}];
const record={companyId:'taebaek',status:'pending',returnType:'매입',payableAccountCode:'253',totalAmount:110,items:[{itemId:'a',quantity:2,price:50,supply:100,tax:10,accountCode:'540'}]};
describe('반품 수량 최신 원문 비례 금액',()=>{
 it('명시 공급가·세액만 정확 비례하고 원접수 증명은 바꾸지 않는다',()=>{const original=structuredClone(record);expect(pendingReturnQuantityPatch(record,update,'taebaek')).toEqual({items:[{...record.items[0],quantity:3,supply:150,tax:15}],totalAmount:165});expect(record).toEqual(original);});
 it('linked 가격×수량 기존 정책을 유지한다',()=>{expect(pendingReturnQuantityPatch({...record,linkedStatementId:'source'},update,'taebaek').totalAmount).toBe(150);});
 it.each([{...record,status:'processed'},{...record,companyId:'punghoe'},{...record,items:[{...record.items[0],quantity:1}]},{...record,items:[{...record.items[0],tax:1}]}])('완료·회사·바뀐 수량·분수 원 금액은 거절한다',row=>{expect(()=>pendingReturnQuantityPatch(row,update,'taebaek')).toThrow();});
});
