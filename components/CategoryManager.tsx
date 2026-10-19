import { commitTaxonomyType } from '../src/features/items/infrastructure/taxonomyOrderWrites';
import { useTaxonomyOrder } from '../src/features/items/hooks/useTaxonomyOrder';
import { auth } from '../src/shared/firebase';
import { appConfirm } from '../src/shared/components/appDialog';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { where } from 'firebase/firestore';
import { Plus, Trash2, ChevronUp, ChevronDown, Tag, Layers, RotateCcw, Eye, EyeOff, Boxes } from 'lucide-react';
import { fetchCollection, addItem, updateItem, deleteItem } from '../src/shared/services/firebaseService';
import {
  buildTaxonomy, defaultTaxonomyRows, CATEGORY_KEYS, DEFAULT_CATEGORY_LABELS, TaxonomyRow,
} from '../src/shared/taxonomy';
import type { CompanyId } from '../src/shared/types';
import LargeModalShell from '../src/shared/components/LargeModalShell';

const COL = 'itemTaxonomy';

interface Props {
  onClose: () => void;
  onSaved?: (rows: TaxonomyRow[]) => void;
  /** 쓰고 있는 품목 수 — 지울 때 경고용. 'type:product' / 'sub:product:낱개' / 'cat:product:참기름' */
  usage?: Record<string, number>;
  companyId: CompanyId;
}

const CompanyCategoryManager: React.FC<Props> = ({ onClose, onSaved, usage = {}, companyId }) => {
  const [rows, setRows] = useState<TaxonomyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<string>('product');
  const [addSub, setAddSub] = useState('');
  const [addCat, setAddCat] = useState('');
  const [loadError, setLoadError] = useState('');
  const loadingRequest = useRef({ active: false, generation: 0 });
  const confirmedRows = useRef<TaxonomyRow[]>([]);
  const hasConfirmed = useRef(false);
  const actorUid = auth.currentUser?.uid;
  const acknowledge = (update: (rows: TaxonomyRow[]) => TaxonomyRow[]) => {
    confirmedRows.current = update(confirmedRows.current).map(row => ({...row}));
  };
  const order = useTaxonomyOrder({companyId, actorUid, rows, onOrderAck: next => {
    if (!loadingRequest.current.active || auth.currentUser?.uid !== actorUid) return;
    const mergeOrder = (previous:TaxonomyRow[]) => {
      const changed = new Map(next.map(row => [row.id,row]));
      const createdKeys = new Set(next.filter(row => 'kind' in row).map(row => 'key' in row ? row.key : undefined));
      const merged = previous.filter(row => !row.id.startsWith('tmp-') || !createdKeys.has(row.key))
        .map(row => changed.has(row.id) ? {...row,order:changed.get(row.id)!.order} : row);
      for (const row of next) if ('kind' in row && !merged.some(old => old.id===row.id)) merged.push({...row});
      return merged;
    };
    setRows(mergeOrder);
    // 이름 입력 중인 draft를 순서 ACK에 섞어 저장 완료로 넘기지 않는다.
    acknowledge(previous => [...previous.filter(row=>!next.some(ack=>ack.id===row.id)),...next.map(row=>({...row}))]);
  }});
  const {busy} = order;
  const mutationLocked = busy || order.needsReload;
  const runAction: typeof order.runAction = task => order.runAction(context => task({isCurrent: () => loadingRequest.current.active && auth.currentUser?.uid === actorUid && context.isCurrent()}));

  const load = async () => {
    if (!loadingRequest.current.active || busy) return;
    const generation = ++loadingRequest.current.generation;
    const isCurrent = () => loadingRequest.current.active && loadingRequest.current.generation === generation && auth.currentUser?.uid === actorUid;
    setLoading(true);
    setLoadError('');
    try {
      const got = await fetchCollection<TaxonomyRow>(COL, [where('companyId', '==', companyId)]);
      if (!isCurrent()) return;
      if (got.length === 0) {
        const seeded: TaxonomyRow[] = [];
        for (const r of defaultTaxonomyRows()) {
          if (!isCurrent()) return;
          const saved = r.kind==='type' && r.key
            ? await commitTaxonomyType({companyId,key:r.key,mode:'seed'}, {companyId,actorUid:actorUid??'',isCurrent})
            : {...r,id:String(await addItem(COL,{...r,companyId})),companyId};
          if (!isCurrent()) return;
          seeded.push(saved);
        }
        setRows(seeded); confirmedRows.current = seeded.map(row => ({...row})); hasConfirmed.current=true; order.markReloaded(seeded);
      } else {
        setRows(got); confirmedRows.current = got.map(row => ({...row})); hasConfirmed.current=true; order.markReloaded(got);
      }
    } catch (error) {
      if (!isCurrent()) return;
      console.error('[분류관리 조회 실패]', error);
      setLoadError('분류를 불러오지 못했습니다. 다시 시도해 주세요.');
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };
  useEffect(() => {
    loadingRequest.current.active = true;
    void load();
    return () => { loadingRequest.current.active = false; loadingRequest.current.generation++; };
  }, [companyId, actorUid]);

  const taxo = useMemo(() => buildTaxonomy(rows), [rows]);
  const typeRow = (key: string) => rows.find(r => (r.kind === 'type' || (r.kind === 'category' && r.key && !r.parent)) && r.key === key);
  const listOf = (kind: 'subtype' | 'category') =>
    rows.filter(r => r.kind === kind && r.parent === sel).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const subRows = useMemo(() => listOf('subtype'), [rows, sel]);
  const catRows = useMemo(() => listOf('category'), [rows, sel]);

  // 이름 입력은 draft에만 남기고 실제 ACK 필드만 확인 사본에 반영한다.
  const renameType = (key: string, label: string) => {
    if (mutationLocked) return;
    const ex = typeRow(key);
    setRows(rs => ex ? rs.map(r => r.id === ex.id ? {...r,label} : r)
      : [...rs,{id:'tmp-'+key,kind:'type',key,label,order:CATEGORY_KEYS.indexOf(key as never)} as TaxonomyRow]);
  };
  const commitType = async (key: string) => {
    const r = typeRow(key); if (!r) return;
    const label = (r.label || '').trim() || DEFAULT_CATEGORY_LABELS[key] || key;
    await runAction(async context => {
      if (!context.isCurrent()) return;
      if (r.id.startsWith('tmp-')) {
        const saved = await commitTaxonomyType({companyId,key,mode:'rename',label}, {companyId,actorUid:actorUid??'',isCurrent:context.isCurrent});
        if (!context.isCurrent()) return;
        const apply = (rs:TaxonomyRow[]) => [...rs.filter(x=>x.id!==r.id && x.id!==saved.id),{...saved}];
        setRows(apply); acknowledge(apply);
      } else {
        await updateItem(COL,r.id,{label}); if (!context.isCurrent()) return;
        setRows(rs => rs.map(x => x.id === r.id ? {...x,label} : x));
        acknowledge(rs => rs.map(x => x.id === r.id ? {...x,label} : x));
      }
    });
  };
  const toggleHidden = async (key: string) => {
    const r=typeRow(key),next=!r?.hidden,n=usage['type:'+key]??0;
    await runAction(async context => {
      if (next && n>0 && !await appConfirm('"'+taxo.labelOf(key)+'"에 품목이 '+n+'개 있습니다.\n숨기면 등록 화면·필터에서 안 보이지만 품목과 재고는 그대로입니다.\n숨길까요?')) return;
      if (!context.isCurrent()) return;
      if (r && !r.id.startsWith('tmp-')) {
        await updateItem(COL,r.id,{hidden:next}); if (!context.isCurrent()) return;
        setRows(rs => rs.map(x => x.id===r.id ? {...x,hidden:next} : x));
        acknowledge(rs => rs.map(x => x.id===r.id ? {...x,hidden:next} : x));
      } else {
        const saved=await commitTaxonomyType({companyId,key,mode:'hide',hidden:next}, {companyId,actorUid:actorUid??'',isCurrent:context.isCurrent});
        if (!context.isCurrent()) return;
        const apply=(rs:TaxonomyRow[])=>[...rs.filter(x=>x.id!==saved.id && (!r || x.id!==r.id)),{...saved}];
        setRows(apply); acknowledge(apply);
      }
    });
  };
  const resetTypeName = async (key: string) => {
    const r=typeRow(key); if (!r || r.id.startsWith('tmp-')) return;
    await runAction(async context => {
      if (!context.isCurrent()) return;
      const label=DEFAULT_CATEGORY_LABELS[key]; await updateItem(COL,r.id,{label}); if (!context.isCurrent()) return;
      setRows(rs => rs.map(x=>x.id===r.id?{...x,label}:x)); acknowledge(rs=>rs.map(x=>x.id===r.id?{...x,label}:x));
    });
  };
  const addRow = async (kind:'subtype'|'category',label:string,reset:()=>void) => {
    const l=label.trim(),parent=sel,cur=kind==='subtype'?subRows:catRows;
    if (!l || mutationLocked) return;
    if (cur.some(r=>r.label===l)) { alert('이미 있습니다.'); return; }
    await runAction(async context => {
      if (!context.isCurrent()) return;
      const saved={kind,parent,label:l,order:cur.length?Math.max(...cur.map(r=>r.order??0))+1:0,companyId};
      const id=String(await addItem(COL,saved)); if (!context.isCurrent()) return;
      setRows(rs=>[...rs,{...saved,id}]); acknowledge(rs=>[...rs,{...saved,id}]); reset();
    });
  };
  const renameRow = (r:TaxonomyRow,label:string) => {if(!mutationLocked)setRows(rs=>rs.map(x=>x.id===r.id?{...x,label}:x));};
  const commitRow = async (r:TaxonomyRow) => {
    const label=(rows.find(x=>x.id===r.id)?.label??'').trim();
    if (!label) { if(!mutationLocked)await load(); return; }
    await runAction(async context=>{
      if (!context.isCurrent()) return;
      await updateItem(COL,r.id,{label}); if(!context.isCurrent())return;
      acknowledge(rs=>rs.map(x=>x.id===r.id?{...x,label}:x));
    });
  };
  const removeRow = async (r:TaxonomyRow,kind:'subtype'|'category') => {
    const n=usage[(kind==='subtype'?'sub':'cat')+':'+sel+':'+r.label]??0;
    const msg=n>0?'"'+r.label+'"을(를) 쓰는 품목이 '+n+'개 있습니다.\n분류만 지우고 품목은 그대로 둡니다 — 그 품목들은 이 값 없이 남습니다.\n지울까요?':'"'+r.label+'"을(를) 지울까요?';
    await runAction(async context=>{
      if (!await appConfirm(msg) || !context.isCurrent()) return;
      await deleteItem(COL,r.id); if(!context.isCurrent())return;
      setRows(rs=>rs.filter(x=>x.id!==r.id)); acknowledge(rs=>rs.filter(x=>x.id!==r.id));
    });
  };
  const close = () => {
    loadingRequest.current.active=false;loadingRequest.current.generation++;
    if (hasConfirmed.current) onSaved?.(confirmedRows.current.map(row=>({...row})));
    onClose();
  };

  // 서브타입·카테고리 목록 한 벌 — 같은 모양이라 렌더러를 공유한다
  const listPane = (
    kind: 'subtype' | 'category', title: string, icon: React.ReactNode,
    list: TaxonomyRow[], value: string, setValue: (s: string) => void, hint: string,
  ) => (
    <div className="flex-1 flex flex-col min-h-0 border-t md:border-t-0 md:border-l border-slate-100">
      <div className="p-4 pb-2 shrink-0">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
          {icon} {title}
        </p>
      </div>
      <div className="flex-1 md:overflow-y-auto px-4 space-y-1.5">
        {list.length === 0 && <p className="text-xs font-bold text-slate-300 py-6 text-center">{hint}</p>}
        {list.map((r, i) => {
          const n = usage[`${kind === 'subtype' ? 'sub' : 'cat'}:${sel}:${r.label}`] ?? 0;
          return (
            <div key={r.id} className="flex items-center gap-1 border border-slate-150 rounded-xl px-2 py-1.5">
              <input disabled={mutationLocked}
                value={r.label}
                onChange={e => renameRow(r, e.target.value)}
                onBlur={() => commitRow(r)}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                className="flex-1 min-w-0 bg-transparent text-sm font-black text-slate-700 outline-none focus:bg-slate-50 rounded-lg px-1.5 py-0.5"
              />
              {n > 0 && <span className="text-[10px] font-black text-slate-300 shrink-0">{n}</span>}
              <button aria-label={r.label+' 순서 위로'} disabled={mutationLocked || i === 0} onClick={() => order.moveRow(r, -1, kind, sel)}
                className="p-1 text-slate-300 hover:text-slate-600 disabled:opacity-20 shrink-0"><ChevronUp size={13} /></button>
              <button aria-label={r.label+' 순서 아래로'} disabled={mutationLocked || i === list.length - 1} onClick={() => order.moveRow(r, 1, kind, sel)}
                className="p-1 text-slate-300 hover:text-slate-600 disabled:opacity-20 shrink-0"><ChevronDown size={13} /></button>
              <button disabled={mutationLocked} onClick={() => removeRow(r, kind)}
                className="p-1 text-slate-300 hover:text-rose-500 shrink-0"><Trash2 size={13} /></button>
            </div>
          );
        })}
      </div>
      <div className="p-4 pt-2 shrink-0 flex gap-2">
        <input disabled={mutationLocked}
          value={value} onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addRow(kind, value, () => setValue('')); }}
          placeholder="추가"
          className="flex-1 min-w-0 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-400"
        />
        <button onClick={() => addRow(kind, value, () => setValue(''))} disabled={!value.trim() || mutationLocked}
          className="px-3 py-2 bg-indigo-600 text-white rounded-xl disabled:opacity-30 shrink-0"><Plus size={16} /></button>
      </div>
    </div>
  );

  return (
    <LargeModalShell title="분류 관리" onClose={close} bodyClassName="!p-0" footer={<button onClick={close} className="px-5 py-2.5 bg-slate-900 text-white font-bold rounded-xl text-sm">닫기</button>}>

        {busy && <p role="status" className="px-4 py-3 text-sm text-slate-600">분류를 저장하고 있습니다. 완료 응답을 기다려 주세요.</p>}
        {!busy && order.error && <div className="px-4 py-3 text-sm text-slate-600"><p role="status" className="whitespace-pre-line">{order.error}</p>{order.needsReload && <button type="button" disabled={busy || loading} onClick={()=>void load()} className="mt-2 rounded border border-slate-200 px-3 py-2 text-xs">최신 목록 다시 읽기</button>}</div>}
        {loading ? (
          <div className="flex-1 flex items-center justify-center text-sm font-bold text-slate-400">불러오는 중…</div>
        ) : loadError ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm font-bold text-rose-600">{loadError}</p>
            <button type="button" onClick={() => void load()} className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-black text-white">다시 시도</button>
          </div>
        ) : (
          /*  **폰에서는 위아래로 쌓는다**(2026-09-06 사장님: "모바일 ui 수정 좀").
              세 칸을 나란히 두니 폰에서 '타입' 이 한 글자씩 세로로 쪼개지고, 오른쪽
              개수와 화살표가 화면 밖으로 밀려 나갔다. 넓은 화면(md~)은 그대로 셋을 나란히. */
          <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-y-auto md:overflow-hidden">
            {/* 타입 */}
            <div className="w-full md:w-[38%] md:overflow-y-auto p-4 space-y-2 shrink-0">
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
                      <input disabled={mutationLocked}
                        value={r?.label ?? c.label}
                        onChange={e => renameType(c.key, e.target.value)}
                        onBlur={() => commitType(c.key)}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        className="flex-1 min-w-0 bg-transparent text-sm font-black text-slate-800 outline-none focus:bg-white focus:border-indigo-300 border border-transparent rounded-lg px-2 py-1"
                      />
                      {changed && (
                        <button disabled={mutationLocked} title="기본 이름으로" onClick={e => { e.stopPropagation(); resetTypeName(c.key); }}
                          className="p-1 text-slate-300 hover:text-indigo-500 shrink-0"><RotateCcw size={12} /></button>
                      )}
                      <button disabled={mutationLocked} title={c.hidden ? '다시 쓰기' : '안 씀 (숨김)'} onClick={e => { e.stopPropagation(); toggleHidden(c.key); }}
                        className={`p-1 shrink-0 ${c.hidden ? 'text-indigo-400' : 'text-slate-300 hover:text-slate-600'}`}>
                        {c.hidden ? <Eye size={13} /> : <EyeOff size={13} />}
                      </button>
                      <button aria-label={c.label+' 타입 위로'} disabled={mutationLocked || idx === 0} onClick={e => { e.stopPropagation(); order.moveType(c.key, -1); }}
                        className="p-1 text-slate-300 hover:text-slate-600 disabled:opacity-20 shrink-0"><ChevronUp size={13} /></button>
                      <button aria-label={c.label+' 타입 아래로'} disabled={mutationLocked || idx === taxo.allTypes.length - 1} onClick={e => { e.stopPropagation(); order.moveType(c.key, 1); }}
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

    </LargeModalShell>
  );
};

const CategoryManager: React.FC<Props> = props => <CompanyCategoryManager key={props.companyId+':'+(auth.currentUser?.uid??'')} {...props} />;
export default CategoryManager;
