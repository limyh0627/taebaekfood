import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';

/**
 * **같은 것을 두 이름으로 부르지 않는다.**
 *
 * 거래처를 `client` 로 부르던 것을 `partner` 로 바꾸다 말아서, 상태는 `partnerSearch`
 * 인데 그걸 바꾸는 함수는 `setClientSearch` 인 자리가 열 곳 있었다(2026-09-05 사장님 지적).
 * 읽는 사람이 **다른 것인 줄 안다.** 찾을 때도 한쪽만 걸린다.
 */
const 파일들 = globSync('{components,src}/**/*.{ts,tsx}').filter(f => !f.includes('.test.'));

/** 일부러 그런 것 — 배열을 풀어 받거나, 감싸는 함수를 따로 두는 경우 */
const 봐주는것 = new Set(['setA', 'setB', 'setOrdersMonthsState']);

describe('상태와 그 setter 는 같은 이름을 쓴다', () => {
  it('useState 의 두 번째 이름이 set + 첫 이름이다', () => {
    const 걸림: string[] = [];
    for (const file of 파일들) {
      readFileSync(file, 'utf8').split('\n').forEach((l, i) => {
        const m = /const \[\s*([A-Za-z_$][\w$]*)\s*,\s*(set[A-Za-z_$][\w$]*)\s*\]/.exec(l);
        if (!m) return;
        const [, 상태, 세터] = m;
        if (봐주는것.has(세터)) return;
        const 기대 = 'set' + 상태[0].toUpperCase() + 상태.slice(1);
        if (세터 !== 기대) 걸림.push(`  ${file}:${i + 1}  [${상태}, ${세터}] → ${기대}`);
      });
    }
    expect(걸림, `상태와 setter 이름이 안 맞는 곳:\n${걸림.join('\n')}\n\n` +
      `같은 것은 같은 이름으로 부른다. 일부러 다르게 둘 일이면 naming.test.ts 의 봐주는것에 적어라.`)
      .toEqual([]);
  });
});

describe('거래처는 partner 다', () => {
  //  `client` 는 거래처를 뜻하던 옛 이름이다. 새로 쓰는 코드에는 안 나와야 한다.
  //  (남아 있는 431곳을 한꺼번에 바꾸면 되돌리기가 어렵다 — 새로 늘지만 않게 막는다.)
  const 지금 = (() => {
    let n = 0;
    for (const file of 파일들) {
      n += (readFileSync(file, 'utf8').match(/\b[a-z]+Client[A-Za-z]*\b|\bclient[A-Z][A-Za-z]*\b/g) ?? []).length;
    }
    return n;
  })();

  it('client 로 부르는 자리가 더 늘지 않는다', () => {
    //  2026-09-05 기준. **줄이는 건 언제나 좋다** — 줄었으면 이 숫자를 낮춰 적어라.
    const 기준 = 431;
    expect(지금, `client 로 부르는 자리가 ${기준} → ${지금} 로 늘었다.\n` +
      `거래처는 partner 다. 새로 쓸 때 client 를 쓰지 마라.`).toBeLessThanOrEqual(기준);
  });
});
