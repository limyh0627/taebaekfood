import React, { useEffect, useMemo, useState } from 'react';
import { X, Plus, Trash2, ChevronUp, ChevronDown, Tag, Layers, RotateCcw, Eye, EyeOff, Boxes } from 'lucide-react';
import { fetchCollection, addItem, updateItem, deleteItem } from '../src/shared/services/firebaseService';
import {
  buildTaxonomy, defaultTaxonomyRows, CATEGORY_KEYS, DEFAULT_CATEGORY_LABELS, TaxonomyRow,
} from '../src/shared/taxonomy';

const COL = 'itemTaxonomy';

interface Props {
  onClose: () => void;
  onSaved?: (rows: TaxonomyRow[]) => void;
  /** 쓰고 있는 품목 수 — 지울 때 경고용. 'type:product' / 'sub:product:낱개' / 'cat:product:참기름' */
  usage?: Record<string, number>;
}

const CategoryManager: React.FC<Props> = ({ onClose, onSaved, usage = {} }) => {
  const [rows, setRows] = useState<TaxonomyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<string>('product');
  const [addSub, setAddSub] = useState('');
  const [addCat, setAddCat] = useState('');

  const load = async () => {
    const got = await fetchCollection<TaxonomyRow>(COL);
    if (got.length === 0) {
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
  const typeRow = (key: string) => rows.find(r => (r.kind === 'type' || (r.kind === 'category' && r.key && !r.parent)) && r.key === key);
  const listOf = (kind: 'subtype' | 'category') =>
    rows.filter(r => r.kind === kind && r.parent === sel).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const subRows = useMemo(() => listOf('subtype'), [rows, sel]);
  const catRows = useMemo(() => listOf('category'), [rows, sel]);

  // ── 타입 ──
  const renameType = (key: string, label: string) => {
    const ex = typeRow(key);
    setRows(rs => ex
      ? rs.map(r => r.id === ex.id ? { ...r, label } : r)
      : [...rs, { id: `tmp-${key}`, kind: 'type', key, label, order: CATEGORY_KEYS.indexOf(key as never) } as TaxonomyRow]);
  };
  const commitType = async (key: string) => {
    const r = typeRow(key);
    if (!r) return;
    const label = (r.label || '').trim() || DEFAULT_CATEGORY_LABELS[key] || key;
    setBusy(true);
    try {
      if (r.id.startsWith('tmp-')) {
        const id = await addItem(COL, { kind: 'type', key, label, order: r.order ?? 0 });
        setRows(rs => rs.map(x => x.id === r.id ? { ...x, id: String(id), label } : x));
      } else {
        await updateItem(COL, r.id, { label });
        setRows(rs => rs.map(x => x.id === r.id ? { ...x, label } : x));
      }
    } finally { setBusy(false); }
  };
  const moveType = async (key: string, dir: -1 | 1) => {
    const ordered = taxo.allTypes.map(c => c.key);
    const i = ordered.indexOf(key), j = i + dir;
    if (i < 0 || j < 0 || j >= ordered.length) return;
    [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    setBusy(true);
    try {
      for (let n = 0; n < ordered.length; n++) {
        const k = ordered[n], r = typeRow(k);
        if (r && !r.id.startsWith('tmp-')) await updateItem(COL, r.id, { order: n });
        else await addItem(COL, { kind: 'type', key: k, label: taxo.labelOf(k), order: n });
      }
      await load();
    } finally { setBusy(false); }
  };
  const toggleHidden = async (key: string) => {
    const r = typeRow(key);
    const next = !(r?.hidden);
    const n = usage[`type:${key}`] ?? 0;
    if (next && n > 0 && !confirm(`"${taxo.labelOf(key)}"에 품목이 ${n}개 있습니다.\n숨기면 등록 화면·필터에서 안 보이지만 품목과 재고는 그대로입니다.\n숨길까요?`)) return;
    setBusy(true);
    try {
      if (r && !r.id.startsWith('tmp-')) {
        await updateItem(COL, r.id, { hidden: next });
        setRows(rs => rs.map(x => x.id === r.id ? { ...x, hidden: next } : x));
      } else {
        const id = await addItem(COL, { kind: 'type', key, label: taxo.labelOf(key), order: CATEGORY_KEYS.indexOf(key as never), hidden: next });
        setRows(rs => [...rs, { id: String(id), kind: 'type', key, label: taxo.labelOf(key), hidden: next } as TaxonomyRow]);
      }
    } finally { setBusy(false); }
  };
  const resetTypeName = async (key: string) => {
    const r = typeRow(key);
    if (!r || r.id.startsWith('tmp-')) return;
    setBusy(true);
    try {
      await updateItem(COL, r.id, { label: DEFAULT_CATEGORY_LABELS[key] });
      setRows(rs => rs.map(x => x.id === r.id ? { ...x, label: DEFAULT_CATEGORY_LABELS[key] } : x));
    } finally { setBusy(false); }
  };

  // ── 서브타입 · 카테고리 (같은 로직, kind만 다름) ──
  const addRow = async (kind: 'subtype' | 'category', label: string, reset: () => void) => {
    const l = label.trim();
    if (!l || busy) return;
    const cur = kind === 'subtype' ? subRows : catRows;
    if (cur.some(r => r.label === l)) { alert('이미 있습니다.'); return; }
    setBusy(true);
    try {
      const order = cur.length ? Math.max(...cur.map(r => r.order ?? 0)) + 1 : 0;
      const id = await addItem(COL, { kind, parent: sel, label: l, order });
      setRows(rs => [...rs, { id: String(id), kind, parent: sel, label: l, order }]);
      reset();
    } finally { setBusy(false); }
  };
  const renameRow = (r: TaxonomyRow, label: string) => setRows(rs => rs.map(x => x.id === r.id ? { ...x, label } : x));
  const commitRow = async (r: TaxonomyRow) => {
    const label = (rows.find(x => x.id === r.id)?.label ?? '').trim();
    if (!label) { await load(); return; }
    setBusy(true);
    try { await updateItem(COL, r.id, { label }); } finally { setBusy(false); }
  };
  const removeRow = async (r: TaxonomyRow, kind: 'subtype' | 'category') => {
    const n = usage[`${kind === 'subtype' ? 'sub' : 'cat'}:${sel}:${r.label}`] ?? 0;
    const msg = n > 0
      ? `"${r.label}"을(를) 쓰는 품목이 ${n}개 있습니다.\n분류만 지우고 품목은 그대로 둡니다 — 그 품목들은 이 값 없이 남습니다.\n지울까요?`
      : `"${r.label}"을(를) 지울까요?`;
    if (!confirm(msg)) return;
    setBusy(true);
    try { await deleteItem(COL, r.id); setRows(rs => rs.filter(x => x.id !== r.id)); }
    finally { setBusy(false); }
  };
  const moveRow = async (r: TaxonomyRow, dir: -1 | 1, kind: 'subtype' | 'category') => {
    const cur = kind === 'subtype' ? subRows : catRows;
    const i = cur.findIndex(x => x.id === r.id), j = i + dir;
    if (i < 0 || j < 0 || j >= cur.length) return;
    const next = [...cur];
    [next[i], next[j]] = [next[j], next[i]];
    setBusy(true);
    try {
      for (let n = 0; n < next.length; n++) await updateItem(COL, next[n].id, { order: n });
      setRows(rs => rs.map(x => { const k = next.findIndex(y => y.id === x.id); return k >= 0 ? { ...x, order: k } : x; }));
    } finally { setBusy(false); }
  };

  const close = () => { onSaved?.(rows); onClose(); };

  // 서브타입·카테고리 목록 한 벌 — 같은 모양이라 렌더러를 공유한다
  const listPane = (
    kind: 'subtype' | 'category', title: string, icon: React.ReactNode,
    list: TaxonomyRow[], value: string, setValue: (s: string) => void, hint: string,
  ) => (
    <div className="flex-1 flex flex-col min-h-0 border-l border-slate-100">
      <div className="p-4 pb-2 shrink-0">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
          {icon} {title}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto px-4 space-y-1.5">
        {list.length === 0 && <p className="text-xs font-bold text-slate-300 py-6 text-center">{hint}</p>}
        {list.map((r, i) => {
          const n = usage[`${kind === 'subtype' ? 'sub' : 'cat'}:${sel}:${r.label}`] ?? 0;
          return (
            <div key={r.id} className="flex items-center gap-1 border border-slate-150 rounded-xl px-2 py-1.5">
              <input
                value={r.label}
                onChange={e => renameRow(r, e.target.value)}
                onBlur={() => commitRow(r)}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                className="flex-1 min-w-0 bg-transparent text-sm font-black text-slate-700 outline-none focus:bg-slate-50 rounded-lg px-1.5 py-0.5"
              />
              {n > 0 && <span className="text-[10px] font-black text-slate-300 shrink-0">{n}</span>}
              <button disabled={i === 0} onClick={() => moveRow(r, -1, kind)}
                className="p-1 text-slate-300 hover:text-slate-600 disabled:opacity-20 shrink-0"><ChevronUp size={13} /></button>
              <button disabled={i === list.length - 1} onClick={() => moveRow(r, 1, kind)}
                className="p-1 text-slate-300 hover:text-slate-600 disabled:opacity-20 shrink-0"><ChevronDown size={13} /></button>
              <button onClick={() => removeRow(r, kind)}
                className="p-1 text-slate-300 hover:text-rose-500 shrink-0"><Trash2 size={13} /></button>
            </div>
          );
        })}
      </div>
      <div className="p-4 pt-2 shrink-0 flex gap-2">
        <input
          value={value} onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addRow(kind, value, () => setValue('')); }}
          placeholder="추가"
          className="flex-1 min-w-0 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-400"
        />
        <button onClick={() => addRow(kind, value, () => setValue(''))} disabled={!value.trim() || busy}
          className="px-3 py-2 bg-indigo-600 text-white rounded-xl disabled:opacity-30 shrink-0"><Plus size={16} /></button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={close} />
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col animate-in zoom-in-95 duration-200">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-base font-black text-slate-900">분류 관리</h3>
            <p className="text-[11px] text-slate-400 font-bold mt-0.5">
              타입 › 서브타입 › 카테고리 · 이름과 목록을 원하는 대로 정합니다
            </p>
          </div>
          <button onClick={close} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg"><X size={18} /></button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-sm font-bold text-slate-400">불러오는 중…</div>
        ) : (
          <div className="flex-1 flex min-h-0">
            {/* 타입 */}
            <div className="w-[38%] overflow-y-auto p-4 space-y-2">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5 mb-2">
                <Layers size={12} /> 타입
              </p>
              {taxo.allTypes.map((c, idx) => {
                const r = typeRow(c.key);
                const changed = r && r.label !== DEFAULT_CATEGORY_LABELS[c.key];
                const n = usage[`type:${c.key}`] ?? 0;
                return (
                  <div key={c.key}
                    onClick={() => setSel(c.key)}
                    className={`p-2.5 rounded-xl border cursor-pointer transition-all ${c.hidden ? 'opacity-45 ' : ''}${
                      sel === c.key ? 'border-indigo-300 bg-indigo-50/60 ring-2 ring-indigo-50' : 'border-slate-150 hover:border-slate-300'
                    }`}>
                    <div className="flex items-center gap-1">
                      <input
                        value={r?.label ?? c.label}
                        onChange={e => renameType(c.key, e.target.value)}
                        onBlur={() => commitType(c.key)}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        className="flex-1 min-w-0 bg-transparent text-sm font-black text-slate-800 outline-none focus:bg-white focus:border-indigo-300 border border-transparent rounded-lg px-2 py-1"
                      />
                      {changed && (
                        <button title="기본 이름으로" onClick={e => { e.stopPropagation(); resetTypeName(c.key); }}
                          className="p-1 text-slate-300 hover:text-indigo-500 shrink-0"><RotateCcw size={12} /></button>
                      )}
                      <button title={c.hidden ? '다시 쓰기' : '안 씀 (숨김)'} onClick={e => { e.stopPropagation(); toggleHidden(c.key); }}
                        className={`p-1 shrink-0 ${c.hidden ? 'text-indigo-400' : 'text-slate-300 hover:text-slate-600'}`}>
                        {c.hidden ? <Eye size={13} /> : <EyeOff size={13} />}
                      </button>
                      <button disabled={idx === 0} onClick={e => { e.stopPropagation(); moveType(c.key, -1); }}
                        className="p-1 text-slate-300 hover:text-slate-600 disabled:opacity-20 shrink-0"><ChevronUp size={13} /></button>
                      <button disabled={idx === taxo.allTypes.length - 1} onClick={e => { e.stopPropagation(); moveType(c.key, 1); }}
                        className="p-1 text-slate-300 hover:text-slate-600 disabled:opacity-20 shrink-0"><ChevronDown size={13} /></button>
                    </div>
                    <p className="text-[10px] font-bold text-slate-400 px-2 mt-0.5">
                      <span className="text-slate-300">{c.key}</span>
                      {c.hidden && <span> · 안 씀</span>}
                      {n > 0 && <span> · 품목 {n}개</span>}
                    </p>
                  </div>
                );
              })}
              <p className="text-[10px] font-bold text-slate-300 leading-relaxed pt-2 px-1">
                회색 글씨는 내부 키입니다. 재고 차감·원료식이 이걸 보고 움직이므로 바뀌지 않고,
                화면에 나오는 이름만 바뀝니다.
              </p>
            </div>

            {listPane('subtype', `${taxo.labelOf(sel)} 서브타입`, <Boxes size={12} />, subRows, addSub, setAddSub, '없음 (선택)')}
            {listPane('category', `${taxo.labelOf(sel)} 카테고리`, <Tag size={12} />, catRows, addCat, setAddCat, '없음')}
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
