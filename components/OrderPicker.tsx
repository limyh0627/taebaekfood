import React from 'react';
import { ClipboardList, Package, FileText, Search, Plus, ChevronRight, X, Check } from 'lucide-react';
import type { Order, PurchaseOrder, IssuedStatement, Item, Partner } from '../src/shared/types';
import { poLines } from '../src/shared/types';
import { groupByMonth as 월별묶기 } from '../src/shared/groupByMonth';
import { itemSummary } from '../src/shared/itemSummary';
import { STATUS_LABEL, STATUS_COLOR } from '../src/shared/orderStatusStyle';
import { weekMonday, weekSunday, monthStart, monthEnd, today, dateOfLocal } from '../src/shared/day';
import { cardNoLabel } from '../src/shared/cardNo';
import { matchesSearch } from '../src/shared/hangul';
import type { ManualRow } from '../src/shared/statementLines';

/**
 * 거래처를 고른 뒤, **어느 주문·발주로 전표를 끊을지 고르는 화면.**
 *
 * [TradeStatement.tsx](TradeStatement.tsx) 안에 310줄로 있던 것을 떼어 왔다
 * (양식 쪼개기 ③, 2026-09-05). 이건 **양식이 아니라 워크플로**라 자리를 잘못 잡고
 * 있었다 — 거래명세서 양식은 "무엇을 얼마에 판다"를 그리는 것이고, 여기는
 * "무엇으로 끊을까"를 고르는 것이다.
 *
 * 붙들고 있는 화면 상태가 서른 개라, 평평하게 서른 개를 넘기는 대신 **뜻으로 묶어**
 * 다섯 덩어리로 받는다. 어디가 이음매인지 이름으로 드러난다.
 */
export interface OrderPickerProps {
  /** 지금 무엇을 하는 중인가 */
  mode: {
    createMode: '매출' | '매입' | '비용' | null;
    manualMode: boolean;
    editingStmt: IssuedStatement | null;
  };
  /** 무엇을 골랐나 */
  pick: {
    selectedClientId: string;
    selectedOrderId: string;
    selectedOrderIds: string[];
  };
  /** 목록을 좁히는 것들 */
  filter: {
    onlyActive: boolean;
    dateFrom: string;
    dateTo: string;
    orderDateQuick: string;
    /** 진행 주문을 몇 개까지 펼쳤나 ('더 보기'로 는다) */
    activeVisible: number;
    partnerSearch: string;
  };
  /** 보여줄 것들 — 셈은 이미 끝나서 온다 */
  data: {
    activeOrders: Order[];
    partnerOrders: Order[];
    confirmedBySupplier: { partnerId: string; partnerName: string; items: any[] }[];
    orderRequestsBySupplier: { partnerId: string; partnerName: string; items: any[] }[];
    /** 발주 카드 원본 — 공급처 그룹에서 id 만 오므로 실물을 여기서 찾는다 */
    confirmedOrders: PurchaseOrder[];
    orderRequests: PurchaseOrder[];
    /** 이미 끊은 전표 — 같은 발주로 두 번 끊는 걸 막는다 */
    mergedStatements: IssuedStatement[];
    allItems: Item[];
    partners: Partner[];
    /** 이 주문에 전표가 걸렸나 — 판정은 부르는 쪽이 준다(전표 실물을 봐야 한다) */
    isVouchered: (o: Order) => boolean;
  };
  /** 누르면 하는 일 */
  on: {
    setSelectedClientId: (v: string) => void;
    setSelectedOrderIds: React.Dispatch<React.SetStateAction<string[]>>;
    setManualMode: (v: boolean) => void;
    setManualItems: React.Dispatch<React.SetStateAction<ManualRow[]>>;
    setDateFrom: (v: string) => void;
    setDateTo: (v: string) => void;
    setOrderDateQuick: (v: any) => void;
    setActiveVisible: React.Dispatch<React.SetStateAction<number>>;
    setTradeDate: (v: string) => void;
    setLoadedPoIds: React.Dispatch<React.SetStateAction<string[]>>;
    setWarnDuplicate: (v: any) => void;
    goCompose: () => void;
    handleOrderClick: (o: Order) => void;
    poToManualRows: (po: PurchaseOrder) => ManualRow[];
  };
}

const OrderPicker: React.FC<OrderPickerProps> = ({ mode, pick, filter, data, on }) => {
  const { createMode, manualMode, editingStmt } = mode;
  const { selectedClientId, selectedOrderId, selectedOrderIds } = pick;
  const { onlyActive, dateFrom, dateTo, orderDateQuick, activeVisible, partnerSearch } = filter;
  const { activeOrders, partnerOrders, confirmedBySupplier, orderRequestsBySupplier,
          confirmedOrders, orderRequests, mergedStatements, allItems, partners, isVouchered } = data;
  const {
    setSelectedClientId, setSelectedOrderIds, setManualMode, setManualItems,
    setDateFrom, setDateTo, setOrderDateQuick, setActiveVisible, setTradeDate,
    setLoadedPoIds, setWarnDuplicate, goCompose, handleOrderClick, poToManualRows,
  } = on;

  return (
    <>
            {/* ── 중간 단계: 주문/발주 선택 ── */}
            {selectedClientId && !(selectedOrderId || manualMode || editingStmt) && (
              <div className="flex-1 overflow-y-auto flex flex-col min-h-0">
                <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100 bg-slate-50 flex-shrink-0 flex-wrap">
                  <span className="text-xs font-black text-slate-600">{createMode==='매출'?'주문 선택':'발주 선택'}</span>
                  {createMode==='매출' && <span className="text-xs text-slate-400">{partnerOrders.length}건</span>}
                  {/* 몇 건을 골랐는지 — 여러 건이면 한 전표로 묶인다는 걸 여기서 알려 준다 */}
                  {createMode==='매출' && selectedOrderIds.length > 0 && (
                    <span className="flex items-center gap-1.5">
                      <span className="text-[11px] font-black text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                        {selectedOrderIds.length}건 선택{selectedOrderIds.length > 1 && ' — 한 전표로'}
                      </span>
                      <button type="button"
                        onClick={() => { setSelectedOrderIds([]); setManualMode(false); setManualItems([{ name: '', spec: '', qty: '', price: '', isTaxExempt: false }]); }}
                        className="text-[11px] font-bold text-slate-400 hover:text-slate-600 underline">선택 해제</button>
                      <button type="button" onClick={goCompose}
                        className="text-[11px] font-black px-2.5 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-all">
                        전표 작성 →
                      </button>
                    </span>
                  )}
                  {createMode==='매출' && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {(['당일','금주','당월'] as const).map(p=>(
                        <button key={p} onClick={()=>{
                          if(p==='금주'){setDateFrom(weekMonday());setDateTo(weekSunday());setOrderDateQuick('금주');return;} // 월~일 고정
                          if(p==='당월'){setDateFrom(monthStart());setDateTo(monthEnd());setOrderDateQuick('당월');return;} // 1일~말일 고정
                          const t=today();
                          setDateFrom(t);setDateTo(t);setOrderDateQuick(p); // 당일
                        }}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-black border transition-all ${orderDateQuick===p?'bg-slate-700 text-white border-slate-700':'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}>{p}</button>
                      ))}
                      <input type="date" value={dateFrom} onChange={e=>{setDateFrom(e.target.value);setOrderDateQuick('');}}
                        className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300"/>
                      <span className="text-slate-300 text-xs">~</span>
                      <input type="date" value={dateTo} onChange={e=>{setDateTo(e.target.value);setOrderDateQuick('');}}
                        className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300"/>
                      {(dateFrom||dateTo)&&!orderDateQuick&&(
                        <button onClick={()=>{setDateFrom('');setDateTo('');setOrderDateQuick('');}}
                          className="text-xs text-slate-400 hover:text-slate-700 font-black">전체</button>
                      )}
                    </div>
                  )}
                  {createMode==='매입' && (
                    <>
                      {/*  매출 쪽과 같은 모양으로 — `N건` (2026-09-03 사장님, ui 통일) */}
                      <span className="text-xs text-slate-400">
                        {(confirmedBySupplier.find(s=>s.partnerId===selectedClientId)?.items.length??0) + (orderRequestsBySupplier.find(s=>s.partnerId===selectedClientId)?.items.length??0)}건
                      </span>
                      {/*  매출 쪽은 '발주 불러오기 | 직접 입력' 토글이라 여기도 같게 맞춘다 */}
                      <div className="ml-auto flex bg-slate-200 rounded-lg p-0.5 gap-0.5">
                        <button onClick={()=>setManualMode(false)}
                          className={`px-3 py-1 rounded-md text-xs font-black transition-all ${!manualMode?'bg-white text-slate-800 shadow-sm':'text-slate-500'}`}>
                          발주 불러오기
                        </button>
                        <button onClick={()=>setManualMode(true)}
                          className={`px-3 py-1 rounded-md text-xs font-black transition-all ${manualMode?'bg-white text-slate-800 shadow-sm':'text-slate-500'}`}>
                          직접 입력
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {createMode==='매출' && (()=>{
                  if(partnerOrders.length===0) return (
                    <div className="flex flex-col items-center justify-center flex-1 py-12 text-slate-300">
                      <ClipboardList size={36} strokeWidth={1.5} className="mb-2"/>
                      <p className="text-xs font-bold text-slate-400">해당 조건의 주문이 없습니다</p>
                    </div>
                  );
                  //  묶는 규칙은 [shared/groupByMonth](../src/shared/groupByMonth.ts) — 주문은 납기 기준
                  const months = 월별묶기(partnerOrders, o => o.deliveryDate || o.createdAt || '');
                  return (
                    <div className="divide-y divide-slate-100">
                      {months.map(({month, rows})=>(
                        <div key={month}>
                          <div className="px-5 py-2 bg-slate-50 flex items-center gap-2 sticky top-0 z-10">
                            <span className="text-[11px] font-black text-slate-500">{month}</span>
                            <span className="text-[10px] text-slate-400">{rows.length}건</span>
                          </div>
                          <div className="divide-y divide-slate-50">
                            {rows.map(o=>{
                              const alreadyIssued = isVouchered(o);   // 목록 필터와 같은 기준
                              return (
                                <button key={o.id} onClick={()=>handleOrderClick(o)}
                                  aria-pressed={selectedOrderIds.includes(o.id)}
                                  className={`w-full flex items-center gap-3 text-left px-5 py-3 text-xs transition-all ${alreadyIssued?'bg-emerald-50 hover:bg-emerald-100':'hover:bg-pink-50'}`}>
                                  {/* 여러 건을 골라 한 전표로 묶을 수 있다 — 고른 것만 줄이 이어 붙는다 */}
                                  <span className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center transition-all ${
                                    selectedOrderIds.includes(o.id)
                                      ? 'bg-blue-600 border-blue-600 text-white'
                                      : 'bg-white border-slate-300'}`}>
                                    {selectedOrderIds.includes(o.id) && <Check size={11} strokeWidth={4}/>}
                                  </span>
                                  <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                                    <span className="font-black text-slate-800">납품: {o.deliveryDate?.slice(0,10)||'미정'}</span>
                                    <span className="text-slate-400">
                                      {/*  카드번호 — 어느 주문 카드인지 화면끼리 가리킬 이름 */}
                                      <b className="text-slate-500 font-black tabular-nums mr-1.5">{cardNoLabel(o)}</b>
                                      주문일 {dateOfLocal(o.createdAt)} · {o.items.length}품목
                                    </span>
                                  </div>
                                  <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${STATUS_COLOR[o.status]||'bg-slate-100 text-slate-500'}`}>{STATUS_LABEL[o.status]||o.status}</span>
                                  {alreadyIssued
                                    ? <span className="text-[10px] font-black text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded-full">발행완료</span>
                                    : <span className="text-[10px] font-black text-pink-500 bg-pink-100 px-1.5 py-0.5 rounded-full">미발행</span>}
                                  <ChevronRight size={14} className="text-slate-300 shrink-0"/>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {createMode==='매입' && (()=>{
                  // 원본 PO(묶음 items[] 포함)를 거래처별로 직접 조회 — 주문카드와 동일 구조
                  const myConfirmed = confirmedOrders.filter(po => po.partnerId === selectedClientId);
                  const myRequests  = orderRequests.filter(po => po.partnerId === selectedClientId);
                  if(myConfirmed.length===0 && myRequests.length===0) return (
                    <div className="flex flex-col items-center justify-center flex-1 py-12 text-slate-300">
                      <ClipboardList size={36} strokeWidth={1.5} className="mb-2"/>
                      <p className="text-xs font-bold text-slate-400">발주 항목이 없습니다</p>
                      <p className="text-xs text-slate-300 mt-1">직접 입력으로 전표를 작성하세요</p>
                    </div>
                  );

                  const loadCard = (po: PurchaseOrder) => {
                    setManualItems(poToManualRows(po));   // 빈 행은 안 붙인다 — 필요하면 '행 추가'
                    setLoadedPoIds(prev => Array.from(new Set([...prev, po.id].filter(Boolean))));
                    setTradeDate(today());   // 발주일이 아니라 발행하는 날
                    setManualMode(true);
                  };
                  // 발주카드 클릭: 이 카드에 연결된 전표(linkedStatementId)가 있으면 중복 경고, 아니면 로드
                  const clickCard = (po: PurchaseOrder) => {
                    const linked = po.linkedStatementId ? mergedStatements.find(s => s.id === po.linkedStatementId) : undefined;
                    if (linked) { setWarnDuplicate({ po, stmt: linked }); return; }
                    loadCard(po);
                  };
                  // 카드 요약: 품목명 나열
                  //  요약은 전표 카드와 같은 함수를 쓴다 — 전에는 여기만 '건', 저기는 '개'였다
                  const summarize = (po: PurchaseOrder) =>
                    itemSummary(poLines(po).map(l => ({
                      name: l.name || allItems.find(p => p.id === l.itemId)?.name || '품목',
                    }))) || '품목';
                  const totalQty = (po: PurchaseOrder) => poLines(po).reduce((s,l)=>s+(l.quantity||0),0);

                  // 월별 그룹 (주문카드와 동일 구조)
                  //  발주는 등록일 기준 — 묶는 규칙은 주문과 같은 함수다
                  const confMonths = 월별묶기(myConfirmed, po => po.createdAt || '');
                  const reqMonths  = 월별묶기(myRequests,  po => po.createdAt || '');

                  return (
                    <div className="divide-y divide-slate-100">
                      {myConfirmed.length>0 && confMonths.map(({month, rows})=>(
                        <div key={month}>
                          <div className="px-5 py-2 bg-slate-50 flex items-center gap-2 sticky top-0 z-10">
                            <span className="text-[11px] font-black text-slate-500">{month}</span>
                            <span className="text-[10px] text-slate-400">{rows.length}건</span>
                          </div>
                          <div className="divide-y divide-slate-50">
                            {rows.map(po=>{
                              const alreadyIssued = !!po.linkedStatementId;
                              const receivedDate = dateOfLocal(po.receivedAt||po.invoicedAt||po.createdAt);
                              const createdDate  = dateOfLocal(po.createdAt);
                              return (
                                <button key={po.id} onClick={()=>clickCard(po)}
                                  className={`w-full flex items-center gap-3 text-left px-5 py-3 text-xs transition-all ${alreadyIssued?'bg-emerald-50 hover:bg-emerald-100':'hover:bg-pink-50'}`}>
                                  <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                                    <span className="font-black text-slate-800">입고: {receivedDate||'미정'}</span>
                                    <span className="text-slate-400"><b className="text-slate-500 font-black tabular-nums mr-1.5">{cardNoLabel(po)}</b>발주일 {createdDate} · {summarize(po)}</span>
                                  </div>
                                  <span className="text-slate-600 font-bold shrink-0">{totalQty(po)}개</span>
                                  {alreadyIssued
                                    ? <span className="text-[10px] font-black text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded-full">발행완료</span>
                                    : <span className="text-[10px] font-black text-pink-500 bg-pink-100 px-1.5 py-0.5 rounded-full">미발행</span>}
                                  <ChevronRight size={14} className="text-slate-300 shrink-0"/>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                      {myRequests.length>0 && reqMonths.map(({month, rows})=>(
                        <div key={`req-${month}`}>
                          <div className="px-5 py-2 bg-indigo-50 flex items-center gap-2 sticky top-0 z-10">
                            <span className="text-[11px] font-black text-indigo-600">발주예정 {month}</span>
                            <span className="text-[10px] text-indigo-400">{rows.length}건</span>
                          </div>
                          <div className="divide-y divide-slate-50">
                            {rows.map(po=>{
                              const alreadyIssued = !!po.linkedStatementId;
                              const createdDate = dateOfLocal(po.createdAt);
                              return (
                                <button key={po.id} onClick={()=>clickCard(po)}
                                  className={`w-full flex items-center gap-3 text-left px-5 py-3 text-xs transition-all ${alreadyIssued?'bg-emerald-50 hover:bg-emerald-100':'hover:bg-indigo-50'}`}>
                                  <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                                    <span className="font-black text-slate-800">발주: {createdDate||'미정'}</span>
                                    <span className="text-slate-400">{summarize(po)} · {totalQty(po)}개</span>
                                  </div>
                                  {alreadyIssued
                                    ? <span className="text-[10px] font-black text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded-full">발행완료</span>
                                    : <span className="text-[10px] font-black text-indigo-500 bg-indigo-100 px-1.5 py-0.5 rounded-full">미발행</span>}
                                  <ChevronRight size={14} className="text-slate-300 shrink-0"/>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}

            {/*
              ── 미발행 발주 목록 (매입·거래처 미선택) ──
              매출 쪽에는 '미발행 주문'이 있는데 매입 쪽엔 없어서, 거래처를 안 고르면
              빈 화면이었다. 대칭으로 맞춘다(2026-09-03 사장님).
              누르면 그 거래처로 들어가 발주 목록이 뜬다 — 매출 쪽과 같은 흐름이다.
            */}
            {createMode==='매입' && !selectedClientId && (() => {
              const 그룹 = confirmedBySupplier
                .filter(g => matchesSearch(g.partnerName || '', partnerSearch))
                .filter(g => g.items.length > 0)
                .sort((a, b) => (a.partnerName || '').localeCompare(b.partnerName || '', 'ko'));
              const 합 = 그룹.reduce((n, g) => n + g.items.length, 0);
              if (!그룹.length) return null;
              return (
                <div className="flex-1 min-h-0 flex flex-col">
                  <div className="px-5 py-2 bg-slate-50 flex items-center gap-2 flex-shrink-0">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">미발행 발주</span>
                    <span className="text-[10px] text-slate-400">{합}건</span>
                  </div>
                  <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
                    {그룹.map(g => (
                      <button key={g.partnerId || g.partnerName}
                        onClick={() => { setSelectedClientId(g.partnerId ?? ''); setManualMode(false); }}
                        className="w-full flex items-center gap-2 text-left px-5 py-2.5 text-xs hover:bg-rose-50 transition-colors">
                        <span className="font-black text-slate-800 w-40 truncate shrink-0">{g.partnerName || '거래처 미지정'}</span>
                        <span className="text-slate-400 flex-1 min-w-0 truncate">
                          {g.items.slice(0, 2).map(x => x.product?.name).filter(Boolean).join(', ')}
                          {g.items.length > 2 && ` 외 ${g.items.length - 2}`}
                        </span>
                        <span className="text-slate-600 font-bold shrink-0">{g.items.length}품목</span>
                        <span className="text-[10px] font-black text-pink-500 bg-pink-100 px-1.5 py-0.5 rounded-full shrink-0">미발행</span>
                        <ChevronRight size={14} className="text-slate-300 shrink-0"/>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* ── 진행 주문 목록 (매출·진행주문만·거래처 미선택) ── */}
            {createMode==='매출' && !selectedClientId && activeOrders.length > 0 && (() => {
              const listOrders = (onlyActive ? activeOrders.filter(o => !isVouchered(o)) : activeOrders)
                // 스마트스토어 거래처 제외 (전표 발행 대상 아님)
                .filter(o => (partners.find(c => c.id === o.partnerId)?.type ?? o.source) !== '스마트스토어')
                .filter(o => matchesSearch(partners.find(c => c.id === o.partnerId)?.name || '', partnerSearch))
                //  납품일이 비어 있으면 배송일·생성일로 물러선다 — 옛 주문은 deliveryDate가 없는 게 많아
                //  날짜필터를 걸면 통째로 사라졌다.
                .filter(o => {
                  const d = dateOfLocal((o.deliveryDate || (o as { deliveredAt?: string }).deliveredAt || o.createdAt) || '');
                  return (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo);
                });
              return (
              <div className="flex-1 min-h-0 flex flex-col">
                <div className="px-5 py-2 bg-slate-50 flex items-center gap-2 flex-shrink-0">
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{onlyActive ? '미발행 주문' : '진행 주문'}</span>
                  <span className="text-[10px] text-slate-400">{listOrders.length}건</span>
                </div>
                <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
                  {listOrders.slice(0, activeVisible).map(o => {
                    const cl = partners.find(c => c.id === o.partnerId);
                    return (
                      <button key={o.id}
                        onClick={() => { setSelectedClientId(o.partnerId ?? ''); setManualMode(false); handleOrderClick(o); }}
                        className="w-full flex items-center gap-2 text-left px-5 py-2.5 text-xs hover:bg-blue-50 transition-colors">
                        <span className="font-black text-slate-800 w-32 truncate shrink-0">{cl?.name || o.partnerId}</span>
                        <span className={`w-16 text-center shrink-0 text-[10px] font-black px-1.5 py-0.5 rounded-full ${STATUS_COLOR[o.status] || 'bg-slate-100 text-slate-500'}`}>
                          {STATUS_LABEL[o.status] || o.status}
                        </span>
                        {/*  카드번호 — 어느 주문 카드인지 가리킬 이름(2026-09-03) */}
                        <span className="w-24 shrink-0 text-[10px] font-black text-slate-400 tabular-nums truncate">{cardNoLabel(o)}</span>
                        <span className="w-28 shrink-0 text-slate-400">납품 {o.deliveryDate?.slice(5,10) || '미정'}</span>
                        <span className="w-14 shrink-0 text-center">
                          {isVouchered(o)
                            ? <span className="text-[10px] font-black text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded-full">발행</span>
                            : <span className="text-[10px] font-black text-pink-500 bg-pink-100 px-1.5 py-0.5 rounded-full">미발행</span>}
                        </span>
                        <span className="ml-auto shrink-0 text-slate-400">{o.items.length}품목</span>
                      </button>
                    );
                  })}
                  {listOrders.length > activeVisible && (
                    <button onClick={() => setActiveVisible(v => v + 15)}
                      className="w-full py-2 text-[11px] font-black text-blue-600 hover:bg-blue-50 transition-colors">
                      + {listOrders.length - activeVisible}건 더 보기
                    </button>
                  )}
                </div>
              </div>
              );
            })()}
    </>
  );
};

export default OrderPicker;
