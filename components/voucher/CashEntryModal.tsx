import React, { useState } from 'react';
import { today } from '../../src/shared/day';
import { X, Save, Trash2 } from 'lucide-react';
import type { IssuedStatement, CashEntry, AccountCode, PaymentMethod } from '../../src/shared/types';
import { cashEditSplit, cashEditAmount, type CashEditForm, type CashEditLineDraft } from '../../src/shared/cashEntryEdit';

/**
 * **자금 전표 하나를 세우거나 고치는 창.**
 *
 * 수금·지불은 따로 있는 게 아니라 **입금·출금 그 자체**다.
 *   수금 = 입금  (차) 103 통장 / (대) 108 외상매출금
 *   지불 = 출금  (차) 251 외상매입금 / (대) 103 통장
 * 다른 건 둘뿐이다 — 상대계정이 108·251로 **정해져 있고**, 어느 전표를 갚은 것인지
 * 상계(settlement)로 붙는다. 그래서 창을 둘로 나누지 않았다. 나누면 같은 것을 두 번
 * 만들게 되고, 한쪽만 고쳐진 채로 갈린다.
 *
 * 두 갈래로 연다:
 *   `수금지불` — 전표에서 열었다. 금액·상대계정이 그 전표에서 나온다.
 *   `수정`     — 이미 난 자금 전표를 고친다. 쪼갠 줄과 삭제가 붙는다.
 *
 * 돈을 실제로 옮기는 일(상계를 붙이고 분개를 만드는 일)은 여기서 안 한다 —
 * `onSettle`·`onSaveEdit`로 넘긴다. 이 창은 **무엇을 입력받았는지**까지만 안다.
 */
export type CashModalMode =
  | { kind: '수금지불'; stmt: IssuedStatement }
  | { kind: '수정'; entry: CashEntry };

/** 수금·지불로 받은 것 — 부르는 쪽이 이걸로 자금기록과 상계를 만든다 */
export interface SettleInput {
  amount: number;
  date: string;
  method: PaymentMethod;
  note: string;
  /** 'stmt' = 이 전표부터 갚음(상계를 붙인다) · 'partner' = 오래된 전표부터 */
  scope: 'stmt' | 'partner';
}

interface Props {
  mode: CashModalMode;
  accountCodes: AccountCode[];
  /** 활성 통장만 */
  cashAccounts: { id: string; name: string }[];
  /** 고른 통장 — 창을 닫아도 기억해야 해서 밖이 쥔다 */
  accountId: string;
  onAccountId: (_id: string) => void;
  partnerBalances: Map<string, { receivable: number; payable: number }>;
  getBalance: (_s: IssuedStatement) => number;
  /** 그 사이 바뀌었을 수 있으니 저장 직전에 최신 전표를 다시 집는다 */
  latestStatement: (_id: string) => IssuedStatement | undefined;
  onClose: () => void;
  onSettle: (_stmt: IssuedStatement, _input: SettleInput) => void;
  onSaveEdit: (_entry: CashEntry, _form: CashEditForm, _lines: CashEditLineDraft[]) => void;
  onDeleteEntry?: (_id: string) => void;
}

const fmt = (n: number) => n.toLocaleString('ko-KR');
const overLabelOf = (type?: string) => (type === '매출' ? '선수금' : '선급금');
const byCode = (a: AccountCode, b: AccountCode) =>
  String(a.code).localeCompare(String(b.code), undefined, { numeric: true });

/**
 * 이 창은 **열 때마다 새로 마운트한다**(부르는 쪽이 `key`를 준다).
 * 그래야 초기값을 props에서 한 번만 읽으면 되고, 열 때마다 폼을 되씻는 effect가 필요 없다.
 */
export default function CashEntryModal(p: Props) {
  return p.mode.kind === '수금지불'
    ? <SettleBody {...p} stmt={p.mode.stmt} />
    : <EditBody {...p} entry={p.mode.entry} />;
}

// ── 수금·지불 (전표에서 연다) ────────────────────────────────────────────────

function SettleBody({
  stmt, cashAccounts, accountId, onAccountId, partnerBalances, getBalance, latestStatement, onClose, onSettle,
}: Props & { stmt: IssuedStatement }) {
  const isBuy = stmt.type === '매입';
  /**
   * 기본값은 **이 전표에 남은 금액**. 총액을 박아 두면 이미 절반을 낸 전표에서도 전액이
   * 찍혀 또 나간다(카드대금 899,925이 두 번 나간 게 그 꼴이다).
   * 일자도 **그 전표 날짜**가 기본이다 — 오늘로 박아 두면 8/28 전표를 8/31에 열 때마다 고쳐야 한다.
   */
  const [amount, setAmount] = useState(String(Math.round(getBalance(stmt))));
  const [date, setDate] = useState(stmt.tradeDate || today());
  const [method, setMethod] = useState<PaymentMethod>('계좌이체');
  const [note, setNote] = useState('');
  const [scope, setScope] = useState<'stmt' | 'partner'>('stmt');   // 기본은 '이 전표'
  const [overWarn, setOverWarn] = useState(false);

  const paid = Math.round(stmt.totalAmount - getBalance(stmt));
  const pb = partnerBalances.get(stmt.partnerId);
  const partnerLeft = isBuy ? (pb?.payable ?? 0) : (pb?.receivable ?? 0);

  const submit = (forceOver: boolean) => {
    const amt = Number(amount);
    if (!amount || amt <= 0) return;
    //  초과 판정은 **거래처 잔액 기준** — 돈은 전표가 아니라 거래처 채권·채무에서 빠진다.
    const live = latestStatement(stmt.id) ?? stmt;
    const lb = partnerBalances.get(live.partnerId);
    const bal = live.type === '매입' ? (lb?.payable ?? 0) : (lb?.receivable ?? 0);
    if (amt > bal && !forceOver) { setOverWarn(true); return; }
    setOverWarn(false);
    onSettle(live, { amount: amt, date, method, note: note.trim(), scope });
  };

  /** 어디에 붙일지 — 고른 쪽이 켜지고 그 금액이 찍힌다 */
  const box = (k: 'stmt' | 'partner', label: string, amt: number, hint: string) => {
    const on = scope === k;
    //  상자를 바꿔도 **날짜는 안 건드린다** — 전표에서 연 수금·지불이라 기본은 언제나 그 전표 날짜다.
    return (
      <button onClick={() => { setScope(k); setAmount(String(Math.round(amt))); }}
        className={`flex-1 text-left rounded-xl px-3 py-2.5 border transition-all ${
          on ? 'bg-indigo-50 border-indigo-400 ring-2 ring-indigo-300' : 'bg-slate-50 border-slate-200 hover:border-indigo-300'}`}>
        <div className={`text-[10px] font-black uppercase tracking-widest ${on ? 'text-indigo-600' : 'text-slate-400'}`}>{label}</div>
        <div className={`font-black text-base ${amt <= 0 ? 'text-emerald-600' : on ? 'text-indigo-800' : 'text-slate-800'}`}>
          {amt <= 0 ? '없음' : `${fmt(Math.round(amt))}원`}
        </div>
        <div className={`text-[10px] ${on ? 'text-indigo-400' : 'text-slate-400'}`}>{hint}</div>
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-black text-slate-800">{isBuy ? '지불 처리' : '수금 처리'}</h3>
        <div className="text-xs text-slate-400">{stmt.partnerName} · {stmt.tradeDate}</div>

        {/* 이미 낸 게 있으면 먼저 밝힌다 — 갚아 놓고 또 누르는 걸 막는 건 이 한 줄이다 */}
        {paid > 0 && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 text-[11px] font-black text-emerald-700">
            이 전표에 이미 {fmt(paid)}원 {isBuy ? '지불' : '수금'}했습니다
            &#12288;<span className="text-emerald-500">(전표 {fmt(Math.round(stmt.totalAmount))}원 중 남은 {fmt(Math.round(getBalance(stmt)))}원)</span>
          </div>
        )}

        <div className="flex gap-2">
          {box('stmt', '이 전표', getBalance(stmt), '이 전표부터 갚음')}
          {box('partner', '거래처 잔액', partnerLeft, '오래된 전표부터 갚음')}
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">금액</label>
            <input type="text" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-300"/>
          </div>
          {cashAccounts.length > 0 && (
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">{isBuy ? '출금 계좌' : '입금 계좌'}</label>
              <select value={accountId} onChange={e => onAccountId(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-300">
                {cashAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <p className="text-[10px] text-slate-400 mt-1">현금출납장에 자동으로 기록되고 이 전표에 매칭됩니다.</p>
            </div>
          )}
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">일자</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-300"/>
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">결제 방법</label>
            <div className="flex gap-1.5 flex-wrap">
              {(['현금', '계좌이체', '어음', '카드', '기타'] as PaymentMethod[]).map(m => (
                <button key={String(m)} onClick={() => setMethod(m)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-black border transition-all ${method === m ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">비고</label>
            <input type="text" placeholder="예: 1차 분할" value={note} onChange={e => setNote(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300"/>
          </div>
        </div>

        {overWarn && (() => {
          const live = latestStatement(stmt.id) ?? stmt;
          return (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs space-y-2">
              <p className="font-black text-amber-700">
                입력금액이 잔액({fmt(getBalance(live))}원)을 초과합니다. 초과분은 {overLabelOf(stmt.type)}으로 전환됩니다.
              </p>
              <div className="flex gap-2">
                <button onClick={() => setOverWarn(false)} className="flex-1 py-1.5 rounded-lg bg-slate-200 text-slate-600 font-black">취소</button>
                <button onClick={() => submit(true)} className="flex-1 py-1.5 rounded-lg bg-amber-500 text-white font-black">계속 진행</button>
              </div>
            </div>
          );
        })()}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-xs font-black hover:bg-slate-200">취소</button>
          <button onClick={() => submit(false)} disabled={!amount || Number(amount) <= 0}
            className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-black hover:bg-blue-700 disabled:opacity-40 flex items-center justify-center gap-1.5">
            <Save size={12}/>저장
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 이미 난 자금 전표 고치기 ─────────────────────────────────────────────────

function EditBody({ entry, accountCodes, partnerBalances, onClose, onSaveEdit, onDeleteEntry }: Props & { entry: CashEntry }) {
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
    (entry.lines ?? []).map(l => ({ accountCode: l.accountCode, amount: String(l.amount), note: l.note ?? '' })));

  //  판정은 shared/cashEntryEdit이 쥔다 — 화면 조각이라 테스트가 안 닿던 자리였다.
  const isOffset = entry.dir === '대체';
  const split = cashEditSplit(lines);
  const splitSum = split.reduce((a, l) => a + l.amount, 0);
  const amt = cashEditAmount(form, lines, isOffset);
  const locked = split.length > 0 && !isOffset;   // 쪼갠 전표의 금액은 줄 합이다

  const codeOptions = [...accountCodes].sort(byCode).map(ac => (
    <option key={ac.id} value={ac.code}>{ac.code} {ac.name}</option>
  ));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-sm font-black text-slate-800">자금 전표 수정</h3>
            {/* 거래처를 안 보여줘서 어느 거래처 돈인지 모르고 고쳤다. 잔액도 같이 띄운다. */}
            {entry.partnerName ? (() => {
              const bal = entry.partnerId ? partnerBalances.get(entry.partnerId) : undefined;
              const ar = bal?.receivable ?? 0, ap = bal?.payable ?? 0;
              return (
                <p className="text-[11px] font-bold text-slate-500 mt-0.5">
                  {entry.partnerName}
                  {ar !== 0 && <span className="ml-1.5 text-blue-600">미수 {fmt(ar)}</span>}
                  {ap !== 0 && <span className="ml-1.5 text-rose-600">미지급 {fmt(ap)}</span>}
                </p>
              );
            })() : <p className="text-[11px] font-bold text-slate-300 mt-0.5">거래처 없음</p>}
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:bg-slate-100 rounded-lg"><X size={16}/></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">구분</label>
            <div className="flex gap-1.5">
              {(['입금','출금'] as const).map(d => (
                <button key={d} disabled={isOffset} onClick={() => setForm(p => ({ ...p, dir: d }))}
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
              value={locked ? String(splitSum) : form.amount} readOnly={locked}
              onChange={e => setForm(p => ({ ...p, amount: e.target.value.replace(/[^\d.]/g,'') }))}
              className={`w-full border rounded-xl px-3 py-2 text-sm font-bold text-right outline-none focus:ring-2 focus:ring-blue-300 ${locked ? 'border-slate-100 bg-slate-50 text-slate-500' : 'border-slate-200'}`}/>
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">일자</label>
            <input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-300"/>
          </div>
          <div>
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
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">비고</label>
            <input type="text" value={form.note} onChange={e => setForm(p => ({ ...p, note: e.target.value }))}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300"/>
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          {onDeleteEntry && (
            <button onClick={() => { if (window.confirm('이 자금 전표를 삭제할까요?')) { onDeleteEntry(entry.id); onClose(); } }}
              className="flex items-center gap-1 px-3 py-2.5 rounded-xl bg-red-50 text-red-600 text-xs font-black hover:bg-red-100 border border-red-200"><Trash2 size={12}/>삭제</button>
          )}
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-xs font-black hover:bg-slate-200">취소</button>
          <button onClick={() => onSaveEdit(entry, form, lines)} disabled={amt <= 0}
            className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-black hover:bg-blue-700 disabled:opacity-40 flex items-center justify-center gap-1.5"><Save size={12}/>저장</button>
        </div>
      </div>
    </div>
  );
}
