import { describe, it, expect } from 'vitest';
import { docItemName, withDocNames } from './statementLines';
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
    expect(docItemName('참기름/골드/대왕/1800ml', '1800ml', 품목들)).toBe('시골향참기름1');
  });

  it('없으면 실제 이름 그대로 둔다 — 빈 칸으로 찍히면 안 된다', () => {
    expect(docItemName('포장박스', '', 품목들)).toBe('포장박스');
    expect(docItemName('목록에 없는 것', '1kg', 품목들)).toBe('목록에 없는 것');
  });

  it('이름이 같고 규격만 다른 품목은 규격까지 보고 고른다', () => {
    expect(docItemName('같은이름', '1kg', 품목들)).toBe('뭉뚱1');
    expect(docItemName('같은이름', '4kg', 품목들)).toBe('뭉뚱4');
  });

  it('버린 품목은 안 본다', () => {
    expect(docItemName('옛품목', '1kg', 품목들)).toBe('옛품목');
  });
});

describe('인쇄 줄 바꾸기', () => {
  const 줄 = (name: string, spec: string, qty: number, price: number) =>
    ({ name, spec, qty, price, supply: qty * price, tax: 0, total: qty * price });

  it('단가까지 같으면 한 줄로 합치고 수량·금액을 더한다', () => {
    const out = withDocNames([줄('시골향들기름/병/350ml', '350ml', 2, 5000),
                              줄('시골향들기름/병/특/350ml', '350ml', 3, 5000)], 품목들);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('시골향들기름2');
    expect(out[0].qty).toBe(5);
    expect(out[0].total).toBe(25000);
  });

  it('단가가 다르면 안 합친다 — 어느 값을 찍을지 없다', () => {
    const out = withDocNames([줄('시골향들기름/병/350ml', '350ml', 2, 5000),
                              줄('시골향들기름/병/특/350ml', '350ml', 3, 6000)], 품목들);
    expect(out).toHaveLength(2);
    expect(out.map(l => l.name)).toEqual(['시골향들기름2', '시골향들기름2']);
    expect(out.map(l => l.total)).toEqual([10000, 18000]);
  });

  it('규격이 다르면 안 합친다', () => {
    const out = withDocNames([줄('같은이름', '1kg', 1, 100), 줄('같은이름', '4kg', 1, 100)], 품목들);
    expect(out).toHaveLength(2);
    expect(out.map(l => l.name)).toEqual(['뭉뚱1', '뭉뚱4']);
  });

  it('넣은 줄을 건드리지 않는다 — 화면은 실제 이름 그대로 봐야 한다', () => {
    const 원본 = [줄('참기름/골드/대왕/1800ml', '1800ml', 1, 9000)];
    withDocNames(원본, 품목들);
    expect(원본[0].name).toBe('참기름/골드/대왕/1800ml');
    expect(원본[0].qty).toBe(1);
  });
});
