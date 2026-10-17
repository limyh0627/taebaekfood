import React from 'react';
import type {JournalEntry} from '../../../shared/types';

export function AccrualJournalPreview({type,journal,renderJournal}:{type:'매출'|'매입'|'비용';journal:JournalEntry|null;renderJournal:(journal:JournalEntry)=>React.ReactNode}) {
  return (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/70 overflow-hidden">
                    <div className="px-4 py-2 border-b border-slate-200 flex items-center gap-2">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">이렇게 분개됩니다</span>
                      <span className="text-[10px] font-bold text-amber-600">{type === '비용' ? '대체전표' : `${type}전표`}</span>
                    </div>
                    <div className="px-4 py-2.5">
                      {journal ? renderJournal(journal) : (
                        <p className="text-[11px] font-black text-amber-600">
                          차·대가 안 맞거나 상대계정이 없어 분개를 만들 수 없습니다 — 계정과목 설정을 확인하세요.
                        </p>
                      )}
                    </div>
                  </div>
                );
}

export function CashJournalPreview({rows,codeName,formatAmount}:{rows:{id:string;journal:JournalEntry|null}[];codeName:Map<string,string>;formatAmount:(amount:number)=>string}) {
  return (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/70 overflow-hidden">
                    <div className="px-4 py-2 border-b border-slate-200 flex items-center gap-2">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">이렇게 분개됩니다</span>
                      {rows.length > 1 && <span className="text-[10px] font-bold text-slate-400">자금전표 {rows.length}건</span>}
                    </div>
                    <div className="divide-y divide-slate-200">
                      {rows.map(({id,journal:je}) => {
                        return (
                          <div key={id} className="px-4 py-2.5">
                            {/*  표는 옆으로 민다 — 폰에서 계정 칸이 눌려 이름이 안 보였다(2026-09-05) */}
                            {je ? (
                              <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
                                <div className="grid grid-cols-[42px_minmax(140px,1fr)_100px_100px] min-w-[420px] bg-slate-100 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                                  <span className="px-2 py-1.5">구분</span>
                                  <span className="px-2 py-1.5">계정</span>
                                  <span className="px-2 py-1.5 text-right">차변</span>
                                  <span className="px-2 py-1.5 text-right">대변</span>
                                </div>
                                {je.lines.map((l, i) => (
                                  <div key={i} className="grid grid-cols-[42px_minmax(140px,1fr)_100px_100px] min-w-[420px] border-t border-slate-50 text-[11px]">
                                    <span className={`px-2 py-1.5 font-black ${l.debit ? 'text-slate-600' : 'text-slate-400'}`}>{l.debit ? '차변' : '대변'}</span>
                                    <span className="px-2 py-1.5 font-bold text-slate-700 truncate">
                                      <span className="text-slate-400 font-mono mr-1">{l.accountCode}</span>{codeName.get(l.accountCode) ?? ''}
                                    </span>
                                    <span className="px-2 py-1.5 text-right font-black tabular-nums text-slate-700">{l.debit ? formatAmount(l.debit) : ''}</span>
                                    <span className="px-2 py-1.5 text-right font-black tabular-nums text-slate-700">{l.credit ? formatAmount(l.credit) : ''}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-[11px] font-black text-amber-600">
                                계정과목이 없어 분개를 만들 수 없습니다 — 손익·재무제표 어디에도 안 잡힙니다.
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
}
