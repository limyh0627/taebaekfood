import React, { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../src/shared/firebase';
import type { CompanyId, Employee } from '../../src/shared/types';
import { today } from '../../src/shared/day';
import ModalShell from '../../src/shared/components/ModalShell';
import { appConfirm } from '../../src/shared/components/appDialog';
import { activeRetirementEvents, summarizeRetirement, validateRetirementConfirmation, normalizeRetirementEvent, normalizeRetirementProfile, type RetirementAction, type RetirementEventInput, type RetirementProfileInput, type RetirementReadDTO } from '../../src/shared/retirementBenefit';
import { listRetirementAttempts, readRetirement, retirementCommand, recoverRetirementReference, clearRetirementAttempt, type RetirementAttempt, type RetirementScope } from '../../src/shared/services/retirementBenefitCommands';
interface Props { companyId: CompanyId; employee: Employee; onClose: () => void }
const labels = { opening: '기초 충당', accrual: '월별 적립', interim: '중간정산', final: '최종정산', cancellation: '취소' };
const won = (n: number | null) => n === null ? '기초 미확인' : n.toLocaleString('ko-KR') + '원';
const id = () => crypto.randomUUID();
const blank = () => ({ kind: 'opening', effectiveDay: today(), reason: '', evidence: '', amount: '', allocationEvidence: '', yearMonth: today().slice(0, 7), periodStartDay: '', periodEndDay: '', gross: '', incomeTax: '', localTax: '', otherDeduct: '', net: '', reserveUsed: '', employeeRequest: '', overdrawAcknowledgement: '' });
export default function RetirementBenefitPanel(props: Props) {
 const [uid, setUid] = useState(auth.currentUser?.uid ?? '');
 useEffect(() => onAuthStateChanged(auth, user => setUid(user?.uid ?? '')), []);
 return <RetirementBody key={`${props.companyId}:${props.employee.id}:${uid}`} {...props} uid={uid} />;
}
function RetirementBody({ companyId, employee, onClose, uid }: Props & { uid: string }) {
 const scope: RetirementScope = { companyId, employeeId: employee.id, actorUid: uid };
 const alive = useRef(true), busyRef = useRef(false), readGeneration = useRef(0), profileEditGeneration = useRef(0), profileInitialized = useRef(false);
 const [data, setData] = useState<RetirementReadDTO | null>(null), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
 const [asOf, setAsOf] = useState(today()), [form, setForm] = useState(blank), [eventDirty, setDirty] = useState(false);
 const [profileDirty, setProfileDirty] = useState(false);
 const dirty = eventDirty || profileDirty;
 const [profile, setProfile] = useState<RetirementProfileInput>({ eligible: true, managementDay: today(), targetStartDay: employee.joinDate, targetEndDay: null, closedThroughDay: null });
 const [attempts, setAttempts] = useState<RetirementAttempt[]>([]), [replacement, setReplacement] = useState<string | null>(null), [editingDraft, setEditingDraft] = useState<string | null>(null), [selected, setSelected] = useState<RetirementAttempt | null>(null);
 const current = () => alive.current && auth.currentUser?.uid === uid;
 const refreshAttempts = () => { if (current()) setAttempts(listRetirementAttempts(scope)); };
 useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
 async function load(day = asOf) {
  const generation = ++readGeneration.current, profileGeneration = profileEditGeneration.current;
  const row = await readRetirement(scope, day, current);
  if (!current() || generation !== readGeneration.current) return;
  setData(row);
  if (!profileInitialized.current && row.profile && profileGeneration === profileEditGeneration.current && profileGeneration === 0) setProfile({ eligible: row.profile.eligible, managementDay: row.profile.managementDay, targetStartDay: row.profile.targetStartDay, targetEndDay: row.profile.targetEndDay, closedThroughDay: row.profile.closedThroughDay });
  profileInitialized.current = true;
 }
 useEffect(() => { refreshAttempts(); void load(asOf).catch(e => { if (current()) setMessage(e.message); }); }, []);
 const unresolved = attempts.some(a => !a.verified || !a.result || a.result.status === 'unknown');
 async function run(work: () => Promise<void>) {
  if (busyRef.current) return; busyRef.current = true; setBusy(true); setMessage('');
  try { await work(); } catch (e) { if (current()) setMessage(e instanceof Error ? e.message : '처리하지 못했습니다. 입력을 보존했습니다.'); }
  finally { if (current()) { busyRef.current = false; setBusy(false); refreshAttempts(); } }
 }
 async function submit(action: RetirementAction) {
  if (!data?.releaseId) throw Error('서버 준비 상태를 확인한 뒤 다시 조회하세요. 입력은 보존했습니다.');
  if (unresolved) throw Error('이 직원의 미확인 요청을 먼저 결과 확인하거나 안전 폐기하세요. 다른 직원 업무는 계속할 수 있습니다.');
  if (action.kind === 'confirm' || action.kind === 'replace') {
   if (!data.profile) throw Error('관리 설정을 먼저 저장하세요.');
   const target = data.events.find(e => e.id === action.eventId);
   if (!target || target.input.kind === 'cancellation') throw Error('원 이력을 다시 조회하세요.');
   const candidate = action.kind === 'confirm' ? target.input : action.replacement;
   validateRetirementConfirmation(data.profile, candidate, action.kind === 'replace' ? data.events.filter(e => e.id !== action.eventId) : data.events);
  }
  const result = await retirementCommand(scope, { version: 1, operationId: id(), companyId, employeeId: employee.id, expectedRevision: data.profile?.revision ?? 0, releaseId: data.releaseId, action }, 'apply', current);
  if (!current()) return;
  setMessage(result.message);
  if (result.status === 'applied') { if (action.kind === 'configure') setProfileDirty(false); else if (action.kind === 'save-draft' || action.kind === 'replace') { setDirty(false); setReplacement(null); setEditingDraft(null); setForm(blank()); } await load(); }
 }
 function number(key: keyof ReturnType<typeof blank>) { const value = form[key]; if (!/^\d+$/.test(value)) throw Error('금액을 모두 0 이상의 정수로 입력하세요. 명시적인 0도 직접 입력하세요.'); return Number(value); }
 function event(): RetirementEventInput {
  const common = { id: editingDraft ?? id(), kind: form.kind, effectiveDay: form.effectiveDay, reason: form.reason, evidence: form.evidence };
  return normalizeRetirementEvent(form.kind === 'opening' ? { ...common, amount: number('amount'), allocationEvidence: form.allocationEvidence } : form.kind === 'accrual' ? { ...common, amount: number('amount'), yearMonth: form.yearMonth } : { ...common, periodStartDay: form.periodStartDay, periodEndDay: form.periodEndDay, gross: number('gross'), incomeTax: number('incomeTax'), localTax: number('localTax'), otherDeduct: number('otherDeduct'), net: number('net'), reserveUsed: number('reserveUsed'), employeeRequest: form.employeeRequest, overdrawAcknowledgement: form.overdrawAcknowledgement });
 }
 async function editEvent(eventId: string, input: RetirementEventInput | { kind: 'cancellation' }, replace: boolean) {
  if (input.kind === 'cancellation') return;
  if (eventDirty && !await appConfirm('현재 입력을 저장하지 않고 선택한 이력을 불러옵니까?')) return;
  setForm({ ...blank(), ...Object.fromEntries(Object.entries(input).filter(([k]) => k !== 'id').map(([k, v]) => [k, String(v)])) });
  setReplacement(replace ? eventId : null); setEditingDraft(replace ? null : eventId); setDirty(true);
 } function field(key: keyof ReturnType<typeof blank>, label: string, type = 'text') { return <label className="flex flex-col gap-1 text-sm">{label}<input aria-label={label} type={type} disabled={busy} value={form[key]} onChange={e => { setDirty(true); setForm(v => ({ ...v, [key]: e.target.value })); }} className="rounded border border-gray-300 p-2" /></label>; }
 function pfield(key: 'managementDay' | 'targetStartDay' | 'targetEndDay' | 'closedThroughDay', label: string) { return <label className="flex flex-col gap-1 text-sm">{label}<input aria-label={label} type="date" disabled={busy} value={profile[key] ?? ''} onChange={e => { profileEditGeneration.current++; setProfileDirty(true); setProfile(v => ({ ...v, [key]: e.target.value || null })); }} className="rounded border border-gray-300 p-2" /></label>; }
 async function close() { if (dirty && !await appConfirm('저장하지 않은 입력이 있습니다. 입력 창을 닫으시겠습니까? 전송한 최초 요청은 보관됩니다.')) return; alive.current = false; onClose(); }
 const activeIds = new Set(data ? activeRetirementEvents(data.events).map(e => e.id) : []);
 const previousDay = /^\d{4}-\d{2}-\d{2}$/.test(data?.asOfDay ?? '') ? new Date(Date.UTC(Number(data!.asOfDay.slice(0, 4)), Number(data!.asOfDay.slice(5, 7)) - 1, 0)).toISOString().slice(0, 10) : asOf;
 const previous = data ? summarizeRetirement(data.events, previousDay) : null;
 const settlement = form.kind === 'interim' || form.kind === 'final';
 const used = /^\d+$/.test(form.reserveUsed) ? Number(form.reserveUsed) : 0;
 const difference = data?.summary.balance === null ? null : Math.max(0, used - (data?.summary.balance ?? 0));
 return <ModalShell title={`${employee.name} 퇴직금 관리`} onClose={() => void close()} className="!max-w-5xl">
  <div className="space-y-5 text-gray-800 [&_button]:min-h-10 [&_button]:rounded [&_button]:border [&_button]:border-gray-300 [&_button]:px-3 [&_button]:text-sm [&_button:disabled]:opacity-40">
   <p className="text-sm">회사 {companyId === 'taebaek' ? '태백' : '풍회'} · 원래 입사일 {employee.joinDate} · 제도 퇴직금</p>
   <p className="text-sm">법정 예상액 미산정 · 회계 대사 불가 · 전표 미연결. 수기 이력은 급여·입사일·연차·회계 전표를 변경하지 않습니다.</p>
   {message && <p role="status" className="whitespace-pre-wrap border-y border-gray-200 py-3">{message}</p>}
   <div className="flex flex-wrap items-end gap-2"><label>조회 기준일<input aria-label="조회 기준일" type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className="ml-2 border border-gray-300 p-2" /></label><button disabled={busy} onClick={() => void run(() => load())}>다시 조회</button></div>
   {!data ? <p>조회 결과를 확인한 뒤 설정·이력을 저장할 수 있습니다.</p> : <>
    <section className="border-t border-gray-200 pt-4"><h4 className="font-bold">장부 확인</h4><p>장부 충당 잔액: {won(data.summary.balance)}</p><p>전월 말 잔액 {won(previous?.balance ?? null)} · 당월 적립 {won(data.summary.accrual - (previous?.accrual ?? 0))} · 당월 충당 사용 {won(data.summary.reserveUsed - (previous?.reserveUsed ?? 0))}</p><p className="text-sm">현재 저장된 이력을 효력일 기준으로 계산합니다. 과거 당시의 저장 상태를 재현한 값은 아닙니다.</p><p>확인된 적립 {won(data.summary.accrual)} · 충당 사용 {won(data.summary.reserveUsed)} · 마지막 확정 정산 종료일 {data.summary.lastSettlementEndDay ?? '없음'}</p>{data.summary.balance === null && <p>기초 미확인입니다. 확인된 증감 {won(data.summary.knownMovement)}은 전체 잔액이 아닙니다.</p>}{data.summary.overdrawn && <p>충당 잔액이 음수입니다. 정산 근거와 초과 사용 사유를 확인하세요.</p>}</section>
    <section className="space-y-3 border-t border-gray-200 pt-4"><h4 className="font-bold">직원별 관리 설정</h4><label className="flex gap-2"><input type="checkbox" disabled={busy} checked={profile.eligible} onChange={e => { profileEditGeneration.current++; setProfileDirty(true); setProfile(v => ({ ...v, eligible: e.target.checked })); }} />퇴직금 관리 대상</label><div className="grid gap-3 sm:grid-cols-2">{pfield('managementDay', '관리 기준일')}{pfield('targetStartDay', '확인 대상 시작일')}{pfield('targetEndDay', '확인 대상 종료일 (선택)')}{pfield('closedThroughDay', '관리 마감일 (선택)')}</div><p className="text-sm">관리 마감일까지의 확정·취소·대체를 잠급니다. 기존 입사일과 연차는 유지합니다.</p><button disabled={busy || unresolved || !data.releaseId} onClick={() => void run(() => submit({ kind: 'configure', profile: normalizeRetirementProfile(profile) }))}>관리 설정 저장</button></section>
    <section className="space-y-3 border-t border-gray-200 pt-4"><h4 className="font-bold">{replacement ? '확정 이력 원자 대체' : editingDraft ? '저장된 초안 수정' : '수기 이력 초안'}</h4><label>종류<select aria-label="이력 종류" disabled={busy} value={form.kind} onChange={e => { setDirty(true); setForm(v => ({ ...v, kind: e.target.value })); }} className="ml-2 border border-gray-300 p-2">{(['opening', 'accrual', 'interim', 'final'] as const).map(k => <option key={k} value={k}>{labels[k]}</option>)}</select></label><div className="grid gap-3 sm:grid-cols-2">{field('effectiveDay', '효력일', 'date')}{field('reason', replacement ? '정정 사유' : '사유')}{field('evidence', '장부 출처·증빙 참조')}{!settlement && field('amount', '금액', 'text')}{form.kind === 'opening' && field('allocationEvidence', '직원별 기초 배분 근거')}{form.kind === 'accrual' && field('yearMonth', '적립 귀속 월', 'month')}{settlement && <>{field('periodStartDay', '정산 대상 시작일', 'date')}{field('periodEndDay', '정산 대상 종료일', 'date')}{field('gross', '정산 총액')}{field('incomeTax', '퇴직소득세')}{field('localTax', '지방소득세')}{field('otherDeduct', '기타 공제')}{field('net', '실지급액')}{field('reserveUsed', '충당 사용액')}{field('employeeRequest', '직원 요청·사유')}{field('overdrawAcknowledgement', '기초 미확인·초과 사용 확인 사유')}</>}</div>
    {settlement && <p>총액 = 퇴직소득세 + 지방소득세 + 기타 공제 + 실지급액을 직접 대사합니다. 충당 사용액은 별도 입력입니다. {difference === null ? '기초 미확인: 사용 근거를 확인하세요.' : difference > 0 ? `현재 조회 잔액 초과 ${won(difference)}: 확인 사유를 남기세요.` : ''}</p>}
    <button disabled={busy || unresolved || !data.profile || !data.releaseId} onClick={() => void run(async () => { const value = event(); if (replacement) { if (!await appConfirm('원 확정 효과를 취소하고 새 이력을 함께 확정합니다. 정정 사유·금액·기간을 확인했습니까?')) return; await submit({ kind: 'replace', eventId: replacement, cancellationId: id(), effectiveDay: form.effectiveDay, reason: form.reason, evidence: form.evidence, replacement: value }); } else await submit({ kind: 'save-draft', event: value }); })}>{replacement ? '취소와 대체 함께 확정' : editingDraft ? '초안 수정 저장' : '초안 저장'}</button>{(replacement || editingDraft) && <button disabled={busy} onClick={() => void (async () => { if (eventDirty && !await appConfirm('현재 입력을 저장하지 않고 새 초안 입력으로 이동합니까?')) return; setReplacement(null); setEditingDraft(null); setForm(blank()); setDirty(false); })()}>새 초안 입력</button>}
    </section>
    <section className="space-y-3 border-t border-gray-200 pt-4"><h4 className="font-bold">이력</h4>{data.events.length === 0 && <p>등록된 이력이 없습니다.</p>}{data.events.map(e => <div key={e.id} className="space-y-2 border-b border-gray-200 py-3"><p>{labels[e.input.kind]} · {e.input.effectiveDay} · {e.status === 'draft' ? '초안' : e.input.kind === 'cancellation' ? '확정 취소' : activeIds.has(e.id) ? '확정' : '취소됨'} · 전표 미연결</p><p className="text-sm">{e.input.reason} · 증빙 {e.input.evidence || '미입력'}</p><p className="text-sm">{e.input.kind === 'opening' || e.input.kind === 'accrual' ? `금액 ${won(e.input.amount)}${e.input.kind === 'accrual' ? ` · 귀속 ${e.input.yearMonth}` : ` · 배분 근거 ${e.input.allocationEvidence}`}` : e.input.kind === 'cancellation' ? `원 이력 ${e.input.targetEventId}` : `대상 ${e.input.periodStartDay} ~ ${e.input.periodEndDay} · 총액 ${won(e.input.gross)} · 퇴직소득세 ${won(e.input.incomeTax)} · 지방소득세 ${won(e.input.localTax)} · 기타 공제 ${won(e.input.otherDeduct)} · 실지급 ${won(e.input.net)} · 충당 사용 ${won(e.input.reserveUsed)} · 직원 요청 ${e.input.employeeRequest} · 초과 확인 ${e.input.overdrawAcknowledgement || '해당 없음'}`}</p>{e.status === 'draft' && <button disabled={busy || unresolved} onClick={() => void editEvent(e.id, e.input, false)}>초안 수정</button>}{e.status === 'draft' && <button disabled={busy || unresolved} onClick={() => void run(async () => { if (await appConfirm('이 초안의 금액·기간·근거를 확인하고 확정하시겠습니까?')) await submit({ kind: 'confirm', eventId: e.id }); })}>초안 확정</button>}{e.status === 'confirmed' && activeIds.has(e.id) && <div className="flex gap-2"><button disabled={busy || unresolved} onClick={() => void editEvent(e.id, e.input, true)}>대체 입력</button><button disabled={busy || unresolved} onClick={() => void run(async () => { if (!form.reason.trim()) throw Error('위 입력란의 사유에 취소 사유를 입력하세요. 효력일과 증빙도 확인하세요.'); if (await appConfirm(`${labels[e.input.kind]} · 원 효력일 ${e.input.effectiveDay} 내역을 취소합니까?\n취소 효력일 ${form.effectiveDay}\n취소 사유 ${form.reason}\n증빙 ${form.evidence || '미입력'}\n원 이력은 보존됩니다.`)) await submit({ kind: 'cancel', eventId: e.id, cancellationId: id(), effectiveDay: form.effectiveDay, reason: form.reason, evidence: form.evidence }); })}>확정 취소</button></div>}</div>)}</section>
   </>}
   <section className="space-y-3 border-t border-gray-200 pt-4"><h4 className="font-bold">이 직원의 최초 요청·복구</h4><p className="text-sm">응답이 없으면 처리 여부 미확인입니다. 같은 내용 재시도 또는 서버 결과 확인을 이용하세요. 안전 폐기는 서버가 늦은 처리를 봉쇄한 뒤에만 확정됩니다.</p>{attempts.length === 0 && <p>보관 요청 없음</p>}{attempts.map(a => <div key={a.key} className="space-y-2 border-b border-gray-200 py-3"><p>{a.request?.operationId ?? '판독 불가'} · {a.result ? ({ applied: '적용 완료', rejected: '거절 확정', discarded: '안전 폐기 완료', unknown: '처리 여부 미확인' }[a.result.status]) : '처리 여부 미확인'}</p>{a.result && !a.verified && <p>보관된 결과는 참고용입니다. 서버 결과를 다시 확인하세요.</p>}{a.error && <p>{a.error}</p>}<div className="flex flex-wrap gap-2"><button onClick={() => setSelected(a)}>최초 원문·적용 결과 보기</button>{(a.request || a.operationId) && (!a.verified || !a.result || a.result.status === 'unknown') && <>{(['apply', 'inspect-request', 'discard-request'] as const).filter(mode => mode !== 'apply' || !!a.request && (!a.result || a.result.status === 'unknown')).map(mode => <button key={mode} disabled={busy} onClick={() => void run(async () => { if (mode === 'discard-request' && !await appConfirm('최초 요청을 서버에서 안전 폐기하시겠습니까? 이미 적용된 요청은 적용 결과를 반환합니다.')) return; const result = a.request ? await retirementCommand(scope, a.request, mode, current) : await recoverRetirementReference(scope, a, mode as 'inspect-request' | 'discard-request', current); if (!current()) return; setMessage(result.status === 'applied' ? '이 요청은 이미 반영됐습니다. 적용 결과를 확인하세요. 사본 정리는 확정 이력 취소가 아닙니다.' : result.message); setSelected({ ...a, result }); if (result.status === 'applied') await load(); })}>{mode === 'apply' ? '같은 내용 재시도' : mode === 'inspect-request' ? '서버 결과 확인' : '안전 폐기'}</button>)}</>}{a.operationId && a.result && a.result.status !== 'unknown' && <button disabled={busy} onClick={() => void run(async () => { if (!await appConfirm('서버의 확정 결과를 다시 확인하고 이 브라우저 사본만 정리합니까? 적용된 퇴직금 이력은 취소되지 않습니다.')) return; const result = await clearRetirementAttempt(scope, a, current); if (current()) { setSelected({ ...a, result }); setMessage('서버 결과를 확인하고 브라우저 사본을 정리했습니다. 적용 이력은 유지됩니다.'); } })}>브라우저 사본 정리</button>}</div></div>)}{selected && <div className="border border-gray-300 p-3"><button onClick={() => setSelected(null)}>결과 보기 닫기</button><p>{selected.result?.message ?? '서버 처리 여부 미확인'}</p><p>작업 {selected.operationId ?? '확인 불가'} · {selected.request?.action.kind === 'configure' ? '관리 설정' : selected.request?.action.kind === 'save-draft' ? '초안 저장' : selected.request?.action.kind === 'confirm' ? '초안 확정' : selected.request?.action.kind === 'cancel' ? '확정 취소' : selected.request?.action.kind === 'replace' ? '원자 대체' : '손상 원문 참조 복구'}</p><details><summary>최초 원문·서버 응답 자료 펼치기</summary><pre className="overflow-auto whitespace-pre-wrap text-xs">{selected.text}{'\n'}{JSON.stringify(selected.result, null, 2)}</pre></details></div>}</section>
  </div>
 </ModalShell>;
}
