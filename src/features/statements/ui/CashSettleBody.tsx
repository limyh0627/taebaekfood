import React,{useState} from 'react';
import {Save} from 'lucide-react';
import {today} from '../../../shared/day';
import type {IssuedStatement,PaymentMethod} from '../../../shared/types';
import {settlementTypeOf,isAccruedPayableStatement} from '../../admin/voucherMerge';
import {formatMoneyInput,parseMoneyInput} from '../../../shared/moneyInput';
import ModalShell from '../../../shared/components/ModalShell';
import type {Props} from '../domain/cashEntryModal';
import {fmt} from './cashEntryDisplay';

const overLabelOf = (type?: string) => (type === '매출' ? '선수금' : '선급금');

export function SettleBody({
  stmt, cashAccounts, accountId, onAccountId, partnerBalances, getBalance, latestStatement, onClose, onSettle, initialSettle,
}: Props & { stmt: IssuedStatement }) {
  const isBuy = settlementTypeOf(stmt) === '매입';
  const accrued = isAccruedPayableStatement(stmt);
  /**
   * 기본값은 **이 전표에 남은 금액**. 총액을 박아 두면 이미 절반을 낸 전표에서도 전액이
   * 찍혀 또 나간다(카드대금 899,925이 두 번 나간 게 그 꼴이다).
   * 일자도 **그 전표 날짜**가 기본이다 — 오늘로 박아 두면 8/28 전표를 8/31에 열 때마다 고쳐야 한다.
   */
  const [amount, setAmount] = useState(formatMoneyInput(initialSettle?.amount ?? Math.round(getBalance(stmt))));
  const [date, setDate] = useState(initialSettle?.date ?? (stmt.tradeDate || today()));
  const [method, setMethod] = useState<PaymentMethod>('계좌이체');
  const [note, setNote] = useState('');
  const [scope, setScope] = useState<'stmt' | 'partner'>('stmt');   // 기본은 '이 전표'
  const [overWarn, setOverWarn] = useState(false);

  const paid = Math.round(stmt.totalAmount - getBalance(stmt));
  const pb = partnerBalances.get(stmt.partnerId);
  const partnerLeft = isBuy ? (pb?.payable ?? 0) : (pb?.receivable ?? 0);

  const submit = (forceOver: boolean) => {
    const amt = parseMoneyInput(amount);
    if (!amount || amt <= 0) return;
    //  초과 판정은 **거래처 잔액 기준** — 돈은 전표가 아니라 거래처 채권·채무에서 빠진다.
    const live = latestStatement(stmt.id) ?? stmt;
    const lb = partnerBalances.get(live.partnerId);
    const bal = accrued ? getBalance(live) : settlementTypeOf(live) === '매입' ? (lb?.payable ?? 0) : (lb?.receivable ?? 0);
    if (accrued && amt > bal) { setOverWarn(true); return; }
    if (amt > bal && !forceOver) { setOverWarn(true); return; }
    setOverWarn(false);
    onSettle(live, { amount: amt, date, method, note: note.trim(), scope });
  };

  /** 어디에 붙일지 — 고른 쪽이 켜지고 그 금액이 찍힌다 */
  const box = (k: 'stmt' | 'partner', label: string, amt: number, hint: string) => {
    const on = scope === k;
    //  상자를 바꿔도 **날짜는 안 건드린다** — 전표에서 연 수금·지불이라 기본은 언제나 그 전표 날짜다.
    return (
      <button onClick={() => { setScope(k); setAmount(formatMoneyInput(Math.round(amt))); }}
        className={`flex-1 text-left rounded-xl px-3 py-2.5 border transition-all ${
          on ? 'bg-indigo-50 border-indigo-400 ring-2 ring-indigo-300' : 'bg-slate-50 border-slate-200 hover:border-indigo-300'}`}>
        <div className={`text-[10px] font-black uppercase tracking-widest ${on ? 'text-indigo-600' : 'text-slate-400'}`}>{label}</div>
        <div className={`font-black text-base ${amt <= 0 ? 'text-emerald-600' : on ? 'text-indigo-800' : 'text-slate-800'}`}>
          {amt <= 0 ? '없음' : `${fmt(Math.round(amt))}원`}
        </div>
        <div className={`text-[10px] ${on ? 'text-indigo-400' : 'text-slate-400'}`}>{hint}</div>
      </button>
    );
  };

  return (
    <ModalShell title={isBuy ? '지불 처리' : '수금 처리'} onClose={onClose} bodyClassName="space-y-4">
        <div className="text-xs text-slate-400">{stmt.partnerName} · {stmt.tradeDate}</div>

        {/* 이미 낸 게 있으면 먼저 밝힌다 — 갚아 놓고 또 누르는 걸 막는 건 이 한 줄이다 */}
        {paid > 0 && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 text-[11px] font-black text-emerald-700">
            이 전표에 이미 {fmt(paid)}원 {isBuy ? '지불' : '수금'}했습니다
            &#12288;<span className="text-emerald-500">(전표 {fmt(Math.round(stmt.totalAmount))}원 중 남은 {fmt(Math.round(getBalance(stmt)))}원)</span>
          </div>
        )}

        <div className="flex gap-2">
          {box('stmt', '이 전표', getBalance(stmt), '이 전표부터 갚음')}
          {!accrued && box('partner', '거래처 잔액', partnerLeft, '오래된 전표부터 갚음')}
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">금액</label>
            <input type="text" inputMode="numeric" value={amount} onChange={e => setAmount(formatMoneyInput(e.target.value))}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-300"/>
          </div>
          {cashAccounts.length > 0 && (
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">{isBuy ? '출금 계좌' : '입금 계좌'}</label>
              <select value={accountId} onChange={e => onAccountId(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-300">
                {!accountId&&<option value="">계좌를 선택해 주세요</option>}
                {cashAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <p className="text-[10px] text-slate-400 mt-1">현금출납장에 자동으로 기록되고 이 전표에 매칭됩니다.</p>
            </div>
          )}
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">일자</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-300"/>
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">결제 방법</label>
            <div className="flex gap-1.5 flex-wrap">
              {(['현금', '계좌이체', '어음', '카드', '기타'] as PaymentMethod[]).map(m => (
                <button key={String(m)} onClick={() => setMethod(m)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-black border transition-all ${method === m ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">비고</label>
            <input type="text" placeholder="예: 1차 분할" value={note} onChange={e => setNote(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300"/>
          </div>
        </div>

        {overWarn && (() => {
          const live = latestStatement(stmt.id) ?? stmt;
          return (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs space-y-2">
              <p className="font-black text-amber-700">
                {accrued ? `입력금액이 미지급비용 잔액(${fmt(getBalance(live))}원)을 초과합니다.`
                  : `입력금액이 잔액(${fmt(getBalance(live))}원)을 초과합니다. 초과분은 ${overLabelOf(settlementTypeOf(stmt))}으로 전환됩니다.`}
              </p>
              <div className="flex gap-2">
                <button onClick={() => setOverWarn(false)} className="flex-1 py-1.5 rounded-lg bg-slate-200 text-slate-600 font-black">취소</button>
                {!accrued && <button onClick={() => submit(true)} className="flex-1 py-1.5 rounded-lg bg-amber-500 text-white font-black">계속 진행</button>}
              </div>
            </div>
          );
        })()}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-xs font-black hover:bg-slate-200">취소</button>
          <button onClick={() => submit(false)} disabled={!amount || parseMoneyInput(amount) <= 0}
            className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-black hover:bg-blue-700 disabled:opacity-40 flex items-center justify-center gap-1.5">
            <Save size={12}/>저장
          </button>
        </div>
    </ModalShell>
  );
}
