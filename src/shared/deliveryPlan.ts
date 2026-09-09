import type { Order } from './types';
import { OrderStatus } from './types';
import { dateOfLocal } from './day';
import { clusterByGroup, addGroup, removeFromGroups } from './rowGroup';

/**
 * **배송 계획 — 날짜별 순서·오전오후·완료표시.**
 *
 * 2026-09-09 사장님:
 *   · "금일 배송일정이 배송 캘린더의 당일에 해당하는 주문 목록을 받아오도록"
 *   · "당일 말고도 순서랑 날짜 정할 수 있게"
 *   · "자동으로 들어간 애들은 자동으로 표시하고, 누가 바꾸거나 확정한 경우 담당자명·일시"
 *   · "금일 배송순서랑 금일 작업순서에 체크박스 넣어서 다한거 체크"
 *
 * ---
 * **전에는 날짜가 없는 목록 하나였다**(`settings/deliveryOrdering` = `{ordering, timeSlots}`).
 * 그래서 내일 순서를 미리 짤 수가 없었고, 오늘 짠 순서가 날짜가 바뀌어도 그대로 남아
 * 어제 것인지 오늘 것인지 알 수 없었다. **날짜별로 가른다.**
 *
 * **손으로 고른 것과 저절로 들어온 것을 섞지 않는다.** 캘린더에 그 날짜로 잡힌 주문은
 * 아무도 안 건드려도 목록에 뜬다(`자동`). 사람이 순서를 바꾸거나 확정하면 그때부터
 * **그 사람 이름과 시각**이 남는다 — 나중에 "이 순서 누가 정했나"를 물을 데가 있어야 한다.
 *
 * 부수효과 없음(입력 → 값).
 */

/**
 * **같이 나가는 묶음** — 한 차에 싣는 것들(2026-09-09 사장님).
 *
 * 묶음에 든 주문은 목록에서 **붙어 서게** 한다. 흩어져 있으면 "같이 간다"가 안 읽힌다.
 * 자리는 그 묶음의 **제일 앞 사람 자리**다 — 묶는다고 순서가 통째로 뒤집히면 안 된다.
 */
export interface DeliveryGroup {
  id: string;
  /** 안 적으면 화면이 '묶음' 이라고만 쓴다 */
  name?: string;
  orderIds: string[];
}

/** 하루치 계획 */
export interface DayPlan {
  /** 사람이 정한 차례. 여기 없는 자동 주문은 뒤에 붙는다. */
  ordering: string[];
  /** 주문 id → 오전/오후. 없으면 오전. */
  timeSlots: Record<string, '오전' | '오후'>;
  /** 다 한 것 — 체크박스. 주문 상태와 별개다(실었지만 아직 출고 처리를 안 한 사이) */
  done: string[];
  /** 누가 마지막으로 손댔나. 아무도 안 건드렸으면 없다 = 자동. */
  by?: { name: string; at: string };
  /** 같이 나가는 묶음들 */
  groups?: DeliveryGroup[];
}

/** `settings/deliveryOrdering` 문서 전체 */
export interface DeliveryPlanDoc {
  /** 날짜별 계획 — 'YYYY-MM-DD' */
  byDate?: Record<string, DayPlan>;
  /** ── 옛 모양(날짜 없음) ── 읽을 때만 본다. 쓸 때는 byDate 로만 쓴다. */
  ordering?: string[];
  timeSlots?: Record<string, '오전' | '오후'>;
}

export const EMPTY_PLAN: DayPlan = { ordering: [], timeSlots: {}, done: [] };

/**
 * 그 날짜의 계획을 꺼낸다.
 *
 * **옛 모양은 그날 것으로 쳐서 읽는다** — 날짜가 없던 목록은 "지금 짜 둔 순서"였으니
 * 오늘 것으로 보는 게 맞다. 옮겨 적지는 않는다(읽을 때만 물러선다). 사람이 한 번
 * 손대면 그때 byDate 로 저장되면서 저절로 옮겨진다.
 */
export function planFor(doc: DeliveryPlanDoc | undefined, dateStr: string, todayStr: string): DayPlan {
  const 있는것 = doc?.byDate?.[dateStr];
  if (있는것) return { ...EMPTY_PLAN, ...있는것 };
  if (dateStr === todayStr && (doc?.ordering?.length || doc?.timeSlots)) {
    return { ordering: doc.ordering ?? [], timeSlots: doc.timeSlots ?? {}, done: [] };
  }
  return EMPTY_PLAN;
}

/** 그 날짜 계획을 바꾼 새 문서. **다른 날짜는 안 건드린다.** */
export function withPlan(
  doc: DeliveryPlanDoc | undefined,
  dateStr: string,
  plan: DayPlan,
): DeliveryPlanDoc {
  //  옛 칸(ordering·timeSlots)은 그대로 둔다 — 아직 안 옮긴 다른 날짜가 그걸 읽고 있을 수 있다
  return { ...(doc ?? {}), byDate: { ...(doc?.byDate ?? {}), [dateStr]: plan } };
}

/** 사람이 손댔다는 도장 — 이게 찍히면 '자동' 대신 이름·시각이 뜬다 */
export const stamp = (name: string, now = new Date()): DayPlan['by'] =>
  ({ name, at: now.toISOString() });

/** 배송 목록에 오를 자격 — 생산기록 가짜 주문과 이미 끝난 주문은 뺀다 */
const 배송대상 = (o: Order): boolean =>
  o.partnerName !== '생산기록' && o.status !== OrderStatus.DELIVERED;

export interface DayRow {
  orderId: string;
  /** 사람이 넣은 게 아니라 캘린더에서 저절로 들어온 줄 */
  auto: boolean;
  slot: '오전' | '오후';
  done: boolean;
  /** 같이 나가는 묶음 — 없으면 혼자 간다 */
  groupId?: string;
  groupName?: string;
  /** 묶음 안에서 첫 줄·끝 줄인가 — 화면이 이걸로 이음선을 그린다 */
  groupFirst?: boolean;
  groupLast?: boolean;
}

/**
 * 그 날짜에 보일 줄들 — **사람이 정한 차례가 먼저, 캘린더에서 온 것이 뒤.**
 *
 * 캘린더(주문의 납품일)에 그 날짜로 잡힌 주문은 아무도 안 건드려도 뜬다. 그게 `auto` 다.
 * 사람이 순서를 바꾸면 그 주문이 `ordering` 에 들어가면서 `auto` 가 떨어진다.
 *
 * **없어진 주문은 조용히 빠진다** — 지웠거나 배송완료된 주문 id 가 순서에 남아 있어도
 * 줄로 만들지 않는다(전에는 화면마다 따로 걸러서 어떤 데는 남고 어떤 데는 빠졌다).
 */
export function dayRows(input: {
  plan: DayPlan;
  orders: readonly Order[];
  dateStr: string;
}): DayRow[] {
  const { plan, orders, dateStr } = input;
  const 살아있나 = new Set(orders.filter(배송대상).map(o => o.id));
  const done = new Set(plan.done ?? []);
  const 줄만들기 = (orderId: string, auto: boolean): DayRow => ({
    orderId, auto,
    slot: plan.timeSlots?.[orderId] === '오후' ? '오후' : '오전',
    done: done.has(orderId),
  });

  const 손으로 = (plan.ordering ?? []).filter(id => 살아있나.has(id));
  const 넣은것 = new Set(손으로);
  const 저절로 = orders
    .filter(o => 배송대상(o) && !넣은것.has(o.id) && dateOfLocal(o.deliveryDate) === dateStr)
    .map(o => o.id);

  const 늘어놓기 = [...손으로.map(id => 줄만들기(id, false)), ...저절로.map(id => 줄만들기(id, true))];
  return 묶어세우기(늘어놓기, plan.groups ?? []);
}

/**
 * 묶은 것끼리 붙여 세운다 — **규칙은 [rowGroup.clusterByGroup](./rowGroup.ts) 한 곳**이다.
 * 작업순서(품목 단위)도 같은 규칙을 쓴다. 두 벌로 두면 갈린다.
 */
function 묶어세우기(rows: DayRow[], groups: readonly DeliveryGroup[]): DayRow[] {
  if (groups.length === 0) return rows;
  const 어느묶음 = new Map<string, DeliveryGroup>();
  for (const g of groups) for (const id of g.orderIds) 어느묶음.set(id, g);
  return clusterByGroup(rows, r => r.orderId, id => 어느묶음.get(id));
}

/** 고른 것들을 한 묶음으로. 이미 다른 묶음에 있던 건 거기서 빠진다 — 한 사람은 한 차만 탄다. */
export function withGroup(plan: DayPlan, orderIds: readonly string[], name?: string, id = `g-${Date.now()}`): DayPlan {
  const 담기 = (g: DeliveryGroup) => ({ ...g, memberIds: g.orderIds });
  const 풀기 = (g: { id: string; name?: string; memberIds: string[] }): DeliveryGroup =>
    ({ id: g.id, ...(g.name ? { name: g.name } : {}), orderIds: g.memberIds });
  const next = addGroup((plan.groups ?? []).map(담기), orderIds, g => ({ ...풀기(g), memberIds: g.memberIds }), name, id);
  return { ...plan, groups: next.map(풀기) };
}

/** 이 주문을 묶음에서 뺀다. 한 명만 남으면 그 묶음도 없앤다. */
export function ungroup(plan: DayPlan, orderId: string): DayPlan {
  const next = removeFromGroups((plan.groups ?? []).map(g => ({ ...g, memberIds: g.orderIds })), orderId);
  return { ...plan, groups: next.map(g => ({ id: g.id, ...(g.name ? { name: g.name } : {}), orderIds: g.memberIds })) };
}

/** 오전/오후로 가른다 — 화면이 두 묶음으로 그린다 */
export const bySlot = (rows: readonly DayRow[]) => ({
  오전: rows.filter(r => r.slot === '오전'),
  오후: rows.filter(r => r.slot === '오후'),
});

/**
 * 이 줄을 누가 정했나 — 화면에 그대로 찍는 글.
 * 아무도 안 건드린 날은 `자동`, 손댄 날은 `이름 · 9/9 14:30`.
 */
export function 정한이(plan: DayPlan): string {
  if (!plan.by?.name) return '자동';
  const t = new Date(plan.by.at);
  if (Number.isNaN(t.getTime())) return plan.by.name;
  return `${plan.by.name} · ${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
}

/** 체크를 켜고 끈 새 계획 */
export function toggleDone(plan: DayPlan, orderId: string): DayPlan {
  const has = (plan.done ?? []).includes(orderId);
  return { ...plan, done: has ? plan.done.filter(x => x !== orderId) : [...(plan.done ?? []), orderId] };
}
