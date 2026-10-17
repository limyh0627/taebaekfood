import React, { useEffect, useRef, useState } from 'react';
import { FileDown, BadgeCheck, Save } from 'lucide-react';
import { TH, TD, TDL, FormHeader, SignBox } from './ChecklistFormParts';
import { useHaccpCompany } from '../context/HaccpCompanyContext';
import { downloadAsPDF } from '../infrastructure/downloadAsPDF';
import { db } from '../../../shared/firebase';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { addItem, updateItem } from '../../../shared/services/firebaseService';

const MACHINES = [
  { name: '착유기 1호', method: '분해세척 → 온수헹굼 → 자연건조' },
  { name: '착유기 2호', method: '분해세척 → 온수헹굼 → 자연건조' },
  { name: '착유기 3호', method: '분해세척 → 온수헹굼 → 자연건조' },
  { name: '착유기 4호', method: '분해세척 → 온수헹굼 → 자연건조' },
  { name: '볶음기 1호', method: '잔재물 제거 → 내·외부 브러시세척 → 건식소독' },
  { name: '볶음기 2호', method: '잔재물 제거 → 내·외부 브러시세척 → 건식소독' },
  { name: '볶음기 3호', method: '잔재물 제거 → 내·외부 브러시세척 → 건식소독' },
  { name: '필터프레스', method: '필터판 분리세척 → 온수헹굼 → 건조' },
];

const MACHINE_NAMES = MACHINES.map(m => m.name);

const CLEAN_AREAS = [
  '제조실(착유·향미유) - 바닥',
  '제조실(착유·향미유) - 작업대',
  '제조실(착유·향미유) - 배수구',
  '제조실(고춧가루) - 바닥',
  '제조실(고춧가루) - 작업대',
  '포장실 - 바닥/작업대',
  '원료창고 - 바닥/선반',
  '완제품창고 - 바닥/선반',
  '화장실 - 전체',
  '탈의실 - 전체',
  '환기후드·덕트',
  '배수구·트렌치',
];

const SANITIZERS = [
  '알코올 70%',
  '차아염소산나트륨 100ppm',
  '차아염소산나트륨 200ppm',
  '과산화수소 3%',
  '열탕소독(80℃↑)',
  '기타',
];

interface MachineCleanRow {
  date: string;
  machine: string;
  used: '' | 'O' | 'X';
  cleanMethod: string;
  sanitizer: string;
  result: '' | 'O' | 'X';
  cleaner: string;
  verifier: string;
  note: string;
}

interface AreaCleanRow {
  date: string;
  area: string;
  result: '' | 'O' | 'X';
  sanitized: '' | 'O' | 'X' | 'N/A';
  sanitizer: string;
  cleaner: string;
  note: string;
}

interface CleaningRecord {
  id?: string;
  month: string;
  machineRows: MachineCleanRow[];
  areaRows: AreaCleanRow[];
  createdBy: string; createdAt: string;
  updatedBy: string; updatedAt: string;
  revisionCount: number;
  confirmedBy?: string; confirmedAt?: string;
}

const defaultMachineRows = (): MachineCleanRow[] =>
  MACHINES.map(m => ({ date: '', machine: m.name, used: '' as '', cleanMethod: m.method, sanitizer: '', result: '' as '', cleaner: '', verifier: '', note: '' }));

const defaultAreaRows = (): AreaCleanRow[] =>
  CLEAN_AREAS.map(a => ({ date: '', area: a, result: '' as '', sanitized: '' as '', sanitizer: '', cleaner: '', note: '' }));

export const CleaningForm: React.FC<{ currentUser?: { id: string; name: string }; isAdmin?: boolean; canConfirm?: boolean }> = ({ currentUser, isAdmin, canConfirm }) => {
  const companyId = useHaccpCompany();
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const [records, setRecords] = useState<CleaningRecord[]>([]);
  const [machineRows, setMachineRows] = useState<MachineCleanRow[]>(defaultMachineRows());
  const [areaRows, setAreaRows] = useState<AreaCleanRow[]>(defaultAreaRows());
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const machineRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query(collection(db, 'haccp_cleaning'), where('companyId', '==', companyId));
    return onSnapshot(q, snap => setRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as CleaningRecord)).filter(row => typeof row.month === 'string').sort((a, b) => b.month.localeCompare(a.month))));
  }, [companyId]);

  const currentRecord = records.find(r => r.month === month);
  const isReadOnly = month < currentMonth && !isAdmin;

  useEffect(() => {
    const rec = records.find(r => r.month === month);
    setMachineRows(rec ? rec.machineRows : defaultMachineRows());
    setAreaRows(rec ? rec.areaRows : defaultAreaRows());
  }, [month, records]);

  const addMachineRow = () => { if (!isReadOnly) setMachineRows(prev => [...prev, { date: '', machine: MACHINE_NAMES[0], used: '' as '', cleanMethod: MACHINES[0].method, sanitizer: '', result: '' as '', cleaner: '', verifier: '', note: '' }]); };
  const updateMachine = (idx: number, field: keyof MachineCleanRow, value: string) => {
    if (isReadOnly) return;
    setMachineRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };

  const addAreaRow = () => { if (!isReadOnly) setAreaRows(prev => [...prev, { date: '', area: CLEAN_AREAS[0], result: '' as '', sanitized: '' as '', sanitizer: '', cleaner: '', note: '' }]); };
  const updateArea = (idx: number, field: keyof AreaCleanRow, value: string) => {
    if (isReadOnly) return;
    setAreaRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };

  const handleSave = async () => {
    if (isReadOnly) return;
    setSaving(true);
    const now = new Date().toISOString();
    const userName = currentUser?.name ?? '알 수 없음';
    try {
      if (!currentRecord?.id) {
        await addItem('haccp_cleaning', { month, machineRows, areaRows, createdBy: userName, createdAt: now, updatedBy: userName, updatedAt: now, revisionCount: 0 });
      } else {
        await updateItem('haccp_cleaning', currentRecord.id, { machineRows, areaRows, updatedBy: userName, updatedAt: now, revisionCount: (currentRecord.revisionCount ?? 0) + 1 });
      }
    } finally { setSaving(false); }
  };

  const handleConfirm = async () => {
    if (!canConfirm || !currentRecord?.id) return;
    setConfirming(true);
    try {
      await updateItem('haccp_cleaning', currentRecord.id, { confirmedBy: currentUser?.name ?? '관리자', confirmedAt: new Date().toISOString() });
    } finally { setConfirming(false); }
  };

  const statusEl = currentRecord?.confirmedBy
    ? <span className="flex items-center gap-1 text-xs text-emerald-600 font-bold"><BadgeCheck size={13}/>{currentRecord.confirmedBy} 확인완료</span>
    : currentRecord
    ? <span className="text-xs text-blue-600 font-bold">저장됨 · 수정 {currentRecord.revisionCount}회 · {currentRecord.updatedBy}</span>
    : <span className="text-xs text-slate-400">미저장</span>;

  return (
    <div className="relative pb-16 space-y-8">
      {/* 컨트롤 바 */}
      <div className="flex gap-3 flex-wrap items-center">
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

      {/* 세척소독제 기준 안내 */}
      <div className="border border-amber-300 bg-amber-50 rounded-lg p-3 text-xs">
        <div className="font-bold text-amber-800 mb-1">세척·소독제 사용 기준 (식약처 소규모 HACCP 기준)</div>
        <div className="text-amber-700 space-y-0.5">
          <div>• 알코올 70% — 작업대·기구 소독 (식품 직접 접촉면)</div>
          <div>• 차아염소산나트륨 100ppm — 바닥·벽면 소독</div>
          <div>• 차아염소산나트륨 200ppm — 화장실·배수구</div>
          <div>• 열탕소독(80℃ 이상) — 착유기 분해 부품, 기구류</div>
          <div>• 소독 후 식품 접촉면은 반드시 음용수로 헹굼</div>
        </div>
      </div>

      {/* ── 기계·설비 세척소독 일지 ── */}
      <div>
        <div className="flex gap-3 mb-3 flex-wrap items-center">
          <span className="text-sm font-bold text-slate-700">기계·설비 세척소독 일지</span>
          {!isReadOnly && (
            <button onClick={addMachineRow} className="text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-50 ml-2">+ 행 추가</button>
          )}
          <button
            onClick={() => machineRef.current && downloadAsPDF(machineRef.current, `HACCP_기계세척소독일지_${month}.pdf`)}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition-colors"
          >
            <FileDown size={13} /> PDF 저장
          </button>
        </div>
        <div ref={machineRef} className="bg-white p-4 font-sans" style={{ fontFamily: 'Malgun Gothic, sans-serif' }}>
          <FormHeader title="기계·설비 세척소독 일지" date={month} />
          <div className="border border-slate-300 bg-slate-50 p-2 mb-3 text-xs">
            <span className="font-bold">세척 주기:</span> 착유기·볶음기·필터프레스 — 사용 후 매회 / O: 적합 / X: 부적합 (부적합 시 비고에 개선조치 기재)
          </div>
          <div className="overflow-x-auto">
            <table className="border-collapse text-xs" style={{ minWidth: 860 }}>
              <thead>
                <tr>
                  <th className={TH}>세척일</th>
                  <th className={TH}>기계명</th>
                  <th className={TH}>당일사용</th>
                  <th className={TH}>세척방법</th>
                  <th className={TH}>소독제(종류/농도)</th>
                  <th className={TH}>세척결과</th>
                  <th className={TH}>세척자</th>
                  <th className={TH}>확인자</th>
                  <th className={TH}>비고</th>
                </tr>
              </thead>
              <tbody>
                {machineRows.map((row, idx) => (
                  <tr key={idx}>
                    <td className={TD}>
                      <input type="date" value={row.date} onChange={e => updateMachine(idx, 'date', e.target.value)} disabled={isReadOnly} className="text-xs border-none outline-none bg-transparent w-24 disabled:opacity-60" />
                    </td>
                    <td className={TD}>
                      <select value={row.machine} onChange={e => updateMachine(idx, 'machine', e.target.value)} disabled={isReadOnly} className="text-xs border-none outline-none bg-transparent disabled:opacity-60">
                        {MACHINE_NAMES.map(m => <option key={m}>{m}</option>)}
                      </select>
                    </td>
                    <td className={TD}>
                      <select value={row.used} onChange={e => updateMachine(idx, 'used', e.target.value)} disabled={isReadOnly} className={`text-xs border-none outline-none bg-transparent font-bold disabled:opacity-60 ${row.used === 'X' ? 'text-slate-400' : row.used === 'O' ? 'text-slate-700' : ''}`}>
                        <option value="">-</option>
                        <option value="O">O(사용)</option>
                        <option value="X">X(미사용)</option>
                      </select>
                    </td>
                    <td className={TDL}>
                      <input value={row.cleanMethod} onChange={e => updateMachine(idx, 'cleanMethod', e.target.value)} disabled={isReadOnly} className="w-full text-xs border-none outline-none bg-transparent disabled:opacity-60" placeholder="세척방법 기재" />
                    </td>
                    <td className={TD}>
                      <select value={row.sanitizer} onChange={e => updateMachine(idx, 'sanitizer', e.target.value)} disabled={isReadOnly} className="text-xs border-none outline-none bg-transparent disabled:opacity-60">
                        <option value="">선택</option>
                        {SANITIZERS.map(s => <option key={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className={TD}>
                      <select value={row.result} onChange={e => updateMachine(idx, 'result', e.target.value)} disabled={isReadOnly} className={`text-xs border-none outline-none bg-transparent font-bold disabled:opacity-60 ${row.result === 'X' ? 'text-rose-600' : row.result === 'O' ? 'text-green-600' : ''}`}>
                        <option value="">-</option>
                        <option value="O">O</option>
                        <option value="X">X</option>
                      </select>
                    </td>
                    <td className={TD}><input value={row.cleaner} onChange={e => updateMachine(idx, 'cleaner', e.target.value)} disabled={isReadOnly} className="w-12 text-xs border-none outline-none bg-transparent text-center disabled:opacity-60" /></td>
                    <td className={TD}><input value={row.verifier} onChange={e => updateMachine(idx, 'verifier', e.target.value)} disabled={isReadOnly} className="w-12 text-xs border-none outline-none bg-transparent text-center disabled:opacity-60" /></td>
                    <td className={TDL}><input value={row.note} onChange={e => updateMachine(idx, 'note', e.target.value)} disabled={isReadOnly} className="w-full text-xs border-none outline-none bg-transparent disabled:opacity-60" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <SignBox />
        </div>
      </div>

      {/* ── 작업구역 청소·소독 일지 ── */}
      <div>
        <div className="flex gap-3 mb-3 flex-wrap items-center">
          <span className="text-sm font-bold text-slate-700">작업구역 청소·소독 일지</span>
          {!isReadOnly && (
            <button onClick={addAreaRow} className="text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-50 ml-2">+ 행 추가</button>
          )}
          <button
            onClick={() => areaRef.current && downloadAsPDF(areaRef.current, `HACCP_구역청소일지_${month}.pdf`)}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition-colors"
          >
            <FileDown size={13} /> PDF 저장
          </button>
        </div>
        <div ref={areaRef} className="bg-white p-4 font-sans" style={{ fontFamily: 'Malgun Gothic, sans-serif' }}>
          <FormHeader title="작업구역 청소·소독 일지" date={month} />
          <p className="text-xs text-slate-500 mb-3">
            제조실·포장실·화장실: 1일 1회 이상 / 창고·탈의실: 주 1회 이상 | O: 적합 / X: 부적합
          </p>
          <div className="overflow-x-auto">
            <table className="border-collapse text-xs" style={{ minWidth: 760 }}>
              <thead>
                <tr>
                  <th className={TH}>점검일</th>
                  <th className={TH}>구역</th>
                  <th className={TH}>청소결과</th>
                  <th className={TH}>소독실시</th>
                  <th className={TH}>소독제(종류/농도)</th>
                  <th className={TH}>담당자</th>
                  <th className={TH}>비고(개선조치)</th>
                </tr>
              </thead>
              <tbody>
                {areaRows.map((row, idx) => (
                  <tr key={idx}>
                    <td className={TD}>
                      <input type="date" value={row.date} onChange={e => updateArea(idx, 'date', e.target.value)} disabled={isReadOnly} className="text-xs border-none outline-none bg-transparent w-24 disabled:opacity-60" />
                    </td>
                    <td className={TD}>
                      <select value={row.area} onChange={e => updateArea(idx, 'area', e.target.value)} disabled={isReadOnly} className="text-xs border-none outline-none bg-transparent disabled:opacity-60">
                        {CLEAN_AREAS.map(a => <option key={a}>{a}</option>)}
                      </select>
                    </td>
                    <td className={TD}>
                      <select value={row.result} onChange={e => updateArea(idx, 'result', e.target.value)} disabled={isReadOnly} className={`text-xs border-none outline-none bg-transparent font-bold disabled:opacity-60 ${row.result === 'X' ? 'text-rose-600' : row.result === 'O' ? 'text-green-600' : ''}`}>
                        <option value="">-</option>
                        <option value="O">O</option>
                        <option value="X">X</option>
                      </select>
                    </td>
                    <td className={TD}>
                      <select value={row.sanitized} onChange={e => updateArea(idx, 'sanitized', e.target.value)} disabled={isReadOnly} className={`text-xs border-none outline-none bg-transparent font-bold disabled:opacity-60 ${row.sanitized === 'X' ? 'text-rose-600' : row.sanitized === 'O' ? 'text-green-600' : ''}`}>
                        <option value="">-</option>
                        <option value="O">O(실시)</option>
                        <option value="X">X(미실시)</option>
                        <option value="N/A">N/A</option>
                      </select>
                    </td>
                    <td className={TD}>
                      <select value={row.sanitizer} onChange={e => updateArea(idx, 'sanitizer', e.target.value)} disabled={isReadOnly} className="text-xs border-none outline-none bg-transparent disabled:opacity-60">
                        <option value="">선택</option>
                        {SANITIZERS.map(s => <option key={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className={TD}><input value={row.cleaner} onChange={e => updateArea(idx, 'cleaner', e.target.value)} disabled={isReadOnly} className="w-12 text-xs border-none outline-none bg-transparent text-center disabled:opacity-60" /></td>
                    <td className={TDL}><input value={row.note} onChange={e => updateArea(idx, 'note', e.target.value)} disabled={isReadOnly} className="w-full text-xs border-none outline-none bg-transparent disabled:opacity-60" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <SignBox />
        </div>
      </div>

      {/* 하단 액션 바 */}
      <div className="sticky bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-4 py-2 flex items-center gap-2 z-10">
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
