import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';

/**
 * **기간 고르개는 한 벌이다.**
 *
 * 손익분석과 현금흐름이 같은 상태(`period`·`selectedYear`·`selectedQuarter`…)를 쓰면서
 * 고르개는 각자 그리고 있었다(2026-09-06 사장님: "현금흐름 분석 ui 손익비용분석이랑
 * 통일성 있게"). 딱지 크기도, 이름도, 자리도 달랐다 — 같은 `'1Y'` 를 한쪽은 **당년**,
 * 다른 쪽은 **연간**이라 불렀다. 나란히 놓으면 딴 화면 같았다.
 */
const 볼파일 = globSync('{components,src}/**/*.{ts,tsx}')
  .filter(f => !f.includes('.test.') && !f.replace(/\\/g, '/').endsWith('src/shared/ui/PeriodPicker.tsx'));

describe('기간 갈래를 손으로 그리지 않는다', () => {
  it("'당월'·'분기'·'반기'·'당년' 딱지를 직접 만드는 곳이 없다", () => {
    const 걸림: string[] = [];
    for (const file of 볼파일) {
      readFileSync(file, 'utf8').split('\n').forEach((l, i) => {
        const t = l.trim();
        if (t.startsWith('//') || t.startsWith('*')) return;
        //  `['1Y','당년']` · `['1Y','연간']` 처럼 기간 값에 이름을 붙여 표를 만드는 모양
        if (/\['(?:1M|3M|6M|1Y)'\s*,\s*'[^']+'\]/.test(l)) 걸림.push(`  ${file}:${i + 1}  ${t.slice(0, 90)}`);
      });
    }
    expect(걸림, `기간 갈래를 손으로 그린 곳:\n${걸림.join('\n')}\n\n` +
      `shared/ui/PeriodPicker 를 써라.`).toEqual([]);
  });

  it("같은 기간을 화면마다 다르게 부르지 않는다 — '연간'이 아니라 '당년'이다", () => {
    const 걸림: string[] = [];
    for (const file of 볼파일) {
      readFileSync(file, 'utf8').split('\n').forEach((l, i) => {
        const t = l.trim();
        if (t.startsWith('//') || t.startsWith('*')) return;
        if (/'1Y'\s*,\s*'연간'/.test(l)) 걸림.push(`  ${file}:${i + 1}  ${t.slice(0, 90)}`);
      });
    }
    expect(걸림, `같은 값을 딴 이름으로 부른 곳:\n${걸림.join('\n')}`).toEqual([]);
  });
});
