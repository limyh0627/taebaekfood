import { describe, it, expect } from 'vitest';
import { stockMoved, canEditItems, editBlockMessage, blockedEditLine, classifyOrderEdit } from './orderEditGuard';
import type { OrderItem } from './types';

const 주문 = (o: { producedAt?: string; shippedOut?: boolean }) => o;

describe('재고가 이미 움직인 주문인가', () => {
  it('아직 아무것도 안 했으면 고칠 수 있다', () => {
    expect(canEditItems(주문({}))).toBe(true);
    expect(canEditItems(주문({ producedAt: '', shippedOut: false }))).toBe(true);
    expect(canEditItems(undefined)).toBe(true);
  });

  it('생산처리했으면 못 고친다 — 원료·부자재가 이미 빠졌다', () => {
    expect(stockMoved(주문({ producedAt: '2026-09-07T05:58:13.468Z' }))).toBe(true);
    expect(canEditItems(주문({ producedAt: '2026-09-07T05:58:13.468Z' }))).toBe(false);
  });

  it('출고했으면 못 고친다 — 완제품 재고와 로트가 이미 빠졌다', () => {
    expect(canEditItems(주문({ shippedOut: true }))).toBe(false);
  });

  it('되돌린 주문은 다시 고칠 수 있다 — 엔진이 재고를 되돌려 놨다', () => {
    //  reconcileOrderStock 이 되돌릴 때 producedAt='' · shippedOut=false 로 지운다
    expect(canEditItems(주문({ producedAt: '', shippedOut: false }))).toBe(true);
  });
});

describe('막을 때 하는 말', () => {
  it('무엇이 이미 움직였는지 짚어 준다 — "안 됩니다"만 뜨면 우회한다', () => {
    expect(editBlockMessage(주문({ producedAt: 'x' }))).toContain('생산처리');
    expect(editBlockMessage(주문({ shippedOut: true }))).toContain('출고');
    expect(editBlockMessage(주문({ producedAt: 'x', shippedOut: true }))).toContain('생산처리·출고');
  });

  it('무엇을 하면 되는지도 알려 준다', () => {
    expect(editBlockMessage(주문({ shippedOut: true }))).toContain('되돌린');
  });

  it('고칠 수 있는 주문에는 할 말이 없다', () => {
    expect(editBlockMessage(주문({}))).toBe('');
  });
});

/**
 * **줄 단위로 막는다**(2026-09-14 사장님: "비고 다는데 왜 … 변경이 불가능하다는 알림이 떠",
 * "작업완료된게 참기름 골드밖에 없는데 왜 나머지 품목에도 그런 경고가 떠").
 */
describe('blockedEditLine — 어느 줄이 걸리나', () => {
  const 줄 = (부분: Partial<OrderItem> = {}): OrderItem => ({
    lineId: 'L1', itemId: 'p-1', name: '참기름/골드', quantity: 10, price: 1000, ...부분,
  } as OrderItem);
  const 그주문 = (부분: any = {}) => ({
    items: [줄(), 줄({ lineId: 'L2', itemId: 'p-2', name: '들기름' })],
    //  골드만 생산됐다. **`applied` 가 근거다** — 되돌린 줄은 `applied: false` 로 남는다.
    itemInventory: { L1: { lineId: 'L1', applied: true } },
    ...부분,
  });

  it('생산 안 된 줄의 수량은 고칠 수 있다 — 주문 전체를 잠그지 않는다', () => {
    const o = 그주문();
    const 새것 = [줄(), 줄({ lineId: 'L2', itemId: 'p-2', name: '들기름', quantity: 99 })];
    expect(blockedEditLine(o as never, 새것)).toBeNull();
  });

  it('생산된 줄의 수량은 막고, **그 줄 이름**을 알려 준다', () => {
    const o = 그주문();
    const 새것 = [줄({ quantity: 99 }), 줄({ lineId: 'L2', itemId: 'p-2', name: '들기름' })];
    expect(blockedEditLine(o as never, 새것)).toBe('참기름/골드');
  });

  it('**비고는 생산된 줄이라도 달 수 있다** — 재고와 아무 상관이 없다', () => {
    const o = 그주문();
    const 새것 = [줄({ note: '급한 건', noteBy: '남명숙' }), 줄({ lineId: 'L2', itemId: 'p-2', name: '들기름' })];
    expect(blockedEditLine(o as never, 새것)).toBeNull();
  });

  it('라벨·제조일도 마찬가지다', () => {
    const o = 그주문();
    const 새것 = [줄({ labelType: '부착', mfgDate: '2026-09-14' }), 줄({ lineId: 'L2', itemId: 'p-2', name: '들기름' })];
    expect(blockedEditLine(o as never, 새것)).toBeNull();
  });

  /*  2026-09-15: 비고에 '중요' 표시를 만들면서 이 칸을 `재고와무관한칸` 에 안 적었더니,
      생산된 줄에 중요만 체크해도 "이미 생산처리돼서 수량·구성을 고칠 수 없습니다" 가 떴다.
      가드는 설계대로(모르는 칸은 막는 쪽) 동작한 것이라, 새 칸은 반드시 여기서 잠가 둔다. */
  it('비고의 **중요 표시**도 생산된 줄에서 켤 수 있다', () => {
    const o = 그주문();
    const 새것 = [줄({ note: '급한 건', noteImportant: true }), 줄({ lineId: 'L2', itemId: 'p-2', name: '들기름' })];
    expect(blockedEditLine(o as never, 새것)).toBeNull();
  });

  it('라벨·제조일을 **누가 언제** 바꿨는지 찍는 칸도 안 막는다 — 기록일 뿐이다', () => {
    const o = 그주문();
    const 새것 = [
      줄({ labelType: '부착', labelBy: '이실장', labelAt: '2026-09-15T01:00:00.000Z', mfgDate: '2026-09-14', mfgBy: '이실장', mfgAt: '2026-09-15T01:00:00.000Z' }),
      줄({ lineId: 'L2', itemId: 'p-2', name: '들기름' }),
    ];
    expect(blockedEditLine(o as never, 새것)).toBeNull();
  });

  /*  2026-09-15 사장님: "애초에 생산 체크도 안돼있어 완도식품은".
      체크를 풀면 엔진은 줄 기록을 **지우지 않고** `applied: false` 로 표시만 남긴다
      (되돌린 이력을 남겨야 하니까). 그런데 "기록이 있으면 생산됨" 으로 보던 탓에
      **한 번 체크했다 푼 줄이 영영 잠겼다.** 되돌린 줄은 재고가 제자리라 잠글 이유가 없다. */
  it('체크를 **풀어 되돌린 줄**은 다시 고칠 수 있다 — 재고가 제자리로 돌아갔다', () => {
    const o = { ...그주문(), itemInventory: { L1: { lineId: 'L1', applied: false, reversedAt: '2026-09-15T00:00:00.000Z' } } };
    const 새것 = [줄({ quantity: 99 }), 줄({ lineId: 'L2', itemId: 'p-2', name: '들기름' })];
    expect(blockedEditLine(o as never, 새것)).toBeNull();
  });

  it('작업완료 체크는 **여기로 못 지나간다** — 재고를 움직이는 길이 따로 있다', () => {
    const o = 그주문();
    const 새것 = [줄({ checked: true }), 줄({ lineId: 'L2', itemId: 'p-2', name: '들기름' })];
    expect(blockedEditLine(o as never, 새것)).toBe('참기름/골드');
  });

  it('줄을 더하거나 빼면 짝을 못 맞춘다 — 재고가 움직인 주문은 통째로 막는다', () => {
    const o = 그주문({ producedAt: '2026-09-13T00:00:00Z' });
    expect(blockedEditLine(o as never, [줄()])).toBe('주문 전체');
  });

  it('줄 기록이 없는 옛 주문은 주문 단위로 본다 — 근거가 없으니 안전한 쪽으로', () => {
    const o = 그주문({ itemInventory: undefined, producedAt: '2026-09-13T00:00:00Z' });
    const 새것 = [줄({ quantity: 99 }), 줄({ lineId: 'L2', itemId: 'p-2', name: '들기름' })];
    expect(blockedEditLine(o as never, 새것)).toBe('참기름/골드');
  });

  it('아무것도 안 움직인 주문은 뭘 고치든 안 막는다', () => {
    const o = 그주문({ itemInventory: undefined });
    const 새것 = [줄({ quantity: 99 }), 줄({ lineId: 'L2', itemId: 'p-2', name: '들기름' })];
    expect(blockedEditLine(o as never, 새것)).toBeNull();
  });
});

/**
 * **더하기와 빼기는 다르다**(2026-09-15 사장님: "작업완료 주문에 품목추가하면 가드로 막지말고
 * 알람띄우고 기존 완료 품목은 유지한 상태로, 작업중으로 돌려보내 굳이 막을 이유가 없음").
 *
 * 전에는 줄 수가 달라지면 짝을 못 맞춘다며 주문을 통째로 막았다 — 빼는 것과 더하는 것이
 * 같은 취급을 받았다. 더하는 건 재고를 안 건드린다.
 */
describe('손질 갈래 가리기', () => {
  //  붙박이 값은 이 블록 안에 둔다 — 위 블록의 것은 여기서 안 보인다.
  const 줄 = (부분: Partial<OrderItem> = {}): OrderItem => ({
    lineId: 'L1', itemId: 'p-1', name: '참기름/골드', quantity: 10, price: 1000, ...부분,
  } as OrderItem);
  const 그주문 = (부분: Record<string, unknown> = {}) => ({
    items: [줄(), 줄({ lineId: 'L2', itemId: 'p-2', name: '들기름' })],
    itemInventory: { L1: { lineId: 'L1', applied: true } },   // 골드만 생산됐다
    producedAt: '2026-09-15T00:00:00.000Z',
    ...부분,
  });
  const 새품목 = (over: Partial<OrderItem> = {}): OrderItem =>
    ({ lineId: 'L9', itemId: 'p-9', name: '새로 넣은 들기름', quantity: 2, price: 0, ...over } as OrderItem);

  it('생산된 주문에 **줄을 더하면 막지 않고 물어본다**', () => {
    const o = 그주문();
    const 판정 = classifyOrderEdit(o as never, [줄(), 줄({ lineId: 'L2', itemId: 'p-2', name: '들기름' }), 새품목()]);
    expect(판정).toEqual({ kind: 'added', added: ['새로 넣은 들기름'] });
  });

  it('가운데에 끼워 넣어도 더하기다 — 자리로 맞추면 아래가 다 밀려 "다 바뀌었다"가 된다', () => {
    const o = 그주문();
    const 판정 = classifyOrderEdit(o as never, [줄(), 새품목(), 줄({ lineId: 'L2', itemId: 'p-2', name: '들기름' })]);
    expect(판정).toEqual({ kind: 'added', added: ['새로 넣은 들기름'] });
  });

  it('**생산된 줄을 빼면 막는다** — 이미 빠진 재고가 갈 곳을 잃는다', () => {
    const o = 그주문();
    const 판정 = classifyOrderEdit(o as never, [줄({ lineId: 'L2', itemId: 'p-2', name: '들기름' })]);
    expect(판정).toEqual({ kind: 'blocked', line: '참기름/골드' });
  });

  it('생산 안 된 줄은 빼도 된다', () => {
    const o = 그주문();
    const 판정 = classifyOrderEdit(o as never, [줄()]);
    expect(판정).toEqual({ kind: 'ok' });
  });

  it('더하면서 생산된 줄의 수량까지 바꾸면 막는다', () => {
    const o = 그주문();
    const 판정 = classifyOrderEdit(o as never, [줄({ quantity: 99 }), 줄({ lineId: 'L2', itemId: 'p-2', name: '들기름' }), 새품목()]);
    expect(판정).toEqual({ kind: 'blocked', line: '참기름/골드' });
  });

  it('줄 수가 같으면 예전 판정 그대로다', () => {
    const o = 그주문();
    expect(classifyOrderEdit(o as never, [줄({ quantity: 99 }), 줄({ lineId: 'L2', itemId: 'p-2', name: '들기름' })]))
      .toEqual({ kind: 'blocked', line: '참기름/골드' });
    expect(classifyOrderEdit(o as never, [줄({ note: '급함' }), 줄({ lineId: 'L2', itemId: 'p-2', name: '들기름' })]))
      .toEqual({ kind: 'ok' });
  });

  it('아무것도 안 움직인 주문은 뭘 하든 자유다', () => {
    const 맨주문 = { items: [줄()] };
    expect(classifyOrderEdit(맨주문 as never, [줄(), 새품목()])).toEqual({ kind: 'ok' });
  });
});
