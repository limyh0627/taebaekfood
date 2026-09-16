import React, { useCallback, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { AccountCode, IssuedStatement, JournalEntry, Partner } from '../../../../types';
import { journalizeStatement, journalizeTransfer } from '../../../shared/autoJournal';
import VoucherSlip from '../../../shared/VoucherSlip';

const fmt = (value: number) => value.toLocaleString('ko-KR');
type Meta = { kind?: string; docNo?: string; date?: string; headPartner?: string };

/** 조회 목록의 분개 펼침 상태와 표준 분개 표시를 묶는다. */
export function useStatementJournal(accountCodes: AccountCode[], partners: Partner[], codeName: Map<string, string>) {
  const [expandedJournal, setExpandedJournal] = useState<Set<string>>(new Set());
  const toggleJournal = (id: string) => setExpandedJournal(previous => {
    const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next;
  });
  const normalOf = useCallback((code: string): 'debit' | 'credit' =>
    accountCodes.find(account => String(account.code) === String(code))?.normalBalance ?? 'debit', [accountCodes]);
  const journalOfStmt = (statement: IssuedStatement): JournalEntry | null =>
    statement.type === '비용' ? journalizeTransfer(statement, normalOf) : journalizeStatement(statement);
  const partnerNameById = useMemo(() => new Map(partners.map(partner => [partner.id, partner.name])), [partners]);
  const renderJournal = (entry: JournalEntry | null, compact = false, meta: Meta = {}) => {
    if (!entry) return <p className={`${compact ? 'px-2.5 py-2' : ''} text-[11px] font-black text-amber-600`}>계정이 지정되지 않아 분개를 만들 수 없습니다 — 손익·재무제표에 안 잡힙니다.</p>;
    if (compact) return <>{entry.lines.map((line, index) => <div key={index} className="flex items-center gap-2 px-2.5 py-1.5 border-b border-white last:border-0 text-[11px]">
      <span className={`shrink-0 font-black ${line.debit ? 'text-slate-600' : 'text-slate-400'}`}>{line.debit ? '차변' : '대변'}</span>
      <span className="flex-1 min-w-0 truncate font-bold text-slate-700"><span className="text-slate-400 font-mono mr-1">{line.accountCode}</span>{codeName.get(line.accountCode) ?? ''}</span>
      <span className="shrink-0 font-black tabular-nums text-slate-700">{fmt(line.debit || line.credit)}</span>
    </div>)}</>;
    return <VoucherSlip je={entry} codeName={codeName} partnerName={partnerNameById} kind={meta.kind} docNo={meta.docNo} date={meta.date} headPartner={meta.headPartner}/>;
  };
  const journalTr = (key: string, entry: JournalEntry | null, meta: Meta = {}) => <tr key={key} className="bg-slate-50/80"><td/><td colSpan={6} className="px-4 pt-1 pb-3 overflow-x-auto">{renderJournal(entry, false, meta)}</td></tr>;
  const journalToggle = (id: string) => <button onClick={event => { event.stopPropagation(); toggleJournal(id); }} title={expandedJournal.has(id) ? '분개 접기' : '분개 보기 — 차변/대변'} className="shrink-0 text-slate-300 hover:text-slate-700 transition-colors">{expandedJournal.has(id) ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}</button>;
  return { expandedJournal, journalOfStmt, renderJournal, journalTr, journalToggle };
}
