import type { RawMaterialLot } from './types';
import { unitToKg } from '../constants/formula';

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const todayStr = () => new Date().toISOString().slice(0, 10);

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
  const carryKg = round3(unitToKg(currentStockUnit, material));
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
}): RawMaterialLot {
  const now = new Date().toISOString();
  return {
    id: `lot-${params.material}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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
 * 선입선출(FIFO) 차감: 배열 앞쪽 active 로트부터 kg을 빼낸다.
 * 한 로트가 0이 되면 status='depleted'. 잔량보다 많이 쓰면 shortageKg로 반환(음수 재고는 안 만듦).
 * @returns lots(차감 후), distribution(어느 로트에서 얼마 뺐는지), shortageKg(부족분)
 */
export function deductFromLots(lots: RawMaterialLot[], kgToUse: number): {
  lots: RawMaterialLot[];
  distribution: { supplierName: string; lotNo?: string; kg: number }[];
  shortageKg: number;
} {
  let remaining = round3(kgToUse);
  const distribution: { supplierName: string; lotNo?: string; kg: number }[] = [];
  const next = lots.map(l => ({ ...l }));
  for (const l of next) {
    if (remaining <= 0) break;
    if (l.status !== 'active' || (l.kgRemaining ?? 0) <= 0) continue;
    const take = Math.min(l.kgRemaining, remaining);
    l.kgRemaining = round3(l.kgRemaining - take);
    remaining = round3(remaining - take);
    if (l.kgRemaining <= 0.0001) { l.kgRemaining = 0; l.status = 'depleted'; }
    distribution.push({ supplierName: l.supplierName, lotNo: l.lotNo, kg: round3(take) });
  }
  return { lots: next, distribution, shortageKg: round3(Math.max(0, remaining)) };
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
