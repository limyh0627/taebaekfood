import React, { useEffect, useRef, useState } from 'react';
import { BTN, BTN_SUB, CARD, SCROLL, TH, THEAD } from '../../../shared/ui/table';
import { appConfirm, appNotice } from '../../../shared/components/appDialog';
import LargeModalShell from '../../../shared/components/LargeModalShell';
import ProductionWorkDocumentPrint, { printProductionWorkDocument } from './ProductionWorkDocumentPrint';
import {
  editProductionWorkLine, emptyProductionWorkFields, mergeProductionWorkEvidence,
  productionWorkPrintPages, type ProductionWorkDocument, type ProductionWorkDocumentLine,
  type ProductionWorkEvidence, type ProductionWorkFields,
} from '../domain/productionWorkDocument';

export interface ProductionWorkDocumentEditorProps {
  initialDocument: ProductionWorkDocument;
  initialLines: ProductionWorkDocumentLine[];
  loadEvidence: () => Promise<ProductionWorkEvidence[]>;
  onSave: (document: ProductionWorkDocument, lines: ProductionWorkDocumentLine[], expectedRevision: number) =>
    Promise<{ document: ProductionWorkDocument; lines: ProductionWorkDocumentLine[] }>;
}

const fields: Array<{ key: keyof ProductionWorkFields; label: string; type?: 'date' | 'number'; batch?: boolean }> = [
  { key: 'manufacturedDate', label: '제조일자', type: 'date', batch: true },
  { key: 'itemNameSnapshot', label: '품목명', batch: true },
  { key: 'specSnapshot', label: '규격', batch: true },
  { key: 'manufacturingLotNo', label: '제조 LOT', batch: true },
  { key: 'expiryDate', label: '소비기한', type: 'date', batch: true },
  { key: 'productionQty', label: '생산량', type: 'number', batch: true },
  { key: 'productionUnit', label: '생산 단위', batch: true },
  { key: 'rawNameSnapshot', label: '원료명' },
  { key: 'rawUsedKg', label: '원료 사용량(kg)', type: 'number' },
  { key: 'rawLotNoSnapshot', label: '원료 LOT' },
  { key: 'workerNameSnapshot', label: '작업자' },
  { key: 'note', label: '비고' },
];
const INPUT = 'h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs font-bold';

// 날짜를 바꿀 때는 부모가 document.id를 key로 사용해 저장하지 않은 다른 날짜와 섞이지 않게 한다.
export default function ProductionWorkDocumentEditor({ initialDocument, initialLines, loadEvidence, onSave }: ProductionWorkDocumentEditorProps) {
  const [document, setDocument] = useState(initialDocument);
  const [lines, setLines] = useState(initialLines);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState(false);
  const operation = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const rows = productionWorkPrintPages(lines).flat();
  const issueCount = rows.filter(row => row.issues.length).length;
  const errorMessage = (error: unknown) => error instanceof Error ? error.message : '작업을 완료하지 못했습니다.';
  const run = async (action: () => Promise<void>) => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    try { await action(); } catch (error) { if (alive.current) await appNotice(errorMessage(error), '생산작업일지'); }
    finally { operation.current = false; if (alive.current) setBusy(false); }
  };
  const change = (line: ProductionWorkDocumentLine, field: typeof fields[number], text: string) => {
    const value = field.type === 'number' ? (text === '' ? null : Number(text)) : text;
    setLines(current => current.map(row => row.id === line.id || (field.batch && row.batchKey === line.batchKey)
      ? editProductionWorkLine(row, field.key, value) : row));
    setDirty(true);
  };
  const addLine = (batch?: ProductionWorkDocumentLine) => {
    const id = `${document.id}__manual__${crypto.randomUUID()}`;
    const values = { ...emptyProductionWorkFields(), manufacturedDate: document.documentDate };
    if (batch) {
      values.manufacturedDate = batch.manufacturedDate;
      values.itemId = batch.itemId;
      values.itemNameSnapshot = batch.itemNameSnapshot;
      values.specSnapshot = batch.specSnapshot;
      values.manufacturingLotNo = batch.manufacturingLotNo;
      values.expiryDate = batch.expiryDate;
      values.productionQty = batch.productionQty;
      values.productionUnit = batch.productionUnit;
    }
    setLines(current => [...current, {
      ...values, id, companyId: document.companyId, documentId: document.id, batchKey: batch?.batchKey ?? id,
      sortOrder: Math.max(-1, ...current.map(row => row.sortOrder)) + 1, sourceState: 'active',
      sourceSnapshot: { ...values }, manualFields: {},
      source: { kind: 'manual', sourceId: id, operationId: '', ledgerId: '', lotId: '',
        recordedAt: '', importedAt: new Date().toISOString() },
    }]);
    setDirty(true);
  };
  return <section className={`${CARD} p-4 space-y-4`} aria-label="생산작업일지 작성">
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="text-base font-black mr-auto">생산작업일지 · {document.documentDate}</h2>
      <button className={BTN_SUB} disabled={busy} onClick={() => void run(async () => {
        const evidence = await loadEvidence();
        if (!alive.current) return;
        const merged = mergeProductionWorkEvidence(document, lines, evidence, new Date().toISOString());
        setLines(merged);
        setDirty(true);
      })}>실제 근거 불러오기</button>
      <button className={BTN_SUB} disabled={busy} onClick={() => addLine()}>행 추가</button>
      <button className={BTN_SUB} disabled={busy} onClick={() => setPreview(true)}>인쇄 미리보기</button>
      <button className={BTN} disabled={busy} onClick={() => void run(async () => {
        if (issueCount && !await appConfirm({
          title: '미확인 항목 포함', message: `${issueCount}행에 미확인 항목이 있습니다. 작성 중인 문서로 저장할까요?`,
          confirmText: '작성 중 저장',
        })) return;
        if (!alive.current) return;
        const saved = await onSave(document, lines, document.revision);
        if (!alive.current) return;
        setDocument(saved.document);
        setLines(saved.lines);
        setDirty(false);
        await appNotice('생산작업일지를 저장했습니다. 재고와 원장은 변경하지 않았습니다.', '저장 완료');
      })}>{busy ? '처리 중' : '저장'}</button>
    </div>
    <p className="text-xs text-slate-500">실제 생산·원료 사용·로트 근거만 불러옵니다. 판매량이나 현재 배합비로 빈칸을 추정하지 않습니다. 작성·검토·승인은 이름 기록이며 전자결재가 아닙니다.</p>
    <div className="flex flex-wrap gap-3">
      {([['preparedByName', '작성'], ['reviewedByName', '검토'], ['approvedByName', '승인']] as const).map(([key, label]) =>
        <label key={key} className="text-xs text-slate-600">{label}
          <input aria-label={`${label} 이름`} className={INPUT} value={document[key]} disabled={busy}
            onChange={event => { setDocument({ ...document, [key]: event.target.value }); setDirty(true); }} />
        </label>)}
    </div>
    <p role="status" className="text-xs text-slate-500">
      <span className="text-blue-600">{lines.length}</span>행 · 확인 필요 <span className="text-blue-600">{issueCount}</span>행
      · {dirty ? '저장하지 않은 변경 있음' : `저장 버전 ${document.revision}`}
    </p>
    <div className={SCROLL}>
      <table className="w-full min-w-[1800px] text-xs">
        <thead className={THEAD}><tr>{fields.map(field => <th key={field.key} className={TH}>{field.label}</th>)}<th className={TH}>근거·확인</th></tr></thead>
        <tbody>{rows.map(({ line, showProduction, issues }, index) => <tr key={line.id} className="border-b border-slate-200 align-top">
          {fields.map(field => <td key={field.key} className="p-1">
            {field.batch && !showProduction ? <span className="text-slate-400">{field.key === 'itemNameSnapshot' ? '동일 생산 건' : '—'}</span>
              : <input aria-label={`${index + 1}행 ${field.label}`} className={INPUT} type={field.type ?? 'text'}
                step={field.type === 'number' ? 'any' : undefined} min={field.type === 'number' ? '0' : undefined}
                value={line[field.key] ?? ''} disabled={busy}
                onChange={event => change(line, field, event.target.value)} />}
          </td>)}
          <td className="p-2 min-w-[200px]">
            {showProduction && <button className={BTN_SUB} disabled={busy} onClick={() => addLine(line)}>원료 행 추가</button>}
            <details><summary className="cursor-pointer">{issues.length ? '확인 필요' : '입력 완료'} · 근거 보기</summary>
              <p className="whitespace-pre-wrap">{issues.join('\n')}</p>
              <dl className="break-all text-slate-500">
                <dt>출처</dt><dd>{line.source.kind} / {line.source.sourceId}</dd>
                <dt>원료 작업</dt><dd>{line.source.operationId || '미확인'}</dd>
                <dt>원장</dt><dd>{line.source.ledgerId || '미확인'}</dd>
                <dt>원료 로트 ID</dt><dd>{line.source.lotId || '미확인'}</dd>
                <dt>원본 기록 시각</dt><dd>{line.source.recordedAt || '미확인'}</dd>
              </dl>
            </details>
            {line.source.kind === 'manual' && <button className={BTN_SUB} disabled={busy} onClick={() => void run(async () => {
              if (!await appConfirm({ title: '수동 행 삭제', message: '이 문서의 수동 행만 삭제할까요? 원장과 재고는 변경되지 않습니다.' })) return;
              setLines(current => current.filter(row => row.id !== line.id)); setDirty(true);
            })}>행 삭제</button>}
          </td>
        </tr>)}</tbody>
      </table>
    </div>
    {!lines.length && <p className="py-8 text-center text-sm text-slate-500">생산 근거를 불러오거나 행을 추가해 주세요.</p>}
    <label className="block text-xs text-slate-600">특이사항
      <textarea aria-label="특이사항" className={`${INPUT} h-20 mt-1`} disabled={busy} value={document.specialNotes}
        onChange={event => { setDocument({ ...document, specialNotes: event.target.value }); setDirty(true); }} />
    </label>
    {preview && <LargeModalShell title="생산작업일지 인쇄 미리보기" onClose={() => setPreview(false)}>
      <div className="p-4">
        <p className="text-xs text-slate-500 mb-3">A4 가로 · 쪽당 20행 · 저장 전 내용 미리보기. 미확인 항목을 확인한 뒤 출력해 주세요.</p>
        <button className={BTN} disabled={busy} onClick={() => void run(() => printProductionWorkDocument({ document, lines }))}>인쇄 / PDF 저장</button>
        <div className={SCROLL}><ProductionWorkDocumentPrint document={document} lines={lines} /></div>
      </div>
    </LargeModalShell>}
  </section>;
}
