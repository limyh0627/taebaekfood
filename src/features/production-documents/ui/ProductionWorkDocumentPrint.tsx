import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  PRODUCTION_WORK_PAGE_ROWS, productionWorkPrintPages,
  type ProductionWorkDocument, type ProductionWorkDocumentLine,
} from '../domain/productionWorkDocument';

export interface ProductionWorkDocumentPrintProps {
  document: ProductionWorkDocument;
  lines: ProductionWorkDocumentLine[];
}

export const PRODUCTION_WORK_PRINT_CSS = `
.production-work-print { font-family: 'Malgun Gothic', sans-serif; font-size: 8pt; background: white; color: #111; }
.production-work-page { width: 258mm; min-height: 158mm; box-sizing: border-box; break-after: page; }
.production-work-page:last-child { break-after: auto; }
.production-work-heading { display: flex; align-items: center; height: 15mm; margin-bottom: 3mm; }
.production-work-heading h1 { flex: 1; margin: 0; text-align: center; font-size: 18pt; }
.production-work-sign { width: 65mm; border-collapse: collapse; table-layout: fixed; }
.production-work-sign td, .production-work-sign th { border: 0.25mm solid #444; text-align: center; height: 5mm; font-weight: normal; }
.production-work-sign td { height: 8mm; }
.production-work-grid { width: 100%; border-collapse: collapse; table-layout: fixed; }
.production-work-grid > thead > tr > th, .production-work-grid > tbody > tr > td { border: 0.2mm solid #555; padding: 0.4mm; text-align: center; overflow-wrap: anywhere; line-height: 1.15; }
.production-work-grid > thead > tr > th { height: 8mm; font-weight: bold; white-space: pre-line; }
.production-work-grid > tbody > tr > td { height: 5.3mm; box-sizing: border-box; }
.production-work-grid thead { display: table-header-group; }
.production-work-grid tbody tr { break-inside: avoid; page-break-inside: avoid; }
.production-work-title-cell { border: 0; padding: 0; }
.production-work-grid > .production-work-end > tr > td { border: 0; padding: 0; height: auto; text-align: left; }
.production-work-notes { margin-top: 2mm; white-space: pre-wrap; }
.production-work-notes div { border: 0.2mm solid #555; min-height: 9mm; padding: 1mm; margin-top: 1mm; }
.production-work-footer { display: flex; justify-content: space-between; font-size: 7pt; margin-top: 1mm; }
@media screen { .production-work-page { margin: 12px auto; padding: 10px; outline: 1px solid #cbd5e1; } }
@media print { .production-work-print * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`;

const headers = ['제조일자', '품목명', '규격', '제조번호\n(LOT)', '소비기한', '생산량', '원료명', '원료\n사용량(kg)', '원료\n로트', '작업자', '비고'];
const widths = [11, 14, 8, 12, 11, 9, 12, 9, 9, 9, 12];
const numberText = (value: number | null) => value === null || !Number.isFinite(value) ? '미확인' : value.toLocaleString('ko-KR', { maximumFractionDigits: 6 });

export default function ProductionWorkDocumentPrint({ document, lines }: ProductionWorkDocumentPrintProps) {
  const pages = productionWorkPrintPages(lines);
  return <div className="production-work-print">
    <style>{PRODUCTION_WORK_PRINT_CSS}</style>
    {pages.map((page, index) => <section className="production-work-page" key={index} aria-label="생산작업일지 인쇄 묶음">
      <table className="production-work-grid" aria-label="생산 및 원료 사용">
        <colgroup>{widths.map((width, i) => <col key={i} style={{ width: `${width / widths.reduce((a, b) => a + b, 0) * 100}%` }} />)}</colgroup>
        <thead>
          <tr><td colSpan={11} className="production-work-title-cell"><header className="production-work-heading">
        <h1>생산작업일지</h1>
        <table className="production-work-sign" aria-label="작성 검토 승인 이름">
          <thead><tr><th>작성</th><th>검토</th><th>승인</th></tr></thead>
          <tbody><tr><td>{document.preparedByName}</td><td>{document.reviewedByName}</td><td>{document.approvedByName}</td></tr></tbody>
        </table>
      </header></td></tr>
          <tr data-production-columns>{headers.map(label => <th key={label}>{label}</th>)}</tr>
        </thead>
        <tbody data-production-rows>
          {page.map(({ line, showProduction, issues }) => <tr key={line.id}>
            <td>{showProduction ? line.manufacturedDate || '미확인' : ''}</td>
            <td>{showProduction ? line.itemNameSnapshot || '미확인' : '동일 생산 건'}</td>
            <td>{showProduction ? line.specSnapshot || '미확인' : ''}</td>
            <td>{showProduction ? line.manufacturingLotNo || '미확인' : ''}</td>
            <td>{showProduction ? line.expiryDate || '미확인' : ''}</td>
            <td>{showProduction ? `${numberText(line.productionQty)} ${line.productionUnit}` : ''}</td>
            <td>{line.rawNameSnapshot || '미확인'}</td>
            <td>{numberText(line.rawUsedKg)}</td>
            <td>{line.rawLotNoSnapshot || '미확인'}</td>
            <td>{line.workerNameSnapshot || '미확인'}</td>
            <td>{[line.note, ...(issues.length ? ['확인 필요'] : [])].filter(Boolean).join(' · ')}</td>
          </tr>)}
          {Array.from({ length: PRODUCTION_WORK_PAGE_ROWS - page.length }, (_, i) =>
            <tr key={`blank-${i}`} aria-hidden="true">{headers.map((_, j) => <td key={j}>&nbsp;</td>)}</tr>)}
        </tbody>
        <tbody className="production-work-end"><tr><td colSpan={11}><div className="production-work-notes">특이사항<div>{index === pages.length - 1 ? document.specialNotes : '다음 쪽에 계속'}</div></div>
      <footer className="production-work-footer"><span>{document.documentDate}</span>
        <span>{page.some(row => row.issues.length) ? '미확인 항목 포함 — 근거 및 보완 내용 확인 필요' : ''}</span>
        </footer></td></tr></tbody>
      </table>
    </section>)}
  </div>;
}

export function buildProductionWorkPrintHtml(props: ProductionWorkDocumentPrintProps): string {
  // 앱의 사이드바·전역 print CSS가 다시 섞이지 않도록 서류만 별도 문서로 인쇄한다.
  return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>생산작업일지</title><style>@page { size: A4 landscape; margin: 25.4mm 19.05mm; } html,body{margin:0;padding:0}</style></head><body>'
    + renderToStaticMarkup(<ProductionWorkDocumentPrint {...props} />) + '</body></html>';
}

export function printProductionWorkDocument(props: ProductionWorkDocumentPrintProps): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = window.document.createElement('iframe');
    frame.title = '생산작업일지 인쇄';
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1123px;height:794px;border:0;';
    let loaded = false;
    const cleanup = () => { window.clearTimeout(timeout); frame.remove(); };
    const timeout = window.setTimeout(() => {
      cleanup();
      if (!loaded) reject(new Error('인쇄 문서를 열지 못했습니다.'));
    }, 120000);
    frame.onload = async () => {
      try {
        const printWindow = frame.contentWindow;
        if (!printWindow) throw new Error('인쇄 창을 열지 못했습니다.');
        await printWindow.document.fonts?.ready;
        printWindow.addEventListener('afterprint', cleanup, { once: true });
        printWindow.focus();
        printWindow.print();
        loaded = true;
        resolve();
      } catch (error) { cleanup(); reject(error); }
    };
    frame.srcdoc = buildProductionWorkPrintHtml(props);
    window.document.body.appendChild(frame);
  });
}
