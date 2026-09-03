import React, { useMemo, useState } from 'react';
import { Search, Users, Wallet, X } from 'lucide-react';
import { AccountCode, CashEntry, IssuedStatement } from '../src/shared/types';
import { today } from '../src/shared/day';
import { claimDocNo } from '../src/shared/voucherStamp';
import { buildPaymentEntry } from '../src/shared/payment';
import VoucherSlip from '../src/shared/VoucherSlip';
import { buildPartnerLedger, partnerBalances } from '../src/features/admin/cashLedger';
import { buildJournals } from '../src/shared/buildJournals';

interface Props {
  issuedStatements: IssuedStatement[];
  cashEntries: CashEntry[];
  accountCodes: AccountCode[];
  /** 전표번호를 눌렀을 때 — 그 전표를 열어 보여준다 */
  onOpenVoucher?: (sourceId: string, docNo: string) => void;
  /**
   * 수금·지불을 자금원장에 적는다.
   * 이 기능은 **거래처통계에 있던 것**인데 거기로 옮겨 왔다(2026-09-03 사장님) —
   * 거래처통계는 매출 추이·이익률을 보는 자리고, 돈이 오가는 일은 원장이 할 일이다.
   */
  onAddCashEntry?: (e: CashEntry) => void;
}

const fmt = (n: number) => n.toLocaleString('ko-KR');

export default function PartnerLedger({ issuedStatements, cashEntries, accountCodes, onOpenVoucher, onAddCashEntry }: Props) {
  //  수금·지불 창 — 고른 거래처에 대해 돈이 오간 것을 적는다
  //  전표번호를 누르면 **그 자리에서** 전표를 보여준다 — 다른 화면으로 안 보낸다
  //  (2026-09-03 사장님). 전표 모양은 shared/VoucherSlip 하나뿐이라 새로 안 짓는다.
  const [openVoucher, setOpenVoucher] = useState<{ sourceId: string; docNo: string } | null>(null);
  /** 계정코드 → 이름 — 전표에 '108 외상매출금' 으로 적기 위해 */
  const codeName = useMemo(() => new Map(accountCodes.map(c => [String(c.code), c.name])), [accountCodes]);
  const [payOpen, setPayOpen] = useState(false);
  const [payForm, setPayForm] = useState({ amount: '', date: today(), note: '' });
  // 채권·채무가 움직인 곳은 분개의 108·251 줄뿐이다 — 원장도 잔액도 거기서 뽑는다.
  // 기초잔액은 거래처가 없으니 안 넘겨도 결과가 같다.
  const journals = useMemo(
    () => buildJournals({ statements: issuedStatements, cashEntries, accounts: accountCodes }).entries,
    [issuedStatements, cashEntries, accountCodes]);
  const [type, setType] = useState<'매출' | '매입'>('매입');
  const [search, setSearch] = useState('');
  const [selId, setSelId] = useState('');

  const balances = useMemo(
    () => partnerBalances(type, issuedStatements, cashEntries, journals),
    [type, issuedStatements, cashEntries, journals],
  );
  /**
   * 수금·지불 한 건을 자금원장에 적는다.
   *
   * **전표에 안 붙인다** — 어느 청구서를 갚았는지는 배분(`allocatePartnerCash`)이
   * 오래된 것부터 알아서 맞춘다. 전표에 매다는 옛 경로는 걷어냈다.
   * 계정은 매출이면 108(외상매출금), 매입이면 251(외상매입금)이다.
   */
  const savePay = () => {
    if (!sel || !onAddCashEntry) return;
    const amt = Number(String(payForm.amount).replace(/[,\s원]/g, ''));
    if (!Number.isFinite(amt) || amt <= 0) { alert('금액을 숫자로 넣으세요.'); return; }
    //  셈은 shared/payment 하나다 — 여기서 또 짓지 않는다
    onAddCashEntry(buildPaymentEntry({
      partnerId: sel.partnerId, partnerName: sel.partnerName, type,
      amount: amt, date: payForm.date,
      note: [`${sel.partnerName} ${type === '매출' ? '수금' : '지불'}`, payForm.note].filter(Boolean).join(' · '),
      docNo: claimDocNo(payForm.date, cashEntries),
    }));
    setPayOpen(false);
    setPayForm({ amount: '', date: today(), note: '' });
  };

  const shown = balances.filter(b => !search.trim() || b.partnerName.includes(search.trim()));
  const sel = balances.find(b => b.partnerId === selId) ?? shown[0];
  const ledger = useMemo(
    () => (sel ? buildPartnerLedger(sel.partnerId, type, issuedStatements, cashEntries, journals) : null),
    [sel, type, issuedStatements, cashEntries, journals],
  );

  const total = shown.reduce((a, b) => a + b.balance, 0);
  //  회계 용어로 적는다 — 세무대리인과 같은 말을 써야 옮겨 적을 때 헷갈리지 않는다.
  //  전표 화면도 같은 이유로 '줄돈·받을돈'을 걷어냈다(TradeStatement 잔액 칸 참고).
  const label = type === '매출' ? '미수 잔액' : '미지급 잔액';
  const tone = type === '매출' ? 'text-blue-600' : 'text-rose-600';

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex bg-slate-100 rounded-xl p-0.5 gap-0.5">
          {(['매입', '매출'] as const).map(t => (
            <button key={t} onClick={() => { setType(t); setSelId(''); }}
              className={`px-4 py-2 rounded-lg text-xs font-black transition-all ${
                type === t ? (t === '매입' ? 'bg-rose-600 text-white' : 'bg-blue-600 text-white') : 'text-slate-400'
              }`}>
              {t === '매입' ? '매입 (미지급)' : '매출 (미수)'}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="거래처명"
            className="w-full bg-white border border-slate-200 rounded-xl pl-8 pr-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-slate-300" />
        </div>
        <div className="ml-auto bg-slate-800 text-white rounded-2xl px-5 py-3">
          <p className="text-[10px] font-black text-slate-400 uppercase">총 {label}</p>
          <p className="text-xl font-black tabular-nums">{fmt(total)}<span className="text-xs ml-1 text-slate-400">원</span></p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
        {/* 거래처 목록 */}
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden self-start">
          <div className="px-2 sm:px-4 py-2.5 border-b border-slate-50 flex items-center gap-1.5">
            <Users size={13} className="text-slate-400" />
            <span className="text-xs font-black text-slate-700">거래처</span>
            <span className="text-[10px] font-black text-slate-400 ml-auto">{shown.length}</span>
          </div>
          <div className="divide-y divide-slate-50 max-h-[560px] overflow-y-auto">
            {shown.map(b => (
              <button key={b.partnerId} onClick={() => setSelId(b.partnerId)}
                className={`w-full px-4 py-3 text-left transition-all ${
                  sel?.partnerId === b.partnerId ? 'bg-slate-50' : 'hover:bg-slate-50/60'
                }`}>
                <p className="text-xs font-black text-slate-800 truncate">{b.partnerName}</p>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-[10px] text-slate-400">전표 {b.count}건</span>
                  <span className={`text-xs font-black tabular-nums ${b.balance === 0 ? 'text-slate-300' : tone}`}>{fmt(b.balance)}</span>
                </div>
              </button>
            ))}
            {shown.length === 0 && (
              <p className="px-4 py-12 text-center text-xs font-bold text-slate-300">거래처가 없습니다</p>
            )}
          </div>
        </div>

        {/* 원장 */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-50 flex items-center justify-between gap-3 flex-wrap">
            <span className="font-black text-sm text-slate-800">{sel?.partnerName ?? '—'}</span>
            {/*  돈이 오간 것을 적는 자리 — 거래처통계에 있던 걸 여기로 옮겼다(2026-09-03 사장님) */}
            {sel && onAddCashEntry && (
              <button type="button" onClick={() => setPayOpen(true)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black text-white transition-all ${
                  type === '매출' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-slate-700 hover:bg-slate-800'}`}>
                <Wallet size={13} />{type === '매출' ? '수금' : '지불'}
              </button>
            )}
            {ledger && (
              /* 기초 + 발생 − 결제 = 잔액. 기초를 발생에 뭉치면 이번 달에 새로 산 것처럼 읽힌다 —
                 청양식품은 넘어온 5,800만원이 8월 매입으로 보였다. */
              <div className="flex items-center gap-3 text-[11px] font-black">
                {ledger.opening > 0 && (
                  <span className="text-slate-400">기초 <span className="text-slate-500 tabular-nums">{fmt(ledger.opening)}</span></span>
                )}
                <span className="text-slate-400">발생 <span className="text-slate-700 tabular-nums">{fmt(ledger.accrued)}</span></span>
                <span className="text-slate-400">결제 <span className="text-emerald-600 tabular-nums">{fmt(ledger.paid)}</span></span>
                <span className="text-slate-300">=</span>
                <span className="text-slate-400">{label} <span className={`tabular-nums ${tone}`}>{fmt(ledger.balance)}</span></span>
              </div>
            )}
          </div>

          {/*  **표는 좁은 화면에서 가로로 민다.** `w-full` 만 있으면 폭에 맞춰 칸이 찌그러지고,
               한글이 한 글자씩 세로로 쌓여 아예 못 읽는다(2026-09-03 사장님 지적).
               최소 너비를 줘야 `overflow-x-auto` 가 실제로 넘쳐서 스크롤이 생긴다. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-xs">
              <thead className="bg-slate-50/70 text-slate-400">
                <tr>
                  <th className="px-2 sm:px-4 py-2.5 text-left font-black whitespace-nowrap">일자</th>
                  <th className="px-4 py-2.5 text-left font-black whitespace-nowrap">구분</th>
                  {/*  적요와 전표번호를 갈라 둔다 — 한 칸에 뭉쳐 있으면 번호가 있을 때
                       적요가 안 보이고, 없을 때 번호 자리에 적요가 앉는다(2026-09-03 사장님). */}
                  <th className="px-2 sm:px-4 py-2.5 text-left font-black whitespace-nowrap">적요</th>
                  <th className="px-4 py-2.5 text-left font-black whitespace-nowrap">전표번호</th>
                  <th className="px-2 sm:px-4 py-2.5 text-right font-black whitespace-nowrap">발생</th>
                  <th className="px-2 sm:px-4 py-2.5 text-right font-black whitespace-nowrap">결제</th>
                  <th className="px-2 sm:px-4 py-2.5 text-right font-black whitespace-nowrap">잔액</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {ledger?.rows.map(r => (
                  <tr key={`${r.kind}-${r.id}`} className="hover:bg-slate-50/50">
                    {/*  날짜에 시각도 — 같은 날 여러 건이면 순서가 이걸로 갈린다
                         (소급은 23:59:59, 미리 끊은 건 00:00:00) */}
                    <td className="px-2 sm:px-4 py-2.5 font-bold text-slate-500 whitespace-nowrap tabular-nums">
                      {r.date.slice(5)}
                      {r.time && <span className="ml-1.5 text-[10px] font-bold text-slate-300">{r.time.slice(0, 5)}</span>}
                    </td>
                    {/*  구분은 글자만 — 박스에 넣으면 줄마다 알록달록해서 오히려 안 읽힌다 */}
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className={`text-[11px] font-black ${
                        r.opening ? 'text-slate-400'
                        : r.kind === '전표' ? (type === '매입' ? 'text-rose-600' : 'text-blue-600')
                        : 'text-emerald-600'}`}>
                        {r.opening ? '기초' : r.kind === '전표' ? '전표' : r.source === 'cash' ? '결제·자금' : '결제'}
                      </span>
                    </td>
                    <td className="px-2 sm:px-4 py-2.5 font-bold text-slate-700 truncate max-w-[260px] min-w-[140px]">{r.label}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {r.docNo
                        ? (r.sourceId
                            ? <button type="button" onClick={() => setOpenVoucher({ sourceId: r.sourceId!, docNo: r.docNo! })}
                                className="text-[11px] font-black text-indigo-600 hover:text-indigo-800 underline underline-offset-2 tabular-nums">
                                {r.docNo}
                              </button>
                            : <span className="text-[11px] font-bold text-slate-500 tabular-nums">{r.docNo}</span>)
                        : <span className="text-slate-200">—</span>}
                    </td>
                    <td className="px-2 sm:px-4 py-2.5 text-right font-black text-slate-700 tabular-nums">{r.amount > 0 ? fmt(r.amount) : ''}</td>
                    <td className="px-2 sm:px-4 py-2.5 text-right font-black text-emerald-600 tabular-nums">{r.amount < 0 ? fmt(-r.amount) : ''}</td>
                    <td className={`px-4 py-2.5 text-right font-black tabular-nums ${r.balance === 0 ? 'text-slate-300' : 'text-slate-800'}`}>{fmt(r.balance)}</td>
                  </tr>
                ))}
                {(!ledger || ledger.rows.length === 0) && (
                  <tr><td colSpan={7} className="px-4 py-20 text-center text-slate-300 font-bold">거래 내역이 없습니다</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="px-5 py-3 border-t border-slate-50 text-[10px] text-slate-400 leading-snug">
            결제는 <b>위 수금·지불 단추</b>로 넣으세요 — 자금원장에 적히고, 어느 전표를 갚았는지는
            오래된 것부터 저절로 맞춰집니다. 거래명세서의 지불·수금처리는 <b>옛 방식</b>이라
            같은 결제를 두 곳에 적으면 이중으로 빠집니다.
          </p>
        </div>
      </div>
      {/*  전표 보기 — 원장에서 번호를 누르면 그 자리에서 뜬다 */}
      {openVoucher && (() => {
        const je = journals.find(j => j.sourceId === openVoucher.sourceId) ?? null;
        const st = issuedStatements.find(x => x.id === openVoucher.sourceId);
        const ce = cashEntries.find(x => x.id === openVoucher.sourceId);
        return (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setOpenVoucher(null)}>
            <div className="bg-white rounded-2xl w-full max-w-lg max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <p className="font-black text-slate-800">{openVoucher.docNo}</p>
                  <p className="text-[10px] font-bold text-slate-400 mt-0.5">
                    {st?.tradeDate ?? ce?.date ?? ''} · {st?.partnerName ?? ce?.partnerName ?? ''}
                  </p>
                </div>
                <button onClick={() => setOpenVoucher(null)} className="p-1 text-slate-300 hover:text-slate-600"><X size={16} /></button>
              </div>
              <div className="p-5">
                <VoucherSlip
                  je={je}
                  kind={st ? (st.type === '비용' ? '대체' : st.type) : ce?.dir}
                  docNo={openVoucher.docNo}
                  date={st?.tradeDate ?? ce?.date}
                  codeName={codeName}
                  headPartner={st?.partnerName ?? ce?.partnerName}
                />
              </div>
              {onOpenVoucher && (
                <div className="px-5 py-4 border-t border-slate-100">
                  <button
                    onClick={() => { onOpenVoucher(openVoucher.sourceId, openVoucher.docNo); setOpenVoucher(null); }}
                    className="w-full px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-600 text-xs font-black hover:bg-slate-50">
                    전표 화면에서 열기 →
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/*  수금·지불 창 — 전표에 안 붙인다. 어느 청구서를 갚았는지는 배분이 알아서 맞춘다. */}
      {payOpen && sel && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setPayOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <p className="font-black text-slate-800">{sel.partnerName} {type === '매출' ? '수금' : '지불'}</p>
                <p className="text-[10px] font-bold text-slate-400 mt-0.5">
                  지금 {type === '매출' ? '미수' : '미지급'} {fmt(sel.balance)}원
                </p>
              </div>
              <button onClick={() => setPayOpen(false)} className="p-1 text-slate-300 hover:text-slate-600"><X size={16} /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase mb-1">금액</p>
                <input autoFocus inputMode="numeric" value={payForm.amount}
                  onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') savePay(); }}
                  placeholder={String(sel.balance)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-black text-right tabular-nums outline-none focus:border-indigo-400" />
                <button type="button" onClick={() => setPayForm(f => ({ ...f, amount: String(sel.balance) }))}
                  className="mt-1 text-[10px] font-black text-indigo-500 hover:text-indigo-700">전액 넣기</button>
              </div>
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase mb-1">날짜</p>
                <input type="date" value={payForm.date} onChange={e => setPayForm(f => ({ ...f, date: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold outline-none focus:border-indigo-400" />
              </div>
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase mb-1">메모 <span className="text-slate-300 normal-case">(선택)</span></p>
                <input value={payForm.note} onChange={e => setPayForm(f => ({ ...f, note: e.target.value }))}
                  placeholder="계좌이체 등"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold outline-none focus:border-indigo-400" />
              </div>
            </div>
            <div className="px-5 py-4 border-t border-slate-100 flex gap-2">
              <button onClick={() => setPayOpen(false)}
                className="flex-1 px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-600 text-xs font-black hover:bg-slate-50">취소</button>
              <button onClick={savePay}
                className={`flex-1 px-4 py-2 rounded-xl text-white text-xs font-black ${type === '매출' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-slate-700 hover:bg-slate-800'}`}>
                {type === '매출' ? '수금' : '지불'} 기록
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
