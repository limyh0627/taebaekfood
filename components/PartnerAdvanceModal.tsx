import { AR, AP, OTHER_PAYABLE } from '../src/shared/autoJournal';
import React, { useEffect, useRef, useState } from 'react';
import ModalShell from '../src/shared/components/ModalShell';
import { appConfirm } from '../src/shared/components/appDialog';
import { auth, authReady } from '../src/shared/firebase';
import { today } from '../src/shared/day';
import { formatMoneyInput, parseMoneyInput } from '../src/shared/moneyInput';
import type { CompanyId, PreparedPartnerAdvance } from '../src/shared/partnerAdvance';
import { applyPartnerAdvance, cancelPartnerAdvance, preparePartnerAdvance, readPendingPartnerAdvance, type PendingPartnerAdvance } from '../src/features/statements/infrastructure/partnerAdvanceCommands';

type Props = { companyId: CompanyId; partnerId: string; partnerName: string; onClose: () => void };
const money = (value: number) => `${value.toLocaleString('ko-KR')}원`;
const sourceKey = (source: PreparedPartnerAdvance['sources'][number]) => `${source.key.id}:${source.key.lineKey}`;
const targetKey = (target: PreparedPartnerAdvance['targets'][number]) => `${target.statementId}:${target.accountCode}`;
const compatible = (source: PreparedPartnerAdvance['sources'][number], target: PreparedPartnerAdvance['targets'][number]) => source.code === '254' ? target.accountCode === AR : [AP, OTHER_PAYABLE].includes(target.accountCode);
const order = (a: { date: string; docNo: string }, b: { date: string; docNo: string }) => a.date.localeCompare(b.date) || a.docNo.localeCompare(b.docNo);

export default function PartnerAdvanceModal({ companyId, partnerId, partnerName, onClose }: Props) {
  const [data, setData] = useState<PreparedPartnerAdvance | null>(null);
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [pending, setPending] = useState<PendingPartnerAdvance | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const active = useRef(false), saving = useRef(false), actorId = useRef('');
  const current = () => active.current && auth.currentUser?.uid === actorId.current;
  const sources = [...(data?.sources ?? [])].filter(row => row.remaining > 0).sort((a, b) => order(a, b) || sourceKey(a).localeCompare(sourceKey(b)));
  const source = sources.find(row => sourceKey(row) === sourceId);
  const targets = [...(data?.targets ?? [])].filter(row => row.remaining > 0 && source && compatible(source, row)).sort((a, b) => order(a, b) || targetKey(a).localeCompare(targetKey(b)));
  const target = targets.find(row => targetKey(row) === targetId);
  const blocked = loading || busy || !!pending || !data?.enabled;

  const load = async () => {
    const prepared = await preparePartnerAdvance(companyId, partnerId);
    if (!current()) return;
    const previous = readPendingPartnerAdvance(companyId);
    setPending(previous); setData(prepared);
    const sorted = [...prepared.sources].filter(row => row.remaining > 0).sort((a, b) => order(a, b) || sourceKey(a).localeCompare(sourceKey(b)));
    const first = sorted.find(row => prepared.targets.some(item => item.remaining > 0 && compatible(row, item)));
    const firstTarget = first && [...prepared.targets].filter(row => row.remaining > 0 && compatible(first, row)).sort((a, b) => order(a, b) || targetKey(a).localeCompare(targetKey(b)))[0];
    setSourceId(first ? sourceKey(first) : ''); setTargetId(firstTarget ? targetKey(firstTarget) : '');
    setAmount(first && firstTarget ? formatMoneyInput(Math.min(first.remaining, firstTarget.remaining)) : '');
    setDate([today(), first?.date ?? '', firstTarget?.date ?? ''].sort().at(-1)!);
  };
  useEffect(() => {
    active.current = true;
    void (async () => { try { await authReady; if (!active.current) return; actorId.current = auth.currentUser?.uid ?? ''; await load(); }
      catch (failure) { if (active.current) setError(failure instanceof Error ? failure.message : '잔액을 불러오지 못했습니다.'); }
      finally { if (active.current) setLoading(false); } })();
    return () => { active.current = false; };
  }, [companyId, partnerId]);

  const submit = async (resume?: PendingPartnerAdvance, application?: PreparedPartnerAdvance['applications'][number]) => {
    if (saving.current || !current() || !data || (!resume && (!data.enabled || pending))) return;
    const value = parseMoneyInput(amount);
    if (!resume && !application && (!source || !target || !Number.isSafeInteger(value) || value <= 0 || value > Math.min(source.remaining, target.remaining))) {
      setError('남은 금액 안에서 적용 금액을 입력해 주세요.'); return;
    }
    saving.current = true; setBusy(true); setError('');
    try {
      if (!resume && !await appConfirm(application ? `${application.docNo}의 ${money(application.amount)} 적용을 취소하고 선급·선수금으로 돌릴까요?` : `${source!.docNo}에서 ${target!.docNo}에 ${money(value)}을 적용할까요?`)) return;
      if (!current()) return;
      const request: PendingPartnerAdvance = resume ?? {
        version: 1, companyId, actorId: actorId.current, action: application ? 'cancel' : 'apply',
        input: application ? { operationId: crypto.randomUUID(), partnerId, date: [today(), application.date].sort().at(-1)!, applicationStatementId: application.statementId, reason: '거래처 원장에서 적용 취소', expectedRevision: data.revision, releaseId: data.releaseId }
          : { operationId: crypto.randomUUID(), partnerId, date, source: source!.key, statementId: target!.statementId, accountCode: target!.accountCode, amount: value, expectedSourceFingerprint: source!.fingerprint, expectedTargetFingerprint: target!.fingerprint, expectedRevision: data.revision, releaseId: data.releaseId },
      };
      if (request.action === 'apply') await applyPartnerAdvance(companyId, request.input as Parameters<typeof applyPartnerAdvance>[1]);
      else await cancelPartnerAdvance(companyId, request.input as Parameters<typeof cancelPartnerAdvance>[1]);
      if (current()) await load();
    } catch (failure) {
      if (current()) {
        try { setPending(readPendingPartnerAdvance(companyId)); } catch { /* 보존된 요청을 삭제하지 않는다. */ }
        setError(failure instanceof Error ? failure.message : '결과를 확인하지 못했습니다. 같은 요청으로 재시도해 주세요.');
      }
    } finally { saving.current = false; if (current()) setBusy(false); }
  };
  const pickSource = (id: string) => {
    const chosen = sources.find(row => sourceKey(row) === id);
    const first = chosen && [...(data?.targets ?? [])].filter(row => row.remaining > 0 && compatible(chosen, row)).sort((a, b) => order(a, b) || targetKey(a).localeCompare(targetKey(b)))[0];
    setError(''); setSourceId(id); setTargetId(first ? targetKey(first) : ''); setAmount(chosen && first ? formatMoneyInput(Math.min(chosen.remaining, first.remaining)) : '');
  };
  return <ModalShell title="선급·선수금 적용" subtitle={partnerName} onClose={() => { if (!busy) onClose(); }} footer={<div className="flex gap-2"><button type="button" disabled={busy} onClick={onClose} className="flex-1 rounded-xl border px-4 py-3">닫기</button><button type="button" disabled={blocked || !source || !target} onClick={() => void submit()} className="flex-1 rounded-xl bg-indigo-600 px-4 py-3 font-bold text-white disabled:opacity-40">{busy ? '처리 중…' : '확인하고 적용'}</button></div>}>
    <div className="space-y-4">
      <p className="text-sm text-slate-500">남아 있는 내역을 오래된 순으로 선택했습니다. 적용해도 통장에서 돈이 다시 움직이지 않습니다.</p>
      {loading && <p>잔액을 확인하고 있습니다.</p>}
      {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      {data && !data.enabled && <p className="rounded-xl bg-amber-50 p-3 text-sm">{data.blockedReason || '현재 이 회사에서 적용 기능을 준비 중입니다.'}</p>}
      {pending && <div className="rounded-xl bg-amber-50 p-3 text-sm"><p>결과를 확인하지 못한 이전 요청이 보존되어 있습니다.</p>{pending.input.partnerId === partnerId ? <button type="button" disabled={busy} onClick={() => void submit(pending)} className="mt-2 font-bold text-indigo-700">같은 요청으로 결과 확인</button> : <p>이전 요청의 거래처에서 결과를 먼저 확인해 주세요.</p>}</div>}
      <label className="block text-sm font-bold">미리 지급하거나 받은 내역<select aria-label="미리 지급하거나 받은 내역" disabled={blocked} value={sourceId} onChange={event => pickSource(event.target.value)} className="mt-2 w-full rounded-xl border p-3"><option value="">남아 있는 내역 없음</option>{sources.map(row => <option key={sourceKey(row)} value={sourceKey(row)}>{row.date} · {row.docNo} · {row.code === '133' ? '선급금' : '선수금'} {money(row.remaining)} {row.note}</option>)}</select></label>
      <label className="block text-sm font-bold">갚을 전표<select aria-label="갚을 전표" disabled={blocked} value={targetId} onChange={event => { const selected = targets.find(row => targetKey(row) === event.target.value); setError(''); setTargetId(event.target.value); setAmount(source && selected ? formatMoneyInput(Math.min(source.remaining, selected.remaining)) : ''); }} className="mt-2 w-full rounded-xl border p-3"><option value="">미결 전표 없음</option>{targets.map(row => <option key={targetKey(row)} value={targetKey(row)}>{row.date} · {row.docNo} · 남은 {money(row.remaining)}</option>)}</select></label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className="text-sm font-bold">적용일<input aria-label="적용일" type="date" disabled={blocked} value={date} onChange={event => setDate(event.target.value)} className="mt-2 w-full rounded-xl border p-3" /></label><label className="text-sm font-bold">적용 금액<input aria-label="적용 금액" inputMode="numeric" disabled={blocked} value={amount} onChange={event => { setError(''); setAmount(formatMoneyInput(event.target.value)); }} className="mt-2 w-full rounded-xl border p-3" /></label></div>
      {source && target && <p className="text-sm text-slate-500">현재 적용 가능한 금액: {money(Math.min(source.remaining, target.remaining))}</p>}
      {!!data?.applications.length && <section className="space-y-2 border-t pt-4"><h4 className="font-bold">적용한 내역</h4>{data.applications.map(row => <div key={row.statementId} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 text-sm"><span>{row.date} · {row.docNo}<br />{money(row.amount)}</span><button type="button" disabled={blocked} onClick={() => void submit(undefined, row)} className="shrink-0 font-bold text-rose-600">적용 취소</button></div>)}</section>}
      {!!data?.diagnostics.length && <p className="text-xs text-amber-700">일부 내역은 연결 확인이 필요해 목록에서 제외했습니다.</p>}
    </div>
  </ModalShell>;
}
