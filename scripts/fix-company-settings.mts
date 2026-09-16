// 회사 공용 settings 문서를 회사별 문서로 두 단계 이관한다.
// prepare는 회사별 8문서만 만들고 레거시 4문서는 남긴다. 새 앱 배포·확인 뒤
// cleanup이 새 문서 내용을 다시 검증하고 레거시를 지운다.
import { adminDb } from './_admin.mts';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { companySettingStateKey } from '../src/shared/companySettings.ts';
import { parseCompanySettingsMigrationArgs } from './companySettingsMigration.ts';

let options: ReturnType<typeof parseCompanySettingsMigrationArgs>;
try { options = parseCompanySettingsMigrationArgs(process.argv.slice(2)); }
catch (error) { console.error(error instanceof Error ? error.message : error); process.exit(1); }
const { phase, apply: APPLY, undo: UNDO } = options;
const db = adminDb();
const BACKUP = `로컬전용/백업/company-settings-${phase}-backup.json`;
type SavedDoc = { exists: boolean; data?: Record<string, unknown> };
type Backup = { phase: 'prepare' | 'cleanup'; before: Record<string, SavedDoc>; after: Record<string, SavedDoc>; afterFingerprints: Record<string, string>; changedPaths: string[] };
const fingerprint = (value: SavedDoc): string => createHash('sha256').update(companySettingStateKey(value)).digest('hex');
const read = async (path: string): Promise<SavedDoc> => {
  const snap = await db.doc(path).get();
  return snap.exists ? { exists: true, data: snap.data() as Record<string, unknown> } : { exists: false };
};

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error(`백업이 없다: ${BACKUP}`); process.exit(1); }
  const backup = JSON.parse(readFileSync(BACKUP, 'utf8')) as Backup;
  if (backup.phase !== phase) { console.error(`백업 단계가 다르다: ${backup.phase}`); process.exit(1); }
  const changed: string[] = [];
  for (const path of backup.changedPaths) if (fingerprint(await read(path)) !== backup.afterFingerprints[path]) changed.push(path);
  if (changed.length) {
    console.error('적용 뒤 수정된 설정이 있어 되돌리기를 중단한다:');
    for (const path of changed) console.error(`  ${path}`);
    process.exit(1);
  }
  const batch = db.batch();
  for (const path of backup.changedPaths) {
    const old = backup.before[path];
    if (old.exists) batch.set(db.doc(path), old.data ?? {}); else batch.delete(db.doc(path));
  }
  await batch.commit();
  for (const path of backup.changedPaths) if (fingerprint(await read(path)) !== fingerprint(backup.before[path])) throw new Error(`undo 확인 실패: ${path}`);
  console.log(`${phase} 단계 ${backup.changedPaths.length}개 문서를 되돌리고 내용까지 확인했다.`);
  process.exit(0);
}

const kinds = ['company', 'deliveryOrdering', 'orgChart', 'workGroups'] as const;
type Kind = typeof kinds[number];
const legacyPath = (kind: Kind) => `settings/${kind}`;
const targetPath = (companyId: 'taebaek' | 'punghoe', kind: Kind) => `settings/${kind === 'company' ? companyId : `${companyId}__${kind}`}`;
const allPaths = [...kinds.map(legacyPath), ...kinds.flatMap(kind => [targetPath('taebaek', kind), targetPath('punghoe', kind)])];
const before = Object.fromEntries(await Promise.all(allPaths.map(async path => [path, await read(path)])));
const missingLegacy = kinds.map(legacyPath).filter(path => !before[path].exists);
if (missingLegacy.length) {
  console.error('기준이 되는 레거시 설정이 없어 중단한다:');
  for (const path of missingLegacy) console.error(`  ${path}`);
  process.exit(1);
}

const empty = {
  deliveryOrdering: { ordering: [], timeSlots: {}, orderingByDate: {}, byDate: {} },
  orgChart: { top: { title: '', name: '' }, departments: [] },
  workGroups: { names: [] },
};
const desired = new Map<string, Record<string, unknown>>();
for (const kind of kinds) desired.set(targetPath('taebaek', kind), { ...before[legacyPath(kind)].data, companyId: 'taebaek' });
desired.set(targetPath('punghoe', 'company'), {
  name: '풍회유통', ceoName: '임기주', bizNo: '301-81-69333', bizType: '', bizItem: '',
  address: '충북 청주시 흥덕구 옥산면 덕촌리 225-1', phone: '', fax: '', email: 'punghoi@naver.com', companyId: 'punghoe',
});
for (const kind of ['deliveryOrdering', 'orgChart', 'workGroups'] as const) desired.set(targetPath('punghoe', kind), { ...empty[kind], companyId: 'punghoe' });

const conflicts: string[] = [];
for (const [path, data] of desired) if (before[path].exists && fingerprint(before[path]) !== fingerprint({ exists: true, data })) conflicts.push(path);
if (conflicts.length) {
  console.error('기존 회사별 설정이 예상 내용과 달라 중단한다:');
  for (const path of conflicts) console.error(`  ${path}`);
  process.exit(1);
}

const writes = new Map<string, Record<string, unknown>>();
const deletes = new Set<string>();
if (phase === 'prepare') {
  for (const [path, data] of desired) if (!before[path].exists) writes.set(path, data);
} else {
  const missingTargets = [...desired.keys()].filter(path => !before[path].exists);
  if (missingTargets.length) {
    console.error('prepare 단계의 회사별 설정이 없어 cleanup을 중단한다:');
    for (const path of missingTargets) console.error(`  ${path}`);
    process.exit(1);
  }
  for (const kind of kinds) deletes.add(legacyPath(kind));
}
const changedPaths = [...writes.keys(), ...deletes];
const after = Object.fromEntries(changedPaths.map(path => [path, writes.has(path) ? { exists: true, data: writes.get(path)! } : { exists: false }])) as Record<string, SavedDoc>;
const afterFingerprints = Object.fromEntries(changedPaths.map(path => [path, fingerprint(after[path])]));

console.log(`\n${APPLY ? '실제 적용' : '미리보기(dry)'} — settings ${phase}`);
for (const [path] of writes) console.log(`  생성 ${path}`);
for (const path of deletes) console.log(`  삭제 ${path}`);
if (!changedPaths.length) console.log('  바꿀 문서 없음');
if (!APPLY) { console.log('\n쓰기 없음. 실제 반영은 같은 phase에 --apply를 붙인다.'); process.exit(0); }
if (existsSync(BACKUP)) { console.error(`이미 이 단계 백업이 있다: ${BACKUP}`); process.exit(1); }

mkdirSync(dirname(BACKUP), { recursive: true });
writeFileSync(BACKUP, JSON.stringify({ phase, before, after, afterFingerprints, changedPaths } satisfies Backup, null, 2), 'utf8');
const batch = db.batch();
for (const [path, data] of writes) batch.set(db.doc(path), data);
for (const path of deletes) batch.delete(db.doc(path));
await batch.commit();
for (const path of changedPaths) if (fingerprint(await read(path)) !== afterFingerprints[path]) throw new Error(`적용 내용 확인 실패: ${path}`);
console.log(`\n${phase} 단계 ${changedPaths.length}개 문서 적용·내용 확인 완료.`);
