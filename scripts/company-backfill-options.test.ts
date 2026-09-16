import { describe, expect, it } from 'vitest';
import { companyBackfillBackupPath, parseCompanyBackfillOptions } from './company-backfill-options';

describe('회사값 이관 실행 옵션', () => {
  it('단계만 지정하면 쓰지 않는 미리보기다', () => {
    expect(parseCompanyBackfillOptions(['--phase=remaining'])).toEqual({
      mode: 'dry', phase: 'remaining', verbose: false,
    });
  });

  it('1차와 2차 백업을 서로 다른 파일에 둔다', () => {
    expect(companyBackfillBackupPath('initial')).toContain('company-backfill-backup.json');
    expect(companyBackfillBackupPath('remaining')).toContain('company-backfill-remaining-backup.json');
    expect(companyBackfillBackupPath('initial')).not.toBe(companyBackfillBackupPath('remaining'));
  });

  it.each([
    [],
    ['--phase=initial', '--phase=remaining'],
    ['--phase=third'],
    ['--phase=remaining', '--apply', '--undo'],
    ['--phase=remaining', '--apply', '--apply'],
    ['--phase=remaining', '--unknown'],
  ])('위험하거나 모호한 옵션을 거부한다: %j', argv => {
    expect(() => parseCompanyBackfillOptions(argv)).toThrow();
  });
});
