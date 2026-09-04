//  **새 주문이 들어왔는지 가려내는 셈**(2026-09-03 사장님).
//  주문은 관리자 앱과 직원 앱 두 곳에서 들어온다. 알림 문서를 따로 쓰는 건
//  관리자 앱뿐이라, 그걸 지켜보면 직원이 넣은 주문은 못 잡는다.
//  그래서 **주문 목록 자체**를 본다.

export interface OrderLike { id: string; createdAt: string }

export interface PickOpts {
  /** 첫 목록을 이미 받아봤는지. 아직이면 아무것도 안 울린다 — 켤 때 지난 주문이 우르르 울리면 안 된다. */
  seeded: boolean;
  /** 이 시각보다 나중에 만들어진 것만. 앱을 켠 시각을 넣는다(옛 주문을 뒤늦게 불러올 때 대비). */
  since: string;
  /** 이 화면에서 방금 내가 넣은 주문 — 내가 넣고 내가 알림받을 일은 없다. */
  mine?: Set<string>;
}

/**
 * 알릴 주문만 골라낸다. **`seen` 은 이 함수가 직접 채운다** — 고른 뒤 또 고르지 않게.
 * @param seen 이미 본 주문 id. 호출한 쪽이 들고 있다가 그대로 다시 넘긴다.
 */
export function pickNewOrders<T extends OrderLike>(orders: T[], seen: Set<string>, opts: PickOpts): T[] {
  const 알릴것: T[] = [];
  for (const o of orders) {
    if (seen.has(o.id)) continue;
    seen.add(o.id);
    if (!opts.seeded) continue;                    // 첫 목록은 통째로 '있던 것'
    if (opts.mine?.has(o.id)) continue;            // 내가 넣은 것
    if (!o.createdAt || o.createdAt < opts.since) continue;  // 옛것을 뒤늦게 불러온 경우
    알릴것.push(o);
  }
  return 알릴것;
}

/** 알림에 띄울 글. 여러 건이 한꺼번에 오면 묶는다. */
export function newOrderMessage(names: string[]): { title: string; body: string } {
  if (names.length === 1) return { title: '🧾 신규 주문', body: `${names[0]} 주문이 들어왔습니다.` };
  return { title: '🧾 신규 주문', body: `${names[0]} 외 ${names.length - 1}건이 들어왔습니다.` };
}
