import { useHaccpCompany } from '../context/HaccpCompanyContext';
import { useOutputScope } from '../../../shared/hooks/useOutputScope';
import React, { useRef, useState } from 'react';
import { FileDown } from 'lucide-react';
import { TH, TD, TDL, FormHeader, SignBox } from './ChecklistFormParts';
import { CCP_PRODUCTS } from '../domain/ccpProducts';
import { downloadAsPDF } from '../infrastructure/downloadAsPDF';

interface CCPMetalRow {
  date: string;
  time: string;
  product: string;
  batch: string;
  fe: string;
  sus: string;
  feResult: '' | 'O' | 'X';
  susResult: '' | 'O' | 'X';
  productResult: '' | 'O' | 'X';
  corrective: string;
  operator: string;
  verifier: string;
}

const CCPMetalForm: React.FC = () => {
  const companyId = useHaccpCompany();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const outputSignal = useOutputScope(companyId, month);
  const [rows, setRows] = useState<CCPMetalRow[]>([
    { date: '', time: '', product: CCP_PRODUCTS[0], batch: '', fe: '', sus: '', feResult: '', susResult: '', productResult: '', corrective: '', operator: '', verifier: '' },
  ]);
  const ref = useRef<HTMLDivElement>(null);

  const addRow = () => setRows(prev => [...prev, { date: '', time: '', product: CCP_PRODUCTS[0], batch: '', fe: '', sus: '', feResult: '', susResult: '', productResult: '', corrective: '', operator: '', verifier: '' }]);
  const update = (idx: number, field: keyof CCPMetalRow, value: string) =>
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));

  return (
    <div>
      <div className="flex gap-3 mb-3 flex-wrap">
        <label className="text-xs text-slate-600 flex items-center gap-1">
          관리월: <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="border border-slate-300 rounded px-1 py-0.5 text-xs" />
        </label>
        <button onClick={addRow} className="text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-50">+ 행 추가</button>
        <button
          onClick={() => ref.current && downloadAsPDF(ref.current, `HACCP_CCP금속검출모니터링일지_${month}.pdf`, outputSignal())}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition-colors"
        >
          <FileDown size={13} /> PDF 저장
        </button>
      </div>

      <div ref={ref} className="bg-white p-6 font-sans" style={{ fontFamily: 'Malgun Gothic, sans-serif' }}>
        <FormHeader title="CCP-P 모니터링일지 [금속검출공정]" date={month} />

        <div className="border border-slate-400 p-2 mb-3 text-xs bg-amber-50">
          <div className="font-bold mb-1">한계기준(CL) — 이탈 시 즉각 개선조치 필요</div>
          <div>• Fe(철) 테스트피스: 2.0㎜φ — 검출(감도 확인) / 제품: 불검출</div>
          <div>• Sus(스테인리스) 테스트피스: 2.5㎜φ — 검출(감도 확인) / 제품: 불검출</div>
          <div>• 기준 이탈 시: 해당 배치 전량 재검사 또는 격리 후 처리</div>
        </div>

        <p className="text-xs text-slate-500 mb-2">감도확인: O=검출(정상) X=미검출(이상) / 제품검사: O=불검출(정상) X=검출(이상)</p>

        <div className="overflow-x-auto">
          <table className="border-collapse text-xs" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th className={TH} rowSpan={2}>검사일</th>
                <th className={TH} rowSpan={2}>검사시간</th>
                <th className={TH} rowSpan={2}>제품명</th>
                <th className={TH} rowSpan={2}>배치번호</th>
                <th className={TH} colSpan={2}>감도확인(테스트피스)</th>
                <th className={TH} rowSpan={2}>제품검사결과</th>
                <th className={TH} rowSpan={2}>개선조치</th>
                <th className={TH} rowSpan={2}>검사자</th>
                <th className={TH} rowSpan={2}>확인자</th>
              </tr>
              <tr>
                <th className={TH}>Fe 2.0㎜φ</th>
                <th className={TH}>Sus 2.5㎜φ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx}>
                  <td className={TD}><input type="date" value={row.date} onChange={e => update(idx, 'date', e.target.value)} className="text-xs border-none outline-none bg-transparent w-24" /></td>
                  <td className={TD}><input type="time" value={row.time} onChange={e => update(idx, 'time', e.target.value)} className="text-xs border-none outline-none bg-transparent" /></td>
                  <td className={TD}>
                    <select value={row.product} onChange={e => update(idx, 'product', e.target.value)} className="text-xs border-none outline-none bg-transparent">
                      {CCP_PRODUCTS.map(p => <option key={p}>{p}</option>)}
                    </select>
                  </td>
                  <td className={TD}><input value={row.batch} onChange={e => update(idx, 'batch', e.target.value)} className="w-14 text-xs border-none outline-none bg-transparent text-center" /></td>
                  <td className={TD}>
                    <select value={row.feResult} onChange={e => update(idx, 'feResult', e.target.value)} className={`text-xs border-none outline-none bg-transparent font-bold ${row.feResult === 'X' ? 'text-rose-600' : row.feResult === 'O' ? 'text-green-600' : ''}`}>
                      <option value="">-</option>
                      <option value="O">O(검출)</option>
                      <option value="X">X(미검출)</option>
                    </select>
                  </td>
                  <td className={TD}>
                    <select value={row.susResult} onChange={e => update(idx, 'susResult', e.target.value)} className={`text-xs border-none outline-none bg-transparent font-bold ${row.susResult === 'X' ? 'text-rose-600' : row.susResult === 'O' ? 'text-green-600' : ''}`}>
                      <option value="">-</option>
                      <option value="O">O(검출)</option>
                      <option value="X">X(미검출)</option>
                    </select>
                  </td>
                  <td className={TD}>
                    <select value={row.productResult} onChange={e => update(idx, 'productResult', e.target.value)} className={`text-xs border-none outline-none bg-transparent font-bold ${row.productResult === 'X' ? 'text-rose-600' : row.productResult === 'O' ? 'text-green-600' : ''}`}>
                      <option value="">-</option>
                      <option value="O">O(불검출)</option>
                      <option value="X">X(검출)</option>
                    </select>
                  </td>
                  <td className={TDL}><input value={row.corrective} onChange={e => update(idx, 'corrective', e.target.value)} className="w-full text-xs border-none outline-none bg-transparent" /></td>
                  <td className={TD}><input value={row.operator} onChange={e => update(idx, 'operator', e.target.value)} className="w-12 text-xs border-none outline-none bg-transparent text-center" /></td>
                  <td className={TD}><input value={row.verifier} onChange={e => update(idx, 'verifier', e.target.value)} className="w-12 text-xs border-none outline-none bg-transparent text-center" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <SignBox labels={['작성자', '검증자', '관리자']} />
      </div>
    </div>
  );
};

export default CCPMetalForm;
