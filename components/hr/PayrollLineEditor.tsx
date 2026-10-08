import React from 'react';
import { Printer } from 'lucide-react';
import { payrollGross, payrollDeduct, payrollNet, payrollTotals, type PayrollLine } from '../../src/shared/types';
const won = (value: number) => value.toLocaleString('ko-KR');
export default function PayrollLineEditor({ lines, onCell, onPrint }: {
  lines: PayrollLine[];
  onCell: (index: number, field: keyof PayrollLine, value: string) => void;
  onPrint?: (line: PayrollLine) => void;
}) {
  const totals = payrollTotals(lines);
  return (
              <table className="w-full text-left min-w-[1100px] text-xs">
                <thead className="bg-slate-50 border-b border-slate-100 text-[10px] font-black text-slate-400">
                  <tr>
                    <th className="px-3 py-2.5 whitespace-nowrap">이름</th>
                    <th className="px-3 py-2.5 whitespace-nowrap">부서</th>
                    <th className="px-2 py-2.5 text-right whitespace-nowrap">기본급</th>
                    <th className="px-2 py-2.5 text-right whitespace-nowrap">연장수당</th>
                    <th className="px-2 py-2.5 text-right whitespace-nowrap">기타수당</th>
                    <th className="px-2 py-2.5 text-right bg-slate-100 whitespace-nowrap">지급계</th>
                    <th className="px-2 py-2.5 text-right whitespace-nowrap">소득세</th>
                    <th className="px-2 py-2.5 text-right whitespace-nowrap">지방세</th>
                    <th className="px-2 py-2.5 text-right whitespace-nowrap">국민연금</th>
                    <th className="px-2 py-2.5 text-right whitespace-nowrap">건강보험</th>
                    <th className="px-2 py-2.5 text-right whitespace-nowrap">고용보험</th>
                    <th className="px-2 py-2.5 text-right whitespace-nowrap">기타공제</th>
                    <th className="px-2 py-2.5 text-right bg-slate-100 whitespace-nowrap">공제계</th>
                    <th className="px-2 py-2.5 text-right bg-violet-50 whitespace-nowrap">실지급</th>
                    <th className="px-2 py-2.5 whitespace-nowrap" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {lines.map((l, i) => {
                    const cell = (field: keyof PayrollLine) => (
                      <td className="px-2 py-1.5 text-right">
                        <input inputMode="numeric" value={(l[field] as number) ? won(l[field] as number) : ''}
                          onChange={e => onCell(i, field, e.target.value)} placeholder="0"
                          className="w-20 text-right tabular-nums font-bold border border-transparent hover:border-slate-200 focus:border-violet-300 rounded-lg px-1.5 py-1 outline-none" />
                      </td>
                    );
                    return (
                      <tr key={l.employeeId} className="hover:bg-slate-50/60">
                        <td className="px-3 py-1.5 font-black text-slate-800 whitespace-nowrap">{l.employeeName}</td>
                        <td className="px-3 py-1.5 text-slate-400 whitespace-nowrap">{l.department}</td>
                        {cell('base')}{cell('overtime')}{cell('allowance')}
                        <td className="px-2 py-1.5 text-right font-black tabular-nums text-slate-700 bg-slate-50">{won(payrollGross(l))}</td>
                        {cell('incomeTax')}{cell('localTax')}{cell('pension')}{cell('health')}{cell('employment')}{cell('otherDeduct')}
                        <td className="px-2 py-1.5 text-right font-black tabular-nums text-rose-500 bg-slate-50">{won(payrollDeduct(l))}</td>
                        <td className="px-2 py-1.5 text-right font-black tabular-nums text-violet-700 bg-violet-50/60">{won(payrollNet(l))}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <button disabled={!onPrint} onClick={() => onPrint?.(l)} title="급여명세서"
                            className="text-slate-300 hover:text-violet-600 transition-colors"><Printer size={13} /></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-100 border-t-2 border-slate-200">
                  <tr>
                    <td className="px-3 py-2.5 font-black text-slate-700" colSpan={2}>합계 {lines.length}명</td>
                    <td colSpan={3} />
                    <td className="px-2 py-2.5 text-right font-black tabular-nums text-slate-800">{won(totals.gross)}</td>
                    <td colSpan={6} />
                    <td className="px-2 py-2.5 text-right font-black tabular-nums text-rose-600">{won(totals.deduct)}</td>
                    <td className="px-2 py-2.5 text-right font-black tabular-nums text-violet-700">{won(totals.net)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
  );
}
