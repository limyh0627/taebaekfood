/** 개수 로트의 공용 순수 본체. 시각·날짜·ID는 호출자가 고정한다. */
import type { RawMaterialLot } from './rawLot';
export type { RawMaterialLot } from './rawLot';
export type ProductLotClock={now:string;date:string;id:string};
const round3=(n:number)=>Math.round(n*1000)/1000;
export function buildProductLot(params: {
  material: string;          // 물질 축 — '볶음참깨'
  itemId: string;            // 이 로트가 붙는 품목(박스 규격별로 다름)
  supplierName: string;      // 만든 곳 — OEM이면 외주공장
  supplierId?: string;
  qtyIn: number;             // 입고 개수(박스 수)
  unitKg: number;            // 1개당 kg
  receivedDate?: string;
  poId?: string;             // 만든 근거 — OEM 가공 배치
  lotNo?: string;
}, clock: ProductLotClock): RawMaterialLot {
  const now = clock.now;
  const qty = Math.round(params.qtyIn * 1000) / 1000;
  const kg = round3(qty * params.unitKg);
  return {
    id: clock.id,
    material: params.material,
    supplierId: params.supplierId,
    supplierName: params.supplierName,
    qtyIn: qty,
    qtyRemaining: qty,
    unitKg: params.unitKg,
    kgIn: kg,
    kgRemaining: kg,
    receivedDate: params.receivedDate ?? clock.date,
    status: 'active',
    poId: params.poId,
    lotNo: params.lotNo,
    createdAt: now,
  };
}

/**
 * 로트를 안 쓰던 완제품에 첫 로트를 얹을 때, 그때까지의 재고를 '이월' 로트로 보존한다.
 * 안 하면 로트 합계(0) < 재고(15박스)라 첫 출고부터 전부 미상으로 빠진다.
 * 이월분은 출처를 모르는 게 사실이므로 supplierName='이월'로 정직하게 남긴다.
 */
export function withCarryOverProductLot(
  lots: RawMaterialLot[],
  currentQty: number,
  material: string,
  unitKg: number,
  carryOver: { id: string; createdAt: string; receivedDate: string } | undefined,
  clock: ProductLotClock,
): RawMaterialLot[] {
  if (lots.length > 0) return lots;
  const qty = round3(currentQty);
  if (!Number.isFinite(qty) || qty <= 0) return lots;
  if (!Number.isFinite(unitKg) || unitKg < 0) throw new Error('이월 로트의 단위 중량을 확인해 주세요.');
  return [{
    id: carryOver?.id ?? clock.id,
    lotNo: `이월-${(carryOver?.receivedDate ?? clock.date).replace(/-/g, '')}`,
    material,
    supplierName: '이월',
    qtyIn: qty, qtyRemaining: qty, unitKg,
    kgIn: round3(qty * unitKg), kgRemaining: round3(qty * unitKg),
    receivedDate: carryOver?.receivedDate ?? clock.date,
    status: 'active',
    createdAt: carryOver?.createdAt ?? clock.now,
  }];
}

/** 완제품 로트의 잔여 개수 합 */
export function lotQtyRemaining(lots: RawMaterialLot[] | undefined): number {
  return round3((lots ?? []).reduce((s, l) => s + (l.qtyRemaining ?? 0), 0));
}

export interface ProductLotTake {
  lotId?: string;
  lotNo?: string;
  receivedDate?: string;
  supplierName: string;
  qty: number;
}

/**
 * 개수 기준 FIFO 차감 — 출고 때 앞쪽 로트부터 깐다. 혼합(mix)은 없다: 박스는 섞이지 않는다.
 *
 * 로트 잔량이 부족하면 원본을 유지하고 부족량을 돌려준다. 호출자는 부족량을 거절해야 한다.
 * 수량 재고는 남아도 로트가 모자랄 수 있으므로 이 함수에서 음수 이월을 만들지 않는다.
 */
export function deductLotsByQty(
  lots: RawMaterialLot[],
  qtyToUse: number,
): { lots: RawMaterialLot[]; distribution: ProductLotTake[]; shortageQty: number } {
  if (!Number.isFinite(qtyToUse) || qtyToUse < 0) {
    throw new Error(`로트 차감 수량은 0 이상의 유한한 숫자여야 합니다: ${qtyToUse}`);
  }
  if (lots.some(lot => lot.qtyRemaining != null && !Number.isFinite(lot.qtyRemaining))) {
    throw new Error('로트 잔량이 올바르지 않습니다.');
  }
  let remaining = round3(qtyToUse);
  const dist: ProductLotTake[] = [];
  if (remaining <= 0) return { lots: lots.map(l => ({ ...l })), distribution: dist, shortageQty: 0 };
  const usable = round3(lots.reduce((sum, lot) =>
    sum + (lot.status === 'active' ? Math.max(0, Number(lot.qtyRemaining ?? 0)) : 0), 0));
  const available = Math.max(0, Math.min(usable, lotQtyRemaining(lots)));
  const shortageQty = round3(Math.max(0, remaining - available));
  if (shortageQty > 0) return { lots, distribution: [], shortageQty };
  const next = lots.map(l => ({ ...l }));

  for (const l of next) {
    if (remaining <= 0) break;
    if (l.status !== 'active' || (l.qtyRemaining ?? 0) <= 0) continue;
    const t = Math.min(l.qtyRemaining ?? 0, remaining);
    if (t <= 0) continue;
    l.qtyRemaining = round3((l.qtyRemaining ?? 0) - t);
    l.kgRemaining = round3((l.qtyRemaining ?? 0) * (l.unitKg ?? 0));
    remaining = round3(remaining - t);
    if ((l.qtyRemaining ?? 0) <= 0.0001) { l.qtyRemaining = 0; l.kgRemaining = 0; l.status = 'depleted'; }
    dist.push({ lotId: l.id, lotNo: l.lotNo, receivedDate: l.receivedDate, supplierName: l.supplierName, qty: round3(t) });
  }

  if (remaining > 0) return { lots, distribution: [], shortageQty: remaining };
  return { lots: next, distribution: dist, shortageQty: 0 };
}


