/** @vitest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ItemList from './ItemList';
import type { Item, Partner, PartnerItem } from '../src/shared/types';
import { fetchCollection } from '../src/shared/services/firebaseService';

vi.mock('../src/shared/firebase', () => ({ db: {}, storage: {}, functions: {}, auth: {}, authReady: Promise.resolve() }));
vi.mock('../src/shared/services/firebaseService', () => ({
  fetchCollection: vi.fn().mockResolvedValue([]), subscribeToCollection: vi.fn(() => () => {}), addItem: vi.fn(),
}));

it('거래처 이름으로 검색한 재고 목록은 품목 연결만 추가·삭제돼도 갱신된다', async () => {
  const items = [{ id: 'p1', name: '합성 검수 품목', type: 'product', unit: '개', stock: 10, minStock: 0, category: '참기름' }] as Item[];
  const partners = [{ id: 'c1', name: '합성 거래처', type: '일반' }] as Partner[];
  const links = [{ id: 'pi1', itemId: 'p1', partnerId: 'c1', Direction: 'out', price: 1000 }] as PartnerItem[];
  const props: React.ComponentProps<typeof ItemList> = { companyId: 'taebaek', items, partners,
    orderRequests: [], confirmedOrders: [], inboundPartners: [], rawMaterialLedger: [],
    onUpdateItem: vi.fn(), onAddItem: vi.fn(), onAddOrderRequest: vi.fn(), onRemoveOrderRequest: vi.fn(),
    onUpdateOrderRequestQty: vi.fn(), onToggleConfirmRequestQty: vi.fn(), onConfirmRequest: vi.fn(),
    onConfirmRequests: vi.fn(), onBulkAddConfirmedOrders: vi.fn(), onConfirmAllRequests: vi.fn(),
    onFinishConfirmedOrder: vi.fn(), onUpdateConfirmedQty: vi.fn(), onRemoveConfirmedOrder: vi.fn(),
    onEditProduct: vi.fn(), onDeleteItem: vi.fn(), onAddAdjustmentRequest: vi.fn(),
    onAddRawMaterialEntry: vi.fn(), onDeleteRawMaterialEntry: vi.fn() };
  const view = render(<ItemList {...props} partnerItems={[]} />);
  fireEvent.change(screen.getByPlaceholderText('품목명 · 거래처 검색...'), { target: { value: '합성 거래처' } });
  expect(screen.queryAllByText('합성 검수 품목')).toHaveLength(0);
  view.rerender(<ItemList {...props} partnerItems={links} />);
  expect(screen.getAllByText('합성 검수 품목').length).toBeGreaterThan(0);
  view.rerender(<ItemList {...props} partnerItems={[]} />);
  expect(screen.queryAllByText('합성 검수 품목')).toHaveLength(0);

  // 배송/품목 원본을 바꾸지 않고 매입 연결만 바뀌어도 매입처 검색이 따라간다.
  const inboundPartners = [{ id: 's1', name: '합성 매입처' }];
  view.rerender(<ItemList {...props} inboundPartners={inboundPartners} partnerItems={[]} />);
  fireEvent.change(screen.getByPlaceholderText('품목명 · 거래처 검색...'), { target: { value: '합성 매입처' } });
  view.rerender(<ItemList {...props} inboundPartners={inboundPartners}
    partnerItems={[{ ...links[0], Direction: 'in', partnerId: 's1' }]} />);
  expect(screen.getAllByText('합성 검수 품목').length).toBeGreaterThan(0);

  view.unmount();
  let resolveTaxonomy!: (rows: any[]) => void;
  vi.mocked(fetchCollection).mockImplementationOnce(() => new Promise(resolve => { resolveTaxonomy = resolve; }));
  const sortedItems = [items[0], { ...items[0], id: 'p2', name: '합성 들기름', category: '들기름' }];
  render(<ItemList {...props} items={sortedItems} partnerItems={[]} />);
  const precedes = () => !!(screen.getAllByText('합성 검수 품목')[0].compareDocumentPosition(screen.getAllByText('합성 들기름')[0]) & Node.DOCUMENT_POSITION_FOLLOWING);
  expect(precedes()).toBe(true);
  await act(async () => resolveTaxonomy([
    { id: 'type', kind: 'type', key: 'product', label: '완제품', order: 0 },
    { id: 'perilla', kind: 'category', parent: 'product', label: '들기름', order: 0 },
    { id: 'sesame', kind: 'category', parent: 'product', label: '참기름', order: 1 },
  ]));
  expect(precedes()).toBe(false);
});
