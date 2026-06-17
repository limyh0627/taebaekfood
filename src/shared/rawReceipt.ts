/**
 * 매입 입고 → 원료(raw) 로트 + 수불부 기록 공용 로직.
 * 스캔 입고·선입고·발주 입고확인 등 모든 입고 경로에서 동일하게 사용한다.
 */
import type { Item } from './types';
import { addItem, mutateRawMaterialLots } from './services/firebaseService';
import { RM_LIST, DENSITY, baseRawName, parsePackageKg, lotStockInUnit } from '../constants/formula';
import { withCarryOverLot, buildReceiveLot, receiptToKg, nextLotNo } from './lotUtils';

/**
 * 입고 품목이 어느 원료(raw)에 귀속되는지 해석. RM_LIST에 없거나 대상 raw 품목이 없으면 null.
 * 별도 raw 품목 우선, 없으면 입고품목 자체가 raw면 그것.
 */
export function rawLotTarget(allItems: Item[], product: Item | undefined, itemName: string): { baseName: string; rawItem: Item } | null {
  const baseName = product?.rawMaterialName || baseRawName(itemName);
  if (!RM_LIST.includes(baseName)) return null;
  const rawItem = allItems.find(i => i.category === 'raw' && baseRawName(i.name) === baseName)
               ?? (product?.category === 'raw' ? product : undefined);
  return rawItem ? { baseName, rawItem } : null;
}

/**
 * 매입 입고 1건을 원료(raw)에 반영한다: 로트 생성(+기존재고 이월 보존) + 원료수불부(kg) 기록.
 * 캔/포대 SKU는 품목명 접미사("/16.5kg")가 붙어도 baseRawName으로 매칭하고,
 * 개수 단위는 packageKg(spec 파싱)로 kg 환산한다.
 * @returns recorded=true면 원료로 기록됨(baseName/kgIn 포함)
 */
export async function recordRawMaterialReceipt(opts: {
  allItems: Item[];
  product?: Item;
  itemName: string;
  quantity: number;
  unit?: string;
  partnerId?: string;
  partnerName: string;
  dateStr: string;
  nowIso: string;
  poId?: string;
  addedBy?: string;
}): Promise<{ recorded: boolean; baseName?: string; kgIn?: number; lotted?: boolean }> {
  const { allItems, product, itemName, quantity, unit, partnerId, partnerName, dateStr, nowIso, poId, addedBy } = opts;
  const target = rawLotTarget(allItems, product, itemName);
  if (!target) return { recorded: false };
  const { baseName, rawItem } = target;

  const packageKg = product?.packageKg ?? parsePackageKg(product?.spec) ?? parsePackageKg(itemName);
  const density = DENSITY[baseName] ?? 1.0;
  const u = (unit ?? product?.unit ?? '').toLowerCase();
  const kgIn = receiptToKg({ quantity, unit: u, density, packageKg });

  const newLot = buildReceiveLot({
    material: baseName,
    supplierId: partnerId,
    supplierName: partnerName,
    qtyIn: quantity,
    kgIn,
    packageType: product?.packageType ?? (packageKg && u !== 'kg' && u !== 'l' ? '캔' : undefined),
    packageKg,
    receivedDate: dateStr,
    poId,
  });
  await mutateRawMaterialLots(
    rawItem.id,
    (lots, stock) => [...withCarryOverLot(lots, stock, baseName), { ...newLot, lotNo: nextLotNo(lots, newLot.receivedDate) }],
    (lots) => lotStockInUnit(lots, baseName),
  );

  await addItem('rawMaterialLedger', {
    id: `rm-rcv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    material: baseName,
    date: dateStr,
    received: kgIn,
    used: 0,
    note: `${partnerName} 입고`,
    createdAt: nowIso,
    type: 'manual',
    unit: 'kg',
    ...(packageKg ? { canSize: packageKg, canCount: quantity } : {}),
    ...(product?.packageType ? { canSizeTag: product.packageType } : {}),
    originalAmount: quantity,
    originalUnit: (u === 'l' ? 'L' : 'kg'),
    addedBy,
  });

  return { recorded: true, baseName, kgIn, lotted: true };
}
