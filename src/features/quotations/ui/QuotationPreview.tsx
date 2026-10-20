import React from 'react';
import { Printer, X } from 'lucide-react';
import type { CompanyInfo } from '../../../shared/types';
import type { Quotation } from '../domain/quotation';
import { fmt } from './quotationDisplay';
import { formatQuantity } from '../../../shared/quantityDisplay';
import { lineAmount } from '../../../shared/lineAmount';
import { quoteTotals } from '../../../shared/quoteTotals';

export function QuotationPreview({ viewing, printCompany, companyName, onClose, onPrint }: {
  viewing: Quotation; printCompany: CompanyInfo; companyName: string;
  onClose: () => void; onPrint: () => void;
}) {
  return (
<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 print:static print:bg-white print:p-0">
          <div id="quotation-print-area" className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden print:max-h-none print:shadow-none print:rounded-none"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 print:hidden">
              <h3 className="font-black text-slate-900 text-sm">{viewing.quoteNo}</h3>
              <div className="flex items-center gap-2">
                <button onClick={onPrint}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-black hover:bg-slate-800">
                  <Printer size={13} />인쇄
                </button>
                <button onClick={onClose} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl"><X size={16} /></button>
              </div>
            </div>
            <div id="quotation-print-document" className="flex-1 overflow-y-auto px-7 py-6 text-slate-900 print:overflow-visible print:px-0 print:py-0">
              {/* 현장에서 익숙한 표준 견적서 구조를 그대로 따른다. 카드형 배치는 인쇄 때 빈 공간이 커지고
                  항목 위치를 한눈에 대조하기 어려웠다. */}
              <table className="w-full table-fixed border-collapse text-[11px] [&_td]:border [&_td]:border-slate-400 [&_td]:px-2 [&_td]:py-2">
                <tbody>
                  <tr><td colSpan={4} className="text-center text-lg font-black tracking-[0.3em]">견 적 서</td></tr>
                  <tr>
                    <td className="w-[16%] bg-slate-100 text-center font-black">수신</td><td className="w-[34%] font-bold">{viewing.partnerName} 귀하</td>
                    <td className="w-[16%] bg-slate-100 text-center font-black">상호</td><td className="w-[34%] font-black">{printCompany.name || companyName}</td>
                  </tr>
                  <tr>
                    <td className="bg-slate-100 text-center font-black">참조</td><td>{viewing.recipientPhone || '—'}</td>
                    <td className="bg-slate-100 text-center font-black">대표자</td><td>{printCompany.ceoName}</td>
                  </tr>
                  <tr>
                    <td className="bg-slate-100 text-center font-black">견적일</td><td>{viewing.date}</td>
                    <td className="bg-slate-100 text-center font-black">주소</td><td>{printCompany.address}</td>
                  </tr>
                  <tr>
                    <td className="bg-slate-100 text-center font-black">유효기간</td><td>{viewing.validUntil ?? '별도 협의'}</td>
                    <td className="bg-slate-100 text-center font-black">업태·종목</td><td>{printCompany.bizType} · {printCompany.bizItem}</td>
                  </tr>
                  <tr>
                    <td className="bg-slate-100 text-center font-black">결제 조건</td><td>{viewing.paymentTerms || '별도 협의'}</td>
                    <td className="bg-slate-100 text-center font-black">연락처</td><td>{printCompany.phone || '—'}{printCompany.fax && <><br />FAX {printCompany.fax}</>}</td>
                  </tr>
                  <tr>
                    <td colSpan={2} className="font-bold">아래와 같이 견적합니다.</td>
                    <td className="bg-slate-100 text-center font-black">담당자</td><td>{viewing.attention || '—'}</td>
                  </tr>
                  <tr>
                    <td className="bg-slate-100 text-center font-black">견적번호</td><td>{viewing.quoteNo}</td>
                    <td className="bg-slate-100 text-center font-black">납기</td><td>{viewing.deliveryTerms || '별도 협의'}</td>
                  </tr>
                  <tr>
                    <td className="bg-slate-100 text-center font-black">합계금액</td>
                    <td colSpan={3} className="text-center text-base font-black">일금 ₩ {fmt(viewing.totalAmount)}정</td>
                  </tr>
                </tbody>
              </table>

              <table className="w-full table-fixed border-collapse text-[10px] [&_td]:border [&_td]:border-slate-400 [&_td]:px-1.5 [&_td]:py-1.5 [&_th]:border [&_th]:border-slate-400 [&_th]:bg-slate-100 [&_th]:px-1 [&_th]:py-1.5">
                <thead><tr>
                  <th className="w-[5%]">No</th><th className="w-[22%]">품명</th><th className="w-[12%]">규격</th>
                  <th className="w-[8%]">수량</th><th className="w-[7%]">단위</th><th className="w-[13%]">단가</th>
                  <th className="w-[14%]">공급가액</th><th className="w-[10%]">세액</th><th className="w-[9%]">비고</th>
                </tr></thead>
                <tbody>
                  {Array.from({ length: Math.max(12, viewing.lines.length) }, (_, i) => {
                    const l = viewing.lines[i];
                    const amount = l ? lineAmount(l.qty, l.price, l.isTaxExempt) : null;
                    return <tr key={i} className="h-9">
                      <td className="text-center">{i + 1}</td><td className="font-bold">{l?.name || ''}</td><td>{l?.spec || ''}</td>
                      <td className="text-right tabular-nums break-all">{l ? formatQuantity(l.qty) : ''}</td><td className="text-center">{l?.unit || ''}</td>
                      <td className="text-right tabular-nums">{l ? fmt(l.price) : ''}</td>
                      <td className="text-right tabular-nums">{amount ? fmt(amount.supply) : ''}</td>
                      <td className="text-right tabular-nums">{amount ? fmt(amount.tax) : ''}</td>
                      <td className="text-center">{l?.isTaxExempt ? '면세' : l?.note || ''}</td>
                    </tr>;
                  })}
                  <tr className="font-black"><td colSpan={6} className="bg-slate-100 text-center">합계</td>
                    <td className="text-right">{fmt(viewing.totalSupply)}</td><td className="text-right">{fmt(viewing.totalTax)}</td><td /></tr>
                </tbody>
              </table>

              <table className="w-full table-fixed border-collapse text-[11px] [&_td]:border [&_td]:border-slate-400 [&_td]:px-2 [&_td]:py-2">
                <tbody>
                  <tr><td className="w-[22%] bg-slate-100 text-center font-black">납기</td><td>{viewing.deliveryTerms || '별도 협의'}</td></tr>
                  <tr><td className="bg-slate-100 text-center font-black">입금계좌</td><td>{printCompany.bankAccount || '별도 안내'}</td></tr>
                  <tr><td className="bg-slate-100 text-center font-black">비고</td><td className="h-24 whitespace-pre-wrap align-top">{viewing.note || ''}</td></tr>
                </tbody>
              </table>
              {/* 원가·마진은 **인쇄에서 뺀다** — 거래처에 주는 종이다 */}
              {quoteTotals(viewing.lines).cost > 0 && (
                <p className="mt-3 text-[11px] font-bold text-slate-400 print:hidden">
                  원가 {fmt(quoteTotals(viewing.lines).cost)} · 마진 {fmt(quoteTotals(viewing.lines).margin)}
                  ({(quoteTotals(viewing.lines).marginRate * 100).toFixed(1)}%) — 이 줄은 인쇄에 안 나옵니다
                </p>
              )}
            </div>
          </div>
        </div>
  );
}
