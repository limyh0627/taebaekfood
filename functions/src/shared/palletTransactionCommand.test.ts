import { describe, expect, it } from 'vitest';
import { normalizePalletTransactionRequest, normalizePalletTransactionReference, normalizePalletTransactionResult, normalizePalletTransactionOpenResult, serializePalletTransactionRequest, normalizePalletExchangeSource, normalizePalletExchangeOpenResult, normalizePalletStockEditFields, normalizePalletStockEditRequest, normalizePalletStockEditOpenResult, normalizePalletOperationReference } from './palletTransactionCommand';
const reference = { companyId: 'taebaek' as const, operationId: 'operation-한글', transactionId: 'ptrans-한글' };
const transaction = { partnerId: '거래처', palletId: '파렛트', type: 'out' as const, quantity: 2, date: '2026-10-21', note: '' };
describe('파렛트 공용 요청 정본', () => {
  it('정상 Unicode ID와 원문을 보존하고 입력 필드 순서와 무관하게 같은 원문을 만든다', () => {
    const a = { version: 1 as const, reference, transaction };
    const b = { transaction: { note: '', date: transaction.date, quantity: 2, type: 'out' as const, palletId: '파렛트', partnerId: '거래처' }, reference: { transactionId: reference.transactionId, operationId: reference.operationId, companyId: reference.companyId }, version: 1 as const };
    expect(serializePalletTransactionRequest(a)).toBe(serializePalletTransactionRequest(b));
    expect(normalizePalletTransactionReference(reference)).toEqual(reference);
    expect(() => normalizePalletTransactionReference({ ...reference, transactionId: 'a/b' })).toThrow();
  });
  it('일반·교체·이동의 조합을 분리하며 교체 회수0은 보존한다', () => {
    expect(normalizePalletTransactionRequest({ version: 1, reference, transaction: { ...transaction, status: '교체중', exchangeReturnQty: 0 } }).transaction.exchangeReturnQty).toBe(0);
    for (const body of [{ ...transaction, status: '교체중', exchangeReturnQty: -1 }, { ...transaction, exchangeReturnQty: 1 }, { ...transaction, status: '교체중', isTransfer: true }, { ...transaction, quantity: 1.5 }, { ...transaction, date: '2026-02-31' }])
      expect(() => normalizePalletTransactionRequest({ version: 1, reference, transaction: body })).toThrow();
    expect(() => normalizePalletTransactionRequest({ version: 1, reference, transaction: { ...transaction, isTransfer: true } })).toThrow();
    expect(normalizePalletTransactionRequest({ version: 1, reference, transaction: { ...transaction, isTransfer: true }, transfer: { originalTotal: 1, expectedVersion: '1:000000001' } }).transfer?.originalTotal).toBe(1);
  });
  it('응답은 회사·UID·작업·대상·해시와 준비한 재고 원문에 묶는다', () => {
    const applied = { version: 1, reference, actorUid: 'u', status: 'applied', requestHash: 'a'.repeat(64), message: '완료' };
    expect(normalizePalletTransactionResult(applied, reference, 'u').status).toBe('applied');
    for (const value of [{ ...applied, actorUid: 'other' }, { ...applied, requestHash: null }, { ...applied, status: 'unknown' }, { ...applied, reference: { ...reference, transactionId: 'other' } }]) expect(() => normalizePalletTransactionResult(value, reference, 'u')).toThrow();
    expect(normalizePalletTransactionOpenResult({ reference, actorUid: 'u', palletId: '파렛트', originalTotal: 1, expectedVersion: '1:000000001' }, reference, 'u', '파렛트', 1).originalTotal).toBe(1);
    expect(() => normalizePalletTransactionOpenResult({ reference, actorUid: 'u', palletId: '파렛트', originalTotal: 2, expectedVersion: '1:000000001' }, reference, 'u', '파렛트', 1)).toThrow();
  });
  it('안전 정수 최대값은 허용하고 범위 밖 수량·회수·원재고는 거절한다', () => {
    expect(normalizePalletTransactionRequest({ version: 1, reference, transaction: { ...transaction, quantity: Number.MAX_SAFE_INTEGER } }).transaction.quantity).toBe(Number.MAX_SAFE_INTEGER);
    for (const quantity of [Number.MAX_SAFE_INTEGER + 1, Infinity]) expect(() => normalizePalletTransactionRequest({ version: 1, reference, transaction: { ...transaction, quantity } })).toThrow();
    expect(() => normalizePalletTransactionRequest({ version: 1, reference, transaction: { ...transaction, status: '교체중', exchangeReturnQty: Number.MAX_SAFE_INTEGER + 1 } })).toThrow();
    for (const originalTotal of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) expect(() => normalizePalletTransactionRequest({ version: 1, reference, transaction: { ...transaction, isTransfer: true }, transfer: { originalTotal, expectedVersion: '1:000000001' } })).toThrow();
  });
});
it('v1 정규화·직렬화 골든 원문은 v2 확장 뒤에도 바이트가 같다', () => {
  const request = { version: 1 as const, reference, transaction };
  expect(serializePalletTransactionRequest(request)).toBe('{"version":1,"reference":{"companyId":"taebaek","operationId":"operation-한글","transactionId":"ptrans-한글"},"transaction":{"partnerId":"거래처","palletId":"파렛트","type":"out","quantity":2,"date":"2026-10-21","note":""}}');
});
it('교체완료 v2는 원source 공개 존재값과 고정 회수ID를 보존한다', () => {
  const source = normalizePalletExchangeSource({ id: '원거래', companyId: 'taebaek', ...transaction, status: '교체중', exchangeReturnQty: 0, hidden: { legacy: true } });
  expect(source).toEqual({ ...transaction, status: '교체중', exchangeReturnQty: 0 });
  const request = { version: 2 as const, action: 'complete-exchange' as const, reference, sourceTransactionId: '원거래', source, expectedVersion: '1:000000001', returnDate: '2026-10-22' };
  expect(normalizePalletTransactionRequest(request)).toEqual(request);
  expect(normalizePalletExchangeOpenResult({ reference, sourceTransactionId: '원거래', source, actorUid: 'u', expectedVersion: '1:000000001' }).source.exchangeReturnQty).toBe(0);
  for (const changed of [{ ...request, sourceTransactionId: reference.transactionId }, { ...request, source: { ...source, status: '교체완료' } }, { ...request, source: { ...source, isTransfer: true } }, { ...request, returnDate: '2026-02-31' }]) expect(() => normalizePalletTransactionRequest(changed)).toThrow();
  expect(() => normalizePalletTransactionRequest({ ...request, source: { ...source, hidden: true } })).toThrow();
});
const editReference = { kind: 'pallet-edit' as const, companyId: 'taebaek' as const, operationId: 'edit-op', palletId: '파렛트' };
const edit = { version: 3 as const, action: 'edit-pallet' as const, reference: editReference, original: { name: ' 파렛트 ', total: 10, damaged: 2 }, expectedVersion: '1:000000001', patch: { name: '' } };
it('v2 직렬화 골든과 기존3필드 ref는 편집 확장 뒤에도 그대로다', () => {
  expect(serializePalletTransactionRequest({ version: 2, action: 'complete-exchange', reference, sourceTransactionId: '원거래', source: { ...transaction, status: '교체중' }, expectedVersion: '1:000000001', returnDate: '2026-10-22' })).toBe('{"version":2,"action":"complete-exchange","reference":{"companyId":"taebaek","operationId":"operation-한글","transactionId":"ptrans-한글"},"sourceTransactionId":"원거래","source":{"partnerId":"거래처","palletId":"파렛트","type":"out","quantity":2,"date":"2026-10-21","note":"","status":"교체중"},"expectedVersion":"1:000000001","returnDate":"2026-10-22"}');
  expect(normalizePalletOperationReference(reference)).toEqual(reference);
  expect(normalizePalletOperationReference(editReference)).toEqual(editReference);
  expect(() => normalizePalletTransactionReference(editReference)).toThrow();
  expect(() => normalizePalletOperationReference({ ...editReference, kind: 'other' })).toThrow();
});
it('편집은 세 원문과 dirty만 정규화하고 빈 이름·개별 안전 수량을 그대로 보존한다', () => {
  expect(normalizePalletStockEditFields({ ...edit.original, hidden: true, inUse: 99 })).toEqual(edit.original);
  expect(normalizePalletStockEditRequest(edit)).toEqual(edit);
  expect(normalizePalletStockEditRequest({ ...edit, patch: { total: 0, damaged: Number.MAX_SAFE_INTEGER } }).patch).toEqual({ total: 0, damaged: Number.MAX_SAFE_INTEGER });
  expect(normalizePalletStockEditOpenResult({ reference: editReference, original: edit.original, actorUid: 'u', expectedVersion: edit.expectedVersion }).original.name).toBe(' 파렛트 ');
});
it('빈 dirty·원값 동일·미소유 필드·범위 밖 수량은 저장 원문으로 받지 않는다', () => {
  for (const patch of [{}, { name: edit.original.name }, { hidden: true }, { total: -1 }, { damaged: 1.5 }, { total: Number.MAX_SAFE_INTEGER + 1 }]) expect(() => normalizePalletStockEditRequest({ ...edit, patch })).toThrow();
  expect(() => normalizePalletStockEditRequest({ ...edit, original: { ...edit.original, inUse: 99 } })).toThrow();
});
it('편집 결과는 kind·palletID·actor와 결합하고 등록 ref로 위장하지 못한다', () => {
  const result = { version: 1, reference: editReference, actorUid: 'u', status: 'applied', requestHash: 'a'.repeat(64), message: '편집 완료' };
  expect(normalizePalletTransactionResult(result, editReference, 'u').reference).toEqual(editReference);
  for (const ref of [reference, { ...editReference, palletId: '다른파렛트' }]) expect(() => normalizePalletTransactionResult(result, ref, 'u')).toThrow();
  expect(() => normalizePalletTransactionResult(result, editReference, 'other')).toThrow();
});
