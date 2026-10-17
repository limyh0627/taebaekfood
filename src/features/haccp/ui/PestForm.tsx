import React, { useState, useRef } from 'react';
import { FileDown } from 'lucide-react';
import { TH, TD, TDL, FormHeader, SignBox } from './ChecklistFormParts';
import { downloadAsPDF } from '../infrastructure/downloadAsPDF';
import { today } from '../../../shared/day';

const PEST_LOCATIONS = [
  '원료 창고', '제조실(향미유)', '제조실(고춧가루)', '포장실', '완제품 창고', '탈의실', '화장실', '외부 주변',
];

const PEST_CHECK_ITEMS = [
  '방충망 파손 여부', '출입문 틈새 여부', '끈끈이 트랩 포획 유무', '쥐덫 포획 유무', '배수구 망 상태', '이물·쥐똥 흔적 여부',
];

interface PestRow {
  date: string;
  season: '하절기' | '동절기';
  location: string;
  checks: Record<string, '' | 'O' | 'X'>;
  corrective: string;
  inspector: string;
}

export const PestForm: React.FC = () => {
  const [rows, setRows] = useState<PestRow[]>([
    { date: today(), season: '하절기', location: '', checks: {}, corrective: '', inspector: '' },
  ]);
  const ref = useRef<HTMLDivElement>(null);

  const addRow = () => setRows(prev => [...prev, { date: today(), season: '하절기', location: '', checks: {}, corrective: '', inspector: '' }]);
  const updateRow = (idx: number, field: keyof PestRow, value: any) =>
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  const updateCheck = (idx: number, key: string, val: '' | 'O' | 'X') =>
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, checks: { ...r.checks, [key]: val } } : r));

  const currentYear = new Date().getFullYear();

  return (
    <div>
      <div className="flex gap-3 mb-3 flex-wrap">
        <span className="text-xs text-slate-500">※ 하절기(4~10월): 주 1회 이상 / 동절기(11~3월): 월 1회 이상</span>
        <button onClick={addRow} className="text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-50">+ 행 추가</button>
        <button
          onClick={() => ref.current && downloadAsPDF(ref.current, `HACCP_방충방서점검표_${currentYear}.pdf`)}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition-colors"
        >
          <FileDown size={13} /> PDF 저장
        </button>
      </div>

      <div ref={ref} className="bg-white p-6 font-sans" style={{ fontFamily: 'Malgun Gothic, sans-serif' }}>
        <FormHeader title="방충·방서 점검표" />
        <p className="text-xs text-slate-500 mb-3">O: 이상 없음 / X: 이상 있음 (X 시 개선조치 기재 필수)</p>

        <div className="overflow-x-auto">
          <table className="border-collapse text-xs" style={{ minWidth: 800 }}>
            <thead>
              <tr>
                <th className={TH}>점검일</th>
                <th className={TH}>구분</th>
                <th className={TH}>장소</th>
                {PEST_CHECK_ITEMS.map(c => <th key={c} className={TH}>{c}</th>)}
                <th className={TH}>개선조치</th>
                <th className={TH}>점검자</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx}>
                  <td className={TD}>
                    <input type="date" value={row.date} onChange={e => updateRow(idx, 'date', e.target.value)} className="text-xs border-none outline-none bg-transparent w-24" />
                  </td>
                  <td className={TD}>
                    <select value={row.season} onChange={e => updateRow(idx, 'season', e.target.value)} className="text-xs border-none outline-none bg-transparent">
                      <option>하절기</option>
                      <option>동절기</option>
                    </select>
                  </td>
                  <td className={TD}>
                    <select value={row.location} onChange={e => updateRow(idx, 'location', e.target.value)} className="text-xs border-none outline-none bg-transparent">
                      <option value="">선택</option>
                      {PEST_LOCATIONS.map(l => <option key={l}>{l}</option>)}
                    </select>
                  </td>
                  {PEST_CHECK_ITEMS.map(c => (
                    <td key={c} className={TD}>
                      <select value={row.checks[c] ?? ''} onChange={e => updateCheck(idx, c, e.target.value as '' | 'O' | 'X')} className={`text-xs border-none outline-none bg-transparent font-bold ${row.checks[c] === 'X' ? 'text-rose-600' : row.checks[c] === 'O' ? 'text-green-600' : ''}`}>
                        <option value="">-</option>
                        <option value="O">O</option>
                        <option value="X">X</option>
                      </select>
                    </td>
                  ))}
                  <td className={TDL}>
                    <input value={row.corrective} onChange={e => updateRow(idx, 'corrective', e.target.value)} className="w-full text-xs border-none outline-none bg-transparent" />
                  </td>
                  <td className={TD}>
                    <input value={row.inspector} onChange={e => updateRow(idx, 'inspector', e.target.value)} className="w-full text-xs border-none outline-none bg-transparent" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <SignBox />
      </div>
    </div>
  );
};
