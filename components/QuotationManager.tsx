import React, { useState, useMemo, useEffect } from 'react';
import { Plus, X, Trash2, Search, Printer, FileText, Copy, Pencil } from 'lucide-react';
import { Item, Partner, PartnerItem, CompanyId, CompanyInfo, COMPANIES, companyOf } from '../src/shared/types';
import { matchesSearch } from '../src/shared/hangul';
import { subscribeToCollection, addItem, deleteItem } from '../src/shared/services/firebaseService';
import PageHeader from './PageHeader';
import { today, addDays as plusDays } from '../src/shared/day';
import { marginOf } from '../src/shared/margin';
import { lineAmount } from '../src/shared/lineAmount';
import { quoteTotals } from '../src/shared/quoteTotals';
import { isSaleTaxExempt, saleTaxTypeOf } from '../src/shared/partnerPrice';
import { boxDerivedUnitPrice } from '../src/shared/orderUnits';
import ItemFilterBar from '../src/shared/ui/ItemFilterBar';
import { filterItems, ALL } from '../src/shared/itemFilter';
import { quoteRecipient } from '../src/shared/quoteRecipient';
import { where } from 'firebase/firestore';
import { DEFAULT_COMPANY_INFO } from '../src/config';

/**
 * **견적서** — 팔기 전에 얼마에 줄지 적어 내미는 종이.
 *
 * 전표(거래명세서)와 다른 점은 **아직 판 게 아니라는 것**이다. 그래서 회계에 아무것도 안 남긴다 —
 * 분개도, 채권도, 재고도 안 움직인다. 나중에 그 값으로 실제로 팔면 그때 전표를 끊는다.
 *
 * 그리고 견적은 대개 **안 팔던 걸 새로 팔 때** 낸다. 그래서 품목 고르는 자리가
 * 거래처에 등록된 것 위주면 안 된다 — 전 품목을 빠르게 뒤질 수 있어야 한다.
 * 값을 매기려면 원가가 보여야 하고, 단가를 넣으면 남는 게 바로 보여야 한다.
 */
export interface QuotationLine {
  /** 품목에서 골랐으면 그 id — 원가를 되찾는 데 쓴다. 직접 적은 줄은 없다. */
  itemId?: string;
  name: string;
  spec: string;
  /** 견적 당시 단위 스냅샷 — 품목의 단위가 나중에 바뀌어도 발행본은 그대로 남긴다. */
  unit?: string;
  qty: number;
  price: number;
  /** 낼 때의 원가 — 나중에 원료값이 바뀌어도 그때 얼마로 셈했는지 남는다 */
  cost?: number;
  /**
   * 면세면 부가세를 안 붙인다. **안 정했으면 `undefined`** —
   * 과세를 기본으로 두면 안 고르고 그냥 지나간다(2026-09-09 사장님).
   */
  isTaxExempt?: boolean;
  note?: string;
}

export interface Quotation {
  id: string;
  companyId?: CompanyId;
  quoteNo: string;
  date: string;                 // 'YYYY-MM-DD'
  /** 이 날까지 이 값이다 — 비우면 안 적는다 */
  validUntil?: string;
  /** 등록 거래처면 ID, 미등록 문의처 견적이면 빈 문자열 */
  partnerId: string;
  partnerName: string;
  /** 받는 업체 연락처 — 등록 거래처 값 또는 미등록 업체에 직접 적은 값을 견적에 남긴다. */
  recipientPhone?: string;
  /**
   * 담당자 — **이 견적을 낸 우리 쪽 사람.** 받는 쪽이 물어볼 데가 있어야 한다.
   * 새로 쓸 때는 쓰는 사람 이름이 저절로 들어간다(2026-09-05 사장님).
   */
  attention?: string;
  deliveryTerms?: string;
  paymentTerms?: string;
  lines: QuotationLine[];
  totalSupply: number;
  totalTax: number;
  totalAmount: number;
  /** 낼 때의 원가 합 — 나중에 "이 견적 남는 거였나"를 되짚을 수 있게 */
  totalCost?: number;
  note?: string;
  createdAt: string;
  createdBy?: string;
}

interface Props {
  items: Item[];
  partners: Partner[];
  partnerItems?: PartnerItem[];
  companyId?: CompanyId;
  currentUser?: { id: string; name: string };
  companyInfo?: CompanyInfo | null;
  /** 품목 원가 — 재고평가와 같은 롤업을 쓴다(AdminApp이 넘긴다) */
  costOf?: (_item: Item) => number;
}

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR');
//  날짜 셈은 shared/day 하나로 — 손으로 하면 toISOString 이 UTC로 되돌려 하루가 밀린다
//  (한국 자정은 UTC로 전날 15:00이다). 유효기한이 29일 뒤로 잡히던 자리다.
const num = (v: string) => Number(String(v).replace(/[^\d.]/g, '')) || 0;

/** 그날 안에서 이어지는 번호 — 전표와 같은 꼴(`Q260901-01`)이되 통은 따로 쓴다 */
function nextQuoteNo(date: string, existing: { quoteNo?: string }[]): string {
  const head = `Q${date.slice(2).replace(/-/g, '')}-`;
  let max = 0;
  for (const q of existing) {
    const no = q.quoteNo ?? '';
    if (!no.startsWith(head)) continue;
    const tail = no.slice(head.length);
    if (/^[0-9]+$/.test(tail)) max = Math.max(max, Number(tail));
  }
  return `${head}${String(max + 1).padStart(2, '0')}`;
}

//  **과세를 기본으로 두지 않는다** — 안 고른 줄은 저장이 막힌다(2026-09-09 사장님).
//  합계 셈은 [shared/quoteTotals](../src/shared/quoteTotals.ts) 하나다.
const emptyLine = (): QuotationLine => ({ name: '', spec: '', qty: 1, price: 0 });

export default function QuotationManager({ items, partners, partnerItems = [], companyId = 'taebaek', currentUser, companyInfo, costOf }: Props) {
  const [quotes, setQuotes] = useState<Quotation[]>([]);
  const [quoteError, setQuoteError] = useState('');
  useEffect(() => subscribeToCollection<Quotation>(
    'quotations',
    rows => { setQuotes(rows); setQuoteError(''); },
    // Firestore 규칙은 목록을 결과에서 거르는 필터가 아니다. 회사 조건 없는 전체 조회는
    // 다른 회사 문서까지 읽을 가능성이 있어, 현재 태백 문서만 있어도 규칙이 거부한다.
    [where('companyId', '==', companyId)],
    error => {
      console.error('[견적서 목록 불러오기 실패]', error);
      setQuoteError(`견적서 목록을 불러오지 못했습니다. ${error.message}`);
    },
  ), [companyId]);

  const [search, setSearch] = useState('');
  const [viewing, setViewing] = useState<Quotation | null>(null);
  const [form, setForm] = useState<{
    date: string; validUntil?: string; partnerId: string; partnerName: string; recipientPhone?: string;
    attention?: string; deliveryTerms?: string; paymentTerms?: string; lines: QuotationLine[]; note?: string;
  }>({
    date: today(), validUntil: plusDays(today(), 30),
    //  담당자는 **쓰는 사람**이 기본이다 — 매번 제 이름을 치게 할 일이 아니다
    partnerId: '', partnerName: '', recipientPhone: '', attention: currentUser?.name ?? '',
    deliveryTerms: '', paymentTerms: '', lines: [emptyLine()], note: '',
  });
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [partnerSearch, setPartnerSearch] = useState('');
  const [pickIdx, setPickIdx] = useState<number | null>(null);
  const [itemSearch, setItemSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const mine = useMemo(
    () => quotes.filter(q => companyOf(q) === companyId)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.quoteNo).localeCompare(String(a.quoteNo))),
    [quotes, companyId],
  );
  const shown = useMemo(
    () => mine.filter(q => !search.trim()
      || matchesSearch(`${q.partnerName} ${q.lines.map(l => l.name).join(' ')}`, search.trim())
      || q.quoteNo.includes(search.trim())),
    [mine, search],
  );
  const totals = quoteTotals(form.lines);
  const companyName = COMPANIES.find(c => c.id === companyId)?.name ?? '';
  // 인쇄본의 공급자 정보는 사용자가 견적마다 다시 치는 값이 아니다. 회사 설정을 쓰고,
  // 설정 구독 전에도 빈칸이 생기지 않도록 태백식품 기본정보를 받친다.
  const printCompany = companyInfo ?? DEFAULT_COMPANY_INFO;
  const printQuotation = () => {
    // 앱 화면을 인쇄하지 않는다. 견적서 본문과 스타일만 담은 독립 문서를 iframe에 만든 뒤
    // 그 문서를 인쇄한다. 그래야 모달의 가운데 정렬·크기·스크롤이 A4에 섞이지 않는다.
    const source = document.getElementById('quotation-print-document');
    if (!source) return;
    document.getElementById('quotation-print-frame')?.remove();
    const frame = document.createElement('iframe');
    frame.id = 'quotation-print-frame';
    frame.setAttribute('aria-hidden', 'true');
    Object.assign(frame.style, {
      position: 'fixed', width: '1px', height: '1px', right: '0', bottom: '0',
      border: '0', opacity: '0', pointerEvents: 'none',
    });
    const styleTags = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
      .map(node => node.outerHTML).join('\n');
    const printCss = `
      @page { size: A4 portrait; margin: 0; }
      html, body { width: 210mm; margin: 0; padding: 0; background: white; }
      #quotation-print-document {
        display: block !important; width: 210mm !important; min-height: 0 !important;
        margin: 0 !important; padding: 10mm !important; box-sizing: border-box !important;
        overflow: visible !important; font-family: Arial, "Noto Sans KR", sans-serif;
      }
      .print\\:hidden { display: none !important; }
    `;
    const cleanup = () => {
      frame.remove();
    };
    frame.onload = () => {
      const printWindow = frame.contentWindow;
      if (!printWindow) { cleanup(); return; }
      printWindow.addEventListener('afterprint', cleanup, { once: true });
      printWindow.focus();
      printWindow.print();
    };
    document.body.appendChild(frame);
    frame.srcdoc = `<!doctype html><html><head><meta charset="UTF-8"><title></title>${styleTags}<style>${printCss}</style></head><body>${source.outerHTML}</body></html>`;
  };

  /**
   * 그 거래처에 등록된 단가 — 있으면 기본값으로 쓴다.
   *
   * **박스는 낱개 단가 × 개입수다**(2026-09-06 사장님이 마진 −523% 를 보고 물으셨다).
   * 박스 품목엔 단가를 안 박고 낱개만 관리한다(shared/orderUnits). 견적서만 그 규칙을
   * 안 따라서, 박스 품목에 낱개 단가가 붙은 채 박스 원가(12병 값)와 견줘 마진이
   * 수백 % 밑진 것처럼 나왔다. 주문 넣기·전표와 같은 차례로 맞춘다 —
   * **저장된 값 > 낱개 × 개입수**.
   */
  const priceFor = (itemId: string) => {
    const 붙은값 = partnerItems.find(p => p.itemId === itemId && p.partnerId === form.partnerId && p.Direction !== 'in')?.price;
    if (typeof 붙은값 === 'number' && 붙은값 > 0) return 붙은값;
    const it = items.find(i => i.id === itemId);
    return form.partnerId ? boxDerivedUnitPrice(it, form.partnerId, partnerItems as never) : undefined;
  };
  const costFor = (it: Item) => Math.round(costOf?.(it) ?? Number(it.cost ?? 0));

  const resetForm = (base?: Quotation, keepDates = false) => setForm({
    date: keepDates && base ? base.date : today(),
    validUntil: keepDates && base ? base.validUntil : plusDays(today(), 30),
    partnerId: base?.partnerId ?? '', partnerName: base?.partnerName ?? '', recipientPhone: base?.recipientPhone ?? '',
    attention: base?.attention ?? currentUser?.name ?? '',
    deliveryTerms: base?.deliveryTerms ?? '', paymentTerms: base?.paymentTerms ?? '',
    lines: base ? base.lines.map(l => ({ ...l })) : [emptyLine()],
    note: base?.note ?? '',
  });
  const openNew = () => { setEditingId(null); resetForm(); setPartnerSearch(''); setPickIdx(null); setOpen(true); };
  const openCopy = (q: Quotation) => { setEditingId(null); resetForm(q); setPartnerSearch(''); setPickIdx(null); setOpen(true); };
  const openEdit = (q: Quotation) => { setEditingId(q.id); resetForm(q, true); setPartnerSearch(''); setPickIdx(null); setOpen(true); };

  const setLine = (i: number, patch: Partial<QuotationLine>) =>
    setForm(f => ({ ...f, lines: f.lines.map((l, k) => (k === i ? { ...l, ...patch } : l)) }));

  const save = async () => {
    const recipient = quoteRecipient(form.partnerId, form.partnerName);
    if (!recipient) { alert('견적 받을 업체명을 입력하세요.'); return; }
    const lines = form.lines.filter(l => l.name.trim() && Number(l.qty) > 0);
    if (!lines.length) { alert('품목을 한 줄 이상 넣으세요.'); return; }
    //  과세·면세를 안 고르면 세액이 정해지지 않는다 — 값이 틀린 견적서가 나가면 안 된다
    const 미정 = quoteTotals(lines).undecided;
    if (미정 > 0) { alert(`과세·면세를 안 고른 줄이 ${미정}개 있습니다.
'—' 칸을 눌러 골라 주세요.`); return; }
    if (saving) return;
    setSaving(true);
    try {
      const t = quoteTotals(lines);
      const prev = editingId ? mine.find(q => q.id === editingId) : undefined;
      const saved: Quotation = {
        id: prev?.id ?? `quo-${Date.now()}`,
        companyId,
        quoteNo: prev?.quoteNo ?? nextQuoteNo(form.date, mine),
        date: form.date, validUntil: form.validUntil || undefined,
        partnerId: recipient.partnerId, partnerName: recipient.partnerName,
        recipientPhone: form.recipientPhone?.trim() || undefined,
        attention: form.attention || undefined,
        deliveryTerms: form.deliveryTerms?.trim() || undefined,
        paymentTerms: form.paymentTerms?.trim() || undefined,
        lines, totalSupply: t.supply, totalTax: t.tax, totalAmount: t.total, totalCost: t.cost,
        note: form.note || undefined,
        createdAt: prev?.createdAt ?? new Date().toISOString(),
        createdBy: currentUser?.name,
      };
      await addItem('quotations', saved as never);
      // 저장은 끝났는데 구독 왕복이 늦으면 목록이 비어 보여 실패로 오해한다. 먼저 화면에
      // 넣고, 뒤이어 오는 Firestore 스냅샷이 같은 ID의 확정값으로 맞춘다.
      setQuotes(current => [saved, ...current.filter(quote => quote.id !== saved.id)]);
      setQuoteError('');
      setOpen(false);
    } catch (error) {
      console.error('[견적서 저장 실패]', error);
      const reason = error instanceof Error ? error.message : String(error);
      setQuoteError(`견적서를 저장하지 못했습니다. ${reason}`);
      alert(`견적서를 저장하지 못했습니다.\n${reason}`);
    } finally { setSaving(false); }
  };

  /** 품목 고르기 — 검색 결과. 전 품목을 뒤진다(견적은 안 팔던 걸 새로 팔 때 낸다). */
  //  거르개는 공용이다 — 제품별 원장·재고관리와 같은 것을 쓴다(shared/ui/ItemFilterBar).
  const [pickType, setPickType] = useState<string>(ALL);
  const [pickCat, setPickCat] = useState<string>(ALL);

  const pickResults = useMemo(() => {
    const q = itemSearch.trim();
    const 걸러진 = filterItems(items as never, { type: pickType, category: pickCat }) as typeof items;
    const rows = q ? 걸러진.filter(x => matchesSearch(`${x.name} ${x.spec ?? ''} ${x.품목 ?? ''}`, q)) : 걸러진;
    //  그 거래처에 이미 붙은 품목을 앞에 둔다 — 검색어가 없을 때 자주 쓰는 게 위로 온다
    const linked = new Set(partnerItems.filter(p => p.partnerId === form.partnerId).map(p => p.itemId));
    return [...rows].sort((a, b) => (linked.has(b.id) ? 1 : 0) - (linked.has(a.id) ? 1 : 0)).slice(0, 300);
  }, [items, itemSearch, partnerItems, form.partnerId, pickType, pickCat]);

  return (
    <div className="space-y-4">
      <PageHeader title="견적서" subtitle="팔기 전에 값을 적어 내미는 종이 — 회계엔 아무것도 안 남습니다" />

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="거래처·품목·번호"
            className="w-full bg-white border border-slate-200 rounded-xl pl-8 pr-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-slate-300" />
        </div>
        <button onClick={openNew}
          className="ml-auto flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2 rounded-xl font-black text-xs hover:bg-indigo-700 active:scale-95 transition-all">
          <Plus size={14} />견적서 작성
        </button>
      </div>

      {quoteError && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700">
          {quoteError}
        </div>
      )}

      {/* 목록 */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[820px]">
            <thead className="bg-slate-50 text-slate-400">
              <tr>
                {['번호', '일자', '유효기한', '거래처', '품목'].map(h => (
                  <th key={h} className="px-4 py-2.5 font-black text-left whitespace-nowrap">{h}</th>
                ))}
                <th className="px-4 py-2.5 font-black text-right whitespace-nowrap">합계</th>
                <th className="px-4 py-2.5 font-black text-right whitespace-nowrap">마진</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {shown.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-16 text-center text-slate-300 font-bold">견적서가 없습니다</td></tr>
              )}
              {shown.map(q => {
                const t = quoteTotals(q.lines);
                return (
                  <tr key={q.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2.5 font-mono font-bold text-slate-500 whitespace-nowrap">{q.quoteNo}</td>
                    <td className="px-4 py-2.5 font-mono text-slate-500 whitespace-nowrap">{q.date}</td>
                    <td className={`px-4 py-2.5 font-mono whitespace-nowrap ${q.validUntil && q.validUntil < today() ? 'text-rose-500' : 'text-slate-400'}`}>
                      {q.validUntil ?? '—'}
                      {q.validUntil && q.validUntil < today() && <span className="ml-1 text-[10px] font-black">지남</span>}
                    </td>
                    <td className="px-4 py-2.5 font-bold text-slate-800 whitespace-nowrap">{q.partnerName}</td>
                    <td className="px-4 py-2.5 text-slate-500 max-w-[220px] truncate">
                      {q.lines[0]?.name}{q.lines.length > 1 ? ` 외 ${q.lines.length - 1}건` : ''}
                    </td>
                    <td className="px-4 py-2.5 text-right font-black text-slate-800 tabular-nums whitespace-nowrap">{fmt(q.totalAmount)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
                      {t.cost > 0
                        ? <span className={`font-black ${t.margin < 0 ? 'text-rose-500' : 'text-emerald-600'}`}>{(t.marginRate * 100).toFixed(1)}%</span>
                        : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => setViewing(q)} title="보기 · 인쇄"
                          className="p-1.5 text-slate-300 hover:text-indigo-600"><Printer size={13} /></button>
                        <button onClick={() => openEdit(q)} title="견적서 수정"
                          className="p-1.5 text-slate-300 hover:text-indigo-600"><Pencil size={13} /></button>
                        <button onClick={() => openCopy(q)} title="이대로 새 견적"
                          className="p-1.5 text-slate-300 hover:text-emerald-600"><Copy size={13} /></button>
                        <button onClick={() => { if (window.confirm(`${q.quoteNo} 견적서를 지울까요?`)) deleteItem('quotations', q.id); }}
                          title="삭제" className="p-1.5 text-slate-300 hover:text-rose-500"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 작성 ── */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <FileText size={16} className="text-indigo-600" />
                <h3 className="font-black text-slate-900">{editingId ? '견적서 수정' : '견적서 작성'}</h3>
              </div>
              <button onClick={() => setOpen(false)} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl"><X size={16} /></button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="block space-y-1">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">일자</span>
                  <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300" />
                </label>
                <label className="block space-y-1">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">유효기한</span>
                  <input type="date" value={form.validUntil ?? ''} onChange={e => setForm(f => ({ ...f, validUntil: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300" />
                </label>
                <label className="block space-y-1">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">담당자</span>
                  <input value={form.attention ?? ''} onChange={e => setForm(f => ({ ...f, attention: e.target.value }))} placeholder="예: 임태백"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300" />
                </label>
              </div>

              {/* 견적은 신규 문의처에도 먼저 낼 수 있다. 등록 거래처 선택과 업체명 직접 입력을
                  함께 두되, 직접 입력한 곳은 partnerId 없이 저장해 원장과 섞지 않는다. */}
              <div className="space-y-1">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">견적 받을 곳</span>
                {form.partnerName ? (
                  <div className="flex items-center gap-2">
                    <span className="px-3 py-2 rounded-xl bg-indigo-50 text-indigo-700 text-xs font-black">{form.partnerName}</span>
                    {!form.partnerId && <span className="text-[10px] font-bold text-slate-400">미등록 업체</span>}
                    <button onClick={() => setForm(f => ({ ...f, partnerId: '', partnerName: '', recipientPhone: '' }))}
                      className="text-[11px] font-black text-slate-400 hover:text-slate-600">바꾸기</button>
                  </div>
                ) : (
                  <div className="rounded-xl border border-slate-200 overflow-hidden">
                    <input autoFocus value={partnerSearch} onChange={e => setPartnerSearch(e.target.value)} placeholder="등록 거래처 검색 또는 업체명 직접 입력"
                      onKeyDown={e => {
                        if (e.key !== 'Enter' || !partnerSearch.trim()) return;
                        e.preventDefault();
                        setForm(f => ({ ...f, partnerId: '', partnerName: partnerSearch.trim(), recipientPhone: '' }));
                      }}
                      className="w-full px-3 py-2 text-xs font-bold border-b border-slate-100 outline-none" />
                    {partnerSearch.trim() && (
                      <button
                        type="button"
                        onClick={() => setForm(f => ({ ...f, partnerId: '', partnerName: partnerSearch.trim(), recipientPhone: '' }))}
                        className="w-full border-b border-slate-100 bg-slate-50 px-3 py-2 text-left text-[11px] font-black text-indigo-600 hover:bg-indigo-50"
                      >
                        ‘{partnerSearch.trim()}’ 미등록 업체명으로 사용
                      </button>
                    )}
                    {/* 크기 고정 — 검색으로 줄 수가 줄어도 창이 안 흔들린다 */}
                    <div className="h-40 overflow-y-auto">
                      {partners.filter(p => !partnerSearch.trim() || matchesSearch(p.name, partnerSearch.trim()))
                        .slice(0, 200).map(p => (
                        <button key={p.id} onClick={() => { setForm(f => ({ ...f, partnerId: p.id, partnerName: p.name, recipientPhone: p.tel || p.phone || p.mobile || '' })); setPartnerSearch(''); }}
                          className="w-full text-left px-3 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-indigo-50 truncate">{p.name}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <label className="block space-y-1">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">받는 업체 연락처</span>
                <input value={form.recipientPhone ?? ''} onChange={e => setForm(f => ({ ...f, recipientPhone: e.target.value }))}
                  placeholder="등록 거래처는 자동 입력 · 미등록 업체는 직접 입력"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300" />
              </label>

              {/* 품목 — 원가와 마진율을 줄마다 보여준다. 값을 매기는 자리라 이게 안 보이면 감으로 적게 된다. */}
              {/*  **옆으로 민다**(2026-09-05 사장님) — 폰에서 품목 칸이 0으로 눌려
                   '품/목' 으로 접히고 뒷칸이 잘렸다. 칸이 아홉이라 폰 폭에 안 들어간다. */}
              <div className="rounded-2xl border border-slate-200 overflow-x-auto">
                <div className="grid grid-cols-[minmax(150px,1fr)_64px_88px_96px_58px_88px_100px_44px_28px] min-w-[740px] bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  <span className="px-3 py-2 whitespace-nowrap">품목</span>
                  <span className="px-2 py-2 text-right whitespace-nowrap">수량</span>
                  <span className="px-2 py-2 text-right whitespace-nowrap">원가</span>
                  {/*  **단가는 공급가 기준이다**(세별도). 원가에 마진을 얹은 값이다.
                       전표·거래명세서의 '단가'는 세포함이라 뜻이 다르다 — 그래서 칸 이름에 박는다.
                       세액과 판매가를 나란히 둬야 손님한테 부를 값이 화면에서 바로 읽힌다. */}
                  <span className="px-2 py-2 text-right whitespace-nowrap">단가<span className="text-slate-400 font-bold"> 판매가</span></span>
                  <span className="px-2 py-2 text-right whitespace-nowrap">마진율</span>
                  <span className="px-2 py-2 text-right whitespace-nowrap">세액</span>
                  <span className="px-2 py-2 text-right whitespace-nowrap">판매가<span className="text-slate-400 font-bold"> 세포함</span></span>
                  <span className="px-1 py-2 text-center whitespace-nowrap">과세</span>
                  <span />
                </div>
                {form.lines.map((l, i) => {
                  // 품목 선택창·합계와 같은 셈이다. 판매가는 세금 포함이므로 과세 줄은
                  // 공급가를 역산한 뒤 원가와 비교해야 마진율이 두 개로 갈리지 않는다.
                  const lineMargin = l.price > 0 && (l.cost ?? 0) > 0 && l.isTaxExempt !== undefined
                    ? marginOf(l.price, l.cost ?? 0, l.isTaxExempt)
                    : null;
                  //  줄마다 세액·판매가를 낸다 — 셈은 shared/lineAmount 한 곳이다
                  const amt = lineAmount(Number(l.qty) || 0, Number(l.price) || 0, l.isTaxExempt);
                  return (
                    <div key={i} className="grid grid-cols-[minmax(150px,1fr)_64px_88px_96px_58px_88px_100px_44px_28px] min-w-[740px] border-t border-slate-100 items-center">
                      <div className="px-3 py-2 min-w-0">
                        <div className="flex items-center gap-1">
                          <input
                            value={l.name}
                            onChange={e => setLine(i, { name: e.target.value, itemId: undefined, cost: undefined })}
                            placeholder="품목명 직접 입력"
                            className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-bold text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                          />
                          <button
                            type="button"
                            onClick={() => { setPickIdx(i); setItemSearch(''); }}
                            title="등록 품목에서 찾기"
                            aria-label={`${i + 1}번째 줄 등록 품목에서 찾기`}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600"
                          >
                            <Search size={13} />
                          </button>
                        </div>
                        <input
                          value={l.spec}
                          onChange={e => setLine(i, { spec: e.target.value })}
                          placeholder="규격 직접 입력"
                          className="mt-1 w-full rounded-md border-0 bg-slate-50 px-2 py-1 text-[10px] font-medium text-slate-500 outline-none focus:ring-1 focus:ring-indigo-200"
                        />
                        <input
                          value={l.unit ?? ''}
                          onChange={e => setLine(i, { unit: e.target.value })}
                          placeholder="단위 (예: 박스, 개, kg)"
                          className="mt-1 w-full rounded-md border-0 bg-slate-50 px-2 py-1 text-[10px] font-medium text-slate-500 outline-none focus:ring-1 focus:ring-indigo-200"
                        />
                      </div>
                      <input value={String(l.qty)} inputMode="decimal" onChange={e => setLine(i, { qty: num(e.target.value) })}
                        className="mx-1 text-right bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold outline-none" />
                      <span className="px-2 text-right text-xs font-bold text-slate-400 tabular-nums">
                        {l.cost ? fmt(l.cost) : '—'}
                      </span>
                      <input value={String(l.price)} inputMode="numeric" onChange={e => setLine(i, { price: num(e.target.value) })}
                        className="mx-1 text-right bg-white border-2 border-indigo-100 rounded-lg px-2 py-1.5 text-xs font-black outline-none focus:border-indigo-300" />
                      <span className={`px-2 text-right text-xs font-black tabular-nums ${!lineMargin ? 'text-slate-300' : lineMargin.margin < 0 ? 'text-rose-500' : 'text-emerald-600'}`}>
                        {lineMargin ? `${(lineMargin.marginRate * 100).toFixed(1)}%` : '—'}
                      </span>
                      <span className={`px-2 text-right text-xs font-bold tabular-nums ${amt.tax ? 'text-slate-500' : 'text-slate-300'}`}>
                        {amt.tax ? fmt(amt.tax) : '—'}
                      </span>
                      <span className="px-2 text-right text-xs font-black text-slate-800 tabular-nums">{fmt(amt.gross)}</span>
                      {/*  안 고른 줄은 '-' 다. 한 번 고르면 과세↔면세로만 오간다 —
                           실수로 '모름' 으로 되돌아가지 않게. */}
                      <button onClick={() => setLine(i, { isTaxExempt: l.isTaxExempt === undefined ? false : !l.isTaxExempt })}
                        title={l.isTaxExempt === undefined ? '눌러서 과세·면세를 고르세요' : undefined}
                        className={`mx-1 py-1.5 rounded-lg text-[10px] font-black border ${
                          l.isTaxExempt === undefined ? 'bg-amber-50 text-amber-600 border-amber-300 animate-pulse'
                          : l.isTaxExempt ? 'bg-indigo-600 text-white border-indigo-500'
                          : 'bg-white text-slate-500 border-slate-200'}`}>
                        {l.isTaxExempt === undefined ? '—' : l.isTaxExempt ? '면세' : '과세'}
                      </button>
                      <button onClick={() => setForm(f => ({ ...f, lines: f.lines.filter((_, k) => k !== i) }))}
                        className="text-slate-300 hover:text-rose-500 justify-self-center"><Trash2 size={13} /></button>
                    </div>
                  );
                })}
                <button onClick={() => setForm(f => ({ ...f, lines: [...f.lines, emptyLine()] }))}
                  className="w-full min-w-[740px] py-2 border-t border-slate-100 text-[11px] font-black text-indigo-600 hover:bg-indigo-50">+ 줄 추가</button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">납기</span>
                  <input value={form.deliveryTerms ?? ''} onChange={e => setForm(f => ({ ...f, deliveryTerms: e.target.value }))}
                    placeholder="예: 발주 후 7일, 2026-09-30"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300" />
                </label>
                <label className="block space-y-1">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">결제조건</span>
                  <input value={form.paymentTerms ?? ''} onChange={e => setForm(f => ({ ...f, paymentTerms: e.target.value }))}
                    placeholder="예: 선입금, 월말 현금 결제"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300" />
                </label>
              </div>

              <label className="block space-y-1">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">비고</span>
                <textarea value={form.note ?? ''} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} rows={2}
                  placeholder="그 밖의 전달사항"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300" />
              </label>

              <div className="rounded-2xl bg-slate-900 text-white px-5 py-3 space-y-1.5">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-4 text-[11px] font-bold text-slate-400">
                    <span>공급가 <b className="text-white tabular-nums">{fmt(totals.supply)}</b></span>
                    <span>부가세 <b className="text-white tabular-nums">{fmt(totals.tax)}</b></span>
                  </div>
                  <span className="text-lg font-black tabular-nums">{fmt(totals.total)}원</span>
                </div>
                {totals.cost > 0 && (
                  <div className="flex items-center justify-between border-t border-slate-700 pt-1.5 flex-wrap gap-2">
                    <span className="text-[11px] font-bold text-slate-400">원가 <b className="text-slate-200 tabular-nums">{fmt(totals.cost)}</b></span>
                    <span className="text-[11px] font-bold text-slate-400">
                      마진{' '}
                      <b className={`tabular-nums ${totals.margin < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>{fmt(totals.margin)}</b>
                      <b className={`ml-2 ${totals.margin < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                        마진율 {(totals.marginRate * 100).toFixed(1)}%
                      </b>
                      <b className={`ml-2 ${totals.margin < 0 ? 'text-rose-400' : 'text-sky-400'}`}>
                        원가 대비 {(totals.markupRate * 100).toFixed(1)}%
                      </b>
                    </span>
                  </div>
                )}
                {totals.margin < 0 && totals.cost > 0 && (
                  <p className="text-[11px] font-black text-rose-400">원가보다 싼 값입니다 — 팔면 손해입니다.</p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100">
              <button onClick={() => setOpen(false)} className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-black hover:bg-slate-200">취소</button>
              <button onClick={save} disabled={saving}
                className="px-5 py-2 rounded-xl bg-indigo-600 text-white text-xs font-black hover:bg-indigo-700 disabled:opacity-60">
                {saving ? '저장 중…' : editingId ? '수정 저장' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 품목 고르기 ──────────────────────────────────────────────
          견적은 대개 **안 팔던 걸 새로 팔 때** 낸다. 그래서 거래처에 붙은 것만 보여주면 안 된다 —
          전 품목을 뒤지되, 그 거래처에 이미 붙은 건 위로 올린다.
          원가와 등록 단가를 나란히 보여줘 여기서 바로 값을 가늠할 수 있게 한다. */}
      {pickIdx !== null && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setPickIdx(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl h-[72vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
              <div>
                <h4 className="font-black text-slate-900 text-sm">품목 고르기</h4>
                <p className="text-[10px] text-slate-400">{pickResults.length}품목 · 이 거래처에 붙은 품목이 위에 옵니다</p>
              </div>
              <button onClick={() => setPickIdx(null)} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl"><X size={16} /></button>
            </div>
            <div className="px-5 py-3 border-b border-slate-100">
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" />
                <input autoFocus value={itemSearch} onChange={e => setItemSearch(e.target.value)} placeholder="품목명·규격 검색 (초성도 됩니다)"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
              {/*  300품목을 검색으로만 찾아야 했다(2026-09-06 사장님). 분류로 먼저 좁힌다. */}
              <div className="mt-2">
                <ItemFilterBar items={items as never} type={pickType} setType={setPickType}
                  category={pickCat} setCategory={setPickCat} 가로 />
              </div>
            </div>
            {/* 크기 고정 — 검색으로 줄 수가 줄어도 창이 안 흔들린다.
                 가로는 밀어서 본다 — 폰에서 품목 칸이 눌리면 이름이 안 보인다(2026-09-05) */}
            <div className="flex-1 overflow-y-auto overflow-x-auto">
              <div className="hidden sm:grid grid-cols-[minmax(150px,1fr)_92px_92px_84px_92px] min-w-[520px] bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest sticky top-0">
                <span className="px-4 py-2">품목</span>
                <span className="px-3 py-2 text-right">원가</span>
                <span className="px-3 py-2 text-right">공급가</span>
                <span className="px-3 py-2 text-right">마진율</span>
                <span className="px-3 py-2 text-right">판매단가</span>
              </div>
              {pickResults.length === 0 && <p className="px-4 py-16 text-center text-slate-300 font-bold text-sm">품목이 없습니다</p>}
              {pickResults.map(x => {
                const c = costFor(x);
                const p = priceFor(x.id);
                /**
                 * **마진은 공급가액과 견준다**(2026-09-06 사장님: "마진은 공급가액이랑
                 * 비교해서 내라니까"). 판매단가는 세포함이라 그대로 나누면 마진이 부풀어
                 * 보인다 — 셈은 shared/margin 한 곳이다. 여기만 손으로 나누고 있었다.
                 * 판매단가는 **옆 칸에 따로** 둔다.
                 */
                const m = p && p > 0 ? marginOf(p, c, isSaleTaxExempt(partnerItems, x.id)) : null;
                const rt = m ? m.marginRate : null;
                const linked = p !== undefined;
                return (
                  <button key={x.id}
                    onClick={() => {
                      setLine(pickIdx, {
                        itemId: x.id, name: x.name, spec: String(x.spec ?? ''), unit: String(x.unit ?? ''),
                        cost: c,
                        //  **거래처 판매단가를 그대로 넣는다**(세포함). 단가 칸이 판매단가라
                        //  변환할 게 없다 — 공급가액은 줄마다 역산해서 낸다(2026-09-10 사장님).
                        price: p ?? 0,
                        //  거래처 연결에 정해진 게 있으면 그걸 쓰고, 없으면 **비워 둔다** — 고르게 한다
                        isTaxExempt: (() => { const t = saleTaxTypeOf(partnerItems, x.id); return t === undefined ? undefined : t === '면세'; })(),
                      });
                      setPickIdx(null);
                    }}
                    className="w-full sm:grid sm:grid-cols-[minmax(150px,1fr)_92px_92px_84px_92px] sm:min-w-[520px] sm:items-center border-t border-slate-50 hover:bg-indigo-50/70 text-left">
                    {/*  폰에서는 **이름 한 줄, 숫자 한 줄**이다(2026-09-06 사장님).
                         네 칸을 나란히 두니 460px 가 필요해 가로로 밀어야 했고, 그러면
                         품목명이 화면 밖으로 나가 무엇을 고르는지 안 보였다.
                         `sm:contents` 로 넓은 화면에서는 감싼 것이 사라져 원래 표가 된다. */}
                    <span className="block px-4 pt-2 sm:py-2 min-w-0">
                      <span className="text-xs font-bold text-slate-800 break-keep sm:truncate sm:block">
                        {x.name}
                        {linked && <span className="ml-1.5 text-[10px] font-black text-indigo-500">거래중</span>}
                        {isSaleTaxExempt(partnerItems, x.id) && <span className="ml-1 text-[10px] font-black text-slate-400">면세</span>}
                      </span>
                      <span className="block text-[10px] text-slate-400">{x.spec ?? ''}{x.unit ? ` · ${x.unit}` : ''}</span>
                    </span>
                    <div className="flex justify-between gap-2 px-4 pb-2 sm:contents">
                      <span className="sm:px-3 sm:py-2 text-right text-xs font-bold text-slate-500 tabular-nums">
                        <span className="sm:hidden text-[9px] font-black text-slate-300 mr-1">원가</span>{c > 0 ? fmt(c) : '—'}
                      </span>
                      <span className="sm:px-3 sm:py-2 text-right text-xs font-bold text-slate-700 tabular-nums">
                        <span className="sm:hidden text-[9px] font-black text-slate-300 mr-1">공급가</span>{m ? fmt(m.supply) : '—'}
                      </span>
                      <span className={`sm:px-3 sm:py-2 text-right text-xs font-black tabular-nums ${rt == null ? 'text-slate-300' : rt < 0 ? 'text-rose-500' : 'text-emerald-600'}`}>
                        <span className="sm:hidden text-[9px] font-black text-slate-300 mr-1">마진</span>{rt == null ? '—' : `${(rt * 100).toFixed(1)}%`}
                      </span>
                      <span className="sm:px-3 sm:py-2 text-right text-xs font-bold text-slate-400 tabular-nums">
                        <span className="sm:hidden text-[9px] font-black text-slate-300 mr-1">판매단가</span>{p !== undefined ? fmt(p) : '—'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-400">목록에 없으면 창을 닫고 품목명·규격을 직접 입력하세요</span>
              <button onClick={() => setPickIdx(null)} className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-black hover:bg-slate-200">닫기</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 보기 · 인쇄 ── */}
      {viewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 print:static print:bg-white print:p-0"
          onClick={() => setViewing(null)}>
          <div id="quotation-print-area" className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden print:max-h-none print:shadow-none print:rounded-none"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 print:hidden">
              <h3 className="font-black text-slate-900 text-sm">{viewing.quoteNo}</h3>
              <div className="flex items-center gap-2">
                <button onClick={printQuotation}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-black hover:bg-slate-800">
                  <Printer size={13} />인쇄
                </button>
                <button onClick={() => setViewing(null)} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl"><X size={16} /></button>
              </div>
            </div>
            <div id="quotation-print-document" className="flex-1 overflow-y-auto px-7 py-6 text-slate-900 print:overflow-visible print:px-0 print:py-0">
              {/* 현장에서 익숙한 표준 견적서 구조를 그대로 따른다. 카드형 배치는 인쇄 때 빈 공간이 커지고
                  항목 위치를 한눈에 대조하기 어려웠다. */}
              <h2 className="mb-3 text-center text-3xl font-black tracking-[0.32em]">견 적 서</h2>
              <table className="w-full table-fixed border-collapse text-[11px] [&_td]:border [&_td]:border-slate-400 [&_td]:px-2 [&_td]:py-1.5">
                <tbody>
                  <tr><td colSpan={4} className="text-center text-lg font-black tracking-[0.3em]">견 적 서</td></tr>
                  <tr>
                    <td className="w-[16%] bg-slate-100 text-center font-black">수신</td><td className="w-[34%] font-bold">{viewing.partnerName} 귀하</td>
                    <td className="w-[16%] bg-slate-100 text-center font-black">상호</td><td className="w-[34%] font-black">{printCompany.name || companyName}</td>
                  </tr>
                  <tr>
                    <td className="bg-slate-100 text-center font-black">참조</td><td>{viewing.recipientPhone || '—'}</td>
                    <td className="bg-slate-100 text-center font-black">대표자</td><td>{printCompany.ceoName}</td>
                  </tr>
                  <tr>
                    <td className="bg-slate-100 text-center font-black">견적일</td><td>{viewing.date}</td>
                    <td className="bg-slate-100 text-center font-black">주소</td><td>{printCompany.address}</td>
                  </tr>
                  <tr>
                    <td className="bg-slate-100 text-center font-black">유효기간</td><td>{viewing.validUntil ?? '별도 협의'}</td>
                    <td className="bg-slate-100 text-center font-black">업태·종목</td><td>{printCompany.bizType} · {printCompany.bizItem}</td>
                  </tr>
                  <tr>
                    <td className="bg-slate-100 text-center font-black">결제 조건</td><td>{viewing.paymentTerms || '별도 협의'}</td>
                    <td className="bg-slate-100 text-center font-black">연락처</td><td>{printCompany.phone || '—'}{printCompany.fax ? ` · FAX ${printCompany.fax}` : ''}</td>
                  </tr>
                  <tr>
                    <td colSpan={2} className="font-bold">아래와 같이 견적합니다.</td>
                    <td className="bg-slate-100 text-center font-black">담당자</td><td>{viewing.attention || '—'}</td>
                  </tr>
                  <tr>
                    <td className="bg-slate-100 text-center font-black">견적번호</td><td>{viewing.quoteNo}</td>
                    <td className="bg-slate-100 text-center font-black">납기</td><td>{viewing.deliveryTerms || '별도 협의'}</td>
                  </tr>
                  <tr>
                    <td className="bg-slate-100 text-center font-black">합계금액</td>
                    <td colSpan={3} className="text-center text-base font-black">일금 ₩ {fmt(viewing.totalAmount)}정</td>
                  </tr>
                </tbody>
              </table>

              <table className="w-full table-fixed border-collapse text-[10px] [&_td]:border [&_td]:border-slate-400 [&_td]:px-1.5 [&_td]:py-1.5 [&_th]:border [&_th]:border-slate-400 [&_th]:bg-slate-100 [&_th]:px-1 [&_th]:py-1.5">
                <thead><tr>
                  <th className="w-[5%]">No</th><th className="w-[22%]">품명</th><th className="w-[12%]">규격</th>
                  <th className="w-[8%]">수량</th><th className="w-[7%]">단위</th><th className="w-[13%]">단가</th>
                  <th className="w-[14%]">공급가액</th><th className="w-[10%]">세액</th><th className="w-[9%]">비고</th>
                </tr></thead>
                <tbody>
                  {Array.from({ length: Math.max(12, viewing.lines.length) }, (_, i) => {
                    const l = viewing.lines[i];
                    const amount = l ? lineAmount(l.qty, l.price, l.isTaxExempt) : null;
                    return <tr key={i} className="h-7">
                      <td className="text-center">{i + 1}</td><td className="font-bold">{l?.name || ''}</td><td>{l?.spec || ''}</td>
                      <td className="text-right tabular-nums">{l ? fmt(l.qty) : ''}</td><td className="text-center">{l?.unit || ''}</td>
                      <td className="text-right tabular-nums">{l ? fmt(l.price) : ''}</td>
                      <td className="text-right tabular-nums">{amount ? fmt(amount.supply) : ''}</td>
                      <td className="text-right tabular-nums">{amount ? fmt(amount.tax) : ''}</td>
                      <td className="text-center">{l?.isTaxExempt ? '면세' : l?.note || ''}</td>
                    </tr>;
                  })}
                  <tr className="font-black"><td colSpan={6} className="bg-slate-100 text-center">합계</td>
                    <td className="text-right">{fmt(viewing.totalSupply)}</td><td className="text-right">{fmt(viewing.totalTax)}</td><td /></tr>
                </tbody>
              </table>

              <table className="w-full table-fixed border-collapse text-[11px] [&_td]:border [&_td]:border-slate-400 [&_td]:px-2 [&_td]:py-2">
                <tbody>
                  <tr><td className="w-[22%] bg-slate-100 text-center font-black">납기</td><td>{viewing.deliveryTerms || '별도 협의'}</td></tr>
                  <tr><td className="bg-slate-100 text-center font-black">입금계좌</td><td>{printCompany.bankAccount || '별도 안내'}</td></tr>
                  <tr><td className="bg-slate-100 text-center font-black">비고</td><td className="h-16 whitespace-pre-wrap align-top">{viewing.note || ''}</td></tr>
                </tbody>
              </table>
              <p className="mt-4 text-right text-sm font-black tracking-wide">
                태백식품
              </p>
              {/* 원가·마진은 **인쇄에서 뺀다** — 거래처에 주는 종이다 */}
              {quoteTotals(viewing.lines).cost > 0 && (
                <p className="mt-3 text-[11px] font-bold text-slate-400 print:hidden">
                  원가 {fmt(quoteTotals(viewing.lines).cost)} · 마진 {fmt(quoteTotals(viewing.lines).margin)}
                  ({(quoteTotals(viewing.lines).marginRate * 100).toFixed(1)}%) — 이 줄은 인쇄에 안 나옵니다
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
