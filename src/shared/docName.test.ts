import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { docName, docNameOf, findByDocName, withDocNames } from './docName';
import type { Item } from './types';

const 품목들 = [
  { id: 'a', name: '참기름/골드/대왕/1800ml', spec: '1800ml', 품목: '시골향참기름1' },
  { id: 'b', name: '시골향들기름/병/350ml', spec: '350ml', 품목: '시골향들기름2' },
  { id: 'c', name: '시골향들기름/병/특/350ml', spec: '350ml', 품목: '시골향들기름2' },
  { id: 'd', name: '포장박스', spec: '', 품목: '' },
  { id: 'e', name: '같은이름', spec: '1kg', 품목: '뭉뚱1' },
  { id: 'f', name: '같은이름', spec: '4kg', 품목: '뭉뚱4' },
  { id: 'g', name: '옛품목', spec: '1kg', 품목: '안쓰는이름', archived: true },
] as unknown as Item[];

describe('서류용 품목명', () => {
  it('서류용 이름이 있으면 그걸 쓴다', () => {
    expect(docNameOf('참기름/골드/대왕/1800ml', '1800ml', 품목들)).toBe('시골향참기름1');
  });

  it('없으면 실제 이름 그대로 둔다 — 빈 칸으로 찍히면 안 된다', () => {
    expect(docNameOf('포장박스', '', 품목들)).toBe('포장박스');
    expect(docNameOf('목록에 없는 것', '1kg', 품목들)).toBe('목록에 없는 것');
  });

  it('이름이 같고 규격만 다른 품목은 규격까지 보고 고른다', () => {
    expect(docNameOf('같은이름', '1kg', 품목들)).toBe('뭉뚱1');
    expect(docNameOf('같은이름', '4kg', 품목들)).toBe('뭉뚱4');
  });

  it('버린 품목은 안 본다', () => {
    expect(docNameOf('옛품목', '1kg', 품목들)).toBe('옛품목');
  });
});

describe('인쇄 줄 바꾸기', () => {
  const 줄 = (name: string, spec: string, qty: number, price: number) =>
    ({ name, spec, qty, price, supply: qty * price, tax: 0, total: qty * price });

  it('이름만 바꾼다 — 줄 수도 숫자도 그대로다', () => {
    const out = withDocNames([줄('참기름/골드/대왕/1800ml', '1800ml', 2, 9000),
                              줄('포장박스', '', 1, 500)], 품목들);
    expect(out).toHaveLength(2);
    expect(out.map(l => l.name)).toEqual(['시골향참기름1', '포장박스']);
    expect(out.map(l => l.qty)).toEqual([2, 1]);
    expect(out.map(l => l.total)).toEqual([18000, 500]);
  });

  it('서류용 이름이 겹쳐도 합치지 않는다 — 겹쳐도 그대로 둔다(2026-09-06 사장님)', () => {
    const out = withDocNames([줄('시골향들기름/병/350ml', '350ml', 2, 5000),
                              줄('시골향들기름/병/특/350ml', '350ml', 3, 5000)], 품목들);
    expect(out).toHaveLength(2);
    expect(out.map(l => l.name)).toEqual(['시골향들기름2', '시골향들기름2']);
    expect(out.map(l => l.qty)).toEqual([2, 3]);
    expect(out.map(l => l.total)).toEqual([10000, 15000]);
  });

  it('넣은 줄을 건드리지 않는다 — 화면은 실제 이름 그대로 봐야 한다', () => {
    const 원본 = [줄('참기름/골드/대왕/1800ml', '1800ml', 1, 9000)];
    withDocNames(원본, 품목들);
    expect(원본[0].name).toBe('참기름/골드/대왕/1800ml');
  });
});

/**
 * **`품목 || name` 을 손으로 적지 않는다.**
 *
 * 여덟 군데에 따로 적혀 있었다(2026-09-06) — AddItemModal 2곳, BomIntegrityPanel 2곳,
 * ProductionManager, AdminApp 2곳, oemEngine. 전표 인쇄를 붙이며 아홉 번째를 적을 뻔했다.
 * 이 규칙이 갈리면 **원료가 조용히 안 빠진다** — 원료식 열쇠가 안 맞으면 그냥 빈 목록이라
 * 화면에 아무 표시가 안 난다.
 */
describe('서류용 이름 규칙은 한 곳에만 있다', () => {
  it('품목 || name 을 손으로 적은 곳이 없다', () => {
    const 걸림: string[] = [];
    const 볼파일 = globSync('{components,src}/**/*.{ts,tsx}')
      .filter(f => !f.includes('.test.') && !f.replace(/\\/g, '/').endsWith('src/shared/docName.ts'));
    for (const file of 볼파일) {
      readFileSync(file, 'utf8').split('\n').forEach((l, i) => {
        const t = l.trim();
        if (t.startsWith('//') || t.startsWith('*')) return;
        //  `품목 || name` · `품목 ?? name` — 사이에 형변환이 끼어도 잡는다.
        if (/품목\s*(?:\|\||\?\?)\s*[\w.()\s]*\bname\b/.test(l)) 걸림.push(`  ${file}:${i + 1}  ${t.slice(0, 90)}`);
      });
    }
    expect(걸림, `서류용 이름 규칙을 손으로 적은 곳:\n${걸림.join('\n')}\n\n` +
      `shared/docName 의 docName 을 써라.`).toEqual([]);
  });
});
