const SHEET = '[data-statement-sheet]';
const COPY = '[data-statement-copy]';
const CONTENT = '[data-statement-content]';
const ITEM = '[data-statement-item]';
const FINAL = '[data-statement-final]';
const EPSILON = 1;
const blockError = () => Error('한 품목과 정산 영역이 인쇄 영역을 초과합니다. 품목 설명 또는 비고 길이를 줄인 뒤 다시 미리보기를 열어 주세요.');

function copies(sheet: HTMLElement): HTMLElement[] {
  const values = Array.from(sheet.querySelectorAll<HTMLElement>(COPY));
  if (values.length !== 2 || values.some(copy => !copy.querySelector(CONTENT))) throw Error('거래명세서 양쪽 원문을 확인하지 못했습니다. 다시 미리보기를 열어 주세요.');
  return values;
}

function checkWidth(sheet: HTMLElement): void {
  for (const element of sheet.querySelectorAll<HTMLElement>(`${CONTENT},td,th`)) {
    if (element.clientWidth > 0 && element.scrollWidth > element.clientWidth + EPSILON) {
      throw Error('품목·연락처 또는 비고가 인쇄 폭을 초과합니다. 내용을 줄인 뒤 다시 미리보기를 열어 주세요.');
    }
  }
}

function fits(sheet: HTMLElement): boolean {
  checkWidth(sheet);
  return copies(sheet).every(copy => {
    const capacity = copy.getBoundingClientRect();
    const body = copy.querySelector<HTMLElement>(CONTENT)!.getBoundingClientRect();
    if (capacity.height <= 0 || capacity.width <= 0 || body.height <= 0) throw Error('인쇄 문서의 크기를 확인하지 못했습니다. 다시 미리보기를 열어 주세요.');
    return body.top >= capacity.top - EPSILON && body.bottom <= capacity.bottom + EPSILON
      && body.left >= capacity.left - EPSILON && body.right <= capacity.right + EPSILON;
  });
}

function checkPlacedPages(pages: HTMLElement[]): void {
  let previousBottom = -Infinity;
  for (const page of pages) {
    const area = page.getBoundingClientRect();
    if (Math.abs(area.width - 210 * 96 / 25.4) > 2 || Math.abs(area.height - 297 * 96 / 25.4) > 2
      || area.top < previousBottom - EPSILON || !fits(page)) throw blockError();
    for (const copy of copies(page)) {
      const part = copy.getBoundingClientRect();
      if (part.top < area.top - EPSILON || part.bottom > area.bottom + EPSILON
        || part.left < area.left - EPSILON || part.right > area.right + EPSILON) throw blockError();
    }
    previousBottom = area.bottom;
  }
}

/** 원본을 건드리지 않은 실제 너비의 복제본에서 두 부의 같은 품목 구간을 측정한다. */
export function prepareStatementPrintDocument(document: Document): void {
  if (document.body.dataset.statementPagination === 'ready') return;
  const sheets = Array.from(document.querySelectorAll<HTMLElement>(SHEET));
  if (!sheets.length) return; // 같은 미리보기를 사용하는 영수증은 이 레이아웃이 아니다.
  if (sheets.length !== 1) throw Error('거래명세서 원문 페이지를 확인하지 못했습니다. 다시 미리보기를 열어 주세요.');
  const original = sheets[0], originals = copies(original);
  const indexes = originals.map(copy => Array.from(copy.querySelectorAll<HTMLElement>(ITEM), row => row.dataset.statementIndex));
  if (JSON.stringify(indexes[0]) !== JSON.stringify(indexes[1]) || indexes[0].some((value, index) => value !== String(index))) throw Error('거래명세서 양쪽 품목 순서가 다릅니다. 원문을 다시 확인해 주세요.');
  if (fits(original)) { checkPlacedPages([original]); document.body.dataset.statementPagination = 'ready'; return; }

  const stage = document.createElement('div');
  stage.style.cssText = 'position:absolute;left:-10000px;top:0;width:210mm;visibility:hidden;pointer-events:none;';
  document.body.append(stage);
  const make = (start: number, end: number, last: boolean): HTMLElement => {
    const page = original.cloneNode(true) as HTMLElement;
    for (const copy of copies(page)) {
      copy.querySelectorAll('[data-statement-decoration]').forEach(row => row.remove());
      copy.querySelectorAll<HTMLElement>(ITEM).forEach(row => { const index = Number(row.dataset.statementIndex); if (index < start || index >= end) row.remove(); });
      if (!last) {
        copy.querySelectorAll(FINAL).forEach(block => block.remove());
        const next = document.createElement('div');
        next.dataset.statementContinuation = '';
        next.style.cssText = 'padding:2mm;font-size:10px;text-align:right;';
        next.textContent = '다음 쪽에 계속됩니다. 전체 합계와 정산은 마지막 쪽에 표시합니다.';
        copy.querySelector('[data-statement-frame]')!.append(next);
      }
    }
    return page;
  };
  const measured = (page: HTMLElement) => { stage.replaceChildren(page); return fits(page); };
  try {
    const count = indexes[0].length, ranges: [number, number][] = [];
    if (!count) {
      if (!measured(make(0, 0, true))) throw blockError();
      ranges.push([0, 0]);
    }
    for (let start = 0; start < count;) {
      let end = start;
      // 중간 쪽도 마지막 정산 영역을 예약한다. 정산만 담긴 빈 마지막 쪽을 만들지 않는다.
      for (let candidate = start + 1; candidate <= count; candidate++) {
        if (!measured(make(start, candidate, true))) break;
        end = candidate;
      }
      if (end === start) throw blockError();
      ranges.push([start, end]); start = end;
    }
    const pages = ranges.map(([start, end], index) => {
      const page = make(start, end, index === ranges.length - 1);
      page.querySelectorAll<HTMLElement>('[data-statement-page-number]').forEach(label => { label.textContent = ` ${index + 1}/${ranges.length}`; });
      page.style.breakAfter = index === ranges.length - 1 ? 'auto' : 'page';
      page.style.pageBreakAfter = index === ranges.length - 1 ? 'auto' : 'always';
      if (!measured(page)) throw blockError();
      return page;
    });
    const fragment = document.createDocumentFragment();
    pages.forEach(page => fragment.append(page));
    const placeholder = document.createComment('거래명세서 원문 위치');
    original.before(placeholder);
    original.replaceWith(fragment);
    stage.remove();
    try {
      checkPlacedPages(pages);
      document.body.dataset.statementPagination = 'ready';
      placeholder.remove();
    } catch (error) {
      pages.forEach(page => page.remove());
      placeholder.replaceWith(original);
      throw error;
    }
  } finally { stage.remove(); }
}
