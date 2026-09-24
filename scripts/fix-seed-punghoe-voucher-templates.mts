/** 풍회 전표 기본 템플릿만 만든다. 기본 dry / --apply / --undo. 태백 거래처·금액·자동발행은 복사하지 않는다. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { adminDb, 실행모드 } from './_admin.mts';
import { CASH_TEMPLATES } from '../src/shared/cashTemplates';

const { APPLY, UNDO } = 실행모드();
if (APPLY && UNDO) throw new Error('--apply와 --undo를 동시에 쓸 수 없습니다.');
const db = adminDb();
const BACKUP = '로컬전용/백업/punghoe-basic-templates-2026-09-24.json';
type Seed = Record<string, unknown> & { id: string; companyId: 'punghoe'; builtin: string; name: string };
type Backup = { createdAt: string; seeds: Seed[] };

if (UNDO) {
  if (!existsSync(BACKUP)) throw new Error(`백업이 없습니다: ${BACKUP}`);
  const backup = JSON.parse(readFileSync(BACKUP, 'utf8')) as Backup;
  if (!backup.seeds.length || backup.seeds.some(t => t.companyId !== 'punghoe' || !t.id.startsWith('fct-punghoe-builtin-'))) {
    throw new Error('백업 대상이 풍회 기본 템플릿이 아닙니다.');
  }
  await db.runTransaction(async tx => {
    const snaps = await Promise.all(backup.seeds.map(t => tx.get(db.doc(`fixedCostTemplates/${t.id}`))));
    snaps.forEach((snap, i) => {
      if (!snap.exists || !isDeepStrictEqual(snap.data(), backup.seeds[i])) {
        throw new Error(`생성 뒤 수정된 템플릿은 삭제하지 않습니다: ${backup.seeds[i].id}`);
      }
    });
    backup.seeds.forEach(t => tx.delete(db.doc(`fixedCostTemplates/${t.id}`)));
  });
  for (const t of backup.seeds) if ((await db.doc(`fixedCostTemplates/${t.id}`).get()).exists) throw new Error(`되돌리기 재조회 실패: ${t.id}`);
  console.log(`풍회 기본 템플릿 ${backup.seeds.length}건 되돌림·재조회 완료`);
  process.exit(0);
}

const all = await db.collection('fixedCostTemplates').get();
const builtins = all.docs.filter(doc => doc.data().companyId === 'taebaek' && typeof doc.data().builtin === 'string');
if (builtins.length < 30) throw new Error(`태백 기본 템플릿이 예상보다 적습니다: ${builtins.length}건`);
const duplicates = new Set<string>();
const seeds: Seed[] = builtins.map(doc => {
  const source = doc.data();
  const builtin = String(source.builtin);
  const canonical = CASH_TEMPLATES.find(t => t.id === builtin);
  if (duplicates.has(builtin)) throw new Error(`태백 기본 템플릿 표식 중복: ${builtin}`);
  duplicates.add(builtin);
  // 템플릿의 뼈대만 공유한다. 태백 임대인·통장·금액·예약값을 풍회로 가져오면 잘못 발행된다.
  return {
    id: `fct-punghoe-builtin-${builtin}`, companyId: 'punghoe', builtin,
    kind: 'voucher', name: String(source.name),
    ...(source.accountCode ? { accountCode: String(source.accountCode) } : {}),
    dir: canonical?.dir ?? source.dir ?? '출금', mode: canonical?.mode ?? source.mode ?? '일반',
    ...(source.group ? { group: String(source.group) } : {}),
    ...(source.category ? { category: String(source.category) } : {}),
    ...(source.transferLines ? { transferLines: source.transferLines } : {}),
    amount: 0, active: false, autoIssue: false, hidden: false, favorite: false,
  };
});
const accountDocs = await db.collection('accountCodes').get();
const knownCodes = new Set(accountDocs.docs.map(doc => String(doc.data().code ?? '')));
const missingCodes = seeds.flatMap(t => [t.accountCode, ...((t.transferLines as { accountCode?: string }[] | undefined) ?? []).map(l => l.accountCode)])
  .filter((code): code is string => typeof code === 'string' && !!code && !knownCodes.has(code));
if (missingCodes.length) throw new Error(`계정과목이 없어 템플릿을 만들 수 없습니다: ${[...new Set(missingCodes)].join(', ')}`);
const targetRefs = seeds.map(t => db.doc(`fixedCostTemplates/${t.id}`));
const existing = await Promise.all(targetRefs.map(ref => ref.get()));
if (existing.some(snap => snap.exists)) throw new Error(`풍회 기본 템플릿 ID 충돌: ${existing.filter(snap => snap.exists).map(s => s.id).join(', ')}`);
console.log(`${APPLY ? '적용' : '미리보기(dry)'}: 풍회 기본 템플릿 ${seeds.length}건, 거래처·금액·자동발행 없음`);
for (const t of seeds) console.log(`  ${t.id}: ${t.name} / ${String(t.accountCode ?? '계정 없음')} / ${String(t.dir)}`);
if (!APPLY) { console.log('쓰기 없음. 적용하려면 --apply'); process.exit(0); }
if (existsSync(BACKUP)) throw new Error(`백업이 이미 있습니다. 중복 적용을 막습니다: ${BACKUP}`);
mkdirSync(dirname(BACKUP), { recursive: true });
writeFileSync(BACKUP, JSON.stringify({ createdAt: new Date().toISOString(), seeds } satisfies Backup, null, 2), { encoding: 'utf8', flag: 'wx' });
try {
  await db.runTransaction(async tx => {
    const snaps = await Promise.all(targetRefs.map(ref => tx.get(ref)));
    snaps.forEach((snap, i) => { if (snap.exists) throw new Error(`적용 중 ID 충돌: ${seeds[i].id}`); });
    seeds.forEach((t, i) => tx.create(targetRefs[i], t));
  });
} catch (error) {
  // 커밋 성공 뒤 응답만 끊길 수 있다. 백업을 보존해 재조회 후 사람이 판정한다.
  console.error(`트랜잭션 결과 불명확. 백업 보존: ${BACKUP}`);
  for (const ref of targetRefs) {
    try { console.error(`  ${ref.path}: ${(await ref.get()).exists ? '있음' : '없음'}`); }
    catch { console.error(`  ${ref.path}: 재조회 실패`); }
  }
  throw error;
}
for (const [i, ref] of targetRefs.entries()) {
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.companyId !== 'punghoe' || snap.data()?.builtin !== seeds[i].builtin) {
    throw new Error(`적용 뒤 재조회 실패: ${ref.path}`);
  }
}
console.log(`풍회 기본 템플릿 ${seeds.length}건 생성·재조회 완료. 백업: ${BACKUP}`);
