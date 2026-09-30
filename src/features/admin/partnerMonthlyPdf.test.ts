/** @vitest-environment jsdom */
import { expect, it, vi } from 'vitest';
import { savePartnerMonthlyPdf, type NamedSettlementRow } from './partnerMonthlyPdf';

const capture = vi.hoisted(() => ({ pages: [] as string[], added: 0, saved: '' }));
vi.mock('html2canvas', () => ({ default: async (page: HTMLElement) => {
  capture.pages.push(page.outerHTML);
  return { toDataURL: () => 'data:image/png;base64,AA==' };
} }));
vi.mock('jspdf', () => ({ default: class {
  addPage() { capture.added++; }
  addImage() {}
  save(name: string) { capture.saved = name; }
} }));

it('한글 표와 합계를 2페이지 PDF로 출력한다', async () => {
  const rows: NamedSettlementRow[] = Array.from({ length: 18 }, (_, i) => ({
    partnerId: String(i), name: `거래처 ${i + 1}`, opening: 10, sales: 20,
    cashReceived: 5, cashRefunded: 0, nonCashDecrease: 2, receivableIncrease: 13, closing: 23, discrepancy: 0,
  }));
  await savePartnerMonthlyPdf('2026-08', rows);
  expect(capture.pages).toHaveLength(2);
  expect(capture.pages[0]).toContain('2026년 8월 거래처별 정산');
  expect(capture.pages[0]).toContain('Malgun Gothic');
  expect(capture.pages[0]).toContain('현금 입금');
  expect(capture.pages[0]).toContain('현금 환불');
  expect(capture.pages[1]).toContain('전체 합계');
  expect(capture.pages[1]).toContain('414');
  expect(capture.added).toBe(1);
  expect(capture.saved).toBe('거래처별정산_2026-08.pdf');
  expect(document.body.querySelector('table')).toBeNull();
});
