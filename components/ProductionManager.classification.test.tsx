/** @vitest-environment jsdom */
import type React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Item } from '../types';
import ProductionManager from './ProductionManager';
it('생산 제목 뒤 행동과 조회를 두고 직접 입력 폼을 열어도 검색값과 writer는 유지한다',()=>{
 const add=vi.fn();render(<ProductionManager records={[]} orders={[]} items={[]} onAdd={add} onDelete={vi.fn()} onUpdate={vi.fn()}/>);
 const heading=screen.getByRole('heading',{name:'생산 실적'}),direct=screen.getByRole('button',{name:'직접 입력'}),search=screen.getByPlaceholderText('품목명/메모 검색');
 expect(heading.compareDocumentPosition(direct)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(direct.compareDocumentPosition(search)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(direct).toHaveClass('h-9');expect(search).toHaveClass('h-10');
 const query=screen.getByRole('region',{name:'검색조건'});expect([...query.querySelectorAll('[data-query-row]')].map(row=>row.getAttribute('data-query-row'))).toEqual(['date','condition','search']);expect(query.querySelector('[data-query-row="date"]')).toContainElement(screen.getByRole('button',{name:'이전달'}));expect(query).toContainElement(search);expect(screen.getByLabelText('전체 검색')).toBe(search);expect(screen.getByLabelText('품목')).toHaveClass('h-10');
 fireEvent.change(search,{target:{value:'검수 검색'}});fireEvent.click(direct);expect(screen.getByRole('heading',{name:'신규 생산 실적'})).toBeInTheDocument();expect(search).toHaveValue('검수 검색');expect(add).not.toHaveBeenCalled();
});

it('현재 품목 분류로 생산·반제품 선택을 제공하고 보관 품목은 제외한다', () => {
  const items = [
    { id: 'p', name: '현재 완제품', type: 'product' },
    { id: 'w', name: '현재 반제품', type: 'wip' },
    { id: 'a', name: '보관 완제품', type: 'product', archived: true },
    { id: 'r', name: '원료', type: 'raw' },
  ].map(item => ({ stock: 10, unit: '개', ...item })) as Item[];
  render(<ProductionManager records={[]} orders={[]} items={items}
    onAdd={vi.fn()} onDelete={vi.fn()} onUpdate={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '직접 입력' }));
  const products = within(screen.getByRole('combobox', { name: '생산 품목' }));
  const wip = within(screen.getByRole('combobox', { name: '투입 반제품' }));
  expect(products.getByRole('option', { name: '현재 완제품' })).toBeTruthy();
  expect(wip.getByRole('option', { name: '현재 반제품' })).toBeTruthy();
  expect(products.queryByRole('option', { name: '보관 완제품' })).toBeNull();
  expect(products.queryByRole('option', { name: '원료' })).toBeNull();
  expect(wip.queryByRole('option', { name: '현재 완제품' })).toBeNull();
});

it('생산 조회 초기화는 검색과 기간·품목 선택만 복원하고 직접 입력 writer를 호출하지 않는다',()=>{const add=vi.fn();render(<ProductionManager records={[]} orders={[]} items={[]} onAdd={add} onDelete={vi.fn()} onUpdate={vi.fn()}/>);const query=screen.getByRole('region',{name:'검색조건'}),search=screen.getByPlaceholderText('품목명/메모 검색');fireEvent.change(search,{target:{value:'조건'}});fireEvent.click(within(query).getByRole('button',{name:'전체'}));fireEvent.click(within(query).getByRole('button',{name:'초기화'}));expect(search).toHaveValue('');expect(within(query).getByRole('button',{name:'품목'})).toHaveTextContent('전체 품목');expect(add).not.toHaveBeenCalled();});

afterEach(()=>vi.useRealTimers());

it('생산일 기본은 월말까지이며 하루·전체·월이동·공용당월과 초기화가 요약과 목록에 함께 적용된다',()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-12T03:00:00Z'));
 const rows=['2026-09-30','2026-10-01','2026-10-12','2026-10-31','2026-11-01','2026-02-30','',undefined].map((date,i)=>({id:'date-'+i,date,itemId:'p',itemName:'날짜완제품',finishedQty:i+1,rawInputs:[],createdAt:'2026-10-12',note:'실적-'+i}));
 const add=vi.fn(),sync=vi.fn();render(<ProductionManager records={rows as React.ComponentProps<typeof ProductionManager>['records']} orders={[]} items={[{id:'p',name:'날짜완제품',type:'product',unit:'개',stock:0} as Item]} onAdd={add} onDelete={vi.fn()} onUpdate={sync}/>);
 const panel=screen.getByRole('region',{name:'검색조건'}),start=screen.getByLabelText('생산일 시작일'),end=screen.getByLabelText('생산일 종료일');
 expect(start).toHaveValue('2026-10-01');expect(end).toHaveValue('2026-10-31');expect(screen.getByText('실적-3')).toBeInTheDocument();expect(screen.queryByText('실적-4')).toBeNull();
 fireEvent.change(start,{target:{value:'2026-10-12'}});fireEvent.change(end,{target:{value:'2026-10-12'}});expect(screen.getByText('실적-2')).toBeInTheDocument();expect(screen.queryByText('실적-1')).toBeNull();expect(screen.queryByText('실적-3')).toBeNull();expect(screen.getByText('1종 · 합계 3개')).toBeInTheDocument();
 fireEvent.click(within(panel).getByRole('button',{name:'전체'}));expect(start).toHaveValue('');expect(end).toHaveValue('');expect(screen.getByText('실적-5')).toBeInTheDocument();expect(screen.getByText('실적-6')).toBeInTheDocument();expect(screen.getByText('실적-7')).toBeInTheDocument();
 fireEvent.click(within(panel).getByRole('button',{name:'이전달'}));expect(start).toHaveValue('2026-09-01');expect(end).toHaveValue('2026-09-30');expect(screen.getByText('실적-0')).toBeInTheDocument();
 fireEvent.click(within(panel).getByRole('button',{name:'다음달'}));expect(start).toHaveValue('2026-10-01');expect(end).toHaveValue('2026-10-31');
 fireEvent.click(within(panel).getByRole('button',{name:'이번 달'}));expect(end).toHaveValue('2026-10-12');expect(screen.queryByText('실적-3')).toBeNull();
 fireEvent.click(within(panel).getByRole('button',{name:'초기화'}));expect(end).toHaveValue('2026-10-31');expect(add).not.toHaveBeenCalled();expect(sync).not.toHaveBeenCalled();
});
