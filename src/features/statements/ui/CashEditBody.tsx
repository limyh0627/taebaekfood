import React,{useEffect,useRef,useState} from 'react';
import {X,Save,Trash2} from 'lucide-react';
import {appConfirm} from '../../../shared/components/appDialog';
import {companyOf,payrollTotals,type CashEntry,type AccountCode,type PayrollLine} from '../../../shared/types';
import {cashEditSplit,cashEditAmount,type CashEditForm,type CashEditLineDraft} from '../../../shared/cashEntryEdit';
import ModalShell from '../../../shared/components/ModalShell';
import SearchableSelect from '../../../shared/components/SearchableSelect';
import PayrollLineEditor from '../../../../components/hr/PayrollLineEditor';
import {auth} from '../../../shared/firebase';
import type {Props} from '../domain/cashEntryModal';
import {fmt} from './cashEntryDisplay';

const byCode = (a: AccountCode, b: AccountCode) =>
  String(a.code).localeCompare(String(b.code), undefined, { numeric: true });

export function EditBody({ entry, accountCodes, partners, companyId, partnerBalances, onClose, onSaveEdit, onDeleteEntry, payrollEdit, transferEdit, hasPendingRequest, onResumeEntry, cashAccounts, onAssignCashAccount }: Props & { entry: CashEntry }) {
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [payrollLines, setPayrollLines] = useState(payrollEdit?.lines ?? []);
  const payrollTotal = payrollTotals(payrollLines);
  const [counterLines, setCounterLines] = useState<CashEditLineDraft[]>((transferEdit?.counterpart.lines ?? []).map(line => ({
    accountCode: line.accountCode, amount: String(line.side === '대변' ? -Math.abs(line.amount) : line.side === '차변' ? Math.abs(line.amount) : line.amount), note: line.note ?? '',
  })));
  const [counterNote, setCounterNote] = useState(transferEdit?.counterpart.note ?? '');
  //  상계(대체)는 방향을 고를 수 있는 게 아니다 — 기본값만 출금으로 두고 저장 때 dir은 안 건드린다.
  const [form, setForm] = useState<CashEditForm>({
    amount: String(entry.amount), date: entry.date,
    dir: entry.dir === '대체' ? '출금' : entry.dir,
    accountCode: entry.accountCode ?? '', note: entry.note ?? '',
  });
  /**
   * 쪼개진 줄(`CashEntry.lines`) — 창이 이걸 안 들고 있다가 저장 한 번에 눈앞에서 사라졌다.
   * 쓰는 쪽이 accountCode 한 줄만 보내서, 대출상환(원금+이자)·급여(총액+원천공제) 같은 전표를
   * 열었다 닫기만 해도 자금원장 금액과 분개(줄 합)가 따로 놀았다.
   */
  const [lines, setLines] = useState<CashEditLineDraft[]>(
    (entry.lines ?? []).map(l => ({ accountCode: l.accountCode,
      amount: String(l.side === '대변' ? -Math.abs(l.amount) : l.side === '차변' ? Math.abs(l.amount) : l.amount), note: l.note ?? '' })));
  const [partnerId, setPartnerId] = useState(entry.partnerId ?? '');
  const [partnerTouched, setPartnerTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [assignmentAccountId, setAssignmentAccountId] = useState('');
  const [assignmentError, setAssignmentError] = useState('');
  const assignmentScope = useRef({ companyId, entry });
  assignmentScope.current = { companyId, entry };
  const assignmentAccounts = cashAccounts.filter(account => account.type === '통장');
  const assignmentAccount = assignmentAccounts.find(account => account.id === assignmentAccountId);
  const beforeOpening = !!assignmentAccount?.openingDate && entry.date < assignmentAccount.openingDate;
  const currentPartners = partners.filter(partner => companyOf(partner) === companyId);
  const selectedPartner = currentPartners.find(partner => partner.id === partnerId);
  const originalMissing = Boolean(entry.partnerId && !currentPartners.some(partner => partner.id === entry.partnerId));
  const partnerOptions = [
    { value: '', label: '거래처 없음' },
    ...(originalMissing ? [{ value: entry.partnerId!, label: `기존 연결: ${entry.partnerName || entry.partnerId} (목록 없음)` }] : []),
    ...currentPartners.map(partner => ({ value: partner.id, label: partner.name })),
  ];
  const shownPartnerName = partnerTouched ? selectedPartner?.name : (selectedPartner?.name ?? entry.partnerName);
  const shownPartnerId = partnerTouched ? partnerId : (entry.partnerId ?? '');

  //  판정은 shared/cashEntryEdit이 쥔다 — 화면 조각이라 테스트가 안 닿던 자리였다.
  const isOffset = entry.dir === '대체';
  const split = cashEditSplit(lines);
  const splitSum = split.reduce((a, l) => a + l.amount, 0);
  const amt = payrollEdit ? payrollTotal.net : cashEditAmount(form, lines, isOffset);
  const locked = !!payrollEdit || split.length > 0 && !isOffset;   // 급여는 사원별 입력에서, 쪼갠 전표는 줄 합에서 계산한다.

  const codeOptions = [...accountCodes].sort(byCode).map(ac => (
    <option key={ac.id} value={ac.code}>{ac.code} {ac.name}</option>
  ));

  return (
    <ModalShell title="자금 전표 수정" onClose={() => { if (!savingRef.current) onClose(); }} bodyClassName="space-y-4">
          {!entry.cashAccountId && entry.dir !== '대체' && !entry.balanceAdjustment && !payrollEdit && !transferEdit
            && !('payrollId' in entry && entry.payrollId) && !('transferOperationId' in entry && entry.transferOperationId)
            && !('returnOperationId' in entry && entry.returnOperationId) && onAssignCashAccount && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
              <label htmlFor="cash-assignment-account" className="block text-xs font-bold">계좌 미지정 · 통장 선택</label>
              <select id="cash-assignment-account" value={assignmentAccountId} disabled={saving} onChange={event => { setAssignmentAccountId(event.target.value); setAssignmentError(''); }} className="w-full rounded-lg border p-2 text-sm">
                <option value="">직접 선택하세요</option>
                {assignmentAccounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
              </select>
              {beforeOpening && <p className="text-xs text-amber-800">계좌 기초일 이전 기록입니다. 분개는 유지되지만 계좌 원장 잔액에는 반영되지 않습니다.</p>}
              {assignmentError && <p role="alert" className="text-xs text-rose-600">{assignmentError}</p>}
              <button type="button" disabled={saving || !assignmentAccount} onClick={async () => {
                if (savingRef.current || !assignmentAccount || companyOf(entry) !== companyId) return;
                const userId = auth.currentUser?.uid;
                if (!userId) return;
                savingRef.current = true; setSaving(true); setAssignmentError('');
                const current = () => alive.current && assignmentScope.current.companyId === companyId && assignmentScope.current.entry === entry && auth.currentUser?.uid === userId;
                try {
                  if (beforeOpening && !await appConfirm('계좌 기초일 이전 기록입니다. 계좌 원장 잔액에는 반영되지 않아도 이 통장으로 지정할까요?')) return;
                  if (!current()) return;
                  await onAssignCashAccount(entry, assignmentAccount.id);
                } catch (error) { if (current()) setAssignmentError(error instanceof Error ? error.message : String(error)); }
                finally { savingRef.current = false; if (current()) setSaving(false); }
              }} className="rounded-lg bg-amber-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">계좌 지정</button>
            </div>
          )}
          {onResumeEntry && hasPendingRequest?.(entry.id) && <button disabled={saving} onClick={async () => {
            if (savingRef.current) return;
            savingRef.current = true; setSaving(true);
            try { await onResumeEntry(entry.id); if (alive.current) onClose(); }
            catch (error) { if (alive.current) window.alert(`이전 변경 결과를 확인하지 못했습니다: ${(error as Error).message}`); }
            finally { savingRef.current = false; if (alive.current) setSaving(false); }
          }} className="w-full rounded-xl border border-amber-300 p-3 text-xs font-bold">이전 변경 결과 확인</button>}
          {payrollEdit && <div className="overflow-x-auto">
            <p className="text-xs font-bold mb-2">{payrollEdit.yearMonth} 급여대장 · 사원별 금액과 공제를 함께 수정합니다.</p>
            <PayrollLineEditor lines={payrollLines} onCell={(index, field: keyof PayrollLine, value) =>
              setPayrollLines(rows => rows.map((row, i) => i === index
                ? { ...row, [field]: Math.round(parseFloat(value.replace(/[^\d.-]/g, '')) || 0) } : row))} />
          </div>}
          {transferEdit && <div className="rounded-xl border p-3 space-y-2">
            <p className="text-xs font-bold">상대 회사 전표 · {transferEdit.counterpart.partnerName} · {transferEdit.counterpart.docNo}</p>
            <p className="text-xs">양쪽 금액과 일자는 함께 저장됩니다. 상대 회사의 분개도 입력해주세요.</p>
            {counterLines.map((line, index) => <div key={index} className="flex gap-2">
              <input aria-label={`상대 분개 ${index + 1} 계정`} value={line.accountCode} onChange={event => setCounterLines(rows => rows.map((row, i) => i === index ? { ...row, accountCode: event.target.value } : row))} />
              <input aria-label={`상대 분개 ${index + 1} 금액`} inputMode="decimal" value={line.amount} onChange={event => setCounterLines(rows => rows.map((row, i) => i === index ? { ...row, amount: event.target.value } : row))} />
              <button aria-label={`상대 분개 ${index + 1} 삭제`} onClick={() => setCounterLines(rows => rows.filter((_row, i) => i !== index))}><X size={13}/></button>
            </div>)}
            <button onClick={() => setCounterLines(rows => [...rows, { accountCode: '', amount: '', note: '' }])}>상대 분개 추가</button>
            <input aria-label="상대 전표 비고" value={counterNote} onChange={event => setCounterNote(event.target.value)} />
          </div>}
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">거래처</label>
            <SearchableSelect ariaLabel="거래처" value={partnerId} options={partnerOptions}
              onChange={id => { setPartnerId(id); setPartnerTouched(true); }}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold bg-white" />
            {/* 목록에 없는 옛 연결도 표시하되, 선택을 바꾸기 전에는 저장 패치에 넣지 않는다. */}
            {shownPartnerName ? (() => {
              const bal = shownPartnerId ? partnerBalances.get(shownPartnerId) : undefined;
              const ar = bal?.receivable ?? 0, ap = bal?.payable ?? 0;
              return (
                <p className="text-[11px] font-bold text-slate-500 mt-0.5">
                  {shownPartnerName}
                  {ar !== 0 && <span className="ml-1.5 text-blue-600">미수 {fmt(ar)}</span>}
                  {ap !== 0 && <span className="ml-1.5 text-rose-600">미지급 {fmt(ap)}</span>}
                </p>
              );
            })() : <p className="text-[11px] font-bold text-slate-300 mt-0.5">거래처 없음</p>}
          </div>

        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">구분</label>
            <div className="flex gap-1.5">
              {(['입금','출금'] as const).map(d => (
                <button key={d} disabled={isOffset || !!payrollEdit} onClick={() => setForm(p => ({ ...p, dir: d }))}
                  className={`flex-1 py-2 rounded-xl text-xs font-black border transition-all ${form.dir === d ? (d==='입금'?'bg-emerald-600 text-white border-emerald-600':'bg-rose-600 text-white border-rose-600') : 'bg-white text-slate-500 border-slate-200'}`}>{d}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">
              금액{locked && <span className="ml-1 text-blue-400 normal-case">= 줄 합계</span>}
            </label>
            {/* 쪼갠 전표의 금액은 줄 합이다 — 여기서 따로 고치면 자금원장과 분개가 갈라진다. */}
            <input type="text" inputMode="decimal"
              value={payrollEdit ? String(payrollTotal.net) : locked ? String(splitSum) : form.amount} readOnly={locked}
              onChange={e => setForm(p => ({ ...p, amount: e.target.value.replace(/[^\d.]/g,'') }))}
              className={`w-full border rounded-xl px-3 py-2 text-sm font-bold text-right outline-none focus:ring-2 focus:ring-blue-300 ${locked ? 'border-slate-100 bg-slate-50 text-slate-500' : 'border-slate-200'}`}/>
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">일자</label>
            <input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-300"/>
          </div>
          {!payrollEdit && <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] font-black text-slate-400 uppercase">{lines.length > 0 ? '쪼갠 줄' : '계정과목'}</label>
              <button
                onClick={() => setLines(p => [...p,
                  // 첫 줄은 지금 화면의 계정·금액을 그대로 물려받는다 — 한 줄짜리를 쪼개는 흔한 경우.
                  p.length === 0
                    ? { accountCode: form.accountCode, amount: form.amount, note: '' }
                    : { accountCode: '', amount: '', note: '' }])}
                className="text-[10px] font-black text-blue-600 hover:bg-blue-50 px-2 py-0.5 rounded-lg">+ 줄 추가</button>
            </div>
            {lines.length === 0 ? (
              <select value={form.accountCode} onChange={e => setForm(p => ({ ...p, accountCode: e.target.value }))}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-300 bg-white">
                <option value="">계정 미지정(영업)</option>
                {codeOptions}
              </select>
            ) : (
              <div className="space-y-1.5">
                {lines.map((l, i) => (
                  <div key={i} className="flex gap-1.5 items-center">
                    <select value={l.accountCode}
                      onChange={e => setLines(p => p.map((x, j) => j === i ? { ...x, accountCode: e.target.value } : x))}
                      className="flex-1 min-w-0 border border-slate-200 rounded-xl px-2 py-2 text-[11px] font-bold outline-none focus:ring-2 focus:ring-blue-300 bg-white">
                      <option value="">계정 선택</option>
                      {codeOptions}
                    </select>
                    {/* 상계(대체)는 반대편 줄이 음수라 빼기 부호를 지우면 안 된다. */}
                    <input type="text" inputMode="decimal" value={l.amount} placeholder="금액"
                      onChange={e => setLines(p => p.map((x, j) => j === i ? { ...x, amount: e.target.value.replace(/[^\d.-]/g,'') } : x))}
                      className="w-24 shrink-0 border border-slate-200 rounded-xl px-2 py-2 text-[11px] font-bold text-right outline-none focus:ring-2 focus:ring-blue-300"/>
                    <input type="text" value={l.note} placeholder="적요"
                      onChange={e => setLines(p => p.map((x, j) => j === i ? { ...x, note: e.target.value } : x))}
                      className="w-16 shrink-0 border border-slate-200 rounded-xl px-2 py-2 text-[11px] font-bold outline-none focus:ring-2 focus:ring-blue-300"/>
                    <button onClick={() => setLines(p => p.filter((_, j) => j !== i))}
                      className="p-1 shrink-0 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg"><X size={13}/></button>
                  </div>
                ))}
                {!isOffset ? (
                  <p className="text-[10px] font-bold text-slate-400 text-right">줄 합계 {fmt(splitSum)}</p>
                ) : (
                  <p className="text-[10px] font-bold text-amber-600">상계(대체) 전표 — 줄이 부호를 가져 합은 0, 방향은 못 바꿉니다.</p>
                )}
              </div>
            )}
          </div>}
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">비고</label>
            <input type="text" value={form.note} onChange={e => setForm(p => ({ ...p, note: e.target.value }))}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300"/>
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          {onDeleteEntry && (
            <button disabled={saving} onClick={async () => {
              if (savingRef.current) return;
              savingRef.current = true;
              setSaving(true);
              try { if (await appConfirm('이 자금 전표를 삭제할까요?') && alive.current) { await onDeleteEntry(entry.id); if (alive.current) onClose(); } }
              catch (error) { if (alive.current) window.alert(`자금 전표를 삭제하지 못했습니다: ${(error as Error).message}`); }
              finally { savingRef.current = false; if (alive.current) setSaving(false); }
            }}
              className="flex items-center gap-1 px-3 py-2.5 rounded-xl bg-red-50 text-red-600 text-xs font-black hover:bg-red-100 border border-red-200 disabled:opacity-40"><Trash2 size={12}/>삭제</button>
          )}
          <button onClick={onClose} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-xs font-black hover:bg-slate-200 disabled:opacity-40">취소</button>
          <button onClick={async () => {
            if (savingRef.current) return;
            savingRef.current = true;
            setSaving(true);
            try { await onSaveEdit(entry, { ...form, ...(partnerTouched ? { partnerId } : {}) }, lines,
              payrollEdit ? { ...payrollEdit, payDate: form.date, lines: payrollLines } : undefined,
              transferEdit ? { counterpartId: transferEdit.counterpart.id, expectedRevision: transferEdit.expectedRevision,
                expectedCashHash: transferEdit.expectedCashHash, patch: { amount: amt, date: form.date, note: counterNote,
                  lines: cashEditSplit(counterLines), accountCode: '' } } : undefined); }
            catch (error) { if (alive.current) window.alert(`자금 전표를 저장하지 못했습니다: ${(error as Error).message}`); }
            finally { savingRef.current = false; if (alive.current) setSaving(false); }
          }} disabled={amt <= 0 || saving}
            className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-black hover:bg-blue-700 disabled:opacity-40 flex items-center justify-center gap-1.5"><Save size={12}/>저장</button>
        </div>
    </ModalShell>
  );
}
