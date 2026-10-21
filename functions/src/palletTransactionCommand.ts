import * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  PALLET_TRANSACTION_OPERATIONS, normalizePalletTransactionReference, normalizePalletTransactionRequest,
  normalizePalletTransactionResult, normalizePalletTransactionOpenResult, serializePalletTransactionRequest,
  normalizePalletExchangeOpenInput, normalizePalletExchangeSource, normalizePalletExchangeOpenResult,
  palletTransactionDocumentId, type PalletTransactionReference, type PalletTransactionResult,
  type PalletTransactionOpenResult, type PalletTransactionAnyRequest, type PalletExchangeOpenResult,
} from './shared/palletTransactionCommand';

type Actor = { uid: string; token: Record<string, unknown> };
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const nativeVersion = (snapshot: admin.firestore.DocumentSnapshot) => snapshot.updateTime
  ? `${snapshot.updateTime.seconds}:${String(snapshot.updateTime.nanoseconds).padStart(9, '0')}` : null;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpsError('invalid-argument', '파렛트 요청 원문을 확인해 주세요.');
  return value as Record<string, unknown>;
}
function requireFields(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new HttpsError('invalid-argument', '파렛트 요청의 필드를 확인해 주세요.');
}
function result(reference: PalletTransactionReference, actorUid: string, status: PalletTransactionResult['status'], requestHash: string | null): PalletTransactionResult {
  return { version: 1, reference, actorUid, status, requestHash,
    message: status === 'applied' ? '이 파렛트 거래의 등록을 완료했습니다. 이후 수정·삭제 여부는 확인하지 않았습니다.'
      : status === 'cancelled' ? '이 요청의 미처리 중단을 확인했습니다. 이미 등록된 거래를 되돌린 것이 아닙니다.'
        : '이 요청의 처리 기록이 없습니다. 아직 처리되지 않았다고 단정할 수 없습니다.' };
}
function receipt(raw: admin.firestore.DocumentData, reference: PalletTransactionReference, uid: string): PalletTransactionResult {
  try {
    const stored = normalizePalletTransactionResult(raw, reference, uid);
    if (stored.status === 'unknown') throw Error();
    if (stored.status === 'applied') {
      if (typeof raw.requestText !== 'string' || hash(raw.requestText) !== stored.requestHash) throw Error();
      const request = normalizePalletTransactionRequest(JSON.parse(raw.requestText));
      if (serializePalletTransactionRequest(request) !== raw.requestText || JSON.stringify(request.reference) !== JSON.stringify(reference)) throw Error();
    } else if (raw.requestText !== null) throw Error();
    return stored;
  } catch { throw new HttpsError('failed-precondition', '기존 파렛트 처리 기록의 회사·사용자·원문 근거를 확인하지 못했습니다.'); }
}
function sameCompany(snapshot: admin.firestore.DocumentSnapshot, companyId: string, label: string) {
  if (!snapshot.exists || snapshot.data()?.companyId !== companyId) throw new HttpsError('failed-precondition', `${label}의 현재 회사와 존재 여부를 확인해 주세요.`);
}

/** 등록·교체완료와 영수증을 원자 확정하며, 기존 삭제의 총량 역산·전체 문서 편집 경합은 별도 한계로 남긴다. */
export async function executePalletTransactionForActor(
  db: admin.firestore.Firestore, actor: Actor | undefined, input: unknown,
): Promise<PalletTransactionResult | PalletTransactionOpenResult | PalletExchangeOpenResult> {
  if (!actor?.uid || typeof actor.token.employeeId !== 'string' || !['taebaek', 'punghoe'].includes(String(actor.token.companyId)))
    throw new HttpsError('permission-denied', '로그인한 회사 직원만 파렛트 요청을 처리할 수 있습니다.');
  const value = object(input), mode = value.mode;
  if (!['open', 'open-exchange', 'apply', 'inspect', 'cancel'].includes(String(mode))) throw new HttpsError('invalid-argument', '파렛트 처리 종류를 확인해 주세요.');
  requireFields(value, mode === 'apply' ? ['mode', 'request'] : mode === 'open' ? ['mode', 'reference', 'palletId', 'originalTotal']
    : mode === 'open-exchange' ? ['mode', 'reference', 'sourceTransactionId', 'source'] : ['mode', 'reference']);
  let request: PalletTransactionAnyRequest | undefined, reference: PalletTransactionReference;
  try {
    request = mode === 'apply' ? normalizePalletTransactionRequest(value.request) : undefined;
    reference = request?.reference ?? normalizePalletTransactionReference(value.reference);
  } catch (error) { throw new HttpsError('invalid-argument', error instanceof Error ? error.message : '파렛트 원문을 확인해 주세요.'); }
  if (reference.companyId !== actor.token.companyId) throw new HttpsError('permission-denied', '다른 회사 파렛트 요청은 처리할 수 없습니다.');
  if (mode === 'open-exchange') {
    let opening;
    try { opening = normalizePalletExchangeOpenInput({ reference, sourceTransactionId: value.sourceTransactionId, source: value.source }); }
    catch (error) { throw new HttpsError('invalid-argument', error instanceof Error ? error.message : '선택한 교체 지급 원문을 확인해 주세요.'); }
    const source = await db.collection('palletTransactions').doc(opening.sourceTransactionId).get();
    sameCompany(source, reference.companyId, '교체 지급 거래');
    const version = nativeVersion(source);
    try {
      if (!version || JSON.stringify(normalizePalletExchangeSource(source.data())) !== JSON.stringify(opening.source)) throw Error();
    } catch { throw new HttpsError('failed-precondition', '선택한 교체 지급 거래가 변경됐습니다. 현재 이력을 다시 열어 주세요.'); }
    return normalizePalletExchangeOpenResult({ ...opening, actorUid: actor.uid, expectedVersion: version });
  }
  if (mode === 'open') {
    if (!palletTransactionDocumentId(value.palletId) || typeof value.originalTotal !== 'number' || !Number.isSafeInteger(value.originalTotal) || value.originalTotal < 0)
      throw new HttpsError('invalid-argument', '선택한 파렛트의 보유 총량을 확인해 주세요.');
    const pallet = await db.collection('pallets').doc(value.palletId).get();
    sameCompany(pallet, reference.companyId, '파렛트');
    const version = nativeVersion(pallet);
    if (pallet.data()!.total !== value.originalTotal || !version) throw new HttpsError('failed-precondition', '파렛트 보유 총량이 변경됐습니다. 현재 자료를 다시 열어 주세요.');
    return normalizePalletTransactionOpenResult({ reference, actorUid: actor.uid, palletId: value.palletId,
      originalTotal: value.originalTotal, expectedVersion: version }, reference, actor.uid, value.palletId, value.originalTotal);
  }
  const operation = db.collection(PALLET_TRANSACTION_OPERATIONS).doc(reference.operationId);
  const text = request ? serializePalletTransactionRequest(request) : null;
  const digest = text ? hash(text) : null;
  return db.runTransaction(async tx => {
    // 같은 작업번호의 영수증을 먼저 읽어 삭제 뒤 재전송과 중단 뒤 늦은 등록을 봉쇄한다.
    const existing = await tx.get(operation);
    if (existing.exists) {
      const previous = receipt(existing.data()!, reference, actor.uid);
      if (mode === 'apply') {
        if (previous.status === 'cancelled') throw new HttpsError('failed-precondition', '중단된 파렛트 요청은 다시 등록하지 않습니다.',
          { version: 1, operationStatus: 'cancelled', palletTransactionRecovery: previous });
        if (previous.requestHash !== digest) throw new HttpsError('failed-precondition', '같은 요청 번호의 파렛트 원문이 다릅니다.');
      }
      return previous;
    }
    if (mode === 'inspect') return result(reference, actor.uid, 'unknown', null);
    if (mode === 'cancel') {
      const stopped = result(reference, actor.uid, 'cancelled', null);
      tx.create(operation, { ...stopped, requestText: null, createdAt: new Date().toISOString() });
      return stopped;
    }
    if (request!.version === 2) {
      const completion = request!;
      const sourceRef = db.collection('palletTransactions').doc(completion.sourceTransactionId);
      const returnRef = db.collection('palletTransactions').doc(reference.transactionId);
      const [source, child] = await Promise.all([tx.get(sourceRef), tx.get(returnRef)]);
      try {
        sameCompany(source, reference.companyId, '교체 지급 거래');
        if (child.exists) throw new HttpsError('failed-precondition', '예약한 회수 거래 번호가 이미 있습니다. 기존 거래를 덮어쓰지 않았습니다.');
        if (nativeVersion(source) !== completion.expectedVersion
          || JSON.stringify(normalizePalletExchangeSource(source.data())) !== JSON.stringify(completion.source))
          throw new HttpsError('failed-precondition', '교체 지급 거래가 준비 이후 변경됐습니다. 현재 이력을 다시 확인해 주세요.');
      } catch (error) {
        throw new HttpsError('failed-precondition', error instanceof Error ? error.message : '교체 지급 원문을 확인하지 못했습니다.',
          { version: 1, operationStatus: 'rejected', writes: false, reference });
      }
      const returnQuantity = completion.source.exchangeReturnQty ?? completion.source.quantity;
      const applied = { ...result(reference, actor.uid, 'applied', digest), message: '이 교체 지급의 완료 처리를 확정했습니다. 이후 수정·삭제 여부는 확인하지 않았습니다.' };
      tx.update(sourceRef, { status: '교체완료' });
      if (returnQuantity > 0) tx.create(returnRef, { companyId: reference.companyId, partnerId: completion.source.partnerId,
        palletId: completion.source.palletId, type: 'in', quantity: returnQuantity, date: completion.returnDate, note: '교체완료 회수' });
      tx.create(operation, { ...applied, requestText: text, createdAt: new Date().toISOString() });
      return applied;
    }
    const registration = request!;
    const body = registration.transaction;
    const target = db.collection('palletTransactions').doc(reference.transactionId);
    const palletRef = db.collection('pallets').doc(body.palletId);
    const [transaction, pallet, partner] = await Promise.all([
      tx.get(target), tx.get(palletRef), tx.get(db.collection('partners').doc(body.partnerId)),
    ]);
    try {
      if (transaction.exists) throw new HttpsError('failed-precondition', '같은 번호의 파렛트 거래가 이미 있습니다. 기존 거래는 덮어쓰지 않았습니다.');
      sameCompany(pallet, reference.companyId, '파렛트');
      sameCompany(partner, reference.companyId, '거래처');
      if (registration.transfer && (!Number.isSafeInteger(pallet.data()!.total) || pallet.data()!.total < 0
        || !Number.isSafeInteger(registration.transfer.originalTotal + (body.type === 'in' ? body.quantity : -body.quantity))))
        throw new HttpsError('failed-precondition', '파렛트 보유 총량과 수량의 안전한 정수 범위를 확인해 주세요.');
      if (registration.transfer && (nativeVersion(pallet) !== registration.transfer.expectedVersion || pallet.data()!.total !== registration.transfer.originalTotal))
        throw new HttpsError('failed-precondition', '파렛트 재고가 준비 이후 변경됐습니다. 현재 자료를 다시 확인해 주세요.');
    } catch (error) {
      if (error instanceof HttpsError) throw new HttpsError(error.code, error.message,
        { version: 1, operationStatus: 'rejected', writes: false, reference });
      throw error;
    }
    const applied = result(reference, actor.uid, 'applied', digest);
    tx.create(target, { companyId: reference.companyId, ...body });
    if (registration.transfer) tx.update(palletRef, { total: Math.max(0, registration.transfer.originalTotal + (body.type === 'in' ? body.quantity : -body.quantity)) });
    tx.create(operation, { ...applied, requestText: text, createdAt: new Date().toISOString() });
    return applied;
  });
}
export const palletTransactionCommand = onCall({ region: 'asia-northeast3' }, request =>
  executePalletTransactionForActor(admin.firestore(), request.auth, request.data));
