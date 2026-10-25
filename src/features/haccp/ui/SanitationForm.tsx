import { useOutputScope } from '../../../shared/hooks/useOutputScope';
import { previewRasterPdf, snapshotOutputElement, type RasterPdfPage } from '../../../shared/rasterPdfOutput';
import React, {useState,useRef,useEffect,useLayoutEffect} from 'react';
import {FileDown,ShieldAlert,Save,Trash2,BadgeCheck} from 'lucide-react';
import {collection,doc,onSnapshot,query,where} from 'firebase/firestore';
import {db} from '../../../shared/firebase';
import {addItem,updateItem,deleteItem} from '../../../shared/services/firebaseService';
import {appConfirm} from '../../../shared/components/appDialog';
import {haccpTemplateDocId} from '../../../shared/haccpTemplateId';
import {useHaccpRecordActor, type HaccpRecordActorAction} from '../hooks/useHaccpRecordActor';
import {useHaccpCompany} from '../context/HaccpCompanyContext';
import {todayStr} from '../domain/haccpDate';
import {createHaccpRecordAcknowledgements} from '../domain/haccpRecordAcknowledgements';
import {SANITATION_ITEMS} from '../domain/sanitationItems';
import type {SlotTime,SanitationRow,SanitationRecord} from '../domain/sanitationTypes';
import {TH,TD,TDL} from './ChecklistFormParts';
import {SanitationPrintable,SanitationMonthlyCover} from './SanitationPrint';
import {downloadAsPDF} from '../infrastructure/downloadAsPDF';

const isSanitationComplete = (rows: SanitationRow[], requiredCount: number): boolean =>
  Array.from({length: Math.max(requiredCount, rows.length)}, (_, index) => rows[index])
    .every(row => !!row && (row.result === 'pass' || row.result === 'fail'));

const emptyRecord = (slot: SlotTime, items = SANITATION_ITEMS): Omit<SanitationRecord, 'id'> => ({
  checkDate: todayStr(),
  checkZone: '',
  checkTime: slot,
  rows: items.map(() => ({ result: '', note: '', inspector: '' })),
  specialNotes: '',
  createdBy: '',
  createdAt: '',
  updatedBy: '',
  updatedAt: '',
  revisionCount: -1,
});

const sanitationKey = (record: Pick<SanitationRecord, 'checkDate' | 'checkTime'>) => JSON.stringify([record.checkDate, record.checkTime]);

export const SanitationForm: React.FC<{ currentUser?: { id: string; name: string }; isAdmin?: boolean; canConfirm?: boolean }> = ({ currentUser, isAdmin, canConfirm }) => {
  const companyId = useHaccpCompany();
  const actor = useHaccpRecordActor({companyId, currentUserId: currentUser?.id, isAdmin, canConfirm});
  const owner = actor.ownerToken;
  const runRef = useRef<object | null>(null), selection = useRef(0);
  const [acknowledgements] = useState(() => createHaccpRecordAcknowledgements<SanitationRecord>({getKey: sanitationKey, strategy: {kind: 'numeric', getRevision: record => record.revisionCount ?? -1}, mergeConfirmed: (base, result) => ({...base, confirmedBy: result.confirmedBy, confirmedAt: result.confirmedAt})}));
  const [deleting, setDeleting] = useState(false);
  const [readAttempt, setReadAttempt] = useState(0);
  const [recordsReady, setRecordsReady] = useState(false), [templateReady, setTemplateReady] = useState(false);
  const [recordsError, setRecordsError] = useState(''), [templateError, setTemplateError] = useState('');
  const readRef = useRef({records: false, template: false, blocked: false, rows: [] as SanitationRecord[]});
  const [records, setRecords] = useState<SanitationRecord[]>([]);
  const [selected, setSelected] = useState<SanitationRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [saveError, setSaveError] = useState('');
  const currentItems = useRef({owner, items: SANITATION_ITEMS});
  if (currentItems.current.owner !== owner) currentItems.current = {owner, items: SANITATION_ITEMS};
  const [templateItems, setTemplateItems] = useState<{ item: string; standard: string }[]>(SANITATION_ITEMS);
  const printRef = useRef<HTMLDivElement>(null);

  const today = todayStr();

  useLayoutEffect(() => {
    runRef.current = null; selection.current++; acknowledgements.resetOwner();
    readRef.current = {records: false, template: false, blocked: false, rows: []};
    setSelected(null); setRecords([]); setTemplateItems(SANITATION_ITEMS);
    setSaving(false); setConfirming(false); setDeleting(false); setSaveError('');
    setRecordsReady(false); setTemplateReady(false); setRecordsError(''); setTemplateError('');
  }, [owner]);

  useEffect(() => {
    let active = true;
    readRef.current.records = false; setRecordsReady(false); setRecordsError('');
    const q = query(collection(db, 'haccp_sanitation'), where('companyId', '==', companyId));
    const stop = onSnapshot(q, {includeMetadataChanges: true}, snap => {
      if (!active || !actor.isCurrent(owner)) return;
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() } as SanitationRecord)).filter(row => typeof row.checkDate === 'string').sort((a, b) => b.checkDate.localeCompare(a.checkDate));
      const serverConfirmed = snap.metadata?.fromCache === false;
      const ready = serverConfirmed && !readRef.current.blocked;
      acknowledgements.observe(rows, ready);
      readRef.current.records = ready; readRef.current.rows = acknowledgements.visibleRecords();
      setRecords(acknowledgements.visibleRecords()); setRecordsReady(ready); if (ready) setRecordsError('');
    }, () => {
      if (!active || !actor.isCurrent(owner)) return;
      active = false; readRef.current.records = false; setRecordsReady(false);
      setRecordsError('기존 기록을 확인하지 못했습니다. 초안을 유지했습니다. 다시 조회해 주세요.');
    });
    return () => {active = false; stop();};
  }, [owner, readAttempt]);

  useEffect(() => {
    let active = true;
    readRef.current.template = false; setTemplateReady(false); setTemplateError('');
    const stop = onSnapshot(doc(db, 'haccp_templates', haccpTemplateDocId(companyId, 'sanitation')), {includeMetadataChanges: true}, snap => {
      if (!active || !actor.isCurrent(owner)) return;
      if (snap.exists()) {
        const data = snap.data().items;
        if (Array.isArray(data) && data.length > 0) {
          // React 반영 전 확인 처리도 현재 필수 항목을 검사해야 한다.
          currentItems.current = {owner, items: data}; setTemplateItems(data);
        }
      }
      const serverConfirmed = snap.metadata?.fromCache === false;
      readRef.current.template = serverConfirmed; setTemplateReady(serverConfirmed);
    }, () => {
      if (!active || !actor.isCurrent(owner)) return;
      active = false; readRef.current.template = false; setTemplateReady(false);
      setTemplateError('점검 항목을 확인하지 못했습니다. 초안을 유지했습니다. 다시 조회해 주세요.');
    });
    return () => {active = false; stop();};
  }, [owner, readAttempt]);

  const retryRead = () => {
    if (runRef.current || !actor.isCurrent(owner)) return;
    readRef.current.records = false; readRef.current.template = false; readRef.current.blocked = false;
    setRecordsReady(false); setTemplateReady(false); setReadAttempt(value => value + 1);
  };
  const canSend = (kind: HaccpRecordActorAction, id?: string) => {
    if (!actor.canAct(kind, owner) || !readRef.current.records || (kind !== 'delete' && !readRef.current.template)) return false;
    const issue = acknowledgements.targetIssue(kind, id, selected ? sanitationKey(selected) : '');
    if (issue) {
      const messages = {'body-mismatch': '마지막 저장 내용과 조회된 내용이 다릅니다. 입력은 보존했습니다. 다시 조회하거나 저장된 기록을 열어 확인해 주세요.', 'duplicate-key': '같은 점검 기록이 여러 개입니다. 입력은 보존했습니다. 관리자 확인 후 기존 이력에서 중복 기록을 정리하고 다시 조회해 주세요.', 'existing-key': '같은 날짜·시간에 저장된 기록이 있습니다. 입력은 보존했습니다. 저장된 기록을 열어 확인해 주세요.', 'missing-record': '현재 목록에서 선택 기록을 확인하지 못했습니다. 입력은 보존했습니다. 위의 점검 시간이나 다른 기록을 선택하거나 다시 조회해 주세요.'};
      setSaveError(messages[issue]);
      return false;
    }
    return true;
  };
  const begin = (kind: HaccpRecordActorAction, id?: string) => {
    if (runRef.current || !canSend(kind, id)) return null;
    const run = {}; runRef.current = run; setSaveError('');
    const generation = selection.current;
    const owns = () => actor.isCurrent(owner) && runRef.current === run && selection.current === generation;
    return {owns, allowed: () => owns() && actor.canAct(kind, owner), beforeSend: () => owns() && canSend(kind, id),
      finish: () => {if (owns()) {runRef.current = null; setSaving(false); setConfirming(false); setDeleting(false);}}};
  };
  const editSelected = (update: React.SetStateAction<SanitationRecord | null>) => {
    if (!runRef.current && actor.isCurrent(owner)) setSelected(update);
  };

  // ── 월별 심사자료 PDF 다운로드 (관리자) ──────────────────────────────
  const bulkRef = useRef<HTMLDivElement>(null);
  const [bulkMonth, setBulkMonth] = useState(today.slice(0, 7));
  const outputSignal = useOutputScope(companyId, `${selected?.id ?? "new"}:${selected?.checkDate ?? ""}:${bulkMonth}`);
  const [bulkList, setBulkList] = useState<SanitationRecord[] | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ cur: number; total: number } | null>(null);

  const monthRecordsSorted = (ym: string) =>
    records
      .filter(r => r.checkDate.slice(0, 7) === ym)
      .sort((a, b) => a.checkDate.localeCompare(b.checkDate) || a.checkTime.localeCompare(b.checkTime));

  const startBulkDownload = () => {
    const list = monthRecordsSorted(bulkMonth);
    if (list.length === 0) { alert(`${bulkMonth} 에 저장된 점검표가 없습니다.`); return; }
    setBulkList(list); // 숨은 영역 렌더 트리거 → useEffect에서 캡처
  };

  useEffect(() => {
    if (!bulkList) return;
    let cancelled = false;
    const signal = outputSignal();
    (async () => {
      // 숨은 영역 렌더/레이아웃 완료 대기 (2 프레임)
      await new Promise<void>(res => requestAnimationFrame(() => requestAnimationFrame(() => res())));
      if (cancelled || signal.aborted || !bulkRef.current) { setBulkList(null); return; }
      const pages = Array.from(bulkRef.current.querySelectorAll<HTMLElement>('[data-pdf-page]'));
      if (pages.length === 0) { setBulkList(null); return; }
      const snapshots = pages.map(page => snapshotOutputElement(page));
      try {
        const { default: html2canvas } = await import('html2canvas') as any;
        const outputPages: RasterPdfPage[] = [];
        const pageW = 210, pageH = 297;
        for (let i = 0; i < pages.length; i++) {
          if (cancelled || signal.aborted) return;
          setBulkProgress({ cur: i + 1, total: pages.length });
          const canvas = await html2canvas(snapshots[i].element, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
          if (cancelled || signal.aborted) return;
          let w = pageW;
          let h = (canvas.height * w) / canvas.width;
          if (h > pageH) { h = pageH; w = (canvas.width * h) / canvas.height; }
          outputPages.push({width:pageW,height:pageH,draws:[{image:canvas.toDataURL('image/png'),x:(pageW-w)/2,y:0,width:w,height:h}]});
        }
        snapshots.forEach(snapshot => snapshot.dispose());
        if (!cancelled && !signal.aborted) await previewRasterPdf({pages:outputPages,fileName:`작업장위생점검표_${bulkMonth}_월별.pdf`,signal});
      } catch {
        if (!cancelled && !signal.aborted) alert('월별 PDF를 만들지 못했습니다. 기록은 바꾸지 않았습니다. 다시 미리보기를 열어 주세요.');
      } finally {
        snapshots.forEach(snapshot => snapshot.dispose());
        if (!cancelled) { setBulkProgress(null); setBulkList(null); }
      }
    })();
    return () => { cancelled = true; };
  }, [bulkList]); // eslint-disable-line react-hooks/exhaustive-deps

  // 오늘 슬롯 기존 데이터 조회
  const todayMorning = acknowledgements.known(sanitationKey({checkDate: today, checkTime: '08:30'}), recordsReady) ?? records.find(r => r.checkDate === today && r.checkTime === '08:30');
  const todayAfternoon = acknowledgements.known(sanitationKey({checkDate: today, checkTime: '15:00'}), recordsReady) ?? records.find(r => r.checkDate === today && r.checkTime === '15:00');

  const openSlot = (slot: SlotTime) => {
    if (runRef.current || !actor.isCurrent(owner)) return;
    // 같은 슬롯의 확정 ID는 목록이 도착하기 전에 다시 신규 초안으로 바꾸지 않는다.
    if (selected?.id && selected.checkDate === today && selected.checkTime === slot && acknowledgements.allowsUnobservedAck(selected.id)) return;
    const existing = slot === '08:30' ? todayMorning : todayAfternoon;
    selection.current++;
    setSelected(acknowledgements.select(existing ?? { ...emptyRecord(slot, templateItems) } as SanitationRecord, readRef.current.records));
    setSaveError('');
  };

  const openHistory = (r: SanitationRecord) => {
    if (runRef.current || !actor.isCurrent(owner)) return;
    selection.current++;
    setSelected(acknowledgements.select(r, readRef.current.records));
    setSaveError('');
    setShowHistory(false);
  };

  const isToday = selected ? selected.checkDate === today : false;
  const isReadOnly = selected ? !isToday : false;
  const allChecked = selected ? isSanitationComplete(selected.rows, templateItems.length) : false;
  const completionNow = (record: SanitationRecord) => currentItems.current.owner === owner && isSanitationComplete(record.rows, currentItems.current.items.length);
  const persistedCompletionNow = (record: SanitationRecord) => {
    const saved = acknowledgements.known(sanitationKey(record), readRef.current.records);
    return !!record.id && !!saved && saved.id === record.id && saved.checkDate === record.checkDate && saved.checkTime === record.checkTime && completionNow(saved);
  };
  const persistedComplete = selected ? persistedCompletionNow(selected) : false;
  const persistedCompletionMessage = isReadOnly
    ? '저장된 과거 점검 기록의 항목이 미완료입니다. 다시 조회하거나 위의 오늘 점검 시간을 선택해 주세요.'
    : '저장된 점검 기록의 항목이 미완료입니다. 입력은 보존했습니다. 먼저 저장한 뒤 확인해 주세요.';

  // 템플릿 항목이 추가돼 rows 길이가 부족하면 빈 행으로 채워 인덱스 접근 오류 방지
  const padRows = (rows: SanitationRow[]): SanitationRow[] =>
    rows.length >= templateItems.length
      ? rows
      : [...rows, ...templateItems.slice(rows.length).map((): SanitationRow => ({ result: '', note: '', inspector: '' }))];

  const setRow = (idx: number, field: keyof SanitationRow, val: string) => {
    if (isReadOnly || runRef.current || !actor.isCurrent(owner)) return;
    setSelected(prev => prev ? {
      ...prev,
      rows: padRows(prev.rows).map((r, i) => i === idx ? { ...r, [field]: val } : r),
    } : prev);
  };

  const toggleResult = (idx: number, val: 'pass' | 'fail') => {
    if (isReadOnly || runRef.current || !actor.isCurrent(owner)) return;
    const userName = currentUser?.name ?? '';
    setSelected(prev => {
      if (!prev) return prev;
      const rows = padRows(prev.rows);
      const row = rows[idx];
      const newResult = row.result === val ? '' : val;
      return {
        ...prev,
        rows: rows.map((r, i) => i === idx ? {
          ...r,
          result: newResult,
          inspector: r.inspector || (newResult ? userName : ''),
        } : r),
      };
    });
  };

  const handleSave = async () => {
    if (!selected || isReadOnly || runRef.current) return;
    if (!canSend('save', selected.id)) return;
    if (!selected.id && readRef.current.rows.some(row => row.checkDate === selected.checkDate && row.checkTime === selected.checkTime)) {
      setSaveError('같은 날짜와 시간에 저장된 기록이 있습니다. 초안을 유지했으니 저장된 기록을 확인해 주세요.'); return;
    }
    // 부적합 행은 비고사항(조치) 필수
    const missingNote = selected.rows
      .map((r, i) => r.result === 'fail' && !r.note.trim() ? (templateItems[i]?.item ?? `항목 ${i + 1}`) : null)
      .filter(Boolean) as string[];
    if (missingNote.length > 0) {
      setSaveError(`부적합 항목의 비고사항(조치)을 입력해주세요: ${missingNote.join(', ')}`);
      return;
    }
    const action = begin('save', selected.id); if (!action) return;
    setSaveError('');
    setSaving(true);
    const now = new Date().toISOString();
    const userName = currentUser?.name ?? '알 수 없음';
    const saveObservation = acknowledgements.captureSave();
    try {
      if (!selected.id) {
        const data: Omit<SanitationRecord, 'id'> = {
          ...selected,
          createdBy: userName,
          createdAt: now,
          updatedBy: userName,
          updatedAt: now,
          revisionCount: 0,
        };
        const id = await addItem('haccp_sanitation', data);
        if (action.allowed()) {
          acknowledgements.rememberSave({ ...data, id }, saveObservation);
          setSelected({ ...data, id });
        }
      } else {
        const newRev = (selected.revisionCount ?? 0) + 1;
        const update: Partial<SanitationRecord> = {
          ...selected,
          updatedBy: userName,
          updatedAt: now,
          revisionCount: newRev,
        };
        await updateItem('haccp_sanitation', selected.id, update as any);
        if (action.allowed()) { acknowledgements.rememberSave({ ...selected, ...update }, saveObservation); setSelected(prev => prev ? { ...prev, ...update } : prev); }
      }
    } catch {
      if (action.allowed()) { readRef.current.blocked = true; readRef.current.records = false; setRecordsReady(false); setRecordsError('저장 결과를 확인하지 못했습니다. 초안을 유지했습니다. 다시 조회한 뒤 기존 기록을 확인해 주세요.'); }
    } finally { action.finish(); }
  };

  const handleConfirm = async () => {
    if (!canConfirm || runRef.current) return;
    if (!selected?.id) {
      alert('점검표를 먼저 저장해주세요.');
      return;
    }
    if (!canSend('confirm', selected.id)) return;
    if (!completionNow(selected)) {
      alert('모든 점검 항목을 확인(적합/부적합) 완료 후 확인할 수 있습니다.');
      return;
    }
    if (!persistedCompletionNow(selected)) { setSaveError(persistedCompletionMessage); return; }
    const action = begin('confirm', selected.id); if (!action) return;
    const captured = acknowledgements.captureConfirm(sanitationKey(selected), selected.id);
    setConfirming(true);
    const now = new Date().toISOString();
    const userName = currentUser?.name ?? '관리자';
    try {
      if (!action.beforeSend()) return;
      if (!completionNow(selected)) { setSaveError('현재 양식의 모든 점검 항목을 완료해 주세요. 입력은 보존했습니다.'); return; }
      if (!persistedCompletionNow(selected)) { setSaveError(persistedCompletionMessage); return; }
      const update = { confirmedBy: userName, confirmedAt: now };
      await updateItem('haccp_sanitation', selected.id, update);
      if (!action.allowed()) return;
      const confirmed = { ...selected, ...update };
      acknowledgements.rememberConfirm(confirmed, captured);
      setSelected(confirmed);
      alert('확인 결과를 저장했습니다. PDF는 별도 PDF 버튼에서 미리보고 저장하세요.');
    } catch {
      if (action.allowed()) { readRef.current.blocked = true; readRef.current.records = false; setRecordsReady(false); setRecordsError('확인 처리 결과를 확인하지 못했습니다. 초안을 유지했습니다. 다시 조회해 주세요.'); }
    } finally { action.finish(); }
  };

  const handleDelete = async (id: string) => {
    const action = begin('delete', id); if (!action) return;
    setDeleting(true);
    try {
      if (!await appConfirm('이 점검표를 삭제하시겠습니까?')) return;
      if (!action.beforeSend()) return;
      await deleteItem('haccp_sanitation', id);
      if (action.allowed()) { acknowledgements.rememberDelete(id, selected?.id); readRef.current.rows = acknowledgements.visibleRecords(); setRecords(acknowledgements.visibleRecords()); if (selected?.id === id) setSelected(null); }
    } catch {
      if (action.allowed()) { readRef.current.blocked = true; readRef.current.records = false; setRecordsReady(false); setRecordsError('삭제 결과를 확인하지 못했습니다. 초안을 유지했습니다. 다시 조회해 주세요.'); }
    } finally { action.finish(); }
  };

  const serverCandidate = selected && recordsReady ? acknowledgements.serverRecord(sanitationKey(selected)) : undefined;
  const openServerRecord = () => {
    if (runRef.current || !actor.isCurrent(owner) || !readRef.current.records || !selected || !serverCandidate?.id) return;
    const record = acknowledgements.openServerRecord(sanitationKey(selected), serverCandidate.id, readRef.current.records);
    if (record) { selection.current++; setSelected(record); setSaveError(''); }
  };

  const revLabel = (r: SanitationRecord) =>
    r.revisionCount < 0 ? '미저장' : `Rev.${r.revisionCount}`;

  const slotLabel = (slot: SlotTime) => slot === '08:30' ? '오전 08:30' : '오후 15:00';

  const resultBadge = (result: SanitationRow['result']) => {
    if (result === 'pass') return <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">적합</span>;
    if (result === 'fail') return <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-700">부적합</span>;
    return <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-400">미입력</span>;
  };

  // ── 조회: 월별 그룹 ──────────────────────────────────────────
  const [historyMonth, setHistoryMonth] = useState(today.slice(0, 7));
  const monthOptions = Array.from(new Set([...records.map(r => r.checkDate.slice(0, 7)), today.slice(0, 7)])).sort((a, b) => b.localeCompare(a));
  const historyList = records
    .filter(r => r.checkDate.slice(0, 7) === historyMonth)
    .sort((a, b) => b.checkDate.localeCompare(a.checkDate) || a.checkTime.localeCompare(b.checkTime));
  const historyDates = Array.from(new Set(historyList.map(r => r.checkDate))).sort((a, b) => b.localeCompare(a));
  const historyConfirmed = historyList.filter(r => r.confirmedBy).length;
  const historyFail = historyList.filter(r => r.rows.some(row => row.result === 'fail')).length;

  const historySlotChip = (rec: SanitationRecord | undefined, label: string) => {
    if (!rec) return (
      <span className="inline-flex items-center px-2 py-1 rounded text-[11px] bg-slate-50 text-slate-400 border border-slate-200">{label} 미점검</span>
    );
    const hasFail = rec.rows.some(r => r.result === 'fail');
    const confirmed = !!rec.confirmedBy;
    return (
      <button
        onClick={() => openHistory(rec)}
        className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] border transition-colors ${selected?.id === rec.id ? 'ring-2 ring-slate-400 ' : ''}${confirmed
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:border-emerald-400'
          : 'bg-blue-50 text-blue-700 border-blue-200 hover:border-blue-400'}`}
      >
        <span className="font-bold">{label}</span>
        <span>{confirmed ? '✔확인' : '저장'}</span>
        {hasFail && <span className="text-rose-600 font-bold">·부적합</span>}
        {isAdmin && (
          <span role="button" onClick={e => { e.stopPropagation(); rec.id && handleDelete(rec.id); }}
            className="ml-0.5 text-rose-400 hover:text-rose-600"><Trash2 size={10} /></span>
        )}
      </button>
    );
  };

  return (
    <fieldset disabled={saving || confirming || deleting} className="flex min-w-0 flex-col gap-4 border-0 p-0 m-0">
      {(!recordsReady || !templateReady) && !recordsError && !templateError && <p role="status" className="text-xs text-slate-600">기록과 점검 항목을 조회 중입니다. 초안을 작성할 수 있으며 조회가 끝난 뒤 저장할 수 있습니다.</p>}
      {(recordsError || templateError) && <div role="alert" className="border border-slate-200 bg-white rounded px-3 py-2 text-xs"><p>{recordsError || templateError}</p><button type="button" onClick={retryRead} className="mt-2 rounded border border-slate-300 px-3 py-1.5">다시 조회</button></div>}
      {selected && !selected.id && recordsReady && records.some(row => row.checkDate === selected.checkDate && row.checkTime === selected.checkTime) && <div role="alert" className="text-xs"><p>같은 날짜와 시간의 저장된 기록이 있습니다. 초안은 유지했습니다.</p><button type="button" onClick={() => { const existing = readRef.current.rows.find(row => row.checkDate === selected.checkDate && row.checkTime === selected.checkTime); if (existing) openHistory(existing); }}>저장된 기록 열기</button></div>}

      {canConfirm && selected?.id && recordsReady && templateReady && !persistedComplete && <p role="status" className="text-sm text-slate-600">{persistedCompletionMessage} <button type="button" disabled={saving || confirming || deleting} onClick={retryRead}>기록 다시 조회</button></p>}
      {saveError && actor.isCurrent(owner) && <div role="alert" className="border border-slate-200 bg-white text-xs rounded-lg px-3 py-2">{saveError}<button type="button" className="ml-2 underline" onClick={retryRead}>기록 다시 조회</button>{serverCandidate && <button type="button" className="ml-2 underline" onClick={openServerRecord}>저장된 기록 열기</button>}</div>}
      {/* ── 오늘 날짜 + 슬롯 선택 ────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="text-xs text-slate-500 mb-3">
          오늘 점검일 <span className="font-bold text-slate-800 ml-1">{today}</span>
          <span className="ml-2 text-slate-400">· 1일 2회 (08:30 / 15:00)</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {(['08:30', '15:00'] as SlotTime[]).map(slot => {
            const existing = slot === '08:30' ? todayMorning : todayAfternoon;
            const isActive = selected?.checkTime === slot && selected?.checkDate === today;
            return (
              <button
                key={slot}
                onClick={() => openSlot(slot)}
                className={`flex flex-col items-center justify-center gap-1 py-4 rounded-xl border-2 text-sm font-bold transition-all ${
                  isActive
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                    : existing
                    ? 'border-emerald-200 bg-emerald-50/50 text-emerald-600 hover:border-emerald-400'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'
                }`}
              >
                <span className="text-base">{slot === '08:30' ? '🌅' : '🌇'}</span>
                <span>{slotLabel(slot)}</span>
                {!recordsReady ? <span className="text-xs font-normal text-slate-500">조회 필요</span> : existing
                  ? <span className="text-xs font-normal text-emerald-500">✓ {revLabel(existing)} 저장됨</span>
                  : <span className="text-xs font-normal text-slate-400">미작성</span>
                }
              </button>
            );
          })}
        </div>
      </div>

      {/* ── 점검 기록 조회 (월별) ─────────────────────────────── */}
      <button
        onClick={() => setShowHistory(v => !v)}
        className="flex items-center justify-between px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-50"
      >
        <span>점검 기록 조회 (총 {records.length}건)</span>
        <span>{showHistory ? '▲' : '▼'}</span>
      </button>
      {showHistory && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col gap-3">
          {/* 월 선택 + 요약 */}
          <div className="flex items-center gap-2 flex-wrap">
            <select value={historyMonth} onChange={e => setHistoryMonth(e.target.value)}
              className="border border-slate-300 rounded px-2 py-1.5 text-xs font-medium">
              {monthOptions.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <span className="text-[11px] text-slate-500">
              점검 <b className="text-slate-700">{historyList.length}</b>회 · 확인 <b className="text-emerald-600">{historyConfirmed}</b>회
              {historyFail > 0 && <span className="text-rose-600 font-bold"> · 부적합 {historyFail}회</span>}
            </span>
          </div>

          {/* 날짜별 행 (오전/오후 슬롯 상태) */}
          {historyDates.length === 0 ? (
            <p className="text-xs text-slate-400 py-4 text-center">이 달 점검 기록이 없습니다</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {historyDates.map(date => {
                const morning = historyList.find(r => r.checkDate === date && r.checkTime === '08:30');
                const afternoon = historyList.find(r => r.checkDate === date && r.checkTime === '15:00');
                return (
                  <div key={date} className="flex items-center gap-2 border border-slate-100 rounded-lg px-2.5 py-2 bg-slate-50/50">
                    <span className="text-xs font-bold text-slate-700 w-24 shrink-0">
                      {date}{date === today && <span className="text-emerald-500 ml-1">(오늘)</span>}
                    </span>
                    <div className="flex gap-1.5 flex-wrap">
                      {historySlotChip(morning, '오전')}
                      {historySlotChip(afternoon, '오후')}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-[10px] text-slate-400">🟩 확인완료 · 🟦 저장(미확인) · ⬜ 미점검 · 칩을 누르면 해당 점검표가 열립니다</p>
        </div>
      )}

      {/* ── 월별 심사자료 다운로드 (관리자) ───────────────────── */}
      {isAdmin && (
        <div className="bg-white border border-indigo-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <FileDown size={14} className="text-indigo-600" />
            <span className="text-sm font-bold text-slate-800">월별 심사자료 다운로드</span>
          </div>
          <p className="text-[11px] text-slate-500 mb-3">선택한 달의 <b>표지(실시 현황) + 점검표 전체</b>를 PDF 한 파일로 내려받습니다. (심사 제출용)</p>
          <div className="flex items-center gap-2 flex-wrap">
            <input type="month" value={bulkMonth} max={today.slice(0, 7)} disabled={!!bulkList}
              onChange={e => setBulkMonth(e.target.value)}
              className="border border-slate-300 rounded px-2 py-1.5 text-xs disabled:opacity-50" />
            <button onClick={startBulkDownload} disabled={!!bulkList}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 disabled:opacity-50">
              <FileDown size={13} />
              {bulkList ? (bulkProgress ? `생성 중… ${bulkProgress.cur}/${bulkProgress.total}` : '준비 중…') : '월별 PDF 생성'}
            </button>
            <span className="text-[11px] text-slate-400">{bulkMonth} · {monthRecordsSorted(bulkMonth).length}건</span>
          </div>
          {bulkList && (
            <p className="text-[11px] text-amber-600 mt-2">※ 페이지가 많으면 최대 1분가량 걸릴 수 있습니다. 창을 닫지 말고 기다려주세요.</p>
          )}
        </div>
      )}

      {/* ── PDF 생성용 숨은 렌더 영역 (화면에 보이지 않음) ─────── */}
      {bulkList && (
        <div ref={bulkRef} aria-hidden style={{ position: 'fixed', left: -10000, top: 0, width: 760, background: '#fff', zIndex: -1, pointerEvents: 'none' }}>
          <div data-pdf-page style={{ width: 760, padding: 24, boxSizing: 'border-box', background: '#fff' }}>
            <SanitationMonthlyCover ym={bulkMonth} monthRecords={bulkList} />
          </div>
          {bulkList.map(r => (
            <div key={r.id} data-pdf-page style={{ width: 760, padding: 24, boxSizing: 'border-box', background: '#fff' }}>
              <SanitationPrintable record={r} templateItems={templateItems} />
            </div>
          ))}
        </div>
      )}

      {/* ── 폼 없음 안내 ─────────────────────────────────────── */}
      {!selected && (
        <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-2">
          <ShieldAlert size={28} className="text-slate-300" />
          <p className="text-sm">위에서 점검 시간대를 선택해주세요</p>
        </div>
      )}

      {/* ── 폼 본문 ──────────────────────────────────────────── */}
      {selected && (
        <div className="flex flex-col gap-3">
          {/* 액션 바 — 스크롤해도 상단 고정 */}
          <div className="sticky top-0 z-20 flex items-center gap-2 flex-wrap bg-slate-50/95 backdrop-blur-sm border-b border-slate-200 py-2 -mx-6 px-6">
            <span className={`text-xs font-bold px-2 py-1 rounded border ${
              isReadOnly
                ? 'bg-slate-100 text-slate-500 border-slate-300'
                : 'bg-emerald-50 text-emerald-700 border-emerald-200'
            }`}>
              {isReadOnly ? '📋 조회 (수정 불가)' : `✏️ ${revLabel(selected)}`}
            </span>
            <span className="text-xs text-slate-500">{selected.checkDate} {slotLabel(selected.checkTime)}</span>
            <div className="ml-auto flex gap-2 flex-wrap justify-end">
              <button
                onClick={() => printRef.current && downloadAsPDF(printRef.current, `작업장위생점검표_${selected.checkDate}_${selected.checkTime.replace(':', '')}.pdf`, outputSignal())}
                className="flex items-center gap-1 px-3 py-2 bg-slate-600 text-white rounded-lg text-xs font-bold hover:bg-slate-700"
              >
                <FileDown size={12} /> PDF
              </button>
              {/* 관리자 전용 확인 버튼 — canConfirm이면 표시 */}
              {canConfirm && (
                selected.confirmedBy
                  ? <span className="flex items-center gap-1 px-3 py-2 bg-emerald-50 border border-emerald-300 text-emerald-700 rounded-lg text-xs font-bold">
                      <BadgeCheck size={13} /> {selected.confirmedBy} 확인완료
                    </span>
                  : <button
                      onClick={handleConfirm}
                      disabled={confirming || !selected.id || !allChecked || !persistedComplete || !recordsReady || !templateReady}
                      title={!selected.id ? '저장 후 확인할 수 있습니다' : !allChecked ? '모든 항목 체크 완료 후 확인 가능' : !persistedComplete ? persistedCompletionMessage : ''}
                      className="flex items-center gap-1 px-3 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <BadgeCheck size={13} /> {confirming ? '처리 중...' : !selected.id ? '저장 먼저' : !allChecked ? '항목 미완료' : !persistedComplete ? (isReadOnly ? '저장본 미완료' : '먼저 저장') : '관리자 확인'}
                    </button>
              )}
              {!isReadOnly && (
                <button onClick={handleSave} disabled={saving || !recordsReady || !templateReady || (!selected.id && records.some(row => row.checkDate === selected.checkDate && row.checkTime === selected.checkTime))}
                  className="flex items-center gap-1 px-3 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 disabled:opacity-50"
                >
                  <Save size={12} /> {saving ? '저장 중...' : '저장'}
                </button>
              )}
            </div>
          </div>

          {/* 인쇄 영역 */}
          <div ref={printRef} className="bg-white border border-slate-200 rounded-xl p-4 md:p-6" style={{ fontFamily: 'Malgun Gothic, sans-serif' }}>
            <h2 className="text-base md:text-lg font-black text-center mb-4">HACCP 작업장 위생점검표</h2>

            {/* 헤더 정보 — 2열(모바일) / 4열(데스크탑) */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-px border border-slate-300 rounded-lg overflow-hidden mb-4 text-xs">
              {[
                { label: '회사명',    value: '태백식품' },
                { label: '문서번호',  value: 'HACCP-PRP-001' },
                { label: '작성자',    value: selected.createdBy || (isReadOnly ? '-' : currentUser?.name ?? '-') },
                { label: '개정번호',  value: revLabel(selected) },
                { label: '점검일자',  value: selected.checkDate },
                { label: '점검시간',  value: slotLabel(selected.checkTime) },
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
                    : <input value={selected.checkZone}
                        onChange={e => editSelected(p => p ? { ...p, checkZone: e.target.value } : p)}
                        placeholder="구역 입력" className="w-full text-xs outline-none bg-transparent" />
                  }
                </div>
              </div>
            </div>

            {/* 점검 항목 */}
            <div className="text-xs font-bold mb-2">■ 작업장 위생 점검 항목</div>

            {/* 모바일 카드 */}
            <div className="flex flex-col gap-1.5 md:hidden">
              {templateItems.map((item, idx) => {
                const row = selected.rows[idx] ?? { result: '', note: '', inspector: '', author: '' };
                const needNote = row.result === 'fail' && !row.note.trim();
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
                    <th className={TH} style={{ width: 28 }}>No</th>
                    <th className={TH}>점검항목</th>
                    <th className={TH}>점검기준</th>
                    <th className={TH} style={{ width: 46 }}>적합</th>
                    <th className={TH} style={{ width: 46 }}>부적합</th>
                    <th className={TH} style={{ width: 80 }}>점검자</th>
                    <th className={TH}>비고사항(조치)</th>
                  </tr>
                </thead>
                <tbody>
                  {templateItems.map((item, idx) => {
                    const row = selected.rows[idx] ?? { result: '', note: '', inspector: '' };
                    const needNote = row.result === 'fail' && !row.note.trim();
                    return (
                      <tr key={idx} className={
                        row.result === 'pass' ? 'bg-emerald-50' :
                        row.result === 'fail' ? 'bg-rose-50' : ''
                      }>
                        <td className={TD}>{idx + 1}</td>
                        <td className={TDL}>{item.item}</td>
                        <td className={TDL}>{item.standard}</td>
                        <td className={TD}>
                          <input type="checkbox" checked={row.result === 'pass'}
                            onChange={() => toggleResult(idx, 'pass')} disabled={isReadOnly} />
                        </td>
                        <td className={TD}>
                          <input type="checkbox" checked={row.result === 'fail'}
                            onChange={() => toggleResult(idx, 'fail')} disabled={isReadOnly} />
                        </td>
                        <td className={TDL}>
                          {isReadOnly
                            ? row.inspector
                            : <input value={row.inspector} onChange={e => setRow(idx, 'inspector', e.target.value)}
                                placeholder={currentUser?.name ?? ''} className="w-full text-xs border-none outline-none bg-transparent" />
                          }
                        </td>
                        <td className={`${TDL} ${needNote ? 'bg-rose-100' : ''}`}>
                          {isReadOnly
                            ? row.note
                            : <input value={row.note} onChange={e => setRow(idx, 'note', e.target.value)}
                                className="w-full text-xs border-none outline-none bg-transparent"
                                placeholder={row.result === 'fail' ? '필수 입력' : '비고'} />
                          }
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 특이사항 및 개선조치 */}
            <div className="text-xs font-bold mb-1 mt-2">■ 특이사항 및 개선조치</div>
            {isReadOnly
              ? <div className="border border-slate-200 rounded-lg p-2 text-xs min-h-[60px] text-slate-700">{selected.specialNotes || '-'}</div>
              : <textarea value={selected.specialNotes}
                  onChange={e => editSelected(p => p ? { ...p, specialNotes: e.target.value } : p)}
                  rows={3} className="w-full border border-slate-300 rounded-lg p-2 text-xs resize-none"
                  placeholder="특이사항 및 개선조치 내용을 입력하세요" />
            }

            {/* 서명란 */}
            <div className="grid grid-cols-2 gap-3 mt-4 md:flex md:justify-end md:gap-4 text-xs">
              {/* 작성자 */}
              <div className="border border-slate-400 text-center md:w-28">
                <div className="bg-slate-100 text-xs font-bold py-1 border-b border-slate-400">작성자</div>
                <div className="h-10 flex items-center justify-center text-slate-700 font-semibold">
                  {selected.createdBy || (isReadOnly ? '-' : currentUser?.name ?? '')}
                </div>
              </div>
              {/* 수정자 (있을 때만) */}
              {selected.updatedBy && selected.updatedBy !== selected.createdBy && (
                <div className="border border-slate-400 text-center md:w-28">
                  <div className="bg-slate-100 text-xs font-bold py-1 border-b border-slate-400">수정자</div>
                  <div className="h-10 flex items-center justify-center text-slate-700 font-semibold">
                    {selected.updatedBy}
                  </div>
                </div>
              )}
              {/* 확인자 — 항상 표시 */}
              <div className="border border-slate-400 text-center md:w-28">
                <div className="bg-slate-100 text-xs font-bold py-1 border-b border-slate-400">확인자</div>
                <div className="h-10 flex items-center justify-center">
                  {selected.confirmedBy
                    ? <span className="text-slate-700 font-semibold">{selected.confirmedBy}</span>
                    : canConfirm && selected.id && allChecked && persistedComplete
                      ? <button
                          onClick={handleConfirm} title="확인 결과만 저장합니다. PDF는 별도 PDF 버튼에서 미리보고 저장합니다."
                          disabled={confirming || !recordsReady || !templateReady}
                          className="flex items-center gap-1 px-2 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 disabled:opacity-40"
                        >
                          <BadgeCheck size={11} /> {confirming ? '처리 중...' : '확인'}
                        </button>
                      : canConfirm && !selected.id
                        ? <span className="text-slate-300 text-[10px]">저장 후 확인</span>
                        : canConfirm && !allChecked
                          ? <span className="text-slate-300 text-[10px]">항목 완료 후</span>
                          : <span className="text-slate-200 text-xs">-</span>
                  }
                </div>
              </div>
            </div>

            {/* 이력 */}
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
    </fieldset>
  );
};
