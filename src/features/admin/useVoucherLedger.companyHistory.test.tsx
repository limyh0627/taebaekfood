/** @vitest-environment jsdom */
import React from 'react';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useVoucherLedger, type VoucherLedgerInput } from './useVoucherLedger';
import TradeStatement from '../../../components/TradeStatement';
import type { CompanyId, IssuedStatement } from '../../shared/types';
import { openingDocId } from '../../shared/types';
import type { PartnerAnchor } from './partnerAnchor';
import {planAdvanceApplication} from '../../shared/partnerAdvance';
const service = vi.hoisted(() => ({ fetchDateRange: vi.fn(), fetchByIds: vi.fn(), fetchWhere: vi.fn(), fetchCollection: vi.fn() }));
vi.mock('../../shared/services/firebaseService', () => service);
vi.mock('../../../components/CashLedger', () => ({ AccountModal: () => null }));
vi.mock('../../../components/voucher/VoucherComposer', () => ({ default: () => null }));
const input = (companyId: CompanyId): VoucherLedgerInput => ({ companyId, issuedStatements: [], cashEntries: [], settlements: [], accountCodes: [], histFrom: '2026-08-01', histTo: '2026-08-31' });
const pending = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const statement = (companyId: CompanyId, id = 'same'): IssuedStatement => ({ id, docNo: '합성260820-001', companyId, tradeDate: '2026-08-20', issuedAt: '2026-08-20T00:00:00Z', type: '매출', partnerId: 'partner', partnerName: companyId, orderId: '', items: [], totalSupply: 100, totalTax: 0, totalAmount: 100 });
const anchor = (companyId: CompanyId, receivable: number): PartnerAnchor => ({ id: companyId, companyId, year: '2025', asOf: '2025-12-31', recordedAt: '2026-01-01', rows: [{ partnerId: 'partner', receivable, payable: 0, openStmts: [] }] });
it('비용형 미지급 원전표도 적용 후 남은 금액을 실제 전표 hook에서 읽는다',async()=>{
 const source={collection:'cashEntries' as const,id:'cash',lineKey:'133'};
 const target:IssuedStatement={...statement('taebaek','target'),type:'비용',totalAmount:100,items:[{name:'비용',spec:'',isTaxExempt:true,qty:1,price:100,supply:100,tax:0,total:100,accountCode:'500',side:'차변'},{name:'미지급금',spec:'',isTaxExempt:true,qty:1,price:100,supply:100,tax:0,total:100,accountCode:'253',side:'대변'}]};
 const plan=planAdvanceApplication({companyId:'taebaek',partnerId:'partner',complete:true,unattributedReduction:false,blockedSourceKeys:[],sources:[{key:source,companyId:'taebaek',partnerId:'partner',code:'133',originalAmount:100,date:'2026-08-01',fingerprint:'s',purpose:'pair'}],targets:[{statementId:'target',companyId:'taebaek',partnerId:'partner',accountCode:'253',remaining:100,date:'2026-08-20',fingerprint:'t',purpose:'pair'}],priorSourceUse:new Map()}, {operationId:'apply',date:'2026-08-21',purpose:'pair',allocations:[{source,statementId:'target',accountCode:'253',amount:60}]});
 const applied:IssuedStatement={...target,id:'application',tradeDate:'2026-08-21',totalAmount:60,totalSupply:60,items:plan.items.map(item=>({...item,isTaxExempt:true})),noncashApplication:plan.metadata};
 const view=renderHook(useVoucherLedger,{initialProps:{...input('taebaek'),issuedStatements:[target,applied],advanceStatements:[applied]}});
 await act(async()=>{});expect(view.result.current.getBalance(target)).toBe(40);
});
beforeEach(() => {
  service.fetchDateRange.mockReset().mockResolvedValue([]); service.fetchByIds.mockReset().mockResolvedValue([]);
  service.fetchWhere.mockReset().mockResolvedValue([]); service.fetchCollection.mockReset().mockResolvedValue([]);
});
it('실제 전표 화면 caller의 과거 조회는 회사 조건을 전달한다', async () => {
  render(<TradeStatement companyId="punghoe" orders={[]} allItems={[]} partners={[]} partnerItems={[]} issuedStatements={[]} onAddIssuedStatement={vi.fn()} />);
  await waitFor(() => expect(service.fetchDateRange).toHaveBeenCalled());
  for (const call of service.fetchDateRange.mock.calls) {
    const constraints = call[4];
    expect(constraints?.some((constraint: { _op?: string; _value?: string }) => constraint._op === '==' && constraint._value === 'punghoe')).toBe(true);
  }
});
it('이전 회사 앵커의 늦은 응답이 새 회사 잔액을 덮지 않는다', async () => {
  const a = pending<PartnerAnchor[]>(), b = pending<PartnerAnchor[]>();
  service.fetchWhere.mockImplementation((name, _field, company) => name === 'partnerBalanceSnapshots' ? (company === 'taebaek' ? a.promise : b.promise) : Promise.resolve([]));
  const view = renderHook(useVoucherLedger, { initialProps: input('taebaek') }); view.rerender(input('punghoe'));
  await act(async () => b.resolve([anchor('punghoe', 300)]));
  expect(view.result.current.partnerBalances.get('partner')?.receivable).toBe(300);
  await act(async () => a.resolve([anchor('taebaek', 800)]));
  expect(view.result.current.partnerBalances.get('partner')?.receivable).toBe(300);
});
it('앵커 미결 전표 ID 조회에 현재 회사를 명시한다', async () => {
  const saved = anchor('punghoe', 300);
  saved.rows[0].openStmts = [{ id: 'old-open', date: '2025-12-01', type: '매출', remaining: 300 }];
  service.fetchWhere.mockImplementation(async name => name === 'partnerBalanceSnapshots' ? [saved] : []);
  renderHook(useVoucherLedger, { initialProps: input('punghoe') });
  await waitFor(() => expect(service.fetchByIds).toHaveBeenCalledWith('issuedStatements', ['old-open'], 'punghoe'));
});
it('이전 회사 기초일 응답은 새 회사 조회 시작일을 바꾸지 않는다', async () => {
  const a = pending<Array<{ id: string; date: string }>>(), b = pending<Array<{ id: string; date: string }>>();
  service.fetchWhere.mockImplementation((name, _field, company) => name === 'openingBalances' ? (company === 'taebaek' ? a.promise : b.promise) : Promise.resolve([]));
  const view = renderHook(useVoucherLedger, { initialProps: input('taebaek') }); view.rerender(input('punghoe'));
  await act(async () => b.resolve([{ id: openingDocId('punghoe'), date: '2026-07-31' }]));
  service.fetchDateRange.mockClear();
  await act(async () => a.resolve([{ id: openingDocId('taebaek'), date: '2026-06-30' }]));
  expect(service.fetchDateRange.mock.calls.some(call => call[2] === '2026-06-30')).toBe(false);
});
it('회사 전환은 같은 기간을 다시 조회하고 늦은 동일ID 전표가 현재 전표를 지우지 않는다', async () => {
  const requests: Array<{ resolve: (rows: Issed[]) => void; promise: Promise<Issed[]> }> = [];
  type Issed = IssuedStatement;
  service.fetchDateRange.mockImplementation(() => { const request = pending<Issed[]>(); requests.push(request); return request.promise; });
  const view = renderHook(useVoucherLedger, { initialProps: input('taebaek') }); const previous = [...requests];
  view.rerender(input('punghoe')); const current = requests.slice(previous.length);
  expect(current.length).toBeGreaterThan(0);
  await act(async () => { current.forEach(request => request.resolve([statement('punghoe')])); });
  expect(view.result.current.mergedStatements).toMatchObject([{ companyId: 'punghoe' }]);
  await act(async () => { previous.forEach(request => request.resolve([statement('taebaek')])); });
  expect(view.result.current.mergedStatements).toMatchObject([{ companyId: 'punghoe' }]);
});
it('같은 회사 기간 축소는 적재 자료·삭제 표식을 보존하고 회사 전환은 삭제 표식을 격리한다', async () => {
  let company: CompanyId = 'taebaek'; service.fetchDateRange.mockImplementation(async () => [statement(company)]);
  const view = renderHook(useVoucherLedger, { initialProps: input(company) }); await act(async () => {});
  act(() => view.result.current.forgetStatement('same')); expect(view.result.current.mergedStatements).toEqual([]);
  view.rerender({ ...input(company), histFrom: '2026-10-07', histTo: '2026-10-07' }); await act(async () => {});
  expect(view.result.current.mergedStatements).toEqual([]);
  company = 'punghoe'; view.rerender(input(company)); await act(async () => {});
  expect(view.result.current.mergedStatements).toMatchObject([{ companyId: 'punghoe' }]);
});
