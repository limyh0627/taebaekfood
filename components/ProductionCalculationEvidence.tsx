import React from 'react';
import { companyOf, type CompanyId, type Order, type OrderInventorySnapshot } from '../src/shared/types';

const paths = { 'bom-direct': '직접 BOM', 'bom-formula': 'BOM·배합', 'formula-fallback': '규격 환산·배합', bulk: '벌크' } as const;
const number = (value: number) => value.toLocaleString('ko-KR', { useGrouping: false, maximumFractionDigits: 20 });

/** 저장된 계산과 차감 기록만 보여준다. 현재 배합으로 과거 값을 재계산하지 않는다. */
export default function ProductionCalculationEvidence({ order, companyId }: { order: Order; companyId: CompanyId }) {
  if (companyOf(order) !== companyId) return null;
  const snapshots: { key: string; title: string; snapshot: OrderInventorySnapshot; cancelled: boolean }[] = [];
  if (order.inventorySnapshots?.production) snapshots.push({ key: 'whole', title: '전체 작업 생산', snapshot: order.inventorySnapshots.production, cancelled: !order.producedAt });
  Object.entries(order.itemInventory ?? {}).forEach(([key, state]) => snapshots.push({ key: `line-${key}`, title: `품목별 생산 · ${order.items.find(item => item.itemId === state.itemId)?.name || state.itemId}`, snapshot: state.production, cancelled: !state.applied }));
  return <details className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
    <summary className="cursor-pointer text-sm font-bold">생산 당시 원료 계산 근거</summary>
    <p className="mt-2 text-xs text-slate-500">저장된 계산과 원료 차감 기록입니다. 실물 투입량 측정값을 뜻하지 않습니다. 작업별로 표시하며 전체·품목별 기록을 합산하지 않습니다.</p>
    {snapshots.length === 0 && <p className="mt-3 text-xs">당시 계산 근거 미기록</p>}
    {snapshots.map(({ key, title, snapshot, cancelled }) => <section key={key} className="mt-3 border-t border-slate-200 pt-3">
      <h3 className="text-xs font-bold">{title}{cancelled ? ' · 취소 이력' : ''}</h3>
      <p className="text-xs text-slate-500">저장 시각 {snapshot.capturedAt || '미기록'}</p>
      {snapshot.rawCalculationEvidence === undefined ? <p className="mt-2 text-xs">당시 계산 근거 미기록</p> : snapshot.rawCalculationEvidence.length === 0 ? <p className="mt-2 text-xs">저장된 원료 계산 없음</p> : <ul className="mt-2 space-y-2 text-xs">
        {snapshot.rawCalculationEvidence.map((row, index) => <li key={index} className="break-words">
          <p className="font-bold">{order.items.find(item => item.itemId === row.productId)?.name || row.productId} · {row.spec || '규격 미기록'} · 생산 수량 {number(row.units)} · {paths[row.path]}</p>
          <p>{row.raw} · 계산 사용량 {number(row.kg)} kg</p>
          {row.bomQuantityKg !== undefined && <p>BOM 기본량 {number(row.bomQuantityKg)} kg{row.childItemId ? ` · 구성 품목 ${row.childItemId}` : ''}</p>}
          {row.formulaName !== undefined && <p>당시 배합 {row.formulaName}{row.ratio !== undefined ? ` · 비율 ${number(row.ratio)}` : ''}</p>}
          {row.convertedKg !== undefined && <p>규격 환산 결과 {number(row.convertedKg)} kg</p>}
        </li>)}
      </ul>}
      <div className="mt-2 text-xs text-slate-600">
        <p className="font-bold">저장된 원료 차감 기록</p>
        {snapshot.rawConsumedLots === undefined ? <p>차감 기록 미기록</p> : snapshot.rawConsumedLots.length === 0 ? <p>차감 기록 없음</p> : <ul>{snapshot.rawConsumedLots.map((trace, index) => <li key={index} className="break-words">{trace.material} · 기록 {number(trace.kg)} kg{trace.ledgerOnly ? ' · 원장만 기록' : ''}{trace.lotNo ? ` · 로트 ${trace.lotNo}` : ''}</li>)}</ul>}
      </div>
    </section>)}
  </details>;
}
