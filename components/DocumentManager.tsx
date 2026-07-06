import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { FileText, FileSpreadsheet, FileImage, File as FileIcon, Download, Trash2, Plus, Upload, Search, X, FolderPlus } from 'lucide-react';
import { storage } from '../src/shared/firebase';
import { subscribeToCollection, addItem, deleteItem, updateItem, fetchCollection } from '../src/shared/services/firebaseService';
import { CabinetCategory, CabinetSubCategory, CabinetDoc } from '../src/shared/types';

const DEFAULT_CATEGORIES = ['직원용', '업무용', '거래처용'];
const MAX_SIZE_MB = 30;

interface DocumentManagerProps {
  currentUser: { id: string; name: string };
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

const DocumentManager: React.FC<DocumentManagerProps> = ({ currentUser }) => {
  const [categories, setCategories] = useState<CabinetCategory[]>([]);
  const [subCategories, setSubCategories] = useState<CabinetSubCategory[]>([]);
  const [docs, setDocs] = useState<CabinetDoc[]>([]);
  const [activeCat, setActiveCat] = useState<string>('');
  const [activeSub, setActiveSub] = useState<string>(''); // '' = 전체
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [addingCat, setAddingCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [addingSub, setAddingSub] = useState(false);
  const [newSubName, setNewSubName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const seededRef = useRef(false);

  // 구독 + 최초 진입 시 기본 대분류 시드
  useEffect(() => {
    const unsubCat = subscribeToCollection<CabinetCategory>('fileCabinetCategories', setCategories);
    const unsubSub = subscribeToCollection<CabinetSubCategory>('fileCabinetSubCategories', setSubCategories);
    const unsubDoc = subscribeToCollection<CabinetDoc>('fileCabinetDocs', setDocs);
    // 빈 컬렉션은 구독 콜백이 호출되지 않으므로 1회 조회로 시드 여부 판단
    fetchCollection<CabinetCategory>('fileCabinetCategories').then((rows) => {
      if (rows.length === 0 && !seededRef.current) {
        seededRef.current = true;
        DEFAULT_CATEGORIES.forEach((name, i) =>
          addItem('fileCabinetCategories', { name, order: i, createdAt: new Date().toISOString() })
        );
      }
    });
    return () => { unsubCat(); unsubSub(); unsubDoc(); };
  }, []);

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
    if (!activeCat) { alert('먼저 대분류를 선택하세요.'); return; }
    if (!activeSub) { alert('먼저 중분류를 선택하세요. (전체 상태에서는 업로드할 수 없습니다)'); return; }
    const list = Array.from(files);
    if (list.length === 0) return;
    const tooBig = list.find(f => f.size > MAX_SIZE_MB * 1024 * 1024);
    if (tooBig) { alert(`"${tooBig.name}" 이(가) ${MAX_SIZE_MB}MB를 초과합니다.`); return; }

    setUploading(true);
    try {
      for (const file of list) {
        const safeName = file.name.replace(/[#?%]/g, '_');
        const path = `file-cabinet/${activeCat}/${activeSub}/${Date.now()}_${safeName}`;
        const storageRef = ref(storage, path);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);
        await addItem('fileCabinetDocs', {
          category: activeCat,
          subCategory: activeSub,
          fileName: file.name,
          storagePath: path,
          downloadUrl: url,
          size: file.size,
          contentType: file.type || 'application/octet-stream',
          note: '',
          uploadedBy: currentUser.name,
          uploadedAt: new Date().toISOString(),
        });
      }
    } catch (e: any) {
      console.error('[문서함] 업로드 실패:', e);
      alert(`업로드에 실패했습니다.\n(${e?.code ?? e?.message ?? '알 수 없는 오류'})`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (d: CabinetDoc) => {
    if (!confirm(`"${d.fileName}" 파일을 삭제할까요?`)) return;
    try {
      await deleteObject(ref(storage, d.storagePath)).catch((e) => {
        if (e?.code !== 'storage/object-not-found') throw e; // 이미 없으면 메타만 정리
      });
      await deleteItem('fileCabinetDocs', d.id);
    } catch (e) {
      console.error('[문서함] 삭제 실패:', e);
      alert('삭제에 실패했습니다.');
    }
  };

  const handleEditNote = async (d: CabinetDoc) => {
    const next = prompt('메모', d.note ?? '');
    if (next === null) return;
    await updateItem('fileCabinetDocs', d.id, { note: next });
  };

  const handleAddCategory = async () => {
    const name = newCatName.trim();
    if (!name) return;
    if (categories.some(c => c.name === name)) { alert('이미 있는 대분류입니다.'); return; }
    await addItem('fileCabinetCategories', { name, order: categories.length, createdAt: new Date().toISOString() });
    setNewCatName(''); setAddingCat(false); selectCat(name);
  };

  const handleDeleteCategory = async (cat: CabinetCategory) => {
    if ((docCountByCat.get(cat.name) ?? 0) > 0) { alert(`"${cat.name}"에 파일이 있어 삭제할 수 없습니다.`); return; }
    if (subCategories.some(s => s.category === cat.name)) { alert(`"${cat.name}"에 중분류가 있어 삭제할 수 없습니다. 먼저 중분류를 삭제하세요.`); return; }
    if (!confirm(`대분류 "${cat.name}"을(를) 삭제할까요?`)) return;
    await deleteItem('fileCabinetCategories', cat.id);
  };

  const handleAddSub = async () => {
    const name = newSubName.trim();
    if (!name) return;
    if (!activeCat) { alert('먼저 대분류를 선택하세요.'); return; }
    if (subsOfActive.some(s => s.name === name)) { alert('이미 있는 중분류입니다.'); return; }
    await addItem('fileCabinetSubCategories', { category: activeCat, name, order: subsOfActive.length, createdAt: new Date().toISOString() });
    setNewSubName(''); setAddingSub(false); setActiveSub(name);
  };

  const handleDeleteSub = async (sub: CabinetSubCategory) => {
    if ((docCountBySub.get(`${sub.category}|${sub.name}`) ?? 0) > 0) { alert(`"${sub.name}"에 파일이 있어 삭제할 수 없습니다.`); return; }
    if (!confirm(`중분류 "${sub.name}"을(를) 삭제할까요?`)) return;
    await deleteItem('fileCabinetSubCategories', sub.id);
  };

  const tabCls = (active: boolean) =>
    `px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl text-xs font-bold transition-all ${active ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`;
  const chipCls = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-xs font-bold transition-all ${active ? 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300' : 'text-slate-500 hover:bg-slate-100'}`;

  return (
    <div className="space-y-4 animate-in slide-in-from-right-4 duration-500">
      <div className="hidden md:flex items-center justify-between pb-3 md:pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-base md:text-lg font-black text-slate-800 leading-tight">문서함</h2>
          <p className="text-[11px] md:text-xs text-slate-400 mt-0.5">대분류(직원·업무·거래처) &gt; 중분류로 나눠 서류를 올려 보관하세요.</p>
        </div>
      </div>

      {/* 대분류 탭 + 검색 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 bg-white p-1 rounded-2xl border border-slate-200 shadow-sm">
          {sortedCats.map(cat => (
            <button key={cat.id} onClick={() => selectCat(cat.name)} onDoubleClick={() => handleDeleteCategory(cat)}
              title="더블클릭 시 빈 대분류 삭제" className={tabCls(activeCat === cat.name)}>
              {cat.name}
              <span className={`ml-1.5 text-[10px] ${activeCat === cat.name ? 'text-indigo-200' : 'text-slate-400'}`}>{docCountByCat.get(cat.name) ?? 0}</span>
            </button>
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

        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-2xl px-3 py-1.5 shadow-sm ml-auto">
          <Search className="w-3.5 h-3.5 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="파일명·메모 검색" className="w-32 sm:w-44 text-xs font-medium focus:outline-none" />
          {search && <button onClick={() => setSearch('')}><X className="w-3.5 h-3.5 text-slate-400" /></button>}
        </div>
      </div>

      {/* 중분류 칩 */}
      {activeCat && (
        <div className="flex flex-wrap items-center gap-1.5 bg-white p-2 rounded-2xl border border-slate-200 shadow-sm">
          <button onClick={() => setActiveSub('')} className={chipCls(activeSub === '')}>전체</button>
          {subsOfActive.map(sub => (
            <button key={sub.id} onClick={() => setActiveSub(sub.name)} onDoubleClick={() => handleDeleteSub(sub)}
              title="더블클릭 시 빈 중분류 삭제" className={chipCls(activeSub === sub.name)}>
              {sub.name}
              <span className={`ml-1 text-[10px] ${activeSub === sub.name ? 'text-indigo-500' : 'text-slate-400'}`}>{docCountBySub.get(`${sub.category}|${sub.name}`) ?? 0}</span>
            </button>
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

      {/* 업로드 영역 */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        className={`rounded-2xl border-2 border-dashed p-5 text-center transition-colors ${dragOver ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 bg-white'}`}
      >
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={e => e.target.files && handleFiles(e.target.files)} />
        <Upload className={`w-6 h-6 mx-auto mb-2 ${uploading ? 'animate-pulse text-indigo-500' : 'text-slate-400'}`} />
        <p className="text-xs font-bold text-slate-600">
          {uploading ? '업로드 중…' : <>여기로 파일을 끌어놓거나 <button onClick={() => fileInputRef.current?.click()} className="text-indigo-600 underline">파일 선택</button></>}
        </p>
        <p className="text-[10px] text-slate-400 mt-1">
          {!activeCat ? '먼저 대분류를 선택하세요'
            : !activeSub ? '중분류를 선택하거나 추가한 뒤 업로드하세요'
            : `현재 "${activeCat} > ${activeSub}"에 저장됩니다 · 최대 ${MAX_SIZE_MB}MB`}
        </p>
      </div>

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
                    {fmtSize(d.size)} · {d.uploadedBy} · {(d.uploadedAt ?? '').slice(0, 10)}
                    {d.note ? <span className="text-slate-500"> · {d.note}</span> : null}
                  </p>
                </div>
                <button onClick={() => handleEditNote(d)} className="shrink-0 px-2 py-1 text-[11px] font-bold text-slate-400 hover:text-slate-600">메모</button>
                <a href={d.downloadUrl} target="_blank" rel="noopener noreferrer" download={d.fileName} className="shrink-0 p-2 rounded-lg text-indigo-600 hover:bg-indigo-50" title="다운로드"><Download className="w-4 h-4" /></a>
                <button onClick={() => handleDelete(d)} className="shrink-0 p-2 rounded-lg text-red-500 hover:bg-red-50" title="삭제"><Trash2 className="w-4 h-4" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default DocumentManager;
