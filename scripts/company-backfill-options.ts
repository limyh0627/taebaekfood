export type CompanyBackfillPhase = 'initial' | 'remaining';

export type CompanyBackfillOptions = {
  mode: 'dry' | 'apply' | 'undo';
  phase: CompanyBackfillPhase;
  verbose: boolean;
};

/**
 * 1차 백업은 이미 운영 복구점이다. 2차 이관이 같은 파일을 덮거나 1차 undo 범위를
 * 섞지 못하도록 단계 선택과 실행 모드를 한곳에서 엄격히 판정한다.
 */
export function parseCompanyBackfillOptions(argv: string[]): CompanyBackfillOptions {
  const allowed = new Set(['--apply', '--undo', '--verbose']);
  const unknown = argv.filter(arg => !allowed.has(arg) && !arg.startsWith('--phase='));
  if (unknown.length) throw new Error(`알 수 없는 옵션: ${unknown.join(', ')}`);

  const applyCount = argv.filter(arg => arg === '--apply').length;
  const undoCount = argv.filter(arg => arg === '--undo').length;
  if (applyCount > 1 || undoCount > 1) throw new Error('실행 옵션을 중복해서 줄 수 없다.');
  if (applyCount && undoCount) throw new Error('--apply와 --undo를 동시에 실행할 수 없다.');

  const phaseArgs = argv.filter(arg => arg.startsWith('--phase='));
  if (phaseArgs.length !== 1) {
    throw new Error('단계를 정확히 하나 지정해야 한다: --phase=initial 또는 --phase=remaining');
  }
  const phase = phaseArgs[0].slice('--phase='.length);
  if (phase !== 'initial' && phase !== 'remaining') {
    throw new Error(`잘못된 단계: ${phase || '(빈 값)'} (initial 또는 remaining만 가능)`);
  }

  return {
    mode: applyCount ? 'apply' : undoCount ? 'undo' : 'dry',
    phase,
    verbose: argv.includes('--verbose'),
  };
}

export function companyBackfillBackupPath(phase: CompanyBackfillPhase): string {
  return phase === 'initial'
    ? '로컬전용/백업/company-backfill-backup.json'
    : '로컬전용/백업/company-backfill-remaining-backup.json';
}
