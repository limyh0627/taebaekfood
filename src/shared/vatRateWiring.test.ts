import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';

/**
 * **부가세율은 [lineAmount](lineAmount.ts) 한 곳에서 온다.**
 *
 * `VAT_RATE` 를 거기 두고도 `Math.round(supply * 0.1)` 이 네 곳,
 * `* 1.1` 이 세 곳에 손으로 적혀 있었다(2026-09-05).
 * **세율이 한 곳에 있어도 쓰는 자리가 손으로 곱하면 소용이 없다.**
 *
 * 쓸 것 — `vatOn(공급가액, 면세)` · `VAT_UP`(세금 얹는 곱수) · `lineAmount`(세포함에서 역산).
 */
const 파일들 = globSync('{components,src}/**/*.{ts,tsx}')
  .filter(f => !f.includes('.test.') && !f.endsWith('lineAmount.ts'));

/** 세금 얘기를 하는 줄에서만 본다 — 0.1 은 투명도·비율에도 쓰인다 */
const 세금냄새 = /tax|세액|부가세|vat|supply|공급가/i;
const 손으로곱함 = /[*/]\s*(0\.1|1\.1)\b/;

describe('부가세율을 손으로 곱하지 않는다', () => {
  it('세금 셈에 0.1 · 1.1 을 직접 쓴 곳이 없다', () => {
    const 걸림: string[] = [];
    for (const file of 파일들) {
      let 주석중 = false;
      readFileSync(file, 'utf8').split('\n').forEach((l, i) => {
        const t = l.trim();
        if (t.startsWith('/*') || t.startsWith('{/*')) 주석중 = true;
        const 끝남 = 주석중 && (t.endsWith('*/') || t.endsWith('*/}'));
        const 건너뜀 = 주석중 || t.startsWith('//') || t.startsWith('*');
        if (끝남) 주석중 = false;
        if (건너뜀) return;
        if (!세금냄새.test(l)) return;
        if (손으로곱함.test(l)) 걸림.push(`  ${file}:${i + 1}  ${t.slice(0, 80)}`);
      });
    }
    expect(걸림, `세율을 손으로 곱한 곳:\n${걸림.join('\n')}\n\n` +
      `shared/lineAmount 의 vatOn · VAT_UP · lineAmount 를 써라.`).toEqual([]);
  });
});
