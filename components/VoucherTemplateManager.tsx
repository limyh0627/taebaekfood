import React, { useMemo, useState } from 'react';
import { Trash2, X, ToggleLeft, ToggleRight, Pencil, Check, Eye, EyeOff, Lock, BarChart2, Star, FolderPlus } from 'lucide-react';
import { FixedCostTemplate, AccountCode } from '../src/shared/types';

/**
 * 전표 템플릿 관리 — 일반전표 발행의 '자주 쓰는 전표'가 여기서 정해진다.
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
  templates, accountCodes, onUpdate, onDelete, compact = false,
}: {
  templates: FixedCostTemplate[];
  accountCodes: AccountCode[];
  onUpdate?: (id: string, data: Partial<FixedCostTemplate>) => Promise<void> | void;
  onDelete?: (id: string) => Promise<void> | void;
  /** 모달 안이면 높이를 제한한다 */
  compact?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'auto' | 'hidden'>('all');
  const [editTpl, setEditTpl] = useState<FixedCostTemplate | null>(null);
  const [form, setForm] = useState({
    name: '', group: '', amount: '', partnerName: '',
    postMode: '합침' as '합침' | '분리', autoIssue: false, issueDay: '1', taxExempt: false,
  });

  const shown = useMemo(() => {
    const q = search.trim();
    return [...templates]
      .filter(t => filter === 'auto' ? t.autoIssue : filter === 'hidden' ? t.hidden : true)
      .filter(t => !q || t.name.includes(q) || (t.partnerName ?? '').includes(q) || (t.accountCode ?? '').includes(q))
      .sort((a, b) => (a.group ?? '기타').localeCompare(b.group ?? '기타') || a.name.localeCompare(b.name));
  }, [templates, search, filter]);

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

  const openEdit = (t: FixedCostTemplate) => {
    setEditTpl(t);
    setForm({
      name: t.name, group: t.group ?? '', amount: t.amount ? String(t.amount) : '', partnerName: t.partnerName ?? '',
      postMode: t.postMode ?? '합침', autoIssue: !!t.autoIssue, issueDay: String(t.issueDay ?? 1), taxExempt: !!t.taxExempt,
    });
  };

  return (
    <div className="border border-slate-200 rounded-2xl overflow-hidden">
      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest shrink-0">
          템플릿 <span className="text-slate-300">{templates.length}</span>
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <input type="text" placeholder="이름·거래처 검색" value={search} onChange={e => setSearch(e.target.value)}
            className="w-32 bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300"/>
          <div className="flex bg-slate-200/70 rounded-lg p-0.5 gap-0.5">
            {([['all', '전체'], ['auto', '자동'], ['hidden', '숨김']] as const).map(([v, lbl]) => (
              <button key={v} onClick={() => setFilter(v)}
                className={`px-2 py-0.5 rounded-md text-[11px] font-black transition-all ${filter === v ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>
                {lbl}
              </button>
            ))}
          </div>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="py-8 text-center text-slate-300">
          <BarChart2 size={24} className="mx-auto mb-2 opacity-40"/>
          <p className="text-xs font-bold">해당하는 템플릿이 없습니다</p>
        </div>
      ) : (
        <div className={compact ? 'max-h-[42vh] overflow-y-auto' : ''}>
          {groups.map(g => (
            <div key={g.name}>
              <div className="px-4 py-1 bg-slate-50/70 border-y border-slate-100 flex items-center gap-2">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{g.name}</span>
                <span className="text-[10px] font-bold text-slate-300">{g.items.length}</span>
              </div>
              <div className="divide-y divide-slate-50">
                {g.items.map(t => {
                  const locked = !!t.builtin;
                  const canAuto = t.amount > 0 && !!t.accountCode;
                  return (
                    <div key={t.id} className={`px-4 py-2 flex items-center gap-2 transition ${t.hidden ? 'opacity-40' : ''}`}>
                      <button
                        onClick={() => {
                          if (!t.autoIssue && !canAuto) { alert('자동 발행은 계정과목과 금액이 정해진 것만 켤 수 있습니다.\n\n연필 버튼으로 금액을 먼저 넣어 주세요.'); return; }
                          onUpdate?.(t.id, { autoIssue: !t.autoIssue });
                        }}
                        title={t.autoIssue ? `매월 ${(t.issueDay ?? 1) === 31 ? '말일' : `${t.issueDay ?? 1}일`} 자동 발행 — 끄기` : '자동 발행 켜기'}
                        className="shrink-0 text-slate-300 hover:text-indigo-500 transition">
                        {t.autoIssue ? <ToggleRight size={20} className="text-indigo-500"/> : <ToggleLeft size={20}/>}
                      </button>
                      <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-lg shrink-0 w-10 text-center ${t.autoIssue ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-300'}`}>
                        {t.autoIssue ? ((t.issueDay ?? 1) === 31 ? '말일' : `${t.issueDay ?? 1}일`) : '수동'}
                      </span>
                      <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-lg shrink-0 ${(t.dir ?? '출금') === '입금' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {t.dir ?? '출금'}
                      </span>
                      <button onClick={() => onUpdate?.(t.id, { favorite: !t.favorite })}
                        title={t.favorite ? '즐겨찾기 빼기' : '즐겨찾기 — 목록 맨 위로'}
                        className="shrink-0 transition">
                        <Star size={14} className={t.favorite ? 'text-amber-400 fill-amber-400' : 'text-slate-200 hover:text-amber-300'}/>
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-xs font-black text-slate-800 truncate">{t.name}</span>
                          {(t.postMode ?? '합침') === '분리' && (
                            <span title="발생일에 매입전표로 채무를 세우고, 지불은 따로" className="shrink-0 text-[9px] font-black px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">분리</span>
                          )}
                          {locked && <span title="기본 템플릿 — 지울 수 없고 숨기기만 됩니다" className="shrink-0 text-[9px] font-black px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400">기본</span>}
                          {t.hidden && <span className="shrink-0 text-[9px] font-black px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-500">숨김</span>}
                        </div>
                        <div className="text-[10px] font-bold text-slate-400 truncate">
                          {t.accountCode ? `${t.accountCode} ${accountCodes.find(c => c.code === t.accountCode)?.name ?? ''}` : (t.mode !== '일반' ? t.mode : '계정 직접선택')}
                          {t.partnerName && ` · ${t.partnerName}`}
                          {(t.postMode ?? '합침') === '분리' && (t.taxExempt ? ' · 면세' : ' · 과세')}
                        </div>
                      </div>
                      <span className="text-xs font-black text-slate-800 tabular-nums shrink-0 w-20 text-right">
                        {t.amount > 0 ? fmt(t.amount) : <span className="text-slate-300">—</span>}
                      </span>
                      <button onClick={() => onUpdate?.(t.id, { hidden: !t.hidden })}
                        title={t.hidden ? '숨김 해제 — 자주 쓰는 전표에 다시 뜬다' : '숨기기 — 자주 쓰는 전표에서 뺀다'}
                        className="p-1 hover:bg-slate-100 rounded-lg text-slate-300 hover:text-slate-600 shrink-0">
                        {t.hidden ? <EyeOff size={13}/> : <Eye size={13}/>}
                      </button>
                      <button onClick={() => openEdit(t)} title="이름·묶음·금액·발행 방식 수정"
                        className="p-1 hover:bg-slate-100 rounded-lg text-slate-300 hover:text-slate-600 shrink-0"><Pencil size={13}/></button>
                      {locked ? (
                        <span title="기본 템플릿 — 지울 수 없습니다. 숨기기만 됩니다." className="p-1 text-slate-200 shrink-0"><Lock size={13}/></span>
                      ) : (
                        <button onClick={() => { if (window.confirm(`'${t.name}' 템플릿을 지울까요?`)) onDelete?.(t.id); }}
                          className="p-1 hover:bg-rose-50 rounded-lg text-slate-200 hover:text-rose-400 shrink-0"><Trash2 size={13}/></button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 수정 — 이름·묶음·금액·거래처·발행 방식 */}
      {editTpl && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setEditTpl(null)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-800">템플릿 수정</h3>
              <button onClick={() => setEditTpl(null)} className="text-slate-300 hover:text-slate-500"><X size={18}/></button>
            </div>
            {editTpl.builtin && (
              <p className="text-[11px] font-bold text-slate-400 bg-slate-50 rounded-xl px-3 py-2 leading-snug">
                기본 템플릿입니다. 이름·금액·거래처는 바꿀 수 있지만 지울 수는 없습니다 — 대신 숨기면 목록에서 빠집니다.
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
                    onClick={() => {
                      const name = window.prompt('새 묶음 이름', '');
                      if (name === null) return;
                      setForm(f => ({ ...f, group: name.trim() }));
                    }}
                    title="새 묶음 만들기"
                    className="shrink-0 px-2.5 rounded-xl border border-slate-200 text-slate-400 hover:border-indigo-400 hover:text-indigo-600 transition-all">
                    <FolderPlus size={16}/>
                  </button>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">거래처</label>
                <input value={form.partnerName} onChange={e => setForm(f => ({ ...f, partnerName: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-300"/>
              </div>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">금액 <span className="normal-case text-slate-300">(0이면 안 채움)</span></label>
              <input inputMode="numeric" value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value.replace(/[^0-9]/g, '') }))}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-right text-lg font-black tabular-nums outline-none focus:ring-2 focus:ring-indigo-300"/>
            </div>

            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">발행 방식</label>
              <div className="grid grid-cols-2 gap-2">
                {([['합침', '한 줄', '나가는 날 출금전표 하나'], ['분리', '두 줄', '발생일에 매입전표 · 지불 따로']] as const).map(([v, lbl, hint]) => (
                  <button key={v} type="button" onClick={() => setForm(f => ({ ...f, postMode: v }))}
                    className={`px-3 py-2 rounded-xl border text-left transition-all ${form.postMode === v
                      ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}>
                    <div className="text-xs font-black">{lbl}</div>
                    <div className={`text-[9px] font-bold leading-tight mt-0.5 ${form.postMode === v ? 'opacity-70' : 'opacity-50'}`}>{hint}</div>
                  </button>
                ))}
              </div>
              {form.postMode === '분리' && !editTpl.partnerId && (
                <p className="text-[10px] font-bold text-amber-600 mt-1.5 leading-snug">
                  거래처가 없습니다 — 미지급금을 걸 곳이 없어 분리로 저장되지 않습니다.
                  일반전표 발행에서 거래처를 골라 다시 저장해 주세요.
                </p>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 p-3 space-y-2">
              <label className="flex items-start gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={form.autoIssue}
                  onChange={e => setForm(f => ({ ...f, autoIssue: e.target.checked }))}
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
              {form.postMode === '분리' && (
                <label className="flex items-center gap-2 pl-6 cursor-pointer select-none">
                  <input type="checkbox" checked={form.taxExempt}
                    onChange={e => setForm(f => ({ ...f, taxExempt: e.target.checked }))}
                    className="w-4 h-4 accent-indigo-600 shrink-0"/>
                  <span className="text-[11px] font-bold text-slate-500">면세 <span className="text-slate-400">(끄면 금액에서 부가세 10%를 갈라 잡습니다)</span></span>
                </label>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <button onClick={() => setEditTpl(null)} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-xs font-black hover:bg-slate-200">취소</button>
              <button
                onClick={async () => {
                  if (!form.name.trim()) { alert('이름을 입력하세요.'); return; }
                  const amount = Number(form.amount || 0);
                  if (form.autoIssue && amount <= 0) { alert('자동 발행은 금액이 정해진 것만 켤 수 있습니다.'); return; }
                  if (form.postMode === '분리' && !editTpl.partnerId) {
                    alert('분리 발행은 거래처가 있어야 합니다.\n\n일반전표 발행에서 거래처를 고르고 다시 [템플릿으로 저장]을 눌러 주세요.');
                    return;
                  }
                  await onUpdate?.(editTpl.id, {
                    name: form.name.trim(),
                    group: form.group.trim() || NO_GROUP,
                    amount,
                    partnerName: form.partnerName.trim(),
                    postMode: form.postMode,
                    autoIssue: form.autoIssue,
                    issueDay: Number(form.issueDay) || 1,
                    taxExempt: form.taxExempt,
                  });
                  setEditTpl(null);
                }}
                className="flex-[2] py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-black hover:bg-indigo-700 flex items-center justify-center gap-1.5">
                <Check size={13}/>저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
