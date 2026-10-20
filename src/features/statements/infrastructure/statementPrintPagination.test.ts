/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../../shared/htmlPrintOutput', () => ({ previewHtmlPrint: vi.fn() }));
import { buildStatementPrintHtml } from './statementPrint';
import { prepareStatementPrintDocument } from './statementPrintPagination';

let rowHeight = 20, finalHeight = 30, secondExtra = 20, continuationHeight = 5, widthOverflow = false, zeroGeometry = false, placedOverflow = false;
const sheets = (doc: Document) => Array.from(doc.querySelectorAll<HTMLElement>('[data-statement-sheet]'));
const copies = (sheet: HTMLElement) => Array.from(sheet.querySelectorAll<HTMLElement>('[data-statement-copy]'));
const rows = (copy: HTMLElement) => Array.from(copy.querySelectorAll<HTMLElement>('[data-statement-item]'));
function fixture(count: number) {
  const items = Array.from({ length: count }, (_, index) => ({ key: `k${index}`, no: index + 1, name: `원품목${index}`, spec: '규격', qty: 2, price: 100, supply: 200, tax: 20, total: 220, isTaxExempt: false, accountCode: '' }));
  const doc = document.implementation.createHTMLDocument('실측 모의');
  doc.body.innerHTML = buildStatementPrintHtml(items, count * 200, count * 20, count * 220, '매출', '거래처', '원전표번호', '2026년 10월 20일', '원메모', '', undefined, { partners: [], allItems: [] });
  return doc;
}
beforeEach(() => {
  rowHeight = 20; finalHeight = 30; secondExtra = 20; continuationHeight = 5; widthOverflow = false; zeroGeometry = false, placedOverflow = false;
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) { return widthOverflow && !!this.closest('[data-statement-final]') ? 700 : 600; });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const sheet = this.closest<HTMLElement>('[data-statement-sheet]');
    const pageIndex = sheet ? sheets(this.ownerDocument).indexOf(sheet) : 0;
    const top = Math.max(0, pageIndex) * (297 * 96 / 25.4);
    if (this.matches('[data-statement-sheet]')) return new DOMRect(0, top, 210 * 96 / 25.4, 297 * 96 / 25.4);
    let height = 10;
    if (this.matches('[data-statement-copy]')) height = zeroGeometry ? 0 : 120;
    if (this.matches('[data-statement-content]')) {
      const copy = this.closest<HTMLElement>('[data-statement-copy]')!;
      const second = copies(this.closest<HTMLElement>('[data-statement-sheet]')!)[1] === copy;
      height = 20 + rows(copy).length * rowHeight + (this.querySelector('[data-statement-final]') ? finalHeight : 0) + (second ? secondExtra : 0)
        + this.querySelectorAll('[data-statement-decoration]').length + (this.querySelector('[data-statement-continuation]') ? continuationHeight : 0);
    }
    return new DOMRect(0, top + (placedOverflow && !this.ownerDocument.querySelector('[style*="-10000px"]') && sheets(this.ownerDocument).length > 1 && this.matches('[data-statement-content]') ? 130 : 0), 600, height);
  });
});
afterEach(() => vi.restoreAllMocks());

it.each([0, 1, 8, 9, 11])('한쪽에 맞는 %i품목은 기존 한 장 DOM과 번호 없는 배치를 그대로 둔다', count => {
  rowHeight = 1;
  const doc = fixture(count), original = sheets(doc)[0], before = original.outerHTML;
  prepareStatementPrintDocument(doc);
  expect(sheets(doc)).toHaveLength(1);
  expect(sheets(doc)[0]).toBe(original);
  expect(original.outerHTML).toBe(before);
  expect(original.querySelector('[data-statement-page-number]')?.textContent).toBe('');
});

it('양쪽 최대높이와 마지막 정산을 예약해 같은 품목 구간·원순번·금액을 양면에 한 번씩 보존한다', () => {
  const doc = fixture(11);
  prepareStatementPrintDocument(doc);
  const pages = sheets(doc);
  expect(pages).toHaveLength(6); // 두 번째 부의 추가 높이 때문에 최대 두 품목씩이다.
  const all = [[], []] as string[][];
  pages.forEach((page, index) => {
    const parts = copies(page);
    expect(parts.map(part => rows(part).map(row => row.dataset.statementIndex))[0]).toEqual(parts.map(part => rows(part).map(row => row.dataset.statementIndex))[1]);
    parts.forEach((part, side) => { rows(part).forEach(row => { all[side].push(row.dataset.statementIndex!); expect(row.querySelector('td')!.textContent).toBe(String(Number(row.dataset.statementIndex) + 1)); expect(row.textContent).toContain('220'); }); });
    expect(page.querySelectorAll('[data-statement-decoration]')).toHaveLength(0);
    expect(Array.from(page.querySelectorAll('[data-statement-page-number]'), value => value.textContent)).toEqual([` ${index + 1}/6`, ` ${index + 1}/6`]);
    expect(page.querySelectorAll('[data-statement-final]')).toHaveLength(index === pages.length - 1 ? 4 : 0);
    expect(page.querySelectorAll('[data-statement-continuation]')).toHaveLength(index === pages.length - 1 ? 0 : 2);
    expect(page.style.pageBreakAfter).toBe(index === pages.length - 1 ? 'auto' : 'always');
  });
  for (const values of all) expect(values).toEqual(Array.from({ length: 11 }, (_, index) => String(index)));
  expect(pages.at(-1)!.textContent).toContain('2,420');
  expect(pages.at(-1)!.textContent).toContain('원메모');
});

it('정확한 페이지 경계에서도 품목 없는 마지막 장을 추가하지 않고 두 번째 준비는 중복 분할하지 않는다', () => {
  const doc = fixture(6);
  prepareStatementPrintDocument(doc);
  expect(sheets(doc)).toHaveLength(3);
  expect(rows(copies(sheets(doc).at(-1)!)[0])).toHaveLength(2);
  const before = doc.body.innerHTML;
  prepareStatementPrintDocument(doc);
  expect(doc.body.innerHTML).toBe(before);
});

it('단일 품목과 정산이 같이 안 맞으면 구체적 조치 오류를 내고 원문을 교체하지 않는다', () => {
  rowHeight = 80;
  const doc = fixture(1), original = sheets(doc)[0], before = original.outerHTML;
  expect(() => prepareStatementPrintDocument(doc)).toThrow('한 품목과 정산 영역이');
  expect(sheets(doc)[0]).toBe(original);
  expect(original.outerHTML).toBe(before);
  expect(doc.body.querySelectorAll('[style*="-10000px"]')).toHaveLength(0);
  expect(doc.body.dataset.statementPagination).toBeUndefined();
});

it('정산·비고 자체가 넘치거나 실제 폭이 잘리면 준비 성공으로 숨기지 않는다', () => {
  finalHeight = 200;
  const tall = fixture(0);
  expect(() => prepareStatementPrintDocument(tall)).toThrow('품목 설명 또는 비고 길이를 줄인');
  finalHeight = 30; widthOverflow = true;
  expect(() => prepareStatementPrintDocument(fixture(1))).toThrow('인쇄 폭을 초과');
});

it('양쪽 품목 원문이 다르거나 실측 크기가 없으면 페이지 성공을 만들지 않는다', () => {
  const mismatch = fixture(3);
  rows(copies(sheets(mismatch)[0])[1])[0].remove();
  expect(() => prepareStatementPrintDocument(mismatch)).toThrow('품목 순서가 다릅니다');
  zeroGeometry = true;
  expect(() => prepareStatementPrintDocument(fixture(1))).toThrow('크기를 확인하지 못했습니다');
});

it('중간 안내가 별도로 넘쳐도 최종 검증 뒤에만 원문을 교체한다', () => {
  continuationHeight = 200;
  const doc = fixture(4), before = sheets(doc)[0].outerHTML;
  expect(() => prepareStatementPrintDocument(doc)).toThrow('인쇄 영역을 초과');
  expect(sheets(doc)).toHaveLength(1);
  expect(sheets(doc)[0].outerHTML).toBe(before);
});

it('명세서 표식이 없는 기존 영수증은 손대지 않는다', () => {
  const doc = document.implementation.createHTMLDocument();
  doc.body.innerHTML = '<p>영수증 원문 299원</p>';
  prepareStatementPrintDocument(doc);
  expect(doc.body.innerHTML).toBe('<p>영수증 원문 299원</p>');
});

it('최종 본문 배치에서만 좌표가 넘쳐도 모든 생성 쪽을 제거하고 원래 위치와 원문을 복원한다', () => {
  const doc = fixture(4), original = sheets(doc)[0], before = original.outerHTML;
  const preceding = doc.createElement('p'), following = doc.createElement('p');
  original.before(preceding); original.after(following); placedOverflow = true;
  expect(() => prepareStatementPrintDocument(doc)).toThrow('인쇄 영역을 초과');
  expect(sheets(doc)).toEqual([original]);
  expect(original.outerHTML).toBe(before);
  expect(original.previousSibling).toBe(preceding);
  expect(original.nextSibling).toBe(following);
  expect(doc.body.dataset.statementPagination).toBeUndefined();
});