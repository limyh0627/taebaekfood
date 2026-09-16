import { describe, expect, it } from 'vitest';
import { parseCompanySettingsMigrationArgs } from './companySettingsMigration';

describe('회사 설정 이관 옵션', () => {
  it('phase는 필수이고 쓰기 표식이 없으면 dry다', () => {
    expect(parseCompanySettingsMigrationArgs(['--phase=prepare'])).toEqual({ phase: 'prepare', apply: false, undo: false });
    expect(parseCompanySettingsMigrationArgs(['--phase=cleanup', '--apply'])).toEqual({ phase: 'cleanup', apply: true, undo: false });
  });

  it.each([
    { args: [] },
    { args: ['--phase=wrong'] },
    { args: ['--phase=prepare', '--phase=cleanup'] },
    { args: ['--phase=prepare', '--apply', '--undo'] },
    { args: ['--phase=prepare', '--force'] },
  ])('빠졌거나 충돌하거나 알 수 없는 옵션을 거절한다: $args', ({ args }) => {
    expect(() => parseCompanySettingsMigrationArgs(args)).toThrow();
  });
});
