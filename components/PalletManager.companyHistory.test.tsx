/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { CompanyId, PalletTransaction } from '../src/shared/types';
const service = vi.hoisted(() => ({ fetchDateRange: vi.fn(), updateItem: vi.fn(), deleteItem: vi.fn() }));
vi.mock('../src/shared/services/firebaseService', () => service);
vi.mock('../src/shared/components/appDialog', () => ({ appConfirm: async () => true }));
vi.mock('firebase/firestore', () => ({ where: (field: string, op: string, value: string) => ({ field, op, value }) }));
const pending = () => { let resolve!: (rows: PalletTransaction[]) => void; const promise = new Promise<PalletTransaction[]>(done => { resolve = done; }); return { promise, resolve }; };
const row = (companyId: CompanyId, note: string): PalletTransaction[] => [{ id: `${companyId}-tx`, companyId, partnerId: 'partner', palletId: 'pallet', type: 'out', quantity: 3, date: new Date().toISOString().slice(0,10), note } as PalletTransaction];
const props = { pallets: [], orders: [], partners: [], palletTransactions: [], onUpdatePallet: vi.fn(), onAddPalletTransaction: vi.fn() };
beforeEach(() => { vi.resetModules(); service.fetchDateRange.mockReset(); service.updateItem.mockClear(); service.deleteItem.mockClear(); });
const openHistory = () => fireEvent.click(screen.getByRole('button', { name: /^이력$/ }));

it('과거 조회는 회사 조건을 서버에 전달한다', async () => {
  service.fetchDateRange.mockResolvedValue([]);
  const { default: Manager } = await import('./PalletManager');
  render(<Manager {...props} companyId="punghoe" />);
  expect(service.fetchDateRange.mock.calls[0]?.[4]).toEqual([{ field: 'companyId', op: '==', value: 'punghoe' }]);
});
it('이전 회사의 늦은 응답이 새 회사 과거 이력을 덮지 않는다', async () => {
  const a = pending(), b = pending(); service.fetchDateRange.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const { default: Manager } = await import('./PalletManager');
  const view = render(<Manager {...props} companyId="taebaek" />);
  view.rerender(<Manager {...props} companyId="punghoe" />); openHistory();
  await act(async () => b.resolve(row('punghoe', '풍회 이력')));
  expect(screen.getByText('풍회 이력')).toBeInTheDocument();
  await act(async () => a.resolve(row('taebaek', '태백 늦은 이력')));
  expect(screen.queryByText('태백 늦은 이력')).not.toBeInTheDocument();
  expect(screen.getByText('풍회 이력')).toBeInTheDocument();
});
it('같은 회사 캐시는 재사용하지만 다른 회사에는 노출하지 않는다', async () => {
  service.fetchDateRange.mockResolvedValueOnce(row('taebaek', '태백 캐시')).mockResolvedValueOnce(row('punghoe', '풍회 캐시'));
  const { default: Manager } = await import('./PalletManager');
  let view = render(<Manager {...props} companyId="taebaek" />); await act(async () => {}); openHistory();
  expect(screen.getByText('태백 캐시')).toBeInTheDocument(); view.unmount();
  view = render(<Manager {...props} companyId="taebaek" />); openHistory();
  expect(screen.getByText('태백 캐시')).toBeInTheDocument(); expect(service.fetchDateRange).toHaveBeenCalledTimes(1); view.unmount();
  render(<Manager {...props} companyId="punghoe" />); openHistory();
  expect(screen.queryByText('태백 캐시')).not.toBeInTheDocument(); await act(async () => {});
  expect(screen.getByText('풍회 캐시')).toBeInTheDocument(); expect(service.fetchDateRange).toHaveBeenCalledTimes(2);
  expect(service.updateItem).not.toHaveBeenCalled(); expect(service.deleteItem).not.toHaveBeenCalled();
});
it('정상 거래 삭제 후 같은 회사 캐시에도 삭제가 반영된다', async () => {
  service.fetchDateRange.mockResolvedValue(row('taebaek', '삭제할 이력'));
  service.deleteItem.mockResolvedValue(undefined);
  const { default: Manager } = await import('./PalletManager');
  const view = render(<Manager {...props} companyId="taebaek" />); await act(async () => {}); openHistory();
  fireEvent.click(screen.getByTitle('거래 삭제(정정)'));
  await waitFor(() => expect(screen.queryByText('삭제할 이력')).not.toBeInTheDocument());
  expect(service.deleteItem).toHaveBeenCalledWith('palletTransactions', 'taebaek-tx');
  view.unmount(); render(<Manager {...props} companyId="taebaek" />); openHistory();
  expect(screen.queryByText('삭제할 이력')).not.toBeInTheDocument();
  expect(service.fetchDateRange).toHaveBeenCalledTimes(1);
});
