/** @vitest-environment jsdom */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import OemManager from './OemManager';
import type { Item, PurchaseOrder } from '../src/shared/types';

const item = { id: 'product', companyId: 'taebaek', name: '볶음참깨', type: 'product', spec: '1kg', unit: '개' } as Item;
const po = (patch: Partial<PurchaseOrder> = {}) => ({ id: 'po', companyId: 'taebaek', poType: 'oem', status: 'received',
  partnerName: '외주공장', createdAt: '', itemId: '', itemName: '', quantity: 0,
  oemSent: [{ material: '참깨', kg: 100 }], ...patch }) as PurchaseOrder;
function view(order: PurchaseOrder, products = [item], companyId: 'taebaek' | 'punghoe' = 'taebaek') {
  const onIssueFee = vi.fn().mockResolvedValue(undefined);
  render(<OemManager companyId={companyId} items={products} partners={[]} rawStockKg={() => 0} issueDrafts={[]}
    issueOpen={false} receiveTarget={null} feeTarget={order} onClose={vi.fn()} onIssue={vi.fn()}
    onReceive={vi.fn()} onIssueFee={onIssueFee} />);
  return onIssueFee;
}
it('구형 총회수 누락은 0kg·확정 로스로 표시하지 않는다', () => {
  view(po());
  expect(screen.getByText('총회수 중량 (저장값)').parentElement?.textContent).toContain('자료 없음');
  expect(screen.getByText('산술 차이 · 손실 미확정').parentElement?.textContent).toContain('미확정');
  expect(screen.queryByText('로스')).toBeNull();
});
it('입고 입력 미리보기는 확정 손실 대신 추정 송출·입고 차이로 안내한다', () => {
  const receive = vi.fn();
  render(<OemManager companyId="taebaek" items={[item]} partners={[]} rawStockKg={() => 0} issueDrafts={[]}
    issueOpen={false} receiveTarget={po({ status: 'invoiced' })} feeTarget={null} onClose={vi.fn()}
    onIssue={vi.fn()} onReceive={receive} onIssueFee={vi.fn()} />);
  expect(screen.getByText('송출·입고 차이 (추정, 손실 미확정)')).toBeTruthy();
  expect(screen.queryByText('로스 (수율손실)')).toBeNull();
  expect(receive).not.toHaveBeenCalled();
});
it('구형 벌크 미상은 0으로 닫거나 저장 총회수와 불일치를 단정하지 않는다', () => {
  view(po({ oemReceivedKg: 90, items: [{ itemId: 'product', name: '볶음참깨', quantity: 70, unit: '개' }] }));
  expect(screen.getByText('참깨 벌크 회수').parentElement?.textContent).toContain('자료 없음');
  expect(screen.getByText('산술 차이 · 손실 미확정').parentElement?.textContent).toContain('미확정');
  expect(screen.queryByText('저장된 회수 중량과 제품·벌크 단위 불일치')).toBeNull();
});
it('새 입고의 확인된 무벌크와 현재 품목 환산 차이를 안내한다', () => {
  view(po({ oemReceivedKg: 90, oemReceiptOperationId: 'receipt-po',
    items: [{ itemId: 'product', name: '볶음참깨', quantity: 70, unit: '개' }] }));
  expect(screen.getByText('참깨 벌크 회수').parentElement?.textContent).toContain('0 kg');
  expect(screen.getByText('제품 중량 (현재 품목 기준 환산)').parentElement?.textContent).toContain('70 kg');
  expect(screen.getByText('저장된 회수 중량과 제품·벌크 단위 불일치')).toBeTruthy();
});
it('다종 원료는 제품 중량을 귀속시키거나 확정 손실로 표시하지 않는다', () => {
  view(po({ oemReceivedKg: 90, oemReceiptOperationId: 'receipt-po',
    oemSent: [{ material: '참깨', kg: 80 }, { material: '들깨', kg: 20 }],
    items: [{ itemId: 'product', name: '볶음참깨', quantity: 90, unit: '개' }] }));
  expect(screen.getByText('산술 차이 · 손실 미확정').parentElement?.textContent).toContain('미확정');
  expect(screen.getByText('다중 원료 제품 귀속 불명')).toBeTruthy();
});
it('현재 품목 규격 환산은 저장된 총회수·가공비와 발행 입력을 바꾸지 않는다', async () => {
  const order = po({ oemReceivedKg: 90, oemFeePerKg: 1000, oemReceiptOperationId: 'receipt-po',
    items: [{ itemId: 'product', name: '볶음참깨', quantity: 70, unit: '개' }] });
  const issue = view(order, [{ ...item, spec: '2kg' }]);
  expect(screen.getByText('제품 중량 (현재 품목 기준 환산)').parentElement?.textContent).toContain('140 kg');
  expect(screen.getByText('총회수 중량 (저장값)').parentElement?.textContent).toContain('90 kg');
  expect(screen.getByText('90,000원')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '전표 발행' }));
  await act(async () => {});
  expect(issue).toHaveBeenCalledExactlyOnceWith({ po: order, unitPricePerKg: 1000, date: expect.any(String) });
});
it('타회사 품목으로 현재 제품 중량을 환산하지 않는다', () => {
  view(po({ oemReceivedKg: 90, oemReceiptOperationId: 'receipt-po',
    items: [{ itemId: 'product', name: '', quantity: 90, unit: '개' }] }), [{ ...item, companyId: 'punghoe' }]);
  expect(screen.getByText('제품 중량 (현재 품목 기준 환산)').parentElement?.textContent).toContain('자료 없음');
  expect(screen.getByText('제품 단위 환산 불명: product (product)')).toBeTruthy();
});
