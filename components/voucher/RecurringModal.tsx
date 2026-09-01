import React, { useState } from 'react';
import { X } from 'lucide-react';
import type { FixedCostTemplate, AccountCode, Partner } from '../../src/shared/types';
import { canAutoIssue, autoVoucherId, issueDateOf } from '../../src/shared/autoVoucher';
import VoucherTemplateManager from '../VoucherTemplateManager';

/**
 * **템플릿 창** — 매달 같은 날 같은 금액으로 서는 전표를 여기서 본다.
 *
 * 두 가지를 한 자리에서 한다.
 *   ① 템플릿 목록 손보기 (`VoucherTemplateManager`)
 *   ② 그 달에 아직 안 선 것을 **한 줄씩** 발행하기
 *
 * **통째로 내는 단추는 일부러 없다.** 한 번에 다 내면 뭘 냈는지 안 남고,
 * 잘못 낸 걸 되돌릴 때 어디부터 손대야 할지 모른다. 줄마다 낸다.
 *
 * 이미 냈는지는 `autoVoucherId`로 만든 열쇠 하나로 본다 — 스케줄러·AdminApp이
 * 쓰는 것과 **같은 판정**이라야 앱에서 낸 것과 저절로 난 것이 겹치지 않는다.
 */
interface Props {
  templates: FixedCostTemplate[];
  accountCodes: AccountCode[];
  partners: Partner[];
  /** 이 열쇠로 이미 선 전표가 있나 — 전표·자금 목록을 통째로 넘기지 않으려고 물음만 받는다 */
  isIssued: (_key: string) => boolean;
  onClose: () => void;
  /** 그 달의 그 템플릿을 발행한다. 몇 건 났는지 돌려준다(0이면 이미 있었다는 뜻). */
  onGenerate?: (_ym: string, _templateId: string) => Promise<number>;
  onCreateTemplate?: (_data: Omit<FixedCostTemplate, 'id'>) => void | Promise<void>;
  onUpdateTemplate?: (_id: string, _patch: Partial<FixedCostTemplate>) => void | Promise<void>;
  onDeleteTemplate?: (_id: string) => void | Promise<void>;
}

const fmt = (n: number) => n.toLocaleString('ko-KR');
const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export default function RecurringModal({
  templates, accountCodes, partners, isIssued, onClose,
  onGenerate, onCreateTemplate, onUpdateTemplate, onDeleteTemplate,
}: Props) {
  const [ym, setYm] = useState(thisMonth());
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  //  자동 발행 대상 — AdminApp·스케줄러와 같은 판정(shared/autoVoucher)
  const due = templates.filter(t => canAutoIssue(t, ym));
  const done = (t: FixedCostTemplate) => isIssued(autoVoucherId(t, ym));
  const pending = due.filter(t => !done(t));
  const total = pending.reduce((a, t) => a + t.amount, 0);

  /** 한 줄만 발행 — 통째로 내면 뭘 냈는지 안 남는다 */
  const runOne = async (t: FixedCostTemplate) => {
    if (!onGenerate || busy) return;
    setBusy(true);
    try {
      const n = await onGenerate(ym, t.id);
      setMsg(n > 0 ? `${t.name} 발행했습니다.` : `${t.name} — 이미 발행돼 있습니다.`);
    } catch (e) {
      setMsg(`발행 실패: ${(e as Error)?.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl p-6 space-y-4 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-black text-slate-800">템플릿</h3>
          <button onClick={onClose} aria-label="닫기" className="text-slate-300 hover:text-slate-500"><X size={18} /></button>
        </div>
        <p className="text-[11px] text-slate-400 leading-snug">
          일반전표 발행에서 고르는 <b>템플릿</b> 목록입니다. 스위치를 켜면 매달 정한 날에
          저절로 발행됩니다(앱을 안 켜도 됩니다). 새 템플릿은 일반전표 발행에서 <b>[템플릿으로 저장]</b>으로 만듭니다.
        </p>

        {/* 목록·수정은 한 곳에서만 — 여러 화면에 두면 어느 게 진짜인지 흐려진다 */}
        <VoucherTemplateManager
          templates={templates}
          accountCodes={accountCodes}
          partners={partners}
          onUpdate={onUpdateTemplate}
          onDelete={onDeleteTemplate}
          onCreate={onCreateTemplate}
          compact
        />

        <div>
          <label htmlFor="recurring-ym" className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">대상 월</label>
          <input id="recurring-ym" type="month" value={ym} onChange={e => { setYm(e.target.value); setMsg(''); }}
            className="border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-violet-300" />
        </div>

        {due.length === 0 ? (
          <p className="text-[11px] font-bold text-amber-700 bg-amber-50 rounded-xl px-4 py-3">
            이 달에 자동 발행할 것이 없습니다. 위 목록에서 스위치를 켜세요.
          </p>
        ) : (
          <div role="list" aria-label="자동 발행 대상" className="space-y-1.5">
            {due.map(t => {
              const already = done(t);
              const ac = accountCodes.find(c => c.code === t.accountCode);
              return (
                <div key={t.id} role="listitem" aria-label={t.name} className={`flex items-center gap-3 rounded-xl px-4 py-2.5 ${already ? 'bg-slate-50 opacity-50' : 'bg-violet-50/60'}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-black text-slate-800 truncate">{t.name}</p>
                    <p className="text-[10px] text-slate-400">
                      {t.accountCode} {ac?.name ?? ''}{t.partnerName ? ` · ${t.partnerName}` : ''}
                    </p>
                  </div>
                  {/* 나가는 날 — 안 보이면 언제 서는 전표인지 모른다(issueDay 31은 말일로 친다) */}
                  <span className="text-[10px] font-black text-slate-400 tabular-nums shrink-0">{issueDateOf(ym, t.issueDay)}</span>
                  <p className="text-xs font-black text-slate-700 tabular-nums shrink-0 w-24 text-right">{fmt(t.amount)}</p>
                  {already ? (
                    <span className="text-[10px] font-black px-2.5 py-1 rounded-lg shrink-0 bg-slate-200 text-slate-500">발행됨</span>
                  ) : (
                    <button onClick={() => runOne(t)} disabled={busy}
                      className="text-[10px] font-black px-2.5 py-1 rounded-lg shrink-0 bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 transition-all">
                      발행
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {pending.length > 0 && (
          <div className="flex items-center justify-between border-t border-slate-100 pt-3">
            <span className="text-[11px] font-bold text-slate-400">{pending.length}건 생성 예정</span>
            <span className="text-base font-black text-slate-800">합계 {fmt(total)}원</span>
          </div>
        )}

        {msg && <p className="text-[11px] font-black text-emerald-700 bg-emerald-50 rounded-xl px-4 py-2.5">{msg}</p>}

        {/* 통째로 내는 버튼은 없앴다 — 줄마다 발행한다 */}
        <button onClick={onClose}
          className="w-full py-2.5 rounded-xl bg-slate-100 text-slate-500 text-xs font-black hover:bg-slate-200 transition-all">닫기</button>
      </div>
    </div>
  );
}
