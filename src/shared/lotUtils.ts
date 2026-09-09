import type { RawMaterialLot } from './types';
import { today as todayStr } from './day';
import { unitToKg } from '../constants/formula';

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
  if (carryKg <= 0) return lots;
  const now = new Date().toISOString();
  return [{
    id: `lot-carry-${material}-${Date.now()}`,
    supplierName: '이월',
    kgIn: carryKg,
    kgRemaining: carryKg,
    receivedDate: todayStr(),
    status: 'active',
    createdAt: now,
  }];
}

/**
 * 자동 로트번호: 입고일(YYMMDD) + 같은 날 순번(2자리). 예) 2026-06-15 → "260615-01", "260615-02"…
 * 기존 lots 중 같은 날짜 접두사를 가진 번호 개수로 순번을 매김(이월 로트는 번호가 없어 무관).
 */
export function nextLotNo(lots: RawMaterialLot[], receivedDate: string): string {
  const ymd = (receivedDate ?? '').replace(/-/g, '').slice(2); // 2026-06-15 → 260615
  const n = (lots ?? []).filter(l => (l.lotNo ?? '').startsWith(ymd + '-')).length + 1;
  return `${ymd}-${String(n).padStart(2, '0')}`;
}

/** 입고 1건 → 새 로트 1개 생성 (잔여 = 입고량) */
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
   * (설계: docs/원료실제원장-로트-원자화-설계.md §6)
   */
  id?: string;
  /** 만든 시각을 밖에서 정해 넣는다 — 위와 같은 이유. */
  createdAt?: string;
}): RawMaterialLot {
  const now = params.createdAt ?? new Date().toISOString();
  return {
    id: params.id ?? `lot-${params.material}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    material: params.material,
    supplierId: params.supplierId,
    supplierName: params.supplierName,
    packageType: params.packageType,
    packageKg: params.packageKg,
    qtyIn: params.qtyIn,
    kgIn: round3(params.kgIn),
    kgRemaining: round3(params.kgIn),
    receivedDate: params.receivedDate ?? todayStr(),
    status: 'active',
    poId: params.poId,
    createdAt: now,
  };
}

/**
 * 로트 차감.
 * - 기본: 선입선출(FIFO) — 앞쪽 active 로트부터.
 * - 혼합(mix) 지정 시: 상위 2개 active 로트에 비율(topPercent: 첫 로트 %)대로 먼저 배분하고,
 *   부족분은 FIFO로 이어서 차감(한쪽 소진 시 다음 순서로). active 로트가 1개뿐이면 FIFO와 동일.
 * 한 로트가 0이 되면 status='depleted'. 잔량보다 많이 쓰면 실제 공급사 로트는 0에서 정상 소진되고,
 * 초과분은 '이월(미상)' 버킷이 음수로 흡수한다 → 로트 합계가 실제 사용분을 그대로 따라가 수불부와 어긋나지 않음.
 * (음수 이월은 이후 입고 시 settleCarryOver로 상쇄됨)
 * @returns lots(차감 후), distribution(로트별 차감량), shortageKg(이월로 넘어간 초과분)
 */
export function deductFromLots(
  lots: RawMaterialLot[],
  kgToUse: number,
  mix?: { topPercent: number },
  /**
   * 초과 출고 때 새로 세우는 '이월(미상)' 버킷의 id·시각을 밖에서 정한다.
   * 트랜잭션 안에서는 반드시 넘긴다 — 재시도마다 버킷이 하나씩 더 생기면 안 된다(§6).
   */
  carryOver?: { id: string; createdAt: string; receivedDate: string },
): {
  lots: RawMaterialLot[];
  distribution: { lotId?: string; supplierName: string; lotNo?: string; receivedDate?: string; kg: number }[];
  shortageKg: number;
} {
  let remaining = round3(kgToUse);
  const next = lots.map(l => ({ ...l }));
  const dist: { idx: number; lotId?: string; supplierName: string; lotNo?: string; receivedDate?: string; kg: number }[] = [];
  const activeIdx = next
    .map((l, i) => ({ l, i }))
    .filter(x => x.l.status === 'active' && (x.l.kgRemaining ?? 0) > 0)
    .map(x => x.i);

  const take = (idx: number, amount: number) => {
    const l = next[idx];
    const t = Math.min(l.kgRemaining, round3(amount), remaining);
    if (t <= 0) return;
    l.kgRemaining = round3(l.kgRemaining - t);
    remaining = round3(remaining - t);
    if (l.kgRemaining <= 0.0001) { l.kgRemaining = 0; l.status = 'depleted'; }
    const ex = dist.find(d => d.idx === idx);
    if (ex) ex.kg = round3(ex.kg + t);
    else dist.push({ idx, lotId: l.id, supplierName: l.supplierName, lotNo: l.lotNo, receivedDate: l.receivedDate, kg: round3(t) });
  };

  // 혼합: 상위 2개 로트에 비율 배분 우선
  if (mix && activeIdx.length >= 2 && remaining > 0) {
    const total = round3(kgToUse);
    const topAmt = round3(total * Math.max(0, Math.min(100, mix.topPercent)) / 100);
    take(activeIdx[0], topAmt);
    take(activeIdx[1], round3(total - topAmt));
  }
  // 나머지(또는 비혼합): FIFO로 잔여 차감
  for (const idx of activeIdx) {
    if (remaining <= 0) break;
    take(idx, remaining);
  }

  // 초과 출고: 실제 공급사 로트는 0에서 정상 소진, 남은 초과분은 '이월(미상)' 버킷이 음수로 흡수한다.
  //   → 로트 합계가 실제 사용분을 그대로 따라가 원료수불부와 어긋나지 않는다.
  //   → 다음 입고 시 settleCarryOver로 상쇄되어 재고가 맞으면 이월은 0(소진)으로 사라진다.
  const overIssued = round3(Math.max(0, remaining));
  if (overIssued > 0) {
    let bIdx = next.findIndex(l => l.supplierName === '이월');
    if (bIdx < 0) {
      next.push({
        id: carryOver?.id ?? `lot-carry-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        supplierName: '이월', kgIn: 0, kgRemaining: 0,
        receivedDate: carryOver?.receivedDate ?? todayStr(), status: 'active',
        createdAt: carryOver?.createdAt ?? new Date().toISOString(),
      } as RawMaterialLot);
      bIdx = next.length - 1;
    }
    const bucket = next[bIdx];
    bucket.kgRemaining = round3((bucket.kgRemaining ?? 0) - overIssued);
    bucket.status = 'active';
    dist.push({ idx: bIdx, lotId: bucket.id, supplierName: '이월', lotNo: bucket.lotNo, receivedDate: bucket.receivedDate, kg: overIssued });
    remaining = 0;
  }

  return {
    lots: next,
    distribution: dist.map(({ idx, ...d }) => d),
    shortageKg: overIssued,
  };
}

/**
 * 음수 '이월(미상)' 버킷을 양수 가용 로트로 상쇄(net)한다.
 * 초과 출고로 생긴 음수 이월을, 이후 입고된 양수 로트가 FIFO로 갚는다 → 재고가 맞으면 이월 0(소진).
 * 입고·조정 직후 호출한다. 이월이 없거나 양수면 원본을 그대로 반환.
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
export function receiptToKg(params: {
  quantity: number;
  unit?: string;
  density: number;
  packageKg?: number;
}): number {
  const u = (params.unit ?? '').toLowerCase();
  let kg: number;
  if (u === 'kg') kg = params.quantity;
  else if (u === 'l') kg = params.quantity * params.density;
  else if (params.packageKg) kg = params.quantity * params.packageKg;
  else kg = params.quantity;
  return round3(kg);
}

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
}): RawMaterialLot {
  const now = new Date().toISOString();
  const qty = Math.round(params.qtyIn * 1000) / 1000;
  const kg = round3(qty * params.unitKg);
  return {
    id: `lot-${params.itemId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    material: params.material,
    supplierId: params.supplierId,
    supplierName: params.supplierName,
    qtyIn: qty,
    qtyRemaining: qty,
    unitKg: params.unitKg,
    kgIn: kg,
    kgRemaining: kg,
    receivedDate: params.receivedDate ?? todayStr(),
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
): RawMaterialLot[] {
  if (lots.length > 0) return lots;
  const qty = round3(currentQty);
  if (qty <= 0) return lots;
  return [{
    id: `lot-carry-${material}-${Date.now()}`,
    material,
    supplierName: '이월',
    qtyIn: qty, qtyRemaining: qty, unitKg,
    kgIn: round3(qty * unitKg), kgRemaining: round3(qty * unitKg),
    receivedDate: todayStr(),
    status: 'active',
    createdAt: new Date().toISOString(),
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
 * 재고보다 많이 나가면 '이월(미상)' 버킷이 음수로 흡수한다 — 벌크와 같은 규칙이다.
 * 로트를 안 쓰던 시절의 재고가 그대로 남아 있어서(볶음참깨 박스 15개), 로트 도입 직후에는
 * 출고가 로트를 앞지른다. 그걸 막지 않고 **보이게** 두는 쪽이 낫다: 조용히 0에서 멈추면
 * 로트 합계가 실제 출고량과 갈려서 추적 자체를 못 믿게 된다.
 */
export function deductLotsByQty(
  lots: RawMaterialLot[],
  qtyToUse: number,
): { lots: RawMaterialLot[]; distribution: ProductLotTake[]; shortageQty: number } {
  let remaining = round3(qtyToUse);
  const next = lots.map(l => ({ ...l }));
  const dist: ProductLotTake[] = [];
  if (remaining <= 0) return { lots: next, distribution: dist, shortageQty: 0 };

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

  const overIssued = round3(Math.max(0, remaining));
  if (overIssued > 0) {
    let bIdx = next.findIndex(l => l.supplierName === '이월');
    if (bIdx < 0) {
      next.push({
        id: `lot-carry-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        supplierName: '이월', kgIn: 0, kgRemaining: 0, qtyIn: 0, qtyRemaining: 0,
        receivedDate: todayStr(), status: 'active', createdAt: new Date().toISOString(),
      } as RawMaterialLot);
      bIdx = next.length - 1;
    }
    const b = next[bIdx];
    b.qtyRemaining = round3((b.qtyRemaining ?? 0) - overIssued);
    b.kgRemaining = round3((b.qtyRemaining ?? 0) * (b.unitKg ?? 0));
    b.status = 'active';
    dist.push({ lotId: b.id, lotNo: b.lotNo, receivedDate: b.receivedDate, supplierName: '이월', qty: overIssued });
  }

  return { lots: next, distribution: dist, shortageQty: overIssued };
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
