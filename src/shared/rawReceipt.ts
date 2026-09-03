/**
 * 매입 입고 → 원료(raw) 로트 + 수불부 기록 공용 로직.
 * 발주 입고확인·반품 재입고 등 모든 입고 경로에서 동일하게 사용한다.
 * (스캔입고·선입고는 2026-09-03 에 없앴다 — 사장님 판단.)
 */
import type { CompanyId, Item } from './types';
import { companyOf } from './types';
import { addItem, mutateRawMaterialLots } from './services/firebaseService';
import { RM_LIST, DENSITY, baseRawName, parsePackageKg, lotStockInUnit } from '../constants/formula';
import { itemKg } from './orderUnits';
import { withCarryOverLot, buildReceiveLot, receiptToKg, nextLotNo, deductFromLots, settleCarryOver } from './lotUtils';

/**
 * 입고 품목이 어느 원료(raw)에 귀속되는지 해석. RM_LIST에 없거나 대상 raw 품목이 없으면 null.
 * 별도 raw 품목 우선, 없으면 입고품목 자체가 raw면 그것.
 */
export function rawLotTarget(
  allItems: Item[],
  product: Item | undefined,
  itemName: string,
  /**
   * 어느 회사 창고로 들어가나. 같은 원료를 두 회사가 각자 들고 있으면(깨분처럼)
   * 이걸 안 넘길 때 **먼저 걸리는 쪽**으로 들어가 남의 회사 로트가 늘어난다.
   * 안 넘기면 예전대로 이름만 보고 고른다.
   */
  companyId?: CompanyId,
): { baseName: string; rawItem: Item } | null {
  const baseName = product?.rawMaterialName || baseRawName(itemName);
  if (!RM_LIST.includes(baseName)) return null;
  const isHolder = (c?: string, u?: string) => c === 'raw' || (c === 'wip' && u !== '개');
  const holders = allItems.filter(i => isHolder(i.type, i.unit) && baseRawName(i.name) === baseName);
  const rawItem = (companyId ? holders.find(i => companyOf(i) === companyId) : undefined)
               ?? holders[0]
               ?? (isHolder(product?.type, product?.unit) ? product : undefined);
  return rawItem ? { baseName, rawItem } : null;
}

/**
 * **같은 입고가 겹쳐 들어오는 것을 막는다.**
 *
 * 2026-08-06 에 참깨 1500kg 이 두 번 들어갔다 — 원장 두 줄(`rm-rcv-…697` · `rm-rcv-…804`,
 * **107밀리초 차이**)에 로트도 둘(`260806-02` · `260806-03`). 같은 클릭이 두 번 돈 것이다.
 *
 * 차감 쪽은 원장 줄 id 가 `rm-auto-{주문}-{원료}` 로 고정이라 두 번 처리해도 덮어써진다.
 * 그런데 **입고 쪽은 `rm-rcv-{지금}-{난수}`** 라 부를 때마다 새 줄이 선다.
 * 로트도 같이 하나 더 서서, 원료가 실제보다 많이 들어온 것으로 남는다.
 *
 * 부르는 자리가 셋이라(발주 입고확인·반품 재입고 둘) 화면마다 막으면
 * 언젠가 하나를 빠뜨린다. **여기서 막는다** — `orderStockEngine.changeOrderStatus` 와 같은 수다.
 *
 * 표는 일이 끝나면 지운다. 나중에 같은 입고를 **정말로 또 하는 것**(분할 입고)은 막지 않는다.
 */
const 처리중 = new Set<string>();

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
  /** 어느 회사 창고로 들어가나. 로트를 고를 때도, 원장 줄에 박을 때도 쓴다. */
  companyId?: CompanyId;
}): Promise<{ recorded: boolean; baseName?: string; kgIn?: number; lotted?: boolean }> {
  const { allItems, product, itemName, quantity, unit, partnerId, partnerName, dateStr, nowIso, poId, addedBy, companyId } = opts;
  const target = rawLotTarget(allItems, product, itemName, companyId);
  if (!target) return { recorded: false };
  const { baseName, rawItem } = target;

  //  같은 원료·같은 날·같은 수량·같은 거래처가 아직 처리 중이면 두 번째는 돌려보낸다
  const 표 = `${rawItem.id}|${dateStr}|${quantity}|${partnerId ?? partnerName}|${poId ?? ''}`;
  if (처리중.has(표)) return { recorded: false };
  처리중.add(표);
  try {

  /*
   * 포장 1개가 몇 kg인가 — **박스면 개입수까지 곱해야 한다.**
   * 규격은 '낱개 용량 * 개입수' 꼴이라(`1kg * 10`) 앞자리만 읽으면 낱개 용량이다.
   * 그대로 쓰면 10kg 박스 95개가 95kg으로 들어온다(열 배 적게).
   * 같은 계산이 이미 itemKg에 있다 — 두 군데서 따로 세면 언젠가 갈린다.
   */
  const packageKg = product ? (itemKg(product) || undefined) : parsePackageKg(itemName);
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
    // 입고 로트 추가 후, 음수 이월(미상)이 있으면 이 입고로 먼저 상쇄(net)한다.
    (lots, stock) => settleCarryOver([...withCarryOverLot(lots, stock, baseName), { ...newLot, lotNo: nextLotNo(lots, newLot.receivedDate) }]),
    // 로트가 포장분까지 세는 원료는 stock을 안 덮어쓴다 — 벌크 재고는 따로 세는 숫자다
    rawItem.lotsAreTotal ? undefined : (lots) => lotStockInUnit(lots, baseName),
  );

  await addItem('rawMaterialLedger', {
    id: `rm-rcv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    material: baseName,
    ...(companyId ? { companyId } : {}),
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
  } finally {
    처리중.delete(표);
  }
}

/**
 * 원료(raw) 재고를 kg 단위 delta만큼 조정한다: 양수=조정 로트 추가, 음수=FIFO 차감(기존재고 이월 보존).
 * 재고조정/정정 경로에서 stock 직접 갱신 대신 사용 → lots·stock·수불부가 항상 함께 움직인다.
 * @param ledger false면 수불부 전표는 남기지 않는다(호출부에서 이미 기록한 경우).
 */
export async function adjustRawLots(opts: {
  material: string;      // baseName
  rawItemId: string;
  deltaKg: number;       // + 추가 / - 차감
  date: string;
  note: string;
  addedBy?: string;
  ledger?: boolean;      // 기본 true
  /**
   * 원장에 어떤 줄로 남길지. 기본은 '정정'(재고조정·실사).
   *
   * **실제로 일어난 입출고는 'auto'로 넘겨야 한다.** 정정으로 남기면
   *   · 사용량 집계에서 빠진다 — 정정은 입고·사용이 아니라서(RawLedgerList)
   *   · 같은 날 묶음이 정정 앞뒤로 끊긴다 — 무엇이 정정 대상인지 보이게 하려고
   * 그래서 OEM 외주출고 1,500kg이 사용에 안 잡히고 그날 입고가 두 줄로 갈렸다.
   */
  ledgerType?: 'auto' | 'manual' | 'correction';
  /** 어느 회사 창고인가 — 안 박으면 그 회사 수불부에서 사라진다 */
  companyId?: CompanyId;
  /** 로트가 포장분까지 세는 원료면 true — stock을 안 덮어쓴다 (Item.lotsAreTotal) */
  lotsAreTotal?: boolean;
}): Promise<void> {
  const { material, rawItemId, deltaKg, date, note, addedBy, ledger = true, ledgerType = 'correction', companyId, lotsAreTotal } = opts;
  if (Math.abs(deltaKg) < 0.0001) return;
  await mutateRawMaterialLots(
    rawItemId,
    (lots, stock) => {
      const carried = withCarryOverLot(lots, stock, material);
      if (deltaKg >= 0) {
        const lot = buildReceiveLot({ material, supplierName: note, qtyIn: 0, kgIn: deltaKg, receivedDate: date });
        // 조정 입고 후 음수 이월(미상) 상쇄
        return settleCarryOver([...carried, { ...lot, lotNo: nextLotNo(carried, lot.receivedDate) }]);
      }
      return deductFromLots(carried, -deltaKg).lots;
    },
    lotsAreTotal ? undefined : (lots) => lotStockInUnit(lots, material),
  );
  if (ledger) {
    await addItem('rawMaterialLedger', {
      id: `rm-adj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      material, date, ...(companyId ? { companyId } : {}),
      received: deltaKg > 0 ? deltaKg : 0,
      used: deltaKg < 0 ? -deltaKg : 0,
      note, type: ledgerType, unit: 'kg', addedBy,
      createdAt: new Date().toISOString(),
    });
  }
}
