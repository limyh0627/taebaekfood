import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { DEFAULT_CATEGORY_LABELS } from './taxonomy';

/**
 * **이름표를 화면마다 다시 적지 않는다.**
 *
 * 품목 타입 이름표(`완제품·상품·반제품·원료·부자재`)가 **여섯 곳**에 있었다
 * (2026-09-05) — 공용 모듈에 셋(taxonomy·itemTaxonomy·productChip), 화면에 셋
 * (AddOrderModal·OrdersList·ProfitAnalysis).
 *
 * 타입을 하나 더하거나 이름을 고칠 때 여섯 곳을 다 고쳐야 하고, 한 곳을 놓치면
 * **그 화면에서만 영어 키(`wip`)가 그대로 보인다.**
 */
const 파일들 = globSync('{components,src}/**/*.{ts,tsx}')
  .filter(f => !f.includes('.test.') && !f.replace(/\\/g, '/').endsWith('src/shared/taxonomy.ts'));

describe('품목 타입 이름표는 taxonomy 한 곳에서 온다', () => {
  it('이름표를 손으로 다시 적은 곳이 없다', () => {
    const 걸림: string[] = [];
    for (const file of 파일들) {
      readFileSync(file, 'utf8').split('\n').forEach((l, i) => {
        const t = l.trim();
        if (t.startsWith('//') || t.startsWith('*')) return;
        //  `product: '완제품'` 과 `wip: '반제품'` 이 한 줄에 같이 있으면 그 표다
        if (/product\s*:\s*'완제품'/.test(l) && /wip\s*:\s*'반제품'/.test(l)) {
          걸림.push(`  ${file}:${i + 1}  ${t.slice(0, 80)}`);
        }
      });
    }
    expect(걸림, `이름표를 다시 적은 곳:\n${걸림.join('\n')}\n\n` +
      `shared/taxonomy 의 DEFAULT_CATEGORY_LABELS 를 써라.`).toEqual([]);
  });

  it('다섯 타입이 다 있다', () => {
    expect(Object.keys(DEFAULT_CATEGORY_LABELS).sort())
      .toEqual(['goods', 'product', 'raw', 'submaterial', 'wip']);
  });
});
