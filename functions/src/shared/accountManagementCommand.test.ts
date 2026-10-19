import { expect, it } from 'vitest';
import { accountManagementOpening, normalizeAccountManagementRequest, normalizeAccountManagementOpenRequest,
  normalizeAccountManagementOpenResult, normalizeAccountManagementResult, serializeAccountManagementRequest } from './accountManagementCommand';
const reference = { companyId: 'taebaek' as const, planId: 'p', kind: 'code' as const, targetId: '한글'.repeat(100) };
it('신규 표시 원문은 고정 ID와 생략을 보존하고 다른 업무 필드를 허용하지 않는다', () => {
  const request = normalizeAccountManagementRequest({ version: 1, reference, action: 'create', expectedVersion: null,
    data: { id: reference.targetId, name: '', code: '0' } });
  expect(JSON.parse(serializeAccountManagementRequest(request)).data).toEqual({ id: reference.targetId, name: '', code: '0' });
  expect(() => normalizeAccountManagementRequest({ ...request, data: { ...request.data, normalBalance: 'debit' } })).toThrow();
  expect(() => normalizeAccountManagementRequest({ ...request, data: { ...request.data, id: '다름' } })).toThrow();
});
it('원문 열기는 존재 보존 projection과 native버전·회사 UID 대상 결합을 검사한다', () => {
  const opening = accountManagementOpening({ name: '코드', code: '0', companyId: 'taebaek', legacy: 1 }, 'code');
  const input = normalizeAccountManagementOpenRequest({ mode: 'open', reference, opening });
  expect(input.opening).toEqual(opening);
  const result = { reference, actorUid: 'u', opening, expectedVersion: '1:000000001' };
  expect(normalizeAccountManagementOpenResult(result, reference, 'u')).toEqual(result);
  expect(() => normalizeAccountManagementOpenResult(result, reference, 'v')).toThrow();
  expect(() => normalizeAccountManagementOpenResult({ ...result, expectedVersion: '1:001' }, reference, 'u')).toThrow();
});
it('삭제 원문은 신규 data를 금지하고 결과는 nullhash·다른회사·해시혼동을 거절한다', () => {
  const request = { version: 1, reference, action: 'delete', expectedVersion: '1:000000001' };
  expect(normalizeAccountManagementRequest(request)).toEqual(request);
  expect(() => normalizeAccountManagementRequest({ ...request, data: {} })).toThrow();
  const result = { version: 1, reference, actorUid: 'u', status: 'cancelled', requestHash: null, message: '중단' };
  expect(normalizeAccountManagementResult(result, reference, 'u')).toEqual(result);
  expect(() => normalizeAccountManagementResult({ ...result, status: 'rejected' }, reference, 'u')).toThrow();
  expect(() => normalizeAccountManagementResult({ ...result, requestHash: 'a'.repeat(64) }, reference, 'u', 'b'.repeat(64))).toThrow();
});
