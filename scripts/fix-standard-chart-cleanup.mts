// 1차 표준계정 이전에서 문서 안 id가 실제 Firestore 문서 ID를 가려 옛 계정 마스터가 남은 것을 정리한다.
// 기본은 미리보기, --apply 적용, --undo 복원.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { adminDb } from './_admin.mts';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = '로컬전용/백업/fix-standard-chart-cleanup-backup.json';
const OLD = new Set([
  '101', '131', '202', '203', '206', '208', '212', '232', '254', '259', '262', '263',
  '800', '805', '510', '515', '520', '525', '530', '535', '590', '595', '605', '930', '951', '980',
]);
const TARGET = new Set([
  '102', '133', '128', '129', '126', '124', '122', '169', '257', '254', '275',
  '404', '401', '819', '802', '815', '811', '806', '821', '828', '824', '905', '931', '935', '830',
]);

const db = adminDb();
if (UNDO) {
  if (!existsSync(BACKUP)) throw new Error(`백업이 없다: ${BACKUP}`);
  const rows = JSON.parse(readFileSync(BACKUP, 'utf8')) as { docId: string; data: Record<string, unknown> }[];
  for (const row of rows) await db.collection('accountCodes').doc(row.docId).set(row.data);
  console.log(`✅ 예전 계정 문서 ${rows.length}건 복원`);
  process.exit(0);
}

const snap = await db.collection('accountCodes').get();
const rows = snap.docs.map(d => ({ docId: d.id, data: d.data() }));
const taebaek = rows.filter(r => !r.data.companyId || r.data.companyId === 'taebaek');
const stale = taebaek.filter(r => OLD.has(String(r.data.code)) && String(r.data.code) !== '254');
// 254는 예전 예수금이 아니라 이전 후 선수금으로 다시 쓰는 번호라 이름으로 구분한다.
const stale254 = taebaek.filter(r => String(r.data.code) === '254' && String(r.data.name) !== '선수금');
const deletions = [...stale, ...stale254];
const missingTargets = [...TARGET].filter(code => !taebaek.some(r => String(r.data.code) === code));

const collections = ['issuedStatements', 'cashEntries', 'fixedCostTemplates', 'partner_item', 'openingBalances'];
const oldRefs: string[] = [];
for (const col of collections) {
  const docs = await db.collection(col).get();
  for (const d of docs.docs) {
    const data = d.data() as any;
    if (data.companyId && data.companyId !== 'taebaek') continue;
    const refs = [data.accountCode, data.loanCode, data.Account_Code,
      ...(data.items ?? []).map((x: any) => x.accountCode),
      ...(data.lines ?? []).map((x: any) => x.accountCode),
      ...(data.transferLines ?? []).map((x: any) => x.accountCode),
      ...Object.keys(data.amounts ?? {}),
    ].map(String);
    // 254는 새 선수금이므로 참조만 보고 예전 예수금이라고 판정하지 않는다.
    if (refs.some(code => OLD.has(code) && code !== '254')) oldRefs.push(`${col}/${d.id}`);
  }
}

console.log(`지울 옛 계정 문서 ${deletions.length}건`);
for (const row of deletions) console.log(`  ${row.docId}  ${row.data.code} ${row.data.name}`);
console.log(`누락된 새 계정: ${missingTargets.length ? missingTargets.join(', ') : '없음'}`);
console.log(`254 제외 옛 번호 참조: ${oldRefs.length ? oldRefs.join(', ') : '없음'}`);
if (missingTargets.length || oldRefs.length) throw new Error('새 계정 누락 또는 옛 참조가 있어 정리를 멈춘다.');
if (!APPLY) { console.log('\n(--dry) 적용하려면 --apply'); process.exit(0); }
if (existsSync(BACKUP)) throw new Error(`백업이 이미 있다: ${BACKUP}`);
writeFileSync(BACKUP, JSON.stringify(deletions, null, 2), 'utf8');
for (const row of deletions) await db.collection('accountCodes').doc(row.docId).delete();
console.log(`✅ 옛 계정 문서 ${deletions.length}건 정리 완료`);
