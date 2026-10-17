import React, { useLayoutEffect, useRef, useState } from 'react';
import ModalShell from './ModalShell';
import type { ListExcelSnapshot } from '../listExcel';

export function ListExcelPreview({ snapshot, signal, onSave, onClose }: {
  snapshot: ListExcelSnapshot; signal: AbortSignal; onSave: () => Promise<void>; onClose: () => void;
}) {
  const lock = useRef(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useLayoutEffect(() => { if (busy) closeButton.current?.focus(); }, [busy]);
  const save = async () => {
    if (lock.current || signal.aborted) return;
    lock.current = true; setBusy(true); setError('');
    try { await onSave(); if (!signal.aborted) onClose(); }
    catch { if (!signal.aborted) setError('엑셀 파일을 저장하지 못했습니다. 미리보기 내용은 유지했습니다. 다시 저장해 주세요.'); }
    finally { lock.current = false; if (!signal.aborted) setBusy(false); }
  };
  return <ModalShell title="엑셀 미리보기" subtitle={`${snapshot.title} · ${snapshot.rows.length}건`} layer={2200} size="large" onClose={onClose}
    footer={<div className="flex justify-end gap-2"><button ref={closeButton} type="button" onClick={onClose} className="h-10 rounded-lg border border-slate-300 px-4">닫기</button><button type="button" disabled={busy} onClick={() => void save()} className="h-10 rounded-lg bg-indigo-600 px-4 text-white disabled:opacity-50">{busy ? '저장 중…' : '엑셀 저장'}</button></div>}>
    <p className="mb-3 break-words text-sm">{snapshot.subtitle}</p>
    {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
    <div className="max-h-[60vh] overflow-auto"><table className="w-full border-collapse text-sm"><thead><tr>{snapshot.columns.map((column, index) => <th key={index} className="whitespace-nowrap border border-slate-200 bg-white p-2 text-left">{column.header}</th>)}</tr></thead>
      <tbody>{snapshot.rows.map((row, index) => <tr key={index}>{snapshot.columns.map((column, cell) => <td key={cell} className={`border border-slate-200 p-2 ${column.number ? 'text-right tabular-nums' : 'break-words'}`}>{row[cell] ?? ''}</td>)}</tr>)}</tbody></table></div>
  </ModalShell>;
}
