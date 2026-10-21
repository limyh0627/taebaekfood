export const PALLET_TRANSACTION_OPERATIONS = 'palletTransactionOperations';
export interface PalletTransactionReference {
  companyId: 'taebaek' | 'punghoe';
  operationId: string;
  transactionId: string;
}
export interface PalletTransactionBody {
  partnerId: string;
  palletId: string;
  type: 'in' | 'out';
  quantity: number;
  date: string;
  note?: string;
  status?: '교체중';
  exchangeReturnQty?: number;
  isTransfer?: boolean;
}
export interface PalletTransactionRequest {
  version: 1;
  reference: PalletTransactionReference;
  transaction: PalletTransactionBody;
  transfer?: { originalTotal: number; expectedVersion: string };
}
export interface PalletTransactionOpenResult {
  reference: PalletTransactionReference;
  actorUid: string;
  palletId: string;
  originalTotal: number;
  expectedVersion: string;
}
export interface PalletTransactionResult {
  version: 1;
  reference: PalletTransactionReference;
  actorUid: string;
  status: 'applied' | 'cancelled' | 'unknown';
  requestHash: string | null;
  message: string;
}
export type PalletTransactionCommand =
  | { mode: 'open'; reference: PalletTransactionReference; palletId: string; originalTotal: number }
  | { mode: 'apply'; request: PalletTransactionRequest }
  | { mode: 'inspect' | 'cancel'; reference: PalletTransactionReference };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('파렛트 요청 원문을 확인해 주세요.');
  return value as Record<string, unknown>;
}
function fields(row: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(row).some(key => !allowed.includes(key))) throw Error('파렛트 요청에 허용되지 않은 필드가 있습니다.');
}
export function palletTransactionDocumentId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 500 && !value.includes('/') && value !== '.' && value !== '..';
}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export function normalizePalletTransactionReference(value: unknown): PalletTransactionReference {
  const row = object(value);
  fields(row, ['companyId', 'operationId', 'transactionId']);
  if (!['taebaek', 'punghoe'].includes(String(row.companyId)) || !palletTransactionDocumentId(row.operationId)
    || !palletTransactionDocumentId(row.transactionId)) throw Error('파렛트 요청의 회사·번호를 확인해 주세요.');
  return { companyId: row.companyId as PalletTransactionReference['companyId'], operationId: row.operationId, transactionId: row.transactionId };
}
export function normalizePalletTransactionRequest(value: unknown): PalletTransactionRequest {
  const row = object(value);
  fields(row, ['version', 'reference', 'transaction', 'transfer']);
  const reference = normalizePalletTransactionReference(row.reference), body = object(row.transaction);
  fields(body, ['partnerId', 'palletId', 'type', 'quantity', 'date', 'note', 'status', 'exchangeReturnQty', 'isTransfer']);
  if (row.version !== 1 || !palletTransactionDocumentId(body.partnerId) || !palletTransactionDocumentId(body.palletId)
    || !['in', 'out'].includes(String(body.type)) || !finite(body.quantity) || !Number.isSafeInteger(body.quantity) || body.quantity <= 0
    || typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)
    || !Number.isFinite(Date.parse(body.date)) || new Date(body.date).toISOString().slice(0, 10) !== body.date
    || (body.note !== undefined && typeof body.note !== 'string')
    || (body.isTransfer !== undefined && typeof body.isTransfer !== 'boolean')
    || (body.status !== undefined && body.status !== '교체중')
    || (body.exchangeReturnQty !== undefined && (!finite(body.exchangeReturnQty) || !Number.isSafeInteger(body.exchangeReturnQty) || body.exchangeReturnQty < 0))
    || (body.status === '교체중' && (body.type !== 'out' || body.isTransfer === true))
    || (body.status === undefined && body.exchangeReturnQty !== undefined)) throw Error('파렛트 거래의 종류·수량·일자를 확인해 주세요.');
  const transaction: PalletTransactionBody = { partnerId: body.partnerId, palletId: body.palletId, type: body.type as 'in' | 'out', quantity: body.quantity, date: body.date,
    ...(body.note !== undefined ? { note: body.note as string } : {}), ...(body.status !== undefined ? { status: '교체중' as const } : {}),
    ...(body.exchangeReturnQty !== undefined ? { exchangeReturnQty: body.exchangeReturnQty as number } : {}),
    ...(body.isTransfer !== undefined ? { isTransfer: body.isTransfer as boolean } : {}) };
  let transfer: PalletTransactionRequest['transfer'];
  if (body.isTransfer === true) {
    const original = object(row.transfer);
    fields(original, ['originalTotal', 'expectedVersion']);
    if (!finite(original.originalTotal) || !Number.isSafeInteger(original.originalTotal) || original.originalTotal < 0 || typeof original.expectedVersion !== 'string' || !/^\d+:\d{9}$/.test(original.expectedVersion)) throw Error('선택한 파렛트 재고의 버전을 확인해 주세요.');
    transfer = { originalTotal: original.originalTotal, expectedVersion: original.expectedVersion };
  } else if (row.transfer !== undefined) throw Error('일반 거래에 이동 재고 원문을 보낼 수 없습니다.');
  const result: PalletTransactionRequest = { version: 1, reference, transaction, ...(transfer ? { transfer } : {}) };
  if (JSON.stringify(result).length > 100000) throw Error('파렛트 요청 원문이 너무 큽니다. 비고 길이를 줄여 주세요.');
  return result;
}
export function serializePalletTransactionRequest(value: PalletTransactionRequest): string {
  return JSON.stringify(normalizePalletTransactionRequest(value));
}
function sameReference(left: PalletTransactionReference, right: PalletTransactionReference) {
  return JSON.stringify(left) === JSON.stringify(normalizePalletTransactionReference(right));
}
export function normalizePalletTransactionOpenResult(value: unknown, reference: PalletTransactionReference, actorUid: string, palletId: string, originalTotal: number): PalletTransactionOpenResult {
  const row = object(value), actual = normalizePalletTransactionReference(row.reference);
  if (!actorUid || row.actorUid !== actorUid || !sameReference(actual, reference) || row.palletId !== palletId || row.originalTotal !== originalTotal
    || !finite(row.originalTotal) || typeof row.expectedVersion !== 'string' || !/^\d+:\d{9}$/.test(row.expectedVersion)) throw Error('파렛트 준비 응답의 원문·사용자가 다릅니다.');
  return { reference: actual, actorUid, palletId, originalTotal, expectedVersion: row.expectedVersion };
}
export function normalizePalletTransactionResult(value: unknown, reference: PalletTransactionReference, actorUid: string): PalletTransactionResult {
  const row = object(value), actual = normalizePalletTransactionReference(row.reference);
  if (row.version !== 1 || !actorUid || row.actorUid !== actorUid || !sameReference(actual, reference)
    || !['applied', 'cancelled', 'unknown'].includes(String(row.status)) || typeof row.message !== 'string'
    || (row.status === 'applied' ? typeof row.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.requestHash) : row.requestHash !== null)) throw Error('파렛트 처리 결과의 회사·사용자·원문 근거가 다릅니다.');
  return { version: 1, reference: actual, actorUid, status: row.status as PalletTransactionResult['status'], requestHash: row.requestHash as string | null, message: row.message };
}
