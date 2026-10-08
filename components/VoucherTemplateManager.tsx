import { templateStatementType, templateStatementConflict, canAutoStatement, type TemplateStatementType } from '../src/shared/templateStatementType';
import { appConfirm, appPrompt, appNotice } from '../src/shared/components/appDialog';
import React, { useMemo, useState, useRef } from 'react';
import { X, Check, BarChart2, FolderPlus, Pencil, Copy, Eye, EyeOff, Star } from 'lucide-react';
import { FixedCostTemplate, AccountCode, Partner } from '../src/shared/types';
import { VOUCHER_DIRS, DIR_CHIP, DIR_HINT, isCashDir, VoucherDir, SPLIT_MODES, splitModeOf, templateJournalLines, missingTemplateAccountCodes, CashTemplate } from '../src/shared/cashTemplates';
import { useLoanContracts } from '../src/shared/useLoanContracts';
import { matchingLoan, LINKED_LOAN_AUTO_NOTICE } from '../src/shared/loanLedger';
import type { CompanyId } from '../src/shared/types';
import ModalShell from '../src/shared/components/ModalShell';

/** 두 줄 갈래 템플릿에서 a·b 칸에 들어갈 저장값을 꺼낸다 (갈래마다 필드 이름이 다르다) */
const splitValOf = (t: { mode?: string } & Record<string, any>, which: 'a' | 'b'): string => {
  const sm = splitModeOf(t.mode);
  if (!sm) return '';
  const v = t[SPLIT_MODES[sm][which]];
  return v ? String(v) : '';
};

/**
 * 전표 템플릿 관리 — 일반전표 발행의 '템플릿'가 여기서 정해진다.
 *
 * **목록은 한 곳에만 둔다.** 전에 손익화면과 전표화면 두 군데에 있었는데, 같은 것이 두 번
 * 보이니 어느 쪽이 진짜인지 흐려졌다. 쓰는 자리(전표 화면) 옆에 붙여 둔다.
 *
 * 자동 발행 스위치는 **실제 발행 조건과 같은 값**(autoIssue)을 그린다. 예전엔 옛 집계용
 * 필드(active)를 그려서, 켜 둔 것이 화면에는 꺼진 것처럼 보였다.
 */
const fmt = (n: number) => n.toLocaleString('ko-KR');
/** 묶음이 없으면 여기로 모인다 — 새 템플릿의 기본값 */
export const NO_GROUP = '분류없음';

export default function VoucherTemplateManager({
  templates, accountCodes, partners = [], onUpdate, onDelete, onCreate, compact = false, onFilterChange, onGroupChange, onSearchChange, companyId = 'taebaek',
}: {
  companyId?: CompanyId;
  templates: FixedCostTemplate[];
  accountCodes: AccountCode[];
  partners?: Partner[];
  onUpdate?: (id: string, data: Partial<FixedCostTemplate>) => Promise<void> | void;
  onDelete?: (id: string) => Promise<void> | void;
  /** 기본 템플릿을 복제해 새로 만든다 — 기본은 손대지 않는다 */
  onCreate?: (data: Omit<FixedCostTemplate, 'id'>) => Promise<void> | void;
  /** 모달 안이면 높이를 제한한다 */
  compact?: boolean;
  onFilterChange?: (filter: 'all' | 'auto' | 'hidden') => void;
  onGroupChange?: (group: string) => void;
  onSearchChange?: (search: string) => void;
}) {
  const loans = useLoanContracts(companyId);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'auto' | 'hidden'>('all');
  const [selectedGroup, setSelectedGroup] = useState('');
  const [editTpl, setEditTpl] = useState<FixedCostTemplate | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const detailTpl = templates.find(t => t.id === selectedId);
  const [busy, setBusy] = useState(false);
  const actionLock = useRef(false);
  const runAction = async (action: () => Promise<void>) => {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true);
    try { await action(); }
    catch (error) { await appNotice('처리하지 못했습니다. 화면과 입력을 유지합니다. 다시 시도해 주세요. ' + String(error), '저장 실패'); }
    finally { actionLock.current = false; setBusy(false); }
  };
  // 분개 미리보기 — 평소엔 접어 둔다. 차·대는 사용자가 고르는 게 아니라 확인하는 것이다.
  const [showJournal, setShowJournal] = useState(false);
  /**
   * 복제 모드 — 원본을 안 고치고 뼈대만 물려받아 새로 만든다.
   * 기본 템플릿은 깨끗하게 남아 있어야 나중에 다시 꺼내 쓸 수 있고, 손으로 만든 것도
   * 금액·날짜만 다른 변형을 자주 쓴다(차량 리스가 둘, 보험료가 여럿).
   */
  const [cloning, setCloning] = useState(false);
  const [form, setForm] = useState({
    name: '', group: '', amount: '', splitA: '', splitB: '', loanCode: '', loanId: '', accountCode: '', partnerId: '', partnerName: '',
    dir: '출금' as VoucherDir, statementType: '비용' as TemplateStatementType, autoIssue: false, issueDay: '1', taxExempt: false, itemName: '',
  });
  const dirOf = (t: FixedCostTemplate): VoucherDir => t.dir ?? '출금';
  // 거래처는 이름만 적으면 소용없다 — id가 붙어야 미지급금이 그 거래처로 잡힌다
  const [partnerQuery, setPartnerQuery] = useState('');
  const [partnerOpen, setPartnerOpen] = useState(false);
  const partnerHits = useMemo(() => {
    const q = partnerQuery.trim();
    return (q ? partners.filter(x => x.name.includes(q)) : partners).slice(0, 8);
  }, [partners, partnerQuery]);

  const shown = useMemo(() => {
    const q = search.trim();
    return [...templates]
      .filter(t => filter === 'auto' ? t.autoIssue : filter === 'hidden' ? t.hidden : true)
      .filter(t => !selectedGroup || (t.group?.trim() || NO_GROUP) === selectedGroup)
      .filter(t => !q || t.name.includes(q) || (t.partnerName ?? '').includes(q) || (t.accountCode ?? '').includes(q))
      .sort((a, b) => (a.group ?? '기타').localeCompare(b.group ?? '기타') || a.name.localeCompare(b.name));
  }, [templates, search, filter, selectedGroup]);

  /**
   * 묶음별로 갈라 그린다. 즐겨찾기는 묶음과 상관없이 **맨 위로** 따로 모은다 —
   * 30개 넘는 목록에서 매일 쓰는 서너 개를 매번 찾아 내려가는 게 실제 병목이다.
   */
  const groups = useMemo(() => {
    const out: { name: string; items: FixedCostTemplate[] }[] = [];
    const favs = shown.filter(t => t.favorite);
    if (favs.length) out.push({ name: '★ 즐겨찾기', items: favs });
    for (const t of shown) {
      if (t.favorite) continue;
      const g = t.group?.trim() || NO_GROUP;
      const last = out.find(x => x.name === g);
      if (last) last.items.push(t); else out.push({ name: g, items: [t] });
    }
    return out;
  }, [shown]);

  /** 이미 쓰이고 있는 묶음 이름 — 옮길 때 고르는 목록이 된다 */
  const groupNames = useMemo(() => {
    const set = new Set<string>();
    for (const t of templates) { const g = t.group?.trim(); if (g && g !== NO_GROUP) set.add(g); }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [templates]);

  /** 기본 템플릿을 씨앗으로 새 템플릿 만들기 — 이름에 표시를 달아 구별한다 */
  /**
   * 복제 — 원본은 그대로 두고 뼈대(갈래·계정·거래처)만 물려받아 새로 만든다.
   * 이름은 기본 템플릿이면 '(내 템플릿)', 손으로 만든 것이면 '(사본)'을 붙인다.
   * 같은 이름이 둘이면 목록에서 어느 것을 고르는지 알 수 없다.
   */
  const openClone = (t: FixedCostTemplate) => {
    openEdit(t, true);
    setForm(f => ({ ...f, name: `${t.name} ${t.builtin ? '(내 템플릿)' : '(사본)'}` }));
  };

  const openEdit = (t: FixedCostTemplate, clone = false) => {
    setShowJournal(false);
    setEditTpl(t);
    setCloning(clone);
    setForm({
      name: t.name, group: t.group ?? '', amount: t.amount ? String(t.amount) : '',
      splitA: splitValOf(t, 'a'), splitB: splitValOf(t, 'b'), loanCode: (t as any).loanCode ?? '', loanId: t.loanId ?? '', accountCode: t.accountCode ?? '',
      partnerId: t.partnerId ?? '', partnerName: t.partnerName ?? '',
      dir: dirOf(t), statementType: templateStatementType(t), autoIssue: !!t.autoIssue && (isCashDir(dirOf(t)) || canAutoStatement(t)), issueDay: String(t.issueDay ?? 1), taxExempt: !!t.taxExempt,
      itemName: t.itemName ?? '',
    });
    setPartnerQuery(''); setPartnerOpen(false);
  };

  return (
    <div className="border border-slate-200 rounded-2xl overflow-hidden">
      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest shrink-0">
          템플릿 <span className="text-slate-300">{templates.length}</span>
        </span>
        <div className="ml-auto flex min-w-0 flex-wrap items-center gap-1.5">
          <select aria-label="템플릿 그룹" value={selectedGroup}
            onChange={event => { setSelectedGroup(event.target.value); onGroupChange?.(event.target.value); }}
            className="max-w-36 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-600">
            <option value="">전체 그룹</option>
            {groupNames.map(group => <option key={group} value={group}>{group}</option>)}
            <option value={NO_GROUP}>{NO_GROUP}</option>
          </select>
          <input type="text" placeholder="이름·거래처 검색" value={search} onChange={e => { setSearch(e.target.value); onSearchChange?.(e.target.value); }}
            className="w-32 bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300"/>
          <div className="flex bg-slate-200/70 rounded-lg p-0.5 gap-0.5">
            {([['all', '전체'], ['auto', '자동'], ['hidden', '숨김']] as const).map(([v, lbl]) => (
              <button key={v} onClick={() => { setFilter(v); onFilterChange?.(v); }}
                className={`px-2 py-0.5 rounded-md text-[11px] font-black transition-all ${filter === v ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>
                {lbl}
              </button>
            ))}
          </div>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className={`text-center text-slate-300 ${compact ? 'h-[42vh] flex flex-col items-center justify-center' : 'py-8'}`}>
          <BarChart2 size={24} className="mx-auto mb-2 opacity-40"/>
          <p className="text-xs font-bold">해당하는 템플릿이 없습니다</p>
        </div>
      ) : (
        // 검색으로 걸러져도 높이가 안 변해야 한다 — max-h면 결과가 줄 때마다 창이 뛴다
        <div className={compact ? 'h-[42vh] overflow-y-auto' : ''}>
          {groups.map(g => (
            <div key={g.name}>
              <div className="px-4 py-1 bg-slate-50/70 border-y border-slate-100 flex items-center gap-2">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{g.name}</span>
                <span className="text-[10px] font-bold text-slate-300">{g.items.length}</span>
              </div>
              <div className="divide-y divide-slate-50">
                {g.items.map(t => (
                  <button key={t.id} type="button" aria-label={t.name + ' 상세보기'}
                    onClick={() => setSelectedId(t.id)}
                    className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400">
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-bold text-slate-800 truncate">{t.name}</span>
                      <span className="block mt-1 text-xs text-slate-400 truncate">
                        {t.accountCode ? t.accountCode + ' ' + (accountCodes.find(c => c.code === t.accountCode)?.name ?? '') : '계정 직접선택'}
                        {t.partnerName && ' · ' + t.partnerName}
                      </span>
                      {missingTemplateAccountCodes(t, new Set(accountCodes.map(c => c.code))).length > 0 && <span className="block mt-1 text-xs text-rose-600"><b>계정 없음</b> · <span>현재 회사 계정표에 {missingTemplateAccountCodes(t, new Set(accountCodes.map(c => c.code))).join(', ')} 없음</span></span>}
                      <span className="block mt-1 text-[11px] text-slate-500">
                        {dirOf(t)} · {t.autoIssue ? '매월 ' + ((t.issueDay ?? 1) === 31 ? '말일' : (t.issueDay ?? 1) + '일') + ' 자동' : '수동'}
                        {t.hidden && ' · 숨김'}{t.builtin && ' · 기본'}{t.favorite && ' · 즐겨찾기'}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-bold text-slate-800 tabular-nums">{fmt(t.amount)}원</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {detailTpl && !editTpl && (
        <ModalShell title="템플릿 상세보기" subtitle={detailTpl.name} layer={1100}
          onClose={() => { if (!actionLock.current) setSelectedId(''); }} bodyClassName="space-y-5">
          <div aria-busy={busy}>
            {missingTemplateAccountCodes(detailTpl, new Set(accountCodes.map(c => c.code))).length > 0 && <p className="mb-3 text-sm text-rose-600">현재 회사 계정표에 {missingTemplateAccountCodes(detailTpl, new Set(accountCodes.map(c => c.code))).join(', ')} 없음 — 계정을 수정해 주세요.</p>}
            <h4 className="text-lg font-bold text-slate-900">{detailTpl.name}</h4>
            <p className="mt-1 text-xl font-bold text-slate-800">{fmt(detailTpl.amount)}원</p>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div><dt className="text-xs text-slate-400">묶음</dt><dd className="mt-1">{detailTpl.group?.trim() || NO_GROUP}</dd></div>
              <div><dt className="text-xs text-slate-400">발행 갈래</dt><dd className="mt-1">{dirOf(detailTpl)} · {detailTpl.mode || '일반'}</dd></div>
              <div><dt className="text-xs text-slate-400">계정과목</dt><dd className="mt-1">{detailTpl.accountCode} {accountCodes.find(c => c.code === detailTpl.accountCode)?.name || '계정 미지정'}</dd></div>
              <div><dt className="text-xs text-slate-400">거래처</dt><dd className="mt-1">{detailTpl.partnerName || '선택 안 함'}</dd></div>
              <div><dt className="text-xs text-slate-400">자동 발행</dt><dd className="mt-1">{detailTpl.autoIssue ? '매월 ' + ((detailTpl.issueDay ?? 1) === 31 ? '말일' : (detailTpl.issueDay ?? 1) + '일') : '사용 안 함'}</dd></div>
              <div><dt className="text-xs text-slate-400">목록 표시</dt><dd className="mt-1">{detailTpl.hidden ? '숨김' : '표시'}{detailTpl.favorite && ' · 즐겨찾기'}{detailTpl.builtin && ' · 기본 템플릿'}</dd></div>
              {detailTpl.mode === '상환' && <div className="col-span-2"><dt className="text-xs text-slate-400">상환 구성</dt><dd className="mt-1">원금 {fmt(detailTpl.principal ?? 0)}원 · 이자 {fmt(detailTpl.interest ?? 0)}원</dd>
                <p className="mt-1 text-xs text-slate-500">{detailTpl.loanId ? loans.find(l => l.id === detailTpl.loanId && l.companyId === companyId)?.name || '연결 계약 확인 필요' : '대출 계약 연결 안 함'}</p>
                {detailTpl.loanId && <p className="mt-1 text-xs text-slate-500">계약 연결 템플릿은 수동 발행만 가능합니다.</p>}
              </div>}
            </dl>
          </div>
          {busy && <p role="status" className="text-sm text-slate-500">처리 중…</p>}
          <div className="space-y-3">
            <p className="text-xs font-bold text-slate-500">자동 발행 설정</p>
            <button disabled={busy || !onUpdate} title={detailTpl.autoIssue ? '자동 발행 끄기' : '자동 발행 켜기'}
              className="min-h-11 min-w-11 flex items-center justify-center rounded-xl border border-slate-200 px-3 py-3 text-sm font-bold text-slate-700 disabled:opacity-40"
              onClick={() => runAction(async () => {
                if (!detailTpl.autoIssue && detailTpl.mode === '상환' && detailTpl.loanId) { await appNotice(LINKED_LOAN_AUTO_NOTICE); return; }
                const missing = missingTemplateAccountCodes(detailTpl, new Set(accountCodes.map(c => c.code)));
                if (!detailTpl.autoIssue && (!(detailTpl.amount > 0) || !detailTpl.accountCode || missing.length || (!isCashDir(dirOf(detailTpl)) && !canAutoStatement(detailTpl)))) {
                  await appNotice('계정·금액·거래처를 확인한 뒤 자동 발행을 켜 주세요.'); return;
                }
                await onUpdate?.(detailTpl.id, { autoIssue: !detailTpl.autoIssue });
              })}>{detailTpl.autoIssue ? '자동 발행 끄기' : '자동 발행 켜기'}</button>
            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
            <button aria-label="수정" disabled={busy || !onUpdate} title="이름·묶음·금액·발행 방식 수정" onClick={() => openEdit(detailTpl)} className="min-h-11 min-w-11 flex items-center justify-center rounded-xl bg-indigo-600 px-3 py-3 text-sm font-bold text-white disabled:opacity-40"><Pencil size={18}/></button>
            <button aria-label="복제" title="복제" disabled={busy || !onCreate} onClick={() => openClone(detailTpl)} className="rounded-xl border border-slate-200 px-3 py-3 text-sm font-bold text-slate-700 disabled:opacity-40"><Copy size={18}/></button>
            <button aria-label={detailTpl.hidden ? '숨김 해제' : '숨기기'} title={detailTpl.hidden ? '숨김 해제' : '숨기기'} disabled={busy || !onUpdate} onClick={() => runAction(async () => { await onUpdate?.(detailTpl.id, { hidden: !detailTpl.hidden }); })} className="rounded-xl border border-slate-200 px-3 py-3 text-sm font-bold text-slate-700 disabled:opacity-40">{detailTpl.hidden ? <Eye size={18}/> : <EyeOff size={18}/>}</button>
            <button aria-label={detailTpl.favorite ? '즐겨찾기 해제' : '즐겨찾기 추가'} title={detailTpl.favorite ? '즐겨찾기 해제' : '즐겨찾기 추가'} disabled={busy || !onUpdate} onClick={() => runAction(async () => { await onUpdate?.(detailTpl.id, { favorite: !detailTpl.favorite }); })} className="rounded-xl border border-slate-200 px-3 py-3 text-sm font-bold text-slate-700 disabled:opacity-40"><Star size={18} fill={detailTpl.favorite ? 'currentColor' : 'none'}/></button>
            <button disabled={busy || !!detailTpl.builtin || !onDelete} onClick={() => runAction(async () => {
              if (detailTpl.builtin) return;
              if (!await appConfirm({ title: '템플릿 삭제', message: detailTpl.name + ' 템플릿을 삭제할까요?', confirmText: '삭제', tone: 'rose' })) return;
              await onDelete?.(detailTpl.id); setSelectedId('');
            })} className="rounded-xl border border-rose-200 px-3 py-3 text-sm font-bold text-rose-600 disabled:opacity-40">삭제</button>
          </div>
          </div>
          {detailTpl.builtin && <p className="text-xs text-slate-500">기본 템플릿은 삭제할 수 없습니다. 숨겼다가 다시 표시할 수 있습니다.</p>}
        </ModalShell>
      )}

      {/* 수정 — 이름·묶음·금액·거래처·발행 방식 */}
      {editTpl && (
        <ModalShell title={cloning ? '새 템플릿 만들기' : '템플릿 수정'} onClose={() => { if (!actionLock.current) setEditTpl(null); }} layer={1100} bodyClassName="space-y-4">
          {/* 폭 — 분개 미리보기에 계정명이 통째로 들어가야 한다. max-w-sm(384px)에선
    금액칸을 빼고 나면 이름 자리가 손바닥만 해서 '255 부가세…'로 잘렸다. */}
            {cloning ? (
              <p className="text-[11px] font-bold text-indigo-500 bg-indigo-50 rounded-xl px-3 py-2 leading-snug">
                <b>{editTpl.name}</b>의 갈래·계정을 물려받아 새 템플릿을 만듭니다. 원본은 그대로 남습니다.
              </p>
            ) : editTpl.builtin ? (
              <p className="text-[11px] font-bold text-slate-400 bg-slate-50 rounded-xl px-3 py-2 leading-snug">
                기본 템플릿입니다. 이름·금액·거래처는 바꿀 수 있지만 지울 수는 없습니다 — 대신 숨기면 목록에서 빠집니다.
                원본을 남겨 두고 변형을 만들고 싶으면 목록의 복제 버튼을 쓰세요.
              </p>
            ) : null}
            {!!missingTemplateAccountCodes(editTpl, new Set(accountCodes.map(c => c.code))).length &&
              (!!editTpl.transferLines?.length || (editTpl.mode && editTpl.mode !== '일반')) && (
              <p className="text-[11px] font-bold text-amber-700 bg-amber-50 rounded-xl px-3 py-2 leading-snug">
                현재 회사 계정표에 없는 계정이 분개 양식에 들어 있습니다. 이 양식은 여기서 계정을 바꿀 수 없으니 회사 계정표와 템플릿의 분개 계정을 확인해 주세요.
              </p>
            )}
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">이름</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-300"/>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">묶음</label>
                <div className="flex gap-1.5">
                  <select value={groupNames.includes(form.group) ? form.group : (form.group ? '__custom' : '')}
                    onChange={e => { if (e.target.value !== '__custom') setForm(f => ({ ...f, group: e.target.value })); }}
                    className="flex-1 min-w-0 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-300">
                    <option value="">{NO_GROUP}</option>
                    {groupNames.map(g => <option key={g} value={g}>{g}</option>)}
                    {form.group && !groupNames.includes(form.group) && <option value="__custom">{form.group}</option>}
                  </select>
                  <button type="button"
                    onClick={async () => {
                      const name = await appPrompt('새 묶음 이름', '');
                      if (name === null) return;
                      setForm(f => ({ ...f, group: name.trim() }));
                    }}
                    title="새 묶음 만들기"
                    className="shrink-0 px-2.5 rounded-xl border border-slate-200 text-slate-400 hover:border-indigo-400 hover:text-indigo-600 transition-all">
                    <FolderPlus size={16}/>
                  </button>
                </div>
              </div>
              <div className="relative">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
                  거래처 {form.partnerId
                    ? <span className="normal-case text-emerald-600">연결됨</span>
                    : form.partnerName ? <span className="normal-case text-amber-600">이름만 · 연결 안 됨</span> : null}
                </label>
                <div className="flex gap-1.5">
                  <input
                    value={form.partnerId || !partnerOpen ? form.partnerName : partnerQuery}
                    placeholder="업체명 검색..."
                    onFocus={() => { setPartnerQuery(''); setPartnerOpen(true); }}
                    onChange={e => { setPartnerQuery(e.target.value); setForm(f => ({ ...f, partnerId: '', partnerName: e.target.value })); setPartnerOpen(true); }}
                    onBlur={() => setTimeout(() => setPartnerOpen(false), 150)}
                    className="flex-1 min-w-0 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-300"/>
                  {(form.partnerId || form.partnerName) && (
                    <button type="button" onClick={() => { setForm(f => ({ ...f, partnerId: '', partnerName: '' })); setPartnerQuery(''); }}
                      title="거래처 비우기"
                      className="shrink-0 px-2.5 rounded-xl border border-slate-200 text-slate-300 hover:text-rose-500 hover:border-rose-300 transition-all"><X size={14}/></button>
                  )}
                </div>
                {partnerOpen && partnerHits.length > 0 && (
                  <div className="absolute left-0 top-full mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-xl z-10 overflow-hidden max-h-52 overflow-y-auto">
                    {partnerHits.map(c => (
                      <button key={c.id} type="button"
                        onMouseDown={() => { setForm(f => ({ ...f, partnerId: c.id, partnerName: c.name })); setPartnerQuery(''); setPartnerOpen(false); }}
                        className="w-full text-left px-3 py-2.5 text-xs font-black text-slate-800 hover:bg-indigo-50 transition-colors border-b border-slate-50 last:border-0">
                        {c.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {(!editTpl.mode || editTpl.mode === '일반') && !editTpl.transferLines?.length && !!editTpl.accountCode && (
              <div>
                <label htmlFor="voucher-template-account" className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">계정과목</label>
                <select id="voucher-template-account" value={form.accountCode}
                  onChange={e => setForm(f => ({ ...f, accountCode: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-300">
                  {!accountCodes.some(c => c.code === form.accountCode) && <option value={form.accountCode}>현재 회사 계정표에 없음 · {form.accountCode}</option>}
                  {accountCodes.map(c => <option key={c.id} value={c.code}>{c.code} · {c.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
                품목명 <span className="normal-case text-slate-300">(비우면 계정과목 이름)</span>
              </label>
              <input value={form.itemName} placeholder={accountCodes.find(c => c.code === form.accountCode)?.name ?? '계정과목 이름'}
                onChange={e => setForm(f => ({ ...f, itemName: e.target.value }))}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-300"/>
              <p className="text-[10px] font-bold text-slate-400 mt-1">전표 품목란에 이대로 찍힙니다.</p>
            </div>
            {/* 두 줄로 갈리는 갈래(보험·상환·급여)는 금액 하나로 못 채운다 — 양식대로 두 칸. */}
            {(() => {
              const sm = splitModeOf(editTpl.mode);
              if (!sm) return (
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">금액 <span className="normal-case text-slate-300">(0이면 안 채움)</span></label>
                  <input inputMode="numeric" value={form.amount}
                    onChange={e => setForm(f => ({ ...f, amount: e.target.value.replace(/[^0-9]/g, '') }))}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-right text-lg font-black tabular-nums outline-none focus:ring-2 focus:ring-indigo-300"/>
                </div>
              );
              const S = SPLIT_MODES[sm];
              const num = (v: string) => Number(v || 0);
              return (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    {([['splitA', S.labelA, S.hintA], ['splitB', S.labelB, S.hintB]] as const).map(([k, label, hint]) => (
                      <div key={k}>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
                          {label} <span className="normal-case text-slate-300">({hint})</span>
                        </label>
                        <input inputMode="numeric" value={form[k]}
                          onChange={e => setForm(f => ({ ...f, [k]: e.target.value.replace(/[^0-9]/g, '') }))}
                          className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-right text-sm font-black tabular-nums outline-none focus:ring-2 focus:ring-indigo-300"/>
                      </div>
                    ))}
                  </div>
                  {'pick' in S && (() => {
                    const P = (S as any).pick as { field: string; label: string; filter: (c: any) => boolean };
                    const opts = accountCodes.filter(P.filter);
                    return (
                      <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">{P.label}</label>
                        <select value={form.loanCode}
                          onChange={e => setForm(f => ({ ...f, loanCode: e.target.value, loanId: '' }))}
                          className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-300">
                          <option value="">전표에서 고르기</option>
                          {opts.map(c => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
                        </select>
                        <p className="text-[10px] font-bold text-slate-400 mt-1">대출이 여러 건이면 여기서 못박아 두세요.</p>
                      </div>
                    );
                  })()}
                  <div className="flex items-center justify-between rounded-xl px-3 py-2 text-[11px] font-black bg-slate-50 text-slate-500">
                    <span>{S.totalLabel}</span>
                    <span className="tabular-nums text-slate-800">{S.total(num(form.splitA), num(form.splitB)).toLocaleString()}</span>
                  </div>
                  <p className="text-[10px] font-bold text-slate-400 leading-snug">{S.help}</p>
                </div>
              );
            })()}

            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
                갈래 <span className="normal-case text-slate-300">(돈이 언제 움직이나)</span>
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {VOUCHER_DIRS.map(d => (
                  <button key={d} type="button" onClick={() => setForm(f => ({ ...f, dir: d }))}
                    title={DIR_HINT[d]}
                    className={`px-2 py-2 rounded-xl border text-center text-xs font-black transition-all ${form.dir === d
                      ? `${DIR_CHIP[d]} border-transparent` : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}>
                    {d}
                  </button>
                ))}
              </div>
              {!isCashDir(form.dir) && form.dir !== '회사이체' && (
                <div className="mt-3">
                  <label htmlFor="template-statement-type" className="block text-xs font-bold text-slate-500 mb-1">전표종류</label>
                  <select id="template-statement-type" value={form.statementType}
                    onChange={e => setForm(f => ({ ...f, statementType: e.target.value as TemplateStatementType }))}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold">
                    <option value="매입">매입전표</option><option value="매출">매출전표</option><option value="비용">일반(대체)전표</option>
                  </select>
                  <p className="text-xs text-slate-400 mt-1">거래처를 변경해도 선택한 전표종류는 유지됩니다.</p>
                  {!editTpl.statementType && <p className="text-xs text-amber-600 mt-1">기존 템플릿의 발행 종류입니다. 확인 후 저장해 주세요.</p>}
                </div>
              )}
            </div>

            {editTpl.mode === '상환' && <div>
              <label className="block text-xs font-bold text-slate-500">대출 건 연결</label>
              <select aria-label="대출 건 연결" value={form.loanId}
                onChange={e => { const loan = loans.find(row => row.id === e.target.value && row.companyId === companyId); setForm(f => ({ ...f, loanId: e.target.value, ...(loan ? { loanCode: loan.accountCode } : {}) })); }}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm">
                <option value="">선택 안 함 — 대출별 잔액에 미반영</option>
                {form.loanId && !matchingLoan(loans, companyId, form.loanId, form.loanCode) && (
                  <option value={form.loanId}>기존 연결 확인 필요 · 다시 선택</option>
                )}
                {loans.filter(loan => loan.companyId === companyId).map(loan => (
                  <option key={loan.id} value={loan.id}>{loan.name} · {loan.lenderName}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">계약이 없으면 대출 관리에서 계약을 먼저 등록하세요. 계약 연결 템플릿은 수동으로 발행합니다.</p>
            </div>}
            <div className="rounded-xl border border-slate-200 p-3 space-y-2">
              <label className="flex items-start gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={form.autoIssue}
                  onChange={async e => { if (e.target.checked && editTpl.mode === '상환' && form.loanId) { await appNotice(LINKED_LOAN_AUTO_NOTICE); return; } setForm(f => ({ ...f, autoIssue: e.target.checked })); }}
                  className="mt-0.5 w-4 h-4 accent-indigo-600 shrink-0"/>
                <span className="text-xs font-black text-slate-700 leading-snug">
                  자동 발행
                  <span className="block text-[10px] font-bold text-slate-400 mt-0.5">
                    켜면 앱을 안 켜도 매달 그날 전표가 생깁니다. 금액이 정해진 것만 켜세요.
                  </span>
                </span>
              </label>
              {form.autoIssue && (
                <div className="flex items-center gap-2 pl-6">
                  <span className="text-xs font-bold text-slate-500">매월</span>
                  <select value={form.issueDay} onChange={e => setForm(f => ({ ...f, issueDay: e.target.value }))}
                    className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-black outline-none focus:ring-2 focus:ring-indigo-300">
                    {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                      <option key={d} value={d}>{d === 31 ? '말일' : `${d}일`}</option>
                    ))}
                  </select>
                  {!Number(form.amount) && <span className="text-[10px] font-bold text-rose-500">금액을 넣어야 켤 수 있습니다</span>}
                </div>
              )}
              {!isCashDir(form.dir) && form.partnerId && (
                <label className="flex items-center gap-2 pl-6 cursor-pointer select-none">
                  <input type="checkbox" checked={form.taxExempt}
                    onChange={e => setForm(f => ({ ...f, taxExempt: e.target.checked }))}
                    className="w-4 h-4 accent-indigo-600 shrink-0"/>
                  <span className="text-[11px] font-bold text-slate-500">면세 <span className="text-slate-400">(끄면 금액에서 부가세 10%를 갈라 잡습니다)</span></span>
                </label>
              )}
            </div>

            {/* ── 이렇게 분개됩니다 ──
                사용자가 차·대를 고르지는 않지만 **무엇이 어디로 잡히는지는 볼 수 있어야** 한다.
                계정을 잘못 골라 두면 그 템플릿으로 끊는 전표가 죄다 어긋나는데, 목록엔
                계정 이름만 보여서 저장 전엔 알 수가 없었다. 평소엔 접어 둔다. */}
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <button type="button" onClick={() => setShowJournal(v => !v)}
                className="w-full px-3 py-2 bg-slate-50 flex items-center gap-2 hover:bg-slate-100 transition-colors">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">이렇게 분개됩니다</span>
                <span className="ml-auto text-[11px] font-black text-indigo-600">{showJournal ? '접기' : '보기'}</span>
              </button>
              {showJournal && (() => {
                const preview = {
                  ...editTpl,
                  label: form.name, dir: form.dir, mode: editTpl.mode, statementType: form.statementType,
                  accountCode: form.accountCode || undefined, itemName: form.itemName || undefined,
                  transferLines: editTpl.transferLines,
                  loanCode: form.loanCode,
                  //  거래처·과세를 넘겨야 미리보기가 상대변(251·108)과 부가세 줄을 그린다.
                  //  안 넘기면 한 줄만 그려 놓고 "차·대가 안 맞는다"고 멀쩡한 템플릿을 나무란다.
                  partnerId: form.partnerId || undefined,
                  taxExempt: form.taxExempt,
                  amount: splitModeOf(editTpl.mode)
                    ? SPLIT_MODES[splitModeOf(editTpl.mode)!].total(Number(form.splitA || 0), Number(form.splitB || 0))
                    : Number(form.amount || 0),
                  ...(splitModeOf(editTpl.mode)
                    ? { [SPLIT_MODES[splitModeOf(editTpl.mode)!].a]: Number(form.splitA || 0),
                        [SPLIT_MODES[splitModeOf(editTpl.mode)!].b]: Number(form.splitB || 0) }
                    : {}),
                } as unknown as CashTemplate;
                const lines = templateJournalLines(preview);
                //  금액을 전표에서 정하는 양식이면 차·대를 견줄 게 없다 — 안 맞는다고 하면 안 된다
                const perVoucher = lines.some(l => l.perVoucher);
                const 차 = lines.filter(l => l.side === '차변').reduce((a, l) => a + l.amount, 0);
                const 대 = lines.filter(l => l.side === '대변').reduce((a, l) => a + l.amount, 0);
                return (
                  <div>
                    <div className="grid grid-cols-[44px_minmax(140px,1fr)_110px_110px] min-w-[440px] bg-slate-100 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                      <span className="px-2 py-1">구분</span><span className="px-2 py-1">계정</span>
                      <span className="px-2 py-1 text-right">차변</span><span className="px-2 py-1 text-right">대변</span>
                    </div>
                    {lines.map((l, i) => (
                      <div key={i} className="grid grid-cols-[44px_minmax(140px,1fr)_110px_110px] min-w-[440px] border-t border-slate-50 text-[11px]">
                        <span className={`px-2 py-1.5 font-black ${l.side === '차변' ? 'text-slate-600' : 'text-amber-600'}`}>{l.side}</span>
                        {/* 계정명은 안 자른다 — '255 부가세…'로 잘리면 예수금인지 대급금인지 못 가린다 */}
                        <span className="px-2 py-1.5 font-bold text-slate-700 break-keep">
                          <span className="font-mono text-slate-400 mr-1">{l.code}</span>
                          {accountCodes.find(c => c.code === l.code)?.name ?? l.label}
                        </span>
                        <span className="px-2 py-1.5 text-right tabular-nums font-black text-slate-700">
                          {l.perVoucher ? <span className="text-slate-300">—</span> : l.side === '차변' ? fmt(l.amount) : ''}</span>
                        <span className="px-2 py-1.5 text-right tabular-nums font-black text-slate-700">
                          {l.perVoucher ? <span className="text-slate-300">—</span> : l.side === '대변' ? fmt(l.amount) : ''}</span>
                      </div>
                    ))}
                    {/* 줄마다 금액이 다른 양식은 **잘못이 아니다** — 금액을 전표에서 적으면 된다.
                        빨간 글씨로 겁줄 일이 아니라서 회색 안내로 적는다.
                        진짜 잘못은 상대변이 통째로 없는 것뿐이다. */}
                    {perVoucher ? (
                      <p className="px-3 py-1.5 text-[10px] font-bold text-slate-400 border-t border-slate-100">
                        줄마다 금액이 다른 양식입니다 — 금액은 전표를 끊을 때 줄마다 적습니다.
                      </p>
                    ) : 차 !== 대 && (
                      <p className="px-3 py-1.5 text-[10px] font-black text-rose-500 border-t border-slate-100">
                        차·대가 안 맞습니다 — 상대변 계정이 없습니다. 이 템플릿으로는 전표를 못 끊습니다.
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>

            <div className="flex gap-2 pt-1">
              <button disabled={busy} onClick={() => setEditTpl(null)} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-xs font-black hover:bg-slate-200">취소</button>
              <button
                disabled={busy || (cloning ? !onCreate : !onUpdate)}
                onClick={() => runAction(async () => {
                  if (!form.name.trim()) { await appNotice('이름을 입력하세요.'); return; }
                  // 두 줄 갈래는 두 칸이 곧 값이고, amount는 통장에서 움직이는 돈이다.
                  const sm = splitModeOf(editTpl.mode);
                  const a = Number(form.splitA || 0), b = Number(form.splitB || 0);
                  const S = sm ? SPLIT_MODES[sm] : null;
                  const amount = S ? S.total(a, b) : Number(form.amount || 0);
                  const splitPatch = S
                    ? { [S.a]: a, [S.b]: b, ...('pick' in S ? { loanCode: form.loanCode, loanId: form.loanId } : {}) }
                    : {};
                  if (sm === '상환' && form.loanId && !matchingLoan(loans, companyId, form.loanId, form.loanCode)) { await appNotice('연결할 대출 계약의 회사와 원금 계정을 확인하고 다시 선택해 주세요.'); return; }
                  if (sm === '상환' && form.loanId && form.autoIssue) { await appNotice(LINKED_LOAN_AUTO_NOTICE); return; }
                  if (form.autoIssue && amount <= 0) { await appNotice('자동 발행은 금액이 정해진 것만 켤 수 있습니다.'); return; }
                  const missingCodes = missingTemplateAccountCodes({ ...editTpl, accountCode: form.accountCode || undefined, loanCode: form.loanCode || undefined }, new Set(accountCodes.map(c => c.code)));
                  if (form.autoIssue && missingCodes.length) { await appNotice(`현재 회사 계정표에 없는 계정: ${missingCodes.join(', ')}\n\n계정을 먼저 확인해 주세요.`); return; }
                  const conflict = templateStatementConflict(form);
                  if (conflict) { await appNotice(conflict); return; }
                  if (form.autoIssue && !isCashDir(form.dir) && !canAutoStatement({ ...editTpl, ...form })) {
                    await appNotice('자동 매입·매출은 거래처, 대체는 차변·대변 한 줄씩의 양식을 확인해 주세요.');
                    return;
                  }
                  const patch = {
                    name: form.name.trim(),
                    group: form.group.trim() || NO_GROUP,
                    amount,
                    partnerId: form.partnerId,
                    partnerName: form.partnerName.trim(),
                    itemName: form.itemName.trim(),
                    ...(form.accountCode ? { accountCode: form.accountCode } : {}),
                    ...splitPatch,
                    dir: form.dir,
                    ...(!isCashDir(form.dir) && form.dir !== '회사이체' ? { statementType: form.statementType } : {}),
                    autoIssue: form.autoIssue,
                    issueDay: Number(form.issueDay) || 1,
                    taxExempt: form.taxExempt,
                  };
                  if (cloning) {
                    // 뼈대(갈래·계정·입력 방식)는 기본에서 물려받고, builtin 표시는 떼어 낸다 —
                    // 그래야 내 것으로서 고치고 지울 수 있다.
                    await onCreate?.({
                      ...patch,
                      ...(form.statementType === '비용' && editTpl.transferLines?.length ? { transferLines: editTpl.transferLines } : {}),
                      ...(form.accountCode ? { accountCode: form.accountCode } : {}),
                      mode: editTpl.mode,
                      kind: editTpl.kind ?? 'voucher',
                      category: editTpl.category,
                      active: false, hidden: false,
                    } as Omit<FixedCostTemplate, 'id'>);
                  } else {
                    await onUpdate?.(editTpl.id, patch);
                  }
                  setEditTpl(null);
                  if (cloning) setSelectedId('');
                })}
                className="flex-[2] py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-black hover:bg-indigo-700 flex items-center justify-center gap-1.5">
                <Check size={13}/>{busy ? '저장 중…' : cloning ? '만들기' : '저장'}
              </button>
            </div>
        </ModalShell>
      )}
    </div>
  );
}
