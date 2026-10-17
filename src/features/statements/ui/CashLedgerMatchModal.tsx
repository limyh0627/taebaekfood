import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { CashEntry, IssuedStatement, Settlement } from '../../../shared/types';
import { unsettledStatements, unmatchedCash, type ReadonlyReturnOperation } from '../../admin/cashLedger';
import ModalShell from '../../../shared/components/ModalShell';
import type { Props } from '../domain/cashLedger';
import { fmt } from './cashEntryDisplay';

// 출금 → 매입전표 상계, 입금 → 매출전표 상계. 이체 1건을 전표 여러 건에 나눠 붙일 수 있다.
export function MatchModal({ entry, statements, settlements, cashEntries, returnOperations, advanceStatements, onClose, onAdd, onDelete }: {
  entry: CashEntry;
  returnOperations?: readonly ReadonlyReturnOperation[];
  advanceStatements?: readonly IssuedStatement[];
  statements: IssuedStatement[];
  settlements: Settlement[];
  /** 살아 있는 자금줄 — 지워진 줄에 매달린 매칭은 안 센다 */
  cashEntries: CashEntry[];
  onClose: () => void;
  onAdd: Props['onAddSettlement'];
  onDelete: Props['onDeleteSettlement'];
}) {
  const lock = useRef(false);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const save = async (action: () => void | Promise<unknown>) => {
    if (lock.current || !mounted.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await action(); }
    catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : '매칭을 저장하지 못했습니다. 다시 시도해 주세요.');
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  };
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
      //  지워진 자금줄에 매달린 매칭은 안 센다 — 없는 돈으로 갚은 게 된다
      cashEntries, projection:{returnOperations,advanceStatements},
    }),
    [statements, settlements, stmtType, entry.partnerId, cashEntries, returnOperations, advanceStatements],
  );

  const attach = (statementId: string, open: number) => {
    const amount = Math.min(open, remaining);
    if (amount <= 0) return;
    void save(() => onAdd({
      id: `settle-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      cashEntryId: entry.id, statementId, amount,
      createdAt: new Date().toISOString(),
    }));
  };

  return (
    <ModalShell title="전표 매칭" onClose={() => { if (!lock.current) onClose(); }} bodyClassName="space-y-4">
        {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
        {busy && <p role="status" className="text-sm text-slate-500">매칭 저장 중...</p>}

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
                <button disabled={busy} aria-label={`${stmt?.docNo ?? settlement.statementId} 매칭 해제`} onClick={() => void save(() => onDelete(settlement.id))} className="text-slate-300 hover:text-rose-500 shrink-0">
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
            <button key={stmt.id} disabled={busy} onClick={() => attach(stmt.id, open)}
              className="w-full flex items-center gap-3 bg-white border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/40 rounded-xl px-4 py-2.5 text-left transition-all">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-black text-slate-800 truncate">{stmt.partnerName}</p>
                <p className="text-[10px] text-slate-400">{stmt.tradeDate} · {stmt.docNo}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs font-black text-slate-700 tabular-nums">{fmt(open)}</p>
                <p className="text-[10px] font-black text-indigo-500">{fmt(Math.min(open, remaining))} 상계</p>
              </div>
            </button>
          ))}
        </div>

        <p className="text-[10px] text-slate-400 leading-snug">
          전표를 누르면 미매칭 금액만큼 상계됩니다. 밀린 전표 여러 건을 한 번의 이체로 끄려면 차례로 누르면 되고,
          한 전표를 나눠서 결제했다면 이체 건마다 같은 전표를 눌러 붙이면 됩니다.
        </p>
    </ModalShell>
  );
}
