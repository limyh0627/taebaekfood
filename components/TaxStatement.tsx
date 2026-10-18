import QueryFilterPanel, {QUERY_FILTER_LABEL_CLASS,QUERY_FILTER_CONTROL_CLASS, QUERY_FILTER_FIELD_CLASS, QUERY_FILTER_SEARCH_CLASS, QUERY_FILTER_DATE_CLASS } from '../src/shared/components/QueryFilterPanel';
import { appNotice } from '../src/shared/components/appDialog';
import { previewHtmlPrint } from '../src/shared/htmlPrintOutput';
import { previewRasterPdf, snapshotOutputElement } from '../src/shared/rasterPdfOutput';
import { useOutputScope } from '../src/shared/hooks/useOutputScope';

import React, { useState, useRef, useMemo, useEffect } from 'react';
import { today, dateOfLocal } from '../src/shared/day';
import { matchesSearch } from '../src/shared/hangul';
import {
  FileText, Printer, Search, Check, CheckSquare, Download, X,
  Receipt, Eye, Calendar, Building2, ChevronDown, ChevronUp, Edit2, Trash2, Package,
} from 'lucide-react';
import { Partner, IssuedStatement, CompanyInfo, CompanyId } from '../types';
import { mergeStatementItems, mergeAndSplit, type MergedItem } from '../src/shared/mergeStatementItems';
import { fetchDateRange } from '../src/shared/services/firebaseService';
import { where } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import PageHeader from './PageHeader';
import { vatOn } from '../src/shared/lineAmount';
import { formatQuantity } from '../src/shared/quantityDisplay';
import { companyOf } from '../src/shared/types';
import { 서류당사자스냅샷우선, type DocParty } from '../src/shared/docParty';
import type { TaxIssueScope } from '../src/features/tax-documents/domain/taxIssue';
import {auth} from '../src/shared/firebase';
import {getPendingTaxIssue,resumeTaxIssue,type TaxIssueCommand} from '../src/features/tax-documents/infrastructure/applyTaxIssueWrites';
import LargeModalShell from '../src/shared/components/LargeModalShell';
import { readTaxIssueHistory, type TaxIssueHistoryGroup } from '../src/features/tax-documents/infrastructure/taxIssueHistory';

interface TaxStatementProps {
  /** 보고 있는 회사 — 이 화면이 직접 떠오는 과거 전표도 걸러야 한다 */
  companyId?: CompanyId;
  issuedStatements: IssuedStatement[];
  partners: Partner[];
  companyInfo?: CompanyInfo | null;
  onApplyTaxIssue?: (input: { operationId: string; statements: IssuedStatement[]; scope: TaxIssueScope; issuedAt: string }) =>
    Promise<{ id: string; data: Partial<IssuedStatement> }[]>;
}

const fmt = (n: number) => n.toLocaleString('ko-KR');

const partyRows = (party: DocParty): Array<[string, string]> => [
  ['등록번호', party.bizNo],
  ['상    호', party.name],
  ['대 표 자', party.ceo],
  ['사업장주소', party.addr],
  ['업    태', party.bizType],
  ['종    목', party.bizItem],
  ['전화번호', party.tel],
  ['팩스번호', party.fax],
];

const TaxStatement: React.FC<TaxStatementProps> = ({
  companyId = 'taebaek',
  issuedStatements: liveStatements, partners,
  companyInfo,
  onApplyTaxIssue,
}) => {
  const [activeTab, setActiveTab] = useState<'issue' | 'history'>('issue');

  // 라이브 구독은 7일치만 → 과거 12개월치를 온디맨드로 추가 로드
  const historyGeneration = useRef(0);
  const historyRequestGeneration = useRef(0);
  const historyCompany = useRef(companyId);
  historyCompany.current = companyId;
  const [historyActor, setHistoryActor] = useState(() => ({uid:auth.currentUser?.uid??null,generation:0}));
  const historyActorUid = historyActor.uid;
  const [historyRetry, setHistoryRetry] = useState(0);
  const [historyState, setHistoryState] = useState<{companyId:CompanyId;actorUid:string;generation:number;rows:IssuedStatement[];error:string;loading:boolean}|null>(null);
  useEffect(() => onAuthStateChanged(auth, user => {historyGeneration.current++;historyRequestGeneration.current++;setHistoryActor({uid:user?.uid??null,generation:historyGeneration.current});}), []);
  useEffect(() => {
    const actorUid = historyActorUid;
    const generation = historyActor.generation;
    if (!actorUid || auth.currentUser?.uid !== actorUid || historyGeneration.current !== generation) return;
    const requestGeneration = ++historyRequestGeneration.current;
    let active = true;
    const isCurrent = () => active && historyCompany.current === companyId && auth.currentUser?.uid === actorUid && historyGeneration.current === generation && historyRequestGeneration.current === requestGeneration;
    setHistoryState(previous => ({companyId,actorUid,generation,rows:previous?.companyId===companyId&&previous.actorUid===actorUid&&previous.generation===generation?previous.rows:[],error:'',loading:true}));
    const to = today();
    const fromDate = new Date(); fromDate.setMonth(fromDate.getMonth() - 12);
    const from = dateOfLocal(fromDate.toISOString());
    fetchDateRange<IssuedStatement>('issuedStatements', 'tradeDate', from, to, [where('companyId', '==', companyId)])
      .then(data => { if (!isCurrent()) return; setHistoryState({companyId,actorUid,generation,error:'',loading:false,rows:data.map(s => ({
        ...s,
        items: s.items ?? [],
        tradeDate: s.tradeDate ?? '',
        issuedAt: s.issuedAt ?? '',
      }))}); })
      .catch(() => {if(isCurrent())setHistoryState(previous=>({companyId,actorUid,generation,rows:previous?.companyId===companyId&&previous.actorUid===actorUid&&previous.generation===generation?previous.rows:[],error:'과거 전표를 불러오지 못했습니다. 현재 제공된 전표만 표시합니다. 다시 불러와 주세요.',loading:false}));});
    return () => { active = false; };
  }, [companyId, historyActorUid, historyActor.generation, historyRetry]);
  const currentHistory = historyState?.companyId===companyId && historyState.actorUid===historyActorUid && historyState.generation===historyActor.generation && historyActor.generation===historyGeneration.current && historyActorUid===auth.currentUser?.uid ? historyState : null;
  const extraStatements = currentHistory?.rows ?? [];

  // 라이브(7일) + 과거(12개월) 병합 — id 기준 dedup, 라이브 우선
  // 회사로 한 번 더 거른다 — extraStatements는 이 화면이 직접 떠온 것이라 안 걸러져 있다
  const issuedStatements = useMemo(() => {
    const map = new Map<string, IssuedStatement>();
    extraStatements.forEach(s => map.set(s.id, s));
    liveStatements.forEach(s => map.set(s.id, s));
    return Array.from(map.values()).filter(s => companyOf(s) === companyId);
  }, [liveStatements, extraStatements, companyId]);
  const [issueHistory, setIssueHistory] = useState<{key:string;groups:TaxIssueHistoryGroup[];error:string;loading:boolean}|null>(null);
  const issueHistorySource = JSON.stringify(issuedStatements);
  const issueHistoryKey = JSON.stringify([companyId, historyActorUid, historyActor.generation, historyRetry, issueHistorySource]);
  useEffect(() => {
    if (activeTab !== 'history' || !historyActorUid || auth.currentUser?.uid !== historyActorUid) return;
    let active = true;
    const generation = historyActor.generation;
    const isCurrent = () => active && historyCompany.current === companyId && auth.currentUser?.uid === historyActorUid && historyGeneration.current === generation;
    setIssueHistory({key:issueHistoryKey,groups:[],error:'',loading:true});
    readTaxIssueHistory(companyId, JSON.parse(issueHistorySource), isCurrent)
      .then(result => { if (isCurrent()) setIssueHistory({key:issueHistoryKey,...result,loading:false}); })
      .catch(() => { if (isCurrent()) setIssueHistory({key:issueHistoryKey,groups:[],error:'발행 기록을 불러오지 못했습니다. 다시 불러와 주세요.',loading:false}); });
    return () => { active = false; };
  }, [activeTab, companyId, historyActorUid, historyActor.generation, issueHistoryKey, issueHistorySource]);
  const currentIssueHistory = issueHistory?.key === issueHistoryKey ? issueHistory : null;

  // ── 발행 탭 상태 ──
  const [selectedMonth, setSelectedMonth] = useState(() => today().slice(0, 7));
  const [onlyUnissued, setOnlyUnissued] = useState(false);
  const [taxClientId, setTaxClientId] = useState('');
  const [taxClientSearch, setTaxClientSearch] = useState('');
  const [taxStmtIds, setTaxStmtIds] = useState<string[]>([]);
  const taxPrintRef = useRef<HTMLDivElement>(null);
  const taxActorUid=auth.currentUser?.uid;
  const [taxPending,setTaxPending]=useState<TaxIssueCommand|null>(null);
  const [taxPendingError,setTaxPendingError]=useState('');
  const [taxBusy,setTaxBusy]=useState(false);
  const taxBusyRef=useRef(false);
  const taxScopeRef=useRef({companyId,uid:auth.currentUser?.uid,generation:historyActor.generation,token:{}});
  if(taxScopeRef.current.companyId!==companyId||taxScopeRef.current.uid!==auth.currentUser?.uid||taxScopeRef.current.generation!==historyActor.generation)taxScopeRef.current={companyId,uid:auth.currentUser?.uid,generation:historyActor.generation,token:{}};
  useEffect(()=>{
    const generation=historyActor.generation;
    if(historyGeneration.current!==generation)return;
    const read=()=>{if(historyGeneration.current!==generation)return;try{setTaxPending(getPendingTaxIssue(companyId));setTaxPendingError('');}catch(error){setTaxPendingError(error instanceof Error?error.message:'보존된 발행 요청을 확인해주세요.');}};
    taxBusyRef.current=false;setTaxBusy(false);read();window.addEventListener('tax-issue-pending',read);window.addEventListener('storage',read);
    return()=>{window.removeEventListener('tax-issue-pending',read);window.removeEventListener('storage',read);taxScopeRef.current={...taxScopeRef.current,token:{}};};
  },[companyId,taxActorUid,historyActor.generation]);

  // ── 발행 탭 편집 상태 ──
  const [editedItems, setEditedItems] = useState<MergedItem[]>([]);
  const editSession = useRef({ key: '', source: '', dirty: false });
  const [sourceChanged, setSourceChanged] = useState(false);

  // ── 조회 탭 상태 ──
  const [histClientId, setHistClientId] = useState('');
  const [histClientSearch, setHistClientSearch] = useState('');
  const [histPreviewGroupKey, setHistPreviewGroupKey] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // ── 발행 탭 로직 ──
  const allMonths = useMemo(() => {
    const s = new Set<string>();
    issuedStatements.filter(stmt => stmt.type === '매출').forEach(stmt => s.add(stmt.tradeDate.slice(0, 7)));
    return [...s].sort((a, b) => b.localeCompare(a));
  }, [issuedStatements]);

  const partnerIssuedCount = useMemo(() => {
    const map = new Map<string, number>();
    issuedStatements
      .filter(s => s.type === '매출' && s.tradeDate.slice(0, 7) === selectedMonth && !!s.taxIssuedAt)
      .forEach(s => { map.set(s.partnerId, (map.get(s.partnerId) ?? 0) + 1); });
    return map;
  }, [issuedStatements, selectedMonth]);

  const partnerUnissuedCount = useMemo(() => {
    const map = new Map<string, number>();
    issuedStatements
      .filter(s => s.type === '매출' && s.tradeDate.slice(0, 7) === selectedMonth && !s.taxIssuedAt)
      .forEach(s => { map.set(s.partnerId, (map.get(s.partnerId) ?? 0) + 1); });
    return map;
  }, [issuedStatements, selectedMonth]);

  const taxClients = useMemo(() => {
    const inMonth = new Set(
      issuedStatements.filter(s => s.type === '매출' && s.tradeDate.slice(0, 7) === selectedMonth).map(s => s.partnerId)
    );
    return partners
      .filter(c => inMonth.has(c.id))
      .filter(c => matchesSearch(c.name, taxClientSearch))
      .filter(c => !onlyUnissued || (partnerUnissuedCount.get(c.id) ?? 0) > 0)
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));   // 가나다순
  }, [partners, issuedStatements, selectedMonth, taxClientSearch, onlyUnissued, partnerUnissuedCount]);

  const partnerStmts = useMemo(() =>
    taxClientId
      ? issuedStatements
          .filter(s => s.partnerId === taxClientId && s.type === '매출' && s.tradeDate.slice(0, 7) === selectedMonth)
          .sort((a, b) => b.tradeDate.localeCompare(a.tradeDate))
      : [],
    [issuedStatements, taxClientId, selectedMonth]
  );

  const selectedStmts = useMemo(() => partnerStmts.filter(s => taxStmtIds.includes(s.id)), [partnerStmts, taxStmtIds]);

  //  합치는 셈은 [shared/mergeStatementItems](../src/shared/mergeStatementItems.ts) 한 곳이다
  const mergedFromStmts = useMemo(() => mergeStatementItems(selectedStmts), [selectedStmts]);

  // 데이터 로드 후 현재 월에 전표가 없으면 가장 최근 데이터 있는 월로 자동 이동
  useEffect(() => {
    if (allMonths.length > 0 && !allMonths.includes(selectedMonth)) {
      setSelectedMonth(allMonths[0]);
      setTaxClientId('');
      setTaxStmtIds([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allMonths]);

  // 선택 범위가 바뀌면 새 세션, 같은 원본 변경은 수동 편집 여부에 따라 처리한다.
  const editSessionKey = JSON.stringify([companyId, selectedMonth, taxClientId, taxStmtIds]);
  const sourceFingerprint = JSON.stringify(selectedStmts);
  useEffect(() => {
    if (editSession.current.key !== editSessionKey) {
      editSession.current = { key: editSessionKey, source: sourceFingerprint, dirty: false };
      setEditedItems(mergedFromStmts.map(item => ({ ...item })));
      setSourceChanged(false);
    } else if (editSession.current.source !== sourceFingerprint) {
      if (editSession.current.dirty) setSourceChanged(true);
      else {
        editSession.current.source = sourceFingerprint;
        setEditedItems(mergedFromStmts.map(item => ({ ...item })));
        setSourceChanged(false);
      }
    } else setSourceChanged(false);
  }, [editSessionKey, sourceFingerprint, mergedFromStmts]);
  const resetEditedItems = () => {
    editSession.current = { key: editSessionKey, source: sourceFingerprint, dirty: false };
    setEditedItems(mergedFromStmts.map(item => ({ ...item })));
    setSourceChanged(false);
  };

  const [taxScope, setTaxScope] = useState<'all' | 'taxable' | 'exempt'>('all');
  const taxSelectionScopeRef=useRef('');taxSelectionScopeRef.current=JSON.stringify([selectedMonth,taxClientId,taxScope]);
  const allItems2 = editedItems;
  /**
   * **과세분·면세분은 서류가 따로 나간다** — 세금계산서 / 계산서.
   * 위 두 상자를 눌러 어느 쪽을 찍을지 고른다. 고른 쪽만 미리보기·인쇄·PDF·발행에 담긴다.
   * 다시 누르면 둘 다(all)로 돌아간다.
   */
  const activeItems = taxScope === 'taxable' ? allItems2.filter(i => !i.isTaxExempt)
    : taxScope === 'exempt' ? allItems2.filter(i => i.isTaxExempt)
    : allItems2;
  const mergedItems = {
    taxable: allItems2.filter(i => !i.isTaxExempt),
    exempt: allItems2.filter(i => i.isTaxExempt),
  };
  const taxSupply = mergedItems.taxable.reduce((s, i) => s + i.supply, 0);
  const taxAmt = mergedItems.taxable.reduce((s, i) => s + i.tax, 0);
  const exemptSup = mergedItems.exempt.reduce((s, i) => s + i.supply, 0);
  const grandTotal = taxSupply + taxAmt + exemptSup;

  const updateEditedItem = (idx: number, field: keyof MergedItem, raw: string | number) => {
    editSession.current.dirty = true;
    setEditedItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      const next = { ...item, [field]: typeof raw === 'number' ? raw : (isNaN(Number(raw)) ? raw : Number(raw)) };
      if (field === 'qty' || field === 'supply') {
        const supply = field === 'supply' ? Number(raw) : next.supply;
        next.supply = supply;
        next.tax = vatOn(supply, next.isTaxExempt);
        next.total = supply + next.tax;
      }
      return next;
    }));
  };

  const toggleStmt = (id: string) =>
    setTaxStmtIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const toggleAll = () => {
    const ids = partnerStmts.map(s => s.id);
    const allSel = ids.every(id => taxStmtIds.includes(id));
    setTaxStmtIds(allSel ? [] : ids);
  };

  const selectedClient = partners.find(c => c.id === taxClientId);
  const tradeMonth = selectedStmts.length > 0 ? selectedStmts[selectedStmts.length - 1].tradeDate.slice(0, 7) : '';
  const issueSnapshot = selectedStmts.find(s => s.partySnapshot)?.partySnapshot;
  const issueParties = 서류당사자스냅샷우선(issueSnapshot, {
        isSale: true,
        companyInfo,
        partners,
        partnerId: taxClientId,
        partnerName: selectedClient?.name ?? partnerStmts[0]?.partnerName,
      });

  /**
   * 발행 표시 — **고른 쪽만** 찍는다.
   * 면세만 있는 전표는 taxIssuedAt도 같이 찍는다: 다른 화면(전표·재고)들이 그 칸 하나로
   * '발행됨'을 보기 때문에, 안 찍으면 영영 미발행으로 남는다.
   */
  const handleTaxIssue = async (resume=false) => {
    if(!resume&&selectedStmts.length>100){alert('한 번에 전표 100건까지 발행 결과를 기록할 수 있습니다.');return;}
    if(taxBusyRef.current||(!resume&&(sourceChanged||selectedStmts.length===0||!onApplyTaxIssue||taxPending||taxPendingError)))return;
    const token=taxScopeRef.current.token,uid=auth.currentUser?.uid,selectedIds=taxStmtIds,selectionScope=taxSelectionScopeRef.current;
    const issueHistoryGeneration=historyGeneration.current;
    const active=()=>taxScopeRef.current.token===token&&auth.currentUser?.uid===uid&&taxScopeRef.current.generation===issueHistoryGeneration&&historyGeneration.current===issueHistoryGeneration;
    if(!active())return;
    taxBusyRef.current=true;setTaxBusy(true);
    try {
      const patches=resume?await resumeTaxIssue(companyId):await onApplyTaxIssue!({operationId:`tax-${crypto.randomUUID()}`,statements:selectedStmts,scope:taxScope,issuedAt:new Date().toISOString()});
      if(!active())return;
      setHistoryState(previous=>{
        if(!previous||previous.companyId!==companyId||previous.actorUid!==uid||previous.generation!==issueHistoryGeneration||historyGeneration.current!==issueHistoryGeneration)return previous;
        return {...previous,rows:previous.rows.map(s=>{const patch=patches.find(p=>p.id===s.id);return patch&&(s.mutationRevision??0)<=(patch.data.mutationRevision??0)?{...s,...patch.data}:s;})};
      });
      setTaxStmtIds(current=>taxSelectionScopeRef.current===selectionScope&&JSON.stringify(current)===JSON.stringify(selectedIds)?[]:current);
    } catch(error){if(active())alert(error instanceof Error?error.message:'세금계산서 발행 기록을 저장하지 못했습니다.');}
    finally{if(active()){taxBusyRef.current=false;setTaxBusy(false);try{setTaxPending(getPendingTaxIssue(companyId));setTaxPendingError('');}catch(error){setTaxPendingError(error instanceof Error?error.message:'보존된 발행 요청을 확인해주세요.');}}}
  };

  const outputSignal = useOutputScope(companyId, JSON.stringify([activeTab, selectedMonth, taxClientId, taxStmtIds]));
  const handleTaxPdf = async () => {
    if (sourceChanged || !taxPrintRef.current || selectedStmts.length === 0) return;
    const signal = outputSignal(); if (signal.aborted) return;
    const snapshot = snapshotOutputElement(taxPrintRef.current);
    const fileName = `세금계산서_${selectedClient?.name}_${tradeMonth}.pdf`;
    try {
      const html2canvas = (await import('html2canvas')).default;
      if (signal.aborted) return;
      const canvas = await html2canvas(snapshot.element, { scale: 2, useCORS: true });
      if (signal.aborted) return;
      const imgW = 190, imgH = canvas.height * imgW / canvas.width;
      await previewRasterPdf({pages:[{width:210,height:297,draws:[{image:canvas.toDataURL('image/png'),x:10,y:imgH<297?(297-imgH)/2:10,width:imgW,height:imgH}]}],fileName,signal});
    } catch { if (!signal.aborted) await appNotice('PDF 미리보기를 준비하지 못했습니다. 내용을 확인한 뒤 다시 시도해 주세요.'); }
    finally { snapshot.dispose(); }
  };

  const handleTaxPrint = () => {
    if (sourceChanged || !taxPrintRef.current || selectedStmts.length === 0) return;
    const signal = outputSignal(); if (signal.aborted) return;
    void previewHtmlPrint({title:'세금계산서',signal,html:`<!DOCTYPE html><html><head><meta charset="utf-8"><title>세금계산서</title>
      <style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:'Malgun Gothic','맑은 고딕',sans-serif;font-size:10px;background:#fff;padding:12px;}
      .wrap{border:2px solid #000;width:100%;}.title-row{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #000;padding:6px 10px;}
      .title-row h1{font-size:18px;font-weight:900;letter-spacing:6px;}.info-grid{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid #000;}
      .info-box{padding:6px 8px;border-right:1px solid #000;}.info-box:last-child{border-right:none;}
      .info-box h3{font-size:9px;font-weight:900;color:#333;margin-bottom:4px;border-bottom:1px solid #eee;padding-bottom:2px;}
      .info-row{display:flex;gap:4px;margin-bottom:2px;font-size:9px;}.info-row label{color:#666;width:64px;}
      .items-table{width:100%;border-collapse:collapse;font-size:9px;}
      .items-table th{background:#f5f5f5;border:1px solid #ccc;padding:4px 6px;font-weight:900;text-align:center;}
      .items-table td{border:1px solid #ccc;padding:4px 6px;text-align:right;}.items-table td.left{text-align:left;}.items-table td.center{text-align:center;}
      .section-header{background:#e8f0fe;font-weight:900;font-size:9px;padding:3px 6px;border:1px solid #ccc;}
      .total-row{display:flex;justify-content:flex-end;gap:16px;padding:8px 10px;border-top:2px solid #000;font-size:11px;font-weight:900;}
      @media print{body{padding:0;}@page{margin:8mm;}}</style></head><body>${taxPrintRef.current.innerHTML}</body></html>`});
  };

  // ── 조회 탭 로직 ──
  const allHistGroups = currentIssueHistory?.groups ?? [];
  const issuedClients = useMemo(() =>
    partners
      .filter(c => allHistGroups.some(group => group.partnerId === c.id))
      .filter(c => matchesSearch(c.name, histClientSearch))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko')),   // 가나다순
    [partners, allHistGroups, histClientSearch]
  );

  const histStmts = useMemo(() =>
    allHistGroups.filter(group => !histClientId || group.partnerId === histClientId).flatMap(group => group.stmts),
    [allHistGroups, histClientId]
  );

  // ── 조회 탭 그룹핑 ──
  const histGroups = useMemo(() => allHistGroups.filter(group => !histClientId || group.partnerId === histClientId), [allHistGroups, histClientId]);

  // ── 미리보기용 그룹 ──
  const previewGroup = histPreviewGroupKey ? histGroups.find(g => g.key === histPreviewGroupKey && g.originalVerified) : null;
  const previewClient = previewGroup ? partners.find(c => c.id === previewGroup.partnerId) : null;
  const previewSnapshot = previewGroup?.stmts.find(s => s.partySnapshot)?.partySnapshot;
  const previewParties = 서류당사자스냅샷우선(previewSnapshot, {
        isSale: true,
        companyInfo,
        partners,
        partnerId: previewGroup?.partnerId,
        partnerName: previewClient?.name ?? previewGroup?.partnerName,
      });
  const previewMerged = useMemo(
    () => (previewGroup ? mergeAndSplit(previewGroup.stmts) : { taxable: [], exempt: [] }),
    [previewGroup]);
  const previewPrintRef = useRef<HTMLDivElement>(null);

  const historyOutputSignal = useOutputScope(companyId, JSON.stringify([activeTab, selectedMonth, histClientId, histPreviewGroupKey]));
  const handleHistPrint = () => {
    if (!previewPrintRef.current) return;
    const signal = historyOutputSignal(); if (signal.aborted) return;
    void previewHtmlPrint({title:'세금계산서',signal,html:`<!DOCTYPE html><html><head><meta charset="utf-8"><title>세금계산서</title>
      <style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:'Malgun Gothic','맑은 고딕',sans-serif;font-size:10px;background:#fff;padding:12px;}
      table{border-collapse:collapse;width:100%;}th,td{border:1px solid #ccc;padding:5px 8px;}th{background:#f5f5f5;font-weight:900;text-align:center;}
      @media print{body{padding:0;}@page{margin:8mm;}}</style></head><body>${previewPrintRef.current.innerHTML}</body></html>`});
  };

  const handleHistPdf = async () => {
    if (!previewPrintRef.current || !previewGroup) return;
    const signal = historyOutputSignal(); if (signal.aborted) return;
    const snapshot = snapshotOutputElement(previewPrintRef.current);
    const fileName = `세금계산서_${previewClient?.name}_${previewGroup.stmts[0].tradeDate.slice(0, 7)}.pdf`;
    try {
      const html2canvas = (await import('html2canvas')).default;
      if (signal.aborted) return;
      const canvas = await html2canvas(snapshot.element, { scale: 2, useCORS: true });
      if (signal.aborted) return;
      const imgW = 190, imgH = canvas.height * imgW / canvas.width;
      await previewRasterPdf({pages:[{width:210,height:297,draws:[{image:canvas.toDataURL('image/png'),x:10,y:imgH<297?(297-imgH)/2:10,width:imgW,height:imgH}]}],fileName,signal});
    } catch { if (!signal.aborted) await appNotice('PDF 미리보기를 준비하지 못했습니다. 내용을 확인한 뒤 다시 시도해 주세요.'); }
    finally { snapshot.dispose(); }
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="세금계산서"
        subtitle="발행된 세금계산서를 조회하거나 새로 발행합니다."
        tabs={
          <div className="flex flex-wrap gap-1">
            {([
              { id: 'issue' as const, icon: Receipt, label: '발행' },
              { id: 'history' as const, icon: Eye, label: '조회' },
            ]).map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                className={`flex items-center h-9 gap-1.5 px-3 rounded-lg text-xs font-bold transition-all ${activeTab === t.id ? 'bg-white border border-indigo-300 text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}>
                <t.icon size={13}/>{t.label}
              </button>
            ))}
          </div>
        }
        recovery={(currentHistory?.error||selectedStmts.length>100||taxPending||taxPendingError)?<>
{currentHistory?.error && <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-slate-200 py-2 text-sm">
        <span>{currentHistory.error}</span>
        <button type="button" disabled={currentHistory.loading} onClick={()=>{historyRequestGeneration.current++;setHistoryRetry(value=>value+1);}} className="rounded border border-slate-300 px-3 py-1">과거 전표 다시 불러오기</button>
      </div>}

      {selectedStmts.length>100&&<p role="alert" className="text-sm text-amber-700">한 번에 전표 100건까지 발행 결과를 기록할 수 있습니다. 선택을 줄여주세요.</p>}
      {(taxPending||taxPendingError)&&<div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
        {taxPendingError||`발행 결과 확인이 필요합니다. 전표 ${taxPending!.statements.length}건 · ${taxPending!.scope==='all'?'과세·면세':taxPending!.scope==='taxable'?'과세':'면세'} · ${dateOfLocal(taxPending!.issuedAt)}`}
        {taxPending&&!taxPendingError&&<button disabled={taxBusy} onClick={()=>void handleTaxIssue(true)} className="ml-3 rounded-lg bg-amber-700 px-3 py-2 font-bold text-white">이전 발행 결과 확인</button>}
      </div>}
        </>:undefined}
      />

      {/* ── 발행 탭 ── */}
      {activeTab === 'issue' && (
        <div className="flex flex-col lg:flex-row gap-4 lg:items-start">
          {/* 좌측: 월 선택 + 거래처 */}
          <div className="w-full lg:w-64 lg:shrink-0 flex flex-col gap-3">
          <QueryFilterPanel id="tax-issue-query-title" onReset={() => { setSelectedMonth(today().slice(0,7)); setTaxClientId(''); setTaxStmtIds([]); setTaxClientSearch(''); setOnlyUnissued(false); }} dateRow={<>
<div className={QUERY_FILTER_FIELD_CLASS}>
              <label htmlFor="tax-issue-month" className={QUERY_FILTER_LABEL_CLASS}>발행 월</label>
              <select
                id="tax-issue-month" value={selectedMonth}
                onChange={e => { setSelectedMonth(e.target.value); setTaxClientId(''); setTaxStmtIds([]); }}
                className={`${QUERY_FILTER_CONTROL_CLASS} w-full`}
              >
                {(() => {
                  const currentYm = today().slice(0, 7);
                  const opts = allMonths.includes(currentYm) ? allMonths : [currentYm, ...allMonths];
                  return opts.map(ym => (
                    <option key={ym} value={ym}>{ym.replace('-', '년 ')}월</option>
                  ));
                })()}
              </select>
            </div>
</>} searchRow={<>
<div className={QUERY_FILTER_SEARCH_CLASS + ' sm:!min-w-0 max-w-full'}>
                <p className="text-[10px] font-bold text-slate-500">거래처</p>
                <div className="relative">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none"/>
                  <input aria-label="발행 거래처 검색" type="text" placeholder="거래처 검색..." value={taxClientSearch}
                    onChange={e => setTaxClientSearch(e.target.value)}
                    className={(`${QUERY_FILTER_CONTROL_CLASS} w-full !pl-7 !pr-2`) + ' w-full min-w-0 max-w-full'}/>
                </div>
                <button
                  onClick={() => setOnlyUnissued(p => !p)}
                  className={`w-full h-9 flex items-center justify-center gap-1.5 rounded-lg text-[11px] font-black transition-all ${onlyUnissued ? 'bg-rose-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                >
                  미발행 거래처만 보기
                </button>
              </div>
</>} />
            <div className="bg-white rounded-lg border border-slate-200 flex flex-col overflow-hidden max-h-[calc(100vh-260px)]">
              <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
                {taxClients.map(c => {
                  const issued = partnerIssuedCount.get(c.id) ?? 0;
                  const unissued = partnerUnissuedCount.get(c.id) ?? 0;
                  return (
                    <button key={c.id} onClick={() => { setTaxClientId(c.id); setTaxStmtIds([]); }}
                      className={`w-full text-left px-3 py-2.5 transition-all hover:bg-emerald-50 ${taxClientId === c.id ? 'bg-emerald-50 border-r-2 border-emerald-500' : ''}`}>
                      <span className={`text-xs font-black block ${taxClientId === c.id ? 'text-emerald-700' : 'text-slate-700'}`}>{c.name}</span>
                      <div className="flex items-center gap-2 mt-0.5">
                        {issued > 0 && (
                          <span className="text-[10px] font-black text-amber-500">발행 {issued}건</span>
                        )}
                        {unissued > 0 && (
                          <span className="text-[10px] font-black text-rose-500">미발행 {unissued}건</span>
                        )}
                      </div>
                    </button>
                  );
                })}
                {taxClients.length === 0 && (
                  <p className="px-3 py-6 text-center text-xs text-slate-400">해당 월 거래처 없음</p>
                )}
              </div>
            </div>
          </div>

          {/* 우측: 전표 목록 + 미리보기 */}
          <div className="flex-1 flex flex-col gap-3 min-w-0">
            {!taxClientId ? (
              <div className="flex flex-col items-center justify-center h-full bg-white rounded-2xl border border-dashed border-slate-200 py-20">
                <FileText size={36} className="text-slate-200 mb-3"/>
                <p className="text-slate-400 text-sm font-bold">거래처를 선택하세요</p>
              </div>
            ) : (<>
              {/* 서류와 같은 공용 변환값을 보여준다 — 여기서 따로 적으면 거래처를 바꿀 때 값이 섞였다 */}
              <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">공급받는자 정보 (거래처관리 기준)</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {partyRows(issueParties.buy).map(([label, value]) => (
                    <div key={label}>
                      <span className="text-[10px] font-black text-slate-400 uppercase block mb-1">{label.replaceAll(' ', '')}</span>
                      <span className="block min-h-7 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-700">
                        {value || '미등록'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 전표 선택 */}
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-2 bg-slate-50 border-b border-slate-100">
                  <button onClick={toggleAll}
                    className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all shrink-0 ${
                      partnerStmts.length > 0 && partnerStmts.every(s => taxStmtIds.includes(s.id))
                        ? 'bg-emerald-600 border-emerald-600'
                        : partnerStmts.some(s => taxStmtIds.includes(s.id))
                          ? 'bg-emerald-200 border-emerald-400'
                          : 'border-slate-300'
                    }`}>
                    {partnerStmts.some(s => taxStmtIds.includes(s.id)) && <CheckSquare size={10} className="text-white"/>}
                  </button>
                  <span className="text-[11px] font-black text-slate-700">{selectedMonth.replace('-', '년 ')}월</span>
                  <span className="text-[10px] text-slate-400">{partnerStmts.length}건</span>
                  <span className="ml-auto text-[11px] font-black text-slate-600">{fmt(partnerStmts.reduce((s, r) => s + r.totalAmount, 0))}원</span>
                </div>
                {partnerStmts.map(s => {
                  const isSel = taxStmtIds.includes(s.id);
                  const isIssued = !!s.taxIssuedAt;
                  return (
                    <button key={s.id} onClick={() => toggleStmt(s.id)}
                      className={`w-full flex items-center gap-3 px-4 py-3.5 border-b border-slate-50 text-left transition-all ${isSel ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}>
                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-all ${isSel ? 'bg-emerald-600 border-emerald-600' : 'border-slate-300'}`}>
                        {isSel && <CheckSquare size={12} className="text-white"/>}
                      </div>
                      <span className="text-sm font-black text-slate-700 shrink-0">{s.tradeDate}</span>
                      <span className="text-[11px] text-slate-400 font-mono shrink-0">{s.docNo}</span>
                      <span className="text-xs text-slate-400 flex-1 truncate">
                        {s.items.slice(0,2).map(i=>i.name).join(', ')}{s.items.length>2?` 외 ${s.items.length-2}건`:''}
                      </span>
                      {isIssued
                        ? <span className="text-[10px] font-black bg-amber-100 text-amber-600 px-2 py-0.5 rounded-full shrink-0">발행</span>
                        : <span className="text-[10px] font-black bg-rose-100 text-rose-500 px-2 py-0.5 rounded-full shrink-0">미발행</span>
                      }
                      <span className={`text-sm font-black shrink-0 ${isSel ? 'text-emerald-700' : 'text-slate-700'}`}>{fmt(s.totalAmount)}원</span>
                    </button>
                  );
                })}
                {partnerStmts.length === 0 && (
                  <div className="py-10 text-center text-slate-400 text-sm">해당 월 전표 없음</div>
                )}
              </div>

              {/* 미리보기 */}
              {taxStmtIds.length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">세금계산서 미리보기</span>
                      <span className="text-[11px] font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">{taxStmtIds.length}건</span>
                    </div>
                    <div className="flex gap-1.5">
                      <button disabled={sourceChanged||taxBusy||!!taxPending||!!taxPendingError||selectedStmts.length>100} onClick={()=>void handleTaxIssue()}
                        className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[11px] font-black hover:bg-emerald-700">
                        <Check size={11}/>{taxScope === 'taxable' ? '과세분 발행' : taxScope === 'exempt' ? '면세분 발행' : '발행'}
                      </button>
                      <button disabled={sourceChanged} onClick={handleTaxPdf}
                        className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-[11px] font-black hover:bg-blue-700">
                        <Download size={11}/>PDF
                      </button>
                      <button disabled={sourceChanged} onClick={handleTaxPrint}
                        className="flex items-center gap-1 px-3 py-1.5 bg-slate-700 text-white rounded-lg text-[11px] font-black hover:bg-slate-700">
                        <Printer size={11}/>인쇄
                      </button>
                    </div>
                  </div>
                  <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap gap-4">
                    {mergedItems.taxable.length > 0 && (
                      <button type="button" onClick={() => setTaxScope(v => v === 'taxable' ? 'all' : 'taxable')}
                        title="과세분만 찍기 — 다시 누르면 둘 다"
                        className={`flex items-center gap-3 rounded-xl px-4 py-2.5 border transition-all ${
                          taxScope === 'taxable' ? 'bg-blue-100 border-blue-400 ring-2 ring-blue-300' : 'bg-blue-50 border-blue-100 hover:border-blue-300'}`}>
                        <span className="text-[11px] font-black text-blue-600">과세</span>
                        <span className="text-xs text-slate-600">공급가 <b className="text-slate-900">{fmt(taxSupply)}</b></span>
                        <span className="text-xs text-slate-600">세액 <b className="text-slate-900">{fmt(taxAmt)}</b></span>
                        <span className="text-sm font-black text-blue-700">{fmt(taxSupply+taxAmt)}원</span>
                      </button>
                    )}
                    {mergedItems.exempt.length > 0 && (
                      <button type="button" onClick={() => setTaxScope(v => v === 'exempt' ? 'all' : 'exempt')}
                        title="면세분만 찍기 — 다시 누르면 둘 다"
                        className={`flex items-center gap-3 rounded-xl px-4 py-2.5 border transition-all ${
                          taxScope === 'exempt' ? 'bg-indigo-100 border-indigo-400 ring-2 ring-indigo-300' : 'bg-indigo-50 border-indigo-100 hover:border-indigo-300'}`}>
                        <span className="text-[11px] font-black text-indigo-600">면세</span>
                        <span className="text-xs text-slate-600">공급가 <b className="text-slate-900">{fmt(exemptSup)}</b></span>
                        <span className="text-sm font-black text-indigo-700">{fmt(exemptSup)}원</span>
                      </button>
                    )}
                    <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-2.5 ml-auto">
                      <span className="text-[11px] font-black text-emerald-600">합계</span>
                      <span className="text-lg font-black text-emerald-700">{fmt(grandTotal)}원</span>
                    </div>
                  </div>
                  {sourceChanged && <p role="alert" className="px-4 py-2 text-sm text-amber-700">원본 전표가 변경되었습니다. 편집 내용을 확인하고 초기화하면 최신 원본으로 다시 시작합니다.</p>}
                  {/* 품목 편집 테이블 */}
                  <div className="px-4 py-3 border-b border-slate-100">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5"><Edit2 size={11}/>품목 직접 편집</span>
                      <button onClick={resetEditedItems}
                        className="text-[10px] text-slate-400 hover:text-slate-600 underline">초기화</button>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left" style={{fontSize:'11px'}}>
                        <thead><tr className="bg-slate-50">
                          {['품목명','규격','수량','공급가액','세액','합계',''].map(h => (
                            <th key={h} className="px-2 py-1.5 font-black text-slate-400 text-[10px] uppercase">{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {activeItems.map((item, idx) => (
                            <tr key={idx} className={item.isTaxExempt ? 'bg-indigo-50/40' : 'bg-blue-50/30'}>
                              <td className="px-1 py-1 whitespace-nowrap">
                                <input value={item.name} onChange={e => updateEditedItem(idx, 'name', e.target.value)}
                                  className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs font-bold outline-none focus:ring-1 focus:ring-emerald-300"/>
                              </td>
                              <td className="px-1 py-1 whitespace-nowrap">
                                <input value={item.spec} onChange={e => updateEditedItem(idx, 'spec', e.target.value)}
                                  className="w-20 bg-white border border-slate-200 rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-emerald-300"/>
                              </td>
                              <td className="px-1 py-1 whitespace-nowrap">
                                <input type="number" value={item.qty} onChange={e => updateEditedItem(idx, 'qty', e.target.value)}
                                  className="w-16 bg-white border border-slate-200 rounded px-2 py-1 text-xs text-right outline-none focus:ring-1 focus:ring-emerald-300"/>
                              </td>
                              <td className="px-1 py-1 whitespace-nowrap">
                                <input type="number" value={item.supply} onChange={e => updateEditedItem(idx, 'supply', e.target.value)}
                                  className="w-24 bg-white border border-slate-200 rounded px-2 py-1 text-xs text-right outline-none focus:ring-1 focus:ring-emerald-300"/>
                              </td>
                              <td className="px-2 py-1 text-xs text-right text-slate-500">{item.isTaxExempt ? '면세' : fmt(item.tax)}</td>
                              <td className="px-2 py-1 text-xs text-right font-black text-slate-700">{fmt(item.total)}</td>
                              <td className="px-1 py-1 whitespace-nowrap">
                                <button onClick={() => { editSession.current.dirty = true; setEditedItems(prev => prev.filter((_, i) => i !== idx)); }}
                                  className="p-1 text-slate-300 hover:text-rose-400 transition-colors"><Trash2 size={11}/></button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="p-4 overflow-x-auto">
                    <div ref={taxPrintRef}>
                      <div className="wrap border-2 border-black" style={{fontFamily:"'Malgun Gothic','맑은 고딕',sans-serif",minWidth:760,fontSize:'13px'}}>
                        <div className="flex items-center justify-between border-b-2 border-black px-4 py-3">
                          <h1 style={{fontSize:'22px',fontWeight:900,letterSpacing:'6px'}}>세 금 계 산 서</h1>
                          <div className="text-right" style={{fontSize:'10px',color:'#666'}}>
                            <div>거래처: {selectedClient?.name}</div>
                            <div>발행기간: {tradeMonth}</div>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 border-b border-black">
                          <div className="p-3 border-r border-black">
                            <h3 style={{fontSize:'10px',fontWeight:900,marginBottom:'6px',paddingBottom:'4px',borderBottom:'1px solid #eee',color:'#444'}}>공 급 자</h3>
                            {partyRows(issueParties.sup).map(([label, value]) => (
                              <div key={label} style={{display:'flex',gap:'8px',marginBottom:'3px',fontSize:'10px'}}>
                                <span style={{color:'#666',width:'60px',flexShrink:0}}>{label}</span>
                                <span style={{fontWeight:700}}>{value}</span>
                              </div>
                            ))}
                          </div>
                          <div className="p-3">
                            <h3 style={{fontSize:'10px',fontWeight:900,marginBottom:'6px',paddingBottom:'4px',borderBottom:'1px solid #eee',color:'#444'}}>공급받는자</h3>
                            {partyRows(issueParties.buy).map(([label, value]) => (
                              <div key={label} style={{display:'flex',gap:'8px',marginBottom:'3px',fontSize:'10px'}}>
                                <span style={{color:'#666',width:'60px',flexShrink:0}}>{label}</span>
                                <span style={{fontWeight:700}}>{value}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <table style={{width:'100%',borderCollapse:'collapse',fontSize:'11px'}}>
                          <thead>
                            <tr>{['품목','규격','수량','공급가액','세액','합계'].map(h => (
                              <th key={h} style={{border:'1px solid #ccc',background:'#f5f5f5',padding:'6px 8px',fontWeight:900,textAlign:'center'}}>{h}</th>
                            ))}</tr>
                          </thead>
                          <tbody>
                            {mergedItems.taxable.length > 0 && (<>
                              <tr><td colSpan={6} style={{padding:'4px 8px',background:'#dbeafe',fontWeight:900,color:'#1d4ed8',border:'1px solid #ccc',fontSize:'10px'}}>▶ 과세 품목</td></tr>
                              {mergedItems.taxable.map((item, i) => (
                                <tr key={i}>
                                  <td style={{border:'1px solid #ccc',padding:'5px 8px',fontWeight:700}}>{item.name}</td>
                                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'center'}}>{item.spec}</td>
                                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',overflowWrap:'anywhere'}}>{formatQuantity(item.qty)}</td>
                                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right'}}>{fmt(item.supply)}</td>
                                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right'}}>{fmt(item.tax)}</td>
                                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900}}>{fmt(item.total)}</td>
                                </tr>
                              ))}
                              <tr style={{background:'#eff6ff'}}>
                                <td colSpan={3} style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900,color:'#1d4ed8'}}>과세 소계</td>
                                <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900,color:'#1d4ed8'}}>{fmt(taxSupply)}</td>
                                <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900,color:'#1d4ed8'}}>{fmt(taxAmt)}</td>
                                <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900,color:'#1d4ed8'}}>{fmt(taxSupply+taxAmt)}</td>
                              </tr>
                            </>)}
                            {mergedItems.exempt.length > 0 && (<>
                              <tr><td colSpan={6} style={{padding:'4px 8px',background:'#e0e7ff',fontWeight:900,color:'#4338ca',border:'1px solid #ccc',fontSize:'10px'}}>▶ 면세 품목</td></tr>
                              {mergedItems.exempt.map((item, i) => (
                                <tr key={i}>
                                  <td style={{border:'1px solid #ccc',padding:'5px 8px',fontWeight:700}}>{item.name}</td>
                                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'center'}}>{item.spec}</td>
                                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',overflowWrap:'anywhere'}}>{formatQuantity(item.qty)}</td>
                                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right'}}>{fmt(item.supply)}</td>
                                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'center',color:'#666'}}>면세</td>
                                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900}}>{fmt(item.supply)}</td>
                                </tr>
                              ))}
                              <tr style={{background:'#eef2ff'}}>
                                <td colSpan={3} style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900,color:'#4338ca'}}>면세 소계</td>
                                <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900,color:'#4338ca'}}>{fmt(exemptSup)}</td>
                                <td style={{border:'1px solid #ccc',padding:'5px 8px'}}/>
                                <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900,color:'#4338ca'}}>{fmt(exemptSup)}</td>
                              </tr>
                            </>)}
                            <tr style={{background:'#f1f5f9'}}>
                              <td colSpan={3} style={{border:'1px solid #ccc',padding:'7px 8px',textAlign:'right',fontWeight:900,fontSize:'12px'}}>합 계</td>
                              <td style={{border:'1px solid #ccc',padding:'7px 8px',textAlign:'right',fontWeight:900}}>{fmt(taxSupply+exemptSup)}</td>
                              <td style={{border:'1px solid #ccc',padding:'7px 8px',textAlign:'right',fontWeight:900}}>{fmt(taxAmt)}</td>
                              <td style={{border:'1px solid #ccc',padding:'7px 8px',textAlign:'right',fontWeight:900,color:'#059669',fontSize:'13px'}}>{fmt(grandTotal)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>)}
          </div>
        </div>
      )}

      {/* ── 조회 탭 ── */}
      {activeTab === 'history' && (
        <div className="flex flex-col lg:flex-row gap-4 lg:items-start">
          {/* 좌측: 거래처 필터 */}
          <div className="w-full lg:w-56 lg:shrink-0 flex flex-col gap-3 lg:sticky lg:top-0">
            <QueryFilterPanel ariaLabel="세금계산서 조회 검색조건" onReset={() => setHistClientSearch('')} searchRow={<>
<div className={QUERY_FILTER_SEARCH_CLASS + ' sm:!min-w-0 max-w-full'}>
                <p className={QUERY_FILTER_LABEL_CLASS}>발행 거래처</p>
                <div className="relative">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none"/>
                  <input aria-label="조회 거래처 검색" type="text" placeholder="거래처 검색..." value={histClientSearch}
                    onChange={e => setHistClientSearch(e.target.value)}
                    className={(`${QUERY_FILTER_CONTROL_CLASS} w-full !pl-7 !pr-2`) + ' w-full min-w-0 max-w-full'}/>
                </div>
              </div>
</>} />
            <div className="bg-white rounded-lg border border-slate-200 flex flex-col overflow-hidden" style={{maxHeight:400}}>
              <div className="overflow-y-auto divide-y divide-slate-50 max-h-[calc(100vh-260px)]">
                <button onClick={() => { setHistClientId(''); setHistPreviewGroupKey(null); }}
                  className={`w-full text-left px-3 py-2.5 transition-all hover:bg-emerald-50 ${!histClientId ? 'bg-emerald-50 border-r-2 border-emerald-500' : ''}`}>
                  <span className={`text-xs font-black ${!histClientId ? 'text-emerald-700' : 'text-slate-500'}`}>전체 거래처</span>
                </button>
                {issuedClients.map(c => (
                  <button key={c.id} onClick={() => { setHistClientId(c.id); setHistPreviewGroupKey(null); }}
                    className={`w-full text-left px-3 py-2.5 transition-all hover:bg-emerald-50 ${histClientId === c.id ? 'bg-emerald-50 border-r-2 border-emerald-500' : ''}`}>
                    <span className={`text-xs font-black ${histClientId === c.id ? 'text-emerald-700' : 'text-slate-700'}`}>{c.name}</span>
                  </button>
                ))}
                {issuedClients.length === 0 && (
                  <p className="px-3 py-4 text-[11px] text-slate-400 text-center">발행된 세금계산서 없음</p>
                )}
              </div>
            </div>
            {/* 요약 */}
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 space-y-1">
              <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest">발행 현황</p>
              <p className="text-xs text-slate-600">총 <b>{histGroups.length}</b>건 ({histStmts.length}매)</p>
              <p className="text-sm font-black text-amber-700">{fmt(histGroups.reduce((s, r) => s + r.totalAmount, 0))}원</p>
            </div>
          </div>

          {/* 우측: 발행 목록 + 상세 */}
          <div className="flex-1 flex flex-col lg:flex-row gap-4 min-w-0">
            {/* 목록 */}
            <div className="flex-1 flex flex-col gap-2 min-w-0">
              <p className="text-xs text-slate-500">현재 조회 전표에 연결된 발행 기록 · 원본 확인 필요 항목의 금액은 현재 전표 참고값입니다.</p>
              {currentIssueHistory?.loading && <p role="status" className="text-xs text-slate-500">발행 기록을 불러오는 중입니다.</p>}
              {currentIssueHistory?.error && <p role="alert" className="text-xs text-slate-600">{currentIssueHistory.error} <button type="button" onClick={() => setHistoryRetry(value => value + 1)} className="underline">발행 기록 다시 불러오기</button></p>}
              {histGroups.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full bg-white rounded-2xl border border-dashed border-slate-200 py-20">
                  <Receipt size={36} className="text-slate-200 mb-3"/>
                  <p className="text-slate-400 text-sm font-bold">{currentIssueHistory?.loading ? '발행 기록 확인 중' : currentIssueHistory?.error ? '발행 기록 조회를 완료하지 못했습니다' : '발행된 세금계산서가 없습니다'}</p>
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
                  <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 grid grid-cols-[minmax(150px,1fr)_100px_100px_120px_80px] gap-3 min-w-[580px]">
                    <span className="text-[10px] font-black text-slate-400 uppercase">거래처 / 전표</span>
                    <span className="text-[10px] font-black text-slate-400 uppercase text-center">거래기간</span>
                    <span className="text-[10px] font-black text-slate-400 uppercase text-center">발행일</span>
                    <span className="text-[10px] font-black text-slate-400 uppercase text-right">합계금액</span>
                    <span className="text-[10px] font-black text-slate-400 uppercase text-center">보기</span>
                  </div>
                  {histGroups.map(group => {
                    const cl = partners.find(c => c.id === group.partnerId);
                    const isSelected = histPreviewGroupKey === group.key;
                    const isExpanded = expandedGroups.has(group.key);
                    const tradeDates = group.stmts.map(s => s.tradeDate).sort();
                    const dateRange = tradeDates.length === 1
                      ? tradeDates[0].slice(5)
                      : `${tradeDates[0].slice(5)}~${tradeDates[tradeDates.length-1].slice(5)}`;
                    return (
                      <div key={group.key}>
                        <div className={`grid grid-cols-[minmax(150px,1fr)_100px_100px_120px_80px] min-w-[580px] gap-3 items-center px-4 py-3.5 border-b border-slate-50 transition-all min-w-[580px] ${isSelected ? 'bg-amber-50' : 'hover:bg-slate-50'}`}>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <Building2 size={13} className="text-slate-400 shrink-0"/>
                              <span className="text-sm font-black text-slate-800">{cl?.name ?? group.partnerName ?? '-'}</span>
                              <span className="text-[10px] font-black bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full">{group.originalVerified ? '발행완료' : '원본 확인 필요'}</span>
                              <span className="text-[10px] text-slate-500">{group.kind === 'taxable' ? '과세' : group.kind === 'exempt' ? '면세' : '과거 발행 표시'}</span>
                              {group.isBundle && (
                                <span className="text-[10px] font-black bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                  <Package size={8}/>묶음 {group.stmts.length}건
                                </span>
                              )}
                            </div>
                            {group.isBundle ? (
                              <button
                                onClick={() => setExpandedGroups(prev => {
                                  const next = new Set(prev);
                                  next.has(group.key) ? next.delete(group.key) : next.add(group.key);
                                  return next;
                                })}
                                className="text-[10px] text-violet-500 mt-0.5 ml-4 flex items-center gap-0.5 hover:underline">
                                {isExpanded ? <ChevronUp size={10}/> : <ChevronDown size={10}/>}
                                {isExpanded ? '접기' : '전표 펼치기'}
                              </button>
                            ) : (
                              <div className="text-[10px] text-slate-400 mt-0.5 ml-4">
                                {group.stmts[0].docNo} · {group.stmts[0].items.slice(0,2).map(i=>i.name).join(', ')}{group.stmts[0].items.length>2?` 외 ${group.stmts[0].items.length-2}건`:''}
                              </div>
                            )}
                            {group.notice && <p className="text-xs text-slate-500 mt-1">{group.notice}</p>}
                          </div>
                          <span className="text-xs text-slate-600 text-center">{dateRange}</span>
                          <span className="text-xs text-slate-600 text-center">{dateOfLocal(group.issuedAt)}</span>
                          <span className="text-sm font-black text-slate-800 text-right">{fmt(group.totalAmount)}</span>
                          <div className="flex justify-center">
                            <button disabled={!group.originalVerified} title={group.notice || '최초 발행 원문 보기'} aria-label={group.originalVerified ? '최초 발행 원문 보기' : '원본 확인 필요'} onClick={() => setHistPreviewGroupKey(isSelected ? null : group.key)}
                              className={`p-2 rounded-lg transition-all ${isSelected ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                              <Eye size={15}/>
                            </button>
                          </div>
                        </div>
                        {/* 묶음 펼치기 - 개별 전표 */}
                        {group.isBundle && isExpanded && group.stmts.map(s => (
                          <div key={s.id} className="grid grid-cols-[minmax(150px,1fr)_100px_100px_120px_80px] min-w-[580px] gap-3 items-center px-4 py-2 border-b border-slate-50 bg-violet-50/60 pl-10 min-w-[580px]">
                            <div className="text-[10px] text-slate-500">
                              {s.docNo} · {s.items.slice(0,2).map(i=>i.name).join(', ')}{s.items.length>2?` 외 ${s.items.length-2}건`:''}
                            </div>
                            <span className="text-[10px] text-slate-500 text-center">{s.tradeDate.slice(5)}</span>
                            <span className="text-[10px] text-slate-400 text-center">-</span>
                            <span className="text-[11px] font-black text-slate-600 text-right">{fmt(s.totalAmount)}</span>
                            <div/>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>
        </div>
      )}

      {/* ── 조회 탭 미리보기 오버레이 ── */}
      {previewGroup && (
        <LargeModalShell title={`세금계산서 미리보기${previewClient?.name ? ` — ${previewClient.name}` : ''}`} onClose={() => setHistPreviewGroupKey(null)} bodyClassName="!p-0">
            {/* 오버레이 헤더 */}
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                {previewGroup.isBundle && (
                  <span className="text-[10px] font-black bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                    <Package size={8}/>묶음 {previewGroup.stmts.length}건
                  </span>
                )}
              </div>
              <div className="flex gap-1.5 items-center">
                <button onClick={handleHistPdf}
                  className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-black hover:bg-blue-700">
                  <Download size={11}/>PDF
                </button>
                <button onClick={handleHistPrint}
                  className="flex items-center gap-1 px-3 py-1.5 bg-slate-700 text-white rounded-lg text-xs font-black hover:bg-slate-700">
                  <Printer size={11}/>인쇄
                </button>
                <button onClick={() => setHistPreviewGroupKey(null)}
                  className="p-2 bg-slate-100 text-slate-500 rounded-lg hover:bg-slate-200 ml-1">
                  <X size={16}/>
                </button>
              </div>
            </div>
            {/* 오버레이 내용 */}
            <div className="flex-1 overflow-y-auto p-6">
              <div ref={previewPrintRef}>
                      {/* 묶음 세금계산서 미리보기 (merged items) */}
                      <div className="border-2 border-black" style={{fontFamily:"'Malgun Gothic','맑은 고딕',sans-serif",minWidth:800,fontSize:'14px'}}>
                        <div className="flex items-center justify-between border-b-2 border-black px-4 py-3">
                          <h1 style={{fontSize:'20px',fontWeight:900,letterSpacing:'6px'}}>세 금 계 산 서</h1>
                          <div className="text-right" style={{fontSize:'10px',color:'#666'}}>
                            <div>거래처: {previewClient?.name}</div>
                            <div>발행일: {dateOfLocal(previewGroup.issuedAt)}</div>
                            {previewGroup.isBundle && <div style={{color:'#7c3aed',fontWeight:700}}>묶음 {previewGroup.stmts.length}건</div>}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 border-b border-black">
                          <div className="p-3 border-r border-black">
                            <h3 style={{fontSize:'10px',fontWeight:900,marginBottom:'6px',paddingBottom:'4px',borderBottom:'1px solid #eee',color:'#444'}}>공 급 자</h3>
                            {partyRows(previewParties.sup).map(([label, value]) => (
                              <div key={label} style={{display:'flex',gap:'8px',marginBottom:'3px',fontSize:'10px'}}>
                                <span style={{color:'#666',width:'60px',flexShrink:0}}>{label}</span>
                                <span style={{fontWeight:700}}>{value}</span>
                              </div>
                            ))}
                          </div>
                          <div className="p-3">
                            <h3 style={{fontSize:'10px',fontWeight:900,marginBottom:'6px',paddingBottom:'4px',borderBottom:'1px solid #eee',color:'#444'}}>공급받는자</h3>
                            {partyRows(previewParties.buy).map(([label, value]) => (
                              <div key={label} style={{display:'flex',gap:'8px',marginBottom:'3px',fontSize:'10px'}}>
                                <span style={{color:'#666',width:'60px',flexShrink:0}}>{label}</span>
                                <span style={{fontWeight:700}}>{value}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <table style={{width:'100%',borderCollapse:'collapse',fontSize:'11px'}}>
                          <thead>
                            <tr>{['품목','규격','수량','공급가액','세액','합계'].map(h => (
                              <th key={h} style={{border:'1px solid #ccc',background:'#f5f5f5',padding:'5px 7px',fontWeight:900,textAlign:'center'}}>{h}</th>
                            ))}</tr>
                          </thead>
                          <tbody>
                            {previewMerged.taxable.length > 0 && (<>
                              <tr><td colSpan={6} style={{padding:'3px 8px',background:'#dbeafe',fontWeight:900,color:'#1d4ed8',border:'1px solid #ccc',fontSize:'10px'}}>▶ 과세 품목</td></tr>
                              {previewMerged.taxable.map((item, i) => (
                                <tr key={i}>
                                  <td style={{border:'1px solid #ccc',padding:'4px 7px',fontWeight:700}}>{item.name}</td>
                                  <td style={{border:'1px solid #ccc',padding:'4px 7px',textAlign:'center'}}>{item.spec}</td>
                                  <td style={{border:'1px solid #ccc',padding:'4px 7px',textAlign:'right',overflowWrap:'anywhere'}}>{formatQuantity(item.qty)}</td>
                                  <td style={{border:'1px solid #ccc',padding:'4px 7px',textAlign:'right'}}>{fmt(item.supply)}</td>
                                  <td style={{border:'1px solid #ccc',padding:'4px 7px',textAlign:'right'}}>{fmt(item.tax)}</td>
                                  <td style={{border:'1px solid #ccc',padding:'4px 7px',textAlign:'right',fontWeight:900}}>{fmt(item.total)}</td>
                                </tr>
                              ))}
                              <tr style={{background:'#eff6ff'}}>
                                <td colSpan={3} style={{border:'1px solid #ccc',padding:'4px 8px',textAlign:'right',fontWeight:900,color:'#1d4ed8'}}>과세 소계</td>
                                <td style={{border:'1px solid #ccc',padding:'4px 8px',textAlign:'right',fontWeight:900,color:'#1d4ed8'}}>{fmt(previewMerged.taxable.reduce((s,i)=>s+i.supply,0))}</td>
                                <td style={{border:'1px solid #ccc',padding:'4px 8px',textAlign:'right',fontWeight:900,color:'#1d4ed8'}}>{fmt(previewMerged.taxable.reduce((s,i)=>s+i.tax,0))}</td>
                                <td style={{border:'1px solid #ccc',padding:'4px 8px',textAlign:'right',fontWeight:900,color:'#1d4ed8'}}>{fmt(previewMerged.taxable.reduce((s,i)=>s+i.total,0))}</td>
                              </tr>
                            </>)}
                            {previewMerged.exempt.length > 0 && (<>
                              <tr><td colSpan={6} style={{padding:'3px 8px',background:'#e0e7ff',fontWeight:900,color:'#4338ca',border:'1px solid #ccc',fontSize:'10px'}}>▶ 면세 품목</td></tr>
                              {previewMerged.exempt.map((item, i) => (
                                <tr key={i}>
                                  <td style={{border:'1px solid #ccc',padding:'4px 7px',fontWeight:700}}>{item.name}</td>
                                  <td style={{border:'1px solid #ccc',padding:'4px 7px',textAlign:'center'}}>{item.spec}</td>
                                  <td style={{border:'1px solid #ccc',padding:'4px 7px',textAlign:'right',overflowWrap:'anywhere'}}>{formatQuantity(item.qty)}</td>
                                  <td style={{border:'1px solid #ccc',padding:'4px 7px',textAlign:'right'}}>{fmt(item.supply)}</td>
                                  <td style={{border:'1px solid #ccc',padding:'4px 7px',textAlign:'center',color:'#666'}}>면세</td>
                                  <td style={{border:'1px solid #ccc',padding:'4px 7px',textAlign:'right',fontWeight:900}}>{fmt(item.supply)}</td>
                                </tr>
                              ))}
                              <tr style={{background:'#eef2ff'}}>
                                <td colSpan={3} style={{border:'1px solid #ccc',padding:'4px 8px',textAlign:'right',fontWeight:900,color:'#4338ca'}}>면세 소계</td>
                                <td style={{border:'1px solid #ccc',padding:'4px 8px',textAlign:'right',fontWeight:900,color:'#4338ca'}}>{fmt(previewMerged.exempt.reduce((s,i)=>s+i.supply,0))}</td>
                                <td style={{border:'1px solid #ccc',padding:'4px 8px'}}/>
                                <td style={{border:'1px solid #ccc',padding:'4px 8px',textAlign:'right',fontWeight:900,color:'#4338ca'}}>{fmt(previewMerged.exempt.reduce((s,i)=>s+i.supply,0))}</td>
                              </tr>
                            </>)}
                            <tr style={{background:'#f1f5f9'}}>
                              <td colSpan={3} style={{border:'1px solid #ccc',padding:'6px 8px',textAlign:'right',fontWeight:900,fontSize:'12px'}}>합 계</td>
                              <td style={{border:'1px solid #ccc',padding:'6px 8px',textAlign:'right',fontWeight:900}}>{fmt(previewMerged.taxable.reduce((s,i)=>s+i.supply,0)+previewMerged.exempt.reduce((s,i)=>s+i.supply,0))}</td>
                              <td style={{border:'1px solid #ccc',padding:'6px 8px',textAlign:'right',fontWeight:900}}>{fmt(previewMerged.taxable.reduce((s,i)=>s+i.tax,0))}</td>
                              <td style={{border:'1px solid #ccc',padding:'6px 8px',textAlign:'right',fontWeight:900,color:'#059669',fontSize:'13px'}}>{fmt(previewGroup.totalAmount)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
              </div>
            </div>
        </LargeModalShell>
      )}
    </div>
  );
};

export default TaxStatement;
