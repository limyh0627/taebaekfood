import type { CompanyId } from './types';

/**
 * 회사마다 따로 가져야 하는 설정 문서의 열쇠.
 *
 * 회사정보는 이미 `settings/{companyId}`를 쓰고, 나머지 설정은 예전에
 * `settings/deliveryOrdering`처럼 한 문서를 두 회사가 함께 덮어썼다. 문서 ID를 만드는
 * 규칙을 여기 하나로 모아 새 설정이 생겨도 같은 사고가 반복되지 않게 한다.
 */
export type CompanySettingKind = 'company' | 'deliveryOrdering' | 'orgChart' | 'workGroups';

export const companySettingDocId = (companyId: CompanyId, kind: CompanySettingKind): string =>
  kind === 'company' ? companyId : `${companyId}__${kind}`;

/** 규칙과 이관 스크립트가 검사할 수 있도록 설정 문서에도 회사를 명시한다. */
export const companySettingPatch = <T extends Record<string, unknown>>(companyId: CompanyId, value: T) =>
  ({ ...value, companyId });

/** Firestore 객체의 키 순서와 무관하게 설정 내용 전체를 비교하기 위한 안정 문자열. */
export const companySettingStateKey = (value: unknown): string => {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical);
    if (input && typeof input === 'object') {
      const timestamp = input as { toMillis?: () => number };
      if (typeof timestamp.toMillis === 'function') return { $timestampMillis: timestamp.toMillis() };
      return Object.fromEntries(Object.entries(input as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]));
    }
    return input;
  };
  return JSON.stringify(canonical(value));
};
