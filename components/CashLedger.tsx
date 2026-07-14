import React, { useMemo, useState } from 'react';
import { Wallet, Plus, X, Landmark, CreditCard, Coins, Settings2, Trash2, Link2 } from 'lucide-react';
import { CashAccount, CashEntry, AccountCode, Partner, IssuedStatement, Settlement } from '../src/shared/types';
import { buildAccountLedger, totalCashOnHand, unsettledStatements, unmatchedCash } from '../src/features/admin/cashLedger';

interface Props {
  cashAccounts: CashAccount[];
  cashEntries: CashEntry[];
  accountCodes: AccountCode[];
  partners: Partner[];
  issuedStatements: IssuedStatement[];
  settlements: Settlement[];
  currentUser?: { id: string; name: string } | null;
  onAddCashAccount: (a: Omit<CashAccount, 'id'> & { id: string }) => void;
  onUpdateCashAccount: (id: string, data: Partial<CashAccount>) => void;
  onAddCashEntry: (e: Omit<CashEntry, 'id'> & { id: string }) => void;
  onDeleteCashEntry: (id: string) => void;
  onAddSettlement: (s: Omit<Settlement, 'id'> & { id: string }) => void;
  onDeleteSettlement: (id: string) => void;
}

const fmt = (n: number) => n.toLocaleString('ko-KR');
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => today().slice(0, 7) + '-01';

const ACCOUNT_ICON = { 통장: Landmark, 카드: CreditCard, 현금: Coins } as const;

export default function CashLedger({
  cashAccounts, cashEntries, accountCodes, partners, issuedStatements, settlements, currentUser,
  onAddCashAccount, onUpdateCashAccount, onAddCashEntry, onDeleteCashEntry,
  onAddSettlement, onDeleteSettlement,
}: Props) {
  const [activeId, setActiveId] = useState<string>('');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [showEntry, setShowEntry] = useState(false);
  const [showAccounts, setShowAccounts] = useState(false);
  const [matchTarget, setMatchTarget] = useState<CashEntry | null>(null);

  const active = cashAccounts.find(a => a.id === activeId) ?? cashAccounts[0];
  const totalCash = useMemo(
    () => totalCashOnHand(cashAccounts.filter(a => a.type !== '카드'), cashEntries, today()),
    [cashAccounts, cashEntries],
  );
  const ledger = useMemo(
    () => (active ? buildAccountLedger(active, cashEntries, from, to) : null),
    [active, cashEntries, from, to],
  );
  const codeName = useMemo(() => new Map(accountCodes.map(c => [c.code, c.name])), [accountCodes]);

  // ── 계좌가 하나도 없을 때 ──
  if (cashAccounts.length === 0) {
    return (
      <>
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
          <AccountModal accounts={cashAccounts} onClose={() => setShowAccounts(false)}
            onAdd={onAddCashAccount} onUpdate={onUpdateCashAccount} />
        )}
      </>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── 자금 현황 ── */}
      <div className="flex items-stretch gap-3 flex-wrap">
        <div className="bg-slate-800 text-white rounded-2xl px-5 py-4 min-w-[200px]">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-wide">보유 자금 (통장+현금)</p>
          <p className="text-2xl font-black mt-1 tabular-nums">{fmt(totalCash)}<span className="text-sm ml-1 text-slate-400">원</span></p>
        </div>
        {cashAccounts.filter(a => a.active).map(a => {
          const bal = totalCashOnHand([a], cashEntries, today());
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
          <div className="flex items-center gap-2">
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-slate-300" />
            <span className="text-slate-300 text-xs">~</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-slate-300" />
            <button onClick={() => setShowEntry(true)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 text-white text-[11px] font-black hover:bg-slate-900">
              <Plus size={12} strokeWidth={3} />입출금 기록
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50/70 text-slate-400">
              <tr>
                <th className="px-4 py-2.5 text-left font-black">일자</th>
                <th className="px-4 py-2.5 text-left font-black">적요</th>
                <th className="px-4 py-2.5 text-left font-black">거래처</th>
                <th className="px-4 py-2.5 text-left font-black">계정과목</th>
                <th className="px-4 py-2.5 text-right font-black">입금</th>
                <th className="px-4 py-2.5 text-right font-black">출금</th>
                <th className="px-4 py-2.5 text-right font-black">잔액</th>
                <th className="px-2 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              <tr className="bg-slate-50/40">
                <td className="px-4 py-2.5 font-bold text-slate-400" colSpan={6}>이월 잔액</td>
                <td className="px-4 py-2.5 text-right font-black text-slate-500 tabular-nums">{fmt(ledger?.opening ?? 0)}</td>
                <td />
              </tr>

              {ledger?.rows.map(({ entry, balance }) => {
                const open = unmatchedCash(entry, settlements);
                const matchedCount = settlements.filter(s => s.cashEntryId === entry.id).length;
                return (
                  <tr key={entry.id} className="hover:bg-slate-50/50 group">
                    <td className="px-4 py-2.5 font-bold text-slate-500 whitespace-nowrap">{entry.date.slice(5)}</td>
                    <td className="px-4 py-2.5 font-bold text-slate-800">
                      {entry.note || '-'}
                      {matchedCount > 0 && (
                        <span className="ml-1.5 text-[10px] font-black text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded">전표 {matchedCount}건</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">{entry.partnerName || '-'}</td>
                    <td className="px-4 py-2.5 text-slate-400">
                      {entry.accountCode
                        ? <span className="text-[10px] font-black bg-slate-100 px-1.5 py-0.5 rounded">{entry.accountCode} {codeName.get(entry.accountCode) ?? ''}</span>
                        : <span className="text-[10px] font-black text-amber-500 bg-amber-50 px-1.5 py-0.5 rounded">미지정</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right font-black text-emerald-600 tabular-nums">{entry.dir === '입금' ? fmt(entry.amount) : ''}</td>
                    <td className="px-4 py-2.5 text-right font-black text-rose-600 tabular-nums">{entry.dir === '출금' ? fmt(entry.amount) : ''}</td>
                    <td className={`px-4 py-2.5 text-right font-black tabular-nums ${balance < 0 ? 'text-rose-600' : 'text-slate-800'}`}>{fmt(balance)}</td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => setMatchTarget(entry)} title="전표 매칭"
                          className={`transition-all ${open > 0 ? 'text-indigo-400 hover:text-indigo-600' : 'opacity-0 group-hover:opacity-100 text-slate-300 hover:text-slate-500'}`}>
                          <Link2 size={13} />
                        </button>
                        <button onClick={() => { if (confirm('이 거래를 삭제할까요?')) onDeleteCashEntry(entry.id); }}
                          className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-rose-500 transition-all">
                          <Trash2 size={12} />
                        </button>
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
                <td className="px-4 py-3 font-black text-slate-500" colSpan={4}>기간 합계 / 기말 잔액</td>
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
        <EntryModal account={active} accounts={cashAccounts} accountCodes={accountCodes} partners={partners}
          currentUser={currentUser} onClose={() => setShowEntry(false)} onAdd={onAddCashEntry} />
      )}
      {showAccounts && (
        <AccountModal accounts={cashAccounts} onClose={() => setShowAccounts(false)}
          onAdd={onAddCashAccount} onUpdate={onUpdateCashAccount} />
      )}
      {matchTarget && (
        <MatchModal entry={matchTarget} statements={issuedStatements} settlements={settlements}
          onClose={() => setMatchTarget(null)} onAdd={onAddSettlement} onDelete={onDeleteSettlement} />
      )}
    </div>
  );
}

// ── 전표 매칭 모달 ────────────────────────────────────────────────────────────
// 출금 → 매입전표 상계, 입금 → 매출전표 상계. 이체 1건을 전표 여러 건에 나눠 붙일 수 있다.
function MatchModal({ entry, statements, settlements, onClose, onAdd, onDelete }: {
  entry: CashEntry;
  statements: IssuedStatement[];
  settlements: Settlement[];
  onClose: () => void;
  onAdd: Props['onAddSettlement'];
  onDelete: Props['onDeleteSettlement'];
}) {
  const stmtType = entry.dir === '출금' ? '매입' : '매출';
  const remaining = unmatchedCash(entry, settlements);

  // 이 자금 건에 이미 붙은 매칭
  const linked = settlements
    .filter(s => s.cashEntryId === entry.id)
    .map(s => ({ settlement: s, stmt: statements.find(st => st.id === s.statementId) }));

  // 붙일 수 있는 미결제 전표 — 거래처가 지정돼 있으면 그 거래처로 좁힌다
  const candidates = useMemo(
    () => unsettledStatements(statements, settlements, {
      type: stmtType,
      ...(entry.partnerId ? { partnerId: entry.partnerId } : {}),
    }),
    [statements, settlements, stmtType, entry.partnerId],
  );

  const attach = (statementId: string, open: number) => {
    const amount = Math.min(open, remaining);
    if (amount <= 0) return;
    onAdd({
      id: `settle-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      cashEntryId: entry.id, statementId, amount,
      createdAt: new Date().toISOString(),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-800">전표 매칭</h3>
          <button onClick={onClose} className="text-slate-300 hover:text-slate-500"><X size={18} /></button>
        </div>

        <div className="bg-slate-50 rounded-2xl px-4 py-3 flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-sm font-black text-slate-800 truncate">{entry.note || (entry.dir === '출금' ? '출금' : '입금')}</p>
            <p className="text-[11px] text-slate-400">{entry.date} · {entry.partnerName || '거래처 미지정'}</p>
          </div>
          <div className="text-right shrink-0 ml-3">
            <p className={`text-lg font-black tabular-nums ${entry.dir === '출금' ? 'text-rose-600' : 'text-emerald-600'}`}>{fmt(entry.amount)}</p>
            <p className="text-[10px] font-black text-slate-400">미매칭 {fmt(remaining)}</p>
          </div>
        </div>

        {/* 이미 붙은 전표 */}
        {linked.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-black text-slate-400 uppercase">매칭된 전표</p>
            {linked.map(({ settlement, stmt }) => (
              <div key={settlement.id} className="flex items-center gap-3 bg-indigo-50/60 rounded-xl px-4 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-black text-slate-800 truncate">{stmt?.partnerName ?? '(삭제된 전표)'}</p>
                  <p className="text-[10px] text-slate-400">{stmt?.tradeDate ?? ''} · {stmt?.docNo ?? settlement.statementId}</p>
                </div>
                <p className="text-xs font-black text-indigo-600 tabular-nums shrink-0">{fmt(settlement.amount)}</p>
                <button onClick={() => onDelete(settlement.id)} className="text-slate-300 hover:text-rose-500 shrink-0">
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 붙일 전표 후보 */}
        <div className="space-y-1.5">
          <p className="text-[10px] font-black text-slate-400 uppercase">
            미결제 {stmtType}전표 {entry.partnerId ? `· ${entry.partnerName}` : '· 전체 거래처'}
          </p>
          {remaining <= 0 && (
            <p className="text-[11px] font-bold text-emerald-600 bg-emerald-50 rounded-xl px-4 py-2.5">
              이 자금은 전액 매칭됐습니다.
            </p>
          )}
          {remaining > 0 && candidates.length === 0 && (
            <p className="text-[11px] font-bold text-slate-400 bg-slate-50 rounded-xl px-4 py-6 text-center">
              붙일 미결제 {stmtType}전표가 없습니다.
            </p>
          )}
          {remaining > 0 && candidates.map(({ stmt, open }) => (
            <button key={stmt.id} onClick={() => attach(stmt.id, open)}
              className="w-full flex items-center gap-3 bg-white border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/40 rounded-xl px-4 py-2.5 text-left transition-all">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-black text-slate-800 truncate">{stmt.partnerName}</p>
                <p className="text-[10px] text-slate-400">{stmt.tradeDate} · {stmt.docNo}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs font-black text-slate-700 tabular-nums">{fmt(open)}</p>
                <p className="text-[9px] font-black text-indigo-500">{fmt(Math.min(open, remaining))} 상계</p>
              </div>
            </button>
          ))}
        </div>

        <p className="text-[10px] text-slate-400 leading-snug">
          전표를 누르면 미매칭 금액만큼 상계됩니다. 밀린 전표 여러 건을 한 번의 이체로 끄려면 차례로 누르면 되고,
          한 전표를 나눠서 결제했다면 이체 건마다 같은 전표를 눌러 붙이면 됩니다.
        </p>
      </div>
    </div>
  );
}

// ── 입출금 기록 모달 ──────────────────────────────────────────────────────────
function EntryModal({ account, accounts, accountCodes, partners, currentUser, onClose, onAdd }: {
  account: CashAccount;
  accounts: CashAccount[];
  accountCodes: AccountCode[];
  partners: Partner[];
  currentUser?: { id: string; name: string } | null;
  onClose: () => void;
  onAdd: Props['onAddCashEntry'];
}) {
  const [cashAccountId, setCashAccountId] = useState(account.id);
  const [date, setDate] = useState(today());
  const [dir, setDir] = useState<'입금' | '출금'>('출금');
  const [amount, setAmount] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [accountCode, setAccountCode] = useState('');
  const [note, setNote] = useState('');

  const amt = Number(amount.replace(/,/g, '')) || 0;
  const partner = partners.find(p => p.id === partnerId);
  const canSave = amt > 0 && !!accountCode;

  const save = () => {
    if (!canSave) return;
    onAdd({
      id: `cash-${Date.now()}`,
      date, cashAccountId, dir, amount: amt,
      ...(partnerId ? { partnerId, partnerName: partner?.name ?? '' } : {}),
      accountCode,
      ...(note.trim() ? { note: note.trim() } : {}),
      createdAt: new Date().toISOString(),
      ...(currentUser ? { createdBy: currentUser.name } : {}),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-800">입출금 기록</h3>
          <button onClick={onClose} className="text-slate-300 hover:text-slate-500"><X size={18} /></button>
        </div>
        <p className="text-[11px] text-slate-400 leading-snug">
          실제로 돈이 움직인 사실만 적습니다. 이 돈의 성격(비용·자산·부채)은 <b>계정과목</b>이 정합니다 — 전기요금이면 전력비, 기계 구입이면 기계장치, 대출 받으면 차입금.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">계좌</label>
            <select value={cashAccountId} onChange={e => setCashAccountId(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-slate-300">
              {accounts.filter(a => a.active).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">일자</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-slate-300" />
          </div>
        </div>

        <div>
          <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">방향</label>
          <div className="flex bg-slate-100 rounded-xl p-0.5 gap-0.5">
            {(['출금', '입금'] as const).map(d => (
              <button key={d} type="button" onClick={() => setDir(d)}
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-black transition-all ${
                  dir === d ? (d === '출금' ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white') : 'text-slate-400'
                }`}>{d}</button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">금액</label>
          <input inputMode="numeric" value={amount} placeholder="0"
            onChange={e => setAmount(e.target.value.replace(/[^\d,]/g, ''))}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-right text-lg font-black tabular-nums outline-none focus:ring-2 focus:ring-slate-300" />
        </div>

        <div>
          <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">거래처 <span className="text-slate-300">(선택)</span></label>
          <select value={partnerId} onChange={e => setPartnerId(e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-slate-300">
            <option value="">— 없음 —</option>
            {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        <div>
          <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">계정과목 <span className="text-rose-400">*</span></label>
          <select value={accountCode} onChange={e => setAccountCode(e.target.value)}
            className={`w-full border rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-slate-300 ${
              accountCode ? 'border-slate-200' : 'border-amber-300 bg-amber-50'
            }`}>
            <option value="">— 선택하세요 —</option>
            {accountCodes.map(c => <option key={c.id} value={c.code}>{c.code} · {c.name}</option>)}
          </select>
          {!accountCode && <p className="text-[10px] font-bold text-amber-600 mt-1">계정과목이 없으면 손익·현금흐름 어디에도 못 잡힙니다.</p>}
        </div>

        <div>
          <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">적요 <span className="text-slate-300">(선택)</span></label>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="7월분 전기요금 자동이체"
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-slate-300" />
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-500 text-xs font-black hover:bg-slate-200">취소</button>
          <button onClick={save} disabled={!canSave}
            className="flex-1 py-2.5 rounded-xl bg-slate-800 text-white text-xs font-black hover:bg-slate-900 disabled:opacity-30 disabled:cursor-not-allowed">
            저장
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 계좌 관리 모달 ────────────────────────────────────────────────────────────
function AccountModal({ accounts, onClose, onAdd, onUpdate }: {
  accounts: CashAccount[];
  onClose: () => void;
  onAdd: Props['onAddCashAccount'];
  onUpdate: Props['onUpdateCashAccount'];
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'통장' | '카드' | '현금'>('통장');
  const [openingBalance, setOpeningBalance] = useState('');
  const [openingDate, setOpeningDate] = useState(monthStart());

  const add = () => {
    if (!name.trim()) return;
    onAdd({
      id: `cashacct-${Date.now()}`,
      name: name.trim(), type,
      openingBalance: Number(openingBalance.replace(/,/g, '')) || 0,
      openingDate, active: true,
      createdAt: new Date().toISOString(),
    });
    setName(''); setOpeningBalance('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-800">자금 계좌 관리</h3>
          <button onClick={onClose} className="text-slate-300 hover:text-slate-500"><X size={18} /></button>
        </div>
        <p className="text-[11px] text-slate-400 leading-snug">
          <b>기초 잔액</b>은 기준일 시점의 통장 잔고입니다. 그 이전 거래는 기록하지 않아도 되고, 잔액은 여기서부터 굴러갑니다.
        </p>

        <div className="space-y-2">
          {accounts.map(a => {
            const Icon = ACCOUNT_ICON[a.type];
            return (
              <div key={a.id} className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3">
                <Icon size={14} className="text-slate-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black text-slate-800 truncate">{a.name}</p>
                  <p className="text-[10px] text-slate-400">{a.openingDate} 기준 {fmt(a.openingBalance)}원</p>
                </div>
                <button onClick={() => onUpdate(a.id, { active: !a.active })}
                  className={`text-[10px] font-black px-2.5 py-1 rounded-lg ${
                    a.active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-200 text-slate-400'
                  }`}>{a.active ? '사용중' : '보관'}</button>
              </div>
            );
          })}
        </div>

        <div className="border-t border-slate-100 pt-4 space-y-3">
          <p className="text-[10px] font-black text-slate-400 uppercase">계좌 추가</p>
          <div className="grid grid-cols-2 gap-2">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="기업은행 1234-56"
              className="border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-slate-300" />
            <select value={type} onChange={e => setType(e.target.value as typeof type)}
              className="border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-slate-300">
              {(['통장', '카드', '현금'] as const).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input inputMode="numeric" value={openingBalance} placeholder="기초 잔액"
              onChange={e => setOpeningBalance(e.target.value.replace(/[^\d,]/g, ''))}
              className="border border-slate-200 rounded-xl px-3 py-2 text-right text-sm font-black tabular-nums outline-none focus:ring-2 focus:ring-slate-300" />
            <input type="date" value={openingDate} onChange={e => setOpeningDate(e.target.value)}
              className="border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-slate-300" />
          </div>
          <button onClick={add} disabled={!name.trim()}
            className="w-full py-2.5 rounded-xl bg-slate-800 text-white text-xs font-black hover:bg-slate-900 disabled:opacity-30">
            추가
          </button>
        </div>
      </div>
    </div>
  );
}
