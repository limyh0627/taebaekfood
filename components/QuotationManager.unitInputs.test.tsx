/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import QuotationManager, { type Quotation, type QuotationLine } from './QuotationManager';
import { subscribeToCollection, addItem } from '../src/shared/services/firebaseService';
import { lineAmount } from '../src/shared/lineAmount';
import { quoteTotals } from '../src/shared/quoteTotals';
import { buildBomIndex, getBomIndex, setBomIndex } from '../src/shared/bomIndex';
import { buildPackIndex } from '../src/shared/packIndex';
import type { Item, Partner, PartnerItem } from '../src/shared/types';
vi.mock('../src/shared/services/firebaseService', () => ({ subscribeToCollection: vi.fn(() => () => {}), addItem: vi.fn(), deleteItem: vi.fn() }));
const original = getBomIndex(); afterEach(() => { setBomIndex(original); vi.mocked(subscribeToCollection).mockImplementation(() => () => {}); vi.mocked(addItem).mockClear(); });
const items = [{ id: 'box', name: '견적 박스', type: 'product', unit: '박스' }, { id: 'loose', name: '견적 낱개', type: 'product', unit: '병' }] as Item[];
const input = (count: number) => ({ bom: buildBomIndex(items, [{ parent_id: 'box', child_id: 'loose', quantity: count }]), pack: buildPackIndex([]) });
const partner = { id: 'client', name: '견적 거래처', type: '일반' } as Partner;
const prices = [{ id: 'price', itemId: 'loose', partnerId: 'client', Direction: 'out', price: 1000 }] as PartnerItem[];
const choose = (container: HTMLElement) => {
  const ui = within(container);
  fireEvent.click(ui.getByRole('button', { name: '견적서 작성' }));
  fireEvent.click(ui.getByRole('button', { name: '견적 거래처' }));
  fireEvent.click(ui.getByRole('button', { name: '1번째 줄 등록 품목에서 찾기' }));
  fireEvent.click(ui.getByRole('button', { name: /견적 박스/ }));
  return ui;
};
it('견적 실제 품목 선택의 박스 단가는 화면 회사 BOM으로 계산한다', () => {
  const a = input(20), b = input(6); setBomIndex(b.bom);
  const first = render(<QuotationManager items={items} partners={[partner]} partnerItems={prices} orderUnitInputs={a} />);
  expect(choose(first.container).getByDisplayValue('20000')).toBeInTheDocument();
  setBomIndex(a.bom);
  const second = render(<QuotationManager items={items} partners={[partner]} partnerItems={prices} orderUnitInputs={b} companyId="punghoe" />);
  expect(choose(second.container).getByDisplayValue('6000')).toBeInTheDocument();
  expect(getBomIndex()).toBe(a.bom);
});
it('등록된 양수 박스 단가가 우선이고 입력 생략은 기존 전역 fallback을 쓴다', () => {
  setBomIndex(input(6).bom);
  const direct = render(<QuotationManager items={items} partners={[partner]} partnerItems={[...prices, { id: 'direct', itemId: 'box', partnerId: 'client', Direction: 'out', price: 7777 } as PartnerItem]} orderUnitInputs={input(20)} />);
  expect(choose(direct.container).getByDisplayValue('7777')).toBeInTheDocument(); direct.unmount();
  const fallback = render(<QuotationManager items={items} partners={[partner]} partnerItems={prices} />);
  expect(choose(fallback.container).getByDisplayValue('6000')).toBeInTheDocument();
});

it.each([
  [2.5, '2.5'],
  [0.25, '0.25'],
  [0.0001, '0.0001'],
  [1.2345678901234567, '1.2345678901234567'],
  [20, '20'],
  [9007199254740991, '9,007,199,254,740,991'],
] as const)('저장된 견적 수량 %s를 인쇄할 때 소수와 유효자리를 보존한다', (qty, printedQty) => {
  const line: QuotationLine = { name: '인쇄 검증 원료', spec: '수량 보존', unit: 'kg', qty, price: 10000, isTaxExempt: true };
  const totals = quoteTotals([line]);
  const saved: Quotation = { id: 'saved-quote', companyId: 'taebaek', quoteNo: 'Q-20261015-001', date: '2026-10-15', partnerId: partner.id, partnerName: partner.name, lines: [line], totalSupply: totals.supply, totalTax: totals.tax, totalAmount: totals.total, createdAt: '2026-10-15T00:00:00Z' };
  const originalSaved = structuredClone(saved);
  vi.mocked(subscribeToCollection).mockImplementation((_name, onRows) => { onRows([saved]); return () => {}; });
  const view = render(<QuotationManager items={items} partners={[partner]} />);
  fireEvent.click(within(view.container).getByTitle('보기 · 인쇄'));
  const printed = view.container.querySelector('#quotation-print-document')!;
  const row = within(printed as HTMLElement).getByText(line.name).closest('tr')!;
  const cells = within(row).getAllByRole('cell');
  expect(cells[3].textContent).toBe(printedQty);
  expect(cells[4].textContent).toBe('kg');
  expect(cells[5].textContent).toBe('10,000');
  const amount = lineAmount(qty, 10000, true);
  expect(cells[6].textContent).toBe(Math.round(amount.supply).toLocaleString('ko-KR'));
  expect(cells[7].textContent).toBe('0');
  expect(totals.supply).toBe(amount.supply);
  expect(totals.total).toBe(amount.gross);
  if (qty === 2.5) expect(cells[6].textContent).toBe('25,000');
  expect(saved).toEqual(originalSaved);
  expect(addItem).not.toHaveBeenCalled();
  view.unmount();
});

it('견적 작성 행동은 검색보다 먼저 있고 검색 입력 후에도 새 작성 초안을 연다',()=>{
 const view=render(<QuotationManager items={items} partners={[partner]} partnerItems={prices}/>),ui=within(view.container),title=ui.getByRole('heading',{name:'견적서'}),create=ui.getByRole('button',{name:'견적서 작성'}),search=ui.getByRole('textbox',{name:'견적 검색'});
 expect(title.compareDocumentPosition(create)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(create.compareDocumentPosition(search)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(create.closest('[data-page-header-slot="actions"]')).not.toBeNull();fireEvent.change(search,{target:{value:'없는 견적'}});fireEvent.click(create);expect(ui.getByRole('dialog',{name:'견적서 작성'})).toBeInTheDocument();expect(addItem).not.toHaveBeenCalled();
});

it('견적일 양끝 포함 조회와 초기화는 회사 범위·원문·업무 쓰기를 보존한다',()=>{
 const rows=['2026-10-08','2026-10-09','2026-10-10','2026-02-30',''].map((date,i)=>({id:'date-'+i,companyId:'taebaek',quoteNo:'Q-DATE-'+i,date,partnerId:'client',partnerName:'날짜 거래처',lines:[],totalSupply:0,totalTax:0,totalAmount:0,createdAt:''} as Quotation));
 const foreign={...rows[1],id:'foreign',companyId:'punghoe',quoteNo:'Q-FOREIGN'} as Quotation,original=structuredClone(rows);
 vi.mocked(subscribeToCollection).mockImplementation((_name,onRows)=>{onRows([...rows,foreign]);return()=>{};});
 const view=render(<QuotationManager items={items} partners={[partner]}/>),ui=within(view.container);
 expect(ui.getByText('Q-DATE-3')).toBeTruthy();expect(ui.queryByText('Q-FOREIGN')).toBeNull();
 fireEvent.change(ui.getByLabelText('견적일 시작일'),{target:{value:'2026-10-09'}});fireEvent.change(ui.getByLabelText('견적일 종료일'),{target:{value:'2026-10-09'}});
 expect(ui.getByText('Q-DATE-1')).toBeTruthy();for(const i of [0,2,3,4])expect(ui.queryByText('Q-DATE-'+i)).toBeNull();
 fireEvent.click(ui.getByRole('button',{name:'초기화'}));expect(ui.getByText('Q-DATE-3')).toBeTruthy();expect(ui.getByText('Q-DATE-4')).toBeTruthy();expect(rows).toEqual(original);expect(addItem).not.toHaveBeenCalled();
});

it('견적 조회는 날짜 행 다음 검색 행을 두고 작성 버튼은 조회 패널 밖에 둔다',()=>{const view=render(<QuotationManager items={items} partners={[partner]}/>),ui=within(view.container),from=ui.getByLabelText('견적일 시작일'),search=ui.getByRole('textbox',{name:'견적 검색'}),dateRow=from.closest('[data-query-row="date"]'),searchRow=search.closest('[data-query-row="search"]');expect(dateRow).toBeTruthy();expect(searchRow).toBeTruthy();expect(dateRow!.compareDocumentPosition(searchRow!)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(search.closest('label')).toHaveClass('w-full','sm:max-w-sm');expect(ui.getByRole('button',{name:'견적서 작성'}).closest('[data-query-row]')).toBeNull();fireEvent.change(search,{target:{value:'없는견적'}});fireEvent.click(ui.getByRole('button',{name:'초기화'}));expect(search).toHaveValue('');expect(addItem).not.toHaveBeenCalled();});
