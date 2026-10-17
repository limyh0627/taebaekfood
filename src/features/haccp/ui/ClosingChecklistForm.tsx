import React, { useEffect, useRef, useState } from 'react';
import { FileDown, BadgeCheck, Save } from 'lucide-react';
import { TH, TD, TDL } from './ChecklistFormParts';
import { useHaccpCompany } from '../context/HaccpCompanyContext';
import { useChecklistDraftControl } from '../hooks/useChecklistDraftControl';
import { downloadAsPDF } from '../infrastructure/downloadAsPDF';
import { db } from '../../../shared/firebase';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { addItem, updateItem, deleteItem } from '../../../shared/services/firebaseService';
import { appConfirm } from '../../../shared/components/appDialog';
import { haccpTemplateDocId } from '../../../shared/haccpTemplateId';
import { CLOSING_ITEMS_DEFAULT, type ClosingRecord } from '../domain/closingChecklist';
import type { PeriodRow } from '../domain/periodicSanitation';
import { todayStr } from '../domain/haccpDate';

const emptyClosingRecord = (date: string, items: { item: string; standard: string }[]): Omit<ClosingRecord, 'id'> => ({
  checkDate: date,
  checkZone: '',
  rows: items.map(() => ({ result: '', note: '', inspector: '' })),
  specialNotes: '',
  createdBy: '', createdAt: '', updatedBy: '', updatedAt: '',
});

export const ClosingChecklistForm: React.FC<{ currentUser?: { id: string; name: string }; isAdmin?: boolean; canConfirm?: boolean }> = ({ currentUser, isAdmin, canConfirm }) => {
  const companyId = useHaccpCompany();
  const [checkDate, setCheckDate] = useState(todayStr());
  const [templateItems, setTemplateItems] = useState<{ item: string; standard: string }[]>(CLOSING_ITEMS_DEFAULT);
  const [records, setRecords] = useState<ClosingRecord[]>([]);
  const [selected, setSelected] = useState<ClosingRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [saveError, setSaveError] = useState('');
  const printRef = useRef<HTMLDivElement>(null);
  const control = useChecklistDraftControl();
  const [recordsReady, setRecordsReady] = useState(false), [recordsError, setRecordsError] = useState('');
  const [readAttempt, setReadAttempt] = useState(0);
  const readRef = useRef({ ready: false, blocked: false, rows: [] as ClosingRecord[] });

  useEffect(() => {
    let active = true, serverConfirmed = false;
    readRef.current.ready = false; readRef.current.blocked = false; setRecordsReady(false); setRecordsError('');
    const q = query(collection(db, 'haccp_closing_checklist'), where('companyId', '==', companyId));
    const unsubscribe = onSnapshot(q, { includeMetadataChanges: true }, snap => {
      if (!active || !control.active.current) return;
      const rows = snap.docs.map(d => ({ ...d.data(), id: d.id } as ClosingRecord)).filter(row => typeof row.checkDate === 'string').sort((a, b) => b.checkDate.localeCompare(a.checkDate));
      if (snap.metadata?.fromCache === false) serverConfirmed = true;
      const ready = serverConfirmed && !readRef.current.blocked;
      readRef.current = { ready, blocked: readRef.current.blocked, rows }; setRecords(rows); setRecordsReady(ready); if (ready) setRecordsError('');
    }, () => {
      if (!active || !control.active.current) return;
      active = false; serverConfirmed = false; readRef.current.ready = false; readRef.current.blocked = true; setRecordsReady(false);
      setRecordsError('기존 기록을 확인하지 못했습니다. 입력은 보존했습니다. 다시 조회한 뒤 저장해 주세요.');
    });
    return () => { active = false; unsubscribe(); };
  }, [companyId, readAttempt]);

  useEffect(() => {
    let active = true;
    const unsubscribe = onSnapshot(doc(db, 'haccp_templates', haccpTemplateDocId(companyId, 'closing_checklist')), snap => {
      if (!active) return;
      if (snap.exists()) {
        const data = snap.data().items;
        if (Array.isArray(data) && data.length > 0) setTemplateItems(data);
      }
    });
    return () => { active = false; unsubscribe(); };
  }, [companyId]);

  useEffect(() => {
    control.generation.current++; control.dirty.current = false;
    const existing = readRef.current.ready ? readRef.current.rows.find(r => r.checkDate === checkDate) : undefined;
    setSelected(existing ?? ({ ...emptyClosingRecord(checkDate, templateItems) } as ClosingRecord)); setSaveError('');
  }, [checkDate]);
  useEffect(() => {
    const existing = records.find(r => r.checkDate === checkDate);
    if (readRef.current.ready && existing && !selected?.id && !control.dirty.current && !control.busy.current) setSelected(existing);
  }, [records, recordsReady, checkDate, selected?.id]);

  const isReadOnly = checkDate !== todayStr();

  const editSelected = (update: React.SetStateAction<ClosingRecord | null>) => {
    if (isReadOnly || control.busy.current) return;
    control.dirty.current = true; setSelected(update);
  };
  // 템플릿 항목이 추가돼(예: 6·7번) rows 길이가 부족하면 빈 행으로 채워 인덱스 접근 오류 방지
  const padRows = (rows: PeriodRow[]): PeriodRow[] =>
    rows.length >= templateItems.length
      ? rows
      : [...rows, ...templateItems.slice(rows.length).map((): PeriodRow => ({ result: '', note: '', inspector: '' }))];

  const toggleResult = (idx: number, val: 'pass' | 'fail') => {
    if (isReadOnly) return;
    const userName = currentUser?.name ?? '';
    editSelected(prev => {
      if (!prev) return prev;
      const rows = padRows(prev.rows);
      const row = rows[idx];
      const newResult = row.result === val ? '' : val;
      return {
        ...prev,
        rows: rows.map((r, i) => i === idx ? { ...r, result: newResult, inspector: r.inspector || (newResult ? userName : '') } : r),
      };
    });
  };

  const setRow = (idx: number, field: keyof PeriodRow, val: string) => {
    if (isReadOnly) return;
    editSelected(prev => prev ? { ...prev, rows: padRows(prev.rows).map((r, i) => i === idx ? { ...r, [field]: val } : r) } : prev);
  };

  const handleSave = async () => {
    if (!selected || isReadOnly || control.busy.current) return;
    if (!readRef.current.ready) { setSaveError('기존 기록 조회가 끝나야 저장할 수 있습니다. 입력을 유지한 채 다시 조회해 주세요.'); return; }
    if (!selected.id && readRef.current.rows.some(r => r.checkDate === checkDate)) { setSaveError('같은 기간에 저장된 기록이 있습니다. 저장된 기록을 열어 확인해 주세요.'); return; }
    const missingNote = selected.rows
      .map((r, i) => r.result === 'fail' && !r.note.trim() ? (templateItems[i]?.item ?? `항목 ${i + 1}`) : null)
      .filter(Boolean) as string[];
    if (missingNote.length > 0) { setSaveError(`부적합 항목의 비고사항을 입력해주세요: ${missingNote.join(', ')}`); return; }
    setSaveError('');
    control.busy.current = true; const token = control.generation.current;
    setSaving(true);
    const now = new Date().toISOString();
    const userName = currentUser?.name ?? '알 수 없음';
    try {
      if (!selected.id) {
        const data: Omit<ClosingRecord, 'id'> = { ...selected, createdBy: userName, createdAt: now, updatedBy: userName, updatedAt: now };
        const id = await addItem('haccp_closing_checklist', data);
        if (!control.current(token)) return;
        control.dirty.current = false; setSelected({ ...data, id });
      } else {
        const update = { ...selected, updatedBy: userName, updatedAt: now };
        await updateItem('haccp_closing_checklist', selected.id, update as any);
        if (!control.current(token)) return;
        control.dirty.current = false; setSelected(prev => prev ? { ...prev, ...update } : prev);
      }
    } catch { if (control.current(token)) { readRef.current.ready = false; readRef.current.blocked = true; setRecordsReady(false); setRecordsError('저장 결과를 확인하지 못했습니다. 입력은 보존했습니다. 다시 조회한 뒤 기존 기록을 확인해 주세요.'); }
    } finally { if (control.current(token)) { control.busy.current = false; setSaving(false); } }
  };

  const handleConfirm = async () => {
    if (!canConfirm || control.busy.current || !readRef.current.ready) return;
    if (!selected?.id) { alert('점검표를 먼저 저장해주세요.'); return; }
    control.busy.current = true; const token = control.generation.current;
    setConfirming(true);
    const now = new Date().toISOString();
    const userName = currentUser?.name ?? '관리자';
    try {
      const update = { confirmedBy: userName, confirmedAt: now };
      await updateItem('haccp_closing_checklist', selected.id, update);
      if (!control.current(token)) return;
      const confirmed = { ...selected, ...update };
      setSelected(confirmed);
      if (await appConfirm('확인 처리되었습니다.\nPDF 파일을 만들겠습니까?')) {
        if (control.current(token) && printRef.current) await downloadAsPDF(printRef.current, `마감체크리스트_${selected.checkDate}.pdf`);
      }
    } catch { if (control.current(token)) { readRef.current.ready = false; readRef.current.blocked = true; setRecordsReady(false); setRecordsError('확인 처리 결과를 확인하지 못했습니다. 입력을 유지했습니다. 다시 조회해 주세요.'); }
    } finally { if (control.current(token)) { control.busy.current = false; setConfirming(false); } }
  };

  const handleDelete = async (id: string) => {
    if (control.busy.current || !control.active.current) return;
    control.busy.current = true; const token = control.generation.current; setDeleting(true);
    try {
      if (!await appConfirm('이 점검표를 삭제하시겠습니까?')) return;
      if (!control.current(token)) return;
      await deleteItem('haccp_closing_checklist', id);
      if (control.current(token) && selected?.id === id) { control.dirty.current = false; setSelected(null); }
    } catch { if (control.current(token)) { readRef.current.ready = false; readRef.current.blocked = true; setRecordsReady(false); setRecordsError('삭제 결과를 확인하지 못했습니다. 초안은 유지했습니다. 다시 조회해 주세요.'); }
    } finally { if (control.current(token)) { control.busy.current = false; setDeleting(false); } }
  };

  const resultBadge = (result: PeriodRow['result']) => {
    if (result === 'pass') return <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">적합</span>;
    if (result === 'fail') return <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-700">부적합</span>;
    return <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-400">미입력</span>;
  };

  const pastRecords = records.filter(r => r.checkDate !== todayStr());
  const currentRecord = records.find(r => r.checkDate === checkDate);

  return (
    <fieldset disabled={saving || confirming || deleting} className="flex min-w-0 flex-col gap-4 border-0 p-0 m-0">
      {!recordsReady && !recordsError && <p role="status" className="text-xs text-slate-600">기존 기록을 조회 중입니다. 입력할 수 있으며 조회가 끝난 뒤 저장할 수 있습니다.</p>}
      {recordsError && <div role="alert" className="border border-slate-200 bg-white rounded px-3 py-2 text-xs"><p>{recordsError}</p><button className="mt-2 rounded border border-slate-300 px-3 py-1.5 font-medium text-slate-700" type="button" onClick={() => { readRef.current.ready = false; setRecordsReady(false); setReadAttempt(value => value + 1); }}>다시 조회</button></div>}
      {recordsReady && selected && !selected.id && currentRecord && control.dirty.current && <div role="alert" className="border border-slate-200 bg-white rounded px-3 py-2 text-xs"><p>작성 중 같은 기간의 저장된 기록이 확인되었습니다. 초안은 유지했으며 중복 저장은 막았습니다.</p><button className="mt-2 rounded border border-slate-300 px-3 py-1.5 font-medium text-slate-700" type="button" onClick={() => { void control.change(() => { const existing = readRef.current.rows.find(r => r.checkDate === checkDate); if (existing) { setSelected(existing); setSaveError(''); } }); }}>저장된 기록 열기</button></div>}
      {/* 날짜 선택 */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">점검일자:</span>
          <input type="date" value={checkDate} onChange={e => { const value = e.target.value; if (value !== checkDate) void control.change(() => setCheckDate(value)); }} className="border border-slate-300 rounded px-2 py-1 text-xs" />
          {currentRecord && <span className="text-xs text-emerald-600 font-bold">✓ 저장된 기록</span>}
          {isReadOnly && <span className="text-xs text-amber-600 font-medium">📋 오늘({todayStr()})만 작성 가능</span>}
        </div>
      </div>

      {/* 이전 기록 */}
      <button onClick={() => setShowHistory(v => !v)} className="flex items-center justify-between px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-50">
        <span>이전 마감 기록 ({pastRecords.length}건)</span>
        <span>{showHistory ? '▲' : '▼'}</span>
      </button>
      {showHistory && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {pastRecords.map(r => (
            <button key={r.id} onClick={() => { void control.change(() => { setCheckDate(r.checkDate); setShowHistory(false); }); }}
              className={`flex flex-col items-start gap-0.5 px-3 py-2 border rounded-lg text-xs font-medium transition-colors ${
                checkDate === r.checkDate ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span className="font-bold">{r.checkDate}</span>
              <span className="text-slate-400">{r.confirmedBy ? `✓ ${r.confirmedBy}` : '미확인'}</span>
              {isAdmin && r.id && (
                <span onClick={e => { e.stopPropagation(); handleDelete(r.id!); }} className="mt-1 text-rose-400 hover:text-rose-600 text-xs cursor-pointer">삭제</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* 폼 */}
      {selected && <div className="flex flex-col gap-3">
        {/* 액션 바 */}
        <div className="sticky top-0 z-20 flex items-center gap-2 flex-wrap bg-slate-50/95 backdrop-blur-sm border-b border-slate-200 py-2 -mx-6 px-6">
          <span className={`text-xs font-bold px-2 py-1 rounded border ${
            isReadOnly ? 'bg-slate-100 text-slate-500 border-slate-300' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
          }`}>
            {isReadOnly ? '📋 조회 (수정 불가)' : `✏️ ${selected.id ? '수정' : '신규'}`}
          </span>
          <span className="text-xs text-slate-500">마감 체크리스트 · {selected.checkDate}</span>
          <div className="ml-auto flex gap-2 flex-wrap justify-end">
            <button onClick={() => printRef.current && downloadAsPDF(printRef.current, `마감체크리스트_${selected.checkDate}.pdf`)}
              className="flex items-center gap-1 px-3 py-2 bg-slate-600 text-white rounded-lg text-xs font-bold hover:bg-slate-700">
              <FileDown size={12} /> PDF
            </button>
            {canConfirm && (
              selected.confirmedBy
                ? <span className="flex items-center gap-1 px-3 py-2 bg-emerald-50 border border-emerald-300 text-emerald-700 rounded-lg text-xs font-bold">
                    <BadgeCheck size={13} /> {selected.confirmedBy} 확인완료
                  </span>
                : <button onClick={handleConfirm} disabled={confirming || !selected.id}
                    className="flex items-center gap-1 px-3 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 disabled:opacity-40">
                    <BadgeCheck size={13} /> {confirming ? '처리 중...' : !selected.id ? '저장 먼저' : '관리자 확인'}
                  </button>
            )}
            {!isReadOnly && (
              <button onClick={handleSave} disabled={saving || !recordsReady || !!recordsError || (!selected.id && !!currentRecord)}
                className="flex items-center gap-1 px-3 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 disabled:opacity-50">
                <Save size={12} /> {saving ? '저장 중...' : '저장'}
              </button>
            )}
          </div>
        </div>

        {saveError && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg px-3 py-2">⚠️ {saveError}</div>}

        {/* 인쇄 영역 */}
        <div ref={printRef} className="bg-white border border-slate-200 rounded-xl p-4 md:p-6" style={{ fontFamily: 'Malgun Gothic, sans-serif' }}>
          <h2 className="text-base md:text-lg font-black text-center mb-4">마감 체크리스트</h2>

          {/* 헤더 정보 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px border border-slate-300 rounded-lg overflow-hidden mb-4 text-xs">
            {[
              { label: '회사명',   value: '태백식품' },
              { label: '문서번호', value: 'HACCP-PRP-003' },
              { label: '작성자',   value: selected.createdBy || (isReadOnly ? '-' : currentUser?.name ?? '-') },
              { label: '개정번호', value: selected.id ? '최신' : '미저장' },
              { label: '점검일자', value: selected.checkDate },
            ].map(f => (
              <div key={f.label} className="bg-white">
                <div className="bg-slate-100 px-2 py-1 font-bold text-slate-600 border-b border-slate-300">{f.label}</div>
                <div className="px-2 py-1.5 text-slate-800">{f.value}</div>
              </div>
            ))}
            <div className="bg-white col-span-3">
              <div className="bg-slate-100 px-2 py-1 font-bold text-slate-600 border-b border-slate-300">점검구역</div>
              <div className="px-1 py-1">
                {isReadOnly
                  ? <div className="px-1 py-0.5 text-slate-800">{selected.checkZone || '-'}</div>
                  : <input value={selected.checkZone ?? ''} onChange={e => editSelected(p => p ? { ...p, checkZone: e.target.value } : p)}
                      placeholder="구역 입력" className="w-full text-xs outline-none bg-transparent" />
                }
              </div>
            </div>
          </div>

          <div className="text-xs font-bold mb-2">■ 마감 점검 항목</div>

          {/* 모바일 카드 */}
          <div className="flex flex-col gap-1.5 md:hidden">
            {templateItems.map((item, idx) => {
              const row = selected.rows[idx] ?? { result: '', note: '', inspector: '' };
              const needNote = row.result === 'fail' && !row.note?.trim();
              return (
                <div key={idx} className={`border rounded-lg text-xs ${
                  row.result === 'pass' ? 'border-emerald-200 bg-emerald-50' :
                  row.result === 'fail' ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-white'
                }`}>
                  <div className="flex items-start gap-2 p-2.5">
                    <span className="text-slate-400 font-bold shrink-0 pt-0.5">{idx + 1}.</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-800 leading-snug">{item.item}</div>
                      <div className="text-slate-400 text-[11px] mt-0.5 leading-snug">{item.standard}</div>
                    </div>
                    {isReadOnly
                      ? <div className="shrink-0">{resultBadge(row.result)}</div>
                      : <div className="flex gap-1 shrink-0">
                          <button onClick={() => toggleResult(idx, 'pass')} className={`w-10 h-9 rounded font-bold border text-sm transition-colors ${
                            row.result === 'pass' ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white text-emerald-600 border-emerald-300'
                          }`}>O</button>
                          <button onClick={() => toggleResult(idx, 'fail')} className={`w-10 h-9 rounded font-bold border text-sm transition-colors ${
                            row.result === 'fail' ? 'bg-rose-500 text-white border-rose-500' : 'bg-white text-rose-600 border-rose-300'
                          }`}>X</button>
                        </div>
                    }
                  </div>
                  {(row.result === 'fail' || (isReadOnly && row.note)) && (
                    <div className="px-2.5 pb-2.5">
                      <div className="border-t border-slate-200 pt-2">
                        {isReadOnly
                          ? <div className="text-slate-700">{row.note || '-'}</div>
                          : <input value={row.note} onChange={e => setRow(idx, 'note', e.target.value)}
                              placeholder="조치 내용 필수 입력"
                              className={`w-full border rounded px-2 py-1.5 text-xs bg-white ${needNote ? 'border-rose-400' : 'border-slate-200'}`} />
                        }
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 데스크탑 테이블 */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full border-collapse text-xs mb-4">
              <thead>
                <tr>
                  <th className={TH} style={{ width: 28 }}>번호</th>
                  <th className={TH}>점검항목</th>
                  <th className={TH} style={{ width: 140 }}>기준</th>
                  <th className={TH} style={{ width: 28 }}>O</th>
                  <th className={TH} style={{ width: 28 }}>X</th>
                  <th className={TH} style={{ width: 70 }}>결과</th>
                  <th className={TH} style={{ width: 80 }}>작성자</th>
                  <th className={TH} style={{ width: 110 }}>비고(개선조치)</th>
                </tr>
              </thead>
              <tbody>
                {templateItems.map((item, idx) => {
                  const row = selected.rows[idx] ?? { result: '', note: '', inspector: '' };
                  return (
                    <tr key={idx} className={row.result === 'fail' ? 'bg-rose-50' : ''}>
                      <td className={TD}>{idx + 1}</td>
                      <td className={TDL}>{item.item}</td>
                      <td className={TD}>{item.standard}</td>
                      <td className={TD}><input type="checkbox" checked={row.result === 'pass'} onChange={() => toggleResult(idx, 'pass')} disabled={isReadOnly} /></td>
                      <td className={TD}><input type="checkbox" checked={row.result === 'fail'} onChange={() => toggleResult(idx, 'fail')} disabled={isReadOnly} /></td>
                      <td className={TD}>{resultBadge(row.result)}</td>
                      <td className={TD}>
                        {row.inspector
                          ? <span className="inline-flex px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-xs font-medium">{row.inspector}</span>
                          : <span className="text-slate-300 text-xs">-</span>
                        }
                      </td>
                      <td className={TDL}>
                        <input value={row.note} onChange={e => setRow(idx, 'note', e.target.value)} disabled={isReadOnly}
                          className="w-full text-xs border-none outline-none bg-transparent disabled:opacity-60"
                          placeholder={row.result === 'fail' ? '조치 내용 필수' : ''} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mb-4">
            <div className="text-xs font-bold text-slate-700 mb-1">특이사항</div>
            <textarea value={selected.specialNotes}
              onChange={e => !isReadOnly && editSelected(prev => prev ? { ...prev, specialNotes: e.target.value } : prev)}
              disabled={isReadOnly} rows={2}
              className="w-full border border-slate-300 rounded px-2 py-1 text-xs disabled:opacity-60 resize-none"
              placeholder="특이사항을 입력하세요" />
          </div>

          {/* 서명란 */}
          <div className="flex gap-2 mt-3 justify-end">
            <div className="border border-slate-400 text-center w-24">
              <div className="bg-slate-100 text-xs font-bold py-0.5 border-b border-slate-400">작성자</div>
              <div className="h-8 flex items-center justify-center text-xs text-slate-700">
                {selected.createdBy || (isReadOnly ? '-' : currentUser?.name ?? '')}
              </div>
            </div>
            <div className="border border-slate-400 text-center w-24">
              <div className="bg-slate-100 text-xs font-bold py-0.5 border-b border-slate-400">관리자</div>
              <div className="h-8 flex items-center justify-center text-xs text-slate-700">
                {selected.confirmedBy
                  ? <span className="text-emerald-700 font-bold">{selected.confirmedBy}</span>
                  : <span className="text-slate-300">-</span>
                }
              </div>
            </div>
          </div>
        </div>
      </div>}
    </fieldset>
  );
};
