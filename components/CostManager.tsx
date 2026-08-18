
import React, { useState, useMemo } from 'react';
import { PlusCircle, Trash2, ChevronLeft, ChevronRight, BarChart2, X, ToggleLeft, ToggleRight, Pencil, Check, Eye, EyeOff, Lock } from 'lucide-react';
import { FixedCostEntry, FixedCostCategory, FixedCostTemplate, IssuedStatement, AccountCode } from '../types';

interface CostManagerProps {
  fixedCosts: FixedCostEntry[];
  fixedCostTemplates: FixedCostTemplate[];
  issuedStatements: IssuedStatement[];
  accountCodes?: AccountCode[];
  onAdd: (entry: Omit<FixedCostEntry, 'id' | 'createdAt'>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onAddTemplate?: (data: Omit<FixedCostTemplate, 'id'>) => Promise<void>;
  onUpdateTemplate?: (id: string, data: Partial<FixedCostTemplate>) => Promise<void>;
  onDeleteTemplate?: (id: string) => Promise<void>;
  onGenerateRecurringCosts?: (yearMonth: string) => Promise<number>; // 생성된 건수 반환
}

const CATEGORIES: FixedCostCategory[] = ['임차료', '보험료', '감가상각비', '대출이자', '공과금', '인건비', '기타'];

const CAT_COLOR: Record<FixedCostCategory, string> = {
  임차료: 'bg-violet-100 text-violet-700',
  보험료: 'bg-blue-100 text-blue-700',
  감가상각비: 'bg-sky-100 text-sky-700',
  대출이자: 'bg-orange-100 text-orange-700',
  공과금: 'bg-yellow-100 text-yellow-700',
  인건비: 'bg-rose-100 text-rose-700',
  기타: 'bg-slate-100 text-slate-600',
};

const fmt = (n: number) => n.toLocaleString('ko-KR') + '원';

const CostManager: React.FC<CostManagerProps> = ({
  fixedCosts, fixedCostTemplates, issuedStatements, accountCodes = [],
  onAdd, onDelete, onAddTemplate, onUpdateTemplate, onDeleteTemplate, onGenerateRecurringCosts,
}) => {
  const today = new Date();
  const [yearMonth, setYearMonth] = useState(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  );
  const moveMonth = (d: number) => {
    const [y, m] = yearMonth.split('-').map(Number);
    const nd = new Date(y, m - 1 + d, 1);
    setYearMonth(`${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}`);
  };

  // ── 정기 고정비 (templates) ──
  const [showTplForm, setShowTplForm] = useState(false);
  const [tplForm, setTplForm] = useState({ name: '', amount: '', category: '임차료' as FixedCostCategory, note: '', accountCode: '', startYm: '', endYm: '' });
  const [genMsg, setGenMsg] = useState('');
  const [editingTplId, setEditingTplId] = useState<string | null>(null);
  const [editAmt, setEditAmt] = useState('');

  const templateTotal = useMemo(
    () => fixedCostTemplates.filter(t => t.active && t.kind !== 'voucher').reduce((a, t) => a + t.amount, 0),
    [fixedCostTemplates]
  );
  // 자동발행을 켠 것만 위에 따로 보여준다 — 저절로 나가는 것은 눈에 띄어야 한다.
  const recurringTpls = useMemo(
    () => fixedCostTemplates.filter(t => t.autoIssue).sort((a, b) => (a.issueDay ?? 1) - (b.issueDay ?? 1)),
    [fixedCostTemplates],
  );
  // 목록 보기 — 검색 + 갈래(전체/자동/숨김). 29개라 눈으로만 찾기 어렵다.
  const [tplSearch, setTplSearch] = useState('');
  const [tplFilter, setTplFilter] = useState<'all' | 'auto' | 'hidden'>('all');
  const shownTpls = useMemo(() => {
    const q = tplSearch.trim();
    return [...fixedCostTemplates]
      .filter(t => tplFilter === 'auto' ? t.autoIssue : tplFilter === 'hidden' ? t.hidden : true)
      .filter(t => !q || t.name.includes(q) || (t.partnerName ?? '').includes(q) || (t.accountCode ?? '').includes(q))
      .sort((a, b) => (a.group ?? '기타').localeCompare(b.group ?? '기타') || a.name.localeCompare(b.name));
  }, [fixedCostTemplates, tplSearch, tplFilter]);
  // 묶음별로 갈라 그린다 — 목록 순서를 그대로 따라간다
  const tplGroups = useMemo(() => {
    const out: { name: string; items: FixedCostTemplate[] }[] = [];
    for (const t of shownTpls) {
      const g = t.group?.trim() || '기타';
      const last = out.find(x => x.name === g);
      if (last) last.items.push(t); else out.push({ name: g, items: [t] });
    }
    return out;
  }, [shownTpls]);
  const [editTpl, setEditTpl] = useState<FixedCostTemplate | null>(null);
  const [editForm, setEditForm] = useState({
    name: '', group: '', amount: '', partnerName: '',
    postMode: '합침' as '합침' | '분리', autoIssue: false, issueDay: '1', taxExempt: false,
  });

  const handleAddTemplate = async () => {
    const amount = Number(tplForm.amount.replace(/,/g, ''));
    if (!tplForm.accountCode || !amount) return;
    const ac = accountCodes.find(c => c.code === tplForm.accountCode);
    const name = tplForm.name.trim() || ac?.name || tplForm.accountCode;
    await onAddTemplate?.({
      name, amount, category: '기타', active: true,
      note: tplForm.note.trim() || undefined,
      accountCode: tplForm.accountCode,
      startYm: tplForm.startYm || yearMonth,
      endYm: tplForm.endYm || undefined,
    });
    setTplForm({ name: '', amount: '', category: '임차료', note: '', accountCode: '', startYm: '', endYm: '' });
    setShowTplForm(false);
  };

  const startEditAmt = (t: FixedCostTemplate) => {
    setEditingTplId(t.id);
    setEditAmt(String(t.amount));
  };

  const saveEditAmt = async (id: string) => {
    const amount = Number(editAmt.replace(/,/g, ''));
    if (amount > 0) await onUpdateTemplate?.(id, { amount });
    setEditingTplId(null);
  };

  // ── 이번 달 추가 (one-time entries) ──
  const [showEntryForm, setShowEntryForm] = useState(false);
  const [entryForm, setEntryForm] = useState({ category: '기타' as FixedCostCategory, label: '', amount: '', note: '' });
  const [saving, setSaving] = useState(false);

  const monthEntries = useMemo(() => fixedCosts.filter(c => c.yearMonth === yearMonth), [fixedCosts, yearMonth]);
  const entryTotal = useMemo(() => monthEntries.reduce((a, c) => a + c.amount, 0), [monthEntries]);

  const handleAddEntry = async () => {
    const amount = Number(entryForm.amount.replace(/,/g, ''));
    if (!entryForm.label.trim() || !amount) return;
    setSaving(true);
    await onAdd({ yearMonth, category: entryForm.category, label: entryForm.label.trim(), amount, note: entryForm.note.trim() || undefined });
    setEntryForm({ category: '기타', label: '', amount: '', note: '' });
    setShowEntryForm(false);
    setSaving(false);
  };

  const [y, m] = yearMonth.split('-');
  const ymLabel = `${y}년 ${Number(m)}월`;

  return (
    <div className="space-y-5 max-w-3xl">

      {/* ── 월 네비 + 합계 ── */}
      <div className="bg-white rounded-2xl border border-slate-200 px-5 py-4 flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">정기 고정비 합계 (월)</div>
          <div className="text-2xl font-black text-slate-800">{fmt(templateTotal)}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">매월 "전표 생성"으로 손익에 반영</div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => moveMonth(-1)} className="p-2 hover:bg-slate-100 rounded-xl text-slate-500 transition"><ChevronLeft size={18}/></button>
          <span className="text-sm font-black text-slate-700 min-w-[80px] text-center">{ymLabel}</span>
          <button onClick={() => moveMonth(1)} className="p-2 hover:bg-slate-100 rounded-xl text-slate-500 transition"><ChevronRight size={18}/></button>
        </div>
      </div>

      {/* ── 정기 고정비 (항목 관리) ── */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <span className="text-sm font-black text-slate-800">정기 고정비</span>
            <span className="ml-2 text-[11px] text-slate-400">매월 "정기비용 전표"로 생성 → 손익 반영</span>
          </div>
          <div className="flex items-center gap-1.5">
            {onGenerateRecurringCosts && (
              <button onClick={async () => {
                  const n = await onGenerateRecurringCosts(yearMonth);
                  setGenMsg(n > 0 ? `${ymLabel} 정기비용 ${n}건 생성됨` : `${ymLabel} 생성할 정기비용 없음(이미 생성/대상 없음)`);
                  setTimeout(() => setGenMsg(''), 4000);
                }}
                className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-xl transition whitespace-nowrap">
                {ymLabel} 전표 생성
              </button>
            )}
            <button onClick={() => setShowTplForm(v => !v)}
              className="flex items-center gap-1.5 text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-xl transition">
              {showTplForm ? <X size={13}/> : <PlusCircle size={13}/>}
              {showTplForm ? '닫기' : '항목 추가'}
            </button>
          </div>
        </div>

        {genMsg && (
          <div className="px-5 py-2 bg-emerald-50 border-b border-emerald-100 text-[11px] font-bold text-emerald-700">{genMsg}</div>
        )}
        {showTplForm && (
          <div className="px-5 py-4 bg-slate-50 border-b border-slate-100 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">계정과목 *</label>
                <select value={tplForm.accountCode} onChange={e => setTplForm(p => ({ ...p, accountCode: e.target.value }))}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-indigo-400">
                  <option value="">계정과목 선택</option>
                  {accountCodes.map(ac => <option key={ac.id} value={ac.code}>{ac.code} {ac.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">금액 (원) *</label>
                <input type="text" inputMode="numeric" placeholder="예: 1500000" value={tplForm.amount}
                  onChange={e => setTplForm(p => ({ ...p, amount: e.target.value.replace(/[^0-9]/g, '') }))}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-indigo-400"/>
                {tplForm.amount && <p className="text-[11px] text-indigo-500 font-bold mt-1 ml-1">{Number(tplForm.amount).toLocaleString('ko-KR')}원</p>}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">시작월</label>
                <input type="month" value={tplForm.startYm} onChange={e => setTplForm(p => ({ ...p, startYm: e.target.value }))}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-indigo-400"/>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">종료월(선택)</label>
                <input type="month" value={tplForm.endYm} onChange={e => setTplForm(p => ({ ...p, endYm: e.target.value }))}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-indigo-400"/>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">라벨(선택)</label>
                <input type="text" placeholder="예: 공장 임대료" value={tplForm.name}
                  onChange={e => setTplForm(p => ({ ...p, name: e.target.value }))}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-indigo-400"/>
              </div>
            </div>
            <p className="text-[11px] text-slate-400">계정과목을 골라 금액만 넣으면 정기비용이 돼요. 시작월 비우면 이번 달부터, 라벨 비우면 계정명으로 표시.</p>
            <button onClick={handleAddTemplate} disabled={!tplForm.accountCode || !tplForm.amount}
              className="w-full bg-indigo-600 text-white py-2.5 rounded-xl text-sm font-black hover:bg-indigo-700 disabled:opacity-40 transition">
              등록
            </button>
          </div>
        )}

        {/* 자동으로 나가는 것 요약 — 목록은 아래 한 곳에서만 관리한다(두 군데 두면 어느 게 진짜인지 흐려진다) */}
        {recurringTpls.length === 0 ? (
          <div className="px-5 py-6 text-center text-slate-300">
            <p className="text-xs font-bold">자동으로 나가는 전표가 없습니다</p>
            <p className="text-[11px] mt-1">전표 화면의 <b>[템플릿]</b>에서 스위치를 켜면 매달 그날 저절로 발행됩니다</p>
          </div>
        ) : (
          <div className="px-5 py-4 flex items-center gap-3 flex-wrap bg-indigo-50/50">
            <span className="text-[10px] font-black text-indigo-500 uppercase tracking-widest shrink-0">자동 발행</span>
            <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
              {recurringTpls.map(t => (
                <span key={t.id} className="text-[11px] font-black px-2 py-1 rounded-lg bg-white border border-indigo-200 text-slate-600">
                  {(t.issueDay ?? 1) === 31 ? '말일' : `${t.issueDay ?? 1}일`}
                  <span className="mx-1 text-slate-800">{t.name}</span>
                  <span className="text-slate-400 tabular-nums">{fmt(t.amount)}</span>
                </span>
              ))}
            </div>
            <span className="text-sm font-black text-slate-700 shrink-0">
              합계 <span className="text-indigo-600 ml-1">{fmt(recurringTpls.reduce((a, t) => a + t.amount, 0))}</span>
            </span>
          </div>
        )}
      </div>


    </div>
  );
};

export default CostManager;
