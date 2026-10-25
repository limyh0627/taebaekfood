import {useHaccpRecordEditor, type HaccpRecordOwner} from '../hooks/useHaccpRecordEditor';
import { useOutputScope } from '../../../shared/hooks/useOutputScope';
import React, { useEffect, useRef, useState } from 'react';
import { FileDown, BadgeCheck, Save, Plus, Trash2, User } from 'lucide-react';
import { TH, TD, TDL } from './ChecklistFormParts';
import { useHaccpCompany } from '../context/HaccpCompanyContext';
import { downloadAsPDF } from '../infrastructure/downloadAsPDF';
import { db } from '../../../shared/firebase';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { addItem, updateItem, deleteItem } from '../../../shared/services/firebaseService';
import { PERSONAL_HYGIENE_COLS } from '../domain/personalHygieneColumns';
import { todayStr } from '../domain/haccpDate';
import { haccpTemplateDocId } from '../../../shared/haccpTemplateId';
import { appConfirm } from '../../../shared/components/appDialog';

interface PersonalHygieneRow {
  name: string;
  checks: Record<string, 'O' | 'X' | ''>;
  note: string;
}

interface PersonalHygieneRecord {
  id?: string;
  checkDate: string;
  rows: PersonalHygieneRow[];
  inspector: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  revisionCount: number;
  confirmedBy?: string;
  confirmedAt?: string;
}

const emptyPersonalRecord = (cols: string[] = PERSONAL_HYGIENE_COLS): Omit<PersonalHygieneRecord, 'id'> => ({
  checkDate: todayStr(),
  rows: Array.from({ length: 8 }, () => ({
    name: '',
    checks: Object.fromEntries(cols.map(k => [k, ''])) as Record<string, 'O' | 'X' | ''>,
    note: '',
  })),
  inspector: '',
  createdBy: '',
  createdAt: '',
  updatedBy: '',
  updatedAt: '',
  revisionCount: -1,
});

export const PersonalHygieneForm: React.FC<{ currentUser?: { id: string; name: string }; isAdmin?: boolean; canConfirm?: boolean }> = ({ currentUser, isAdmin, canConfirm }) => {
  const companyId = useHaccpCompany();
  const editor = useHaccpRecordEditor<PersonalHygieneRecord>({companyId, currentUserId: currentUser?.id, isAdmin, canConfirm, getKey: record => record.checkDate, getRevision: record => record.revisionCount ?? -1,
    mergeConfirmed: (base, result) => ({...base, confirmedBy: result.confirmedBy, confirmedAt: result.confirmedAt})});
  const {selected, edit: setSelected, busy} = editor;
  const [recordView, setRecordView] = useState<{owner: HaccpRecordOwner; rows: PersonalHygieneRecord[]} | null>(null);
  const records = recordView?.owner === editor.ownerToken ? recordView.rows.filter(row => !editor.isDeleted(row.id ?? '')) : [];
  const [templateView, setTemplateView] = useState<{owner: HaccpRecordOwner; cols: string[]} | null>(null);
  const outputSignal = useOutputScope(companyId, `${selected?.id ?? "new"}:${selected?.checkDate ?? ""}`);
  const saving = busy, confirming = busy;
  const [showHistory, setShowHistory] = useState(false);
  const templateCols = templateView?.owner === editor.ownerToken ? templateView.cols : PERSONAL_HYGIENE_COLS;
  const printRef = useRef<HTMLDivElement>(null);
  const today = todayStr();

  useEffect(() => {
    const token = editor.ownerToken;
    let active = true;
    const current = () => active && editor.isCurrent(token);
    const q = query(collection(db, 'haccp_personal_hygiene'), where('companyId', '==', companyId));
    const stop = onSnapshot(q, {includeMetadataChanges: true}, snap => {
      if (!current()) return;
      setRecordView({owner: token, rows: snap.docs.map(d => ({id: d.id, ...d.data()} as PersonalHygieneRecord)).filter(row => typeof row.checkDate === 'string').sort((a, b) => b.checkDate.localeCompare(a.checkDate))});
      editor.observeRecords(snap.docs.map(d => ({id: d.id, ...d.data()} as PersonalHygieneRecord)).filter(row => typeof row.checkDate === 'string'), snap.metadata?.fromCache === false);
    }, () => { if (current()) { active = false; editor.readFailure('records'); } });
    return () => { active = false; stop(); };
  }, [companyId, editor.ownerToken, editor.readRevision]);

  useEffect(() => {
    const token = editor.ownerToken;
    let active = true;
    const current = () => active && editor.isCurrent(token);
    const stop = onSnapshot(doc(db, 'haccp_templates', haccpTemplateDocId(companyId, 'personal_hygiene')), {includeMetadataChanges: true}, snap => {
      if (!current()) return;
      const data = snap.exists() ? snap.data().cols : undefined;
      setTemplateView({owner: token, cols: Array.isArray(data) && data.length > 0 ? data : PERSONAL_HYGIENE_COLS});
      if (snap.metadata?.fromCache === false) editor.readSuccess('template'); else editor.readPending('template');
    }, () => { if (current()) { active = false; editor.readFailure('template'); } });
    return () => { active = false; stop(); };
  }, [companyId, editor.ownerToken, editor.readRevision]);

  const todayRecord = editor.knownRecord(today) ?? records.find(r => r.checkDate === today);

  const openToday = () => {
    if (!editor.canEdit()) return;
    const record = editor.resolveRecord(todayRecord ?? { ...emptyPersonalRecord(templateCols) } as PersonalHygieneRecord);
    editor.select(record, resolved => {
      if (!isAdmin && currentUser?.name) {
        const byName = resolved.rows.findIndex(r => r.name === currentUser.name);
        const targetIdx = byName >= 0 ? byName : resolved.rows.findIndex(r => !r.name.trim());
        if (targetIdx >= 0 && resolved.rows[targetIdx].name !== currentUser.name) {
          return { ...resolved, rows: resolved.rows.map((r, i) => i === targetIdx ? { ...r, name: currentUser.name } : r) };
        }
      }
      return resolved;
    });
  };

  const openHistory = (r: PersonalHygieneRecord) => { editor.select(r); setShowHistory(false); };
  const isReadOnly = selected ? selected.checkDate !== today : false;
  const filledRows = selected?.rows.filter(r => r.name.trim()) ?? [];
  const allChecked = filledRows.length > 0 && filledRows.every(r => templateCols.every(col => r.checks[col] !== ''));

  // 비관리자: 본인 행 인덱스 (이름 일치 → 없으면 첫 빈 행)
  const myRowIdx: number = (!isAdmin && selected && currentUser?.name)
    ? (() => {
        const byName = selected.rows.findIndex(r => r.name === currentUser.name);
        return byName >= 0 ? byName : selected.rows.findIndex(r => !r.name.trim());
      })()
    : -1;

  const canEditRow = (rowIdx: number) => isAdmin || rowIdx === myRowIdx;

  const toggleCheck = (rowIdx: number, col: string, val: 'O' | 'X') => {
    if (isReadOnly || !canEditRow(rowIdx)) return;
    setSelected(prev => {
      if (!prev) return prev;
      const newVal = prev.rows[rowIdx].checks[col] === val ? '' : val;
      return { ...prev, rows: prev.rows.map((r, i) => i === rowIdx ? { ...r, checks: { ...r.checks, [col]: newVal } } : r) };
    });
  };

  const setRowField = (rowIdx: number, field: 'name' | 'note', val: string) => {
    if (isReadOnly || !canEditRow(rowIdx)) return;
    if (!isAdmin && field === 'name') return; // 비관리자는 이름 변경 불가
    setSelected(prev => prev ? { ...prev, rows: prev.rows.map((r, i) => i === rowIdx ? { ...r, [field]: val } : r) } : prev);
  };

  const addRow = () => setSelected(prev => prev ? {
    ...prev,
    rows: [...prev.rows, { name: '', checks: Object.fromEntries(templateCols.map(k => [k, ''])) as Record<string, 'O' | 'X' | ''>, note: '' }],
  } : prev);

  const revLabel = (r: PersonalHygieneRecord) => r.revisionCount < 0 ? '미저장' : `Rev.${r.revisionCount}`;

  const latest = useRef({selected, records, canConfirm, isAdmin, allChecked});
  latest.current = {selected, records, canConfirm, isAdmin, allChecked};
  const handleSave = async () => {
    if (!selected || isReadOnly) return;
    const snapshot = selected;
    return editor.run('save', snapshot.id,
      () => latest.current.selected === snapshot && snapshot.checkDate === todayStr() && (!isAdmin || !!latest.current.isAdmin), async isCurrent => {
        const now = new Date().toISOString();
        const userName = currentUser?.name ?? '알 수 없음';
        if (!isCurrent()) return;
        if (!snapshot.id) {
          const data: Omit<PersonalHygieneRecord, 'id'> = { ...snapshot, inspector: snapshot.inspector || userName, createdBy: userName, createdAt: now, updatedBy: userName, updatedAt: now, revisionCount: 0 };
          const id = await addItem('haccp_personal_hygiene', data);
          return {...data, id};
        }
        const update = { ...snapshot, updatedBy: userName, updatedAt: now, revisionCount: (snapshot.revisionCount ?? 0) + 1 };
        await updateItem('haccp_personal_hygiene', snapshot.id, update);
        return update;
      });
  };
  const handleConfirm = async () => {
    if (!canConfirm || !selected?.id || !editor.canEdit()) return;
    if (!allChecked) { alert('성명이 입력된 모든 작업자의 항목을 완료 후 확인할 수 있습니다.'); return; }
    const snapshot = selected;
    return editor.run('confirm', snapshot.id,
      () => !!latest.current.canConfirm && latest.current.selected === snapshot && latest.current.allChecked, async isCurrent => {
        const now = new Date().toISOString();
        const userName = currentUser?.name ?? '관리자';
        const update = {confirmedBy: userName, confirmedAt: now};
        if (!isCurrent()) return;
        await updateItem('haccp_personal_hygiene', snapshot.id!, update);
        return {...snapshot, ...update};
      });
  };
  const handleDelete = async (id: string) => {
    const target = records.find(record => record.id === id);
    if (!target) return;
    return editor.run('delete', id, () => !!latest.current.isAdmin && latest.current.records.some(record =>
      record.id === id && record.checkDate === target.checkDate && record.revisionCount === target.revisionCount), async isCurrent => {
      if (!await appConfirm('이 점검표를 삭제하시겠습니까?')) return;
      if (!isCurrent()) return;
      await deleteItem('haccp_personal_hygiene', id);
      return {deletedId: id, selected: latest.current.selected?.id === id ? null : undefined};
    });
  };

  const pastRecords = records.filter(r => r.checkDate !== today);

  return (
    <fieldset disabled={busy} className="min-w-0 flex flex-col gap-4">
      {editor.readError && <div role="alert">{editor.readError} <button onClick={editor.retryRead}>다시 조회</button></div>}
      {!editor.readReady && !editor.readError && <p role="status">기록과 점검 항목을 확인 중입니다. <button type="button" disabled={busy} onClick={editor.retryRead}>다시 조회</button></p>}
      {editor.hasServerRecord && editor.error && <button type="button" onClick={editor.openServerRecord}>조회된 기록 열기</button>}
      {editor.error && <p role="alert" className="text-sm text-rose-600">{editor.error} <button type="button" disabled={busy} onClick={editor.retryRead}>다시 조회</button></p>}
      {/* 오늘 점검 버튼 */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="text-xs text-slate-500 mb-3">
          오늘 점검일 <span className="font-bold text-slate-800 ml-1">{today}</span>
          <span className="ml-2 text-slate-400">· 1일 1회</span>
        </div>
        <button disabled={busy || !editor.readReady} onClick={openToday} className={`w-full flex flex-col items-center justify-center gap-1 py-4 rounded-xl border-2 text-sm font-bold transition-all ${
          selected?.checkDate === today ? 'border-blue-500 bg-blue-50 text-blue-700'
          : todayRecord ? 'border-blue-200 bg-blue-50/50 text-blue-600 hover:border-blue-400'
          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'
        }`}>
          <span className="text-base">🧑‍⚕️</span>
          <span>오늘 개인위생 점검</span>
          {!editor.readReady
            ? <span className="text-xs font-normal text-slate-500">조회 필요</span>
            : todayRecord
            ? <span className="text-xs font-normal text-blue-500">✓ {revLabel(todayRecord)} 저장됨</span>
            : <span className="text-xs font-normal text-slate-400">미작성</span>}
        </button>
      </div>

      {/* 이전 기록 */}
      <button onClick={() => setShowHistory(v => !v)} className="flex items-center justify-between px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-50">
        <span>이전 점검 기록 ({pastRecords.length}건)</span>
        <span>{showHistory ? '▲' : '▼'}</span>
      </button>
      {showHistory && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {editor.readReady && pastRecords.length === 0 && <p className="col-span-full text-xs text-slate-400 py-4 text-center">이전 기록이 없습니다</p>}
          {pastRecords.map(r => (
            <div key={r.id} onClick={() => openHistory(r)} className={`p-3 rounded-lg border cursor-pointer text-xs transition-colors ${selected?.id === r.id ? 'bg-slate-100 border-slate-400' : 'bg-white border-slate-200 hover:border-slate-400'}`}>
              <div className="font-bold text-slate-700">{r.checkDate}</div>
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-slate-500">{revLabel(r)}</span>
              {isAdmin && <button onClick={e => { e.stopPropagation(); r.id && handleDelete(r.id); }} className="text-rose-400 hover:text-rose-600"><Trash2 size={11} /></button>}
              </div>
              {r.inspector && <div className="text-slate-400 mt-1 truncate">점검자: {r.inspector}</div>}
            </div>
          ))}
        </div>
      )}

      {!selected && (
        <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-2">
          <User size={28} className="text-slate-300" />
          <p className="text-sm">위에서 오늘 점검을 시작해주세요</p>
        </div>
      )}

      {selected && (
        <div className="flex flex-col gap-3">
          {/* 액션 바 */}
          <div className="sticky top-0 z-20 flex items-center gap-2 flex-wrap bg-slate-50/95 backdrop-blur-sm border-b border-slate-200 py-2 -mx-6 px-6">
            <span className={`text-xs font-bold px-2 py-1 rounded border ${isReadOnly ? 'bg-slate-100 text-slate-500 border-slate-300' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>
              {isReadOnly ? '📋 조회 (수정 불가)' : `✏️ ${revLabel(selected)}`}
            </span>
            <span className="text-xs text-slate-500">{selected.checkDate}</span>
            <div className="ml-auto flex gap-2 flex-wrap justify-end">
              <button onClick={() => printRef.current && downloadAsPDF(printRef.current, `개인위생점검표_${selected.checkDate}.pdf`, outputSignal())} className="flex items-center gap-1 px-3 py-2 bg-slate-600 text-white rounded-lg text-xs font-bold hover:bg-slate-700">
                <FileDown size={12} /> PDF
              </button>
              {canConfirm && (
                selected.confirmedBy
                  ? <span className="flex items-center gap-1 px-3 py-2 bg-emerald-50 border border-emerald-300 text-emerald-700 rounded-lg text-xs font-bold"><BadgeCheck size={13} /> {selected.confirmedBy} 확인완료</span>
                  : <button onClick={handleConfirm} disabled={confirming || !selected.id || !allChecked}
                      title={!selected.id ? '저장 후 확인' : !allChecked ? '모든 항목 완료 후 확인 가능' : ''}
                      className="flex items-center gap-1 px-3 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed">
                      <BadgeCheck size={13} /> {confirming ? '처리 중...' : !selected.id ? '저장 먼저' : !allChecked ? '항목 미완료' : '관리자 확인'}
                    </button>
              )}
              {!isReadOnly && (
                <button onClick={handleSave} disabled={saving || !editor.readReady} className="flex items-center gap-1 px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 disabled:opacity-50">
                  <Save size={12} /> {saving ? '저장 중...' : '저장'}
                </button>
              )}
            </div>
          </div>

          {/* 인쇄 영역 */}
          <div ref={printRef} className="bg-white border border-slate-200 rounded-xl p-4 md:p-6" style={{ fontFamily: 'Malgun Gothic, sans-serif' }}>
            <h2 className="text-base md:text-lg font-black text-center mb-4">개인위생점검표</h2>
            <div className="mb-4 text-xs text-slate-600">
              점검일자 : <strong>{selected.checkDate.replace('-', '년 ').replace('-', '월 ')}일</strong>
            </div>

            {/* 모바일 카드 */}
            <div className="flex flex-col gap-2 md:hidden">
              {selected.rows.map((row, rowIdx) => {
                const isMyRow = rowIdx === myRowIdx;
                const rowEditable = !isReadOnly && canEditRow(rowIdx);
                return (
                  <div key={rowIdx} className={`border rounded-xl p-3 ${isMyRow ? 'border-blue-300 bg-blue-50 ring-2 ring-blue-100' : 'border-slate-200 bg-white'}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-slate-400 font-bold w-5 shrink-0">{rowIdx + 1}</span>
                      {isMyRow && !isReadOnly
                        ? <span className="flex-1 text-sm font-bold text-blue-700 px-2 py-1.5 bg-blue-100 rounded-lg">{row.name} <span className="text-[10px] font-normal text-blue-400 ml-1">(나)</span></span>
                        : isReadOnly || !isAdmin
                          ? <span className="text-sm font-bold text-slate-800">{row.name || '-'}</span>
                          : <input disabled={busy || !editor.readReady} value={row.name} onChange={e => setRowField(rowIdx, 'name', e.target.value)} placeholder="성명" className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-bold focus:outline-none focus:ring-1 focus:ring-blue-400" />
                      }
                    </div>
                    <div className="grid grid-cols-4 gap-1.5 mb-2">
                      {templateCols.map(col => (
                        <div key={col} className="flex flex-col items-center gap-1">
                          <span className="text-[9px] text-slate-500 font-bold leading-tight text-center">{col}</span>
                          <div className="flex gap-0.5">
                            {(['O', 'X'] as const).map(val => (
                              <button key={val} onClick={() => toggleCheck(rowIdx, col, val)} disabled={busy || !rowEditable}
                                className={`w-6 h-6 rounded text-[10px] font-black border transition-colors ${row.checks[col] === val ? (val === 'O' ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-rose-500 text-white border-rose-500') : rowEditable ? 'bg-white text-slate-400 border-slate-200 hover:border-slate-400' : 'bg-slate-50 text-slate-200 border-slate-100 cursor-not-allowed'}`}>
                                {val}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    {!rowEditable
                      ? <span className="text-xs text-slate-600">{row.note}</span>
                      : <input disabled={busy || !editor.readReady} value={row.note} onChange={e => setRowField(rowIdx, 'note', e.target.value)} placeholder="비고" className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none" />}
                  </div>
                );
              })}
              {!isReadOnly && isAdmin && (
                <button onClick={addRow} className="flex items-center justify-center gap-1 py-2.5 border-2 border-dashed border-slate-300 rounded-xl text-xs text-slate-400 hover:border-blue-400 hover:text-blue-500 transition-colors">
                  <Plus size={13} /> 행 추가
                </button>
              )}
              {!isReadOnly && !isAdmin && myRowIdx < 0 && (
                <div className="text-center text-xs text-rose-500 py-3 bg-rose-50 rounded-xl border border-rose-200">
                  빈 행이 없습니다. 관리자에게 문의해주세요.
                </div>
              )}
            </div>

            {/* 데스크탑 테이블 */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full border-collapse text-xs mb-3">
                <thead>
                  <tr>
                    <th className={TH} style={{ width: 28 }}>No</th>
                    <th className={TH} style={{ width: 72 }}>성명</th>
                    {templateCols.map(col => <th key={col} className={TH} style={{ width: 52 }}>{col}</th>)}
                    <th className={TH}>비고</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.rows.map((row, rowIdx) => {
                    const isMyRow = rowIdx === myRowIdx;
                    const rowEditable = !isReadOnly && canEditRow(rowIdx);
                    return (
                    <tr key={rowIdx} className={
                      isMyRow && !isReadOnly ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' :
                      Object.values(row.checks).some(v => v === 'X') ? 'bg-rose-50' : ''
                    }>
                      <td className={TD}>{rowIdx + 1}</td>
                      <td className={TD}>
                        {isMyRow && !isReadOnly
                          ? <span className="font-bold text-blue-700">{row.name}<span className="text-[9px] text-blue-400 ml-1">(나)</span></span>
                          : isReadOnly || !isAdmin
                            ? row.name
                            : <input disabled={busy || !editor.readReady} value={row.name} onChange={e => setRowField(rowIdx, 'name', e.target.value)} placeholder="성명" className="w-full text-xs border-none outline-none bg-transparent text-center" />
                        }
                      </td>
                      {templateCols.map(col => (
                        <td key={col} className={TD}>
                          {!rowEditable
                            ? <span className={row.checks[col] === 'O' ? 'text-emerald-600 font-black' : row.checks[col] === 'X' ? 'text-rose-600 font-black' : 'text-slate-300'}>{row.checks[col] || '-'}</span>
                            : <div className="flex gap-0.5 justify-center">
                                {(['O', 'X'] as const).map(val => (
                                  <button key={val} onClick={() => toggleCheck(rowIdx, col, val)}
                                    className={`w-6 h-6 rounded text-[10px] font-black border transition-colors ${row.checks[col] === val ? (val === 'O' ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-rose-500 text-white border-rose-500') : 'bg-white text-slate-400 border-slate-200 hover:border-slate-400'}`}>
                                    {val}
                                  </button>
                                ))}
                              </div>
                          }
                        </td>
                      ))}
                      <td className={TDL}>
                        {!rowEditable ? row.note
                          : <input disabled={busy || !editor.readReady} value={row.note} onChange={e => setRowField(rowIdx, 'note', e.target.value)} placeholder="비고" className="w-full text-xs border-none outline-none bg-transparent" />}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
              {!isReadOnly && isAdmin && (
                <button onClick={addRow} className="flex items-center gap-1 px-3 py-1.5 border border-dashed border-slate-300 rounded-lg text-xs text-slate-400 hover:border-blue-400 hover:text-blue-500 transition-colors">
                  <Plus size={12} /> 행 추가
                </button>
              )}
            </div>

            <div className="mt-3 text-xs font-bold text-slate-700">※이상 발생 시 즉시 작업 배제 및 보고</div>

            {/* 서명란 */}
            <div className="grid grid-cols-2 gap-3 mt-4 md:flex md:justify-end md:gap-4 text-xs">
              <div className="border border-slate-400 text-center md:w-28">
                <div className="bg-slate-100 text-xs font-bold py-1 border-b border-slate-400">점검자</div>
                <div className="h-10 flex items-center justify-center">
                  {isReadOnly
                    ? <span className="text-slate-700 font-semibold">{selected.inspector || '-'}</span>
                    : <input disabled={busy || !editor.readReady} value={selected.inspector} onChange={e => setSelected(prev => prev ? { ...prev, inspector: e.target.value } : prev)} placeholder={currentUser?.name ?? '이름'} className="w-full text-xs text-center border-none outline-none bg-transparent font-semibold" />}
                </div>
              </div>
              <div className="border border-slate-400 text-center md:w-28">
                <div className="bg-slate-100 text-xs font-bold py-1 border-b border-slate-400">확인자</div>
                <div className="h-10 flex items-center justify-center">
                  {selected.confirmedBy
                    ? <span className="text-slate-700 font-semibold">{selected.confirmedBy}</span>
                    : canConfirm && selected.id && allChecked
                      ? <button onClick={handleConfirm} disabled={confirming} className="flex items-center gap-1 px-2 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 disabled:opacity-40">
                          <BadgeCheck size={11} /> {confirming ? '처리 중...' : '확인'}
                        </button>
                      : canConfirm && !selected.id ? <span className="text-slate-300 text-[10px]">저장 후 확인</span>
                      : canConfirm ? <span className="text-slate-300 text-[10px]">항목 완료 후</span>
                      : <span className="text-slate-200 text-xs">-</span>}
                </div>
              </div>
            </div>

            {selected.id && (
              <div className="mt-3 text-xs text-slate-400 text-right">
                최초 작성: {selected.createdBy} ({selected.createdAt?.slice(0, 16).replace('T', ' ')})
              </div>
            )}
          </div>
        </div>
      )}
    </fieldset>
  );
};
