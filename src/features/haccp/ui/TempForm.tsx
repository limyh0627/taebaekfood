import React, {useState,useRef,useEffect} from 'react';
import {FileDown,Thermometer,Save,Trash2,BadgeCheck,Plus} from 'lucide-react';
import {collection,doc,onSnapshot,query,where} from 'firebase/firestore';
import {db} from '../../../shared/firebase';
import {addItem,updateItem,deleteItem} from '../../../shared/services/firebaseService';
import {appConfirm} from '../../../shared/components/appDialog';
import {haccpTemplateDocId} from '../../../shared/haccpTemplateId';
import {useHaccpCompany} from '../context/HaccpCompanyContext';
import {todayStr} from '../domain/haccpDate';
import {STORAGE_ZONES,type StorageZone} from '../domain/tempZones';
import {TH,TD,TDL} from './ChecklistFormParts';
import {downloadAsPDF} from '../infrastructure/downloadAsPDF';

interface TempRow {
  zone: string;
  temp: string;
  result: '' | 'O' | 'X';
  corrective: string;
  inspector: string;
}

interface TempRecord {
  id?: string;
  date: string;
  measureTime: '12:30';
  rows: TempRow[];
  createdBy: string; createdAt: string;
  updatedBy: string; updatedAt: string;
  revisionCount: number;
  confirmedBy?: string; confirmedAt?: string;
}

const defaultTempRows = (zones: StorageZone[] = STORAGE_ZONES): TempRow[] =>
  zones.map(z => ({ zone: z.name, temp: '', result: '' as '', corrective: '', inspector: '' }));

export const TempForm: React.FC<{ currentUser?: { id: string; name: string }; isAdmin?: boolean; canConfirm?: boolean }> = ({ currentUser, isAdmin, canConfirm }) => {
  const companyId = useHaccpCompany();
  const today = todayStr();
  const [records, setRecords] = useState<TempRecord[]>([]);
  const [selected, setSelected] = useState<TempRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [templateZones, setTemplateZones] = useState<StorageZone[]>(STORAGE_ZONES);
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query(collection(db, 'haccp_temp'), where('companyId', '==', companyId));
    return onSnapshot(q, snap => setRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as TempRecord)).filter(row => typeof row.date === 'string').sort((a, b) => b.date.localeCompare(a.date))));
  }, [companyId]);

  useEffect(() => {
    return onSnapshot(doc(db, 'haccp_templates', haccpTemplateDocId(companyId, 'temp_zones')), snap => {
      if (snap.exists()) {
        const data = snap.data().zones;
        if (Array.isArray(data) && data.length > 0) setTemplateZones(data);
      }
    });
  }, [companyId]);

  const todayRecord = records.find(r => r.date === today);
  const isReadOnly = selected ? selected.date !== today : false;

  const openToday = () => {
    if (todayRecord) { setSelected(todayRecord); return; }
    const rows = defaultTempRows(templateZones).map(r => ({ ...r, inspector: currentUser?.name ?? '' }));
    setSelected({ date: today, measureTime: '12:30', rows, createdBy: '', createdAt: '', updatedBy: '', updatedAt: '', revisionCount: -1 } as TempRecord);
  };

  const openHistory = (r: TempRecord) => { setSelected(r); setShowHistory(false); };

  const update = (idx: number, field: keyof TempRow, value: string) => {
    if (isReadOnly) return;
    if (field === 'temp') value = value.replace(/[^-\d]/g, '');
    setSelected(prev => prev ? { ...prev, rows: prev.rows.map((r, i) => i === idx ? { ...r, [field]: value } : r) } : prev);
  };

  const addRow = () => {
    if (isReadOnly || !isAdmin) return;
    setSelected(prev => prev ? {
      ...prev,
      rows: [...prev.rows, { zone: templateZones[0]?.name ?? '', temp: '', result: '' as '', corrective: '', inspector: currentUser?.name ?? '' }],
    } : prev);
  };

  const handleSave = async () => {
    if (!selected || isReadOnly) return;
    setSaving(true);
    const now = new Date().toISOString();
    const userName = currentUser?.name ?? '알 수 없음';
    try {
      if (!selected.id) {
        const data = { ...selected, createdBy: userName, createdAt: now, updatedBy: userName, updatedAt: now, revisionCount: 0 };
        const id = await addItem('haccp_temp', data);
        setSelected({ ...data, id });
      } else {
        const upd = { rows: selected.rows, updatedBy: userName, updatedAt: now, revisionCount: (selected.revisionCount ?? 0) + 1 };
        await updateItem('haccp_temp', selected.id, upd as any);
        setSelected(prev => prev ? { ...prev, ...upd } : prev);
      }
    } finally { setSaving(false); }
  };

  const handleConfirm = async () => {
    if (!canConfirm || !selected?.id) return;
    setConfirming(true);
    try {
      const upd = { confirmedBy: currentUser?.name ?? '관리자', confirmedAt: new Date().toISOString() };
      await updateItem('haccp_temp', selected.id, upd);
      setSelected(prev => prev ? { ...prev, ...upd } : prev);
    } finally { setConfirming(false); }
  };

  const handleDelete = async (id: string) => {
    if (!await appConfirm('이 기록을 삭제하시겠습니까?')) return;
    await deleteItem('haccp_temp', id);
    if (selected?.id === id) setSelected(null);
  };

  const revLabel = (r: TempRecord) => r.revisionCount < 0 ? '미저장' : `Rev.${r.revisionCount}`;
  const pastRecords = records.filter(r => r.date !== today);

  return (
    <div className="flex flex-col gap-4">
      {/* 오늘 날짜 카드 */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="text-xs text-slate-500 mb-3">
          오늘 측정일 <span className="font-bold text-slate-800 ml-1">{today}</span>
          <span className="ml-2 text-slate-400">· 측정시간 12:30 · 1일 1회</span>
        </div>
        <button onClick={openToday} className={`w-full flex flex-col items-center justify-center gap-1 py-4 rounded-xl border-2 text-sm font-bold transition-all ${
          selected?.date === today ? 'border-teal-500 bg-teal-50 text-teal-700'
          : todayRecord ? 'border-teal-200 bg-teal-50/50 text-teal-600 hover:border-teal-400'
          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'
        }`}>
          <span className="text-base">🌡️</span>
          <span>오늘 온도 측정 기록</span>
          {todayRecord
            ? <span className="text-xs font-normal text-teal-500">✓ {revLabel(todayRecord)} 저장됨</span>
            : <span className="text-xs font-normal text-slate-400">미작성</span>}
        </button>
      </div>

      {/* 이전 기록 */}
      <button onClick={() => setShowHistory(v => !v)} className="flex items-center justify-between px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-50">
        <span>이전 측정 기록 ({pastRecords.length}건)</span>
        <span>{showHistory ? '▲' : '▼'}</span>
      </button>
      {showHistory && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {pastRecords.length === 0 && <p className="col-span-full text-xs text-slate-400 py-4 text-center">이전 기록이 없습니다</p>}
          {pastRecords.map(r => (
            <div key={r.id} onClick={() => openHistory(r)} className={`p-3 rounded-lg border cursor-pointer text-xs transition-colors ${selected?.id === r.id ? 'bg-slate-100 border-slate-400' : 'bg-white border-slate-200 hover:border-slate-400'}`}>
              <div className="font-bold text-slate-700">{r.date}</div>
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-slate-500">{revLabel(r)}</span>
                {isAdmin && <button onClick={e => { e.stopPropagation(); r.id && handleDelete(r.id); }} className="text-rose-400 hover:text-rose-600"><Trash2 size={11} /></button>}
              </div>
              {r.confirmedBy && <div className="text-emerald-600 font-bold mt-1 text-[10px]">✓ 확인완료</div>}
              {!r.confirmedBy && r.createdBy && <div className="text-slate-400 mt-1 truncate">{r.createdBy}</div>}
            </div>
          ))}
        </div>
      )}

      {!selected && (
        <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-2">
          <Thermometer size={28} className="text-slate-300" />
          <p className="text-sm">위에서 오늘 온도 측정을 시작해주세요</p>
        </div>
      )}

      {selected && (
        <div className="flex flex-col gap-3">
          {/* 액션 바 */}
          <div className="sticky top-0 z-20 flex items-center gap-2 flex-wrap bg-slate-50/95 backdrop-blur-sm border-b border-slate-200 py-2 -mx-6 px-6">
            <span className={`text-xs font-bold px-2 py-1 rounded border ${isReadOnly ? 'bg-slate-100 text-slate-500 border-slate-300' : 'bg-teal-50 text-teal-700 border-teal-200'}`}>
              {isReadOnly ? '📋 조회 (수정 불가)' : `✏️ ${revLabel(selected)}`}
            </span>
            <span className="text-xs text-slate-500">{selected.date} · 측정시간 12:30</span>
            <div className="ml-auto flex gap-2 flex-wrap justify-end">
              <button onClick={() => printRef.current && downloadAsPDF(printRef.current, `HACCP_온도관리일지_${selected.date}.pdf`)}
                className="flex items-center gap-1 px-3 py-2 bg-slate-600 text-white rounded-lg text-xs font-bold hover:bg-slate-700">
                <FileDown size={12} /> PDF
              </button>
              {canConfirm && (
                selected.confirmedBy
                  ? <span className="flex items-center gap-1 px-3 py-2 bg-emerald-50 border border-emerald-300 text-emerald-700 rounded-lg text-xs font-bold"><BadgeCheck size={13} /> {selected.confirmedBy} 확인완료</span>
                  : <button onClick={handleConfirm} disabled={confirming || !selected.id}
                      className="flex items-center gap-1 px-3 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed">
                      <BadgeCheck size={13} /> {confirming ? '처리 중...' : !selected.id ? '저장 먼저' : '관리자 확인'}
                    </button>
              )}
              {!isReadOnly && (
                <button onClick={handleSave} disabled={saving}
                  className="flex items-center gap-1 px-3 py-2 bg-teal-600 text-white rounded-lg text-xs font-bold hover:bg-teal-700 disabled:opacity-50">
                  <Save size={12} /> {saving ? '저장 중...' : '저장'}
                </button>
              )}
            </div>
          </div>

          {/* 인쇄 영역 */}
          <div ref={printRef} className="bg-white border border-slate-200 rounded-xl p-4 md:p-6" style={{ fontFamily: 'Malgun Gothic, sans-serif' }}>
            <h2 className="text-base md:text-lg font-black text-center mb-4">냉장·냉동창고 온도관리 일지</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-px border border-slate-300 rounded-lg overflow-hidden mb-4 text-xs">
              {[
                { label: '회사명', value: '태백식품' },
                { label: '측정일', value: selected.date },
                { label: '측정시간', value: '12:30' },
                { label: '측정자', value: selected.rows[0]?.inspector || currentUser?.name || '-' },
              ].map(({ label, value }) => (
                <div key={label} className="flex flex-col">
                  <span className="bg-slate-100 text-slate-600 font-bold text-center py-1 text-[10px] border-b border-slate-200">{label}</span>
                  <span className="text-center py-1.5 text-slate-800 font-medium">{value}</span>
                </div>
              ))}
            </div>

            <div className="mb-3 text-xs">
              <table className="border-collapse w-full mb-2">
                <thead><tr><th className={TH}>보관장소</th><th className={TH}>관리기준</th></tr></thead>
                <tbody>
                  {templateZones.map(z => (<tr key={z.name}><td className={TD}>{z.name}</td><td className={TD}>{z.standard}</td></tr>))}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-slate-500 mb-2">※ O: 기준 내 / X: 기준 이탈 (이탈 시 개선조치 기재)</p>
            <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs min-w-[500px]">
              <thead>
                <tr>
                  <th className={TH}>보관장소</th>
                  <th className={TH}>온도(℃)</th>
                  <th className={TH}>적합여부</th>
                  <th className={TH} style={{ width: 130 }}>개선조치</th>
                  <th className={TH}>측정자</th>
                </tr>
              </thead>
              <tbody>
                {selected.rows.map((row, idx) => (
                  <tr key={idx} className={row.result === 'X' ? 'bg-rose-50' : row.result === 'O' ? 'bg-emerald-50/50' : ''}>
                    <td className={TDL}>
                      {isReadOnly
                        ? row.zone
                        : <select value={row.zone} onChange={e => update(idx, 'zone', e.target.value)} className="text-xs border-none outline-none bg-transparent w-full">
                            {templateZones.map(z => <option key={z.name} value={z.name}>{z.name}</option>)}
                            {row.zone && !templateZones.find(z => z.name === row.zone) && <option value={row.zone}>{row.zone}</option>}
                          </select>
                      }
                    </td>
                    <td className={TD}>
                      <input value={row.temp} onChange={e => update(idx, 'temp', e.target.value)} disabled={isReadOnly}
                        placeholder="예: 5" className="w-14 text-xs border-none outline-none bg-transparent text-center disabled:text-slate-500" />
                    </td>
                    <td className={TD}>
                      <select value={row.result} onChange={e => update(idx, 'result', e.target.value)} disabled={isReadOnly}
                        className={`text-xs border-none outline-none bg-transparent font-bold ${row.result === 'X' ? 'text-rose-600' : row.result === 'O' ? 'text-green-600' : ''}`}>
                        <option value="">-</option><option value="O">O</option><option value="X">X</option>
                      </select>
                    </td>
                    <td className={TDL}>
                      <input value={row.corrective} onChange={e => update(idx, 'corrective', e.target.value)} disabled={isReadOnly}
                        className="w-full text-xs border-none outline-none bg-transparent" />
                    </td>
                    <td className={TD}>
                      <input value={row.inspector} onChange={e => update(idx, 'inspector', e.target.value)} disabled={isReadOnly}
                        className="w-16 text-xs border-none outline-none bg-transparent text-center" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            {!isReadOnly && isAdmin && (
              <button onClick={addRow} className="mt-2 flex items-center gap-1 px-3 py-1.5 border border-dashed border-slate-300 rounded-lg text-xs text-slate-400 hover:border-teal-400 hover:text-teal-500">
                <Plus size={12} /> 행 추가
              </button>
            )}

            {/* 서명란 */}
            <div className="grid grid-cols-2 gap-3 mt-4 md:flex md:justify-end md:gap-4 text-xs">
              <div className="border border-slate-400 text-center md:w-28">
                <div className="bg-slate-100 text-xs font-bold py-1 border-b border-slate-400">측정자</div>
                <div className="h-10 flex items-center justify-center text-slate-700 font-semibold">
                  {selected.rows[0]?.inspector || currentUser?.name || '-'}
                </div>
              </div>
              <div className="border border-slate-400 text-center md:w-28">
                <div className="bg-slate-100 text-xs font-bold py-1 border-b border-slate-400">확인자</div>
                <div className="h-10 flex items-center justify-center">
                  {selected.confirmedBy
                    ? <span className="text-slate-700 font-semibold">{selected.confirmedBy}</span>
                    : canConfirm && selected.id
                      ? <button onClick={handleConfirm} disabled={confirming}
                          className="flex items-center gap-1 px-2 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 disabled:opacity-40">
                          <BadgeCheck size={11} /> {confirming ? '처리 중...' : '확인'}
                        </button>
                      : canConfirm && !selected.id
                        ? <span className="text-slate-300 text-[10px]">저장 후 확인</span>
                        : <span className="text-slate-200 text-xs">-</span>
                  }
                </div>
              </div>
            </div>

            {selected.id && (
              <div className="mt-3 text-xs text-slate-400 text-right">
                최초 작성: {selected.createdBy} ({selected.createdAt?.slice(0, 16).replace('T', ' ')})
                {selected.updatedBy !== selected.createdBy && (
                  <> · 최종 수정: {selected.updatedBy} ({selected.updatedAt?.slice(0, 16).replace('T', ' ')})</>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
