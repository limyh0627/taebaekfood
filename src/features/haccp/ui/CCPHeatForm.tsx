import { useHaccpCompany } from '../context/HaccpCompanyContext';
import { useOutputScope } from '../../../shared/hooks/useOutputScope';
import React, { useRef, useState } from 'react';
import { FileDown } from 'lucide-react';
import { TH, TD, TDL, FormHeader, SignBox } from './ChecklistFormParts';
import { CCP_PRODUCTS } from '../domain/ccpProducts';
import { downloadAsPDF } from '../infrastructure/downloadAsPDF';

interface CCPHeatRow {
  date: string;
  product: string;
  batch: string;
  startTime: string;
  endTime: string;
  setTemp: string;
  measuredTemp: string;
  duration: string;
  coreTemp: string;
  result: '' | 'O' | 'X';
  corrective: string;
  operator: string;
  verifier: string;
}

const CCPHeatForm: React.FC = () => {
  const companyId = useHaccpCompany();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const outputSignal = useOutputScope(companyId, month);
  const [rows, setRows] = useState<CCPHeatRow[]>([
    { date: '', product: CCP_PRODUCTS[0], batch: '', startTime: '', endTime: '', setTemp: '', measuredTemp: '', duration: '', coreTemp: '', result: '', corrective: '', operator: '', verifier: '' },
  ]);
  const ref = useRef<HTMLDivElement>(null);

  const addRow = () => setRows(prev => [...prev, { date: '', product: CCP_PRODUCTS[0], batch: '', startTime: '', endTime: '', setTemp: '', measuredTemp: '', duration: '', coreTemp: '', result: '', corrective: '', operator: '', verifier: '' }]);
  const update = (idx: number, field: keyof CCPHeatRow, value: string) =>
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));

  return (
    <div>
      <div className="flex gap-3 mb-3 flex-wrap">
        <label className="text-xs text-slate-600 flex items-center gap-1">
          관리월: <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="border border-slate-300 rounded px-1 py-0.5 text-xs" />
        </label>
        <button onClick={addRow} className="text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-50">+ 행 추가</button>
        <button
          onClick={() => ref.current && downloadAsPDF(ref.current, `HACCP_CCP가열살균모니터링일지_${month}.pdf`, outputSignal())}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition-colors"
        >
          <FileDown size={13} /> PDF 저장
        </button>
      </div>

      <div ref={ref} className="bg-white p-6 font-sans" style={{ fontFamily: 'Malgun Gothic, sans-serif' }}>
        <FormHeader title="CCP-B 모니터링일지 [가열·살균공정]" date={month} />

        <div className="border border-slate-400 p-2 mb-3 text-xs bg-amber-50">
          <div className="font-bold mb-1">한계기준(CL) — 이탈 시 즉각 개선조치 필요</div>
          <div>• 가열온도: 95~100℃ / 가열시간: 15~20분 이상 / 품온: 70~85℃ 이상</div>
          <div>• 기준 이탈 시: 재가열 또는 해당 배치 격리 후 품질 판정</div>
        </div>

        <p className="text-xs text-slate-500 mb-2">O: 한계기준 적합 / X: 한계기준 이탈 (개선조치 기재 필수)</p>

        <div className="overflow-x-auto">
          <table className="border-collapse text-xs" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th className={TH}>제조일</th>
                <th className={TH}>제품명</th>
                <th className={TH}>배치번호</th>
                <th className={TH}>시작시간</th>
                <th className={TH}>종료시간</th>
                <th className={TH}>설정온도(℃)</th>
                <th className={TH}>실측온도(℃)</th>
                <th className={TH}>가열시간(분)</th>
                <th className={TH}>품온(℃)</th>
                <th className={TH}>적합</th>
                <th className={TH}>개선조치</th>
                <th className={TH}>작업자</th>
                <th className={TH}>확인자</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx}>
                  <td className={TD}><input type="date" value={row.date} onChange={e => update(idx, 'date', e.target.value)} className="text-xs border-none outline-none bg-transparent w-24" /></td>
                  <td className={TD}>
                    <select value={row.product} onChange={e => update(idx, 'product', e.target.value)} className="text-xs border-none outline-none bg-transparent">
                      {CCP_PRODUCTS.map(p => <option key={p}>{p}</option>)}
                    </select>
                  </td>
                  <td className={TD}><input value={row.batch} onChange={e => update(idx, 'batch', e.target.value)} className="w-16 text-xs border-none outline-none bg-transparent text-center" /></td>
                  <td className={TD}><input type="time" value={row.startTime} onChange={e => update(idx, 'startTime', e.target.value)} className="text-xs border-none outline-none bg-transparent" /></td>
                  <td className={TD}><input type="time" value={row.endTime} onChange={e => update(idx, 'endTime', e.target.value)} className="text-xs border-none outline-none bg-transparent" /></td>
                  <td className={TD}><input value={row.setTemp} onChange={e => update(idx, 'setTemp', e.target.value)} placeholder="95~100" className="w-14 text-xs border-none outline-none bg-transparent text-center" /></td>
                  <td className={TD}><input value={row.measuredTemp} onChange={e => update(idx, 'measuredTemp', e.target.value)} placeholder="실측값" className="w-14 text-xs border-none outline-none bg-transparent text-center" /></td>
                  <td className={TD}><input value={row.duration} onChange={e => update(idx, 'duration', e.target.value)} placeholder="15~20" className="w-12 text-xs border-none outline-none bg-transparent text-center" /></td>
                  <td className={TD}><input value={row.coreTemp} onChange={e => update(idx, 'coreTemp', e.target.value)} placeholder="70~85" className="w-14 text-xs border-none outline-none bg-transparent text-center" /></td>
                  <td className={TD}>
                    <select value={row.result} onChange={e => update(idx, 'result', e.target.value)} className={`text-xs border-none outline-none bg-transparent font-bold ${row.result === 'X' ? 'text-rose-600' : row.result === 'O' ? 'text-green-600' : ''}`}>
                      <option value="">-</option>
                      <option value="O">O</option>
                      <option value="X">X</option>
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

export default CCPHeatForm;
