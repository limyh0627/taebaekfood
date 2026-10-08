import React, { useMemo, useState } from 'react';
import { isBulkItem } from '../src/shared/itemTaxonomy';
import { type BomIndex } from '../src/shared/bomIndex';
import { Item, ItemFormula } from '../types';
import { baseRawName } from '../src/constants/formula';
import { ShieldAlert, ShieldCheck, ChevronDown, ChevronUp } from 'lucide-react';
import { buildFormula } from '../src/features/admin/bom';
import { docName } from '../src/shared/docName';

interface Props { items: Item[]; itemFormulas?: ItemFormula[]; bomIndex: BomIndex }

/**
 * BOM·재고 정합성 점검 — 출고 시 "조용히 안 빠지는" 케이스를 화면에 노출한다.
 * (이름/ID 참조가 끊기거나 원료 홀더 category가 맞지 않으면 차감이 조용히 누락되어 재고·수불부가 어긋남)
 */
const BomIntegrityPanel: React.FC<Props> = ({ items, itemFormulas = [], bomIndex }) => {
  const [open, setOpen] = useState(false);

  const r = useMemo(() => {
    // 원료 홀더 = raw, 또는 wip 벌크 반제품(볶음참깨류·들깨가루). unit='개' 캔/포장 SKU·phantom은 제외(엔진과 동일 판별).
    const isHolder = (it: Item) => !it.phantom && isBulkItem(it);
    const holderByRaw: Record<string, Item> = {};
    for (const it of items) {
      if (isHolder(it)) holderByRaw[baseRawName(it.name)] = it;
    }
    // phantom 반제품(무재고) — 배합식 전개 대상이므로 홀더가 없어도 정상(끊긴참조/orphan 오탐 방지).
    const phantomNames = new Set(items.filter(i => i.phantom).map(i => baseRawName(i.name)));
    const prods = items.filter(i => i.type === 'product' && !i.archived);
    const label = (p: Item) => [p.name, p.spec].filter(Boolean).join(' · ');

    const brokenSub: { product: string; id: string; name?: string }[] = [];
    const missingRaw: { product: string; raw: string }[] = [];
    const noBom: string[] = [];
    const noSub: string[] = [];

    // 조립품 = BOM에 완제품 구성품이 든 것(박스·선물세트). 원료는 그 구성품에서 나가므로
    // 자기 원료식이 없는 게 정상 → 원료식 검사 대상에서 뺀다.
    const isAssembly = (p: Item) =>
      bomIndex.of(p.id).some(l => l.child?.type === 'product');

    for (const p of prods) {
      if (isAssembly(p)) continue;   // 박스·선물세트 등 조립품은 원료식 안 가짐(정상)
      // 실제 생산과 같은 우선순위: 벌크 구성 → phantom 전개 → 품목 서류명 원료식.
      const bulk = bomIndex.of(p.id).filter(line => isBulkItem(line.child));
      const rows = bulk.length > 0
        ? bulk.flatMap(line => !line.child || !Number.isFinite(line.qty) || line.qty <= 0 ? [] : line.child.phantom
          ? buildFormula(line.child.name, itemFormulas, items).filter(row => row.ratio > 0)
          : [{ raw: baseRawName(line.child.name), ratio: line.qty }])
        : buildFormula(docName(p), itemFormulas, items).filter(row => row.ratio > 0);
      if (rows.length === 0) noBom.push(label(p));
      else for (const { raw } of rows) {
        if (!holderByRaw[raw]) missingRaw.push({ product: label(p), raw });
      }
      const subs = bomIndex.of(p.id);
      if (subs.length === 0) noSub.push(label(p));
      //  자식 품목을 못 찾는 줄 = 지워진 품목을 가리키는 BOM. 원가·차감에서 조용히 빠진다.
      else for (const l of subs) if (!l.child) brokenSub.push({ product: label(p), id: l.childId, name: l.childId });
    }
    const prodKeys = new Set(items.filter(i => i.type === 'product').map(docName));
    const wipKeys = new Set(items.filter(i => i.type === 'wip').map(i => baseRawName(i.name)));
    // orphan = 완제품도 원료홀더(반제품 수율 BOM의 부모)도 phantom 반제품도 아닌 parent_key
    const orphan = [...new Set(itemFormulas.map(f => f.parent_key))].filter(k => !prodKeys.has(k) && !wipKeys.has(k) && !holderByRaw[k] && !phantomNames.has(k));

    const total = brokenSub.length + missingRaw.length + noBom.length + orphan.length;
    return { brokenSub, missingRaw, noBom, noSub, orphan, total };
  }, [items, itemFormulas, bomIndex]);

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
          <p className="text-[11px] text-slate-400">생산 원료 구성과 원가 계산에 쓰는 참조를 점검합니다. 누락된 구성과 연결되지 않은 품목·원료식을 확인해 주세요.</p>

          {r.brokenSub.length > 0 && (
            <Section tone="bg-rose-50 text-rose-600" title={`🔴 부자재 끊긴 참조 ${r.brokenSub.length}건 — 구성 품목 확인 필요`}>
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
