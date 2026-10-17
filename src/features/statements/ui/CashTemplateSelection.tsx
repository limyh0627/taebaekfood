import React, { useMemo, useState } from 'react';
import type { AccountCode } from '../../../shared/types';
import ModalShell from '../../../shared/components/ModalShell';
import { VOUCHER_DIRS, DIR_CHIP, DIR_HINT, type CashTemplate, type VoucherDir } from '../domain/cashTemplateCatalog';

export function CashTemplateModal({
  templates, accountCodes, activeId, onPick, onDirect, onClose, hideDirectionTabs = false, directionLabel,
}: {
  templates: CashTemplate[];
  accountCodes: AccountCode[];
  hideDirectionTabs?: boolean;
  directionLabel?: string;
  activeId: string | null;
  onPick: (t: CashTemplate) => void;
  /** 템플릿을 안 쓰고 직접 입력 — 고른 템플릿을 푼다 */
  onDirect: () => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('');
  const groupNames = [...new Set(templates.map(t => t.group?.trim() || '분류없음'))].sort();
  const [tab, setTab] = useState<'all' | 'fav' | VoucherDir>('all');
  const nameOfCode = (code?: string) => accountCodes.find(c => c.code === code)?.name ?? '';
  const shown = useMemo(() => {
    const s = q.trim();
    return templates
      .filter(t => !selectedGroup || (t.group?.trim() || '분류없음') === selectedGroup)
      .filter(t => tab === 'all' ? true : tab === 'fav' ? t.favorite : t.dir === tab)
      .filter(t => !s || t.label.includes(s) || (t.partnerName ?? '').includes(s)
        || (t.accountCode ?? '').includes(s) || nameOfCode(t.accountCode).includes(s));
  }, [templates, q, tab, accountCodes, selectedGroup]);
  return (
    <ModalShell title={`템플릿 ${shown.length === templates.length ? templates.length : `${shown.length}/${templates.length}`}`} onClose={onClose}
      className="h-[80dvh]" bodyClassName="flex min-h-0 flex-col !p-0"
      footer={<button onClick={onClose} className="w-full rounded-xl bg-slate-100 py-2.5 text-xs font-black text-slate-600 hover:bg-slate-200">닫기</button>}>
        {/* 방향(출금·입금·발생)은 고른 템플릿이 정한다 — 여기서 먼저 고르게 하면
            템플릿 화면과 목록이 달라 보이고, 방향을 잘못 잡으면 찾던 게 안 뜬다. */}
        <div className="px-4 py-3 border-b border-slate-100 shrink-0 space-y-2.5 md:px-5">
          <div className="flex items-center gap-3 flex-wrap">
            <select aria-label="템플릿 그룹" value={selectedGroup} onChange={e => setSelectedGroup(e.target.value)} className="max-w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs">
              <option value="">전체 그룹</option>{groupNames.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            <input type="text" autoFocus placeholder="이름·거래처·계정 검색" value={q} onChange={e => setQ(e.target.value)}
              className="flex-1 min-w-0 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300"/>
          </div>
          <div className="flex gap-1 flex-wrap">
            {(['all', 'fav', ...(hideDirectionTabs ? [] : VOUCHER_DIRS)] as const).map(v => (
              <button key={v} type="button" onClick={() => setTab(v)}
                title={v === 'all' || v === 'fav' ? undefined : DIR_HINT[v]}
                className={`px-2 py-1 rounded-lg text-[11px] font-black border transition-all ${tab === v
                  ? v === 'fav' ? 'bg-amber-400 text-white border-amber-400'
                    : v === 'all' ? 'bg-indigo-600 text-white border-indigo-600'
                    : `${DIR_CHIP[v as VoucherDir]} border-transparent`
                  : 'bg-white text-slate-400 border-slate-200 hover:border-slate-400'}`}>
                {v === 'all' ? '전체' : v === 'fav' ? '★' : v}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
          {/* 직접입력은 템플릿이 아니라 '템플릿 없음'이라 목록 밖에 둔다 */}
          <button type="button" onClick={onDirect}
            className={`w-full px-3 py-2.5 rounded-xl border text-left transition-all flex items-baseline justify-between gap-2 ${
              activeId === null
                ? 'bg-slate-700 text-white border-slate-700 shadow-sm'
                : 'bg-white text-slate-600 border-dashed border-slate-300 hover:border-slate-500'}`}>
            <span className="text-sm font-black leading-tight">직접입력</span>
            <span className={`text-[10px] font-bold leading-tight shrink-0 ${activeId === null ? 'opacity-70' : 'opacity-60'}`}>
              템플릿 없이 계정 직접 선택
            </span>
          </button>
          {shown.length === 0 ? (
            <p className="h-full flex items-center justify-center text-xs font-bold text-slate-300">찾는 템플릿이 없습니다</p>
          ) : (
            <CashTemplatePicker templates={shown} accountCodes={accountCodes} activeId={activeId} onPick={onPick} directionLabel={directionLabel} />
          )}
        </div>
    </ModalShell>
  );
}

export function CashTemplatePicker({
  templates, accountCodes, activeId, onPick, directionLabel,
}: {
  templates: CashTemplate[];
  accountCodes: AccountCode[];
  activeId: string | null;
  onPick: (t: CashTemplate) => void;
  directionLabel?: string;
}) {
  const nameOf = (code?: string) => accountCodes.find(c => c.code === code)?.name ?? '';
  // 묶음별로 갈라 그린다 — 30개가 한 줄로 이어지면 눈으로 못 찾는다.
  // 즐겨찾기는 묶음과 상관없이 맨 위로 모은다 — 매일 쓰는 서너 개를 찾아 내려가는 게 병목이라서.
  const groups: { name: string; items: CashTemplate[] }[] = [];
  const favs = templates.filter(t => t.favorite);
  if (favs.length) groups.push({ name: '★ 즐겨찾기', items: favs });
  for (const t of templates) {
    if (t.favorite) continue;
    const g = t.group?.trim() || '분류없음';
    const last = groups.find(x => x.name === g);
    if (last) last.items.push(t); else groups.push({ name: g, items: [t] });
  }
  const card = (t: CashTemplate) => {
    const on = activeId === t.id;
    const unavailable = !!t.unavailableCodes?.length;
    return (
      <button key={t.id} type="button" disabled={unavailable} onClick={() => onPick(t)}
        title={unavailable ? `현재 회사 계정표에 없는 계정: ${t.unavailableCodes!.join(', ')}` : t.accountCode ? `${t.dir} · ${t.accountCode} ${nameOf(t.accountCode)}` : t.hint}
        className={`w-full px-3 py-2.5 rounded-xl border text-left transition-all flex items-center justify-between gap-2 ${
          unavailable ? 'bg-amber-50 border-amber-200 cursor-not-allowed' : on ? 'bg-white border-indigo-500 ring-1 ring-indigo-500 shadow-sm' : 'bg-white border-slate-200 hover:border-slate-400'
        }`}>
        <span className="flex items-center gap-2 min-w-0">
          <span title={DIR_HINT[t.dir]} className={`shrink-0 w-11 text-center text-[10px] font-black px-1 py-1 rounded-md ${DIR_CHIP[t.dir] ?? 'bg-slate-100 text-slate-500'}`}>
            {directionLabel ?? t.dir}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-black text-slate-800 leading-tight truncate">
              {t.label}
              {t.mode !== '일반' && <span className="ml-1.5 text-[9px] font-black px-1 py-0.5 rounded bg-indigo-50 text-indigo-600">{t.mode}</span>}
            </span>
            {(t.partnerName || t.accountCode || t.hint) && (
              <span className="block text-[10px] font-bold text-slate-400 leading-tight truncate">
                {t.accountCode ? `${t.accountCode} ${nameOf(t.accountCode)}` : t.hint}
                {t.partnerName && ` · ${t.partnerName}`}
              </span>
            )}
            {unavailable && <span className="block text-[10px] font-bold text-amber-700 leading-tight">현재 회사 계정표에 {t.unavailableCodes!.join(', ')} 없음 · 템플릿에서 계정 확인</span>}
          </span>
        </span>
        {t.amount ? (
          <span className="shrink-0 text-xs font-black text-slate-700 tabular-nums">{t.amount.toLocaleString('ko-KR')}</span>
        ) : null}
      </button>
    );
  };
  return (
    // 한 행에 하나 — 이름과 계정이 한눈에 같이 읽혀야 잘못 고르지 않는다
    <div className="flex flex-col gap-3">
      {groups.map(g => (
        <div key={g.name} className="flex flex-col gap-1">
          <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest px-1">{g.name}</span>
          {g.items.map(t => <React.Fragment key={t.id}>{card(t)}</React.Fragment>)}
        </div>
      ))}
    </div>
  );
}
