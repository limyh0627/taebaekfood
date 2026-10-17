import React, { type Dispatch, type SetStateAction } from 'react';
import { Trash2 } from 'lucide-react';
import type { Item } from '../../../shared/types';
import type { CostCalcResult } from '../../admin/costCalc';
import { matchesSearch } from '../../../shared/hangul';
import ModalShell from '../../../shared/components/ModalShell';

export function ItemCostCalculator({items,calcRows,calcPrice,calcFee,calcTax,calcSearch,calcPickIdx,calcResult,setCalcRows,setCalcPrice,setCalcFee,setCalcTax,setCalcSearch,setCalcPickIdx,onClose}: {
 items:Item[]; calcRows:{itemId:string;qty:string}[]; calcPrice:string; calcFee:string;
 calcTax:'과세'|'면세'; calcSearch:string; calcPickIdx:number|null; calcResult:CostCalcResult;
 setCalcRows:Dispatch<SetStateAction<{itemId:string;qty:string}[]>>;
 setCalcPrice:Dispatch<SetStateAction<string>>; setCalcFee:Dispatch<SetStateAction<string>>;
 setCalcTax:Dispatch<SetStateAction<'과세'|'면세'>>; setCalcSearch:Dispatch<SetStateAction<string>>;
 setCalcPickIdx:Dispatch<SetStateAction<number|null>>; onClose:()=>void;
}) {
 return (
<ModalShell title="원가계산기" onClose={onClose} bodyClassName="space-y-4">
              <p className="text-[11px] text-slate-400">구성품을 넣어 원가를 보고, 팔 값을 넣어 마진을 봅니다 — 저장은 안 됩니다.</p>
              {/* 만들 물건이 과세냐 면세냐 — 면세 원료 할증이 여기서 갈린다 */}
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">만들 물건</span>
                <div className="flex bg-slate-100 rounded-xl p-0.5 gap-0.5">
                  {(['과세', '면세'] as const).map(t => (
                    <button key={t} onClick={() => setCalcTax(t)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all ${calcTax === t ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400'}`}>{t}</button>
                  ))}
                </div>
                <span className="text-[10px] font-bold text-slate-400">
                  과세품에 면세 원료를 쓰면 매입세액을 못 빼서 그 줄에 10%가 얹힙니다
                </span>
              </div>

              {/* 구성품 */}
              {/*  옆으로 민다 — 칸이 다섯이라 폰 폭에 안 들어간다(2026-09-05) */}
              <div className="rounded-2xl border border-slate-200 overflow-x-auto">
                <div className="grid grid-cols-[minmax(140px,1fr)_92px_110px_110px_36px] min-w-[500px] bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  <span className="px-3 py-2">구성품</span>
                  <span className="px-3 py-2 text-right">수량</span>
                  <span className="px-3 py-2 text-right">단위원가</span>
                  <span className="px-3 py-2 text-right">금액</span>
                  <span />
                </div>
                {calcRows.map((row, i) => {
                  const line = calcResult.lines.find(l => l.itemId === row.itemId);
                  const picked = items.find(x => x.id === row.itemId);
                  return (
                    <div key={i} className="grid grid-cols-[minmax(140px,1fr)_92px_110px_110px_36px] min-w-[500px] border-t border-slate-100 items-start">
                      <div className="px-3 py-2 min-w-0">
                        <button onClick={() => { setCalcPickIdx(calcPickIdx === i ? null : i); setCalcSearch(''); }}
                          className={`w-full text-left text-xs font-bold truncate px-2 py-1.5 rounded-lg border transition-all ${picked ? 'border-slate-200 text-slate-700 hover:border-emerald-300' : 'border-dashed border-slate-300 text-slate-400'}`}>
                          {picked ? `${picked.name}${picked.spec ? ` · ${picked.spec}` : ''}` : '구성품 고르기'}
                        </button>
                        {calcPickIdx === i && (
                          <div className="mt-1.5 rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden">
                            <input autoFocus value={calcSearch} onChange={e => setCalcSearch(e.target.value)}
                              placeholder="품목명 검색..."
                              className="w-full px-3 py-2 text-xs font-bold border-b border-slate-100 outline-none" />
                            {/* 창 크기를 고정한다 — 검색으로 줄 수가 줄어도 안 흔들린다 */}
                            <div className="h-52 overflow-y-auto">
                              {items.filter(x => !calcSearch.trim() || matchesSearch(`${x.name} ${x.spec ?? ''}`, calcSearch.trim()))
                                .slice(0, 200).map(x => (
                                <button key={x.id}
                                  onClick={() => { setCalcRows(rs => rs.map((r, k) => k === i ? { ...r, itemId: x.id } : r)); setCalcPickIdx(null); }}
                                  className="w-full text-left px-3 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-emerald-50 truncate">
                                  {x.name}<span className="text-slate-400 ml-1">{x.spec ?? ''} · {x.unit ?? ''}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      <input value={row.qty} inputMode="decimal"
                        onChange={e => setCalcRows(rs => rs.map((r, k) => k === i ? { ...r, qty: e.target.value } : r))}
                        className="mx-2 mt-2 text-right bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-emerald-300" />
                      <span className="px-3 py-4 text-right text-xs font-bold text-slate-500 tabular-nums">
                        {line ? Math.round(line.unitCost).toLocaleString() : '—'}
                      </span>
                      <span className="px-3 py-4 text-right text-xs font-black text-slate-800 tabular-nums">
                        {line ? Math.round(line.amount).toLocaleString() : '—'}
                      </span>
                      <button onClick={() => setCalcRows(rs => rs.filter((_, k) => k !== i))}
                        className="text-slate-300 hover:text-rose-500 justify-self-center mt-3.5"><Trash2 size={13} /></button>
                    </div>
                  );
                })}
                <button onClick={() => setCalcRows(rs => [...rs, { itemId: '', qty: '1' }])}
                  className="w-full py-2 border-t border-slate-100 text-[11px] font-black text-emerald-600 hover:bg-emerald-50">
                  + 구성품 추가
                </button>
              </div>

              {/* 가공비 · 판매가 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="space-y-1 block">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">가공비 (BOM에 없는 몫)</span>
                  <input value={calcFee} onChange={e => setCalcFee(e.target.value)} inputMode="numeric" placeholder="0"
                    className="w-full text-right bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-black tabular-nums outline-none focus:ring-2 focus:ring-emerald-300" />
                </label>
                <label className="space-y-1 block">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">판매단가 (공급가)</span>
                  <input value={calcPrice} onChange={e => setCalcPrice(e.target.value)} inputMode="numeric" placeholder="0"
                    className="w-full text-right bg-white border-2 border-emerald-200 rounded-xl px-3 py-2 text-sm font-black tabular-nums outline-none focus:ring-2 focus:ring-emerald-300" />
                </label>
              </div>

              {/* 셈 결과 */}
              <div className="rounded-2xl bg-slate-900 text-white px-5 py-4 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-slate-400">
                  <span>원가 {calcResult.fee > 0 && <span className="text-slate-500">(가공비 {calcResult.fee.toLocaleString()} 포함)</span>}</span>
                  <span className="text-base font-black text-white tabular-nums">{calcResult.cost.toLocaleString()}원</span>
                </div>
                <div className="flex items-center justify-between text-xs font-bold text-slate-400">
                  <span>판매단가</span>
                  <span className="text-base font-black text-white tabular-nums">{calcResult.price.toLocaleString()}원</span>
                </div>
                <div className="border-t border-slate-700 pt-2 flex items-center justify-between">
                  <span className="text-xs font-black text-slate-300">마진</span>
                  <div className="text-right">
                    <span className={`text-xl font-black tabular-nums ${calcResult.margin < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {calcResult.margin.toLocaleString()}원
                    </span>
                    {calcResult.price > 0 && (
                      <span className={`ml-2 text-sm font-black ${calcResult.margin < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                        {(calcResult.marginRate * 100).toFixed(1)}%
                      </span>
                    )}
                  </div>
                </div>
                {calcResult.cost > 0 && calcResult.price > 0 && (
                  <p className="text-[10px] font-bold text-slate-500 text-right">
                    원가에 {(calcResult.markupRate * 100).toFixed(1)}% 얹은 값입니다
                  </p>
                )}
                {calcResult.margin < 0 && (
                  <p className="text-[11px] font-black text-rose-400">팔수록 손해입니다 — 판매단가가 원가보다 낮습니다.</p>
                )}
              </div>

            <div className="flex items-center justify-between px-6 py-3 border-t border-slate-100">
              <button onClick={() => { setCalcRows([{ itemId: '', qty: '1' }]); setCalcPrice(''); setCalcFee(''); }}
                className="text-xs font-black text-slate-400 hover:text-slate-600">비우기</button>
              <button onClick={onClose}
                className="px-5 py-2 rounded-xl bg-slate-900 text-white text-xs font-black hover:bg-slate-800">닫기</button>
            </div>
        </ModalShell>
 );
}
