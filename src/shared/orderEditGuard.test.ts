import { describe, it, expect } from 'vitest';
import { stockMoved, canEditItems, editBlockMessage } from './orderEditGuard';

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
