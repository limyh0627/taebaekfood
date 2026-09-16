// 수입들기름 매입 말통값 172,000원을 16.5kg로 나눈 원/kg 단가로 고치고 파생 원가를 다시 굴린다.
// 기본 dry / 실제 적용 --apply / 되돌리기 --undo
import admin from 'firebase-admin';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildFormula, formulaRowsOf } from '../src/features/admin/bom';
import { buildCostFn } from '../src/shared/bomCost';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const COMPANY = 'taebaek';
const NEW_COST = Math.round((172_000 / 16.5) * 100) / 100;
const BACKUP = '로컬전용/백업/suip-cost-172000-v2.json';

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS가 없습니다.');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.applicationDefault() });
const db = admin.firestore();

type Saved = { before: Record<string, unknown>; after: Record<string, unknown> };
type Backup = { savedAt: string; rows: Record<string, Saved> };

if (UNDO) {
  if (!existsSync(BACKUP)) throw new Error(`백업이 없습니다: ${BACKUP}`);
  const backup = JSON.parse(readFileSync(BACKUP, 'utf8')) as Backup;
  const batch = db.batch();
  for (const [id, saved] of Object.entries(backup.rows)) batch.set(db.collection('items').doc(id), saved.before);
  await batch.commit();
  console.log(`${Object.keys(backup.rows).length}건을 적용 전 값으로 복구했습니다.`);
  process.exit(0);
}

const load = async (name: string) => (await db.collection(name).where('companyId', '==', COMPANY).get())
  .docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
const [items, boms, formulas] = await Promise.all([load('items'), load('item_bom'), load('item_formula')]);
const live = items.filter(item => !item.archived);
const source = live.filter(item => item.name === '수입들기름');
if (source.length !== 1) throw new Error(`태백 수입들기름 활성 품목이 ${source.length}개입니다.`);

const patched = live.map(item => item.id === source[0].id ? { ...item, cost: NEW_COST } : item);
const oldCost = buildCostFn({
  allItems: live,
  itemBoms: boms,
  formulaOf: key => buildFormula(key, formulas, live),
  formulaRowsOf: key => formulaRowsOf(key, formulas),
});
const cost = buildCostFn({
  allItems: patched,
  itemBoms: boms,
  formulaOf: key => buildFormula(key, formulas, patched),
  formulaRowsOf: key => formulaRowsOf(key, formulas),
});
const rows: Record<string, Saved> = {};
for (const item of patched) {
  const before = live.find(row => row.id === item.id)!;
  const next = item.id === source[0].id ? NEW_COST : cost(item);
  const previousCalculated = item.id === source[0].id ? Number(before.cost ?? 0) : oldCost(before);
  // 이번 원료 단가 변경으로 계산값이 달라진 의존 품목만 고친다. 기존 원가 불일치는 별도 진단 대상이다.
  if (!(next > 0) || Math.abs(next - previousCalculated) <= 0.005) continue;
  rows[item.id] = { before, after: { ...before, cost: Math.round(next * 100) / 100 } };
}

console.log(`수입들기름 ${Number(source[0].cost ?? 0).toLocaleString()} → ${NEW_COST.toLocaleString()}원/kg (172,000 ÷ 16.5)`);
console.log(`직접 1건 + 파생 롤업 ${Math.max(0, Object.keys(rows).length - 1)}건 = 총 ${Object.keys(rows).length}건`);
for (const [id, saved] of Object.entries(rows).slice(0, 15)) {
  console.log(`- ${String(saved.before.name)} [${id}] ${Number(saved.before.cost ?? 0).toLocaleString()} → ${Number(saved.after.cost).toLocaleString()}`);
}
if (Object.keys(rows).length > 15) console.log(`- 외 ${Object.keys(rows).length - 15}건`);
console.log(APPLY ? '실제 적용' : '미리보기(dry) — 쓰기 없음');
if (!APPLY) process.exit(0);
if (existsSync(BACKUP)) throw new Error(`기존 백업이 있습니다: ${BACKUP}`);

mkdirSync(dirname(BACKUP), { recursive: true });
writeFileSync(BACKUP, JSON.stringify({ savedAt: new Date().toISOString(), rows } satisfies Backup, null, 2), 'utf8');
for (const chunkStart of Array.from({ length: Math.ceil(Object.keys(rows).length / 400) }, (_, i) => i * 400)) {
  const batch = db.batch();
  for (const [id, saved] of Object.entries(rows).slice(chunkStart, chunkStart + 400)) {
    batch.update(db.collection('items').doc(id), { cost: saved.after.cost });
  }
  await batch.commit();
}
for (const [id, saved] of Object.entries(rows)) {
  const current = (await db.collection('items').doc(id).get()).data();
  if (Number(current?.cost) !== Number(saved.after.cost)) throw new Error(`${id}: 적용 뒤 재조회 검증 실패`);
}
console.log(`${Object.keys(rows).length}건 적용·재조회 검증 완료`);
