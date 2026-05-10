
import React, { useState, useMemo } from 'react';
import { PlusCircle, Trash2, ChevronLeft, ChevronRight, BarChart2, X, ToggleLeft, ToggleRight, Pencil, Check } from 'lucide-react';
import { FixedCostEntry, FixedCostCategory, FixedCostTemplate, IssuedStatement } from '../types';

interface CostManagerProps {
  fixedCosts: FixedCostEntry[];
  fixedCostTemplates: FixedCostTemplate[];
  issuedStatements: IssuedStatement[];
  onAdd: (entry: Omit<FixedCostEntry, 'id' | 'createdAt'>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onAddTemplate?: (data: Omit<FixedCostTemplate, 'id'>) => Promise<void>;
  onUpdateTemplate?: (id: string, data: Partial<FixedCostTemplate>) => Promise<void>;
  onDeleteTemplate?: (id: string) => Promise<void>;
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
  fixedCosts, fixedCostTemplates, issuedStatements,
  onAdd, onDelete, onAddTemplate, onUpdateTemplate, onDeleteTemplate,
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
  const [tplForm, setTplForm] = useState({ name: '', amount: '', category: '임차료' as FixedCostCategory, note: '' });
  const [editingTplId, setEditingTplId] = useState<string | null>(null);
  const [editAmt, setEditAmt] = useState('');

  const templateTotal = useMemo(
    () => fixedCostTemplates.filter(t => t.active).reduce((a, t) => a + t.amount, 0),
    [fixedCostTemplates]
  );

  const handleAddTemplate = async () => {
    const amount = Number(tplForm.amount.replace(/,/g, ''));
    if (!tplForm.name.trim() || !amount) return;
    await onAddTemplate?.({ name: tplForm.name.trim(), amount, category: tplForm.category, active: true, note: tplForm.note.trim() || undefined });
    setTplForm({ name: '', amount: '', category: '임차료', note: '' });
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
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">{ymLabel} 판관비 합계</div>
          <div className="text-2xl font-black text-slate-800">{fmt(templateTotal + entryTotal)}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            정기 {fmt(templateTotal)} + 이번 달 추가 {fmt(entryTotal)}
          </div>
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
            <span className="ml-2 text-[11px] text-slate-400">매달 자동 집계</span>
          </div>
          <button onClick={() => setShowTplForm(v => !v)}
            className="flex items-center gap-1.5 text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-xl transition">
            {showTplForm ? <X size={13}/> : <PlusCircle size={13}/>}
            {showTplForm ? '닫기' : '항목 추가'}
          </button>
        </div>

        {showTplForm && (
          <div className="px-5 py-4 bg-slate-50 border-b border-slate-100 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">분류</label>
                <select value={tplForm.category} onChange={e => setTplForm(p => ({ ...p, category: e.target.value as FixedCostCategory }))}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-indigo-400">
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">항목명</label>
                <input type="text" placeholder="예: 공장 임대료" value={tplForm.name}
                  onChange={e => setTplForm(p => ({ ...p, name: e.target.value }))}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-indigo-400"/>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">금액 (원)</label>
                <input type="text" inputMode="numeric" placeholder="예: 1500000" value={tplForm.amount}
                  onChange={e => setTplForm(p => ({ ...p, amount: e.target.value.replace(/[^0-9]/g, '') }))}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-indigo-400"/>
                {tplForm.amount && <p className="text-[11px] text-indigo-500 font-bold mt-1 ml-1">{Number(tplForm.amount).toLocaleString('ko-KR')}원</p>}
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">비고 (선택)</label>
                <input type="text" placeholder="메모" value={tplForm.note}
                  onChange={e => setTplForm(p => ({ ...p, note: e.target.value }))}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-indigo-400"/>
              </div>
            </div>
            <button onClick={handleAddTemplate} disabled={!tplForm.name.trim() || !tplForm.amount}
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
                <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg shrink-0 ${CAT_COLOR[t.category]}`}>{t.category}</span>
                <span className="text-sm font-bold text-slate-700 flex-1 truncate">{t.name}</span>
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

      {/* ── 이번 달 추가 (one-time) ── */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <span className="text-sm font-black text-slate-800">{ymLabel} 추가 비용</span>
            <span className="ml-2 text-[11px] text-slate-400">이번 달만 적용</span>
          </div>
          <button onClick={() => setShowEntryForm(v => !v)}
            className="flex items-center gap-1.5 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-xl transition">
            {showEntryForm ? <X size={13}/> : <PlusCircle size={13}/>}
            {showEntryForm ? '닫기' : '추가'}
          </button>
        </div>

        {showEntryForm && (
          <div className="px-5 py-4 bg-slate-50 border-b border-slate-100 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">분류</label>
                <select value={entryForm.category} onChange={e => setEntryForm(p => ({ ...p, category: e.target.value as FixedCostCategory }))}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-indigo-400">
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">항목명</label>
                <input type="text" placeholder="예: 이번 달 추가 인건비" value={entryForm.label}
                  onChange={e => setEntryForm(p => ({ ...p, label: e.target.value }))}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-indigo-400"/>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">금액 (원)</label>
                <input type="text" inputMode="numeric" placeholder="예: 500000" value={entryForm.amount}
                  onChange={e => setEntryForm(p => ({ ...p, amount: e.target.value.replace(/[^0-9]/g, '') }))}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-indigo-400"/>
                {entryForm.amount && <p className="text-[11px] text-indigo-500 font-bold mt-1 ml-1">{Number(entryForm.amount).toLocaleString('ko-KR')}원</p>}
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">비고 (선택)</label>
                <input type="text" placeholder="메모" value={entryForm.note}
                  onChange={e => setEntryForm(p => ({ ...p, note: e.target.value }))}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-indigo-400"/>
              </div>
            </div>
            <button onClick={handleAddEntry} disabled={saving || !entryForm.label.trim() || !entryForm.amount}
              className="w-full bg-slate-700 text-white py-2.5 rounded-xl text-sm font-black hover:bg-slate-800 disabled:opacity-40 transition">
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        )}

        {monthEntries.length === 0 ? (
          <div className="py-8 text-center text-slate-300">
            <p className="text-xs font-bold">이번 달 추가 항목 없음</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {monthEntries.map(e => (
              <div key={e.id} className="flex items-center gap-3 px-5 py-3 group">
                <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg shrink-0 ${CAT_COLOR[e.category]}`}>{e.category}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-700 truncate">{e.label}</p>
                  {e.note && <p className="text-[11px] text-slate-400">{e.note}</p>}
                </div>
                <span className="text-sm font-black text-slate-800 tabular-nums shrink-0">{fmt(e.amount)}</span>
                <button onClick={() => onDelete(e.id)}
                  className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-200 hover:text-rose-400 hover:bg-rose-50 rounded-lg transition">
                  <Trash2 size={13}/>
                </button>
              </div>
            ))}
            {entryTotal > 0 && (
              <div className="px-5 py-3 flex justify-end bg-slate-50">
                <span className="text-sm font-black text-slate-700">추가 합계 <span className="text-slate-600 ml-2">{fmt(entryTotal)}</span></span>
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
};

export default CostManager;
