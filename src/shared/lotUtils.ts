import type { Item, RawMaterialLot } from './types';

export interface LotMixSetting {
  topPercent?: number;
  ratios?: { lotId: string; percent: number }[];
}

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
   * (설계: 로컬전용/docs/원료실제원장-로트-원자화-설계.md §6)
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
 * - 혼합(mix) 지정 시: 지정된 여러 active 로트에 비율대로 먼저 배분한다.
 *   예전 topPercent 설정도 상위 2개 비율로 계속 읽는다. 부족분은 FIFO로 이어서 차감한다.
 * 한 로트가 0이 되면 status='depleted'. 잔량이 부족하면 원본 로트 배열을 그대로 돌려준다.
 * 명령을 적용하는 쪽은 shortageKg > 0 을 반드시 거절해야 한다. 음수 이월을 새로 만들면
 * 같은 원료의 실제 재고와 로트가 함께 음수로 내려가던 사고를 되풀이한다.
 * @returns lots(차감 후), distribution(로트별 차감량), shortageKg(부족량)
 */
export function deductFromLots(
  lots: RawMaterialLot[],
  kgToUse: number,
  mix?: LotMixSetting,
): {
  lots: RawMaterialLot[];
  distribution: { lotId?: string; supplierName: string; lotNo?: string; receivedDate?: string; kg: number }[];
  shortageKg: number;
} {
  let remaining = round3(kgToUse);
  // 직접 호출에서 NaN은 부족량 검사도 통과해 로트 잔량까지 NaN으로 번진다.
  // 원자 명령의 검증과 별개로 FIFO 함수 입구에서도 유한한 양수만 받는다.
  if (!Number.isFinite(kgToUse) || !Number.isFinite(remaining) || !(remaining > 0)) {
    throw new RangeError('로트 사용량은 유한한 양수여야 한다');
  }
  const invalidLot = lots.find(lot => lot.status === 'active'
    && !Number.isFinite(Number(lot.kgRemaining ?? 0)));
  if (invalidLot) throw new RangeError(`활성 로트 ${invalidLot.id}의 잔량이 유한한 숫자가 아니다`);
  const availableKg = round3(lots.reduce((sum, lot) =>
    sum + (lot.status === 'active' ? Math.max(0, Number(lot.kgRemaining ?? 0)) : 0), 0));
  if (!Number.isFinite(availableKg)) throw new RangeError('활성 로트의 잔량 합계가 유한한 숫자가 아니다');
  const shortageKg = round3(Math.max(0, remaining - availableKg));
  if (shortageKg > 0) return { lots, distribution: [], shortageKg };
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

  // 혼합: 선택한 여러 로트에 비율 배분 우선. 합계가 100이 아니어도 정규화해 안전하게 처리한다.
  if (mix && activeIdx.length >= 2 && remaining > 0) {
    const configured = (mix.ratios ?? [])
      .map(row => ({ idx: next.findIndex(lot => lot.id === row.lotId), percent: Math.max(0, Number(row.percent) || 0) }))
      .filter(row => activeIdx.includes(row.idx) && row.percent > 0);
    const targets = configured.length >= 2
      ? configured
      : [
          { idx: activeIdx[0], percent: Math.max(0, Math.min(100, mix.topPercent ?? 50)) },
          { idx: activeIdx[1], percent: 100 - Math.max(0, Math.min(100, mix.topPercent ?? 50)) },
        ];
    const percentTotal = targets.reduce((sum, row) => sum + row.percent, 0);
    const total = round3(kgToUse);
    targets.forEach((row, index) => {
      const amount = index === targets.length - 1
        ? round3(total - targets.slice(0, index).reduce((sum, prior) => sum + round3(total * prior.percent / percentTotal), 0))
        : round3(total * row.percent / percentTotal);
      take(row.idx, amount);
    });
  }
  // 나머지(또는 비혼합): FIFO로 잔여 차감
  for (const idx of activeIdx) {
    if (remaining <= 0) break;
    take(idx, remaining);
  }

  return {
    lots: next,
    distribution: dist.map(({ idx, ...d }) => d),
    shortageKg: round3(Math.max(0, remaining)),
  };
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
  carryOver?: { id: string; createdAt: string; receivedDate: string },
): RawMaterialLot[] {
  if (lots.length > 0) return lots;
  const qty = round3(currentQty);
  if (qty <= 0) return lots;
  return [{
    id: carryOver?.id ?? `lot-carry-${material}-${Date.now()}`,
    material,
    supplierName: '이월',
    qtyIn: qty, qtyRemaining: qty, unitKg,
    kgIn: round3(qty * unitKg), kgRemaining: round3(qty * unitKg),
    receivedDate: carryOver?.receivedDate ?? todayStr(),
    status: 'active',
    createdAt: carryOver?.createdAt ?? new Date().toISOString(),
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
