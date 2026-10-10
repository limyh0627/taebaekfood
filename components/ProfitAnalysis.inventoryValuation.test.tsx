/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ProfitAnalysis from './ProfitAnalysis';
import type { Item } from '../src/shared/types';
import { today } from '../src/shared/day';

vi.mock('../src/shared/services/firebaseService', () => ({ fetchWhere: vi.fn().mockResolvedValue([]) }));
afterEach(cleanup);
const item = (id: string, cost: number, extra: Partial<Item> = {}): Item => ({ id, name: id, type: 'raw', stock: 1, cost, ...extra } as Item);
const props = { issuedStatements: [], cashEntries: [], initialTab: 'inventory-value' as const };

it('BOM 추정과 달라도 저장 원가를 회사 합산 후 한 번 반올림하여 기록한다', () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const items = [item('a', .6), item('b', .6), item('other', 999, { companyId: 'punghoe' })];
  const view = render(<ProfitAnalysis {...props} items={items} costOf={() => 100} onSaveInventorySnapshot={save} />);
  fireEvent.click(screen.getByRole('button', { name: '기말재고 기록' }));
  expect(save.mock.calls[0][0]).toMatchObject({ value: 1, items: [{ itemId: 'a', value: .6 }, { itemId: 'b', value: .6 }] });
  view.rerender(<ProfitAnalysis {...props} items={items.map(p => p.id === 'other' ? p : { ...p, cost: 100 })} costOf={() => 100} onSaveInventorySnapshot={save} />);
  fireEvent.click(screen.getByRole('button', { name: '기말재고 기록' }));
  expect(save.mock.calls[1][0].value).toBe(200);
});

it('서버 장부 범위처럼 음수와 용역을 포함하고 다른 회사 오류는 제외한다', () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<ProfitAnalysis {...props} companyId="punghoe" items={[
    item('negative', 3, { companyId: 'punghoe', stock: -2 }),
    item('service', 10, { companyId: 'punghoe', type: 'service' }),
    item('invalid-other', NaN),
  ]} onSaveInventorySnapshot={save} />);
  fireEvent.click(screen.getByRole('button', { name: '기말재고 기록' }));
  expect(save.mock.calls[0][0]).toMatchObject({ value: 4, items: [{ itemId: 'negative', value: -6 }, { itemId: 'service', value: 10 }] });
});

it('현재 회사의 유효하지 않은 금액은 기록하지 않는다', () => {
  const save = vi.fn();
  render(<ProfitAnalysis {...props} items={[item('invalid', NaN)]} onSaveInventorySnapshot={save} />);
  expect(screen.getByRole('button', { name: '기말재고 기록' })).toBeDisabled();
  expect(screen.getByText(/재고평가 입력 오류/)).toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
});

it('미확인 원가의 0원 계약과 명시적 수동 덮어쓰기를 유지한다', () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<ProfitAnalysis {...props} items={[item('unknown', 0)]}
    inventorySnapshots={[{ id: 'existing', yearMonth: today().slice(0, 7), value: 99, recordedAt: '2026-10-01' }]}
    onSaveInventorySnapshot={save} />);
  expect(screen.getByText(/미확인 품목은 평가액에 포함되지/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '덮어쓰기' }));
  expect(save.mock.calls[0][0]).toMatchObject({ value: 0, items: [] });
});


it('저장 원가 미확인과 명시0을 분리하고 수량을 품목별로 표시한다', () => {
  const save = vi.fn();
  const items = [item('확인품', 10, {stock: 2}), item('영원가', 0, {stock: 3}),
    item('미확인kg', undefined as unknown as number, {stock: 4, unit: 'kg'}),
    item('미확인박스', NaN, {stock: 5, unit: '박스'}),
    item('미확인벌크L', undefined as unknown as number, {stock: 6, unit: 'L', subtype: '벌크'}),
    item('타사', undefined as unknown as number, {stock: 99, companyId: 'punghoe'})];
  const view = render(<ProfitAnalysis {...props} items={items} costOf={() => 100} onSaveInventorySnapshot={save} />);
  expect(screen.getByText('확인된 저장 원가 평가액')).toBeInTheDocument();
  expect(screen.getByText('20원')).toBeInTheDocument();
  expect(screen.getByText('저장 원가 0원')).toBeInTheDocument();
  expect(screen.getByText('저장 원가 미확인 3품목')).toBeInTheDocument();
  expect(screen.getByText('미확인kg: 4 kg')).toBeInTheDocument();
  expect(screen.getByText('미확인박스: 5 박스')).toBeInTheDocument();
  expect(screen.getByText('미확인벌크L: 6 kg')).toBeInTheDocument();
  expect(screen.queryByText('미확인벌크L: 6 L')).not.toBeInTheDocument();
  expect(screen.queryByText('영원가: 3')).not.toBeInTheDocument();
  expect(screen.getByRole('button', {name:'기말재고 기록'})).toBeDisabled();
  view.rerender(<ProfitAnalysis {...props} companyId="punghoe" items={items} />);
  expect(screen.getByText('저장 원가 미확인 1품목')).toBeInTheDocument();
  expect(screen.queryByText('미확인kg: 4 kg')).not.toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
});
