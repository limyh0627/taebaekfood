import React, { useEffect, useMemo, useState } from 'react';
import { X, Inbox, FileDown, Sparkles } from 'lucide-react';
import { RawMaterialEntry } from '../types';
import { unitOf, DENSITY } from '../src/constants/formula';

interface Props {
  open: boolean;
  mode: 'inbound' | 'usage';
  materials: string[];               // 선택 가능한 원료 목록 (RM_LIST)
  defaultMaterial?: string;          // 현재 활성 원료 (있으면 기본값)
  currentUserName?: string;
  onClose: () => void;
  onSubmit: (entry: RawMaterialEntry) => void | Promise<void>;
}

// 사용 시 수율 자동 입고 매핑 (AdminApp.onAddRawMaterialEntry와 동일 — 안내용)
const YIELD_HINT: Record<string, { product: string; rate: number }> = {
  '참깨':   { product: '통깨참기름', rate: 0.45 },
  '깨분':   { product: '깨분참기름', rate: 0.45 },
  '들깨':   { product: '통들깨들기름', rate: 0.37 },
  '검정깨': { product: '볶음검정참깨', rate: 0.95 },
};

const todayStr = () => new Date().toISOString().slice(0, 10);

const RawMaterialEntryModal: React.FC<Props> = ({
  open, mode, materials, defaultMaterial, currentUserName, onClose, onSubmit,
}) => {
  const [date, setDate] = useState(todayStr());
  const [material, setMaterial] = useState(defaultMaterial ?? materials[0] ?? '');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 모달 열릴 때 폼 초기화
  useEffect(() => {
    if (!open) return;
    setDate(todayStr());
    setMaterial(defaultMaterial ?? materials[0] ?? '');
    setAmount('');
    setNote('');
    setSubmitting(false);
  }, [open, defaultMaterial, materials]);

  // 선택된 원료의 운영 단위 (kg / L)
  const unit = unitOf(material);

  const yieldHint = useMemo(() => {
    if (mode !== 'usage') return null;
    const m = YIELD_HINT[material];
    if (!m) return null;
    const productUnit = unitOf(m.product);
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return { product: m.product, rate: m.rate, derived: null, productUnit };
    return { product: m.product, rate: m.rate, derived: Math.round(amt * m.rate * 1000) / 1000, productUnit };
  }, [mode, material, amount]);

  if (!open) return null;

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!material) { alert('원료를 선택해주세요.'); return; }
    if (!amt || amt <= 0) { alert(`양(${unit})을 0보다 큰 값으로 입력해주세요.`); return; }
    setSubmitting(true);
    try {
      const id = mode === 'inbound' ? `rm-in-${Date.now()}` : `rm-use-${Date.now()}`;
      // L 입력은 저장 시 kg으로 환산. 비고에 원본 입력값 자동 추가
      const density = DENSITY[material] ?? 1.0;
      const amtKg = unit === 'L' ? Math.round(amt * density * 1000) / 1000 : amt;
      const inputTag = unit === 'L' ? ` · 사용자 입력: ${amt}L` : '';
      const finalNote = (note.trim() + inputTag).trim();
      await onSubmit({
        id,
        material,
        date,
        received: mode === 'inbound' ? amtKg : 0,
        used:     mode === 'usage'   ? amtKg : 0,
        note: finalNote,
        createdAt: new Date().toISOString(),
        type: 'manual',
        addedBy: currentUserName,
        unit: 'kg',          // canonical
        originalAmount: amt, // 사용자 원본 값
        originalUnit: unit,  // 'kg' or 'L'
      });
      onClose();
    } catch (err) {
      // 저장 실패를 조용히 묻지 않음 — 예전엔 throw 시 모달이 안 닫히고 멈춘 듯 보였다(모바일).
      console.error('[원료 기록 저장 실패]', err);
      alert('저장에 실패했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.');
    } finally {
      setSubmitting(false);
    }
  };

  const isInbound = mode === 'inbound';
  const accent = isInbound
    ? { bg: 'bg-emerald-600', hover: 'hover:bg-emerald-700', tint: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' }
    : { bg: 'bg-rose-500',    hover: 'hover:bg-rose-600',    tint: 'bg-rose-50',    text: 'text-rose-700',    border: 'border-rose-200' };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4">
      <form onSubmit={handleSubmit} className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className={`px-6 py-4 ${accent.tint} border-b ${accent.border} flex items-center justify-between`}>
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-xl ${accent.bg} text-white flex items-center justify-center`}>
              {isInbound ? <Inbox size={15} /> : <FileDown size={15} />}
            </div>
            <h2 className={`text-sm font-black ${accent.text}`}>
              {isInbound ? '원료 입고 기록' : '원료 사용 기록'}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-black text-slate-500 mb-1.5">날짜</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-slate-400"
              />
            </div>
            <div>
              <label className="block text-[11px] font-black text-slate-500 mb-1.5">원료</label>
              <select
                value={material}
                onChange={(e) => setMaterial(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-slate-400 bg-white"
              >
                {materials.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-black text-slate-500 mb-1.5">
              {isInbound ? '입고량' : '사용량'} ({unit})
            </label>
            <div className="relative">
              <input
                type="number"
                min="0"
                step="0.001"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                autoFocus
                className="w-full border border-slate-200 rounded-xl px-3 py-2 pr-12 text-sm font-black text-slate-800 outline-none focus:border-slate-400"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-black text-slate-400">{unit}</span>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-black text-slate-500 mb-1.5">비고 (선택)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={isInbound ? '예: 거래처/로트 번호 등' : '예: 착유 로트, 작업자 등'}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-slate-400"
            />
          </div>

          {yieldHint && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-sky-50 border border-sky-100">
              <Sparkles size={13} className="text-sky-500 mt-0.5 shrink-0" />
              <p className="text-[11px] font-bold text-sky-700 leading-relaxed">
                저장하면 <span className="font-black">{yieldHint.product}</span> 가
                {yieldHint.derived !== null ? <> <span className="font-black">{yieldHint.derived}{yieldHint.productUnit}</span> </> : ' '}
                자동 입고됩니다 (수율 {Math.round(yieldHint.rate * 100)}%).
              </p>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2 bg-slate-50/60">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded-xl text-xs font-black text-slate-500 hover:bg-slate-100 transition-colors disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={submitting}
            className={`px-5 py-2 rounded-xl text-xs font-black text-white ${accent.bg} ${accent.hover} transition-colors disabled:opacity-50`}
          >
            {submitting ? '저장 중...' : '저장'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default RawMaterialEntryModal;
