import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * **손익분석과 현금흐름은 같은 카드를 쓴다.**
 *
 * 기간 고르개만 공용으로 바꿔 놓고 통일했다고 했는데, 정작 **표 모양이 딴판이었다**
 * (2026-09-06 사장님: "이게 통일한거야?") — 손익은 흰 카드에 접히는 줄, 현금흐름은
 * 검은 머리띠에 안 접히는 회색 띠였다. 둘 다 `shared/ui/LedgerCard` 를 쓴다.
 */
const src = readFileSync('components/ProfitAnalysis.tsx', 'utf8');
const 줄 = src.split('\n');

describe('장부 카드는 한 벌이다', () => {
  it('손익·현금흐름 둘 다 LedgerCard 로 싼다', () => {
    const n = (src.match(/<LedgerCard>/g) ?? []).length;
    expect(n, `<LedgerCard> 가 ${n}개 — 손익과 현금흐름 둘이라 2개여야 한다`).toBe(2);
  });

  it('접히는 큰 줄도 소계 줄도 공용을 쓴다', () => {
    expect(src, 'LedgerLine 을 안 쓴다').toContain('<LedgerLine');
    expect(src, 'LedgerResult 를 안 쓴다').toContain('<LedgerResult');
    expect(src, 'LedgerSub 을 안 쓴다').toContain('<LedgerSub');
  });

  it('장부 표를 검은 머리띠로 시작하지 않는다 — 현금흐름만 그랬다', () => {
    //  표 머리 띠의 모양: 카드 폭(px-5)에 진한 바탕. 버튼·말풍선은 이 짝이 아니다.
    const 걸림 = 줄
      .map((l, i) => [l, i + 1] as const)
      .filter(([l]) => /px-5\s+py-3[^"]*bg-slate-800|bg-slate-800[^"]*px-5\s+py-3/.test(l))
      .map(([l, n]) => `  components/ProfitAnalysis.tsx:${n}  ${l.trim().slice(0, 90)}`);
    expect(걸림, `장부 표에 검은 머리띠를 쓴 곳:\n${걸림.join('\n')}\n\n` +
      `shared/ui/LedgerCard 를 써라 — 손익분석과 같은 모양이다.`).toEqual([]);
  });
});
