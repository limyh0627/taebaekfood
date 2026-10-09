import { describe, expect, it } from 'vitest';
import { planReturnAllocation, prepareStandaloneReturn, type ReturnAllocationInput } from './returnAllocationPlan';

const base: ReturnAllocationInput = {
  returnId: 'r1', companyId: 'c', partnerId: 'p', direction: '입금', amount: 90,
  claims: [
    { id: 'b', companyId: 'c', partnerId: 'p', direction: '입금', tradeDate: '2026-10-01', amount: 100, cashApplied: 30 },
    { id: 'a', companyId: 'c', partnerId: 'p', direction: '입금', tradeDate: '2026-10-01', amount: 50, cashApplied: 0 },
  ], priorAllocations: [{ returnId: 'old', statementId: 'a', amount: 20 }],
};

describe('noncash return allocation', () => {
  it('uses date and ID FIFO, subtracting cash and prior returns without creating settlements', () => {
    expect(planReturnAllocation(base)).toEqual({
      allocations: [{ statementId: 'a', amount: 30 }, { statementId: 'b', amount: 60 }],
      unappliedAmount: 0,
    });
  });

  it('uses an explicit source first, then other open claims in FIFO order', () => {
    expect(planReturnAllocation({ ...base, linkedStatementId: 'b', amount: 90 })).toEqual({
      allocations: [{ statementId: 'b', amount: 70 }, { statementId: 'a', amount: 20 }], unappliedAmount: 0,
    });
    expect(planReturnAllocation({ ...base, linkedStatementId: 'b', amount: 120 })).toEqual({
      allocations: [{ statementId: 'b', amount: 70 }, { statementId: 'a', amount: 30 }], unappliedAmount: 20,
    });
  });

  it('rejects scope, malformed amounts, overspent snapshots, and ambiguous same-ID retries', () => {
    for (const bad of [
      { claims: [{ ...base.claims[0], companyId: 'other' }] },
      { claims: [{ ...base.claims[0], direction: '출금' }] },
      { claims: [{ ...base.claims[0], cashApplied: 101 }] },
      { priorAllocations: [{ returnId: 'old', statementId: 'a', amount: 51 }] },
      { linkedStatementId: 'missing' },
    ]) expect(() => planReturnAllocation({ ...base, ...bad } as ReturnAllocationInput)).toThrow();
    const priorAllocations = [...base.priorAllocations, { returnId: 'r1', statementId: 'b', amount: 60 }];
    expect(() => planReturnAllocation({ ...base, priorAllocations })).toThrow('operation ledger');
    expect(() => planReturnAllocation({ ...base, amount: 100, priorAllocations })).toThrow('operation ledger');
  });
});

// 물품의 과거 단가 FIFO가 아니라 명시 반품 금액의 비현금 미결 배분 계약이다.
describe('원전표 미지정 반품 준비',()=>{
 const request={returnType:'매출' as const,totalAmount:110,items:[{itemId:'sku',quantity:2,supply:100,tax:10,accountCode:'401',isResellable:true}]};
 const input={returnId:'new',companyId:'taebaek',partnerId:'p',request,claims:[
  {id:'later',companyId:'taebaek',partnerId:'p',direction:'입금' as const,accountCode:'108',tradeDate:'2026-10-02',amount:100,cashApplied:0},
  {id:'early',companyId:'taebaek',partnerId:'p',direction:'입금' as const,accountCode:'108',tradeDate:'2026-10-01',amount:100,cashApplied:60}],priorAllocations:[{returnId:'old',statementId:'early',amount:10}]};
 it('원전표 없이도 명시 공급가·세액의 역분개와 같은 방향 FIFO를 준비한다',()=>{
  const result=prepareStandaloneReturn(input);
  expect(result.allocations).toEqual([{statementId:'early',amount:30},{statementId:'later',amount:80}]);
  expect(result).toMatchObject({amount:110,supply:100,tax:10,unappliedAmount:0,stockEffects:[{itemId:'sku',quantityDelta:2}]});
  expect(result.journalLines).toEqual([{accountCode:'401',side:'차변',amount:100},{accountCode:'255',side:'차변',amount:10},{accountCode:'108',side:'대변',amount:110}]);
 });
 it('매입 253은 출금 방향의 253 미결에만 적용하고 실물 수량은 감소한다',()=>{
  const result=prepareStandaloneReturn({...input,request:{...request,returnType:'매입',payableAccountCode:'253',items:[{...request.items[0],accountCode:'540',isResellable:false}]},claims:input.claims.map(c=>({...c,direction:'출금',accountCode:'253'}))});
  expect(result.allocations).toEqual([{statementId:'early',amount:30},{statementId:'later',amount:80}]);
  expect(result.stockEffects).toEqual([{itemId:'sku',quantityDelta:-2}]);expect(result.journalLines).toContainEqual({accountCode:'253',side:'차변',amount:110});
 });
 it('미결 초과 금액은 현금으로 바꾸지 않고 unappliedAmount로 남긴다',()=>{
  expect(prepareStandaloneReturn({...input,claims:[input.claims[1]]})).toMatchObject({allocations:[{statementId:'early',amount:30}],unappliedAmount:80});
  expect(prepareStandaloneReturn({...input,claims:[],priorAllocations:[]})).toMatchObject({allocations:[],unappliedAmount:110});
 });
 it('지정 미결은 우선하되 역분개 공급가·세액의 근거를 바꾸지 않는다',()=>{
  expect(prepareStandaloneReturn({...input,linkedStatementId:'later'})).toMatchObject({supply:100,tax:10,allocations:[{statementId:'later',amount:100},{statementId:'early',amount:10}]});
 });
 it('회사·거래처·방향·251/253 교차·합계 오류와 기처리 재시도를 거절한다',()=>{
  for(const patch of [{companyId:'punghoe'},{partnerId:'other'},{direction:'출금' as const},{accountCode:'253'}])expect(()=>prepareStandaloneReturn({...input,claims:[{...input.claims[0],...patch}],priorAllocations:[]})).toThrow();
  expect(()=>prepareStandaloneReturn({...input,request:{...request,totalAmount:111}})).toThrow('합계');
  expect(()=>prepareStandaloneReturn({...input,priorAllocations:[{returnId:'new',statementId:'early',amount:1}]})).toThrow('operation ledger');
  const purchase={...input,request:{...request,returnType:'매입' as const,payableAccountCode:'253'},claims:input.claims.map(c=>({...c,direction:'출금' as const,accountCode:'251'}))};
  expect(()=>prepareStandaloneReturn(purchase)).toThrow('계정');
 });
 it('준비 계산은 요청·원전표·기존 배분 원문을 바꾸지 않는다',()=>{const before=JSON.stringify(input);prepareStandaloneReturn(input);expect(JSON.stringify(input)).toBe(before);});
});
