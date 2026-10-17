import React, { useEffect, useRef, useState } from 'react';
import DateChipButton from '../../../shared/components/DateChipButton';
import { appNotice } from '../../../shared/components/appDialog';

/** 달력 탐색은 초안만 바꾸고 명시적인 적용으로 날짜를 확정한다. */
export function VoucherDateChip({ value, onApply }: { value: string; onApply: (date: string) => Promise<unknown> | unknown }) {
  const [draft, setDraft] = useState(value);
  const currentValue = useRef(value);
  currentValue.current = value;
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(value), [value]);
  return <span className="inline-flex items-center gap-1">
    <DateChipButton label="전표일자" value={draft} text={draft} disabled={saving} onChange={setDraft} />
    {draft !== value && <>
      <button type="button" className="rounded-md border border-indigo-200 bg-indigo-50 px-1.5 py-1 text-[10px] font-bold text-indigo-700 disabled:opacity-50" disabled={saving} onClick={async () => {
        if (saving) return;
        setSaving(true);
        try { await onApply(draft); setDraft(currentValue.current); }
        catch (error) { void appNotice(`날짜를 저장하지 못했습니다: ${(error as Error).message}`); }
        finally { setSaving(false); }
      }}>날짜 적용</button>
      <button type="button" className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-1 text-[10px] font-bold text-slate-600 disabled:opacity-50" disabled={saving} onClick={() => setDraft(value)}>취소</button>
    </>}
  </span>;
}

