import { useOutputScope } from '../../../shared/hooks/useOutputScope';
import React, { useState, useRef, useEffect } from 'react';
import { FileDown, BadgeCheck, Plus, Save } from 'lucide-react';
import { TH, TD, TDL, FormHeader, SignBox } from './ChecklistFormParts';
import { downloadAsPDF } from '../infrastructure/downloadAsPDF';
import { useHaccpCompany } from '../context/HaccpCompanyContext';
import { db } from '../../../shared/firebase';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { addItem, updateItem } from '../../../shared/services/firebaseService';

const RAW_MATERIALS = [
  '참깨', '들깨', '고추', '마늘', '대두유(식용유)', '혼합식물성유지', '고춧가루', '기타원료',
];

const SUB_MATERIALS = [
  '유리병', '플라스틱용기', '마개(캡)', '라벨', '박스', '테이프', '비닐백', '기타부자재',
];

interface IncomingRow {
  date: string;
  inboundPartner: string;
  material: string;
  materialType: '원료' | '부자재';
  quantity: string;
  unit: string;
  lotNo: string;
  expDate: string;
  appearance: '' | 'O' | 'X';
  packaging: '' | 'O' | 'X';
  label: '' | 'O' | 'X';
  certAvail: '' | 'O' | 'X' | 'N/A';
  result: '' | '합격' | '불합격' | '조건부합격';
  corrective: string;
  inspector: string;
}

interface IncomingRecord {
  id?: string;
  month: string;
  rows: IncomingRow[];
  createdBy: string; createdAt: string;
  updatedBy: string; updatedAt: string;
  revisionCount: number;
  confirmedBy?: string; confirmedAt?: string;
}

const defaultIncomingRow = (): IncomingRow => ({ date: '', inboundPartner: '', material: RAW_MATERIALS[0], materialType: '원료', quantity: '', unit: 'kg', lotNo: '', expDate: '', appearance: '' as '', packaging: '' as '', label: '' as '', certAvail: '' as '', result: '' as '', corrective: '', inspector: '' });

export const IncomingForm: React.FC<{ currentUser?: { id: string; name: string }; isAdmin?: boolean; canConfirm?: boolean }> = ({ currentUser, isAdmin, canConfirm }) => {
  const companyId = useHaccpCompany();
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const outputSignal = useOutputScope(companyId, month);
  const [records, setRecords] = useState<IncomingRecord[]>([]);
  const [workingRows, setWorkingRows] = useState<IncomingRow[]>([defaultIncomingRow()]);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query(collection(db, 'haccp_incoming'), where('companyId', '==', companyId));
    return onSnapshot(q, snap => setRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as IncomingRecord)).filter(row => typeof row.month === 'string').sort((a, b) => b.month.localeCompare(a.month))));
  }, [companyId]);

  const currentRecord = records.find(r => r.month === month);
  const isReadOnly = month < currentMonth && !isAdmin;

  useEffect(() => {
    const rec = records.find(r => r.month === month);
    setWorkingRows(rec ? rec.rows : [defaultIncomingRow()]);
  }, [month, records]);

  const addRow = () => { if (!isReadOnly) setWorkingRows(prev => [...prev, defaultIncomingRow()]); };
  const update = (idx: number, field: keyof IncomingRow, value: string) => {
    if (isReadOnly) return;
    setWorkingRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };

  const handleSave = async () => {
    if (isReadOnly) return;
    setSaving(true);
    const now = new Date().toISOString();
    const userName = currentUser?.name ?? '알 수 없음';
    try {
      if (!currentRecord?.id) {
        await addItem('haccp_incoming', { month, rows: workingRows, createdBy: userName, createdAt: now, updatedBy: userName, updatedAt: now, revisionCount: 0 });
      } else {
        await updateItem('haccp_incoming', currentRecord.id, { rows: workingRows, updatedBy: userName, updatedAt: now, revisionCount: (currentRecord.revisionCount ?? 0) + 1 });
      }
    } finally { setSaving(false); }
  };

  const handleConfirm = async () => {
    if (!canConfirm || !currentRecord?.id) return;
    setConfirming(true);
    try {
      await updateItem('haccp_incoming', currentRecord.id, { confirmedBy: currentUser?.name ?? '관리자', confirmedAt: new Date().toISOString() });
    } finally { setConfirming(false); }
  };

  const resultColor = (r: IncomingRow['result']) => r === '합격' ? 'text-green-600' : r === '불합격' ? 'text-rose-600' : r === '조건부합격' ? 'text-amber-600' : '';

  const statusEl = currentRecord?.confirmedBy
    ? <span className="flex items-center gap-1 text-xs text-emerald-600 font-bold"><BadgeCheck size={13}/>{currentRecord.confirmedBy} 확인완료</span>
    : currentRecord
    ? <span className="text-xs text-blue-600 font-bold">저장됨 · 수정 {currentRecord.revisionCount}회 · {currentRecord.updatedBy}</span>
    : <span className="text-xs text-slate-400">미저장</span>;

  return (
    <div className="relative pb-16">
      {/* 컨트롤 바 */}
      <div className="flex gap-3 mb-3 flex-wrap items-center">
        <label className="text-xs text-slate-600 flex items-center gap-1">
          관리월: <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="border border-slate-300 rounded px-1 py-0.5 text-xs" />
        </label>
        {statusEl}
        {isReadOnly && (
          <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-500 rounded font-medium">읽기 전용</span>
        )}
        {records.length > 0 && (
          <select
            className="ml-auto text-xs border border-slate-300 rounded px-2 py-1"
            value={month}
            onChange={e => setMonth(e.target.value)}
          >
            {records.map(r => (
              <option key={r.month} value={r.month}>{r.month} {r.confirmedBy ? '✓' : ''}</option>
            ))}
          </select>
        )}
      </div>

      {/* 인쇄 영역 */}
      <div ref={printRef} className="bg-white p-6 font-sans" style={{ fontFamily: 'Malgun Gothic, sans-serif' }}>
        <FormHeader title="원료·부자재 입고검사일지" date={month} />
        <p className="text-xs text-slate-500 mb-3">O: 적합 / X: 부적합 / N/A: 해당 없음 | 불합격 시 반품 또는 격리 조치 후 처리결과 기재</p>

        <div className="overflow-x-auto">
          <table className="border-collapse text-xs" style={{ minWidth: 1000 }}>
            <thead>
              <tr>
                <th className={TH}>입고일</th>
                <th className={TH}>공급업체</th>
                <th className={TH}>품목명</th>
                <th className={TH}>구분</th>
                <th className={TH}>수량</th>
                <th className={TH}>단위</th>
                <th className={TH}>Lot번호</th>
                <th className={TH}>유통기한</th>
                <th className={TH}>외관</th>
                <th className={TH}>포장</th>
                <th className={TH}>표시사항</th>
                <th className={TH}>성적서</th>
                <th className={TH}>판정</th>
                <th className={TH}>조치사항</th>
                <th className={TH}>검사자</th>
              </tr>
            </thead>
            <tbody>
              {workingRows.map((row, idx) => (
                <tr key={idx}>
                  <td className={TD}><input type="date" value={row.date} onChange={e => update(idx, 'date', e.target.value)} disabled={isReadOnly} className="text-xs border-none outline-none bg-transparent w-24 disabled:opacity-60" /></td>
                  <td className={TDL}><input value={row.inboundPartner} onChange={e => update(idx, 'inboundPartner', e.target.value)} disabled={isReadOnly} className="w-20 text-xs border-none outline-none bg-transparent disabled:opacity-60" /></td>
                  <td className={TD}>
                    <select value={row.material} onChange={e => update(idx, 'material', e.target.value)} disabled={isReadOnly} className="text-xs border-none outline-none bg-transparent max-w-20 disabled:opacity-60">
                      <optgroup label="원료">{RAW_MATERIALS.map(m => <option key={m}>{m}</option>)}</optgroup>
                      <optgroup label="부자재">{SUB_MATERIALS.map(m => <option key={m}>{m}</option>)}</optgroup>
                    </select>
                  </td>
                  <td className={TD}>
                    <select value={row.materialType} onChange={e => update(idx, 'materialType', e.target.value)} disabled={isReadOnly} className="text-xs border-none outline-none bg-transparent disabled:opacity-60">
                      <option>원료</option>
                      <option>부자재</option>
                    </select>
                  </td>
                  <td className={TD}><input value={row.quantity} onChange={e => update(idx, 'quantity', e.target.value)} disabled={isReadOnly} className="w-12 text-xs border-none outline-none bg-transparent text-center disabled:opacity-60" /></td>
                  <td className={TD}>
                    <select value={row.unit} onChange={e => update(idx, 'unit', e.target.value)} disabled={isReadOnly} className="text-xs border-none outline-none bg-transparent disabled:opacity-60">
                      {['kg', 'g', 'L', '개', '본', '장', '롤'].map(u => <option key={u}>{u}</option>)}
                    </select>
                  </td>
                  <td className={TD}><input value={row.lotNo} onChange={e => update(idx, 'lotNo', e.target.value)} disabled={isReadOnly} className="w-16 text-xs border-none outline-none bg-transparent text-center disabled:opacity-60" /></td>
                  <td className={TD}><input type="date" value={row.expDate} onChange={e => update(idx, 'expDate', e.target.value)} disabled={isReadOnly} className="text-xs border-none outline-none bg-transparent w-24 disabled:opacity-60" /></td>
                  {(['appearance', 'packaging', 'label'] as const).map(f => (
                    <td key={f} className={TD}>
                      <select value={row[f]} onChange={e => update(idx, f, e.target.value)} disabled={isReadOnly} className={`text-xs border-none outline-none bg-transparent font-bold disabled:opacity-60 ${row[f] === 'X' ? 'text-rose-600' : row[f] === 'O' ? 'text-green-600' : ''}`}>
                        <option value="">-</option>
                        <option value="O">O</option>
                        <option value="X">X</option>
                      </select>
                    </td>
                  ))}
                  <td className={TD}>
                    <select value={row.certAvail} onChange={e => update(idx, 'certAvail', e.target.value)} disabled={isReadOnly} className={`text-xs border-none outline-none bg-transparent font-bold disabled:opacity-60 ${row.certAvail === 'X' ? 'text-rose-600' : row.certAvail === 'O' ? 'text-green-600' : ''}`}>
                      <option value="">-</option>
                      <option value="O">O</option>
                      <option value="X">X</option>
                      <option value="N/A">N/A</option>
                    </select>
                  </td>
                  <td className={TD}>
                    <select value={row.result} onChange={e => update(idx, 'result', e.target.value)} disabled={isReadOnly} className={`text-xs border-none outline-none bg-transparent font-bold disabled:opacity-60 ${resultColor(row.result)}`}>
                      <option value="">-</option>
                      <option value="합격">합격</option>
                      <option value="불합격">불합격</option>
                      <option value="조건부합격">조건부합격</option>
                    </select>
                  </td>
                  <td className={TDL}><input value={row.corrective} onChange={e => update(idx, 'corrective', e.target.value)} disabled={isReadOnly} className="w-full text-xs border-none outline-none bg-transparent disabled:opacity-60" /></td>
                  <td className={TD}><input value={row.inspector} onChange={e => update(idx, 'inspector', e.target.value)} disabled={isReadOnly} className="w-12 text-xs border-none outline-none bg-transparent text-center disabled:opacity-60" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <SignBox />
      </div>

      {/* 하단 액션 바 */}
      <div className="sticky bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-4 py-2 flex items-center gap-2 z-10">
        {!isReadOnly && (
          <button onClick={addRow} className="flex items-center gap-1 text-xs px-3 py-1.5 border border-slate-300 rounded-lg hover:bg-slate-50 font-medium">
            <Plus size={12} /> 행 추가
          </button>
        )}
        <button
          onClick={() => printRef.current && downloadAsPDF(printRef.current, `HACCP_입고검사일지_${month}.pdf`, outputSignal())}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-slate-300 rounded-lg hover:bg-slate-50 font-medium"
        >
          <FileDown size={12} /> PDF
        </button>
        {canConfirm && currentRecord?.id && !currentRecord.confirmedBy && (
          <button
            onClick={handleConfirm}
            disabled={confirming}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-bold disabled:opacity-50"
          >
            <BadgeCheck size={12} /> {confirming ? '처리 중…' : '관리자 확인'}
          </button>
        )}
        {!isReadOnly && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="ml-auto flex items-center gap-1.5 text-xs px-4 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold disabled:opacity-50"
          >
            <Save size={12} /> {saving ? '저장 중…' : '저장'}
          </button>
        )}
      </div>
    </div>
  );
};
