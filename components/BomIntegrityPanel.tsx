import React, { useMemo, useState } from 'react';
import { Item } from '../types';
import { PRODUCT_FORMULA, baseRawName } from '../src/constants/formula';
import { ShieldAlert, ShieldCheck, ChevronDown, ChevronUp } from 'lucide-react';

interface FormulaRow { parent_key: string; child_name: string; ratio: number; yield_rate?: number }
interface Props { items: Item[]; itemFormulas?: FormulaRow[] }

/**
 * BOM·재고 정합성 점검 — 출고 시 "조용히 안 빠지는" 케이스를 화면에 노출한다.
 * (이름/ID 참조가 끊기거나 원료 홀더 category가 맞지 않으면 차감이 조용히 누락되어 재고·수불부가 어긋남)
 */
const BomIntegrityPanel: React.FC<Props> = ({ items, itemFormulas = [] }) => {
  const [open, setOpen] = useState(false);

  const r = useMemo(() => {
    const byId = new Map(items.map(i => [i.id, i]));
    const formByKey: Record<string, FormulaRow[]> = {};
    itemFormulas.forEach(f => { (formByKey[f.parent_key] = formByKey[f.parent_key] || []).push(f); });
    // 원료 홀더 = raw, 또는 wip 벌크 반제품(볶음참깨류·들깨가루). unit='개' 캔/포장 SKU·phantom은 제외(엔진과 동일 판별).
    const isHolder = (it: Item) => !it.phantom && (it.category === 'raw' || (it.category === 'wip' && (it as any).unit !== '개'));
    const holderByRaw: Record<string, Item> = {};
    for (const it of items) {
      if (isHolder(it)) holderByRaw[baseRawName(it.name)] = it;
    }
    // phantom 반제품(무재고) — 배합식 전개 대상이므로 홀더가 없어도 정상(끊긴참조/orphan 오탐 방지).
    const phantomNames = new Set(items.filter(i => i.phantom).map(i => baseRawName(i.name)));
    const prods = items.filter(i => i.category === 'product');

    const brokenSub: { product: string; id: string; name?: string }[] = [];
    const missingRaw: { product: string; raw: string }[] = [];
    const noBom: string[] = [];
    const noSub: string[] = [];

    for (const p of prods) {
      const key = (p as any).품목 || p.name;
      const rows = formByKey[key]
        ? formByKey[key].map(f => ({ raw: f.child_name }))
        : (PRODUCT_FORMULA[key]?.map(x => ({ raw: x.raw })) ?? null);
      if (!rows) noBom.push(p.name);
      else for (const { raw } of rows) {
        if (!holderByRaw[raw] && !phantomNames.has(raw)) missingRaw.push({ product: p.name, raw });
      }
      const subs = (p as any).submaterials;
      if (!Array.isArray(subs) || subs.length === 0) noSub.push(p.name);
      else for (const s of subs) if (!s.id || !byId.has(s.id)) brokenSub.push({ product: p.name, id: s.id, name: (s as any).name });
    }
    const prodKeys = new Set(prods.map(p => (p as any).품목 || p.name));
    // orphan = 완제품도 원료홀더(반제품 수율 BOM의 부모)도 phantom 반제품도 아닌 parent_key
    const orphan = [...new Set(itemFormulas.map(f => f.parent_key))].filter(k => !prodKeys.has(k) && !holderByRaw[k] && !phantomNames.has(k));

    const total = brokenSub.length + missingRaw.length + noBom.length + orphan.length;
    return { brokenSub, missingRaw, noBom, noSub, orphan, total };
  }, [items, itemFormulas]);

  const clean = r.total === 0;

  const Section: React.FC<{ tone: string; title: string; children: React.ReactNode }> = ({ tone, title, children }) => (
    <div className="rounded-xl border border-slate-100 overflow-hidden">
      <div className={`px-3 py-2 text-[11px] font-black ${tone}`}>{title}</div>
      <div className="px-3 py-2 text-[11px] text-slate-600 space-y-0.5 max-h-40 overflow-y-auto">{children}</div>
    </div>
  );

  return (
    <div className={`rounded-2xl border ${clean ? 'border-emerald-100 bg-emerald-50/40' : 'border-amber-200 bg-amber-50/40'} mb-4`}>
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          {clean ? <ShieldCheck size={16} className="text-emerald-600" /> : <ShieldAlert size={16} className="text-amber-600" />}
          <span className="text-xs font-black text-slate-700 uppercase tracking-widest">BOM · 재고 정합성</span>
          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${clean ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
            {clean ? '이상 없음' : `점검 ${r.total}건`}
          </span>
        </div>
        {open ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
      </button>

      {open && !clean && (
        <div className="px-4 pb-4 space-y-2">
          <p className="text-[11px] text-slate-400">출고해도 <b>조용히 재고에서 안 빠지는</b> 항목들이에요. 고치면 재고·수불부 어긋남이 사라져요.</p>

          {r.brokenSub.length > 0 && (
            <Section tone="bg-rose-50 text-rose-600" title={`🔴 부자재 끊긴 참조 ${r.brokenSub.length}건 — 이 부자재가 출고 시 차감 안 됨`}>
              {r.brokenSub.slice(0, 80).map((b, i) => (
                <div key={i} className="truncate"><b className="text-slate-700">{b.product}</b> → <span className="text-rose-500 font-bold">{b.name || '(이름없음)'}</span>{!b.name && <span className="font-mono text-slate-400"> {b.id}</span>}</div>
              ))}
              {r.brokenSub.length > 80 && <div className="text-slate-400">외 {r.brokenSub.length - 80}건</div>}
            </Section>
          )}

          {r.missingRaw.length > 0 && (
            <Section tone="bg-amber-50 text-amber-700" title={`🟡 원료 홀더 없음 ${r.missingRaw.length}건`}>
              {r.missingRaw.slice(0, 20).map((m, i) => <div key={i} className="truncate"><b>{m.product}</b> → 원료 '{m.raw}' 홀더 품목 없음</div>)}
            </Section>
          )}

          {r.noBom.length > 0 && (
            <Section tone="bg-amber-50 text-amber-700" title={`🟡 원료 BOM 없는 완제품 ${r.noBom.length}개`}>
              {r.noBom.slice(0, 20).map((n, i) => <div key={i} className="truncate">{n}</div>)}
            </Section>
          )}

          {r.orphan.length > 0 && (
            <Section tone="bg-sky-50 text-sky-700" title={`🔵 orphan BOM ${r.orphan.length}건 (완제품 없는 parent_key)`}>
              {r.orphan.map((o, i) => <div key={i} className="truncate">{o}</div>)}
            </Section>
          )}

          {r.noSub.length > 0 && (
            <Section tone="bg-slate-50 text-slate-500" title={`⚪ 부자재 BOM 미설정 완제품 ${r.noSub.length}개 (참고)`}>
              {r.noSub.slice(0, 20).map((n, i) => <div key={i} className="truncate">{n}</div>)}
            </Section>
          )}
        </div>
      )}
    </div>
  );
};

export default BomIntegrityPanel;
