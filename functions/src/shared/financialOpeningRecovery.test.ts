import { expect, it } from 'vitest';
import { normalizeFinancialOpeningRecoveryReference as reference, normalizeFinancialOpeningRecoveryResult as result, FINANCIAL_OPENING_KINDS } from './financialOpeningRecovery';
const ref = { companyId: 'taebaek' as const, operationId: 'opening-old:1', kind: 'loan-create' as const };
const applied = { version: 1, reference: ref, actorUid: 'uid', status: 'applied', requestHash: 'a'.repeat(64), result: 'created', message: '이 요청을 적용했습니다.' };
it('기존 다섯 업무와 과거 요청 번호를 참조 정본으로 검증한다', () => {
  for (const kind of FINANCIAL_OPENING_KINDS) expect(reference({ ...ref, kind }).kind).toBe(kind);
  for (const bad of [{ ...ref, operationId: 'a/b' }, { ...ref, companyId: 'other' }, { ...ref, kind: 'other' }, { ...ref, body: {} }]) expect(() => reference(bad)).toThrow();
});
it('완료는 정확한 회사·UID·요청·해시와 기존 결과만 반환한다', () => {
  expect(result(applied, ref, 'uid')).toEqual(applied);
  for (const bad of [{ ...applied, actorUid: 'foreign' }, { ...applied, requestHash: null }, { ...applied, result: 'unknown' }, { ...applied, reference: { ...ref, kind: 'loan-update' } }]) expect(() => result(bad, ref, 'uid')).toThrow();
});
it('부재와 중단은 적용 결과·해시를 발명하지 않는다', () => {
  for (const status of ['unknown', 'cancelled'] as const) {
    const value = { version: 1, reference: ref, actorUid: 'uid', status, requestHash: null, message: status };
    expect(result(value, ref, 'uid')).toEqual(value);
    expect(() => result({ ...value, result: 'created' }, ref, 'uid')).toThrow();
    expect(() => result({ ...value, requestHash: 'a'.repeat(64) }, ref, 'uid')).toThrow();
  }
});
