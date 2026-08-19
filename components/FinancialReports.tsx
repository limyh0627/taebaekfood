import React, { useEffect, useMemo, useState } from 'react';
import { ShieldCheck, ShieldAlert, ScrollText, TrendingUp, Scale, Pencil, Save, X } from 'lucide-react';
import type { IssuedStatement, CashEntry, AccountCode, CashAccount, CompanyId } from '../src/shared/types';
import { openingDocId } from '../src/shared/types';
import { buildJournals } from '../src/shared/buildJournals';
import { trialBalance, incomeStatement, balanceSheet } from '../src/shared/journal';
import type { OpeningBalance } from '../src/shared/autoJournal';
import { BANK } from '../src/shared/autoJournal';
import { fetchCollection, setDocument } from '../src/shared/services/firebaseService';

const CAPITAL = '331';   // 자본금 (기초 차액 plug)
interface OpeningDoc { id: string; date: string; amounts: Record<string, number>; }

interface Props {
  /** 보고 있는 회사 — 기초잔액 문서가 회사별로 다르다 */
  companyId?: CompanyId;
  statements: IssuedStatement[];
  cashEntries: CashEntry[];
  accounts: AccountCode[];
  cashAccounts: CashAccount[];
  /** 월말 재고 실사액 — 재고자산을 실사값으로 맞추는 조정분개를 만든다(실지재고조사법). */
  inventorySnapshots?: { id?: string; yearMonth: string; value: number }[];
}

const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}`;

/**
 * 재무제표 (복식부기 · 병행/대조용). 기존 전표·수금·자금에서 분개를 계산으로 뽑아
 * 시산표·손익계산서·재무상태표를 그린다. 저장 안 함, 읽기 전용. 기존 손익표와 대조하는 화면.
 */
const FinancialReports: React.FC<Props> = ({ statements, cashEntries, accounts, cashAccounts, inventorySnapshots = [], companyId = 'taebaek' }) => {
  const months = useMemo(() => {
    const s = new Set<string>();
    for (const st of statements) if (st.tradeDate) s.add(st.tradeDate.slice(0, 7));
    for (const e of cashEntries) if (e.date) s.add(e.date.slice(0, 7));
    return [...s].sort().reverse();
  }, [statements, cashEntries]);
  const [month, setMonth] = useState<string>('전체');

  // ── 기초잔액 문서 (openingBalances/main) ──
  const [openingDoc, setOpeningDoc] = useState<OpeningDoc | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<OpeningDoc | null>(null);
  const [saving, setSaving] = useState(false);
  // 회사별로 다른 문서를 읽는다 — 안 나누면 태백 기초잔액이 풍회 재무제표에 그대로 선다
  useEffect(() => {
    fetchCollection<OpeningDoc>('openingBalances')
      .then(rows => setOpeningDoc(rows.find(r => r.id === openingDocId(companyId)) ?? null))
      .catch(() => {});
  }, [companyId]);

  const cashDefault = useMemo(() => cashAccounts.filter(a => a.type !== '카드').reduce((s, a) => s + (a.openingBalance ?? 0), 0), [cashAccounts]);
  const defaultDate = useMemo(() => cashAccounts.map(a => a.openingDate).filter(Boolean).sort()[0] ?? '2026-07-01', [cashAccounts]);

  // 실제 적용할 기초잔액 — 저장문서 있으면 그것, 없으면 통장만 자동
  const opening: OpeningBalance = useMemo(() => {
    if (openingDoc) {
      return { date: openingDoc.date, capitalAccount: CAPITAL,
        lines: Object.entries(openingDoc.amounts).filter(([, v]) => v).map(([accountCode, amount]) => ({ accountCode, amount })) };
    }
    return { date: defaultDate, capitalAccount: CAPITAL, lines: cashDefault ? [{ accountCode: BANK, amount: cashDefault }] : [] };
  }, [openingDoc, defaultDate, cashDefault]);

  // 편집 대상 계정 — 자산·부채·자본 (자본금 제외, 그건 plug)
  const openableAccounts = useMemo(
    () => accounts.filter(a => (a.type === '자산' || a.type === '부채') || (a.type === '자본' && String(a.code) !== CAPITAL))
      .sort((a, b) => String(a.code).localeCompare(String(b.code))),
    [accounts]);

  const startEdit = () => {
    const base: OpeningDoc = openingDoc ?? { id: 'main', date: defaultDate, amounts: cashDefault ? { [BANK]: cashDefault } : {} };
    setDraft(JSON.parse(JSON.stringify(base))); setEditing(true);
  };
  const saveOpening = async () => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      const clean = { ...draft, id: 'main', amounts: Object.fromEntries(Object.entries(draft.amounts).filter(([, v]) => v)) };
      await setDocument('openingBalances', openingDocId(companyId), clean);
      setOpeningDoc(clean); setEditing(false);
    } finally { setSaving(false); }
  };
  // 자본금 plug 미리보기
  const capitalPreview = useMemo(() => {
    if (!draft) return 0;
    let d = 0, c = 0;
    for (const a of openableAccounts) {
      const amt = draft.amounts[String(a.code)] ?? 0;
      if (!amt) continue;
      const nb = a.normalBalance ?? 'debit';
      if (nb === 'debit') d += amt; else c += amt;
    }
    return Math.round(d - c);   // 차변이 크면 자본금(대변)으로
  }, [draft, openableAccounts]);

  const built = useMemo(() => buildJournals({ statements, cashEntries, accounts, opening, inventorySnapshots }),
    [statements, cashEntries, accounts, opening, inventorySnapshots]);

  const entries = useMemo(() => {
    if (month === '전체') return built.entries;
    // 기초분개는 항상 포함, 나머지는 선택월
    return built.entries.filter(e => e.sourceId === 'opening' || e.date.slice(0, 7) === month);
  }, [built, month]);

  const tb = useMemo(() => trialBalance(entries, accounts), [entries, accounts]);
  const is = useMemo(() => incomeStatement(entries, accounts), [entries, accounts]);
  const bs = useMemo(() => balanceSheet(entries, accounts), [entries, accounts]);

  const typeColor: Record<string, string> = {
    자산: 'text-blue-600', 부채: 'text-rose-600', 자본: 'text-violet-600', 수익: 'text-emerald-600', 비용: 'text-amber-600',
  };

  return (
    <div className="space-y-4">
      {/* 헤더 · 무결성 · 기간 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black ${tb.balanced ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
            {tb.balanced ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}
            {tb.balanced ? '차대 일치' : '차대 불일치'}
          </span>
          <span className="text-[11px] font-bold text-slate-400">복식부기 · 기존 데이터에서 계산 (병행/대조용)</span>
        </div>
        <div className="flex gap-1 flex-wrap">
          <button onClick={() => setMonth('전체')} className={`px-3 py-1.5 rounded-xl text-xs font-black border ${month === '전체' ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-slate-500'}`}>전체</button>
          {months.map(m => (
            <button key={m} onClick={() => setMonth(m)} className={`px-3 py-1.5 rounded-xl text-xs font-black border ${month === m ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-slate-500'}`}>{m}</button>
          ))}
        </div>
      </div>

      {built.skipped.length > 0 && (
        <div className="text-[11px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          분개 못 만든 원본 {built.skipped.length}건 (계정 미지정 등) — 재무제표에서 빠짐
        </div>
      )}

      {/* 기초잔액 편집 */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 flex items-center justify-between border-b border-slate-100">
          <div>
            <span className="text-xs font-black text-slate-500 uppercase tracking-widest">기초잔액</span>
            <span className="text-[11px] font-bold text-slate-400 ml-2">
              {openingDoc ? `${openingDoc.date} 기준` : `미입력 — 통장 ${won(cashDefault)}만 반영 중`}
            </span>
          </div>
          {!editing ? (
            <button onClick={startEdit} className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-900 text-white text-[11px] font-black"><Pencil size={12} /> 편집</button>
          ) : (
            <div className="flex gap-1.5">
              <button onClick={() => setEditing(false)} className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-100 text-slate-500 text-[11px] font-black"><X size={12} /> 취소</button>
              <button onClick={saveOpening} disabled={saving} className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-[11px] font-black disabled:opacity-40"><Save size={12} /> 저장</button>
            </div>
          )}
        </div>
        {editing && draft && (
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-black text-slate-400">컷오프 날짜</span>
              <input type="date" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })}
                className="border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300" />
              <span className="text-[10px] font-bold text-slate-400">이 날짜의 기초 잔액. 이 값들의 차액이 자본금으로 들어갑니다.</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {openableAccounts.map(a => (
                <label key={a.code} className="flex items-center gap-2 border border-slate-150 rounded-xl px-2.5 py-1.5">
                  <span className="text-[11px] font-bold text-slate-500 flex-1 truncate"><span className="text-slate-300 mr-1">{a.code}</span>{a.name}</span>
                  <input inputMode="numeric" value={draft.amounts[String(a.code)] || ''} placeholder="0"
                    onChange={e => setDraft({ ...draft, amounts: { ...draft.amounts, [String(a.code)]: Number(e.target.value.replace(/[^\d]/g, '')) || 0 } })}
                    className="w-28 text-right text-xs font-black tabular-nums border border-slate-200 rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-indigo-300" />
                </label>
              ))}
            </div>
            <div className="flex items-center justify-between bg-violet-50 border border-violet-200 rounded-xl px-3 py-2">
              <span className="text-[11px] font-black text-violet-700">331 자본금 (자동 차액)</span>
              <span className="text-sm font-black text-violet-700 tabular-nums">{won(capitalPreview)}</span>
            </div>
            <p className="text-[10px] font-bold text-slate-400 leading-relaxed">
              통장 실잔액은 보통예금(103), 못 받은 돈은 외상매출금(108), 갚을 돈은 외상매입금(251)·미지급금(253),
              대출은 단기·장기차입금에 넣으세요. 재고자산 계정이 없으면 나중에 추가합니다. 언제든 다시 편집 가능합니다.
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 손익계산서 */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="flex items-center gap-1.5 text-xs font-black text-slate-500 uppercase tracking-widest mb-3"><TrendingUp size={14} /> 손익계산서</div>
          <Row label="수익" v={is.revenue} color="text-emerald-600" />
          <Row label="비용" v={-is.expense} color="text-amber-600" />
          <div className="h-px bg-slate-100 my-2" />
          <Row label="당기순이익" v={is.netIncome} bold color={is.netIncome >= 0 ? 'text-emerald-700' : 'text-rose-600'} />
        </div>

        {/* 재무상태표 */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="flex items-center gap-1.5 text-xs font-black text-slate-500 uppercase tracking-widest mb-3"><Scale size={14} /> 재무상태표</div>
          <Row label="자산" v={bs.asset} color="text-blue-600" />
          <div className="h-px bg-slate-100 my-2" />
          <Row label="부채" v={bs.liability} color="text-rose-600" />
          <Row label="자본" v={bs.equity} color="text-violet-600" />
          <Row label="당기순이익" v={bs.netIncome} color="text-emerald-600" />
          <div className="h-px bg-slate-100 my-2" />
          <div className={`flex items-center justify-between text-[11px] font-black ${bs.balanced ? 'text-emerald-600' : 'text-rose-600'}`}>
            <span>{bs.balanced ? '균형 ✓' : '불균형 (기초잔액 필요)'}</span>
            <span>부채+자본+순이익 {won(bs.liability + bs.equity + bs.netIncome)}</span>
          </div>
        </div>

        {/* 요약 */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="flex items-center gap-1.5 text-xs font-black text-slate-500 uppercase tracking-widest mb-3"><ScrollText size={14} /> 시산표 합계</div>
          <Row label="차변 총계" v={tb.totalDebit} color="text-slate-700" />
          <Row label="대변 총계" v={tb.totalCredit} color="text-slate-700" />
          <div className="h-px bg-slate-100 my-2" />
          <p className="text-[11px] font-bold text-slate-400 leading-relaxed">
            분개 {entries.length}건에서 계산. 통장 기초 {won(opening.lines.reduce((s, l) => s + l.amount, 0))}원만 반영됨 —
            미수·미지급·재고 기초는 아직 미입력이라 재무상태표가 안 맞을 수 있습니다.
          </p>
        </div>
      </div>

      {/* 시산표 상세 */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 text-xs font-black text-slate-500 uppercase tracking-widest border-b border-slate-100">합계잔액시산표</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase">
              <tr><th className="px-3 py-2 text-left">계정</th><th className="px-3 py-2 text-center">구분</th><th className="px-3 py-2 text-right">차변</th><th className="px-3 py-2 text-right">대변</th><th className="px-3 py-2 text-right">잔액</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {tb.rows.map(r => (
                <tr key={r.accountCode} className="hover:bg-slate-50/50">
                  <td className="px-3 py-2 font-bold text-slate-700"><span className="text-slate-300 mr-1.5">{r.accountCode}</span>{r.name}</td>
                  <td className="px-3 py-2 text-center"><span className={`text-[10px] font-black ${typeColor[r.type ?? ''] ?? 'text-slate-400'}`}>{r.type ?? '-'}</span></td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{r.debit ? won(r.debit) : ''}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{r.credit ? won(r.credit) : ''}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-black text-slate-800">{won(r.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 font-black">
              <tr><td className="px-3 py-2 text-slate-600" colSpan={2}>합계</td>
                <td className="px-3 py-2 text-right tabular-nums">{won(tb.totalDebit)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{won(tb.totalCredit)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{tb.balanced ? '✓' : '✗'}</td></tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
};

const Row: React.FC<{ label: string; v: number; color?: string; bold?: boolean }> = ({ label, v, color, bold }) => (
  <div className={`flex items-center justify-between py-1 ${bold ? 'text-sm' : 'text-[13px]'}`}>
    <span className={`font-bold ${bold ? 'text-slate-800' : 'text-slate-500'}`}>{label}</span>
    <span className={`tabular-nums font-black ${color ?? 'text-slate-700'}`}>{won(v)}</span>
  </div>
);

export default FinancialReports;
