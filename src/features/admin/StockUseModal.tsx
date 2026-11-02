import React, { useState, useMemo } from 'react';
import ModalShell from '../../shared/components/ModalShell';
import { appConfirm } from '../../shared/components/appDialog';
import { toQuantityMilli, fromQuantityMilli, assertQuantityForKind, assertCompletionChoiceMatchesUnit, type BatchOpenResult, type BatchResult, type CompletionChoice, type StockOnlyChoice } from '../../../functions/src/shared/orderProductionBatchContract';
import type { Item } from '../../shared/types';
import { Package, CornerDownRight } from 'lucide-react';
import AlertModalShell from '../../shared/components/AlertModalShell';
import { appNotice } from '../../shared/components/appDialog';
import { StockUseRow, resolveStockUse, toStockUsePlan } from './stockUseRows';
import type { StockUsePlan } from './orderStockEngine';

/**
 * 작업완료 직전 "이미 있는 재고를 얼마나 쓸까" 확인.
 *
 * 기본값은 쓸 수 있는 만큼(= min(주문량, 재고))이 이미 채워져 있어 그냥 [작업완료]만 누르면 된다.
 * 수량을 줄이거나 [사용안함]을 누르면 그만큼 새로 생산한다 — 재고는 그대로 남는다.
 * 박스 재고로 주문량을 다 못 채우면 낱개 행이 따라 나온다(그것도 모자라면 전부 생산).
 *
 * 한 주문의 모든 라인을 한 화면에 모은다 — 10개입·20개입이 같은 낱개 재고를 노리므로
 * 순차 팝업이면 배분이 안 보인다.
 */
interface PartialProps { scopeKey:string; opening:BatchOpenResult; catalog:Item[]; busy:boolean; requestLocked:boolean; error?:string; onSelectionChange:(ids:string[])=>void; onSubmit:(lines:CompletionChoice[],stockOnly:StockOnlyChoice[])=>Promise<void>; result?:BatchResult|null; onApply?:()=>Promise<void>; onRecoverActive?:()=>void; }
interface Props {
  partial?:PartialProps;
  partnerName: string;
  rows: StockUseRow[];
  completionLabel?: string;
  onConfirm: (plan: StockUsePlan) => void | Promise<void>;
  onCancel: () => void;
}

const num = (v: string) => {
  const n = Number(v.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const LegacyStockUseModal: React.FC<Props> = ({ partnerName, rows, completionLabel = '작업완료', onConfirm, onCancel }) => {
  const [ownOverride, setOwnOverride] = useState<Record<number, number>>({});
  const [looseOverride, setLooseOverride] = useState<Record<number, number>>({});
  const [confirming, setConfirming] = useState(false);

  const states = useMemo(
    () => resolveStockUse(rows, ownOverride, looseOverride),
    [rows, ownOverride, looseOverride],
  );

  const totalUse = states.reduce((s, x) => s + x.own + (x.loose?.value ?? 0), 0);
  const needsProduction = states.some(x => x.shortUnits > 0);
  const hasUsableStock = states.some(x => x.ownMax > 0 || (x.loose?.max ?? 0) > 0);

  const confirmUse = async () => {
    if (confirming) return;
    setConfirming(true);
    try {
      await onConfirm(toStockUsePlan(states));
    } catch (error) {
      // 승인창은 호출자가 먼저 닫는다. 이곳에서 공통 앱 알림을 띄워 실패 이유가 사라지지 않게 한다.
      const reason = error instanceof Error ? error.message : String(error);
      await appNotice(reason, reason.includes('부족') ? '재고 부족' : `${completionLabel} 실패`);
    } finally {
      setConfirming(false);
    }
  };

  const qtyInput = (value: number, max: number, onChange: (n: number) => void) => (
    <input
      type="number" min={0} max={max} value={value}
      onChange={e => onChange(Math.max(0, Math.min(max, num(e.target.value))))}
      onFocus={e => e.target.select()}
      className="w-20 px-2 py-1.5 text-right font-black text-slate-900 bg-white border-2 border-slate-200 rounded-lg text-sm focus:border-emerald-400 focus:outline-none"
    />
  );

  return (
    /*  틀은 `AlertModalShell` 한 벌이다(2026-09-15 사장님: "알람양식은 저걸로 통일").
        머리에는 **짧은 이름**만 서고 — 쓸 재고가 있으면 `재고 사용`, 없으면 `재고부족` —
        "재고가 없어 전량 생산합니다" 같은 설명은 아래 내용의 첫 줄로 내려간다. */
    <AlertModalShell
      wide
      title={hasUsableStock ? '재고 사용' : '재고부족'}
      tone={hasUsableStock ? 'emerald' : 'amber'}
      icon={Package}
      onClose={onCancel}
      footer={
        //  틀의 발은 세로로 쌓으므로 단추 줄을 따로 묶는다.
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-xl text-sm hover:bg-slate-200 transition-all"
          >
            취소
          </button>
          <button
            onClick={() => { void confirmUse(); }}
            disabled={confirming}
            className={`flex-[2] py-2.5 text-white font-black rounded-xl text-sm transition-all ${hasUsableStock ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-500 hover:bg-amber-600'}`}
          >
            {needsProduction ? (totalUse > 0 ? `부족분 생산하고 ${completionLabel}` : `전량 생산하고 ${completionLabel}`) : `재고 사용하고 ${completionLabel}`}
          </button>
        </div>
      }
    >
        <p className="text-sm font-bold leading-snug text-slate-800">
          {needsProduction ? '가용재고가 부족하여 부족한 수량을 생산합니다' : '가용재고 사용량을 확인해 주세요'}
        </p>
        <p className="mt-1.5 text-xs font-medium leading-5 text-slate-500">
          {partnerName} · {hasUsableStock
            ? '다른 주문이 확보한 재고는 제외합니다. 부족분을 생산하고 이 주문 몫을 확보한 뒤 완료합니다'
            : '아래 주문 수량 전부를 새로 생산합니다'}
        </p>

        <div className="mt-3 space-y-3">
          {states.map(({ row, own, ownMax, shortUnits, loose }) => (
            <div key={row.idx} className="rounded-2xl border-2 border-slate-100 p-3.5">
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black text-slate-900 truncate">{row.name}</p>
                  <p className="text-xs text-slate-400 font-medium mt-0.5">
                    주문 {row.ordered}{row.unitLabel} · 가용재고 {row.stock}{row.unitLabel}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {qtyInput(own, ownMax, n => setOwnOverride(o => ({ ...o, [row.idx]: n })))}
                  <span className="text-xs font-bold text-slate-400">{row.unitLabel}</span>
                  <button
                    onClick={() => setOwnOverride(o => ({ ...o, [row.idx]: 0 }))}
                    className="px-2 py-1.5 bg-slate-100 text-slate-500 font-bold rounded-lg text-[11px] hover:bg-slate-200 transition-all"
                  >
                    사용안함
                  </button>
                </div>
              </div>

              {loose && (
                <div className="flex items-center gap-3 mt-2.5 pt-2.5 border-t border-dashed border-slate-200">
                  <CornerDownRight size={14} className="text-slate-300 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-black text-slate-700 truncate">{loose.need > 0 ? row.loose!.name : ''}</p>
                    <p className="text-[11px] text-slate-400 font-medium mt-0.5">
                      박스 {shortUnits}개 만들려면 {loose.need}{row.loose!.unitLabel} 필요 · 가용재고 {row.loose!.stock}{row.loose!.unitLabel}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {qtyInput(loose.value, loose.max, n => setLooseOverride(o => ({ ...o, [row.idx]: n })))}
                    <span className="text-xs font-bold text-slate-400">{row.loose!.unitLabel}</span>
                    <button
                      onClick={() => setLooseOverride(o => ({ ...o, [row.idx]: 0 }))}
                      className="px-2 py-1.5 bg-slate-100 text-slate-500 font-bold rounded-lg text-[11px] hover:bg-slate-200 transition-all"
                    >
                      사용안함
                    </button>
                  </div>
                </div>
              )}

              <p className="text-[11px] font-bold text-slate-400 mt-2.5">
                {shortUnits <= 0
                  ? '재고로 전부 충당 — 생산 없음'
                  : loose
                    ? `생산: ${row.name} ${shortUnits}${row.unitLabel}` + (loose.short > 0 ? ` (낱개 ${loose.short}${row.loose!.unitLabel} 새로 만듦)` : ' (낱개 재고로 조립)')
                    : `생산: ${shortUnits}${row.unitLabel}`}
              </p>
            </div>
          ))}
        </div>
    </AlertModalShell>
  );
};

type PartialDraft={complete:string;own:string;loose:string};
function PartialCompletionPanel({partial,onCancel}:{partial:PartialProps;onCancel:()=>void}) {
 const {opening,catalog,busy,requestLocked,scopeKey}=partial;const preview=partial.result?.state==='reserved'?partial.result.preview:undefined;const locked=requestLocked||!!preview;
 const baselineOwner=React.useRef(scopeKey);const current=React.useRef({scopeKey,busy,locked});current.current={scopeKey,busy,locked};const mounted=React.useRef(false),sending=React.useRef(false);React.useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
 const [lines,setLines]=useState<Record<string,PartialDraft>>({});const [extras,setExtras]=useState<Record<string,string>>({});const [selected,setSelected]=useState<string[]>(()=>opening.availableStockOnly.map(row=>row.itemId));const [picker,setPicker]=useState('');const [message,setMessage]=useState('');
 const measures=()=>Object.fromEntries([...opening.rows.map(row=>['line:'+row.lineId,row.unit.measureId]),...opening.availableStockOnly.map(row=>['extra:'+row.itemId,row.unit.measureId])]);
 const [accepted,setAccepted]=useState<Record<string,string>>(measures);const [acceptedToken,setAcceptedToken]=useState(opening.opening.token);
 const hasDraft=Object.values(lines).some(row=>row.complete||row.own!=='0'||row.loose!=='0')||Object.values(extras).some(Boolean);
 const changed=baselineOwner.current!==scopeKey||(hasDraft&&acceptedToken!==opening.opening.token)||opening.rows.some(row=>!!lines[row.lineId]?.complete&&accepted['line:'+row.lineId]!==undefined&&accepted['line:'+row.lineId]!==row.unit.measureId)||opening.availableStockOnly.some(row=>!!extras[row.itemId]&&accepted['extra:'+row.itemId]!==undefined&&accepted['extra:'+row.itemId]!==row.unit.measureId);
 const expected=selected.slice().sort().join('\0'),returned=opening.availableStockOnly.map(row=>row.itemId).sort().join('\0');
 const close=async()=>{if(busy||sending.current)return;const owner=scopeKey,closingLocked=locked;const question=locked?'닫아도 예약과 요청은 남습니다. 생산 요청 확인에서 계속할 수 있습니다. 닫으시겠습니까?':hasDraft?'입력 중인 생산 수량을 버리고 닫습니까?':'';if(question&&!await appConfirm(question))return;if(mounted.current&&current.current.scopeKey===owner&&!current.current.busy&&current.current.locked===closingLocked)onCancel()};
 const update=(id:string,key:keyof PartialDraft,value:string)=>{const row=opening.rows.find(candidate=>candidate.lineId===id);if(row)setAccepted(old=>old['line:'+id]===undefined?{...old,['line:'+id]:row.unit.measureId}:old);setLines(old=>({...old,[id]:{...(old[id]??{complete:'',own:'0',loose:'0'}),[key]:value}}))};
 const choose=(next:string[])=>{if(busy||locked)return;setSelected(next);partial.onSelectionChange(next)};
 const submit=async()=>{if(busy||locked||sending.current||opening.activeRequest)return;sending.current=true;setMessage('');try{if(expected!==returned)throw Error('선택한 추가 재고 품목을 서버에서 다시 확인해 주세요.');if(changed)throw Error('변경된 단위를 확인해 주세요.');const choices:CompletionChoice[]=[];for(const row of opening.rows){const d=lines[row.lineId];if(!d?.complete.trim())continue;if(!d.own.trim()||(row.unit.loose&&!d.loose.trim()))throw Error('기존 재고 사용 수량을 입력하세요.');const value=Number(d.complete),own=Number(d.own),loose=Number(d.loose);if(row.unit.order.kind==='box-count'&&!Number.isSafeInteger(value))throw Error('박스 수량은 정수로 입력하세요.');if(row.unit.order.kind==='item-quantity')assertQuantityForKind(row.unit.stock.quantityKind,value);const completeMilli=toQuantityMilli(value),beforeMilli=toQuantityMilli(row.completedQty),orderedMilli=toQuantityMilli(row.orderedQty);assertQuantityForKind(row.unit.stock.quantityKind,own);if(row.unit.loose)assertQuantityForKind(row.unit.loose.quantityKind,loose);if(completeMilli<=0||beforeMilli+completeMilli>orderedMilli)throw Error('이번 완료 수량은 남은 주문 수량 이하여야 합니다.');const choice:CompletionChoice={lineId:row.lineId,complete:{value,kind:row.unit.order.kind,measureId:row.unit.measureId},stockUse:{own:{itemId:row.unit.stock.itemId,value:own,measureId:row.unit.measureId},...(row.unit.loose?{loose:{itemId:row.unit.loose.itemId,value:loose,measureId:row.unit.measureId}}:{})}};assertCompletionChoiceMatchesUnit(row.unit,choice);choices.push(choice)}const stockOnly:StockOnlyChoice[]=opening.availableStockOnly.map(row=>{const raw=extras[row.itemId];if(!raw?.trim())throw Error('선택한 추가 재고 품목의 생산 수량을 입력하세요.');const value=Number(raw);assertQuantityForKind(row.unit.stock.quantityKind,value);if(toQuantityMilli(value)<=0)throw Error('추가 생산 수량은 0보다 커야 합니다.');return{itemId:row.itemId,quantity:{value,kind:'item-stock',measureId:row.unit.measureId}}});if(!choices.length&&!stockOnly.length)throw Error('이번에 완료하거나 추가 생산할 수량을 입력하세요.');await partial.onSubmit(choices,stockOnly)}catch(e){setMessage(e instanceof Error&&e.message!=='invalid-input'?e.message:'수량과 단위를 확인해 주세요. 개수는 정수, 중량은 소수점 셋째 자리까지 입력할 수 있습니다.')}finally{sending.current=false}};
 const apply=async()=>{if(busy||changed||sending.current||!preview||!partial.result?.canApply||!partial.onApply)return;sending.current=true;try{await partial.onApply()}catch(error){if(mounted.current)setMessage(error instanceof Error?error.message:'서버 결과를 확인해 주세요.')}finally{sending.current=false}};
 if(baselineOwner.current!==scopeKey)return null;
 return <ModalShell title="이번 생산 완료" onClose={()=>void close()} footer={<div className="flex justify-end gap-2"><button type="button" disabled={busy} className="rounded-lg bg-slate-100 px-4 py-2" onClick={()=>void close()}>취소</button>{preview&&partial.result?.canApply&&partial.onApply?<button type="button" disabled={busy||changed} className="rounded-lg bg-indigo-600 px-4 py-2 text-white" onClick={()=>void apply()}>확인한 내용 적용</button>:<button type="button" disabled={busy||requestLocked||changed||expected!==returned||!!opening.activeRequest||!opening.allowedActions.includes('complete-partial')} className="rounded-lg bg-indigo-600 px-4 py-2 text-white" onClick={()=>void submit()}>완료 내용 확인</button>}</div>}><div className="space-y-3 text-sm"><p>이번 완료는 기존 재고 사용량과 이번 생산량을 합한 수량입니다. 주문 수량과 완료 누계는 같은 단위입니다.</p>{preview&&<section className="space-y-2 rounded-lg border border-slate-200 p-3" aria-label="서버에서 확인한 생산 내용"><h4 className="font-bold">서버에서 확인한 생산 내용</h4>{preview.customerRows.map(row=><div key={row.lineId}><p>{catalog.find(item=>item.id===row.itemId)?.name??'품목 정보 확인 필요'} · 이번 완료 {row.completeNow} {row.unit.order.label} · 완료 누계 {row.completedAfter} {row.unit.order.label}</p><p>기존 재고 사용 {row.ownUsed} {row.unit.stock.label}{row.looseUsed>0&&row.unit.loose?` · 기존 낱개 사용 ${row.looseUsed} ${row.unit.loose.label}`:''}</p><p>이번 생산 {row.producedUnits.length?row.producedUnits.map(produced=>`${catalog.find(item=>item.id===produced.itemId)?.name??'품목 정보 확인 필요'} ${produced.qty} ${produced.itemId===row.unit.stock.itemId?row.unit.stock.label:row.unit.loose&&produced.itemId===row.unit.loose.itemId?row.unit.loose.label:''}`.trim()).join(', '):'없음'}</p></div>)}{preview.stockOnlyRows.map(row=><p key={row.itemId}>추가 재고 생산 {catalog.find(item=>item.id===row.itemId)?.name??'품목 정보 확인 필요'} {row.quantity} {row.unit.stock.label} · 고객 청구 제외</p>)}</section>}{expected!==returned&&!busy&&!locked&&<button type="button" className="rounded-lg border px-3 py-2" onClick={()=>partial.onSelectionChange(selected)}>선택 품목 다시 확인</button>}{!opening.allowedActions.includes('complete-partial')&&!opening.activeRequest&&<p role="alert">현재 이 주문에서는 부분 생산을 진행할 수 없습니다.</p>}{opening.activeRequest&&<p role="alert">이 주문에 확인이 필요한 이전 작업이 있습니다. 먼저 처리 결과를 확인해 주세요.{partial.onRecoverActive&&<button type="button" onClick={partial.onRecoverActive} className="ml-2 underline">이전 작업 확인</button>}</p>}{(message||partial.error)&&<p role="alert">{message||partial.error}</p>}{changed&&<div role="alert">주문 내용이나 품목 단위가 바뀌었습니다. 기존 입력과 변경 내용을 확인해 주세요. <button type="button" disabled={busy||locked||baselineOwner.current!==scopeKey} onClick={()=>{setAccepted(measures());setAcceptedToken(opening.opening.token)}}>변경 내용 확인</button></div>}{opening.rows.map(row=>{const d=lines[row.lineId]??{complete:'',own:'0',loose:'0'};let after='';try{after=String(fromQuantityMilli(toQuantityMilli(row.completedQty)+toQuantityMilli(Number(d.complete||0))))}catch{}return <section key={row.lineId} className="space-y-2 rounded-lg border border-slate-200 p-3"><h4 className="font-bold">{catalog.find(item=>item.id===row.itemId)?.name??'품목 정보 확인 필요'}</h4><p>주문 {row.orderedQty} {row.unit.order.label} · 완료 누계 {row.completedQty} {row.unit.order.label}{after&&` · 이번 완료 후 ${after} ${row.unit.order.label}`}</p><label className="block">이번 완료 ({row.unit.order.label})<input type="number" min="0" step={row.unit.order.kind==='box-count'||row.unit.stock.quantityKind==='count'?'1':'0.001'} value={d.complete} disabled={busy||locked} onChange={e=>update(row.lineId,'complete',e.target.value)} className="block w-full rounded border p-2"/></label><label className="block">기존 재고 사용 ({row.unit.stock.label})<input type="number" min="0" step={row.unit.stock.quantityKind==='count'?'1':'0.001'} value={d.own} disabled={busy||locked} onChange={e=>update(row.lineId,'own',e.target.value)} className="block w-full rounded border p-2"/></label>{row.unit.loose&&<label className="block">기존 낱개 재고 사용 ({row.unit.loose.label})<input type="number" min="0" step={row.unit.loose.quantityKind==='count'?'1':'0.001'} value={d.loose} disabled={busy||locked} onChange={e=>update(row.lineId,'loose',e.target.value)} className="block w-full rounded border p-2"/></label>}</section>})}<section className="space-y-2 rounded-lg border border-slate-200 p-3"><h4 className="font-bold">추가 재고 생산</h4><p>추가 품목은 이 주문의 고객 청구에 포함되지 않습니다.</p><div className="flex gap-2"><select aria-label="추가 재고 품목" value={picker} disabled={busy||locked} onChange={e=>setPicker(e.target.value)} className="min-w-0 flex-1 rounded border p-2"><option value="">품목 선택</option>{catalog.filter(item=>!selected.includes(item.id)).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select><button type="button" disabled={!picker||busy||locked||selected.length>=20} onClick={()=>{choose([...selected,picker]);setPicker('')}}>선택</button></div>{selected.map(id=>{const row=opening.availableStockOnly.find(item=>item.itemId===id);return <div key={id} className="rounded border p-2"><div className="flex justify-between"><b>{catalog.find(item=>item.id===id)?.name??'품목 정보 확인 필요'}</b><button type="button" disabled={busy||locked} onClick={()=>choose(selected.filter(value=>value!==id))}>제외</button></div>{row?<label>추가 생산 ({row.unit.stock.label})<input type="number" min="0" step={row.unit.stock.quantityKind==='count'?'1':'0.001'} value={extras[id]??''} disabled={busy||locked} onChange={e=>{setAccepted(old=>old['extra:'+id]===undefined?{...old,['extra:'+id]:row.unit.measureId}:old);setExtras(old=>({...old,[id]:e.target.value}))}} className="block w-full rounded border p-2"/></label>:<p>서버에서 단위를 확인 중입니다.</p>}</div>})}</section></div></ModalShell>;
}
const StockUseModal:React.FC<Props> = props => props.partial ? <PartialCompletionPanel partial={props.partial} onCancel={props.onCancel}/> : <LegacyStockUseModal {...props}/>;
export default StockUseModal;
