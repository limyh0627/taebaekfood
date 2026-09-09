/**
 * 매입 입고 → 원료(raw) 로트 + 수불부 기록 공용 로직.
 * 발주 입고확인·반품 재입고 등 모든 입고 경로에서 동일하게 사용한다.
 * (스캔입고·선입고는 2026-09-03 에 없앴다 — 사장님 판단.)
 */
import type { CompanyId, Item } from './types';
import { companyOf } from './types';
import { executeRawInventoryCommand } from './services/rawInventoryService';
import { RM_LIST, DENSITY, baseRawName, parsePackageKg } from '../constants/formula';
import { itemKg } from './orderUnits';
import { receiptToKg } from './lotUtils';
import { rawHolderByName, rawLedgerKeys, isRawHolder } from './rawHolder';

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
  //  홀더 고르기는 [rawHolder](./rawHolder.ts) 하나가 안다 — 회사를 넘기면 그 회사 것만 고른다.
  //  예전엔 여기서 `?? holders[0]` 로 **남의 회사 홀더를 대신 집었다.**
  const rawItem = rawHolderByName(allItems, baseName, companyId)
               ?? (product && companyId == null && isRawHolder(product) ? product : undefined);
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
  /**
   * 이 입고의 **작업 id**. 같은 id 로 두 번 보내면 수량은 한 번만 움직인다.
   * 안 넘기면 발주(poId)에서 만들고, 그것도 없으면 그때그때 다른 id 가 된다(예전 동작).
   */
  operationId?: string;
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

  /**
   * **로트와 원장을 한 트랜잭션에 넣는다**(설계 §6, 이관 5단계).
   *
   * 예전엔 `mutateRawMaterialLots` 로 로트를 먼저 쓰고 원장을 **따로** 썼다. 뒤가 실패하면
   * 로트만 늘어난 채 조용히 끝났다. 생산완료 주문 304건 중 46건이 이 종류로 기록이 비어
   * 있었다(2026-09-10 조사). 이제 둘이 같이 성공하거나 같이 실패한다.
   *
   * **작업 id 가 중복을 막는다** — 원장 문서 id 가 곧 작업 id 라, 같은 입고를 두 번 보내도
   * 수량은 한 번만 움직인다. 2026-08-06 에 참깨 1500kg 이 **107밀리초 차이로 두 번** 들어간
   * 적이 있는데(`rm-rcv-…697` · `rm-rcv-…804`), 그건 이제 문서 id 가 같아 두 번째가 no-op 이다.
   *
   * 발주(poId)가 없는 손입고는 그때그때 다른 id 라 예전처럼 막지 않는다 —
   * 아래 `처리중` 표가 같은 클릭만 걸러 준다.
   */
  const operationId = opts.operationId
    ?? (poId ? `purchase:${poId}:${rawItem.id}:${dateStr}:${kgIn}` : `receipt:${rawItem.id}:${nowIso}`);

  const r = await executeRawInventoryCommand({
    operationId,
    ...rawLedgerKeys(rawItem),
    materialSnapshot: baseName,
    effectiveDate: dateStr,
    source: { type: 'purchase', id: poId ?? (partnerId ?? partnerName) },
    ...(addedBy ? { actorName: addedBy } : {}),
    kind: 'receive',
    kg: kgIn,
    lot: {
      supplierId: partnerId,
      supplierName: partnerName,
      packageType: product?.packageType ?? (packageKg && u !== 'kg' && u !== 'l' ? '캔' : undefined),
      packageKg,
      qtyIn: quantity,
      poId,
    },
  }, {
    now: nowIso,
    //  로트 id 도 작업 id 에서 뽑는다 — 재시도해도 같은 로트다(트랜잭션 콜백은 여러 번 돈다).
    newLotId: `lot-${operationId}`,
    legacy: {
      note: `${partnerName} 입고`,
      type: 'manual',
      ...(addedBy ? { addedBy } : {}),
      ...(packageKg ? { canSize: packageKg, canCount: quantity } : {}),
      ...(product?.packageType ? { canSizeTag: product.packageType } : {}),
      originalAmount: quantity,
      originalUnit: (u === 'l' ? 'L' : 'kg') as 'kg' | 'L',
    },
  });

  //  거절은 삼키지 않는다 — 예전엔 실패가 콘솔에만 남아 아무도 몰랐다(설계 §14).
  if (r.status === 'rejected') throw new Error(`원료 입고 거절: ${r.reason}`);

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
  /** @deprecated 명령이 품목 문서를 직접 읽어 판정한다 — 안 넘겨도 된다. */
  lotsAreTotal?: boolean;
  /** 이 조정의 **작업 id**. 같은 id 로 두 번 보내면 한 번만 먹는다. 안 넘기면 그때그때 다르다. */
  operationId?: string;
}): Promise<void> {
  const { material, rawItemId, deltaKg, date, note, addedBy, ledger = true, ledgerType = 'correction', companyId } = opts;
  if (Math.abs(deltaKg) < 0.0001) return;

  /**
   * **로트와 원장을 한 트랜잭션에 넣는다**(설계 §6, 이관 5단계).
   *
   * 예전엔 로트를 먼저 쓰고 원장을 따로 썼다 — 뒤가 실패하면 로트만 움직인 채 조용히 끝났다.
   * `lotsAreTotal` 은 이제 안 받는다: 명령이 품목 문서를 직접 읽어 판정한다
   * (부르는 쪽마다 챙기게 했더니 빠뜨리는 자리가 생겼었다).
   *
   * `ledger: false` 로 부르던 자리도 이제 이력은 남는다 — 새 구조에서 이력 문서가 곧
   * **중복 방지 표**라 뺄 수가 없다. 대신 `type: 'correction'` 으로 남겨 옛 집계에서 빠지게 한다.
   */
  const operationId = opts.operationId ?? `adjust:${rawItemId}:${date}:${Date.now()}`;
  const 공통 = {
    operationId,
    companyId: companyOf({ companyId }),
    rawItemId,
    materialSnapshot: material,
    effectiveDate: date,
    ...(addedBy ? { actorName: addedBy } : {}),
    source: { type: 'adjustment' as const, id: operationId },
  };
  const r = await executeRawInventoryCommand(
    deltaKg >= 0
      ? { ...공통, kind: 'receive' as const, kg: deltaKg, lot: { supplierName: note, qtyIn: 0 } }
      : { ...공통, kind: 'consume' as const, kg: -deltaKg },
    {
      newLotId: `lot-${operationId}`,
      carryOverLotId: `carry-${operationId}`,
      legacy: {
        note,
        ...(addedBy ? { addedBy } : {}),
        type: ledger ? ledgerType : ('correction' as const),
      },
    },
  );
  if (r.status === 'rejected') throw new Error(`원료 조정 거절: ${r.reason}`);
}
