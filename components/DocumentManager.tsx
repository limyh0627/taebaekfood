import { useDocumentTransfers } from '../src/features/documents/hooks/useDocumentTransfers';
import QueryFilterPanel, { QUERY_FILTER_LABEL_CLASS, QUERY_FILTER_CONTROL_CLASS , QUERY_FILTER_FIELD_CLASS, QUERY_FILTER_SEARCH_CLASS, QUERY_FILTER_DATE_CLASS } from '../src/shared/components/QueryFilterPanel';
import { appConfirm } from '../src/shared/components/appDialog';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { where } from 'firebase/firestore';
import { FileText, FileSpreadsheet, FileImage, File as FileIcon, Download, Trash2, Plus, Upload, Search, X, FolderPlus } from 'lucide-react';
import { auth, authReady } from '../src/shared/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { subscribeToCollection, addItem, deleteItem, fetchCollection } from '../src/shared/services/firebaseService';
import { CabinetCategory, CabinetSubCategory, CabinetDoc, companyOf, type CompanyId } from '../src/shared/types';
import { dateOfLocal } from '../src/shared/day';

const DEFAULT_CATEGORIES = ['직원용', '업무용', '거래처용'];
/** 이번 탭에서 이미 세운 자리 — 화면을 드나들어도 두 번 안 만든다 */
const seededPaths = new Set<string>();
const MAX_SIZE_MB = 30;

interface DocumentManagerProps {
  currentUser: { id: string; name: string; companyId?: CompanyId };
  /**
   * 반드시 있어야 하는 자리 — 없으면 만든다.
   * 앱이 화면을 얹는 자리(서류관리 › 생산판매기록부)는 사람이 지워도 다시 서야 한다.
   */
  seed?: { category: string; subCategory: string }[];
  /** 지금 펴 놓은 자리를 바깥에 알린다 — 그 자리에 화면을 얹는 쪽이 쓴다 */
  onSelect?: (category: string, subCategory: string) => void;
  /** 파일 목록을 감춘다 — 그 자리를 얹은 화면이 쓸 때 */
  hideDocs?: boolean;
}

const fmtSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const fileIconFor = (name: string, contentType: string) => {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (contentType.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext))
    return <FileImage className="w-5 h-5 text-emerald-500" />;
  if (['xls', 'xlsx', 'csv'].includes(ext))
    return <FileSpreadsheet className="w-5 h-5 text-green-600" />;
  if (ext === 'pdf') return <FileText className="w-5 h-5 text-red-500" />;
  if (['doc', 'docx', 'hwp', 'hwpx', 'txt'].includes(ext))
    return <FileText className="w-5 h-5 text-blue-500" />;
  return <FileIcon className="w-5 h-5 text-slate-400" />;
};

const metadataStates:Record<string,string>={active:'진행 중',applied:'반영 확인',rejected:'거절 확인',cancelled:'미처리 중단 확인',unknown:'결과 미확인'};
const metadataStateLabel=(status?:string)=>metadataStates[status??'']??'확인 전';
const uploadStates:Record<string,string>={'not-required':'필요 없음',reserved:'파일 전송 준비 확인',absent:'현재 파일 없음',unverified:'파일 확인 필요',verified:'파일 확인 완료'};
const uploadStateLabel=(status?:string)=>uploadStates[status??'']??'확인 전';
const cleanupStates:Record<string,string>={'not-required':'필요 없음',pending:'정리 대기',deleted:'정리 완료',absent:'현재 파일 없음','retained-shared':'다른 문서 참조로 보존','retained-replaced':'다른 파일로 바뀌어 보존'};
const cleanupStateLabel=(status?:string)=>cleanupStates[status??'']??'확인 전';

const DocumentManager: React.FC<DocumentManagerProps> = ({ currentUser, seed = [], onSelect, hideDocs }) => {
  const companyId = companyOf(currentUser);
  const [actorUid,setActorUid]=useState(()=>auth.currentUser?.uid??'');
  useEffect(()=>{let live=true,stop=()=>{};void Promise.resolve(authReady).then(()=>{if(live)stop=onAuthStateChanged(auth,user=>{if(live)setActorUid(user?.uid??'');});});return()=>{live=false;stop();};},[]);
  const confirmationScope = useRef({ companyId, token: {} });
  if (confirmationScope.current.companyId !== companyId) confirmationScope.current = { companyId, token: {} };
  useEffect(() => () => { confirmationScope.current = { companyId: confirmationScope.current.companyId, token: {} }; }, []);
  const [categories, setCategories] = useState<CabinetCategory[]>([]);
  const [subCategories, setSubCategories] = useState<CabinetSubCategory[]>([]);
  const [docs, setDocs] = useState<CabinetDoc[]>([]);
  const [activeCat, setActiveCat] = useState<string>('');
  const [activeSub, setActiveSub] = useState<string>(''); // '' = 전체
  const [search, setSearch] = useState('');
  const transfers = useDocumentTransfers({companyId, actorUid, employeeId: currentUser.id, uploadedBy: currentUser.name});
  const [addingCat, setAddingCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [addingSub, setAddingSub] = useState(false);
  const [newSubName, setNewSubName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [loadError, setLoadError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const seededRef = useRef(false);

  // 구독 + 최초 진입 시 기본 대분류 시드
  useEffect(() => {
    seededRef.current = false;
    setLoadError('');
    const companyConstraint = [where('companyId', '==', companyId)];
    const onLoadError = (error: Error) => {
      console.error('[문서함] 회사별 자료 조회 실패:', error);
      setLoadError('문서함 자료를 불러오지 못했습니다. 다시 로그인한 뒤 재시도해 주세요.');
    };
    const unsubCat = subscribeToCollection<CabinetCategory>('fileCabinetCategories', setCategories, companyConstraint, onLoadError);
    const unsubSub = subscribeToCollection<CabinetSubCategory>('fileCabinetSubCategories', setSubCategories, companyConstraint, onLoadError);
    const unsubDoc = subscribeToCollection<CabinetDoc>('fileCabinetDocs', setDocs, companyConstraint, onLoadError);
    // 빈 컬렉션은 구독 콜백이 호출되지 않으므로 1회 조회로 시드 여부 판단
    fetchCollection<CabinetCategory>('fileCabinetCategories', companyConstraint).then((rows) => {
      if (rows.length === 0 && !seededRef.current) {
        seededRef.current = true;
        DEFAULT_CATEGORIES.forEach((name, i) =>
          addItem('fileCabinetCategories', { name, order: i, createdAt: new Date().toISOString(), companyId })
        );
      }
    }).catch(onLoadError);
    return () => { unsubCat(); unsubSub(); unsubDoc(); };
  }, [companyId]);

  /*
   * **자리를 세우는 건 딱 한 번, 그것도 목록을 실제로 읽어 본 뒤에.**
   *
   * 앞서 두 번 틀렸다:
   *   ① 구독이 아직 안 왔는데 `categories`가 빈 배열이라 "없네" 하고 만들었다.
   *   ② 막는 표식을 useRef에 뒀더니 화면을 나갔다 오면 초기화돼 또 만들었다.
   * 그래서 '서류관리'가 넷이 됐다.
   *
   * 이번엔 **fetch로 직접 확인**하고(구독을 안 기다린다), 표식을 **모듈 수준**에 둔다.
   * 화면을 몇 번 드나들어도 이 탭이 살아 있는 동안엔 한 번만 만든다.
   */
  const seedKey = seed.map(x => `${x.category}|${x.subCategory}`).join(',');
  useEffect(() => {
    if (!seedKey) return;
    let alive = true;
    (async () => {
      for (const { category, subCategory } of seed) {
        const key = `${companyId}|${category}|${subCategory}`;
        if (seededPaths.has(key)) continue;
        seededPaths.add(key);                       // 먼저 막는다 — await 사이에 또 들어온다
        const [cs, ss] = await Promise.all([
          fetchCollection<CabinetCategory>('fileCabinetCategories', [where('companyId', '==', companyId)]),
          fetchCollection<CabinetSubCategory>('fileCabinetSubCategories', [where('companyId', '==', companyId)]),
        ]);
        if (!alive) return;
        if (!cs.some(c => c.name === category))
          await addItem('fileCabinetCategories', { name: category, order: 90, createdAt: new Date().toISOString(), companyId });
        if (!ss.some(x => x.category === category && x.name === subCategory))
          await addItem('fileCabinetSubCategories', { category, name: subCategory, order: 0, createdAt: new Date().toISOString(), companyId });
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey, companyId]);

  /*
   * 고른 자리를 바깥에 알린다.
   * **onSelect를 의존성에 넣으면 안 된다** — 부르는 쪽이 인라인 화살표를 넘기면 매 렌더마다
   * 새 함수가 돼서 효과가 다시 돌고, 그쪽이 상태를 세우면 렌더가 끝없이 돈다.
   * 함수는 ref에 담아 두고 **고른 자리가 바뀔 때만** 알린다.
   */
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  useEffect(() => { onSelectRef.current?.(activeCat, activeSub); }, [activeCat, activeSub]);

  const sortedCats = useMemo(
    () => [...categories].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name)),
    [categories]
  );

  const subsOfActive = useMemo(
    () => subCategories.filter(s => s.category === activeCat)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name)),
    [subCategories, activeCat]
  );

  // 활성 대분류 기본값/유효성
  useEffect(() => {
    if (sortedCats.length === 0) { if (activeCat) setActiveCat(''); return; }
    if (!sortedCats.some(c => c.name === activeCat)) setActiveCat(sortedCats[0].name);
  }, [sortedCats, activeCat]);

  // 활성 중분류가 현재 대분류에 속하지 않으면 전체로
  useEffect(() => {
    if (activeSub && !subCategories.some(s => s.category === activeCat && s.name === activeSub)) {
      setActiveSub('');
    }
  }, [activeCat, activeSub, subCategories]);

  const docCountByCat = useMemo(() => {
    const m = new Map<string, number>();
    docs.forEach(d => m.set(d.category, (m.get(d.category) ?? 0) + 1));
    return m;
  }, [docs]);

  const docCountBySub = useMemo(() => {
    const m = new Map<string, number>();
    docs.forEach(d => {
      const k = `${d.category}|${d.subCategory ?? ''}`;
      m.set(k, (m.get(k) ?? 0) + 1);
    });
    return m;
  }, [docs]);

  const visibleDocs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return docs
      .filter(d => d.category === activeCat)
      .filter(d => activeSub === '' || (d.subCategory ?? '') === activeSub)
      .filter(d => !q || d.fileName.toLowerCase().includes(q) || (d.note ?? '').toLowerCase().includes(q))
      .sort((a, b) => (b.uploadedAt ?? '').localeCompare(a.uploadedAt ?? ''));
  }, [docs, activeCat, activeSub, search]);

  const selectCat = (name: string) => { setActiveCat(name); setActiveSub(''); setAddingSub(false); };

  const handleFiles = async (files: FileList | File[]) => {
    if(transfers.readLoading){alert('보관된 문서 요청을 먼저 읽고 있습니다. 잠시 후 다시 선택해 주세요.');return;}
    if(transfers.readError){alert(transfers.readError);return;}
    if (!activeCat) { alert('먼저 대분류를 선택하세요.'); return; }
    if (!activeSub) { alert('먼저 중분류를 선택하세요. (전체 상태에서는 업로드할 수 없습니다)'); return; }
    const list = Array.from(files);
    if (list.length === 0) return;
    const tooBig = list.find(f => f.size > MAX_SIZE_MB * 1024 * 1024);
    if (tooBig) { alert(`"${tooBig.name}" 이(가) ${MAX_SIZE_MB}MB를 초과합니다.`); return; }

    // 후크가 File을 보존한 뒤 입력만 비워 같은 파일도 다시 선택할 수 있게 한다.
    const task = transfers.startUploads(list, activeCat, activeSub);
    if (fileInputRef.current) fileInputRef.current.value = '';
    await task;
  };

  const handleEditNote = (document: CabinetDoc) => transfers.editNote(document);

  const handleAddCategory = async () => {
    const scope = confirmationScope.current.token;
    const name = newCatName.trim();
    if (!name) return;
    if (categories.some(c => c.name === name)) { alert('이미 있는 대분류입니다.'); return; }
    await addItem('fileCabinetCategories', { name, order: categories.length, createdAt: new Date().toISOString(), companyId });
    if (confirmationScope.current.token !== scope) return;
    setNewCatName(''); setAddingCat(false); selectCat(name);
  };

  const handleDeleteCategory = async (cat: CabinetCategory) => {
    const scope = confirmationScope.current.token;
    if ((docCountByCat.get(cat.name) ?? 0) > 0) { alert(`"${cat.name}"에 파일이 있어 삭제할 수 없습니다.`); return; }
    if (subCategories.some(s => s.category === cat.name)) { alert(`"${cat.name}"에 중분류가 있어 삭제할 수 없습니다. 먼저 중분류를 삭제하세요.`); return; }
    if (!await appConfirm(`대분류 "${cat.name}"을(를) 삭제할까요?`)) return;
    if (confirmationScope.current.token !== scope) return;
    await deleteItem('fileCabinetCategories', cat.id);
  };

  const handleAddSub = async () => {
    const scope = confirmationScope.current.token;
    const name = newSubName.trim();
    if (!name) return;
    if (!activeCat) { alert('먼저 대분류를 선택하세요.'); return; }
    if (subsOfActive.some(s => s.name === name)) { alert('이미 있는 중분류입니다.'); return; }
    await addItem('fileCabinetSubCategories', { category: activeCat, name, order: subsOfActive.length, createdAt: new Date().toISOString(), companyId });
    if (confirmationScope.current.token !== scope) return;
    setNewSubName(''); setAddingSub(false); setActiveSub(name);
  };

  const handleDeleteSub = async (sub: CabinetSubCategory) => {
    const scope = confirmationScope.current.token;
    if ((docCountBySub.get(`${sub.category}|${sub.name}`) ?? 0) > 0) { alert(`"${sub.name}"에 파일이 있어 삭제할 수 없습니다.`); return; }
    if (!await appConfirm(`중분류 "${sub.name}"을(를) 삭제할까요?`)) return;
    if (confirmationScope.current.token !== scope) return;
    await deleteItem('fileCabinetSubCategories', sub.id);
  };

  const tabCls = (active: boolean) =>
    `px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl text-xs font-bold transition-all ${active ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`;
  const chipCls = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-xs font-bold transition-all ${active ? 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300' : 'text-slate-500 hover:bg-slate-100'}`;

  return (
    <div className="space-y-4 animate-in slide-in-from-right-4 duration-500">
      {loadError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700">
          {loadError}
        </div>
      )}
      <div className="hidden md:flex items-center justify-between pb-3 md:pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-base md:text-lg font-black text-slate-800 leading-tight">문서함</h2>
          <p className="text-[11px] md:text-xs text-slate-400 mt-0.5">대분류(직원·업무·거래처) &gt; 중분류로 나눠 서류를 올려 보관하세요.</p>
        </div>
      </div>

      {/* 대분류 탭 + 검색 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 bg-white p-1 rounded-2xl border border-slate-200 shadow-sm">
          {/*  **더블클릭 삭제는 없앴다**(2026-09-03 사장님) — 고르려다 두 번 눌려 지워진다.
               대분류·중분류를 지우려면 손으로 지우는 길을 따로 둔다. */}
          {sortedCats.map(cat => (
            <span key={cat.id} className="relative inline-flex items-center">
            <button onClick={() => selectCat(cat.name)}
              className={tabCls(activeCat === cat.name)}>
              {cat.name}
              <span className={`ml-1.5 text-[10px] ${activeCat === cat.name ? 'text-indigo-200' : 'text-slate-400'}`}>{docCountByCat.get(cat.name) ?? 0}</span>
            </button>
            {/*  지우는 길은 **작은 X 하나** — 고르고 있는 것에만 뜬다.
                 더블클릭은 고르려다 두 번 눌려 지워져서 없앴다(2026-09-03 사장님). */}
            {activeCat === cat.name && (docCountByCat.get(cat.name) ?? 0) === 0 && (
              <button onClick={() => handleDeleteCategory(cat)} title="빈 대분류 지우기"
                className="ml-0.5 p-0.5 rounded text-slate-300 hover:text-rose-500 hover:bg-rose-50">
                <X className="w-3 h-3" />
              </button>
            )}
            </span>
          ))}
          {addingCat ? (
            <div className="flex items-center gap-1 px-1">
              <input autoFocus value={newCatName} onChange={e => setNewCatName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddCategory(); if (e.key === 'Escape') { setAddingCat(false); setNewCatName(''); } }}
                placeholder="대분류명" className="w-28 px-2 py-1.5 text-xs font-bold border border-indigo-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200" />
              <button onClick={handleAddCategory} className="p-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"><Plus className="w-3.5 h-3.5" /></button>
              <button onClick={() => { setAddingCat(false); setNewCatName(''); }} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><X className="w-3.5 h-3.5" /></button>
            </div>
          ) : (
            <button onClick={() => setAddingCat(true)} className="px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl text-xs font-bold text-indigo-600 hover:bg-indigo-50 flex items-center gap-1">
              <FolderPlus className="w-3.5 h-3.5" /> 대분류 추가
            </button>
          )}
        </div>


      </div>

      <QueryFilterPanel onReset={() => setSearch('')} searchRow={<>
<label className={QUERY_FILTER_SEARCH_CLASS}><span>전체 검색</span>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="파일명·메모 검색" className={(QUERY_FILTER_CONTROL_CLASS + ' w-full pl-9 pr-9') + ' w-full min-w-0 max-w-full'} />
          {search && <button type="button" aria-label="파일 검색 지우기" className="absolute right-3 top-1/2 -translate-y-1/2" onClick={() => setSearch('')}><X className="w-3.5 h-3.5 text-slate-400" /></button>}
        </div>
        </label>
</>} />

      {/* 중분류 칩 */}
      {activeCat && (
        <div className="flex flex-wrap items-center gap-1.5 bg-white p-2 rounded-2xl border border-slate-200 shadow-sm">
          <button onClick={() => setActiveSub('')} className={chipCls(activeSub === '')}>전체</button>
          {subsOfActive.map(sub => (
            <span key={sub.id} className="relative inline-flex items-center">
            <button onClick={() => setActiveSub(sub.name)}
              className={chipCls(activeSub === sub.name)}>
              {sub.name}
              <span className={`ml-1 text-[10px] ${activeSub === sub.name ? 'text-indigo-500' : 'text-slate-400'}`}>{docCountBySub.get(`${sub.category}|${sub.name}`) ?? 0}</span>
            </button>
            {/*  지우는 길은 작은 X 하나 — 고르고 있는 것에만 */}
            {activeSub === sub.name && (
              <button onClick={() => handleDeleteSub(sub)} title="빈 중분류 지우기"
                className="ml-0.5 p-0.5 rounded text-slate-300 hover:text-rose-500 hover:bg-rose-50">
                <X className="w-3 h-3" />
              </button>
            )}
            </span>
          ))}
          {addingSub ? (
            <div className="flex items-center gap-1">
              <input autoFocus value={newSubName} onChange={e => setNewSubName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddSub(); if (e.key === 'Escape') { setAddingSub(false); setNewSubName(''); } }}
                placeholder="중분류명" className="w-24 px-2 py-1 text-xs font-bold border border-indigo-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200" />
              <button onClick={handleAddSub} className="p-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-700"><Plus className="w-3.5 h-3.5" /></button>
              <button onClick={() => { setAddingSub(false); setNewSubName(''); }} className="p-1 rounded-md text-slate-400 hover:bg-slate-100"><X className="w-3.5 h-3.5" /></button>
            </div>
          ) : (
            <button onClick={() => setAddingSub(true)} className="px-2.5 py-1.5 rounded-full text-xs font-bold text-indigo-600 hover:bg-indigo-50 flex items-center gap-1">
              <Plus className="w-3.5 h-3.5" /> 중분류 추가
            </button>
          )}
        </div>
      )}

      {/* 업로드·파일 목록 — 앱이 화면을 얹은 자리에선 감춘다(그 자리를 서류가 쓴다) */}
      {!hideDocs && (<>
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        className={`rounded-2xl border-2 border-dashed p-5 text-center transition-colors ${dragOver ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 bg-white'}`}
      >
        <input aria-label="문서 파일 첨부" disabled={transfers.readLoading || !!transfers.readError || transfers.confirmationBusy} ref={fileInputRef} type="file" multiple className="hidden" onChange={e => e.target.files && handleFiles(e.target.files)} />
        <Upload className={`w-6 h-6 mx-auto mb-2 text-slate-400`} />
        <p className="text-xs font-bold text-slate-600">
          여기로 파일을 끌어놓거나 <button disabled={transfers.readLoading || !!transfers.readError || transfers.confirmationBusy} onClick={() => fileInputRef.current?.click()} className="text-indigo-600 underline">파일 선택</button>
        </p>
        <p className="text-[10px] text-slate-400 mt-1">
          {!activeCat ? '먼저 대분류를 선택하세요'
            : !activeSub ? '중분류를 선택하거나 추가한 뒤 업로드하세요'
            : `현재 "${activeCat} > ${activeSub}"에 저장됩니다 · 최대 ${MAX_SIZE_MB}MB`}
        </p>
      </div>

      {transfers.readLoading && <p role="status" className="text-xs text-slate-600">보관된 문서 요청의 처리 상태를 읽고 있습니다.</p>}
      {transfers.message && <p role="status" className="whitespace-pre-line text-xs text-slate-600">{transfers.message}</p>}
      {transfers.readError && <div className="space-y-2 text-xs"><p role="alert">{transfers.readError}</p><button type="button" disabled={transfers.readLoading} onClick={()=>void transfers.refresh()} className="rounded border border-slate-200 px-3 py-2">보관 요청 다시 읽기</button></div>}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button type="button" disabled={transfers.historyLoading || transfers.readLoading} onClick={()=>void transfers.refresh()} className="rounded border border-slate-200 px-3 py-2">서버 미완료 요청 새로 조회</button>
        {transfers.historyLoading && <p role="status">서버에 남은 문서 요청을 확인하고 있습니다.</p>}
        {transfers.historyMore && <><p>더 확인할 요청이 있습니다.</p><button type="button" disabled={transfers.historyLoading} onClick={()=>void transfers.nextPage()} className="rounded border border-slate-200 px-3 py-2">다음 요청 확인</button></>}
        {transfers.historyError && <p role="alert" className="whitespace-pre-line">{transfers.historyError}</p>}
      </div>
      {transfers.jobs.length > 0 && <section aria-label="처리 중이거나 확인이 필요한 문서" className="max-h-[60vh] space-y-3 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3">
        <h3 className="text-sm font-bold text-slate-700">처리 중이거나 확인이 필요한 문서</h3>
        {transfers.jobs.map(job => <div key={job.jobId} className="space-y-2 border-t border-slate-200 pt-3 text-xs first:border-t-0 first:pt-0">
          <div className="min-w-0 break-words">
            <p className="font-bold text-slate-700">{job.fileName || '문서 원문 확인 필요'}</p>
            <p className="text-slate-500">문서 번호: {job.documentId}</p>
            <p>문서 정보: {metadataStateLabel(job.metadataStatus)}</p>
            <p>파일 업로드: {uploadStateLabel(job.uploadStatus)} · 파일 정리: {cleanupStateLabel(job.cleanupStatus)}</p>
            <p role="status" className="whitespace-pre-line text-slate-600">{job.message}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {job.canInspect&&<button type="button" disabled={job.busy || transfers.confirmationBusy} aria-label={job.fileName+' · '+job.documentId+' · 결과 확인'} onClick={()=>void transfers.inspect(job.jobId)} className="rounded border border-slate-200 px-3 py-2">결과 확인</button>}
            {job.canRetry&&!job.requiresFile&&job.stage!=='cleanup'&&<button type="button" disabled={job.busy || transfers.confirmationBusy} aria-label={job.fileName+' · '+job.documentId+' · 같은 요청 이어하기'} onClick={()=>void transfers.resume(job.jobId)} className="rounded border border-slate-200 px-3 py-2">같은 요청 이어하기</button>}
            {job.canCancel&&<button type="button" disabled={job.busy || transfers.confirmationBusy} aria-label={job.fileName+' · '+job.documentId+' · 미처리 요청 중단'} onClick={()=>void transfers.cancel(job.jobId)} className="rounded border border-slate-200 px-3 py-2">미처리 요청 중단</button>}
            {job.stage==='cleanup'&&job.canRetry&&<button type="button" disabled={job.busy || transfers.confirmationBusy} aria-label={job.fileName+' · '+job.documentId+' · 남은 파일 정리'} onClick={()=>void transfers.retryCleanup(job.jobId)} className="rounded border border-slate-200 px-3 py-2">남은 파일 정리</button>}
            {job.requiresFile&&<label className="rounded border border-slate-200 px-3 py-2">같은 파일 다시 선택<input type="file" disabled={job.busy || transfers.confirmationBusy} aria-label={job.fileName+' · '+job.documentId+' · 같은 SHA 파일 다시 선택'} className="mt-1 block max-w-full" onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file){if(file.size>MAX_SIZE_MB*1024*1024){alert('파일이 '+MAX_SIZE_MB+'MB를 초과합니다.');return;}void transfers.resume(job.jobId,file);}}}/></label>}
            {job.canDiscard&&typeof job.observedLocalText==='string'&&<button type="button" disabled={job.busy || transfers.confirmationBusy} aria-label={job.fileName+' · '+job.documentId+' · 이 기기 사본 정리'} onClick={()=>void transfers.discardCopy(job.jobId,job.observedLocalText!)} className="rounded border border-slate-200 px-3 py-2">이 기기 사본 정리</button>}
          </div>
          {job.requiresFile&&<p className="text-slate-500">처음 요청한 파일과 SHA가 같은 파일만 이어갈 수 있습니다. 현재 분류나 새 파일로 원래 요청을 바꾸지 않습니다.</p>}
        </div>)}
        <p className="text-xs text-slate-500">요청 중단은 아직 처리되지 않은 실행을 막습니다. 파일 정리와 기기 사본 정리는 이미 반영된 문서 정보를 되돌리지 않습니다.</p>
      </section>}

      {/* 파일 목록 */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {visibleDocs.length === 0 ? (
          <div className="py-14 text-center text-xs text-slate-400">{search ? '검색 결과가 없습니다.' : '올린 파일이 없습니다.'}</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {visibleDocs.map(d => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                <div className="shrink-0">{fileIconFor(d.fileName, d.contentType)}</div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-800 truncate">{d.fileName}</p>
                  <p className="text-[11px] text-slate-400 truncate">
                    {activeSub === '' && d.subCategory ? <span className="text-indigo-400 font-bold">{d.subCategory} · </span> : null}
                    {fmtSize(d.size)} · {d.uploadedBy} · {dateOfLocal(d.uploadedAt)}
                    {d.note ? <span className="text-slate-500"> · {d.note}</span> : null}
                  </p>
                </div>
                <button disabled={transfers.readLoading || !!transfers.readError || transfers.confirmationBusy || transfers.jobs.some(job=>job.documentId===d.id)} onClick={() => void handleEditNote(d)} className="shrink-0 px-2 py-1 text-[11px] font-bold text-slate-400 hover:text-slate-600">메모</button>
                <a href={d.downloadUrl} target="_blank" rel="noopener noreferrer" download={d.fileName} className="shrink-0 p-2 rounded-lg text-indigo-600 hover:bg-indigo-50" title="다운로드"><Download className="w-4 h-4" /></a>
                {!transfers.jobs.some(job => job.documentId === d.id) && <button disabled={transfers.readLoading || !!transfers.readError || transfers.confirmationBusy} onClick={() => void transfers.deleteDocument(d)} className="shrink-0 p-2 rounded-lg text-red-500 hover:bg-red-50" title="삭제"><Trash2 className="w-4 h-4" /></button>}
              </li>
            ))}
          </ul>
        )}
      </div>
      </>)}
    </div>
  );
};

export default DocumentManager;
