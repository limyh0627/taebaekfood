export const FINANCIAL_OPENING_KINDS = ['partner-create', 'loan-create', 'loan-update', 'account-create', 'account-update'] as const;
export type FinancialOpeningRecoveryKind = typeof FINANCIAL_OPENING_KINDS[number];
export interface FinancialOpeningRecoveryReference {
  companyId: 'taebaek' | 'punghoe';
  operationId: string;
  kind: FinancialOpeningRecoveryKind;
}
export interface FinancialOpeningRecoveryResult {
  version: 1;
  reference: FinancialOpeningRecoveryReference;
  actorUid: string;
  status: 'applied' | 'cancelled' | 'unknown';
  requestHash: string | null;
  result?: 'created' | 'unchanged' | 'updated';
  message: string;
}
export interface FinancialOpeningRecoveryCommand {
  mode: 'inspect' | 'cancel';
  reference: FinancialOpeningRecoveryReference;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('기초 금융 요청 정보를 확인해 주세요.');
  return value as Record<string, unknown>;
}
export function normalizeFinancialOpeningRecoveryReference(value: unknown): FinancialOpeningRecoveryReference {
  const row = object(value);
  if (Object.keys(row).some(key => !['companyId', 'operationId', 'kind'].includes(key))
    || !['taebaek', 'punghoe'].includes(String(row.companyId))
    || typeof row.operationId !== 'string' || !/^[-A-Za-z0-9_:]{1,160}$/.test(row.operationId)
    || !FINANCIAL_OPENING_KINDS.includes(row.kind as FinancialOpeningRecoveryKind)) {
    throw Error('기초 금융 요청의 회사·번호·종류를 확인해 주세요.');
  }
  return { companyId: row.companyId as FinancialOpeningRecoveryReference['companyId'], operationId: row.operationId, kind: row.kind as FinancialOpeningRecoveryKind };
}
export function normalizeFinancialOpeningRecoveryResult(value: unknown, reference: FinancialOpeningRecoveryReference, actorUid: string): FinancialOpeningRecoveryResult {
  const row = object(value), actual = normalizeFinancialOpeningRecoveryReference(row.reference), expected = normalizeFinancialOpeningRecoveryReference(reference);
  const hasResult = Object.prototype.hasOwnProperty.call(row, 'result');
  if (row.version !== 1 || !actorUid || row.actorUid !== actorUid
    || actual.companyId !== expected.companyId || actual.operationId !== expected.operationId || actual.kind !== expected.kind
    || !['applied', 'cancelled', 'unknown'].includes(String(row.status)) || typeof row.message !== 'string'
    || (row.requestHash !== null && (typeof row.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.requestHash)))
    || (row.status === 'applied' ? typeof row.requestHash !== 'string' || !['created', 'unchanged', 'updated'].includes(String(row.result)) : hasResult || row.requestHash !== null)) {
    throw Error('기초 금융 처리 기록의 회사·사용자·요청 근거가 다릅니다.');
  }
  return { version: 1, reference: actual, actorUid, status: row.status as FinancialOpeningRecoveryResult['status'], requestHash: row.requestHash as string | null,
    ...(row.status === 'applied' ? { result: row.result as FinancialOpeningRecoveryResult['result'] } : {}), message: row.message };
}
