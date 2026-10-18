import QueryFilterPanel, { QUERY_FILTER_LABEL_CLASS , QUERY_FILTER_FIELD_CLASS, QUERY_FILTER_SEARCH_CLASS, QUERY_FILTER_DATE_CLASS } from '../src/shared/components/QueryFilterPanel';
import type { Props } from '../src/features/statements/domain/cashLedger';
import { fmt } from '../src/features/statements/ui/cashEntryDisplay';
import { ACCOUNT_ICON } from '../src/features/statements/ui/cashAccountDisplay';
import { EntryModal } from '../src/features/statements/ui/CashLedgerEntryModal';
import { MatchModal } from '../src/features/statements/ui/CashLedgerMatchModal';
import { AccountModal } from '../src/features/statements/ui/CashLedgerAccountModal';
export {MatchModal} from '../src/features/statements/ui/CashLedgerMatchModal';
export {AccountModal} from '../src/features/statements/ui/CashLedgerAccountModal';
import { useDeleteConfirmation } from '../src/shared/components/useDeleteConfirmation';
import React, { useMemo, useState } from 'react';
import { monthStart, today } from '../src/shared/day';
import DateRangeFilter, { type DateRangeQuick } from '../src/shared/components/DateRangeFilter';
import { Wallet, Plus, Settings2, Trash2, Link2 } from 'lucide-react';
import { CashEntry, companyOf } from '../src/shared/types';
import { buildAccountLedger, totalCashOnHand, unmatchedCash } from '../src/features/admin/cashLedger';
export default function CashLedger({
  companyId, cashAccounts, cashEntries, accountCodes, returnOperations, advanceStatements, fixedCostTemplates = [], partners, issuedStatements, settlements, currentUser,
  onAddCashAccount, onUpdateCashAccount, onCorrectCashAccount, onAddCashEntry, onDeleteCashEntry,
  onAddSettlement, onDeleteSettlement,
}: Props) {
  const confirmDelete = useDeleteConfirmation();
  const [activeId, setActiveId] = useState<string>('');
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [rangeQuick, setRangeQuick] = useState<DateRangeQuick>('당월');
  const [showEntry, setShowEntry] = useState(false);
  const [showAccounts, setShowAccounts] = useState(false);
  const [matchTarget, setMatchTarget] = useState<CashEntry | null>(null);

  const effAccounts = cashAccounts;

  const currentDate = today();
  const active = effAccounts.find(a => a.id === activeId) ?? effAccounts[0];
  const totalCash = useMemo(
    () => totalCashOnHand(effAccounts.filter(a => a.type !== '카드'), cashEntries, currentDate),
    [effAccounts, cashEntries, currentDate],
  );
  const ledger = useMemo(
    () => (active ? buildAccountLedger(active, cashEntries, from, to) : null),
    [active, cashEntries, from, to],
  );
  const codeName = useMemo(() => new Map(accountCodes.map(c => [c.code, c.name])), [accountCodes]);
  // 과거 공란 기록은 실계좌에 추정 귀속하거나 현재 잔액에 합치지 않는다.
  const unknownEntries = cashEntries.filter(entry => companyOf(entry) === companyId && !entry.cashAccountId);
  const unknownAccountSection = unknownEntries.length > 0 && (
    <section aria-label="계좌 미지정" className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <h3 className="text-sm font-black text-amber-900">계좌 미지정</h3>
      <p className="mt-1 text-xs text-amber-800">계좌 확인이 필요한 과거 기록입니다. 등록된 통장·현금 잔액에는 포함하지 않습니다.</p>
      <div className="mt-3 space-y-2">
        {unknownEntries.map(entry => (
          <div key={entry.id} className="flex flex-wrap gap-x-3 gap-y-1 rounded-lg bg-white px-3 py-2 text-xs">
            <span>{entry.date}</span><span>{entry.note || entry.partnerName || '자금 기록'}</span>
            <strong>{entry.dir} {fmt(entry.amount)}원</strong>
          </div>
        ))}
      </div>
    </section>
  );

  // ── 계좌가 하나도 없을 때 ──
  if (cashAccounts.length === 0) {
    return (
      <>
        {unknownAccountSection}
        <div className="bg-white rounded-2xl border border-slate-100 py-24 flex flex-col items-center justify-center gap-4">
          <Wallet size={44} className="text-slate-200" />
          <div className="text-center">
            <p className="text-sm font-black text-slate-700">등록된 자금 계좌가 없습니다</p>
            <p className="text-xs text-slate-400 mt-1">통장·카드·현금을 등록하면 입출금을 기록하고 잔액을 추적합니다.</p>
          </div>
          <button onClick={() => setShowAccounts(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-800 text-white text-xs font-black hover:bg-slate-900">
            <Plus size={14} strokeWidth={3} />계좌 등록
          </button>
        </div>
        {showAccounts && (
          <AccountModal companyId={companyId} accounts={cashAccounts} cashEntries={cashEntries} onClose={() => setShowAccounts(false)}
            onAdd={onAddCashAccount} onUpdate={onUpdateCashAccount} onCorrect={onCorrectCashAccount} onAddEntry={onAddCashEntry} />
        )}
      </>
    );
  }

  return (
    <div className="space-y-4">
      {unknownAccountSection}
      {/* ── 자금 현황 ── */}
      <div className="flex items-stretch gap-3 flex-wrap">
        <div className="bg-slate-800 text-white rounded-2xl px-5 py-4 min-w-[200px]">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-wide">보유 자금 (통장+현금)</p>
          <p className="text-2xl font-black mt-1 tabular-nums">{fmt(totalCash)}<span className="text-sm ml-1 text-slate-400">원</span></p>
        </div>
        {cashAccounts.filter(a => a.active).map(a => {
          const bal = totalCashOnHand([a], cashEntries, currentDate);
          const Icon = ACCOUNT_ICON[a.type];
          return (
            <button key={a.id} onClick={() => setActiveId(a.id)}
              className={`text-left rounded-2xl px-5 py-4 min-w-[170px] border transition-all ${
                active?.id === a.id ? 'bg-white border-slate-800 shadow-sm' : 'bg-white border-slate-100 hover:border-slate-300'
              }`}>
              <div className="flex items-center gap-1.5">
                <Icon size={12} className="text-slate-400" />
                <p className="text-[10px] font-black text-slate-400 truncate">{a.name}</p>
              </div>
              <p className={`text-lg font-black mt-1 tabular-nums ${bal < 0 ? 'text-rose-600' : 'text-slate-800'}`}>{fmt(bal)}</p>
            </button>
          );
        })}
        <button onClick={() => setShowAccounts(true)}
          className="rounded-2xl px-4 border border-dashed border-slate-200 text-slate-300 hover:text-slate-500 hover:border-slate-400 transition-all">
          <Settings2 size={16} />
        </button>
      </div>

      {/* ── 원장 ── */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-50 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Wallet size={16} className="text-slate-400" />
            <span className="font-black text-sm text-slate-800">{active?.name}</span>
            <span className="text-[10px] font-black bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{active?.type}</span>
          </div>
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">

            <button onClick={() => setShowEntry(true)}
              className="flex min-h-11 shrink-0 items-center gap-1 whitespace-nowrap px-3 py-2 rounded-lg bg-slate-800 text-white text-xs font-bold hover:bg-slate-900">
              <Plus size={12} strokeWidth={3} />일반전표
            </button>
          </div>
        </div>

        <QueryFilterPanel id="cash-query-title" onReset={()=>{setFrom(monthStart());setTo(today());setRangeQuick('당월');}} dateRow={<>
<label className={QUERY_FILTER_DATE_CLASS}>기간
<DateRangeFilter from={from} to={to} quick={rangeQuick} label="자금 조회"
              onChange={(nextFrom, nextTo, quick) => { setFrom(nextFrom); setTo(nextTo); setRangeQuick(quick); }} /></label>
</>} />
        {/*  **표는 좁은 화면에서 가로로 민다.** `w-full` 만 있으면 폭에 맞춰 칸이 찌그러지고,
             한글이 한 글자씩 세로로 쌓여 아예 못 읽는다(2026-09-03 사장님 지적).
             최소 너비를 줘야 `overflow-x-auto` 가 실제로 넘쳐서 스크롤이 생긴다. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-xs">
            <thead className="bg-slate-50/70 text-slate-400">
              <tr>
                <th className="px-2 sm:px-4 py-2.5 text-left font-black whitespace-nowrap">일자</th>
                <th className="px-2 sm:px-4 py-2.5 text-left font-black whitespace-nowrap">적요</th>
                <th className="px-4 py-2.5 text-left font-black whitespace-nowrap">거래처</th>
                <th className="px-4 py-2.5 text-left font-black whitespace-nowrap">계정과목</th>
                <th className="px-2 sm:px-4 py-2.5 text-right font-black whitespace-nowrap">입금</th>
                <th className="px-2 sm:px-4 py-2.5 text-right font-black whitespace-nowrap">출금</th>
                <th className="px-2 sm:px-4 py-2.5 text-right font-black whitespace-nowrap">잔액</th>
                <th className="px-2 py-2.5 whitespace-nowrap" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              <tr className="bg-slate-50/40">
                <td className="px-2 sm:px-4 py-2.5 font-bold text-slate-400" colSpan={6}>이월 잔액</td>
                <td className="px-2 sm:px-4 py-2.5 text-right font-black text-slate-500 tabular-nums">{fmt(ledger?.opening ?? 0)}</td>
                <td />
              </tr>

              {ledger?.rows.map(({ entry, balance, adjustmentDelta: appliedAdjustment, confirmedAccountBalance }) => {
                const rowAdjustment = appliedAdjustment ?? entry.balanceAdjustment?.delta;
                const open = unmatchedCash(entry, settlements);
                const matchedCount = settlements.filter(s => s.cashEntryId === entry.id).length;
                return (
                  <tr key={entry.id} className="hover:bg-slate-50/50 group">
                    <td className="px-2 sm:px-4 py-2.5 font-bold text-slate-500 whitespace-nowrap">{entry.date.slice(5)}</td>
                    <td className="px-2 sm:px-4 py-2.5 font-bold text-slate-800 min-w-[180px] whitespace-nowrap">
                      {entry.balanceAdjustment ? `${confirmedAccountBalance || entry.balanceAdjustment.confirmedBalance ? '확정 잔액' : '잔액 조정'} · 회계 미분류 — ${entry.balanceAdjustment.reason}` : entry.note || '-'}
                      {entry.balanceAdjustment && <p className="text-[11px] font-normal text-slate-500">{fmt(balance - (rowAdjustment ?? 0))}원 → {fmt(balance)}원 · 조정 {fmt(rowAdjustment ?? 0)}원</p>}
                      {matchedCount > 0 && (
                        <span className="ml-1.5 text-[10px] font-black text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded">전표 {matchedCount}건</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{entry.partnerName || '-'}</td>
                    <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap">
                      {/* 쪼갠 줄(대출상환 원금+이자)이면 줄마다 계정 배지를 단다 */}
                      {(entry.lines ?? []).filter(l => l.accountCode && l.amount !== 0).length ? (
                        <span className="flex flex-wrap gap-1">
                          {entry.lines!.filter(l => l.accountCode && l.amount !== 0).map((l, i) => (
                            <span key={i} className="text-[10px] font-black bg-slate-100 px-1.5 py-0.5 rounded whitespace-nowrap">
                              {l.note ? `${l.note} ` : ''}{l.accountCode} {codeName.get(l.accountCode) ?? ''} {fmt(l.amount)}
                            </span>
                          ))}
                        </span>
                      ) : entry.accountCode
                        ? <span className="text-[10px] font-black bg-slate-100 px-1.5 py-0.5 rounded">{entry.accountCode} {codeName.get(entry.accountCode) ?? ''}</span>
                        : <span className="text-[10px] font-black text-amber-500 bg-amber-50 px-1.5 py-0.5 rounded">{entry.balanceAdjustment ? '회계 미분류' : '미지정'}</span>}
                    </td>
                    <td className="px-2 sm:px-4 py-2.5 text-right font-black text-emerald-600 tabular-nums">{entry.balanceAdjustment ? ((rowAdjustment ?? 0) > 0 ? fmt(rowAdjustment ?? 0) : '') : entry.dir === '입금' ? fmt(entry.amount) : ''}</td>
                    <td className="px-2 sm:px-4 py-2.5 text-right font-black text-rose-600 tabular-nums">{entry.balanceAdjustment ? ((rowAdjustment ?? 0) < 0 ? fmt(Math.abs(rowAdjustment ?? 0)) : '') : entry.dir === '출금' ? fmt(entry.amount) : ''}</td>
                    <td className={`px-4 py-2.5 text-right font-black tabular-nums ${balance < 0 ? 'text-rose-600' : 'text-slate-800'}`}>{fmt(balance)}</td>
                    <td className="px-2 py-2.5 whitespace-nowrap">
                      <div className="flex items-center gap-1 justify-end">
                        {!confirmedAccountBalance && <button disabled={!!entry.balanceAdjustment} onClick={() => { if (!entry.balanceAdjustment) setMatchTarget(entry); }} title="전표 매칭"
                          className={`transition-all ${open > 0 ? 'text-indigo-400 hover:text-indigo-600' : 'opacity-0 group-hover:opacity-100 text-slate-300 hover:text-slate-500'}`}>
                          <Link2 size={13} />
                        </button>}
                        {!confirmedAccountBalance && <button aria-label="거래 삭제" onClick={() => confirmDelete(entry.id, '이 거래를 삭제할까요?', () => onDeleteCashEntry(entry.id, entry))}
                          className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-rose-500 transition-all">
                          <Trash2 size={12} />
                        </button>}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {ledger?.rows.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-16 text-center text-slate-300 font-bold">이 기간에 거래가 없습니다</td></tr>
              )}
            </tbody>
            <tfoot className="bg-slate-50/70 border-t-2 border-slate-100">
              <tr>
                <td className="px-4 py-3 font-black text-slate-500" colSpan={4}>기간 합계 / 기말 잔액<p className="text-xs font-normal">잔액 조정 합계: {fmt(ledger?.totalAdjustment ?? 0)}원</p></td>
                <td className="px-4 py-3 text-right font-black text-emerald-600 tabular-nums">{fmt(ledger?.totalIn ?? 0)}</td>
                <td className="px-4 py-3 text-right font-black text-rose-600 tabular-nums">{fmt(ledger?.totalOut ?? 0)}</td>
                <td className="px-4 py-3 text-right font-black text-slate-800 tabular-nums">{fmt(ledger?.closing ?? 0)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {showEntry && active && (
        <EntryModal companyId={companyId} account={active} accounts={cashAccounts} accountCodes={accountCodes} fixedCostTemplates={fixedCostTemplates} partners={partners}
          currentUser={currentUser} onClose={() => setShowEntry(false)} onAdd={onAddCashEntry} />
      )}
      {showAccounts && (
        <AccountModal companyId={companyId} accounts={cashAccounts} cashEntries={cashEntries} onClose={() => setShowAccounts(false)}
          onAdd={onAddCashAccount} onUpdate={onUpdateCashAccount} onCorrect={onCorrectCashAccount} onAddEntry={onAddCashEntry} />
      )}
      {matchTarget && !matchTarget.balanceAdjustment && (
        <MatchModal key={`${companyId}:${matchTarget.id}`} entry={matchTarget} returnOperations={returnOperations} advanceStatements={advanceStatements} statements={issuedStatements} settlements={settlements} cashEntries={cashEntries}
          onClose={() => setMatchTarget(null)} onAdd={onAddSettlement} onDelete={onDeleteSettlement} />
      )}
    </div>
  );
}
