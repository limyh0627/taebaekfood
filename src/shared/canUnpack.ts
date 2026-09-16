import type { Item } from './types';
import { bomOf } from './bomIndex';
import { isBulkItem } from './itemTaxonomy';

/**
 * **캔을 까서 벌크로 되돌린다.**
 *
 * 2026-09-16 사장님: "품목에서 캔 종류를 보통 벌크로 까서 포장하는 경우가 많은데
 * 이건 박스처럼 개봉해서 벌크로 전환하는 느낌으로 가야하나", "캔 품목은 반제품으로
 * 넣긴할거야 반제품 상태에서도 판매 가능하잖아".
 *
 * ---
 * **두 방향은 다른 일이다.**
 *
 *   벌크 → 캔   **생산**이다. 공캔·뚜껑이 들어가고 사람 손이 든다.
 *               새로 만들 것이 없다 — BOM 과 생산 기능이 이미 한다.
 *   캔 → 벌크   **재포장**이다. 아무것도 안 들어가고 형태만 돌아간다.
 *               여기가 이 파일이 맡는 일이다.
 *
 * 그래서 이 둘은 **서로의 되돌리기가 아니다.** 잘못 깠으면 `개봉 취소`로 무르는 것이지,
 * 캔을 다시 생산해서 숫자를 맞추면 안 된다 — 개수는 맞아도 로트가 뒤엉킨다.
 *
 * ---
 * **왜 품목에 표시를 두나 — BOM 으로는 못 가리기 때문이다.**
 *
 * 처음엔 박스 개봉(`orderUnits.unpackComponent`)처럼 구성으로 판정하려 했다.
 * 그런데 운영 데이터로 재 보니 **158개**가 걸렸다. `참기름/병/350ml` 도 캔과 똑같이
 * `벌크 0.321L + 병 1 + 캡 1` 이라, 구성만 봐서는 캔과 소매 병이 구별되지 않는다.
 * 라벨 붙여 밀봉한 350ml 병을 까서 벌크로 되돌리는 일은 없다.
 *
 * **짐작하면 158개에 개봉 단추가 뜬다.** 그래서 사람이 켠 것만 깐다(`Item.unpackable`).
 * 대신 **무엇이 얼마나 나오는지는 짐작하지 않는다** — BOM 이 근거다.
 */

/** 개봉 한 번으로 일어나는 일 전부. 화면이 이걸 그대로 읽어 사람에게 보여 준다. */
export interface UnpackPlan {
  /** 깔 품목 */
  canItemId: string;
  canName: string;
  /** 몇 개를 까나 */
  cans: number;
  /** 되돌아오는 벌크 */
  bulkItemId: string;
  bulkName: string;
  bulkUnit: string;
  /** 1개를 까면 나오는 벌크 양 */
  perCan: number;
  /** 되돌아오는 벌크 총량 = `perCan × cans` */
  bulkQty: number;
  /**
   * **같이 없어지는 부자재** — 공캔·뚜껑·라벨.
   *
   * 되돌아오지 **않는다.** 깐 캔은 버린다. 이걸 재고로 되돌리면 다음 생산 때
   * 있지도 않은 공캔을 집어 쓰게 된다. 보여만 주고 재고는 안 건드린다.
   */
  discarded: { itemId: string; name: string; qty: number }[];
}

/** 왜 못 까는가 — 화면이 문구를 뜯어보지 않게 이유를 나눠 준다. */
export type UnpackReject =
  | 'NOT_MARKED'      // 품목에 '개봉 가능'이 안 켜져 있다
  | 'NO_BULK'         // 구성에 벌크가 없다 — 무엇으로 되돌릴지 모른다
  | 'MANY_BULKS'      // 벌크가 여럿이다 — 섞인 것은 못 되돌린다
  | 'ZERO_PER_CAN'    // 1개당 나오는 양이 0 이다
  | 'BAD_COUNT'       // 깔 개수가 1 보다 작다
  | 'NOT_ENOUGH';     // 깔 재고가 모자란다

export type UnpackResult =
  | { ok: true; plan: UnpackPlan }
  | { ok: false; reason: UnpackReject };

/**
 * 이 품목에 개봉 단추를 달 것인가.
 *
 * **표시와 구성이 둘 다 맞아야 한다.** 표시만 켜고 구성이 없으면 깠을 때
 * 아무 데도 안 들어간다 — 그러면 재고가 그냥 사라진다.
 */
export function isUnpackable(item: Item | undefined): boolean {
  return unpackPlan(item, 1).ok;
}

/**
 * 개봉 한 번을 셈한다. **재고는 안 건드린다** — 셈만 한다.
 *
 * 재고가 모자란지까지 보려면 `stock` 을 준다. 안 주면 개수만 본다
 * (단추를 달지 말지 정할 때는 재고를 안 본다 — 0개여도 단추는 보이고, 눌렀을 때 막는다).
 */
export function unpackPlan(item: Item | undefined, cans: number, stock?: number): UnpackResult {
  if (!item?.unpackable) return { ok: false, reason: 'NOT_MARKED' };
  if (!Number.isFinite(cans) || cans < 1) return { ok: false, reason: 'BAD_COUNT' };

  const lines = bomOf(item.id).filter(l => !!l.child);
  //  **벌크는 subtype 이 정한다**(`itemTaxonomy.isBulkItem`) — 단위('개'·'kg')로 가르면
  //  품목 단위를 정리하려고 글자 하나 고쳤을 때 개봉 수식이 조용히 바뀐다.
  const bulks = lines.filter(l => isBulkItem(l.child));
  if (!bulks.length) return { ok: false, reason: 'NO_BULK' };
  if (bulks.length > 1) return { ok: false, reason: 'MANY_BULKS' };

  const bulk = bulks[0];
  const perCan = Number(bulk.qty);
  if (!Number.isFinite(perCan) || perCan <= 0) return { ok: false, reason: 'ZERO_PER_CAN' };

  if (stock !== undefined && stock < cans) return { ok: false, reason: 'NOT_ENOUGH' };

  return {
    ok: true,
    plan: {
      canItemId: item.id,
      canName: item.name,
      cans,
      bulkItemId: bulk.childId,
      bulkName: bulk.child!.name,
      bulkUnit: bulk.child!.unit ?? 'kg',
      perCan,
      //  **소수 셋째 자리까지** — 로트도 이 자리에서 반올림하며 돈다(rawInventoryCore).
      //  여기서 더 길게 들고 있으면 로트 합계와 몇 g 씩 어긋난다.
      bulkQty: Math.round(perCan * cans * 1000) / 1000,
      discarded: lines
        .filter(l => l !== bulk && l.child!.type === 'submaterial' && !isBulkItem(l.child))
        .map(l => ({ itemId: l.childId, name: l.child!.name, qty: Math.round(Number(l.qty) * cans * 1000) / 1000 }))
        .filter(d => d.qty > 0),
    },
  };
}

/** 사람에게 보여 줄 한 줄 — 확인 알림과 기록이 **같은 글**을 쓴다. */
export function unpackSummary(plan: UnpackPlan): string {
  return `${plan.canName} −${plan.cans}개 → ${plan.bulkName} +${plan.bulkQty}${plan.bulkUnit}`;
}
