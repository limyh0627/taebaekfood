
import React, { useState, useMemo } from 'react';
import { PlusCircle, Trash2, ChevronLeft, ChevronRight, BarChart2, X, ToggleLeft, ToggleRight, Pencil, Check } from 'lucide-react';
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
    () => fixedCostTemplates.filter(t => t.active).reduce((a, t) => a + t.amount, 0),
    [fixedCostTemplates]
  );

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

        {fixedCostTemplates.length === 0 ? (
          <div className="py-10 text-center text-slate-300">
            <BarChart2 size={28} className="mx-auto mb-2 opacity-40"/>
            <p className="text-xs font-bold">등록된 정기 항목이 없습니다</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {fixedCostTemplates.map(t => (
              <div key={t.id} className={`flex items-center gap-3 px-5 py-3.5 transition ${t.active ? '' : 'opacity-40'}`}>
                <button onClick={() => onUpdateTemplate?.(t.id, { active: !t.active })} className="shrink-0 text-slate-300 hover:text-indigo-500 transition">
                  {t.active ? <ToggleRight size={22} className="text-indigo-500"/> : <ToggleLeft size={22}/>}
                </button>
                <span className="text-[10px] font-black px-2 py-0.5 rounded-lg shrink-0 bg-amber-100 text-amber-700">{t.accountCode ? `${t.accountCode} ${accountCodes.find(c => c.code === t.accountCode)?.name ?? ''}` : '계정미지정'}</span>
                <span className="text-sm font-bold text-slate-700 flex-1 truncate">{t.name}{t.startYm && <span className="ml-1.5 text-[10px] text-slate-400 font-medium">{t.startYm}~{t.endYm ?? ''}</span>}</span>
                {editingTplId === t.id ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <input type="text" inputMode="numeric" value={editAmt}
                      onChange={e => setEditAmt(e.target.value.replace(/[^0-9]/g, ''))}
                      className="w-28 border border-indigo-300 rounded-lg px-2 py-1 text-sm font-bold text-right outline-none focus:ring-2 focus:ring-indigo-300"/>
                    <button onClick={() => saveEditAmt(t.id)} className="p-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"><Check size={13}/></button>
                    <button onClick={() => setEditingTplId(null)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"><X size={13}/></button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-black text-slate-800 tabular-nums">{fmt(t.amount)}</span>
                    <button onClick={() => startEditAmt(t)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-300 hover:text-slate-600"><Pencil size={13}/></button>
                    <button onClick={() => onDeleteTemplate?.(t.id)} className="p-1.5 hover:bg-rose-50 rounded-lg text-slate-200 hover:text-rose-400"><Trash2 size={13}/></button>
                  </div>
                )}
              </div>
            ))}
            <div className="px-5 py-3 flex justify-end bg-slate-50">
              <span className="text-sm font-black text-slate-700">정기 합계 <span className="text-indigo-600 ml-2">{fmt(templateTotal)}</span></span>
            </div>
          </div>
        )}
      </div>

    </div>
  );
};

export default CostManager;
