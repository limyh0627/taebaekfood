import { useOutputScope } from '../../../shared/hooks/useOutputScope';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FileDown, BadgeCheck, Save } from 'lucide-react';
import { TH, TD, TDL } from './ChecklistFormParts';
import { useHaccpCompany } from '../context/HaccpCompanyContext';
import { createHaccpRecordAcknowledgements } from '../domain/haccpRecordAcknowledgements';
import { useHaccpRecordActor } from '../hooks/useHaccpRecordActor';
import { useChecklistDraftControl } from '../hooks/useChecklistDraftControl';
import { downloadAsPDF } from '../infrastructure/downloadAsPDF';
import { db } from '../../../shared/firebase';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { addItem, updateItem, deleteItem } from '../../../shared/services/firebaseService';
import { appConfirm } from '../../../shared/components/appDialog';
import { haccpTemplateDocId } from '../../../shared/haccpTemplateId';
import { WEEKLY_ITEMS_DEFAULT, MONTHLY_ITEMS_DEFAULT, type PeriodCycle, type PeriodRecord, type PeriodRow } from '../domain/periodicSanitation';

const currentWeekStr = () => {
  const now = new Date();
  const year = now.getFullYear();
  const start = new Date(year, 0, 1);
  const weekNum = Math.ceil(((now.getTime() - start.getTime()) / 86400000 + start.getDay() + 1) / 7);
  return `${year}-W${String(weekNum).padStart(2, '0')}`;
};

const emptyPeriodRecord = (cycle: PeriodCycle, period: string, items: { item: string; standard: string }[]): Omit<PeriodRecord, 'id'> => ({
  cycle, period,
  checkZone: '',
  rows: items.map(() => ({ result: '', note: '', inspector: '' })),
  specialNotes: '',
  createdBy: '', createdAt: '', updatedBy: '', updatedAt: '',
});

const periodKey = (record: Pick<PeriodRecord, 'cycle' | 'period'>) => JSON.stringify([record.cycle, record.period]);
const savedBody = (record: PeriodRecord) => JSON.stringify([record.cycle, record.period, record.checkZone, record.rows.map(row => [row.result, row.note, row.inspector]), record.specialNotes, record.createdBy, record.createdAt, record.updatedBy, record.updatedAt]);

export const PeriodicSanitationForm: React.FC<{ currentUser?: { id: string; name: string }; isAdmin?: boolean; canConfirm?: boolean }> = ({ currentUser, isAdmin, canConfirm }) => {
  const companyId = useHaccpCompany();
  const actor = useHaccpRecordActor({ companyId, currentUserId: currentUser?.id, isAdmin, canConfirm });
  const ownerToken = actor.ownerToken;
  const [cycle, setCycle] = useState<PeriodCycle>('weekly');
  const [weekPeriod, setWeekPeriod] = useState(currentWeekStr());
  const [monthPeriod, setMonthPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [weekItems, setWeekItems] = useState<{ item: string; standard: string }[]>(WEEKLY_ITEMS_DEFAULT);
  const [monthItems, setMonthItems] = useState<{ item: string; standard: string }[]>(MONTHLY_ITEMS_DEFAULT);
  const [records, setRecords] = useState<PeriodRecord[]>([]);
  const [selected, setSelected] = useState<PeriodRecord | null>(null);
  const outputSignal = useOutputScope(companyId, `${cycle}:${weekPeriod}:${monthPeriod}:${selected?.id ?? "new"}`);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [saveError, setSaveError] = useState('');
  const printRef = useRef<HTMLDivElement>(null);
  const control = useChecklistDraftControl();
  const [recordsReady, setRecordsReady] = useState(false), [recordsError, setRecordsError] = useState('');
  const [readAttempt, setReadAttempt] = useState(0);
  const readRef = useRef({ ready: false, blocked: false, rows: [] as PeriodRecord[] });

  const [acknowledgements] = useState(() => createHaccpRecordAcknowledgements<PeriodRecord>({getKey: periodKey, strategy: {kind: 'echo', sameSavedBody: (server, ack) => savedBody(server) === savedBody(ack)}, mergeConfirmed: (base, result) => ({...base, confirmedBy: result.confirmedBy, confirmedAt: result.confirmedAt})}));
  const templateRead = useRef({"weekly":false,"monthly":false});
  const [templateReady, setTemplateReady] = useState({"weekly":false,"monthly":false});
  const [templateErrors, setTemplateErrors] = useState({"weekly":"","monthly":""});
  const [templateAttempt, setTemplateAttempt] = useState({"weekly":0,"monthly":0});
  useLayoutEffect(() => {
    // 계정이 교체되면 이전 finally와 조회가 새 초안의 잠금을 건드릴 수 없다.
    control.generation.current++; control.busy.current = false; control.dirty.current = false;
    acknowledgements.resetOwner();
    readRef.current = { ready: false, blocked: false, rows: [] }; setRecords([]); setRecordsReady(false); setRecordsError('');
    templateRead.current = {"weekly":false,"monthly":false}; setTemplateReady({"weekly":false,"monthly":false}); setTemplateErrors({"weekly":"","monthly":""});
    setWeekItems(WEEKLY_ITEMS_DEFAULT); setMonthItems(MONTHLY_ITEMS_DEFAULT);
    setSaving(false); setConfirming(false); setDeleting(false); setShowHistory(false); setSaveError('');
  }, [ownerToken]);
  const changeSelection = (action: () => void) => control.change(() => {
    if (actor.isCurrent(ownerToken)) { action(); }
  });
  const canSend = (kind: 'save' | 'confirm' | 'delete', id?: string) => {
    if (!actor.canAct(kind, ownerToken) || !readRef.current.ready || (kind !== 'delete' && !templateRead.current[cycle])) return false;
    const issue = acknowledgements.targetIssue(kind, id, selected ? periodKey(selected) : '');
    if (issue) {
      const messages = {'body-mismatch': '마지막 저장 내용과 조회된 내용이 다릅니다. 입력은 보존했습니다. 다시 조회하거나 저장된 기록을 열어 확인해 주세요.', 'duplicate-key': '같은 점검 기록이 여러 개입니다. 입력은 보존했습니다. 관리자 확인 후 기존 이력에서 중복 기록을 정리하고 다시 조회해 주세요.', 'existing-key': '같은 기간에 저장된 기록이 있습니다. 입력은 보존했습니다. 저장된 기록을 열어 확인해 주세요.', 'missing-record': '현재 목록에서 선택 기록을 확인하지 못했습니다. 입력은 보존했습니다. 다른 기간이나 기록을 선택하거나 다시 조회해 주세요.'};
      setSaveError(messages[issue]);
      return false;
    }
    return true;
  };


  const period = cycle === 'weekly' ? weekPeriod : monthPeriod;
  const items = cycle === 'weekly' ? weekItems : monthItems;
  const cycleName = cycle === 'weekly' ? '주간' : '월간';

  useEffect(() => {
    let active = true;
    readRef.current.ready = false; readRef.current.blocked = false; setRecordsReady(false); setRecordsError('');
    const q = query(collection(db, 'haccp_periodic_sanitation'), where('companyId', '==', companyId));
    const unsubscribe = onSnapshot(q, { includeMetadataChanges: true }, snap => {
      if (!active || !control.active.current || !actor.isCurrent(ownerToken)) return;
      const rows = snap.docs.map(d => ({ ...d.data(), id: d.id } as PeriodRecord)).filter(row => typeof row.period === 'string').sort((a, b) => b.period.localeCompare(a.period));
      const serverConfirmed = snap.metadata?.fromCache === false;
      const ready = serverConfirmed && !readRef.current.blocked;
      acknowledgements.observe(rows, ready);
      readRef.current = { ready, blocked: readRef.current.blocked, rows: acknowledgements.visibleRecords() }; setRecords(acknowledgements.visibleRecords()); setRecordsReady(ready); if (ready) setRecordsError('');
    }, () => {
      if (!active || !control.active.current || !actor.isCurrent(ownerToken)) return;
      active = false; readRef.current.ready = false; readRef.current.blocked = true; setRecordsReady(false);
      setRecordsError('기존 기록을 확인하지 못했습니다. 입력은 보존했습니다. 다시 조회한 뒤 저장해 주세요.');
    });
    return () => { active = false; unsubscribe(); };
  }, [companyId, ownerToken, readAttempt]);

  useEffect(() => {
    let active = true;
    templateRead.current.weekly = false; setTemplateReady(value => ({ ...value, weekly: false })); setTemplateErrors(value => ({ ...value, weekly: '' }));
    const unsubscribe = onSnapshot(doc(db, 'haccp_templates', haccpTemplateDocId(companyId, 'weekly_sanitation')), { includeMetadataChanges: true }, snap => {
      if (!active || !actor.isCurrent(ownerToken)) return;
      const serverConfirmed = snap.metadata?.fromCache === false;
      if (snap.exists()) {
        const data = snap.data().items;
        if (Array.isArray(data) && data.length > 0) setWeekItems(data);
      }
      templateRead.current.weekly = serverConfirmed; setTemplateReady(value => ({ ...value, weekly: serverConfirmed }));
    }, () => {
      if (!active || !actor.isCurrent(ownerToken)) return;
      active = false; templateRead.current.weekly = false; setTemplateReady(value => ({ ...value, weekly: false }));
      setTemplateErrors(value => ({ ...value, weekly: '점검 양식을 확인하지 못했습니다. 입력을 유지했습니다. 양식을 다시 조회해 주세요.' }));
    });
    return () => { active = false; unsubscribe(); };
  }, [companyId, ownerToken, templateAttempt.weekly]);

  useEffect(() => {
    let active = true;
    templateRead.current.monthly = false; setTemplateReady(value => ({ ...value, monthly: false })); setTemplateErrors(value => ({ ...value, monthly: '' }));
    const unsubscribe = onSnapshot(doc(db, 'haccp_templates', haccpTemplateDocId(companyId, 'monthly_sanitation')), { includeMetadataChanges: true }, snap => {
      if (!active || !actor.isCurrent(ownerToken)) return;
      const serverConfirmed = snap.metadata?.fromCache === false;
      if (snap.exists()) {
        const data = snap.data().items;
        if (Array.isArray(data) && data.length > 0) setMonthItems(data);
      }
      templateRead.current.monthly = serverConfirmed; setTemplateReady(value => ({ ...value, monthly: serverConfirmed }));
    }, () => {
      if (!active || !actor.isCurrent(ownerToken)) return;
      active = false; templateRead.current.monthly = false; setTemplateReady(value => ({ ...value, monthly: false }));
      setTemplateErrors(value => ({ ...value, monthly: '점검 양식을 확인하지 못했습니다. 입력을 유지했습니다. 양식을 다시 조회해 주세요.' }));
    });
    return () => { active = false; unsubscribe(); };
  }, [companyId, ownerToken, templateAttempt.monthly]);

  const currentRecord = acknowledgements.known(periodKey({cycle, period}), recordsReady) ?? records.find(r => r.cycle === cycle && r.period === period);

  useLayoutEffect(() => {
    control.generation.current++; control.dirty.current = false;
    const existing = readRef.current.ready ? readRef.current.rows.find(r => r.cycle === cycle && r.period === period) : undefined;
    setSelected(acknowledgements.select(existing ?? ({ ...emptyPeriodRecord(cycle, period, items) } as PeriodRecord), readRef.current.ready)); setSaveError('');
  }, [cycle, period, ownerToken]);
  useEffect(() => {
    const existing = acknowledgements.known(periodKey({cycle, period}), readRef.current.ready) ?? records.find(r => r.cycle === cycle && r.period === period);
    if (readRef.current.ready && existing && !selected?.id && !control.dirty.current && !control.busy.current) setSelected(acknowledgements.resolve(existing, true));
  }, [records, recordsReady, cycle, period, selected?.id]);

  const openHistory = (r: PeriodRecord) => { void changeSelection(() => {
    setCycle(r.cycle); if (r.cycle === 'weekly') setWeekPeriod(r.period); else setMonthPeriod(r.period);
    if (r.cycle === cycle && r.period === period) setSelected(acknowledgements.select(r, readRef.current.ready)); setSaveError(''); setShowHistory(false);
  }); };

  // 실제 이번 주/이번 달만 작성 가능
  const actualCurrentPeriod = cycle === 'weekly' ? currentWeekStr() : new Date().toISOString().slice(0, 7);
  const isReadOnly = period !== actualCurrentPeriod;

  const editSelected = (update: React.SetStateAction<PeriodRecord | null>) => {
    if (isReadOnly || control.busy.current || !actor.isCurrent(ownerToken)) return;
    control.dirty.current = true; setSelected(update);
  };
  // 템플릿 항목이 추가돼 rows 길이가 부족하면 빈 행으로 채워 인덱스 접근 오류 방지
  const padRows = (rows: PeriodRow[]): PeriodRow[] =>
    rows.length >= items.length
      ? rows
      : [...rows, ...items.slice(rows.length).map((): PeriodRow => ({ result: '', note: '', inspector: '' }))];

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
    if (!selected || isReadOnly || control.busy.current || !canSend('save', selected.id)) return;
    if (!readRef.current.ready) { setSaveError('기존 기록 조회가 끝나야 저장할 수 있습니다. 입력을 유지한 채 다시 조회해 주세요.'); return; }
    if (!selected.id && readRef.current.rows.some(r => r.cycle === cycle && r.period === period)) { setSaveError('같은 기간에 저장된 기록이 있습니다. 저장된 기록을 열어 확인해 주세요.'); return; }
    const missingNote = selected.rows
      .map((r, i) => r.result === 'fail' && !r.note.trim() ? (items[i]?.item ?? `항목 ${i + 1}`) : null)
      .filter(Boolean) as string[];
    if (missingNote.length > 0) { setSaveError(`부적합 항목의 비고사항을 입력해주세요: ${missingNote.join(', ')}`); return; }
    setSaveError('');
    control.busy.current = true; const token = control.generation.current; const requestOwner = ownerToken;
    setSaving(true);
    const now = new Date().toISOString();
    const userName = currentUser?.name ?? '알 수 없음';
    const saveObservation = acknowledgements.captureSave();
    try {
      if (!selected.id) {
        const data: Omit<PeriodRecord, 'id'> = { ...selected, createdBy: userName, createdAt: now, updatedBy: userName, updatedAt: now };
        const id = await addItem('haccp_periodic_sanitation', data);
        if (!(control.current(token) && actor.canAct('save', requestOwner))) return;
        acknowledgements.rememberSave({ ...data, id }, saveObservation); control.dirty.current = false; setSelected({ ...data, id });
      } else {
        const update = { ...selected, updatedBy: userName, updatedAt: now };
        await updateItem('haccp_periodic_sanitation', selected.id, update as any);
        if (!(control.current(token) && actor.canAct('save', requestOwner))) return;
        acknowledgements.rememberSave({ ...selected, ...update }, saveObservation); control.dirty.current = false; setSelected(prev => prev ? { ...prev, ...update } : prev);
      }
    } catch { if ((control.current(token) && actor.isCurrent(requestOwner))) { readRef.current.ready = false; readRef.current.blocked = true; setRecordsReady(false); setRecordsError('저장 결과를 확인하지 못했습니다. 입력은 보존했습니다. 다시 조회한 뒤 기존 기록을 확인해 주세요.'); }
    } finally { if ((control.current(token) && actor.isCurrent(requestOwner))) { control.busy.current = false; setSaving(false); } }
  };

  const handleConfirm = async () => {
    if (control.busy.current || !canSend('confirm', selected?.id)) return;
    if (!selected?.id) { alert('점검표를 먼저 저장해주세요.'); return; }
    control.busy.current = true; const token = control.generation.current; const requestOwner = ownerToken;
    const captured = acknowledgements.captureConfirm(periodKey(selected), selected.id);
    setConfirming(true);
    const now = new Date().toISOString();
    const userName = currentUser?.name ?? '관리자';
    try {
      const update = { confirmedBy: userName, confirmedAt: now };
      await updateItem('haccp_periodic_sanitation', selected.id, update);
      if (!(control.current(token) && actor.canAct('confirm', requestOwner))) return;
      const confirmed = { ...selected, ...update };
      acknowledgements.rememberConfirm(confirmed, captured);
      setSelected(confirmed);
      alert('확인 결과를 저장했습니다. PDF는 별도 PDF 버튼에서 미리보고 저장하세요.');
    } catch { if ((control.current(token) && actor.isCurrent(requestOwner))) { readRef.current.ready = false; readRef.current.blocked = true; setRecordsReady(false); setRecordsError('확인 처리 결과를 확인하지 못했습니다. 입력을 유지했습니다. 다시 조회해 주세요.'); }
    } finally { if ((control.current(token) && actor.isCurrent(requestOwner))) { control.busy.current = false; setConfirming(false); } }
  };

  const handleDelete = async (id: string) => {
    if (control.busy.current || !canSend('delete', id)) return;
    control.busy.current = true; const token = control.generation.current; const requestOwner = ownerToken; setDeleting(true);
    try {
      if (!await appConfirm('이 점검표를 삭제하시겠습니까?')) return;
      if (!(control.current(token) && actor.isCurrent(requestOwner)) || !canSend('delete', id)) return;
      await deleteItem('haccp_periodic_sanitation', id);
      if ((control.current(token) && actor.canAct('delete', requestOwner))) { acknowledgements.rememberDelete(id, selected?.id); readRef.current.rows = acknowledgements.visibleRecords(); setRecords(acknowledgements.visibleRecords()); if (selected?.id === id) { control.dirty.current = false; setSelected(null); } }
    } catch { if ((control.current(token) && actor.isCurrent(requestOwner))) { readRef.current.ready = false; readRef.current.blocked = true; setRecordsReady(false); setRecordsError('삭제 결과를 확인하지 못했습니다. 초안은 유지했습니다. 다시 조회해 주세요.'); }
    } finally { if ((control.current(token) && actor.isCurrent(requestOwner))) { control.busy.current = false; setDeleting(false); } }
  };

  const resultBadge = (result: PeriodRow['result']) => {
    if (result === 'pass') return <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">적합</span>;
    if (result === 'fail') return <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-700">부적합</span>;
    return <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-400">미입력</span>;
  };

  const pastRecords = records.filter(r => r.cycle === cycle && !(r.cycle === cycle && r.period === period));

  const serverCandidate = selected && recordsReady ? acknowledgements.serverRecord(periodKey(selected)) : undefined;
  const openServerRecord = () => {
    if (!serverCandidate?.id || !selected) return;
    const wasDirty = control.dirty.current;
    const id = serverCandidate.id, key = periodKey(selected);
    void changeSelection(() => {
      // change가 승인을 받고 dirty를 먼저 해제하므로, 실제 열기 실패는 같은 owner의 추적을 복원한다.
      const record = readRef.current.ready ? acknowledgements.openServerRecord(key, id, true) : undefined;
      if (record) { setSelected(record); setSaveError(''); }
      else { control.dirty.current = wasDirty; setSaveError('선택한 저장 기록을 열지 못했습니다. 입력은 보존했습니다. 기록을 다시 조회한 뒤 저장된 기록을 열어 주세요.'); }
    });
  };
  const retryRecords = () => {
    if (control.busy.current || !actor.isCurrent(ownerToken)) return;
    readRef.current.ready = false; setRecordsReady(false); setReadAttempt(value => value + 1);
  };

  return (
    <fieldset disabled={saving || confirming || deleting} className="flex min-w-0 flex-col gap-4 border-0 p-0 m-0">
      {saveError && <div role="alert" className="bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg px-3 py-2">⚠️ {saveError}<button type="button" className="ml-2 underline" onClick={retryRecords}>기록 다시 조회</button>{serverCandidate && <button type="button" className="ml-2 underline" onClick={openServerRecord}>저장된 기록 열기</button>}</div>}
      {!templateReady[cycle] && !templateErrors[cycle] && <p role="status" className="text-xs text-slate-600">점검 양식을 조회 중입니다. 입력은 유지되며 조회 후 저장할 수 있습니다.</p>}
      {templateErrors[cycle] && <div role="alert" className="border border-slate-200 bg-white rounded px-3 py-2 text-xs"><p>{templateErrors[cycle]}</p><button type="button" className="mt-2 rounded border border-slate-300 px-3 py-1.5" onClick={() => { templateRead.current[cycle] = false; setTemplateReady(value => ({ ...value, [cycle]: false })); setTemplateAttempt(value => ({ ...value, [cycle]: value[cycle] + 1 })); }}>양식 다시 조회</button></div>}

      {!recordsReady && !recordsError && <p role="status" className="text-xs text-slate-600">기존 기록을 조회 중입니다. 입력할 수 있으며 조회가 끝난 뒤 저장할 수 있습니다.</p>}
      {recordsError && <div role="alert" className="border border-slate-200 bg-white rounded px-3 py-2 text-xs"><p>{recordsError}</p><button className="mt-2 rounded border border-slate-300 px-3 py-1.5 font-medium text-slate-700" type="button" onClick={() => { readRef.current.ready = false; setRecordsReady(false); setReadAttempt(value => value + 1); }}>다시 조회</button></div>}
      {recordsReady && selected && !selected.id && currentRecord && control.dirty.current && <div role="alert" className="border border-slate-200 bg-white rounded px-3 py-2 text-xs"><p>작성 중 같은 기간의 저장된 기록이 확인되었습니다. 초안은 유지했으며 중복 저장은 막았습니다.</p><button className="mt-2 rounded border border-slate-300 px-3 py-1.5 font-medium text-slate-700" type="button" onClick={openServerRecord}>저장된 기록 열기</button></div>}
      {/* 주간/월간 서브 탭 + 기간 선택 */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex gap-2 mb-4">
          {(['weekly', 'monthly'] as PeriodCycle[]).map(c => (
            <button
              key={c}
              onClick={() => { if (c !== cycle) void changeSelection(() => { setCycle(c); setSaveError(''); }); }}
              className={`flex-1 py-2 rounded-lg text-sm font-bold transition-colors ${
                cycle === c ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {c === 'weekly' ? '주간 점검표' : '월간 점검표'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">{cycleName} 기간:</span>
          {cycle === 'weekly' ? (
            <input type="week" value={weekPeriod} onChange={e => { const value = e.target.value; if (value !== weekPeriod) void changeSelection(() => setWeekPeriod(value)); }} className="border border-slate-300 rounded px-2 py-1 text-xs" />
          ) : (
            <input type="month" value={monthPeriod} onChange={e => { const value = e.target.value; if (value !== monthPeriod) void changeSelection(() => setMonthPeriod(value)); }} className="border border-slate-300 rounded px-2 py-1 text-xs" />
          )}
          {currentRecord && (
            <span className="text-xs text-emerald-600 font-bold">✓ 저장된 기록</span>
          )}
        </div>
      </div>

      {/* 이전 기록 */}
      <button
        onClick={() => setShowHistory(v => !v)}
        className="flex items-center justify-between px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-50"
      >
        <span>{cycleName} 이전 점검 기록 ({pastRecords.length}건)</span>
        <span>{showHistory ? '▲' : '▼'}</span>
      </button>
      {showHistory && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {pastRecords.map(r => (
            <button
              key={r.id}
              onClick={() => openHistory(r)}
              className={`flex flex-col items-start gap-0.5 px-3 py-2 border rounded-lg text-xs font-medium transition-colors ${
                selected?.id === r.id ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span className="font-bold">{r.period}</span>
              <span className="text-slate-400">{r.confirmedBy ? `✓ ${r.confirmedBy}` : '미확인'}</span>
              {isAdmin && r.id && (
                <span
                  onClick={e => { e.stopPropagation(); handleDelete(r.id!); }}
                  className="mt-1 text-rose-400 hover:text-rose-600 text-xs cursor-pointer"
                >
                  삭제
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* 점검표 폼 */}
      {selected && <div className="flex flex-col gap-3">
          {/* 액션 바 — 상단 고정 */}
          <div className="sticky top-0 z-20 flex items-center gap-2 flex-wrap bg-slate-50/95 backdrop-blur-sm border-b border-slate-200 py-2 -mx-6 px-6">
            <span className={`text-xs font-bold px-2 py-1 rounded border ${
              isReadOnly ? 'bg-slate-100 text-slate-500 border-slate-300' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
            }`}>
              {isReadOnly ? '📋 조회 (수정 불가)' : `✏️ ${selected.id ? '수정' : '신규'}`}
            </span>
            <span className="text-xs text-slate-500">{cycleName} · {selected.period}</span>
            <div className="ml-auto flex gap-2 flex-wrap justify-end">
              <button
                onClick={() => printRef.current && downloadAsPDF(printRef.current, `작업장위생점검표_${cycleName}_${selected.period}.pdf`, outputSignal())}
                className="flex items-center gap-1 px-3 py-2 bg-slate-600 text-white rounded-lg text-xs font-bold hover:bg-slate-700"
              >
                <FileDown size={12} /> PDF
              </button>
              {canConfirm && (
                selected.confirmedBy
                  ? <span className="flex items-center gap-1 px-3 py-2 bg-emerald-50 border border-emerald-300 text-emerald-700 rounded-lg text-xs font-bold">
                      <BadgeCheck size={13} /> {selected.confirmedBy} 확인완료
                    </span>
                  : <button
                      onClick={handleConfirm} title="확인 결과만 저장합니다. PDF는 별도 PDF 버튼에서 미리보고 저장합니다."
                      disabled={confirming || !selected.id || !templateReady[cycle]}
                      className="flex items-center gap-1 px-3 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 disabled:opacity-40"
                    >
                      <BadgeCheck size={13} /> {confirming ? '처리 중...' : !selected.id ? '저장 먼저' : '관리자 확인'}
                    </button>
              )}
              {!isReadOnly && (
                <button onClick={handleSave} disabled={saving || !templateReady[cycle] || !recordsReady || !!recordsError || (!selected.id && !!currentRecord)}
                  className="flex items-center gap-1 px-3 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 disabled:opacity-50"
                >
                  <Save size={12} /> {saving ? '저장 중...' : '저장'}
                </button>
              )}
            </div>
          </div>

          {/* 인쇄 영역 */}
          <div ref={printRef} className="bg-white border border-slate-200 rounded-xl p-4 md:p-6" style={{ fontFamily: 'Malgun Gothic, sans-serif' }}>
            <h2 className="text-base md:text-lg font-black text-center mb-4">HACCP 작업장 위생점검표 ({cycleName})</h2>

            {/* 헤더 정보 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-px border border-slate-300 rounded-lg overflow-hidden mb-4 text-xs">
              {[
                { label: '회사명',   value: '태백식품' },
                { label: '문서번호', value: 'HACCP-PRP-001' },
                { label: '작성자',   value: selected.createdBy || (isReadOnly ? '-' : currentUser?.name ?? '-') },
                { label: '개정번호', value: selected.id ? '최신' : '미저장' },
                { label: '점검주기', value: cycleName },
                { label: '점검기간', value: selected.period },
              ].map(f => (
                <div key={f.label} className="bg-white">
                  <div className="bg-slate-100 px-2 py-1 font-bold text-slate-600 border-b border-slate-300">{f.label}</div>
                  <div className="px-2 py-1.5 text-slate-800">{f.value}</div>
                </div>
              ))}
              <div className="bg-white col-span-2">
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

            <div className="text-xs font-bold mb-2">■ 작업장 위생 점검 항목</div>

            {/* 모바일 카드 */}
            <div className="flex flex-col gap-1.5 md:hidden">
              {items.map((item, idx) => {
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
                  {items.map((item, idx) => {
                    const row = selected.rows[idx] ?? { result: '', note: '', inspector: '' };
                    return (
                      <tr key={idx} className={row.result === 'fail' ? 'bg-rose-50' : ''}>
                        <td className={TD}>{idx + 1}</td>
                        <td className={TDL}>{item.item}</td>
                        <td className={TD}>{item.standard}</td>
                        <td className={TD}>
                          <input type="checkbox" checked={row.result === 'pass'} onChange={() => toggleResult(idx, 'pass')} disabled={isReadOnly} />
                        </td>
                        <td className={TD}>
                          <input type="checkbox" checked={row.result === 'fail'} onChange={() => toggleResult(idx, 'fail')} disabled={isReadOnly} />
                        </td>
                        <td className={TD}>{resultBadge(row.result)}</td>
                        <td className={TD}>
                          {row.inspector
                            ? <span className="inline-flex px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-xs font-medium">{row.inspector}</span>
                            : <span className="text-slate-300 text-xs">-</span>
                          }
                        </td>
                        <td className={TDL}>
                          <input
                            value={row.note}
                            onChange={e => setRow(idx, 'note', e.target.value)}
                            disabled={isReadOnly}
                            className="w-full text-xs border-none outline-none bg-transparent disabled:opacity-60"
                            placeholder={row.result === 'fail' ? '조치 내용 필수' : ''}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mb-4">
              <div className="text-xs font-bold text-slate-700 mb-1">특이사항</div>
              <textarea
                value={selected.specialNotes}
                onChange={e => !isReadOnly && editSelected(prev => prev ? { ...prev, specialNotes: e.target.value } : prev)}
                disabled={isReadOnly}
                rows={2}
                className="w-full border border-slate-300 rounded px-2 py-1 text-xs disabled:opacity-60 resize-none"
                placeholder="특이사항을 입력하세요"
              />
            </div>

            {/* 서명란 — 확인자 없이, 관리자는 확인 시에만 표시 */}
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
        </div>
      }
    </fieldset>
  );
};
