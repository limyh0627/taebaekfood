/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import OrderActivityLogModal from './OrderActivityLogModal';
import { OrderStatus, type Order, type OrderInventorySnapshot } from '../src/shared/types';

afterEach(cleanup);
const order: Order = { id: 'o', companyId: 'taebaek', partnerName: '거래처', items: [], totalAmount: 0, status: OrderStatus.PROCESSING, createdAt: '2026-10-10', deliveryDate: '2026-10-10', email: '', source: '일반' };
const snapshot: OrderInventorySnapshot = { capturedAt: '2026-10-10T01:00:00Z', stockDeltas: [], bomLines: [], rawCalculationEvidence: [
  { productId: 'oil', spec: '350ml', units: 2, raw: '깨분', kg: 0.000001, path: 'bom-direct', childItemId: 'raw', bomQuantityKg: 0.0000005 },
  { productId: 'oil', spec: '350ml', units: 2, raw: '참깨', kg: 0.4, path: 'bom-formula', bomQuantityKg: 1, formulaName: '당시 배합', ratio: 0.2 },
  { productId: 'oil', spec: '350ml', units: 2, raw: '들깨', kg: 0.6, path: 'formula-fallback', formulaName: '환산 배합', ratio: 0.5, convertedKg: 1.2 },
], rawConsumedLots: [{ material: '깨분', supplierName: '매입처', kg: 0.000001, lotNo: 'L1' }] };
const modal = (value: Order, companyId: 'taebaek' | 'punghoe' = 'taebaek') => <OrderActivityLogModal partnerName="거래처" order={value} companyId={companyId} rows={[]} loading={false} onClose={vi.fn()} />;

it('기존 주문 로그 모달에서 저장된 직접 BOM·배합·환산과 원료 차감 기록을 구분해 표시한다', () => {
  render(modal({ ...order, inventorySnapshots: { version: 1, production: snapshot } }));
  fireEvent.click(screen.getByText('생산 당시 원료 계산 근거'));
  expect(screen.getByText(/BOM 기본량 0.0000005 kg/)).toBeInTheDocument();
  expect(screen.getByText('당시 배합 당시 배합 · 비율 0.2')).toBeInTheDocument();
  expect(screen.getByText('규격 환산 결과 1.2 kg')).toBeInTheDocument();
  expect(screen.getByText('깨분 · 계산 사용량 0.000001 kg')).toBeInTheDocument();
  expect(screen.getByText('깨분 · 기록 0.000001 kg · 로트 L1')).toBeInTheDocument();
  expect(screen.getByText(/실물 투입량 측정값을 뜻하지 않습니다/)).toBeInTheDocument();
});
it('전체와 품목별 작업은 합산하지 않으며 취소된 품목 생산의 저장 원문도 보존한다', () => {
  render(modal({ ...order, inventorySnapshots: { version: 1, production: snapshot }, itemInventory: { line: { version: 1, lineId: 'line', itemId: 'oil', applied: false, attempt: 1, rawConsumedLots: [], autoBuilt: [], producedUnits: [], production: snapshot } } }));
  expect(screen.getByText('전체 작업 생산')).toBeInTheDocument();
  expect(screen.getByText('품목별 생산 · oil · 취소 이력')).toBeInTheDocument();
  expect(screen.getAllByText('규격 환산 결과 1.2 kg')).toHaveLength(2);
  expect(screen.queryByText(/총 사용량/)).not.toBeInTheDocument();
});
it('과거 계산 증거가 없으면 미기록으로 표시하고 남아 있는 실제 차감 기록만 읽는다', () => {
  const { rawCalculationEvidence: _evidence, ...legacy } = snapshot;
  render(modal({ ...order, inventorySnapshots: { version: 1, production: legacy } }));
  expect(screen.getByText('당시 계산 근거 미기록')).toBeInTheDocument();
  expect(screen.getByText('깨분 · 기록 0.000001 kg · 로트 L1')).toBeInTheDocument();
  expect(screen.queryByText('당시 배합 당시 배합 · 비율 0.2')).not.toBeInTheDocument();
});
it('저장된 빈 계산은 과거 미기록과 구분하고 다른 회사 주문은 표시하지 않는다', () => {
  const view = render(modal({ ...order, inventorySnapshots: { version: 1, production: { ...snapshot, rawCalculationEvidence: [], rawConsumedLots: [] } } }));
  expect(screen.getByText('저장된 원료 계산 없음')).toBeInTheDocument();
  expect(screen.getByText('차감 기록 없음')).toBeInTheDocument();
  view.rerender(modal(order, 'punghoe'));
  expect(screen.queryByText('생산 당시 원료 계산 근거')).not.toBeInTheDocument();
});
