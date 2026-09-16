import { describe, expect, it } from 'vitest';
import { hasExpectedFields, requireStorageCompany } from './storage-company-paths-safety.mts';

describe('Storage 회사 경로 이관 안전장치', () => {
  it('명시된 두 회사만 받는다', () => {
    expect(requireStorageCompany('taebaek', 'docs/a')).toBe('taebaek');
    expect(requireStorageCompany('punghoe', 'rooms/a')).toBe('punghoe');
    expect(() => requireStorageCompany(undefined, 'docs/b')).toThrow('회사값 이관을 먼저');
    expect(() => requireStorageCompany('other', 'rooms/b')).toThrow('companyId');
  });

  it('우리가 적용한 필드가 달라졌으면 undo를 거절한다', () => {
    const expected = { storagePath: 'companies/taebaek/a', images: ['new-1', 'new-2'] };
    expect(hasExpectedFields({ ...expected, note: '사용자 메모' }, expected)).toBe(true);
    expect(hasExpectedFields({ ...expected, storagePath: 'later-change' }, expected)).toBe(false);
    expect(hasExpectedFields({ ...expected, images: ['new-1'] }, expected)).toBe(false);
  });
});
