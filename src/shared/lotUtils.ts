import { buildReceiveLot as buildReceiveLotPure } from '../../functions/src/shared/rawLot';
import type { LotMixSetting } from '../../functions/src/shared/rawLot';
export { nextLotNo, deductFromLots } from '../../functions/src/shared/rawLot';
import { buildProductLot as buildProductLotPure, withCarryOverProductLot as withCarryOverProductLotPure, lotQtyRemaining } from '../../functions/src/shared/productLot';
export { lotQtyRemaining, deductLotsByQty } from '../../functions/src/shared/productLot';
export type { ProductLotTake } from '../../functions/src/shared/productLot';
import type { ProductLotTake } from '../../functions/src/shared/productLot';
import type { Item, RawMaterialLot } from './types';

export type { LotMixSetting } from '../../functions/src/shared/rawLot';

/** 새 로트별 혼합비를 우선하고, 예전 상위 2개 설정도 계속 읽는다. */
export function lotMixSettingOf(item: Pick<Item, 'mixEnabled' | 'mixTopPercent' | 'mixLotRatios'>): LotMixSetting | undefined {
  if (!item.mixEnabled) return undefined;
  const ratios = (item.mixLotRatios ?? []).filter(row => row.lotId && Number(row.percent) > 0);
  // 새 형식이 한 번이라도 저장됐으면 2개 이상 고르기 전에는 혼합하지 않는다.
  // 필드 자체가 없는 옛 자료만 예전 상위 2개 설정으로 호환한다.
  if (item.mixLotRatios !== undefined) return ratios.length >= 2 ? { ratios } : undefined;
  return { topPercent: item.mixTopPercent ?? 50 };
}
import { today as todayStr } from './day';
export { receiptToKg } from '../../functions/src/shared/stockUnitMeasure';

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * 로트가 하나도 없는 원료에 첫 로트를 얹을 때, 기존 재고(운영 단위)를 '이월' 로트로 보존한다.
 * 이미 로트가 있으면 그대로 둔다(중복 이월 방지). → 로트 도입 시 기존 재고 손실 방지.
 */
export function withCarryOverLot(
  lots: RawMaterialLot[],
  currentStockUnit: number,
  material: string,
): RawMaterialLot[] {
  if (lots.length > 0) return lots;
  const carryKg = round3(currentStockUnit);   // stock은 이미 kg
  if (!Number.isFinite(carryKg) || carryKg <= 0) return lots;
  const now = new Date().toISOString();
  return [{
    id: `lot-carry-${material}-${Date.now()}`,
    lotNo: `이월-${todayStr().replaceAll('-', '')}`,
    supplierName: '이월',
    kgIn: carryKg,
    kgRemaining: carryKg,
    receivedDate: todayStr(),
    status: 'active',
    createdAt: now,
  }];
}

export function buildReceiveLot(params: {
  material: string;
  supplierId?: string;
  supplierName: string;
  qtyIn: number;           // 포장 개수 또는 입력 수량
  kgIn: number;            // 환산된 입고 kg
  packageType?: string;    // '캔' | '포대' | '자루'
  packageKg?: number;      // 포장 1개당 kg
  receivedDate?: string;
  poId?: string;
  /**
   * 로트 id 를 밖에서 정해 넣는다 — **트랜잭션 안에서 부를 때는 반드시 넘긴다.**
   * Firestore 트랜잭션 콜백은 경합하면 여러 번 돈다. 안에서 `Date.now()`·난수로 id 를 만들면
   * 재시도마다 다른 로트가 생겨, 한 번의 입고가 여러 로트로 남을 수 있다.
   * (설계: 로컬전용/docs/원료실제원장-로트-원자화-설계.md §6)
   */
  id?: string;
  /** 만든 시각을 밖에서 정해 넣는다 — 위와 같은 이유. */
  createdAt?: string;
}): RawMaterialLot {
  const now = params.createdAt ?? new Date().toISOString();
  return buildReceiveLotPure({
    ...params,
    id: params.id ?? `lot-${params.material}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    receivedDate: params.receivedDate ?? todayStr(),
    createdAt: now,
  });
}

/**
 * 과거 정정 스크립트 호환용 자동 상계 계산. 현행 원료 명령은 호출하지 않는다.
 * 자동 실행하면 어느 양수 로트로 음수를 갚을지 코드가 먼저 정하므로, 운영 상계는
 * 사람이 출처를 확인한 뒤 `merge-lots` 원자 명령으로만 한다.
 */
export function settleCarryOver(lots: RawMaterialLot[]): RawMaterialLot[] {
  const debtIdx = (lots ?? []).findIndex(l => l.supplierName === '이월' && (l.kgRemaining ?? 0) < 0);
  if (debtIdx < 0) return lots;
  const next = lots.map(l => ({ ...l }));
  let owe = round3(-(next[debtIdx].kgRemaining ?? 0));   // 갚아야 할 양(양수)
  const posIdx = next
    .map((l, i) => ({ l, i }))
    .filter(x => x.i !== debtIdx && x.l.status === 'active' && (x.l.kgRemaining ?? 0) > 0)
    .map(x => x.i);
  for (const idx of posIdx) {
    if (owe <= 0) break;
    const avail = next[idx].kgRemaining ?? 0;
    const pay = Math.min(avail, owe);
    next[idx].kgRemaining = round3(avail - pay);
    owe = round3(owe - pay);
    if (next[idx].kgRemaining <= 0.0001) { next[idx].kgRemaining = 0; next[idx].status = 'depleted'; }
  }
  next[debtIdx].kgRemaining = round3(-owe);
  if ((next[debtIdx].kgRemaining ?? 0) >= -0.0001) { next[debtIdx].kgRemaining = 0; next[debtIdx].status = 'depleted'; }
  return next;
}

/**
 * 입고 품목 정보로부터 입고 kg을 환산한다.
 * - 단위가 kg이면 그대로, L이면 ×밀도, 그 외(개/캔/포대/자루)는 ×packageKg.
 */
/**
 * 오래된 소진(depleted) 로트 정리 — 로트 배열 무한 증가에 따른 문서 비대화 방지(#1).
 * active 로트는 항상 보존. depleted는 receivedDate가 retentionMonths 이전인 것만 제거.
 * (원료 소비 이력은 주문의 rawConsumedLots 스냅샷에 별도 보존 → 추적성 손실 없음)
 * 변화가 없으면 원본 배열을 그대로 반환(불필요한 쓰기 방지).
 */
export function pruneDepletedLots(lots: RawMaterialLot[], retentionMonths = 6, asOf?: string): RawMaterialLot[] {
  if (!Array.isArray(lots) || lots.length === 0) return lots;
  const cutoff = asOf ? new Date(asOf) : new Date();
  cutoff.setMonth(cutoff.getMonth() - retentionMonths);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const kept = lots.filter(l => l.status !== 'depleted' || (l.receivedDate ?? '9999-99-99') >= cutoffStr);
  return kept.length === lots.length ? lots : kept;
}

// ─────────────────────────────────────────────────────────────────────────────
//  완제품(박스·개) 로트 — 개수로 세는 품목용
//
//  벌크 로트와 **같은 배열 모양**을 쓰되 잔량은 qtyRemaining이다. 왜 나누는가:
//    · 재고가 두 번 잡힌다 — 홀더 stock을 로트 합으로 덮어쓰므로(lotStockInUnit),
//      박스 로트를 벌크 홀더에 넣으면 박스 품목의 재고와 겹쳐 센다.
//    · FIFO가 엉킨다 — 벌크는 BOM이 kg으로, 박스는 출고가 개수로 빼간다.
//      한 배열에 섞으면 벌크 쓸 차례에 박스 로트를 까버린다.
//  그래서 저장은 품목별로 나누고, 이력은 lot.material로 가로질러 묶는다.
// ─────────────────────────────────────────────────────────────────────────────

/** 완제품 입고 1건 → 로트 1개. 잔여 = 입고 개수. kg은 환산해 같이 들고 다닌다(수불부와 이어진다). */
export function buildProductLot(params: Parameters<typeof buildProductLotPure>[0]): RawMaterialLot {
  const now = new Date().toISOString();
  return buildProductLotPure(params, { now, date: params.receivedDate ?? todayStr(), id: `lot-${params.itemId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` });
}
export function withCarryOverProductLot(lots: RawMaterialLot[], currentQty: number, material: string, unitKg: number, carryOver?: { id:string;createdAt:string;receivedDate:string }): RawMaterialLot[] {
  return withCarryOverProductLotPure(lots,currentQty,material,unitKg,carryOver,{now:carryOver?.createdAt ?? new Date().toISOString(),date:carryOver?.receivedDate ?? todayStr(),id:carryOver?.id ?? `lot-carry-${material}-${Date.now()}`});
}

/**
 * 출고취소 — 그때 깐 로트에 개수를 그대로 되돌린다.
 * FIFO를 거꾸로 돌리지 않고 **스냅샷대로** 되돌리는 이유: 출고 뒤에 새 로트가 들어왔으면
 * 역FIFO는 엉뚱한 로트에 얹는다. 이미 지워진 로트(정리됨)는 건너뛴다.
 */
export function restoreLotsByQty(lots: RawMaterialLot[], taken: ProductLotTake[]): RawMaterialLot[] {
  const next = lots.map(l => ({ ...l }));
  for (const t of taken) {
    const l = next.find(x => x.id === t.lotId);
    if (!l || t.qty <= 0) continue;
    l.qtyRemaining = round3((l.qtyRemaining ?? 0) + t.qty);
    l.kgRemaining = round3((l.qtyRemaining ?? 0) * (l.unitKg ?? 0));
    if ((l.qtyRemaining ?? 0) > 0) l.status = 'active';
  }
  return next;
}

/**
 * 물질 축으로 로트를 모은다 — 벌크·박스가 어느 품목에 흩어져 있든 한 줄로 본다.
 * lot.material이 없는 옛 로트는 홀더 품목 이름으로 메운다(로트 도입 전 데이터).
 */
export function lotsByMaterial(
  items: { id: string; name: string; unit?: string; lots?: RawMaterialLot[] }[],
  materialOf: (itemName: string) => string,
): Map<string, { itemId: string; itemName: string; unit?: string; lot: RawMaterialLot }[]> {
  const out = new Map<string, { itemId: string; itemName: string; unit?: string; lot: RawMaterialLot }[]>();
  for (const it of items) {
    for (const lot of it.lots ?? []) {
      const key = lot.material || materialOf(it.name);
      if (!key) continue;
      const row = { itemId: it.id, itemName: it.name, unit: it.unit, lot };
      const cur = out.get(key);
      if (cur) cur.push(row); else out.set(key, [row]);
    }
  }
  return out;
}
