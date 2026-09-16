import { describe, expect, it } from 'vitest';
import { withClaimCompany } from './companyWriteBoundary';

describe('회사별 공통 쓰기 경계', () => {
  it('회사값이 없으면 로그인 claim의 회사를 붙인다', () => {
    expect(withClaimCompany('orders', { partnerName: '수카페' }, { companyId: 'taebaek' }))
      .toEqual({ partnerName: '수카페', companyId: 'taebaek' });
  });

  it('명시한 회사와 로그인 회사가 다르면 저장 전에 거부한다', () => {
    expect(() => withClaimCompany('orders', { companyId: 'punghoe' }, { companyId: 'taebaek' }))
      .toThrow('다른 회사');
  });

  it('유효한 회사 claim이 없으면 저장하지 않는다', () => {
    expect(() => withClaimCompany('orders', {}, {})).toThrow('다시 로그인');
  });
});
