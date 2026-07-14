import React, { useMemo, useState } from 'react';
import { Search, Users } from 'lucide-react';
import { CashEntry, IssuedStatement, Settlement } from '../src/shared/types';
import { buildPartnerLedger, partnerBalances } from '../src/features/admin/cashLedger';

interface Props {
  issuedStatements: IssuedStatement[];
  cashEntries: CashEntry[];
  settlements: Settlement[];
}

const fmt = (n: number) => n.toLocaleString('ko-KR');

export default function PartnerLedger({ issuedStatements, cashEntries, settlements }: Props) {
  const [type, setType] = useState<'매출' | '매입'>('매입');
  const [search, setSearch] = useState('');
  const [selId, setSelId] = useState('');

  const balances = useMemo(
    () => partnerBalances(type, issuedStatements, cashEntries, settlements),
    [type, issuedStatements, cashEntries, settlements],
  );
  const shown = balances.filter(b => !search.trim() || b.partnerName.includes(search.trim()));
  const sel = balances.find(b => b.partnerId === selId) ?? shown[0];
  const ledger = useMemo(
    () => (sel ? buildPartnerLedger(sel.partnerId, type, issuedStatements, cashEntries, settlements) : null),
    [sel, type, issuedStatements, cashEntries, settlements],
  );

  const total = shown.reduce((a, b) => a + b.balance, 0);
  const label = type === '매출' ? '받을 돈' : '줄 돈';
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
              {t === '매입' ? '매입 (줄 돈)' : '매출 (받을 돈)'}
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
          <div className="px-4 py-2.5 border-b border-slate-50 flex items-center gap-1.5">
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
            {ledger && (
              <div className="flex items-center gap-4 text-[11px] font-black">
                <span className="text-slate-400">발생 <span className="text-slate-700 tabular-nums">{fmt(ledger.accrued)}</span></span>
                <span className="text-slate-400">결제 <span className="text-emerald-600 tabular-nums">{fmt(ledger.paid)}</span></span>
                <span className="text-slate-400">{label} <span className={`tabular-nums ${tone}`}>{fmt(ledger.balance)}</span></span>
              </div>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50/70 text-slate-400">
                <tr>
                  <th className="px-4 py-2.5 text-left font-black">일자</th>
                  <th className="px-4 py-2.5 text-left font-black">구분</th>
                  <th className="px-4 py-2.5 text-left font-black">적요</th>
                  <th className="px-4 py-2.5 text-right font-black">발생</th>
                  <th className="px-4 py-2.5 text-right font-black">결제</th>
                  <th className="px-4 py-2.5 text-right font-black">잔액</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {ledger?.rows.map(r => (
                  <tr key={`${r.kind}-${r.id}`} className="hover:bg-slate-50/50">
                    <td className="px-4 py-2.5 font-bold text-slate-500 whitespace-nowrap">{r.date.slice(5)}</td>
                    <td className="px-4 py-2.5">
                      {r.kind === '전표'
                        ? <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${type === '매입' ? 'bg-rose-50 text-rose-600' : 'bg-blue-50 text-blue-600'}`}>전표</span>
                        : <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600">
                            {r.source === 'cash' ? '결제·자금' : '결제'}
                          </span>}
                    </td>
                    <td className="px-4 py-2.5 font-bold text-slate-700 truncate max-w-[220px]">{r.label}</td>
                    <td className="px-4 py-2.5 text-right font-black text-slate-700 tabular-nums">{r.amount > 0 ? fmt(r.amount) : ''}</td>
                    <td className="px-4 py-2.5 text-right font-black text-emerald-600 tabular-nums">{r.amount < 0 ? fmt(-r.amount) : ''}</td>
                    <td className={`px-4 py-2.5 text-right font-black tabular-nums ${r.balance === 0 ? 'text-slate-300' : 'text-slate-800'}`}>{fmt(r.balance)}</td>
                  </tr>
                ))}
                {(!ledger || ledger.rows.length === 0) && (
                  <tr><td colSpan={6} className="px-4 py-20 text-center text-slate-300 font-bold">거래 내역이 없습니다</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="px-5 py-3 border-t border-slate-50 text-[10px] text-slate-400 leading-snug">
            결제는 <b>거래명세서의 지불·수금처리</b>(구 방식)와 <b>현금출납장 매칭</b>(자금) 양쪽에서 옵니다. 같은 결제를 두 곳에 적으면
            이중으로 빠지니, 앞으로는 <b>현금출납장에 기록하고 전표에 매칭</b>하는 쪽으로만 넣으세요.
          </p>
        </div>
      </div>
    </div>
  );
}
