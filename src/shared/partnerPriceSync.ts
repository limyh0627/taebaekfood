import type { PartnerItem, Item } from './types';

/**
 * **전표에 찍힌 단가·계정을 거래처 단가로 되민다.**
 *
 * 전표를 끊을 때 손으로 고친 값이 진짜다 — 그걸 거래처 단가에 되밀어야 다음 전표가
 * 그 값으로 열린다. 안 되밀면 매번 같은 값을 다시 고쳐야 한다.
 *
 * ---
 * **발행이든 수정이든 같은 일이다.** 그런데 화면에는 이게 **세 벌**로 쓰여 있었고
 * (발행-매출 · 발행-매입 · 수정-매입) 세 벌이 서로 달랐다.
 *
 *   ① 수정 경로가 `noLinkIds`를 안 봤다 — 품목을 고를 때 "거래처에 연결할까요?"에
 *      **아니요**를 눌러도, 그 전표를 고쳐 저장하면 결국 연결됐다.
 *   ② 수정 경로에 **매출이 통째로 없었다** — 매출 전표를 고쳐 단가를 바꿔도
 *      거래처 단가는 옛 값 그대로였다. 매입만 따라갔다.
 *
 * 주석은 "markIssued와 동일"이라고 적혀 있었다. 동일하다고 적어 놓고 복사한 것이
 * 갈린 것이다. 그래서 셈을 여기 한 곳으로 모은다.
 *
 * ---
 * 이 함수는 **쓰지 않는다.** 무엇을 써야 하는지만 돌려준다 — 그래야 시험할 수 있다.
 */
export interface PriceSyncLine {
  name: string;
  price?: number;
  accountCode?: string;
  isTaxExempt?: boolean;
}

export interface PriceSyncInput {
  type: '매출' | '매입' | string;
  partnerId: string;
  lines: PriceSyncLine[];
  /** 품목 원장 — 줄의 이름으로 품목을 되찾는다 */
  items: Pick<Item, 'id' | 'name' | '품목'>[];
  /** 이미 저장돼 있는 거래처 단가 (그 방향 것만 넘겨도 되고 전부 넘겨도 된다) */
  partnerItems: PartnerItem[];
  /**
   * 품목을 고를 때 **"이번 전표에만"**이라고 답한 것들.
   * 발행이든 수정이든 그 뜻을 지킨다 — 한쪽만 지키면 지키는 시늉이다.
   */
  noLinkIds?: Set<string>;
}

export interface PriceSyncResult {
  upserts: PartnerItem[];
  /** 매입만 — 원가는 산 값에서 온다 */
  costUpdates: { itemId: string; price: number }[];
}

export function partnerPriceWrites(input: PriceSyncInput): PriceSyncResult {
  const { type, partnerId, lines, items, partnerItems, noLinkIds } = input;
  const out: PriceSyncResult = { upserts: [], costUpdates: [] };
  if (!partnerId || (type !== '매출' && type !== '매입')) return out;

  const dir: 'in' | 'out' = type === '매출' ? 'out' : 'in';
  const book = partnerItems.filter(p => p.Direction === dir);

  for (const line of lines) {
    const price = Number(line.price ?? 0);
    if (!(price > 0)) continue;
    const product = items.find(p => p.name === line.name || p.품목 === line.name);
    if (!product) continue;
    if (noLinkIds?.has(product.id)) continue;

    const prev = book.find(s => s.itemId === product.id && s.partnerId === partnerId);
    /**
     * **매출만 '바뀐 것'을 가린다.**
     *
     * 매입은 가드 없이 늘 쓴다 — 구독(partnerItems)이 늦게 도착하면 직전 저장값과의
     * 비교가 빗나가 저장이 통째로 누락되던 자리다. 매입 단가는 원가로도 흘러가서
     * 한 번 새면 재고 평가까지 틀어진다. 한 번 더 쓰는 쪽이 싸다.
     */
    if (type === '매출') {
      const changed = !prev || prev.price !== price
        || !!(line.accountCode && prev.Account_Code !== line.accountCode);
      if (!changed) continue;
    }

    out.upserts.push({
      ...(prev ?? {}),
      id: prev?.id ?? `${product.id}_${partnerId}_${dir}`,
      itemId: product.id,
      partnerId,
      Direction: dir,
      price,
      //  전표에 찍힌 과세/면세를 단가와 **같이** 저장한다 — 예전엔 옛 값을 물려주기만 해서,
      //  전표에서 면세로 끊어도 거래처엔 과세로 남아 다음 전표가 또 과세로 열렸다.
      taxType: line.isTaxExempt ? '면세' : '과세',
      Account_Code: line.accountCode || prev?.Account_Code,
    } as PartnerItem);

    if (type === '매입') out.costUpdates.push({ itemId: product.id, price });
  }
  return out;
}
