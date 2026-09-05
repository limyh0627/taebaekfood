import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * **박스를 푸는 셈이 또 두 벌이 되는 걸 막는다.**
 *
 * 2026-09-05, 주문에 적힌 박스 단가를 개입수로 나누는 고침을 `statementLines` 에
 * 넣었는데, [TradeStatement](../../components/TradeStatement.tsx) 의 `orderToRows` 에
 * **같은 셈이 한 벌 더 있어서** 거기는 열 배로 남아 있었다. 손으로 옮겨 적은 코드는
 * 한쪽만 고쳐진다. 화면이 공용 함수를 지나는지 글자로 확인한다.
 */
const 화면 = readFileSync('components/TradeStatement.tsx', 'utf8');

describe('박스 푸는 셈은 shared/statementLines 만 안다', () => {
  it('화면이 resolveOrderItem 을 쓴다', () => {
    expect(화면).toContain('resolveOrderItem');
  });

  it('화면이 단가를 손으로 고르지 않는다 — orderItemPrice 를 쓴다', () => {
    expect(화면).toContain('orderItemPrice');
  });

  it('화면에 개입수를 손으로 곱하는 줄이 없다', () => {
    //  `qty = boxCount * uc.count` 같은 것. 있으면 셈이 또 갈린 것이다.
    const 손으로 = 화면.split('\n').filter(l =>
      /\*\s*uc\.count|uc\.count\s*\*/.test(l) && !l.trimStart().startsWith('//'));
    expect(손으로, `개입수를 손으로 곱하는 줄:\n${손으로.join('\n')}`).toEqual([]);
  });

  it('화면에 주문 단가로 물러서는 줄이 없다 — 나누지 않으면 열 배가 된다', () => {
    //  `?? item.price ??` 로 물러서는 자리. 공용 함수만 그 판단을 해야 한다.
    const 손으로 = 화면.split('\n').filter(l =>
      /\?\?\s*item\.price\s*\?\?/.test(l) && !l.trimStart().startsWith('//'));
    expect(손으로, `주문 단가로 물러서는 줄:\n${손으로.join('\n')}`).toEqual([]);
  });
});
