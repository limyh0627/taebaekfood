import { commandHash, type RawInventoryCommand } from '../../shared/rawInventoryCore';
import { companyOf, type CompanyId, type PurchaseOrder } from '../../shared/types';
import { isCalendarDay } from '../../shared/day';

export interface OemExternalEvidence {
  po: PurchaseOrder | null;
  job: Record<string, any> | null;
  receipts: Record<string, Record<string, any> | null>;
  reversals: Record<string, Record<string, any> | null>;
  guards: Record<string, Record<string, any> | null>;
}
export interface OemExternalRow {
  poId: string; partnerName: string; state: 'confirmed' | 'partial' | 'unknown' | 'cancelled' | 'received';
  rows: { rawItemId: string; material: string; requestedKg: number; reportedKg?: number; appliedKg?: number; reason?: string }[];
  reason?: string;
}
export function oemIssueEvidenceKey(po: PurchaseOrder): string {
  return JSON.stringify([po.id, companyOf(po), po.poType, po.status, po.oemIssueDate, po.oemIssueStatus,
    po.oemSent, po.oemCancelledAt, po.oemCancelOperationId, po.oemReceiptOperationId]);
}
/** 장부 송출 원문 대조이며 물리 창고의 실측 잔량·소유재고 평가를 계산하지 않는다. */
export function projectOemExternalEvidence(po: PurchaseOrder, companyId: CompanyId, evidence?: OemExternalEvidence): OemExternalRow {
  const result: OemExternalRow = { poId: po.id, partnerName: po.partnerName ?? '', state: 'unknown', rows: [], reason: '송출 근거 미확인' };
  const sent = po.oemSent;
  if (companyOf(po) !== companyId || po.poType !== 'oem' || !po.id || po.id.includes('/') || !Array.isArray(sent) || !sent.length
    || !['pending','invoiced','received','cancelled'].includes(po.status) || po.status === 'cancelled' && !po.oemCancelledAt
    || !isCalendarDay(po.oemIssueDate ?? '') || sent.some(row => !row || typeof row.rawItemId !== 'string' || !row.rawItemId || row.rawItemId.includes('/') || !Number.isFinite(row.kg) || row.kg <= 0)
    || new Set(sent.map(row => row.rawItemId)).size !== sent.length) return result;
  result.rows = sent.map(row => ({ rawItemId: row.rawItemId!, material: row.material, requestedKg: row.kg }));
  const jobId = `oem-issue:${po.id}`;
  const expected = sent.map(row => `${jobId}:${row.rawItemId}`);
  const job = evidence?.job;
  if (!evidence?.po || oemIssueEvidenceKey(evidence.po) !== oemIssueEvidenceKey(po) || !job || job.companyId !== companyId
    || job.id !== jobId || job.source?.type !== 'oem' || job.source?.id !== po.id
    || !['pending','processing','complete','failed'].includes(job.status) || JSON.stringify(job.expectedOperationIds) !== JSON.stringify(expected)) return result;
  const cancelled = !!po.oemCancelledAt || !!po.oemCancelOperationId;
  let confirmed = 0;
  result.rows = result.rows.map((row, index) => {
    const operationId = expected[index];
    const command: RawInventoryCommand = { operationId, companyId, rawItemId: row.rawItemId, materialSnapshot: row.material,
      effectiveAt: `${po.oemIssueDate}T12:00:00+09:00`, source: { type: 'oem', id: po.id }, kind: 'consume', kg: row.requestedKg };
    const receipt = evidence.receipts[operationId];
    if (!receipt || receipt.companyId !== companyId || receipt.operationId !== operationId || receipt.rawItemId !== row.rawItemId
      || receipt.source?.type !== 'oem' || receipt.source?.id !== po.id || receipt.kind !== 'consume' || receipt.commandHash !== commandHash(command)
      || receipt.reportedDeltaKg !== -row.requestedKg || !Number.isFinite(receipt.appliedDeltaKg)
      || ![0, -row.requestedKg].includes(receipt.appliedDeltaKg)) return { ...row, reason: '원료 송출 영수증 미확인' };
    const guard = evidence.guards[operationId];
    if (cancelled || guard) {
      const reverseId = `oem-cancel:${po.id}:${row.rawItemId}`;
      const reversal = evidence.reversals[operationId];
      const reverseCommand: RawInventoryCommand = { operationId: reverseId, companyId, rawItemId: row.rawItemId, materialSnapshot: row.material,
        effectiveAt: po.oemCancelledAt ?? '', source: { type: 'oem', id: po.id }, kind: 'reverse', originalOperationId: operationId };
      if (!cancelled || !po.oemCancelledAt || !Number.isFinite(Date.parse(po.oemCancelledAt)) || po.oemCancelOperationId !== `oem-cancel:${po.id}` || !guard || !reversal
        || guard.companyId !== companyId || guard.rawItemId !== row.rawItemId || guard.originalOperationId !== operationId || guard.reverseOperationId !== reverseId
        || reversal.companyId !== companyId || reversal.rawItemId !== row.rawItemId || reversal.operationId !== reverseId || reversal.reversalOf !== operationId
        || reversal.source?.type !== 'oem' || reversal.source?.id !== po.id || reversal.kind !== 'reverse' || reversal.commandHash !== commandHash(reverseCommand)
        || reversal.reportedDeltaKg !== row.requestedKg || reversal.appliedDeltaKg !== -receipt.appliedDeltaKg)
        return { ...row, reason: '취소 원문·복원 근거 미확인' };
    }
    confirmed++;
    return { ...row, reportedKg: -receipt.reportedDeltaKg, appliedKg: receipt.appliedDeltaKg === 0 ? 0 : -receipt.appliedDeltaKg };
  });
  result.state = confirmed === result.rows.length ? cancelled ? 'cancelled' : po.status === 'received' ? 'received' : 'confirmed' : confirmed ? 'partial' : 'unknown';
  result.reason = confirmed === result.rows.length ? undefined : '일부 송출 원문을 확인하지 못했습니다.';
  return result;
}
