import React, { useMemo, useRef, useState } from 'react';
import { today as todayStr } from '../src/shared/day';
import { Sparkles } from 'lucide-react';
import { RawMaterialEntry, RawMaterialLot } from '../types';
import { unitOf, DENSITY } from '../src/constants/formula';
import ModalShell from '../src/shared/components/ModalShell';
import type { CompanyId } from '../src/shared/types';
import { listRawPressAttempts, assertRawPressAttempt, deleteRawPressAttempt, rawPressYieldKg, type RawPressRetained } from '../src/shared/rawPressAttempt';

export type RawEntrySubmitResult=boolean|void|{ok:false;canEditRetry?:boolean;reason?:string;relatedRetained?:RawPressRetained};
interface Props {
  open: boolean;
  mode: 'inbound' | 'usage';
  materials: string[];               // 선택 가능한 원료 목록 (RM_LIST)
  defaultMaterial?: string;          // 현재 활성 원료 (있으면 기본값)
  currentUserName?: string;
  lotsForMaterial?: (material: string) => RawMaterialLot[];
  onClose: () => void;
  onSubmit: (entry: RawMaterialEntry,intent?:'new'|'resume',retained?:RawPressRetained) => RawEntrySubmitResult | Promise<RawEntrySubmitResult>;
  companyId?: CompanyId;
  actorUid?: string;
  getActorUid?: () => string | undefined;
  rawYieldRules?: Record<string, { product: string; rate: number }>;
}

// 사용 시 수율 자동 입고 매핑 (AdminApp.onAddRawMaterialEntry와 동일 — 안내용)
const RawMaterialEntryModal: React.FC<Props> = ({
  ...props
}) => <RawEntrySession key={JSON.stringify([props.open,props.mode,props.companyId,props.actorUid])} {...props}/>;

function RawEntrySession({
  open, mode, materials, defaultMaterial, currentUserName, lotsForMaterial, onClose, onSubmit,
  companyId='taebaek', actorUid, getActorUid, rawYieldRules={},
}:Props) {
  const [notice,setNotice]=useState('');
  const [recoveryOpen,setRecoveryOpen]=useState(false);
  const [selected,setSelected]=useState<RawPressRetained|null>(null);
  const [,refresh]=useState(0);
  const busyRef=useRef(false),alive=useRef(true);
  React.useLayoutEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  React.useEffect(()=>{const changed=()=>refresh(v=>v+1);window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed);},[]);
  const sameScope=()=>alive.current&&(!getActorUid||getActorUid()===actorUid);
  const close=()=>{if(!busyRef.current&&sameScope())onClose();};
  const [date,setDate]=useState(todayStr());
  const [material,setMaterial]=useState(defaultMaterial??materials[0]??'');
  const [amount,setAmount]=useState('');
  const [note,setNote]=useState('');
  const [submitting,setSubmitting]=useState(false);
  const [targetLotId,setTargetLotId]=useState(()=>lotsForMaterial?.(defaultMaterial??materials[0]??'').find(lot=>lot.status!=='depleted')?.id??'');
  const entries=mode==='usage'&&actorUid?listRawPressAttempts(companyId,actorUid):[];
  const showFailure=(id:string,message:string,relatedRetained?:RawPressRetained)=>{
    if(!sameScope())return;
    setNotice(message);refresh(v=>v+1);
    const fresh=actorUid?listRawPressAttempts(companyId,actorUid):[];
    const own=fresh.find(e=>e.retained?.request.entry.id===id);
    const related=relatedRetained?.request.companyId===companyId&&relatedRetained.request.actorUid===actorUid?fresh.find(row=>row.retained?.storageKey===relatedRetained.storageKey&&row.retained?.encoded===relatedRetained.encoded):undefined;
    const selectedEntry=own??related;
    if(selectedEntry||fresh.some(row=>!row.retained)){setSelected(selectedEntry?.retained??null);setRecoveryOpen(true);}
  };
  const resume=async()=>{
    if(!selected||busyRef.current||!sameScope())return;
    busyRef.current=true;setSubmitting(true);
    try{assertRawPressAttempt(selected);const saved=await onSubmit(selected.request.entry,'resume',selected);if(!sameScope())return;
      if(saved===false||typeof saved==='object'&&saved.ok===false)setNotice(typeof saved==='object'?saved.reason??'처리 결과를 확인하지 못했습니다.':'처리 결과를 확인하지 못했습니다.');
      else {setSelected(null);refresh(v=>v+1);setNotice('최초 요청의 처리 결과를 확인했습니다.');}
    }catch(error){if(sameScope())setNotice(error instanceof Error?error.message:String(error));}
    finally{if(sameScope()){busyRef.current=false;setSubmitting(false);}}
  };
  const remove=async()=>{
    if(!selected||busyRef.current||!sameScope())return;busyRef.current=true;setSubmitting(true);
    try{await deleteRawPressAttempt(selected,sameScope);if(sameScope()){setSelected(null);setNotice('');refresh(v=>v+1);}}
    catch(error){if(sameScope())setNotice(error instanceof Error?error.message:String(error));}
    finally{if(sameScope()){busyRef.current=false;setSubmitting(false);}}
  };
  const activeLots = useMemo(() => (lotsForMaterial?.(material) ?? []).filter(lot => lot.status !== 'depleted'), [lotsForMaterial, material]);

  // 선택된 원료의 운영 단위 (kg / L)
  const unit = unitOf(material);

  const yieldHint = useMemo(() => {
    if (mode !== 'usage') return null;
    const m = rawYieldRules[material];
    if (!m) return null;
    const productUnit = 'kg';
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return { product: m.product, rate: m.rate, derived: null, productUnit };
    const sourceKg=unit==='L'?Math.round(amt*(DENSITY[material]??1)*1000)/1000:amt;
    return { product: m.product, rate: m.rate, derived: rawPressYieldKg(sourceKg,m.rate), productUnit };
  }, [mode, material, amount, rawYieldRules]);

  if (!open) return null;

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if(busyRef.current||!sameScope())return;
    const amt=parseFloat(amount);
    if(!material){alert('원료를 선택해주세요.');return;}
    if(!Number.isFinite(amt)||amt<=0){alert(`양(${unit})을 0보다 큰 값으로 입력해주세요.`);return;}
    if(mode==='usage'&&!targetLotId){alert('사용할 활성 로트가 없습니다. 로트를 먼저 입고해주세요.');return;}
    busyRef.current=true;
    setSubmitting(true);
    let submittedId='';
    try {
      const id = `${mode==='inbound'?'rm-in':'rm-use'}-${crypto.randomUUID()}`;
      // L 입력은 저장 시 kg으로 환산. 비고에 원본 입력값 자동 추가
      const density = DENSITY[material] ?? 1.0;
      const amtKg = unit === 'L' ? Math.round(amt * density * 1000) / 1000 : amt;
      const inputTag = unit === 'L' ? ` · 사용자 입력: ${amt}L` : '';
      const finalNote = (note.trim() + inputTag).trim();
      const createdAt=new Date().toISOString();
      const entry:RawMaterialEntry={
        id,
        companyId,
        material,
        date,
        received: mode === 'inbound' ? amtKg : 0,
        used:     mode === 'usage'   ? amtKg : 0,
        note: finalNote,
        createdAt,
        effectiveAt: date===todayStr()?createdAt:`${date}T12:00:00+09:00`,
        type: 'manual' as const,
        addedBy: currentUserName,
        unit: 'kg',          // canonical
        originalAmount: amt, // 사용자 원본 값
        originalUnit: unit,  // 'kg' or 'L'
        ...(mode === 'usage' && targetLotId ? { targetLotId } : {}),
      };
      submittedId=entry.id;
      const saved = await onSubmit(entry,'new');
      if(!sameScope())return;
      if (saved === false || typeof saved==='object'&&saved.ok===false) {
        showFailure(entry.id,typeof saved==='object'&&saved.reason?saved.reason:'저장 결과를 확인하지 못했습니다. 최초 요청을 확인해주세요.',typeof saved==='object'?saved.relatedRetained:undefined);return;
      }
      onClose();
    } catch (err) {
      // 저장 실패를 조용히 묻지 않음 — 예전엔 throw 시 모달이 안 닫히고 멈춘 듯 보였다(모바일).
      if(sameScope())showFailure(submittedId,err instanceof Error?err.message:'저장 결과를 확인하지 못했습니다. 최초 요청을 확인해주세요.');
    } finally {
      if(sameScope()){busyRef.current=false;setSubmitting(false);}
    }
  };

  const isInbound = mode === 'inbound';
  const accent = isInbound
    ? { bg: 'bg-emerald-600', hover: 'hover:bg-emerald-700', tint: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' }
    : { bg: 'bg-rose-500',    hover: 'hover:bg-rose-600',    tint: 'bg-rose-50',    text: 'text-rose-700',    border: 'border-rose-200' };

  return (
    <>
    {mode==='usage'&&<button type="button" className="rounded-lg border border-slate-300 bg-white px-3 py-2" onClick={()=>{setSelected(null);setNotice('');setRecoveryOpen(true);}}>착유 실패 작업 {entries.filter(e=>!e.deleted).length}</button>}
    {recoveryOpen&&<ModalShell title={selected?'착유 실패 작업 상세':'착유 실패 작업 목록'} layer={1400} onClose={()=>{if(!busyRef.current){if(selected)setSelected(null);else setRecoveryOpen(false);}}}>
      {notice&&<p role="alert">{notice}</p>}
      {!selected?<><p>최초 요청을 선택해 처리 결과를 확인해주세요.</p>{!entries.some(e=>!e.deleted)&&<p>실패 작업이 없습니다.</p>}{entries.filter(e=>!e.deleted).map(e=><button type="button" key={e.key} className="block w-full border-b border-slate-200 py-3 text-left" onClick={()=>{setSelected(e.retained);setNotice(e.error);}}>{e.retained?`${e.retained.request.entry.material} · ${e.retained.request.entry.date} · ${e.retained.request.entry.used}kg · 처리 결과 미확인`:e.error}</button>)}</>:<div className="space-y-3">
        <p>{selected.request.entry.material} · {selected.request.entry.date} · {selected.request.entry.used}kg</p><p>이전 착유 결과를 아직 확인하지 못했습니다. 최초 사용 로트와 파생 입고 내역, 실제 재고를 확인해주세요.</p>
        <p>{selected.request.yieldRule.product} · {selected.request.derivedCommand.kg}kg</p>
        <div className="flex gap-2"><button type="button" disabled={submitting} className="rounded-lg border border-slate-300 bg-white px-3 py-2" onClick={()=>void resume()}>{selected.state==='submitted'?'처리 결과 확인':'같은 내용 다시 시도'}</button><button type="button" disabled={submitting} className="rounded-lg border border-slate-300 bg-white px-3 py-2" onClick={()=>void remove()}>실패 요청 삭제</button></div>
        <p>실패 목록에서 요청을 삭제합니다. 실제 원료·입고·재고는 바뀌지 않습니다. 관련 품목의 이전 처리 결과는 확인해야 합니다.</p>
      </div>}
    </ModalShell>}
    <div hidden={recoveryOpen}><ModalShell title={isInbound ? '원료 입고 기록' : '원료 사용 기록'} onClose={close} bodyClassName="!p-0">
      <form onSubmit={handleSubmit}>
        {notice&&<p role="alert" className="px-5 pt-3 text-xs text-amber-800">{notice}</p>}
        <fieldset disabled={submitting}>
        <div className="px-5 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-black text-slate-500 mb-1.5">날짜</label>
              <input
                aria-label="날짜"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-slate-400"
              />
            </div>
            <div>
              <label className="block text-[11px] font-black text-slate-500 mb-1.5">원료</label>
              <select
                aria-label="원료"
                value={material}
                onChange={(e) => {
                  const next = e.target.value;
                  setMaterial(next);
                  setTargetLotId(lotsForMaterial?.(next).find(lot => lot.status !== 'depleted')?.id ?? '');
                }}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-slate-400 bg-white"
              >
                {materials.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>

          {!isInbound && activeLots.length > 0 && (
            <div>
              <label className="mb-1.5 block text-[11px] font-black text-slate-500">사용 로트</label>
              <select aria-label="사용 로트" value={targetLotId} onChange={event => setTargetLotId(event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-slate-400">
                {activeLots.map((lot, index) => (
                  <option key={lot.id} value={lot.id}>
                    {index === 0 ? '사용 중 · ' : ''}{lot.lotNo || lot.supplierName || lot.id} · {Math.round(Number(lot.kgRemaining ?? 0) * 1000) / 1000}kg
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[10px] font-bold text-slate-400">기본은 현재 FIFO 1순위 로트입니다. 다른 로트를 선택하면 그 로트에서만 차감합니다.</p>
            </div>
          )}
          {!isInbound && activeLots.length === 0 && (
            <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[11px] font-bold text-rose-700">
              사용할 활성 로트가 없습니다. 로트를 먼저 입고해주세요.
            </p>
          )}

          <div>
            <label className="block text-[11px] font-black text-slate-500 mb-1.5">
              {isInbound ? '입고량' : '사용량'} ({unit})
            </label>
            <div className="relative">
              <input
                aria-label={isInbound?'입고량':'사용량'}
                type="number"
                min="0"
                step="0.001"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                autoFocus
                className="w-full border border-slate-200 rounded-xl px-3 py-2 pr-12 text-sm font-black text-slate-800 outline-none focus:border-slate-400"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-black text-slate-400">{unit}</span>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-black text-slate-500 mb-1.5">비고 (선택)</label>
            <input
              aria-label="비고"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={isInbound ? '예: 거래처/로트 번호 등' : '예: 착유 로트, 작업자 등'}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-slate-400"
            />
          </div>

          {yieldHint && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-sky-50 border border-sky-100">
              <Sparkles size={13} className="text-sky-500 mt-0.5 shrink-0" />
              <p className="text-[11px] font-bold text-sky-700 leading-relaxed">
                저장하면 <span className="font-black">{yieldHint.product}</span> 가
                {yieldHint.derived !== null ? <> <span className="font-black">{yieldHint.derived}{yieldHint.productUnit}</span> </> : ' '}
                자동 입고됩니다 (수율 {Math.round(yieldHint.rate * 100)}%).
              </p>
            </div>
          )}
        </div>

        </fieldset><div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2 bg-slate-50/60">
          <button
            type="button"
            onClick={close}
            disabled={submitting}
            className="px-4 py-2 rounded-xl text-xs font-black text-slate-500 hover:bg-slate-100 transition-colors disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={submitting || (!isInbound && !targetLotId)}
            className={`px-5 py-2 rounded-xl text-xs font-black text-white ${accent.bg} ${accent.hover} transition-colors disabled:opacity-50`}
          >
            {submitting ? '저장 중...' : '저장'}
          </button>
        </div>
      </form>
    </ModalShell></div></>
  );
}

export default RawMaterialEntryModal;
