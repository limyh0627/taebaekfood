import React, { useLayoutEffect, useRef, useState } from 'react';
import ModalShell from './ModalShell';
import type { WorkbookSheetPreview } from '../workbookOutput';

/** 출력 내용은 호출자가 고정하고 이 창은 확인·취소만 담당한다. */
export function DocumentOutputPreview({ title, children, signal, onSave, onClose, saveLabel = '엑셀 저장', errorMessage = '파일을 저장하지 못했습니다. 미리보기는 유지했습니다. 같은 내용으로 다시 저장해 주세요.' }: {
  title: string; children: React.ReactNode; signal: AbortSignal; onSave: () => Promise<void>; onClose: () => void; saveLabel?: string; errorMessage?: string;
}) {
  const lock = useRef(false), closeButton = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useLayoutEffect(() => { if (busy) closeButton.current?.focus(); }, [busy]);
  const save = async () => {
    if (lock.current || signal.aborted) return;
    lock.current = true; setBusy(true); setError('');
    try { await onSave(); if (!signal.aborted) onClose(); }
    catch { if (!signal.aborted) setError(errorMessage); }
    finally { lock.current = false; if (!signal.aborted) setBusy(false); }
  };
  return <ModalShell title={title} layer={2200} size="large" onClose={onClose}
    footer={<div className="flex justify-end gap-2"><button ref={closeButton} type="button" className="h-10 rounded-lg border border-slate-300 px-4" onClick={onClose}>닫기</button><button type="button" className="h-10 rounded-lg bg-indigo-600 px-4 text-white disabled:opacity-50" disabled={busy} onClick={() => void save()}>{busy ? '처리 중…' : saveLabel}</button></div>}>
    {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}{children}
  </ModalShell>;
}

export function WorkbookSheets({ sheets }: { sheets: WorkbookSheetPreview[] }) {
  return <div className="space-y-6">{sheets.map(sheet => <section key={sheet.name} aria-label={`시트 ${sheet.name}`}><h4 className="mb-2 font-bold">{sheet.name}</h4>
    <div className="overflow-auto"><table className="table-fixed border-collapse text-sm" style={{ width: sheet.widths.reduce((sum, width) => sum + width, 0) }}><colgroup>{sheet.widths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup><tbody>{sheet.rows.map((row, index) => <tr key={index} style={{ height: row.height }}>{row.cells.map(cell => <td key={cell.column} colSpan={cell.colSpan} rowSpan={cell.rowSpan} title={cell.note} className="break-words border border-slate-200 px-2 py-1 align-middle whitespace-pre-wrap" style={{ textAlign: cell.align, fontWeight: cell.bold ? 700 : undefined }}>{cell.text}</td>)}</tr>)}</tbody></table></div>
  </section>)}</div>;
}
