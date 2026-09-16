import type { CollectionName } from './collections';

/**
 * 로그인·시도기록처럼 회사 업무자료가 아닌 문서는 회사값을 억지로 붙이지 않는다.
 * 현재 공통 CRUD는 CollectionName만 받으므로 실사용 예외는 없지만, 새 메타 컬렉션이
 * 공통 경계에 들어올 때 무심코 회사 문서로 취급하지 않도록 목록을 한곳에 못 박는다.
 */
export const COMPANY_WRITE_EXEMPT_COLLECTIONS = new Set<string>([
  'usernames',
  'authLoginAttempts',
  'appMeta',
]);

export type CompanyClaim = { companyId?: unknown };

export function withClaimCompany(
  collectionName: CollectionName,
  data: Record<string, unknown>,
  claim: CompanyClaim,
): Record<string, unknown> {
  if (COMPANY_WRITE_EXEMPT_COLLECTIONS.has(collectionName)) return data;

  const companyId = claim.companyId;
  if (companyId !== 'taebaek' && companyId !== 'punghoe') {
    throw new Error('로그인 회사 정보를 확인할 수 없어 저장하지 않았습니다. 다시 로그인해 주세요.');
  }

  if (data.companyId !== undefined && data.companyId !== companyId) {
    throw new Error('현재 로그인한 회사와 다른 회사의 자료는 저장할 수 없습니다.');
  }

  return { ...data, companyId };
}
