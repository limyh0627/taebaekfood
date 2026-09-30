import type { PartnerMonthlyRow } from './partnerMonthlySettlement';

const PAGE_ROWS = 17;
const columns = [
  ['name', '거래처'], ['opening', '기초 미수'], ['sales', '월 매출'],
  ['cashReceived', '현금 입금'], ['cashRefunded', '현금 환불'], ['nonCashDecrease', '비현금 감소'],
  ['receivableIncrease', '미수 증가'], ['closing', '기말 누적 미수'],
  ['discrepancy', '대조 차이'],
] as const;

export type NamedSettlementRow = PartnerMonthlyRow & { name: string };

export function settlementPages(rows: NamedSettlementRow[]): NamedSettlementRow[][] {
  return Array.from({ length: Math.max(1, Math.ceil(rows.length / PAGE_ROWS)) }, (_, i) =>
    rows.slice(i * PAGE_ROWS, (i + 1) * PAGE_ROWS));
}

export async function savePartnerMonthlyPdf(month: string, rows: NamedSettlementRow[]): Promise<void> {
  const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
    import('html2canvas'), import('jspdf'),
  ]);
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pages = settlementPages(rows);
  const totals = Object.fromEntries(columns.slice(1).map(([key]) =>
    [key, rows.reduce((sum, row) => sum + Number(row[key]), 0)])) as Record<Exclude<keyof NamedSettlementRow, 'partnerId' | 'name'>, number>;
  const number = (value: number) => value.toLocaleString('ko-KR');

  for (let index = 0; index < pages.length; index++) {
    const page = document.createElement('div');
    page.style.cssText = 'position:fixed;left:-12000px;top:0;width:1123px;height:794px;box-sizing:border-box;padding:44px 46px;background:white;color:#172033;font-family:Malgun Gothic,Apple SD Gothic Neo,Noto Sans KR,sans-serif;';
    const title = document.createElement('h1');
    title.textContent = `${month.slice(0, 4)}년 ${Number(month.slice(5))}월 거래처별 정산`;
    title.style.cssText = 'font-size:24px;margin:0 0 8px;font-weight:700;';
    page.append(title);
    const note = document.createElement('p');
    note.textContent = '미수 증가 = 월 매출 - 현금 입금 + 현금 환불 - 비현금 감소 · 기말 누적 미수 = 기초 미수 + 미수 증가';
    note.style.cssText = 'font-size:12px;margin:0 0 20px;color:#475569;';
    page.append(note);
    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;table-layout:fixed;font-size:13px;';
    const head = table.createTHead().insertRow();
    for (const [, label] of columns) {
      const cell = document.createElement('th');
      cell.textContent = label;
      cell.style.cssText = 'padding:11px 5px;background:#e8eef7;border-bottom:2px solid #64748b;text-align:right;white-space:nowrap;';
      if (label === '거래처') { cell.style.width = '19%'; cell.style.textAlign = 'left'; }
      head.append(cell);
    }
    const body = table.createTBody();
    const addRow = (row: NamedSettlementRow | (typeof totals & { name: string }), bold = false) => {
      const tr = body.insertRow();
      if (bold) tr.style.background = '#e8eef7';
      for (const [key] of columns) {
        const cell = tr.insertCell();
        cell.textContent = key === 'name' ? row.name : number(row[key]);
        cell.style.cssText = `padding:8px 5px;border-bottom:1px solid #dbe3ec;text-align:${key === 'name' ? 'left' : 'right'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${bold ? 'font-weight:700;' : ''}`;
      }
    };
    pages[index].forEach(row => addRow(row));
    if (index === pages.length - 1) addRow({ ...totals, name: '전체 합계' }, true);
    page.append(table);
    const footer = document.createElement('div');
    footer.textContent = `입금·환불은 108 외상매출금 자금근거 · 비현금 감소는 상계 등 · ${index + 1} / ${pages.length}`;
    footer.style.cssText = 'position:absolute;bottom:30px;left:46px;font-size:11px;color:#64748b;';
    page.append(footer);
    document.body.append(page);
    try {
      const canvas = await html2canvas(page, { scale: 2, backgroundColor: '#ffffff' });
      if (index) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 297, 210);
    } finally {
      page.remove();
    }
  }
  pdf.save(`거래처별정산_${month}.pdf`);
}
