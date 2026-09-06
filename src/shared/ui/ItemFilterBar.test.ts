import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';

/**
 * **품목 거르개는 한 벌이다.**
 *
 * 화면마다 새로 만들고 있었다(2026-09-06 사장님: "제품별 원장은 또 필터 새로 만들어서
 * 달아뒀잖아 걔도 합쳐"). 제품별 원장은 `<select>` 두 개를 손으로 그렸고,
 * 견적서 품목 고르기는 거르개가 아예 없어 300품목을 검색으로만 찾아야 했다.
 */
const 볼파일 = globSync('{components,src}/**/*.{ts,tsx}')
  .filter(f => {
    const q = f.replace(/\\/g, '/');
    //  거르개 자신과, 셈이 사는 곳(itemFilter)은 뺀다 — 거기가 원래 자리다.
    return !f.includes('.test.')
      && !q.endsWith('src/shared/ui/ItemFilterBar.tsx')
      && !q.endsWith('src/shared/itemFilter.ts');
  });

describe('품목 거르개를 손으로 그리지 않는다', () => {
  it('typeOptions·categoryOptions 로 select 를 직접 만드는 곳이 없다', () => {
    const 걸림: string[] = [];
    for (const file of 볼파일) {
      const src = readFileSync(file, 'utf8');
      //  옵션을 만드는 함수를 쓰면서 `<select` 도 같이 있으면 거르개를 손으로 그린 것이다.
      if (!/\b(?:typeOptions|categoryOptions)\s*\(/.test(src)) continue;
      if (!/<select/.test(src)) continue;
      걸림.push(`  ${file}`);
    }
    expect(걸림, `품목 거르개를 손으로 그린 곳:\n${걸림.join('\n')}\n\n` +
      `shared/ui/ItemFilterBar 를 써라.`).toEqual([]);
  });

  it('keepCategory(타입 바꾸면 카테고리 풀기)를 화면이 직접 부르지 않는다', () => {
    const 걸림: string[] = [];
    for (const file of 볼파일) {
      readFileSync(file, 'utf8').split('\n').forEach((l, i) => {
        const t = l.trim();
        if (t.startsWith('//') || t.startsWith('*')) return;
        if (/keepCategory\s*\(/.test(l)) 걸림.push(`  ${file}:${i + 1}  ${t.slice(0, 80)}`);
      });
    }
    expect(걸림, `타입 바꾸기 규칙을 손으로 적은 곳:\n${걸림.join('\n')}\n\n` +
      `ItemFilterBar 가 이미 한다.`).toEqual([]);
  });
});
