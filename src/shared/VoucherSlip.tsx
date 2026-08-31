import React from 'react';
import type { JournalEntry, JournalLine } from './types';

/**
 * 표준 전표 양식 — 거래명세서를 뺀 모든 전표가 이 모양으로 보인다.
 *
 *                       매 입 전 표
 *   전표번호 260831-07 │ 일자 2026년 08월 31일
 *   ─────────────────────────────────────────────────
 *   구분  계정과목      거래처명  적요      차변       대변
 *   차변  520 전기세    한전     전기세   1,233,780
 *   대변  251 외상매입금 한전     외상 발생            1,233,780
 *   ─────────────────────────────────────────────────
 *   합계                                 1,233,780  1,233,780
 *
 * 예전엔 구분·계정·차변·대변 넉 줄뿐이라, 계정 이름만 보고 무슨 돈인지 짐작해야 했다.
 * 거래처와 적요가 붙으면 전표 한 장만 봐도 읽힌다.
 *
 * **적요는 분개가 들고 온다**(JournalLine.note) — 전표 품목명·자금전표 줄 이름.
 * 거래처는 줄에 붙은 것(108·251)이 먼저고, 없으면 전표 머리의 거래처를 쓴다.
 * 작성자 칸은 안 만든다 — 어느 전표에도 그 값이 없어서 늘 빈칸이다.
 */
export interface VoucherSlipProps {
  je: JournalEntry | null;
  /** 전표 이름 — 매출·매입·입금·출금·대체. 목록 딱지와 같은 갈래다. */
  kind?: string;
  docNo?: string;
  /** 'YYYY-MM-DD'. 없으면 분개 날짜를 쓴다. */
  date?: string;
  /** 계정코드 → 계정명 */
  codeName: Map<string, string>;
  /** 거래처id → 거래처명 */
  partnerName?: Map<string, string>;
  /** 줄에 거래처가 없을 때 쓸 전표 머리의 거래처 */
  headPartner?: string;
  /** 분개를 못 만들 때 띄울 말 */
  emptyMessage?: string;
  className?: string;
}

const fmt = (n: number) => n.toLocaleString('ko-KR');

/** 2026-08-31 → 2026년 08월 31일 */
export function formatSlipDate(d?: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d ?? ''));
  return m ? `${m[1]}년 ${m[2]}월 ${m[3]}일` : String(d ?? '');
}

export default function VoucherSlip({
  je, kind, docNo, date, codeName, partnerName, headPartner, emptyMessage, className = '',
}: VoucherSlipProps) {
  if (!je) return (
    <p className="text-[11px] font-black text-amber-600">
      {emptyMessage ?? '계정이 지정되지 않아 분개를 만들 수 없습니다 — 손익·재무제표에 안 잡힙니다.'}
    </p>
  );

  const totalD = je.lines.reduce((a, l) => a + (l.debit ?? 0), 0);
  const totalC = je.lines.reduce((a, l) => a + (l.credit ?? 0), 0);
  const who = (l: JournalLine) =>
    (l.partnerId ? partnerName?.get(l.partnerId) : undefined) ?? headPartner ?? '';

  const cols = 'grid grid-cols-[46px_minmax(120px,1.1fr)_minmax(0,0.9fr)_minmax(0,1.2fr)_104px_104px]';

  return (
    <div className={`inline-block min-w-[560px] max-w-full rounded-xl border border-slate-300 bg-white overflow-hidden ${className}`}>
      {/* 전표 이름 — 번호통을 매입전표와 같이 쓰므로 번호만으론 갈래를 모른다 */}
      {kind && (
        <div className="px-3 py-2 text-center text-[13px] font-black text-slate-700 tracking-[0.3em] border-b border-slate-200">
          {kind} 전표
        </div>
      )}
      <div className="flex flex-wrap bg-slate-50 border-b border-slate-300 text-[10px]">
        <div className="flex items-baseline gap-2 px-3 py-1.5 border-r border-slate-200">
          <span className="font-black text-slate-400 tracking-widest">전표번호</span>
          <span className={`font-mono font-bold tabular-nums ${docNo ? 'text-slate-700' : 'text-slate-300'}`}>{docNo || '—'}</span>
        </div>
        <div className="flex items-baseline gap-2 px-3 py-1.5">
          <span className="font-black text-slate-400 tracking-widest">일자</span>
          <span className="font-mono font-bold tabular-nums text-slate-700">{formatSlipDate(date ?? je.date)}</span>
        </div>
      </div>

      <div className={`${cols} bg-slate-100 text-[9px] font-black text-slate-400 uppercase tracking-widest`}>
        <span className="px-2 py-1.5">구분</span>
        <span className="px-2 py-1.5">계정과목</span>
        <span className="px-2 py-1.5">거래처명</span>
        <span className="px-2 py-1.5">적요</span>
        <span className="px-2 py-1.5 text-right">차변</span>
        <span className="px-2 py-1.5 text-right">대변</span>
      </div>

      {je.lines.map((l, i) => (
        <div key={i} className={`${cols} border-t border-slate-50 text-[11px]`}>
          {/* 대변은 붉게 — 장부 관습이고, 훑을 때 방향이 한눈에 갈린다 */}
          <span className={`px-2 py-1.5 font-black ${l.debit ? 'text-slate-600' : 'text-rose-500'}`}>
            {l.debit ? '차변' : '대변'}
          </span>
          <span className="px-2 py-1.5 font-bold text-slate-700 break-keep">
            <span className="text-slate-400 font-mono mr-1">{l.accountCode}</span>
            {codeName.get(l.accountCode) ?? ''}
          </span>
          <span className="px-2 py-1.5 font-bold text-slate-500 truncate">{who(l) || <span className="text-slate-300">—</span>}</span>
          <span className="px-2 py-1.5 text-slate-400 truncate" title={l.note ?? ''}>{l.note || ''}</span>
          <span className="px-2 py-1.5 text-right font-black tabular-nums text-slate-700">{l.debit ? fmt(l.debit) : ''}</span>
          <span className="px-2 py-1.5 text-right font-black tabular-nums text-rose-600">{l.credit ? fmt(l.credit) : ''}</span>
        </div>
      ))}

      <div className={`${cols} border-t-2 border-slate-300 bg-slate-50 text-[11px]`}>
        <span className="px-2 py-1.5 font-black text-slate-500">합계</span>
        <span /><span /><span />
        <span className="px-2 py-1.5 text-right font-black tabular-nums text-slate-800">{fmt(totalD)}</span>
        <span className="px-2 py-1.5 text-right font-black tabular-nums text-slate-800">{fmt(totalC)}</span>
      </div>
    </div>
  );
}
