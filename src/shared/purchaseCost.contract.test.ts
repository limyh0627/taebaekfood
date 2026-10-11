import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { costFromPurchaseLine as appCost } from './lineAmount';
import { costFromPurchaseLine as sharedCost, costFromPurchaseLines, isRawPurchaseItem } from '../../functions/src/shared/purchaseCost';
// 실제 서버 소비자의 계산 선언을 실행하여 정책 배선까지 검증한다.
const source = readFileSync('functions/src/tradeStatementIssue.ts', 'utf8');
const declaration = source.match(/const purchaseCost = ([\s\S]*?);\r?\nconst oldCompany/)!;
const serverCost = new Function('costFromPurchaseLine', 'return ' + declaration[1].replace(': Row', ''))(sharedCost);
describe('앱·서버 매입원가 공용 계산', () => {
  it('앱은 공용 본체를 그대로 사용한다', () => expect(appCost).toBe(sharedCost));
  it.each([{qty:7,supply:6809,price:1070},{qty:3,supply:0,price:100},{qty:0.125,supply:123,price:1082}])('발행 공급가와 양수 수량을 우선한다 %j', line => {
    expect(appCost(line)).toBe(Math.round(line.supply / line.qty));
    expect(serverCost(line)).toBe(appCost(line));
  });
  it('유효 음수 수량·소수 단가의 기존 fallback 차이를 보존한다', () => {
    const line = {qty:-1,price:2.6,supply:-3,tax:0,total:-3};
    expect(appCost(line)).toBe(3);
    expect(serverCost(line)).toBe(2);
    expect(appCost({...line,isTaxExempt:true})).toBe(3);
    expect(serverCost({...line,isTaxExempt:true})).toBe(3);
  });
  it('구형 누락 공급가는 단가로 계산하며 단가가 없으면 null이다', () => {
    expect(appCost({qty:2,price:1100})).toBe(1000);
    expect(serverCost({qty:0,price:1100})).toBe(1000);
    expect(appCost({})).toBeNull();
    expect(serverCost({price:0})).toBeNull();
  });
});

it('신규 명시 kg는 거래 수량과 별개의 원가 분모이고 앱/서버가 일치한다', () => {
  const line = { qty: 2, price: 22000, supply: 40000, purchaseQuantityKg: 40 };
  expect(appCost(line)).toBe(1000); expect(serverCost(line)).toBe(1000);
  expect(appCost({ ...line, purchaseQuantityKg: 20 })).toBe(2000);
  expect(appCost({ qty: 2, price: 22000, supply: 40000 })).toBe(20000);
  for (const kg of [0, -1, NaN, Infinity]) expect(appCost({ ...line, purchaseQuantityKg: kg })).toBeNull();
});

it('명시 kg 원가는 현재 kg mirror 홀더만 허용한다', () => {
  expect(isRawPurchaseItem({subtype:'벌크'})).toBe(true);
  expect(isRawPurchaseItem({subtype:'낱개'})).toBe(false);
  expect(isRawPurchaseItem({subtype:'벌크',phantom:true})).toBe(false);
  expect(isRawPurchaseItem({subtype:'벌크',archived:true})).toBe(false);
});

it.each([20, 22.5, 25])('등록 포장 %skg의 원가 분모는 거래 qty가 아닌 저장 kg이다', unitKg => {
  const line = {purchaseUnitId:'registered',purchaseUnit:'포',purchaseQty:2,unitKg,inventoryQty:2*unitKg,qty:2,price:22000,supply:40000};
  expect(appCost(line)).toBe(Math.round(40000/(2*unitKg))); expect(serverCost(line)).toBe(appCost(line));
  expect(appCost({...line,purchaseQuantityKg:2*unitKg})).toBe(appCost(line));
  expect(appCost({...line,purchaseQuantityKg:10})).toBeNull();
});
it('부분 매입단위와 잘못된 확정 kg는 기존 거래수량 원가로 fallback하지 않는다',()=>{
  expect(appCost({qty:2,supply:40000,purchaseUnitId:'registered'})).toBeNull();
  expect(appCost({qty:2,supply:40000,purchaseUnitId:'registered',purchaseUnit:'포',purchaseQty:2,unitKg:20,inventoryQty:39})).toBeNull();
});

it('혼합 포장 원가는 공급가 합계/확인 kg 합계이며 미확인 줄을 합치지 않는다',()=>{
 const line=(unitKg:number,supply:number)=>({qty:1,supply,price:supply,purchaseUnitId:`u${unitKg}`,purchaseUnit:'포',purchaseQty:1,unitKg,inventoryQty:unitKg});
 expect(costFromPurchaseLines([line(20,20000),line(25,25000)])).toBe(1000);
 expect(costFromPurchaseLines([line(20,20000),{qty:1,supply:25000,price:25000}])).toBeNull();
});
