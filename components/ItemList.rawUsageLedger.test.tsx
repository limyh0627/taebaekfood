/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ItemList from './ItemList';
import { rawPressAttemptKey, saveRawPressAttempt, type RawPressRequest } from '../src/shared/rawPressAttempt';
import type { RawMaterialEntry } from '../src/shared/types';
const state = vi.hoisted(() => ({ auth: { currentUser: { uid: 'employee' } } }));
vi.mock('../src/shared/firebase', () => ({ db: {}, storage: {}, functions: {}, auth: state.auth, authReady: Promise.resolve() }));
vi.mock('../src/shared/services/firebaseService', () => ({ fetchCollection: vi.fn().mockResolvedValue([]), subscribeToCollection: vi.fn(() => () => {}), addItem: vi.fn() }));
vi.mock('../src/shared/components/appDialog', () => ({ appConfirm: vi.fn().mockResolvedValue(true) }));
vi.mock('../src/shared/services/unpackService', () => ({ productStocktakeActor: vi.fn(), durableCanUnpack: vi.fn(), durableProductStocktake: vi.fn() }));
vi.mock('../src/shared/services/boxUnpackService', () => ({ durableBoxUnpack: vi.fn() }));
vi.mock('../src/shared/services/itemStockAddService', () => ({ durableItemStockAdd: vi.fn() }));
function props() {
  return { companyId: 'taebaek' as const, mode: 'lots' as const, items: [{ id: 'source', name: '참깨', type: 'raw', subtype: '벌크', companyId: 'taebaek', stock: 100, minStock: 0, unit: 'kg', lots: [{ id: 'lot', status: 'active', kgRemaining: 100 }] }] as any[], partners: [], orderRequests: [], confirmedOrders: [], inboundPartners: [], rawMaterialLedger: [], rawYieldRules: { 참깨: { product: '통깨참기름', rate: 0.48 } },
    onUpdateItem: vi.fn(), onAddItem: vi.fn(), onAddOrderRequest: vi.fn(), onRemoveOrderRequest: vi.fn(), onUpdateOrderRequestQty: vi.fn(), onToggleConfirmRequestQty: vi.fn(), onConfirmRequest: vi.fn(), onConfirmRequests: vi.fn(), onBulkAddConfirmedOrders: vi.fn(), onConfirmAllRequests: vi.fn(), onFinishConfirmedOrder: vi.fn(), onUpdateConfirmedQty: vi.fn(), onRemoveConfirmedOrder: vi.fn(), onEditProduct: vi.fn(), onDeleteItem: vi.fn(), onAddAdjustmentRequest: vi.fn(), onAddRawMaterialEntry: vi.fn().mockResolvedValue({ ok: true, appliedKg: -10 }), onDeleteRawMaterialEntry: vi.fn(), onLedgerChanged: vi.fn() };
}
function openUsage(p: ReturnType<typeof props>) {
  render(<ItemList {...p} />);
  fireEvent.click(screen.getByRole('button', { name: '사용 기록' }));
  fireEvent.change(screen.getByLabelText('사용량'), { target: { value: '10' } });
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
}
beforeEach(() => localStorage.clear());
afterEach(cleanup);
it.each([-10, 0])('원료 사용 확정 성공 적용량 %s 뒤에 원장을 한 번 갱신한다', async appliedKg => {
  const p = props(); p.onAddRawMaterialEntry.mockResolvedValue({ ok: true, appliedKg }); openUsage(p);
  await waitFor(() => expect(p.onLedgerChanged).toHaveBeenCalledOnce());
  expect(p.onAddRawMaterialEntry).toHaveBeenCalledOnce();
  expect(p.onAddRawMaterialEntry.mock.invocationCallOrder[0]).toBeLessThan(p.onLedgerChanged.mock.invocationCallOrder[0]);
});
it('확정 실패에는 원장 갱신을 요청하지 않는다', async () => {
  const p = props(); p.onAddRawMaterialEntry.mockResolvedValue({ ok: false, reason: '부족' } as any); openUsage(p);
  await screen.findByRole('button', { name: '이전 요청 재개' });
  expect(p.onLedgerChanged).not.toHaveBeenCalled();
});
it('응답 미확인은 최초 압착 원문을 보존하고 원장 갱신을 요청하지 않는다', async () => {
  const p = props(); p.onAddRawMaterialEntry.mockImplementation(async (entry: RawMaterialEntry) => {
    const request: RawPressRequest = { version: 1, companyId: 'taebaek', actorUid: 'employee', entry, yieldRule: { product: '통깨참기름', rate: 0.48 }, sourceCommand: { operationId: entry.id, companyId: 'taebaek', rawItemId: 'source', materialSnapshot: entry.material, effectiveAt: entry.effectiveAt!, source: { type: 'manual', id: entry.id }, kind: 'consume-lot', kg: entry.used, lotId: entry.targetLotId! }, derivedCommand: { operationId: `yield:${entry.id}`, companyId: 'taebaek', rawItemId: 'derived', materialSnapshot: '통깨참기름', effectiveAt: entry.effectiveAt!, source: { type: 'manual', id: entry.id }, kind: 'receive', kg: entry.used * 0.48, lot: { supplierName: '압착' } }, sourceLegacy: {}, derivedLegacy: {} };
    saveRawPressAttempt(request); throw Error('응답 미확인');
  }); openUsage(p);
  await screen.findByRole('button', { name: '이전 요청 재개' });
  expect(p.onLedgerChanged).not.toHaveBeenCalled();
  const saved = JSON.parse(localStorage.getItem(rawPressAttemptKey('taebaek', 'employee'))!);
  expect(saved.request?.entry ?? saved.entry).toEqual(p.onAddRawMaterialEntry.mock.calls[0][0]);
});
