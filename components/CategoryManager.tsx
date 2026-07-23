import React, { useEffect, useMemo, useState } from 'react';
import { X, Plus, Trash2, ChevronUp, ChevronDown, Tag, Layers, RotateCcw, Eye, EyeOff } from 'lucide-react';
import { fetchCollection, addItem, updateItem, deleteItem } from '../src/shared/services/firebaseService';
import {
  buildTaxonomy, defaultTaxonomyRows, CATEGORY_KEYS, DEFAULT_CATEGORY_LABELS, TaxonomyRow,
} from '../src/shared/taxonomy';

const COL = 'itemTaxonomy';

interface Props {
  onClose: () => void;
  /** 저장이 끝나면 부모가 다시 읽도록 */
  onSaved?: (rows: TaxonomyRow[]) => void;
  /** 이 분류를 쓰고 있는 품목 수 — 지울 때 경고용 { 'submaterial:박스': 20 } */
  usage?: Record<string, number>;
}

const CategoryManager: React.FC<Props> = ({ onClose, onSaved, usage = {} }) => {
  const [rows, setRows] = useState<TaxonomyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<string>('product');
  const [adding, setAdding] = useState('');

  const load = async () => {
    const got = await fetchCollection<TaxonomyRow>(COL);
    if (got.length === 0) {
      // 최초 진입 — 기본값을 통째로 심는다. 이후로는 저장본이 유일한 출처.
      setLoading(true);
      const seeded: TaxonomyRow[] = [];
      for (const r of defaultTaxonomyRows()) {
        const id = await addItem(COL, r);
        seeded.push({ ...r, id: String(id) } as TaxonomyRow);
      }
      setRows(seeded);
    } else {
      setRows(got);
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const taxo = useMemo(() => buildTaxonomy(rows), [rows]);
  const catRow = (key: string) => rows.find(r => r.kind === 'category' && r.key === key);
  const subRows = useMemo(
    () => rows.filter(r => r.kind === 'subtype' && r.parent === sel)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [rows, sel],
  );

  // ── 카테고리 이름 ──
  const renameCategory = async (key: string, label: string) => {
    const existing = catRow(key);
    setRows(rs => existing
      ? rs.map(r => r.id === existing.id ? { ...r, label } : r)
      : [...rs, { id: `tmp-${key}`, kind: 'category', key, label, order: CATEGORY_KEYS.indexOf(key as never) } as TaxonomyRow]);
  };
  const commitCategory = async (key: string) => {
    const r = rows.find(x => x.kind === 'category' && x.key === key);
    if (!r) return;
    const label = (r.label || '').trim() || DEFAULT_CATEGORY_LABELS[key] || key;
    setBusy(true);
    try {
      if (r.id.startsWith('tmp-')) {
        const id = await addItem(COL, { kind: 'category', key, label, order: r.order ?? 0 });
        setRows(rs => rs.map(x => x.id === r.id ? { ...x, id: String(id), label } : x));
      } else {
        await updateItem(COL, r.id, { label });
        setRows(rs => rs.map(x => x.id === r.id ? { ...x, label } : x));
      }
    } finally { setBusy(false); }
  };

  const moveCategory = async (key: string, dir: -1 | 1) => {
    const ordered = taxo.allCategories.map(c => c.key);
    const i = ordered.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ordered.length) return;
    [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    setBusy(true);
    try {
      for (let n = 0; n < ordered.length; n++) {
        const k = ordered[n];
        const r = rows.find(x => x.kind === 'category' && x.key === k);
        if (r && !r.id.startsWith('tmp-')) await updateItem(COL, r.id, { order: n });
        else await addItem(COL, { kind: 'category', key: k, label: taxo.labelOf(k), order: n });
      }
      await load();
    } finally { setBusy(false); }
  };

  // ── 하위 분류 ──
  const addSub = async () => {
    const label = adding.trim();
    if (!label || busy) return;
    if (subRows.some(r => r.label === label)) { alert('이미 있는 하위 분류입니다.'); return; }
    setBusy(true);
    try {
      const order = subRows.length ? Math.max(...subRows.map(r => r.order ?? 0)) + 1 : 0;
      const id = await addItem(COL, { kind: 'subtype', parent: sel, label, order });
      setRows(rs => [...rs, { id: String(id), kind: 'subtype', parent: sel, label, order }]);
      setAdding('');
    } finally { setBusy(false); }
  };

  const renameSub = async (r: TaxonomyRow, label: string) => {
    setRows(rs => rs.map(x => x.id === r.id ? { ...x, label } : x));
  };
  const commitSub = async (r: TaxonomyRow) => {
    const cur = rows.find(x => x.id === r.id);
    const label = (cur?.label ?? '').trim();
    if (!label) { await load(); return; }
    setBusy(true);
    try { await updateItem(COL, r.id, { label }); } finally { setBusy(false); }
  };

  const removeSub = async (r: TaxonomyRow) => {
    const n = usage[`${sel}:${r.label}`] ?? 0;
    const msg = n > 0
      ? `"${r.label}"을(를) 쓰는 품목이 ${n}개 있습니다.\n분류만 지우고 품목은 그대로 둡니다 — 그 품목들은 하위 분류 없이 남습니다.\n지울까요?`
      : `"${r.label}"을(를) 지울까요?`;
    if (!confirm(msg)) return;
    setBusy(true);
    try {
      await deleteItem(COL, r.id);
      setRows(rs => rs.filter(x => x.id !== r.id));
    } finally { setBusy(false); }
  };

  const moveSub = async (r: TaxonomyRow, dir: -1 | 1) => {
    const i = subRows.findIndex(x => x.id === r.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= subRows.length) return;
    const next = [...subRows];
    [next[i], next[j]] = [next[j], next[i]];
    setBusy(true);
    try {
      for (let n = 0; n < next.length; n++) await updateItem(COL, next[n].id, { order: n });
      setRows(rs => rs.map(x => {
        const k = next.findIndex(y => y.id === x.id);
        return k >= 0 ? { ...x, order: k } : x;
      }));
    } finally { setBusy(false); }
  };

  // 안 쓰는 분류 숨기기 — 키는 남으므로 옛 품목은 그대로 동작한다
  const toggleHidden = async (key: string) => {
    const r = catRow(key);
    const next = !(r?.hidden);
    const n = usage[`cat:${key}`] ?? 0;
    if (next && n > 0 && !confirm(`"${taxo.labelOf(key)}"에 품목이 ${n}개 있습니다.\n숨기면 등록 화면·필터에서 안 보이지만 품목과 재고는 그대로입니다.\n숨길까요?`)) return;
    setBusy(true);
    try {
      if (r && !r.id.startsWith('tmp-')) {
        await updateItem(COL, r.id, { hidden: next });
        setRows(rs => rs.map(x => x.id === r.id ? { ...x, hidden: next } : x));
      } else {
        const id = await addItem(COL, { kind: 'category', key, label: taxo.labelOf(key), order: CATEGORY_KEYS.indexOf(key as never), hidden: next });
        setRows(rs => [...rs, { id: String(id), kind: 'category', key, label: taxo.labelOf(key), hidden: next } as TaxonomyRow]);
      }
    } finally { setBusy(false); }
  };

  const resetCategoryName = async (key: string) => {
    const r = catRow(key);
    if (!r || r.id.startsWith('tmp-')) return;
    setBusy(true);
    try {
      await updateItem(COL, r.id, { label: DEFAULT_CATEGORY_LABELS[key] });
      setRows(rs => rs.map(x => x.id === r.id ? { ...x, label: DEFAULT_CATEGORY_LABELS[key] } : x));
    } finally { setBusy(false); }
  };

  const close = () => { onSaved?.(rows); onClose(); };

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={close} />
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-3xl h-[80vh] flex flex-col animate-in zoom-in-95 duration-200">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-base font-black text-slate-900">분류 관리</h3>
            <p className="text-[11px] text-slate-400 font-bold mt-0.5">
              분류 이름과 하위 분류를 원하는 대로 정합니다 · 이름만 바뀌고 품목은 그대로입니다
            </p>
          </div>
          <button onClick={close} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg"><X size={18} /></button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-sm font-bold text-slate-400">불러오는 중…</div>
        ) : (
          <div className="flex-1 flex min-h-0">
            {/* 왼쪽 — 분류 */}
            <div className="w-1/2 border-r border-slate-100 overflow-y-auto p-4 space-y-2">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5 mb-2">
                <Layers size={12} /> 분류
              </p>
              {taxo.allCategories.map((c, idx) => {
                const r = catRow(c.key);
                const changed = r && r.label !== DEFAULT_CATEGORY_LABELS[c.key];
                const n = usage[`cat:${c.key}`] ?? 0;
                return (
                  <div key={c.key}
                    onClick={() => setSel(c.key)}
                    className={`p-2.5 rounded-xl border cursor-pointer transition-all ${
                      c.hidden ? 'opacity-45 ' : ''
                    }${
                      sel === c.key ? 'border-indigo-300 bg-indigo-50/60 ring-2 ring-indigo-50' : 'border-slate-150 hover:border-slate-300'
                    }`}>
                    <div className="flex items-center gap-1.5">
                      <input
                        value={r?.label ?? c.label}
                        onChange={e => renameCategory(c.key, e.target.value)}
                        onBlur={() => commitCategory(c.key)}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        className="flex-1 min-w-0 bg-transparent text-sm font-black text-slate-800 outline-none focus:bg-white focus:border-indigo-300 border border-transparent rounded-lg px-2 py-1"
                      />
                      {changed && (
                        <button title="기본 이름으로" onClick={e => { e.stopPropagation(); resetCategoryName(c.key); }}
                          className="p-1 text-slate-300 hover:text-indigo-500 shrink-0"><RotateCcw size={12} /></button>
                      )}
                      <button title={c.hidden ? '다시 쓰기' : '안 씀 (목록에서 숨김)'}
                        onClick={e => { e.stopPropagation(); toggleHidden(c.key); }}
                        className={`p-1 shrink-0 ${c.hidden ? 'text-indigo-400 hover:text-indigo-600' : 'text-slate-300 hover:text-slate-600'}`}>
                        {c.hidden ? <Eye size={13} /> : <EyeOff size={13} />}
                      </button>
                      <button disabled={idx === 0} onClick={e => { e.stopPropagation(); moveCategory(c.key, -1); }}
                        className="p-1 text-slate-300 hover:text-slate-600 disabled:opacity-20 shrink-0"><ChevronUp size={13} /></button>
                      <button disabled={idx === taxo.allCategories.length - 1} onClick={e => { e.stopPropagation(); moveCategory(c.key, 1); }}
                        className="p-1 text-slate-300 hover:text-slate-600 disabled:opacity-20 shrink-0"><ChevronDown size={13} /></button>
                    </div>
                    <p className="text-[10px] font-bold text-slate-400 px-2 mt-0.5">
                      <span className="text-slate-300">{c.key}</span>
                      {c.hidden && <span className="text-slate-400"> · 안 씀</span>}
                      {n > 0 && <span> · 품목 {n}개</span>}
                      {taxo.subtypesOf(c.key).length > 0 && <span> · 하위 {taxo.subtypesOf(c.key).length}개</span>}
                    </p>
                  </div>
                );
              })}
              <p className="text-[10px] font-bold text-slate-300 leading-relaxed pt-2 px-1">
                회색 글씨는 내부 키입니다. 재고 차감·원료식이 이걸 보고 움직이므로 바뀌지 않고,
                화면에 나오는 이름만 바뀝니다.
              </p>
            </div>

            {/* 오른쪽 — 하위 분류 */}
            <div className="w-1/2 flex flex-col min-h-0">
              <div className="p-4 pb-2 shrink-0">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                  <Tag size={12} /> {taxo.labelOf(sel)} 하위 분류
                </p>
              </div>
              <div className="flex-1 overflow-y-auto px-4 space-y-1.5">
                {subRows.length === 0 && (
                  <p className="text-xs font-bold text-slate-300 py-6 text-center">하위 분류가 없습니다</p>
                )}
                {subRows.map((r, i) => {
                  const n = usage[`${sel}:${r.label}`] ?? 0;
                  return (
                    <div key={r.id} className="flex items-center gap-1 border border-slate-150 rounded-xl px-2 py-1.5">
                      <input
                        value={r.label}
                        onChange={e => renameSub(r, e.target.value)}
                        onBlur={() => commitSub(r)}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        className="flex-1 min-w-0 bg-transparent text-sm font-black text-slate-700 outline-none focus:bg-slate-50 rounded-lg px-1.5 py-0.5"
                      />
                      {n > 0 && <span className="text-[10px] font-black text-slate-300 shrink-0">{n}</span>}
                      <button disabled={i === 0} onClick={() => moveSub(r, -1)}
                        className="p-1 text-slate-300 hover:text-slate-600 disabled:opacity-20 shrink-0"><ChevronUp size={13} /></button>
                      <button disabled={i === subRows.length - 1} onClick={() => moveSub(r, 1)}
                        className="p-1 text-slate-300 hover:text-slate-600 disabled:opacity-20 shrink-0"><ChevronDown size={13} /></button>
                      <button onClick={() => removeSub(r)}
                        className="p-1 text-slate-300 hover:text-rose-500 shrink-0"><Trash2 size={13} /></button>
                    </div>
                  );
                })}
              </div>
              <div className="p-4 pt-2 shrink-0 flex gap-2">
                <input
                  value={adding} onChange={e => setAdding(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addSub(); }}
                  placeholder={`${taxo.labelOf(sel)}에 추가 (예: 실링)`}
                  className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <button onClick={addSub} disabled={!adding.trim() || busy}
                  className="px-3 py-2 bg-indigo-600 text-white rounded-xl disabled:opacity-30 shrink-0"><Plus size={16} /></button>
              </div>
            </div>
          </div>
        )}

        <div className="p-4 border-t border-slate-100 flex items-center justify-end shrink-0">
          <button onClick={close} className="px-5 py-2.5 bg-slate-900 text-white font-bold rounded-xl text-sm">닫기</button>
        </div>
      </div>
    </div>
  );
};

export default CategoryManager;
