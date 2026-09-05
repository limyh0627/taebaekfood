import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';

/**
 * **박스를 푸는 셈이 또 두 벌이 되는 걸 막는다.**
 *
 * 2026-09-05, 주문에 적힌 박스 단가를 개입수로 나누는 고침을 `statementLines` 에
 * 넣었는데, [TradeStatement](../../components/TradeStatement.tsx) 의 `orderToRows` 에
 * **같은 셈이 한 벌 더 있어서** 거기는 열 배로 남아 있었다. 손으로 옮겨 적은 코드는
 * 한쪽만 고쳐진다. 화면이 공용 함수를 지나는지 글자로 확인한다.
 */
const 화면 = readFileSync('components/TradeStatement.tsx', 'utf8');

/**
 * 박스 푸는 셈을 알아도 되는 곳 — 여기 말고는 손으로 곱하면 안 된다.
 *
 *   statementLines   전표·주문 줄을 푸는 주인
 *   orderUnits       `unpackComponent` 가 사는 곳
 *   docOil           **서류용 형제** — `docUnpack`. 품목 배열이 아니라 찾는 함수를 받아서
 *                    모양이 다르다. 합칠 수 있으면 좋은데 아직 안 했다(할일에 적어 뒀다).
 *   stockUseRows     주문 줄이 아니라 **재고 부족분**을 낱개로 환산하는 자리다. 뜻이 다르다.
 */
const 주인들 = [
  'src/shared/statementLines.ts', 'src/shared/orderUnits.ts',
  'src/shared/docOil.ts', 'src/features/admin/stockUseRows.ts',
];
const 볼파일 = globSync('{components,src}/**/*.{ts,tsx}')
  .filter(f => !f.includes('.test.'))
  .filter(f => !주인들.some(o => f.replace(/\\/g, '/').endsWith(o)));

describe('박스 푸는 셈은 shared/statementLines 만 안다', () => {
  it('화면이 resolveOrderItem 을 쓴다', () => {
    expect(화면).toContain('resolveOrderItem');
  });

  it('화면이 단가를 손으로 고르지 않는다 — orderItemPrice 를 쓴다', () => {
    expect(화면).toContain('orderItemPrice');
  });

  it('**어느 파일에서도** 개입수를 손으로 곱하지 않는다', () => {
    //  `qty = boxCount * uc.count` 같은 것. **변수 이름과 상관없이** 잡는다 —
    //  2026-09-05 에 `unpack.count` 로 쓴 네 번째 벌을 이 시험이 놓쳤다(이름만 봤다).
    const 손으로: string[] = [];
    for (const f of 볼파일) {
      readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
        const t = l.trim();
        if (t.startsWith('//') || t.startsWith('*')) return;
        if (/\*\s*\w+\.count\b|\b\w+\.count\s*\*/.test(l)) 손으로.push(`  ${f}:${i + 1}  ${t.slice(0, 80)}`);
      });
    }
    expect(손으로, `개입수를 손으로 곱하는 줄:\n${손으로.join('\n')}\n\n` +
      `shared/statementLines 의 resolveOrderItem 을 써라.`).toEqual([]);
  });

  it('화면에 주문 단가로 물러서는 줄이 없다 — 나누지 않으면 열 배가 된다', () => {
    //  `?? item.price ??` 로 물러서는 자리. 공용 함수만 그 판단을 해야 한다.
    const 손으로 = 화면.split('\n').filter(l =>
      /\?\?\s*item\.price\s*\?\?/.test(l) && !l.trimStart().startsWith('//'));
    expect(손으로, `주문 단가로 물러서는 줄:\n${손으로.join('\n')}`).toEqual([]);
  });
});
