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
export interface PalletExchangeOpenInput {
  reference: PalletTransactionReference;
  sourceTransactionId: string;
  source: PalletTransactionBody;
}
export interface PalletExchangeOpenResult extends PalletExchangeOpenInput {
  actorUid: string;
  expectedVersion: string;
}
export interface PalletExchangeCompletionRequest extends PalletExchangeOpenInput {
  version: 2;
  action: 'complete-exchange';
  expectedVersion: string;
  returnDate: string;
}
export type PalletTransactionAnyRequest = PalletTransactionRequest | PalletExchangeCompletionRequest;
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
  | ({ mode: 'open-exchange' } & PalletExchangeOpenInput)
  | { mode: 'apply'; request: PalletTransactionAnyRequest }
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
function normalizePalletTransactionV1Request(value: unknown): PalletTransactionRequest {
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
/** 선택한 거래의 업무 필드만 보관한다. 문서 ID·회사와 미소유 필드는 native 버전으로 보호한다. */
export function normalizePalletExchangeSource(value: unknown): PalletTransactionBody {
  const raw = object(value), source: Record<string, unknown> = {};
  for (const key of ['partnerId', 'palletId', 'type', 'quantity', 'date', 'note', 'status', 'exchangeReturnQty', 'isTransfer']) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) source[key] = raw[key];
  }
  const normalized = normalizePalletTransactionV1Request({ version: 1, reference: { companyId: 'taebaek', operationId: 'source-projection', transactionId: 'source-projection' }, transaction: source }).transaction;
  if (normalized.type !== 'out' || normalized.status !== '교체중' || normalized.isTransfer === true) throw Error('교체중인 지급 거래만 완료할 수 있습니다.');
  return normalized;
}
export function normalizePalletExchangeOpenInput(value: unknown): PalletExchangeOpenInput {
  const row = object(value);
  fields(row, ['reference', 'sourceTransactionId', 'source']);
  const reference = normalizePalletTransactionReference(row.reference);
  if (!palletTransactionDocumentId(row.sourceTransactionId) || row.sourceTransactionId === reference.transactionId) throw Error('원 지급과 회수 거래의 번호를 확인해 주세요.');
  const source = normalizePalletExchangeSource(row.source);
  // source 원문에는 공개 필드 외 값을 섞지 않는다. 실제 문서에서 미지 필드를 투영할 때만 위 helper를 쓴다.
  fields(object(row.source), Object.keys(source));
  return { reference, sourceTransactionId: row.sourceTransactionId, source };
}
export function normalizePalletExchangeOpenResult(value: unknown): PalletExchangeOpenResult {
  const row = object(value);
  fields(row, ['reference', 'sourceTransactionId', 'source', 'actorUid', 'expectedVersion']);
  const input = normalizePalletExchangeOpenInput({ reference: row.reference, sourceTransactionId: row.sourceTransactionId, source: row.source });
  if (typeof row.actorUid !== 'string' || !row.actorUid || typeof row.expectedVersion !== 'string' || !/^\d+:\d{9}$/.test(row.expectedVersion)) throw Error('교체완료 준비 응답의 사용자·버전을 확인해 주세요.');
  return { ...input, actorUid: row.actorUid, expectedVersion: row.expectedVersion };
}
export function normalizePalletTransactionRequest(value: PalletTransactionRequest): PalletTransactionRequest;
export function normalizePalletTransactionRequest(value: PalletExchangeCompletionRequest): PalletExchangeCompletionRequest;
export function normalizePalletTransactionRequest(value: unknown): PalletTransactionAnyRequest;
export function normalizePalletTransactionRequest(value: unknown): PalletTransactionAnyRequest {
  const row = object(value);
  if (row.version === 1) return normalizePalletTransactionV1Request(value);
  fields(row, ['version', 'action', 'reference', 'sourceTransactionId', 'source', 'expectedVersion', 'returnDate']);
  const input = normalizePalletExchangeOpenInput({ reference: row.reference, sourceTransactionId: row.sourceTransactionId, source: row.source });
  if (row.version !== 2 || row.action !== 'complete-exchange' || typeof row.expectedVersion !== 'string' || !/^\d+:\d{9}$/.test(row.expectedVersion)
    || typeof row.returnDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.returnDate)
    || !Number.isFinite(Date.parse(row.returnDate)) || new Date(row.returnDate).toISOString().slice(0, 10) !== row.returnDate) throw Error('교체완료 원문의 버전·회수일을 확인해 주세요.');
  const request: PalletExchangeCompletionRequest = { version: 2, action: 'complete-exchange', ...input, expectedVersion: row.expectedVersion, returnDate: row.returnDate };
  if (JSON.stringify(request).length > 100000) throw Error('교체완료 원문이 너무 큽니다. 비고 길이를 확인해 주세요.');
  return request;
}
export function serializePalletTransactionRequest(value: PalletTransactionAnyRequest): string {
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
