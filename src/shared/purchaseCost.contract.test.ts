import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { costFromPurchaseLine as appCost } from './lineAmount';
import { costFromPurchaseLine as sharedCost } from '../../functions/src/shared/purchaseCost';
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
