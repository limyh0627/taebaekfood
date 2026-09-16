export type CompanySettingsMigrationPhase = 'prepare' | 'cleanup';

export interface CompanySettingsMigrationOptions {
  phase: CompanySettingsMigrationPhase;
  apply: boolean;
  undo: boolean;
}

/** 옵션 오타로 반대 단계나 실제 쓰기가 실행되지 않도록 허용한 인자만 받는다. */
export function parseCompanySettingsMigrationArgs(args: readonly string[]): CompanySettingsMigrationOptions {
  const allowed = new Set(['--apply', '--undo', '--phase=prepare', '--phase=cleanup']);
  const unknown = args.filter(arg => !allowed.has(arg));
  if (unknown.length) throw new Error(`알 수 없는 옵션: ${unknown.join(', ')}`);
  const phases = args.filter(arg => arg.startsWith('--phase='));
  if (phases.length !== 1) throw new Error('--phase=prepare 또는 --phase=cleanup 중 하나를 정확히 지정해야 한다.');
  const phase = phases[0].slice('--phase='.length);
  if (phase !== 'prepare' && phase !== 'cleanup') throw new Error(`잘못된 phase: ${phase}`);
  const apply = args.includes('--apply');
  const undo = args.includes('--undo');
  if (apply && undo) throw new Error('--apply와 --undo는 함께 쓸 수 없다.');
  return { phase, apply, undo };
}
