import React, {useEffect, useRef, useState} from 'react';
import {auth} from '../src/shared/firebase';
import type {CompanyId} from '../src/shared/types';
import {getPendingFinancialOpening, resumeFinancialOpening, type FinancialOpeningPending} from '../src/shared/services/financialOpeningCommands';

function summary(p:FinancialOpeningPending){
 const r=p.request;
 switch(r.kind){
  case 'partner-create':return ['거래처 기초 등록',r.partnerId,r.date,r.amount] as const;
  case 'loan-create':return ['대출 기초 등록',r.loan.name,r.loan.openingDate,r.loan.openingPrincipal] as const;
  case 'loan-update':return ['대출 기초 수정',r.original.name,r.newDate,r.targetBalance] as const;
  case 'account-create':return ['계좌 기초 등록',r.account.name,r.account.openingDate,r.account.openingBalance] as const;
  case 'account-update':return ['계좌 기초 수정',r.name,r.newDate,r.targetBalance] as const;
 }
}
export default function FinancialOpeningResume({companyId,onRecovered}:{companyId:CompanyId;onRecovered:()=>void}){
 const [pending,setPending]=useState<FinancialOpeningPending|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const mounted=useRef(false),running=useRef(false);
 const uid=auth.currentUser?.uid;
 useEffect(()=>{
  mounted.current=true;
  const read=()=>{try{setPending(getPendingFinancialOpening(companyId));setError('');}catch(e){setPending(null);setError(e instanceof Error?e.message:'이전 기초 저장 원문을 확인할 수 없습니다.');}};
  read();window.addEventListener('financial-opening-pending',read);window.addEventListener('storage',read);
  return()=>{mounted.current=false;window.removeEventListener('financial-opening-pending',read);window.removeEventListener('storage',read);};
 },[companyId,uid]);
 const resume=async()=>{
  if(running.current||!pending)return;
  const actor=pending.userId;
  if(auth.currentUser?.uid!==actor)return;
  running.current=true;setBusy(true);setError('');
  try{await resumeFinancialOpening(companyId);if(!mounted.current||auth.currentUser?.uid!==actor)return;setPending(getPendingFinancialOpening(companyId));onRecovered();}
  catch(e){if(mounted.current&&auth.currentUser?.uid===actor)setError(e instanceof Error?e.message:'저장 결과를 확인하지 못했습니다. 이전 요청을 다시 확인해 주세요.');}
  finally{running.current=false;if(mounted.current&&auth.currentUser?.uid===actor)setBusy(false);}
 };
 if(!pending&&!error)return null;
 const details=pending?summary(pending):null;
 return <section aria-label="이전 기초 저장 확인" className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
  <p className="font-semibold">이전 기초 저장 결과를 확인해 주세요</p>
  {details&&<p>{details[0]} · {details[1]} · {details[2]} · {typeof details[3]==='number'&&Number.isFinite(details[3])?`${details[3].toLocaleString('ko-KR')}원`:'금액 확인 필요'}</p>}
  {error&&<p role="alert" className="mt-1 text-red-700">{error}</p>}
  {pending&&<button type="button" disabled={busy} onClick={()=>void resume()} className="mt-2 rounded-lg bg-amber-900 px-3 py-2 text-white disabled:opacity-50">{busy?'저장 확인 중…':'이전 저장 확인'}</button>}
 </section>;
}
