import type { Item, PartnerItem } from './types';

/**
 * **품목을 골라 전표 줄로 옮기는 셈.**
 *
 * 화면(품목 선택 팝업)에서 수량을 적은 것만 전표에 담는다. 그런데 두 가지가 얽힌다.
 *
 * ① **단가와 과세는 거래처 단가에서 온다.** 품목 자체의 값이 아니라 그 거래처에 파는 값이다.
 *    거래처 단가가 없으면 빈 칸으로 둔다.
 * ② **거래처에 안 붙은 품목을 고를 수 있다.** 검색하면 전 품목이 뜨기 때문이다.
 *    그때 붙일지 말지를 물어봐야 하고, "아니요"의 뜻은 **발행할 때까지** 지켜져야 한다.
 *
 * 셈만 여기 둔다 — 묻는 것도 쓰는 것도 화면이 한다.
 */
export interface PickRow {
  product?: Item;
  /** 그 거래처 단가 (없으면 빈 껍데기가 온다) */
  pc: PartnerItem;
}

/** 전표에 담길 줄 — 화면의 `ManualRow`와 같은 모양(전부 글자다) */
export interface PickedLine {
  itemId?: string;
  name: string;
  spec: string;
  qty: string;
  price: string;
  isTaxExempt: boolean;
  note: string;
}

export interface PickResult {
  /** 전표에 붙일 줄 */
  toAdd: PickedLine[];
  /** 고르긴 했는데 이 거래처에 안 붙어 있는 것 — 붙일지 물어봐야 한다 */
  unlinked: PickRow[];
}

/** 전표에 담는 값과 거래처에 붙이는 값이 갈리면, 발행할 때 옛 단가로 다시 덮인다. */
function pickedPrice(pc: PartnerItem, edits: Record<string, string>): number | undefined {
  const raw = String(edits[pc.id] ?? pc.price ?? '').replace(/[,\s원]/g, '');
  if (!raw) return undefined;
  const price = Number(raw);
  return Number.isFinite(price) ? price : undefined;
}

/**
 * 수량을 적은 것만 골라 줄로 만든다.
 *
 * @param qtys 품목 id → 수량(글자). 빈 값·0·글자는 안 담는다.
 * @param linkedItemIds 이 거래처에 이미 붙어 있는 품목
 */
export function pickLines(
  qtys: Record<string, string>,
  rows: PickRow[],
  linkedItemIds: Set<string>,
  edits: Record<string, string> = {},
): PickResult {
  const toAdd: PickedLine[] = [];
  const unlinked: PickRow[] = [];
  for (const [itemId, qtyStr] of Object.entries(qtys)) {
    const qty = parseFloat(qtyStr);
    if (!qty) continue;                       // 0·빈 값·글자는 안 담는다
    const row = rows.find(r => r.product?.id === itemId);
    if (!row?.product) continue;
    toAdd.push({
      itemId: row.product.id,
      name: row.product.name,
      spec: row.product.spec || '',
      //  아직 저장 안 한 입력도 담아야, 연결 직후 발행하면서 옛 단가로 되돌리지 않는다.
      price: String(pickedPrice(row.pc, edits) ?? ''),
      qty: String(qty),
      isTaxExempt: row.pc.taxType === '면세',
      note: '',
    });
    if (!linkedItemIds.has(row.product.id)) unlinked.push(row);
  }
  return { toAdd, unlinked };
}

/**
 * **"예"라고 답했을 때 거래처에 붙일 것들.**
 *
 * 팝업에서 단가를 고쳐 놓고 붙이는 경우가 많아서, 고친 값이 있으면 그게 이긴다.
 * (`edits`는 아직 저장 안 한 입력값이다 — 저장 단추를 안 눌러도 붙일 때 같이 들어간다.)
 */
export function linkWrites(
  unlinked: PickRow[],
  partnerId: string,
  dir: 'in' | 'out',
  edits: Record<string, string> = {},
): PartnerItem[] {
  return unlinked.filter(r => r.product).map(r => ({
    id: `${r.product!.id}_${partnerId}_${dir}`,
    itemId: r.product!.id,
    partnerId,
    Direction: dir,
    price: pickedPrice(r.pc, edits) ?? 0,
    taxType: r.pc.taxType ?? '과세',
  } as PartnerItem));
}
