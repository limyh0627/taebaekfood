import React, { useMemo, useState } from 'react';
import { ShieldCheck, ShieldAlert, ScrollText, TrendingUp, Scale } from 'lucide-react';
import type { IssuedStatement, CashEntry, AccountCode, CashAccount } from '../src/shared/types';
import { buildJournals } from '../src/shared/buildJournals';
import { trialBalance, incomeStatement, balanceSheet, inRange } from '../src/shared/journal';
import type { OpeningBalance } from '../src/shared/autoJournal';
import { BANK } from '../src/shared/autoJournal';

interface Props {
  statements: IssuedStatement[];
  cashEntries: CashEntry[];
  accounts: AccountCode[];
  cashAccounts: CashAccount[];
}

const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}`;

/**
 * 재무제표 (복식부기 · 병행/대조용). 기존 전표·수금·자금에서 분개를 계산으로 뽑아
 * 시산표·손익계산서·재무상태표를 그린다. 저장 안 함, 읽기 전용. 기존 손익표와 대조하는 화면.
 */
const FinancialReports: React.FC<Props> = ({ statements, cashEntries, accounts, cashAccounts }) => {
  const months = useMemo(() => {
    const s = new Set<string>();
    for (const st of statements) if (st.tradeDate) s.add(st.tradeDate.slice(0, 7));
    for (const e of cashEntries) if (e.date) s.add(e.date.slice(0, 7));
    return [...s].sort().reverse();
  }, [statements, cashEntries]);
  const [month, setMonth] = useState<string>('전체');

  // 기초잔액 — 통장 openingBalance를 보통예금으로. (나머지 미수/미지급/재고는 나중에 편집)
  const opening: OpeningBalance = useMemo(() => {
    const cashTotal = cashAccounts.filter(a => a.type !== '카드').reduce((s, a) => s + (a.openingBalance ?? 0), 0);
    const date = cashAccounts.map(a => a.openingDate).filter(Boolean).sort()[0] ?? '2026-07-01';
    return { date, lines: cashTotal ? [{ accountCode: BANK, amount: cashTotal }] : [] };
  }, [cashAccounts]);

  const built = useMemo(() => buildJournals({ statements, cashEntries, accounts, opening }), [statements, cashEntries, accounts, opening]);

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
