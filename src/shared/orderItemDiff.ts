import type { OrderItem } from './types';
import { orderItemQuantityLabel } from './orderUnits';

/**
 * **주문 품목이 무엇에서 무엇으로 바뀌었나** — 로그에 적을 한 줄씩.
 *
 * 2026-09-14 사장님: "2번도 했으면 좋겠는데" (= 품목 수량·추가·삭제도 누가 했는지 남기기).
 *
 * 라벨·제조일·비고는 **여기서 안 센다** — 그 셋은 줄 자체에 사람과 시각이 찍히고
 * (`labelBy` · `mfgBy` · `noteBy`), 여기서 또 세면 로그에 같은 일이 두 줄로 선다.
 * 여기는 **수량·단가·품목 교체·줄 추가/삭제**만 본다.
 *
 * 순수 함수다.
 */
export interface OrderItemChange {
  kind: 'add' | 'remove' | 'item' | 'qty' | 'price';
  name: string;
  /** 사람이 읽을 한 줄 — `수량 5박스 → 8박스` */
  text: string;
}

const 이름 = (line: OrderItem) => line.name || line.itemId || '이름 없음';
const 수량글 = (line: OrderItem) => orderItemQuantityLabel(line);
const 돈 = (n: number) => Math.round(Number(n) || 0).toLocaleString();

/**
 * 어느 줄이 어느 줄인가 — **`lineId` 가 먼저다.**
 * 없는 옛 줄은 같은 품목끼리 순서대로 짝지어 본다. 자리(index)로만 맞추면
 * 가운데 줄을 지운 순간 아래가 전부 한 칸씩 밀려 "품목이 바뀌었다"가 우수수 찍힌다.
 */
function 짝짓기(before: OrderItem[], after: OrderItem[]) {
  const 짝: { old?: OrderItem; now?: OrderItem }[] = [];
  const 남은이전 = [...before];
  const 집기 = (고르기: (line: OrderItem) => boolean) => {
    const index = 남은이전.findIndex(고르기);
    return index >= 0 ? 남은이전.splice(index, 1)[0] : undefined;
  };

  for (const now of after) {
    const old = (now.lineId ? 집기(line => line.lineId === now.lineId) : undefined)
      //  `lineId` 가 없는 줄은 같은 품목끼리 — 품목까지 다르면 짝이 아니라 새 줄이다.
      ?? (now.itemId ? 집기(line => !line.lineId && line.itemId === now.itemId) : undefined);
    짝.push({ old, now });
  }
  for (const old of 남은이전) 짝.push({ old, now: undefined });
  return 짝;
}

export function diffOrderItems(before: OrderItem[], after: OrderItem[]): OrderItemChange[] {
  const changes: OrderItemChange[] = [];

  for (const { old, now } of 짝짓기(before ?? [], after ?? [])) {
    if (!old && now) {
      //  고르다 만 빈 줄은 셈에 안 넣는다 — 수정 창에서 '신규 품목 추가'를 누르면
      //  품목을 고르기 전까지 빈 줄이 서 있고, 그대로 저장되는 일은 없다.
      if (!now.itemId) continue;
      changes.push({ kind: 'add', name: 이름(now), text: `품목 추가 — ${이름(now)} ${수량글(now)}` });
      continue;
    }
    if (old && !now) {
      changes.push({ kind: 'remove', name: 이름(old), text: `품목 삭제 — ${이름(old)} ${수량글(old)}` });
      continue;
    }
    if (!old || !now) continue;

    if (old.itemId !== now.itemId) {
      changes.push({ kind: 'item', name: 이름(now), text: `품목 교체 — ${이름(old)} → ${이름(now)}` });
    }
    //  박스 줄은 `quantity`(낱개)와 `boxQuantity`(박스) 둘이 같이 움직인다.
    //  둘 중 하나만 봐도 놓치므로 **사람이 읽는 글자**로 견준다 — 화면과 같은 말이 된다.
    const 이전수량 = 수량글(old);
    const 지금수량 = 수량글(now);
    if (이전수량 !== 지금수량) {
      changes.push({ kind: 'qty', name: 이름(now), text: `수량 — ${이름(now)} ${이전수량} → ${지금수량}` });
    }
    if (Math.round(Number(old.price) || 0) !== Math.round(Number(now.price) || 0)) {
      changes.push({ kind: 'price', name: 이름(now), text: `단가 — ${이름(now)} ${돈(old.price)} → ${돈(now.price)}원` });
    }
  }

  return changes;
}
