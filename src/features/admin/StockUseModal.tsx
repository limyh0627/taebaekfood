import React, { useState, useMemo } from 'react';
import ModalShell from '../../shared/components/ModalShell';
import SearchableSelect from '../../shared/components/SearchableSelect';
import { appConfirm } from '../../shared/components/appDialog';
import { toQuantityMilli, fromQuantityMilli, assertQuantityForKind, assertCompletionChoiceMatchesUnit, type BatchOpenResult, type BatchResult, type CompletionChoice, type StockOnlyChoice } from '../../../functions/src/shared/orderProductionBatchContract';
import type { Item, Order } from '../../shared/types';
import { buildProductionDefaults, buildProductionCompletion, buildExtraCandidates, findStockShortages, goodsStockView, parseProductionQuantity, productionLineKind, resolveProductionTargetLineIds, stockShortageNotice, summarizeProductionCompletion, type GoodsCommitted, type ProductionTarget, type ProductionQuantityDraft } from './productionQuantityDraft';
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
interface PartialProps { order:Order; target?:ProductionTarget; scopeKey:string; opening:BatchOpenResult; catalog:Item[]; busy:boolean; requestLocked:boolean; error?:string; onSelectionChange:(ids:string[])=>void; onSubmit:(lines:CompletionChoice[],stockOnly:StockOnlyChoice[])=>Promise<void>; result?:BatchResult|null; onApply?:()=>Promise<void>; onRecoverActive?:()=>void; }
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

/** 다른 주문이 완료해 둔 상품 수량. 생산 창이 현재고에서 뺄 때 쓴다. */
export const GoodsCommittedContext=React.createContext<GoodsCommitted|undefined>(undefined);
type PartialDraft=ProductionQuantityDraft;
const EMPTY_DRAFT:PartialDraft={production:'0',own:'0',loose:'0',productionEdited:false};
const QTY_INPUT='mt-1 block min-h-10 w-full rounded border border-slate-200 bg-white p-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none';
const STEP_BUTTON='h-9 w-9 shrink-0 rounded border border-slate-200 bg-white font-bold text-slate-600 disabled:opacity-40';
/** 다시 조회해도 줄의 수량·단위가 그대로인지 본다. 더 만든 품목을 확인하러 다시 조회한 것만으로는 입력을 다시 묻지 않는다. */
const proofOfRows=(rows:BatchOpenResult['rows'])=>JSON.stringify(rows.map(row=>[row.lineId,row.itemId,row.orderedQty,row.completedQty,row.unit.measureId]));
/**
 * 2026-11-04 사장님: "기본적으로 정보가 들어가 있는 상태에서 달라진 부분만 수정". 처리할 품목만 카드로 두고 값은 미리 채운다.
 * 칸은 실제와 다를 때 여는 `수량 바꾸기` 안에, 다른 품목은 한 줄로, 더 만든 재고는 있을 때만 펼친다.
 */
function PartialCompletionPanel({partial,onCancel}:{partial:PartialProps;onCancel:()=>void}) {
 const committed=React.useContext(GoodsCommittedContext);const {opening,catalog,busy,requestLocked,scopeKey}=partial;const preview=partial.result?.state==='reserved'?partial.result.preview:undefined;const locked=requestLocked||!!preview;
 const baselineOwner=React.useRef(scopeKey);const current=React.useRef({scopeKey,busy,locked});current.current={scopeKey,busy,locked};const mounted=React.useRef(false),sending=React.useRef(false),sawBusy=React.useRef(false);React.useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
 const [initial]=useState(()=>{try{return {lines:buildProductionDefaults({order:partial.order,opening,catalog,target:partial.target}),targetIds:resolveProductionTargetLineIds(partial.order,opening,partial.target),error:''}}catch(e){return {lines:{} as Record<string,PartialDraft>,targetIds:[] as string[],error:e instanceof Error?e.message:'주문 품목을 다시 확인해 주세요.'}}});const [lines,setLines]=useState<Record<string,PartialDraft>>(initial.lines);const [extras,setExtras]=useState<Record<string,string>>({});const [added,setAdded]=useState<string[]>([]);const [openRows,setOpenRows]=useState<string[]>([]);const [included,setIncluded]=useState<string[]>([]);const [extrasToggled,setExtrasToggled]=useState(false);const [pending,setPending]=useState<string[]|null>(null);const [message,setMessage]=useState(initial.error);
 const measures=()=>Object.fromEntries([...opening.rows.map(row=>['line:'+row.lineId,row.unit.measureId]),...opening.availableStockOnly.map(row=>['extra:'+row.itemId,row.unit.measureId])]);
 const [accepted,setAccepted]=useState<Record<string,string>>(measures);const [acceptedToken,setAcceptedToken]=useState(opening.opening.token);const [acceptedRows,setAcceptedRows]=useState(()=>proofOfRows(opening.rows));
 const hasDraft=Object.values(lines).some(row=>row.productionEdited||row.production!=='0'||row.own!=='0'||row.loose!=='0')||Object.values(extras).some(Boolean);
 const edited=JSON.stringify(lines)!==JSON.stringify(initial.lines)||Object.values(extras).some(value=>value.trim());
 const sameRowsAfterReopen=!!pending&&proofOfRows(opening.rows)===acceptedRows;
 const changed=baselineOwner.current!==scopeKey||(hasDraft&&acceptedToken!==opening.opening.token&&!sameRowsAfterReopen)||opening.rows.some(row=>!!lines[row.lineId]?.production&&accepted['line:'+row.lineId]!==undefined&&accepted['line:'+row.lineId]!==row.unit.measureId)||opening.availableStockOnly.some(row=>!!extras[row.itemId]&&accepted['extra:'+row.itemId]!==undefined&&accepted['extra:'+row.itemId]!==row.unit.measureId);
 const returned=opening.availableStockOnly.map(row=>row.itemId).sort(),wanted=Object.entries(extras).filter(([,raw])=>raw.trim()&&Number(raw)!==0).map(([id])=>id).sort();
 const frozen=busy||locked||!!pending;
 const candidates=useMemo(()=>buildExtraCandidates(opening.rows,catalog),[opening.rows,catalog]);
 const extraIds=[...new Set([...candidates.suggested.map(item=>item.id),...added,...returned])],extrasOpen=extrasToggled||returned.length>0||wanted.length>0;
 const workIds=new Set([...initial.targetIds,...included]),shortages=findStockShortages(opening.rows,catalog,workIds,opening.orderId,committed);
 const remainingOf=(row:BatchOpenResult['rows'][number])=>fromQuantityMilli(toQuantityMilli(row.orderedQty)-toQuantityMilli(row.completedQty));
 const kindOf=(itemId:string)=>{const item=catalog.find(candidate=>candidate.id===itemId);return item?productionLineKind(item):'no-stock'};
 const close=async()=>{if(busy||pending||sending.current)return;const owner=scopeKey,closingLocked=locked;const question=locked?'닫아도 예약과 요청은 남습니다. 생산 요청 확인에서 계속할 수 있습니다. 닫으시겠습니까?':edited?'입력한 수량을 버리고 닫습니까?':'';if(question&&!await appConfirm(question))return;if(mounted.current&&current.current.scopeKey===owner&&!current.current.busy&&current.current.locked===closingLocked)onCancel()};
 const update=(id:string,key:'production'|'own'|'loose',value:string)=>{const row=opening.rows.find(candidate=>candidate.lineId===id);if(!row)return;setAccepted(old=>old['line:'+id]===undefined?{...old,['line:'+id]:row.unit.measureId}:old);setLines(old=>{const d={...(old[id]??EMPTY_DRAFT),[key]:value};if(key==='production')d.productionEdited=true;if(key==='own'&&!d.productionEdited){try{const own=parseProductionQuantity(value,row.unit.stock.quantityKind,'재고 사용량')??0;{const remaining=(toQuantityMilli(row.orderedQty)-toQuantityMilli(row.completedQty))*row.unit.stock.unitsPerOrderUnit-toQuantityMilli(own);if(Number.isSafeInteger(remaining)&&remaining>=0)d.production=String(fromQuantityMilli(remaining))}}catch{}}return {...old,[id]:d}})};
 const includeLine=(id:string)=>{if(frozen)return;const next=buildProductionDefaults({order:partial.order,opening,catalog,lineIds:[...workIds,id]});setIncluded(old=>[...old,id]);setLines(old=>({...old,[id]:next[id]??EMPTY_DRAFT}))};
 const stepExtra=(id:string,by:number)=>setExtras(old=>{const value=Number(old[id]||0),next=Math.max(0,(Number.isFinite(value)?value:0)+by);return {...old,[id]:next?String(next):''}});
 const failed=(e:unknown)=>setMessage(e instanceof Error&&e.message!=='invalid-input'?e.message:'수량과 단위를 확인해 주세요. 개수는 정수, 중량은 소수점 셋째 자리까지 입력할 수 있습니다.');
 const readChoices=()=>{const choices:CompletionChoice[]=[];for(const row of opening.rows){const {choice}=buildProductionCompletion(row,lines[row.lineId]??EMPTY_DRAFT);if(choice)choices.push(choice)}return choices};
 const send=async()=>{if(busy||locked||sending.current||opening.activeRequest)return;sending.current=true;setMessage('');try{if(changed)throw Error('변경된 단위를 확인해 주세요.');const stockOnly:StockOnlyChoice[]=opening.availableStockOnly.map(row=>{const value=parseProductionQuantity(extras[row.itemId]??'',row.unit.stock.quantityKind,'더 만든 수량')??0;if(toQuantityMilli(value)<=0)throw Error('더 만든 수량은 0보다 커야 합니다.');return{itemId:row.itemId,quantity:{value,kind:'item-stock',measureId:row.unit.measureId}}});await partial.onSubmit(readChoices(),stockOnly)}catch(e){failed(e)}finally{sending.current=false}};
 // 더 만든 품목은 칸을 채우는 동안 서버에 묻지 않는다. 품목이 달라졌을 때만 완료를 누른 순간 한 번 다시 조회하고, 응답이 오면 이어서 보낸다.
 const submit=()=>{if(frozen||sending.current||opening.activeRequest)return;setMessage('');try{if(initial.error)throw Error(initial.error);if(changed)throw Error('변경된 단위를 확인해 주세요.');const short=Object.values(shortages);if(short.length){void appNotice(stockShortageNotice(short),'재고부족');return}const choices=readChoices();for(const id of wanted)parseProductionQuantity(extras[id],opening.availableStockOnly.find(row=>row.itemId===id)?.unit.stock.quantityKind??'count','더 만든 수량');if(wanted.length>20)throw Error('더 만든 품목은 한 번에 20개까지 처리할 수 있습니다.');if(!choices.length&&!wanted.length)throw Error('이번에 끝내거나 더 만든 수량을 입력하세요.');if(wanted.join('\0')===returned.join('\0')){void send();return}sawBusy.current=false;setPending(wanted);partial.onSelectionChange(wanted)}catch(e){failed(e)}};
 React.useEffect(()=>{if(!pending)return;if(busy){sawBusy.current=true;return}const arrived=returned.join('\0')===pending.join('\0');if(!arrived&&!sawBusy.current)return;setPending(null);if(!arrived){if(!partial.error)setMessage('더 만든 품목을 확인하지 못했습니다. 다시 눌러 주세요.');return}if(!sameRowsAfterReopen)return;setAcceptedToken(opening.opening.token);void send()},[pending,busy,opening]);// eslint-disable-line react-hooks/exhaustive-deps -- 대기 중에는 입력이 잠겨 있어 이 셋이 바뀔 때만 다시 보면 된다
 const apply=async()=>{if(busy||changed||sending.current||!preview||!partial.result?.canApply||!partial.onApply)return;sending.current=true;try{await partial.onApply()}catch(error){if(mounted.current)setMessage(error instanceof Error?error.message:'서버 결과를 확인해 주세요.')}finally{sending.current=false}};
 if(baselineOwner.current!==scopeKey)return null;
 const nameOf=(id:string)=>catalog.find(item=>item.id===id)?.name??'품목 정보 확인 필요';
 const workRows=opening.rows.filter(row=>workIds.has(row.lineId)&&remainingOf(row)>0),restRows=opening.rows.filter(row=>!workRows.includes(row));
 return <ModalShell title="생산 처리" onClose={()=>void close()} footer={<div className="grid w-full grid-cols-2 gap-2"><button type="button" disabled={busy||!!pending} className="min-h-12 rounded-lg bg-slate-100 px-4 py-2 font-bold text-slate-600" onClick={()=>void close()}>취소</button>{preview&&partial.result?.canApply&&partial.onApply?<button type="button" disabled={busy||changed} className="min-h-12 rounded-lg bg-indigo-600 px-4 py-2 font-bold text-white" onClick={()=>void apply()}>확인한 내용 적용</button>:<button type="button" disabled={busy||!!pending||requestLocked||!!initial.error||changed||!!opening.activeRequest||!opening.allowedActions.includes('complete-partial')} className="min-h-12 rounded-lg bg-indigo-600 px-4 py-2 font-bold text-white" onClick={submit}>완료 내용 확인</button>}</div>}><div className="space-y-3 text-sm">
  <p className="text-slate-600">주문 수량이 미리 채워져 있습니다. 달라진 것만 고치고 완료를 누르세요.</p>
  {preview&&<section className="space-y-2 rounded-lg border border-slate-200 p-3" aria-label="이대로 처리됩니다"><h4 className="font-bold">이대로 처리됩니다</h4>{preview.customerRows.map(row=><div key={row.lineId}><p>{nameOf(row.itemId)} · 이번에 끝냄 {row.completeNow} {row.unit.order.label} · 끝낸 합계 {row.completedAfter} {row.unit.order.label}</p>{kindOf(row.itemId)==='stock-only'?<p>재고에서 {fromQuantityMilli(toQuantityMilli(row.completeNow)*row.unit.stock.unitsPerOrderUnit)} {row.unit.stock.label} (출고 때 차감) · 새로 만들지 않음</p>:<><p>있던 재고에서 {row.ownUsed} {row.unit.stock.label}{row.looseUsed>0&&row.unit.loose?` · 있던 낱개에서 ${row.looseUsed} ${row.unit.loose.label}`:''}</p><p>새로 만듦 {row.producedUnits.length?row.producedUnits.map(produced=>`${nameOf(produced.itemId)} ${produced.qty} ${produced.itemId===row.unit.stock.itemId?row.unit.stock.label:row.unit.loose&&produced.itemId===row.unit.loose.itemId?row.unit.loose.label:''}`.trim()).join(', '):'없음'}</p></>}</div>)}{preview.stockOnlyRows.map(row=><p key={row.itemId}>더 만들어 재고로 {nameOf(row.itemId)} {row.quantity} {row.unit.stock.label} · 거래처 청구 안 됨</p>)}</section>}
  {!opening.allowedActions.includes('complete-partial')&&!opening.activeRequest&&<p role="alert">현재 이 주문에서는 부분 생산을 진행할 수 없습니다.</p>}
  {opening.activeRequest&&<p role="alert">이 주문에 확인이 필요한 이전 작업이 있습니다. 먼저 처리 결과를 확인해 주세요.{partial.onRecoverActive&&<button type="button" onClick={partial.onRecoverActive} className="ml-2 underline">이전 작업 확인</button>}</p>}
  {(message||partial.error)&&<p role="alert">{message||partial.error}</p>}
  {pending&&<p role="status">더 만든 품목을 확인하고 있습니다.</p>}
  {changed&&<div role="alert">주문 내용이나 품목 단위가 바뀌었습니다. 기존 입력과 변경 내용을 확인해 주세요. <button type="button" disabled={frozen||baselineOwner.current!==scopeKey} onClick={()=>{setAccepted(measures());setAcceptedToken(opening.opening.token);setAcceptedRows(proofOfRows(opening.rows))}}>변경 내용 확인</button></div>}
  {workRows.map(row=>{const d=lines[row.lineId]??EMPTY_DRAFT,item=catalog.find(candidate=>candidate.id===row.itemId),kind=kindOf(row.itemId),view=kind==='stock-only'&&item?goodsStockView(row,item,opening.orderId,committed):undefined,unit=row.unit.order.label,stockUnit=row.unit.stock.label,short=shortages[row.lineId];
   let totals:ReturnType<typeof buildProductionCompletion>|undefined,summary='수량을 확인해 주세요. 남은 수량을 넘었거나 숫자가 아닙니다.';try{totals=buildProductionCompletion(row,d);summary=summarizeProductionCompletion(row,d,kind)}catch{/* 잘못된 수량은 위 안내 문구로 보여 주고 칸을 펼친다 */}
   const left=totals&&totals.completeNow>0?fromQuantityMilli(toQuantityMilli(row.orderedQty)-toQuantityMilli(totals.completedAfter)):0,open=kind==='made'&&(openRows.includes(row.lineId)||!totals);
   return <section key={row.lineId} className="space-y-1.5 rounded-lg border border-slate-200 bg-white p-3"><div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><h4 className="min-w-0 break-words font-bold">{nameOf(row.itemId)}</h4>{kind==='made'&&!locked&&totals&&<button type="button" aria-expanded={open} className="shrink-0 text-xs font-bold text-indigo-600 underline" onClick={()=>setOpenRows(old=>open?old.filter(id=>id!==row.lineId):[...old,row.lineId])}>{open?'접기':'수량 바꾸기'}</button>}</div>
    <p className="text-xs text-slate-500">주문 {row.orderedQty} {unit}{row.completedQty>0?` · 앞서 ${row.completedQty} ${unit} 끝남`:''}</p>
    {view?<p className="font-bold">현재고 {view.stock} {stockUnit}{view.others>0?` · 다른 주문 완료분 ${view.others} ${stockUnit}`:''} · 이번 주문 {view.need} {stockUnit}{short?'':` · 차감 후 ${view.after} ${stockUnit}`}</p>:<p className="font-bold">{summary}</p>}
    {short&&<p className="font-bold text-rose-600">재고가 부족해서 완료할 수 없습니다</p>}
    {!short&&left>0&&<p className="text-xs text-slate-500">처리 후 {left} {unit} 남습니다.</p>}
    {open&&<div className="space-y-2 rounded-lg bg-slate-50 p-2">
     <p className="text-xs text-slate-500">실제와 다를 때만 고치세요. 두 칸을 더한 만큼 이번에 끝납니다.</p>
     <div className="grid gap-2 sm:grid-cols-2"><label className="block text-xs font-bold leading-5 text-slate-500">있던 재고에서 쓴 수량 ({stockUnit})<input type="number" min="0" step={row.unit.stock.quantityKind==='count'?'1':'0.001'} value={d.own} disabled={frozen} onChange={e=>update(row.lineId,'own',e.target.value)} className={QTY_INPUT}/></label>
     <label className="block text-xs font-bold leading-5 text-slate-500">새로 만든 수량 ({stockUnit})<input type="number" min="0" step={row.unit.stock.quantityKind==='count'?'1':'0.001'} value={d.production} disabled={frozen} onChange={e=>update(row.lineId,'production',e.target.value)} className={QTY_INPUT}/></label></div>
     {row.unit.loose&&<label className="block text-xs font-bold leading-5 text-slate-500">있던 낱개에서 쓴 수량 ({row.unit.loose.label})<input type="number" min="0" step={row.unit.loose.quantityKind==='count'?'1':'0.001'} value={d.loose} disabled={frozen} onChange={e=>update(row.lineId,'loose',e.target.value)} className={QTY_INPUT}/></label>}
    </div>}
   </section>})}
  {restRows.length>0&&<ul aria-label="이 주문의 다른 품목" className="space-y-1 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">{restRows.map(row=>{const remaining=remainingOf(row),unit=row.unit.order.label;return <li key={row.lineId} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1"><span className="min-w-0 break-words">{nameOf(row.itemId)} · {remaining>0?`남은 ${remaining} ${unit}`:`주문 ${row.orderedQty} ${unit} 모두 끝남`}</span>{remaining>0&&!frozen&&<button type="button" aria-label={`${nameOf(row.itemId)} 같이 처리`} className="shrink-0 font-bold text-indigo-600 underline" onClick={()=>includeLine(row.lineId)}>같이 처리</button>}</li>})}</ul>}
  {!extrasOpen&&!locked&&<button type="button" disabled={frozen} className="w-full rounded-lg border border-dashed border-slate-300 p-3 text-left text-sm font-bold text-slate-600" onClick={()=>setExtrasToggled(true)}>더 만든 재고가 있으면 적기</button>}
  {extrasOpen&&<section className="space-y-2 rounded-lg border border-slate-200 p-3" aria-label="더 만든 재고"><h4 className="font-bold">더 만든 재고</h4><p className="text-xs text-slate-500">주문보다 더 만들어 재고로 넣은 수량만 적으세요. 거래처 청구에는 들어가지 않습니다.</p>
   {extraIds.map(id=>{const server=opening.availableStockOnly.find(row=>row.itemId===id),name=catalog.find(item=>item.id===id)?.name??server?.name??'품목 정보 확인 필요',unit=server?.unit.stock.label??catalog.find(item=>item.id===id)?.unit??'';return <div key={id} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2"><p className="min-w-0 flex-1 basis-40 break-words font-bold text-slate-700">{name}{opening.rows.some(row=>row.itemId===id)&&<span className="ml-1 text-xs font-normal text-slate-400">주문과 같은 품목</span>}</p><div className="flex shrink-0 items-center gap-1"><button type="button" aria-label={`${name} 1 줄이기`} disabled={frozen||!Number(extras[id])} className={STEP_BUTTON} onClick={()=>stepExtra(id,-1)}>-</button><input type="number" min="0" step={server?.unit.stock.quantityKind==='bulk'?'0.001':'1'} placeholder="0" aria-label={`${name} 더 만든 수량 (${unit})`} value={extras[id]??''} disabled={frozen} onChange={e=>setExtras(old=>({...old,[id]:e.target.value}))} className="h-9 w-16 rounded border border-slate-200 bg-white px-2 text-right text-sm text-slate-900 focus:border-indigo-400 focus:outline-none"/><span className="w-6 text-xs font-bold text-slate-500">{unit}</span><button type="button" aria-label={`${name} 1 늘리기`} disabled={frozen} className={STEP_BUTTON} onClick={()=>stepExtra(id,1)}>+</button></div></div>})}
   <SearchableSelect ariaLabel="다른 품목 찾기" value="" searchThreshold={0} disabled={frozen} className="h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400" options={[{value:'',label:'다른 품목 찾기 (초성 검색)'},...candidates.all.filter(item=>!extraIds.includes(item.id)).map(item=>({value:item.id,label:item.name}))]} onChange={id=>{if(id)setAdded(old=>[...old,id])}}/>
  </section>}
 </div></ModalShell>;
}
const StockUseModal:React.FC<Props> = props => props.partial ? <PartialCompletionPanel partial={props.partial} onCancel={props.onCancel}/> : <LegacyStockUseModal {...props}/>;
export default StockUseModal;
