export type StorageCompanyId = 'taebaek' | 'punghoe';

/** 이관은 회사값 채우기가 끝난 뒤에만 돈다. 빈 값을 태백으로 짐작하면 풍회 파일을 섞을 수 있다. */
export function requireStorageCompany(value: unknown, path: string): StorageCompanyId {
  if (value === 'taebaek' || value === 'punghoe') return value;
  throw new Error(`${path}: companyId가 없거나 잘못됐다. 회사값 이관을 먼저 끝내야 한다.`);
}

/** undo가 이후 사용자 수정을 덮지 않도록, 우리가 쓴 필드가 그대로인지 확인한다. */
export function hasExpectedFields(current: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  return Object.entries(expected).every(([key, value]) => JSON.stringify(current[key]) === JSON.stringify(value));
}

