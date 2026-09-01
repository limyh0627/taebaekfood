import React, { useState, useMemo, useEffect } from 'react';
import { Plus, X, Trash2, Search, Printer, FileText, Copy } from 'lucide-react';
import { Item, Partner, PartnerItem, CompanyId, COMPANIES } from '../src/shared/types';
import { matchesSearch } from '../src/shared/hangul';
import { subscribeToCollection, addItem, deleteItem } from '../src/shared/services/firebaseService';
import PageHeader from './PageHeader';

/**
 * **견적서** — 팔기 전에 얼마에 줄지 적어 내미는 종이.
 *
 * 전표(거래명세서)와 다른 점은 **아직 판 게 아니라는 것**이다. 그래서 회계에 아무것도 안 남긴다 —
 * 분개도, 채권도, 재고도 안 움직인다. 나중에 그 값으로 실제로 팔면 그때 전표를 끊는다.
 * 여기서 만든 건 `quotations` 컬렉션에만 쌓인다.
 */
export interface QuotationLine {
  name: string;
  spec: string;
  qty: number;
  price: number;
  /** 면세면 부가세를 안 붙인다 */
  isTaxExempt: boolean;
  note?: string;
}

export interface Quotation {
  id: string;
  companyId?: CompanyId;
  quoteNo: string;
  date: string;                 // 'YYYY-MM-DD'
  /** 이 날까지 이 값이다 — 비우면 안 적는다 */
  validUntil?: string;
  partnerId: string;
  partnerName: string;
  /** 받는 사람 (담당자) */
  attention?: string;
  lines: QuotationLine[];
  totalSupply: number;
  totalTax: number;
  totalAmount: number;
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
}

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR');
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00`);
  x.setDate(x.getDate() + n);
  return x.toISOString().slice(0, 10);
};

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

/** 줄들의 공급가·세액·합계. 면세 줄은 세액이 0이다. */
export function quoteTotals(lines: QuotationLine[]) {
  let supply = 0, tax = 0;
  for (const l of lines) {
    const amt = Math.round((Number(l.qty) || 0) * (Number(l.price) || 0));
    supply += amt;
    if (!l.isTaxExempt) tax += Math.round(amt * 0.1);
  }
  return { supply, tax, total: supply + tax };
}

const emptyLine = (): QuotationLine => ({ name: '', spec: '', qty: 1, price: 0, isTaxExempt: false });

export default function QuotationManager({ items, partners, partnerItems = [], companyId = 'taebaek', currentUser }: Props) {
  const [quotes, setQuotes] = useState<Quotation[]>([]);
  useEffect(() => subscribeToCollection<Quotation>('quotations', setQuotes), []);

  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Quotation | null>(null);
  const [form, setForm] = useState<Omit<Quotation, 'id' | 'createdAt' | 'quoteNo' | 'totalSupply' | 'totalTax' | 'totalAmount'>>({
    date: today(), validUntil: plusDays(today(), 30),
    partnerId: '', partnerName: '', attention: '', lines: [emptyLine()], note: '',
  });
  const [open, setOpen] = useState(false);
  const [partnerSearch, setPartnerSearch] = useState('');
  const [pickIdx, setPickIdx] = useState<number | null>(null);
  const [itemSearch, setItemSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const mine = useMemo(
    () => quotes.filter(q => (q.companyId ?? 'taebaek') === companyId)
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

  const openNew = () => {
    setEditing(null);
    setForm({
      date: today(), validUntil: plusDays(today(), 30),
      partnerId: '', partnerName: '', attention: '', lines: [emptyLine()], note: '',
    });
    setPartnerSearch(''); setPickIdx(null); setOpen(true);
  };

  /** 그대로 베껴 새 견적을 연다 — 같은 거래처에 값만 바꿔 다시 내미는 일이 흔하다 */
  const openCopy = (q: Quotation) => {
    setEditing(null);
    setForm({
      date: today(), validUntil: plusDays(today(), 30),
      partnerId: q.partnerId, partnerName: q.partnerName, attention: q.attention ?? '',
      lines: q.lines.map(l => ({ ...l })), note: q.note ?? '',
    });
    setPartnerSearch(''); setPickIdx(null); setOpen(true);
  };

  const setLine = (i: number, patch: Partial<QuotationLine>) =>
    setForm(f => ({ ...f, lines: f.lines.map((l, k) => (k === i ? { ...l, ...patch } : l)) }));

  /** 거래처에 등록된 단가가 있으면 그 값으로 연다 — 견적이 실제 거래가와 어긋나면 쓸모가 없다 */
  const priceFor = (itemId: string) =>
    partnerItems.find(p => p.itemId === itemId && p.partnerId === form.partnerId && p.Direction !== 'in')?.price;

  const save = async () => {
    if (!form.partnerId) { alert('거래처를 고르세요.'); return; }
    const lines = form.lines.filter(l => l.name.trim() && Number(l.qty) > 0);
    if (!lines.length) { alert('품목을 한 줄 이상 넣으세요.'); return; }
    if (saving) return;
    setSaving(true);
    try {
      const t = quoteTotals(lines);
      const q: Quotation = {
        id: editing?.id ?? `quo-${Date.now()}`,
        companyId,
        quoteNo: editing?.quoteNo ?? nextQuoteNo(form.date, mine),
        date: form.date, validUntil: form.validUntil || undefined,
        partnerId: form.partnerId, partnerName: form.partnerName,
        attention: form.attention || undefined,
        lines, totalSupply: t.supply, totalTax: t.tax, totalAmount: t.total,
        note: form.note || undefined,
        createdAt: editing?.createdAt ?? new Date().toISOString(),
        createdBy: currentUser?.name,
      };
      await addItem('quotations', q as never);
      setOpen(false);
    } finally { setSaving(false); }
  };

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

      {/* 목록 */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[720px]">
            <thead className="bg-slate-50 text-slate-400">
              <tr>
                {['번호', '일자', '유효기한', '거래처', '품목', '합계', ''].map((h, i) => (
                  <th key={h + i} className={`px-4 py-2.5 font-black whitespace-nowrap ${h === '합계' ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {shown.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-16 text-center text-slate-300 font-bold">견적서가 없습니다</td></tr>
              )}
              {shown.map(q => (
                <tr key={q.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-2.5 font-mono font-bold text-slate-500 whitespace-nowrap">{q.quoteNo}</td>
                  <td className="px-4 py-2.5 font-mono text-slate-500 whitespace-nowrap">{q.date}</td>
                  <td className={`px-4 py-2.5 font-mono whitespace-nowrap ${q.validUntil && q.validUntil < today() ? 'text-rose-500' : 'text-slate-400'}`}>
                    {q.validUntil ?? '—'}
                    {q.validUntil && q.validUntil < today() && <span className="ml-1 text-[10px] font-black">지남</span>}
                  </td>
                  <td className="px-4 py-2.5 font-bold text-slate-800 whitespace-nowrap">{q.partnerName}</td>
                  <td className="px-4 py-2.5 text-slate-500 max-w-[240px] truncate">
                    {q.lines[0]?.name}{q.lines.length > 1 ? ` 외 ${q.lines.length - 1}건` : ''}
                  </td>
                  <td className="px-4 py-2.5 text-right font-black text-slate-800 tabular-nums whitespace-nowrap">{fmt(q.totalAmount)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1 justify-end">
                      <button onClick={() => { setEditing(q); setOpen(false); }} title="보기 · 인쇄"
                        className="p-1.5 text-slate-300 hover:text-indigo-600"><Printer size={13} /></button>
                      <button onClick={() => openCopy(q)} title="이대로 새 견적"
                        className="p-1.5 text-slate-300 hover:text-emerald-600"><Copy size={13} /></button>
                      <button onClick={() => { if (window.confirm(`${q.quoteNo} 견적서를 지울까요?`)) deleteItem('quotations', q.id); }}
                        title="삭제" className="p-1.5 text-slate-300 hover:text-rose-500"><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 작성 ── */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <FileText size={16} className="text-indigo-600" />
                <h3 className="font-black text-slate-900">견적서 작성</h3>
              </div>
              <button onClick={() => setOpen(false)} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl"><X size={16} /></button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
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
                  <input value={form.attention ?? ''} onChange={e => setForm(f => ({ ...f, attention: e.target.value }))} placeholder="예: 김과장"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300" />
                </label>
              </div>

              {/* 거래처 */}
              <div className="space-y-1">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">거래처</span>
                {form.partnerId ? (
                  <div className="flex items-center gap-2">
                    <span className="px-3 py-2 rounded-xl bg-indigo-50 text-indigo-700 text-xs font-black">{form.partnerName}</span>
                    <button onClick={() => setForm(f => ({ ...f, partnerId: '', partnerName: '' }))}
                      className="text-[11px] font-black text-slate-400 hover:text-slate-600">바꾸기</button>
                  </div>
                ) : (
                  <div className="rounded-xl border border-slate-200 overflow-hidden">
                    <input autoFocus value={partnerSearch} onChange={e => setPartnerSearch(e.target.value)} placeholder="거래처명 검색..."
                      className="w-full px-3 py-2 text-xs font-bold border-b border-slate-100 outline-none" />
                    {/* 크기 고정 — 검색으로 줄 수가 줄어도 창이 안 흔들린다 */}
                    <div className="h-40 overflow-y-auto">
                      {partners.filter(p => !partnerSearch.trim() || matchesSearch(p.name, partnerSearch.trim()))
                        .slice(0, 200).map(p => (
                        <button key={p.id} onClick={() => setForm(f => ({ ...f, partnerId: p.id, partnerName: p.name }))}
                          className="w-full text-left px-3 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-indigo-50 truncate">{p.name}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 품목 */}
              <div className="rounded-2xl border border-slate-200 overflow-hidden">
                <div className="grid grid-cols-[1fr_78px_100px_100px_52px_32px] bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  <span className="px-3 py-2">품목</span>
                  <span className="px-2 py-2 text-right">수량</span>
                  <span className="px-2 py-2 text-right">단가</span>
                  <span className="px-2 py-2 text-right">금액</span>
                  <span className="px-2 py-2 text-center">과세</span>
                  <span />
                </div>
                {form.lines.map((l, i) => (
                  <div key={i} className="grid grid-cols-[1fr_78px_100px_100px_52px_32px] border-t border-slate-100 items-start">
                    <div className="px-3 py-2 min-w-0">
                      <input value={l.name} onChange={e => setLine(i, { name: e.target.value })}
                        onFocus={() => { setPickIdx(i); setItemSearch(''); }}
                        placeholder="품목명 (직접 적거나 골라도 됩니다)"
                        className="w-full bg-transparent text-xs font-bold outline-none" />
                      <input value={l.spec} onChange={e => setLine(i, { spec: e.target.value })} placeholder="규격"
                        className="w-full bg-transparent text-[10px] text-slate-400 outline-none" />
                      {pickIdx === i && (
                        <div className="mt-1.5 rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden">
                          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-slate-100">
                            <input value={itemSearch} onChange={e => setItemSearch(e.target.value)} placeholder="품목 검색..."
                              className="flex-1 text-xs font-bold outline-none" />
                            <button onClick={() => setPickIdx(null)} className="text-slate-300 hover:text-slate-600"><X size={12} /></button>
                          </div>
                          <div className="h-40 overflow-y-auto">
                            {items.filter(x => !itemSearch.trim() || matchesSearch(`${x.name} ${x.spec ?? ''}`, itemSearch.trim()))
                              .slice(0, 200).map(x => (
                              <button key={x.id}
                                onClick={() => {
                                  setLine(i, {
                                    name: x.name, spec: String(x.spec ?? ''),
                                    price: priceFor(x.id) ?? Number(x.price ?? 0),
                                    isTaxExempt: x.taxType === '면세',
                                  });
                                  setPickIdx(null);
                                }}
                                className="w-full text-left px-3 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-indigo-50 truncate">
                                {x.name}<span className="text-slate-400 ml-1">{x.spec ?? ''}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <input value={String(l.qty)} inputMode="decimal" onChange={e => setLine(i, { qty: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 })}
                      className="mx-1 mt-2 text-right bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold outline-none" />
                    <input value={String(l.price)} inputMode="numeric" onChange={e => setLine(i, { price: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 })}
                      className="mx-1 mt-2 text-right bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold outline-none" />
                    <span className="px-2 py-4 text-right text-xs font-black text-slate-800 tabular-nums">{fmt(l.qty * l.price)}</span>
                    <button onClick={() => setLine(i, { isTaxExempt: !l.isTaxExempt })}
                      className={`mx-1 mt-2 py-1.5 rounded-lg text-[10px] font-black border ${l.isTaxExempt ? 'bg-indigo-500 text-white border-indigo-500' : 'bg-white text-slate-500 border-slate-200'}`}>
                      {l.isTaxExempt ? '면세' : '과세'}
                    </button>
                    <button onClick={() => setForm(f => ({ ...f, lines: f.lines.filter((_, k) => k !== i) }))}
                      className="text-slate-300 hover:text-rose-500 justify-self-center mt-3.5"><Trash2 size={13} /></button>
                  </div>
                ))}
                <button onClick={() => setForm(f => ({ ...f, lines: [...f.lines, emptyLine()] }))}
                  className="w-full py-2 border-t border-slate-100 text-[11px] font-black text-indigo-600 hover:bg-indigo-50">+ 줄 추가</button>
              </div>

              <label className="block space-y-1">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">비고</span>
                <textarea value={form.note ?? ''} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} rows={2}
                  placeholder="결제 조건, 납기 등"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300" />
              </label>

              <div className="rounded-2xl bg-slate-900 text-white px-5 py-3 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-4 text-[11px] font-bold text-slate-400">
                  <span>공급가 <b className="text-white tabular-nums">{fmt(totals.supply)}</b></span>
                  <span>부가세 <b className="text-white tabular-nums">{fmt(totals.tax)}</b></span>
                </div>
                <span className="text-lg font-black tabular-nums">{fmt(totals.total)}원</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-slate-100">
              <button onClick={() => setOpen(false)} className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-black hover:bg-slate-200">취소</button>
              <button onClick={save} disabled={saving}
                className="px-5 py-2 rounded-xl bg-indigo-600 text-white text-xs font-black hover:bg-indigo-700 disabled:opacity-60">
                {saving ? '저장 중…' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 보기 · 인쇄 ── */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 print:static print:bg-white print:p-0"
          onClick={() => setEditing(null)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden print:max-h-none print:shadow-none print:rounded-none"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-3 border-b border-slate-100 print:hidden">
              <h3 className="font-black text-slate-900 text-sm">{editing.quoteNo}</h3>
              <div className="flex items-center gap-2">
                <button onClick={() => window.print()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-black hover:bg-slate-800">
                  <Printer size={13} />인쇄
                </button>
                <button onClick={() => setEditing(null)} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl"><X size={16} /></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-8 py-6 print:overflow-visible">
              <h2 className="text-center text-2xl font-black tracking-[0.4em] text-slate-900 mb-6">견 적 서</h2>
              <div className="flex justify-between gap-6 mb-5 text-xs">
                <div className="space-y-1">
                  <p className="font-black text-slate-800 text-sm">{editing.partnerName} 귀중</p>
                  {editing.attention && <p className="text-slate-500">담당 {editing.attention}</p>}
                  <p className="text-slate-400">아래와 같이 견적합니다.</p>
                </div>
                <div className="text-right space-y-0.5 text-slate-500 whitespace-nowrap">
                  <p><span className="text-slate-400">견적번호</span> <b className="font-mono text-slate-700">{editing.quoteNo}</b></p>
                  <p><span className="text-slate-400">일자</span> <b className="font-mono text-slate-700">{editing.date}</b></p>
                  {editing.validUntil && <p><span className="text-slate-400">유효기한</span> <b className="font-mono text-slate-700">{editing.validUntil}</b></p>}
                  <p className="pt-1 font-black text-slate-800">{companyName}</p>
                </div>
              </div>
              <table className="w-full text-xs border-t-2 border-slate-800">
                <thead>
                  <tr className="bg-slate-50 text-slate-500">
                    <th className="px-3 py-2 text-left font-black">품목</th>
                    <th className="px-3 py-2 text-left font-black">규격</th>
                    <th className="px-3 py-2 text-right font-black">수량</th>
                    <th className="px-3 py-2 text-right font-black">단가</th>
                    <th className="px-3 py-2 text-right font-black">금액</th>
                  </tr>
                </thead>
                <tbody>
                  {editing.lines.map((l, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="px-3 py-2 font-bold text-slate-800">
                        {l.name}{l.isTaxExempt && <span className="ml-1 text-[9px] font-black text-indigo-500">면세</span>}
                      </td>
                      <td className="px-3 py-2 text-slate-500">{l.spec}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{fmt(l.qty)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{fmt(l.price)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-black text-slate-800">{fmt(l.qty * l.price)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-slate-800">
                  <tr><td colSpan={4} className="px-3 py-1.5 text-right font-bold text-slate-500">공급가액</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-black">{fmt(editing.totalSupply)}</td></tr>
                  <tr><td colSpan={4} className="px-3 py-1.5 text-right font-bold text-slate-500">부가세</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-black">{fmt(editing.totalTax)}</td></tr>
                  <tr className="bg-slate-50"><td colSpan={4} className="px-3 py-2 text-right font-black text-slate-800">합계</td>
                    <td className="px-3 py-2 text-right tabular-nums font-black text-base">{fmt(editing.totalAmount)}</td></tr>
                </tfoot>
              </table>
              {editing.note && (
                <p className="mt-4 text-[11px] text-slate-500 whitespace-pre-wrap border-t border-slate-100 pt-3">{editing.note}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
