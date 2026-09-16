/** 해피유통(네이버커머스) 300ml 낱개 연결에 박스의 개당 단가·과세를 복원한다. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { adminDb, 실행모드 } from './_admin.mts';

const { APPLY, UNDO } = 실행모드();
const db = adminDb();
const BACKUP = '로컬전용/백업/happy-naver-loose-prices.json';
const TARGETS = [
  { loose: 'p-1777536360094_c-1784010198853_out', box: 'box-p-1777536360094-20_c-1784010198853_out', units: 20 },
  { loose: 'p-281_c-1784010198853_out', box: 'box-p-281-20_c-1784010198853_out', units: 20 },
] as const;

type Saved = { before: Record<string, unknown>; after: Record<string, unknown> };
if (UNDO) {
  if (!existsSync(BACKUP)) throw new Error(`백업이 없습니다: ${BACKUP}`);
  const backup = JSON.parse(readFileSync(BACKUP, 'utf8')) as { rows: Record<string, Saved> };
  for (const [id, saved] of Object.entries(backup.rows)) {
    const current = (await db.collection('partner_item').doc(id).get()).data() ?? {};
    if (JSON.stringify(current) !== JSON.stringify(saved.after)) throw new Error(`${id}: 적용 뒤 수정돼 복구를 중단합니다.`);
  }
  const batch = db.batch();
  for (const [id, saved] of Object.entries(backup.rows)) batch.set(db.collection('partner_item').doc(id), saved.before);
  await batch.commit();
  console.log(`${Object.keys(backup.rows).length}개 낱개 단가를 복구했습니다.`);
  process.exit(0);
}

const rows: Record<string, Saved> = {};
for (const target of TARGETS) {
  const [looseSnap, boxSnap] = await Promise.all([
    db.collection('partner_item').doc(target.loose).get(), db.collection('partner_item').doc(target.box).get(),
  ]);
  if (!looseSnap.exists || !boxSnap.exists) throw new Error(`${target.loose}: 낱개 또는 박스 연결이 없습니다.`);
  const before = looseSnap.data()!;
  const box = boxSnap.data()!;
  if (before.partnerId !== 'c-1784010198853' || before.itemId !== target.loose.split('_')[0]) throw new Error(`${target.loose}: 낱개 연결 대상이 다릅니다.`);
  if (box.partnerId !== before.partnerId || Number(box.price) <= 0 || box.taxType !== '과세') throw new Error(`${target.box}: 박스 근거가 예상과 다릅니다.`);
  const price = Math.round(Number(box.price) / target.units);
  const after = { ...before, price, taxType: box.taxType };
  rows[target.loose] = { before, after };
  console.log(`${target.loose}: ${before.price ?? '(없음)'}원/${before.taxType ?? '(없음)'} → ${price}원/${box.taxType}`);
}
console.log(APPLY ? '실제 적용' : '미리보기(dry) — 쓰기 없음');
if (!APPLY) process.exit(0);
if (existsSync(BACKUP)) throw new Error(`기존 백업이 있습니다: ${BACKUP}`);
mkdirSync(dirname(BACKUP), { recursive: true });
writeFileSync(BACKUP, JSON.stringify({ savedAt: new Date().toISOString(), rows }, null, 2), 'utf8');
const batch = db.batch();
for (const [id, saved] of Object.entries(rows)) batch.set(db.collection('partner_item').doc(id), saved.after);
await batch.commit();
for (const [id, saved] of Object.entries(rows)) {
  const current = (await db.collection('partner_item').doc(id).get()).data() ?? {};
  if (JSON.stringify(current) !== JSON.stringify(saved.after)) throw new Error(`${id}: 적용 뒤 재조회 검증 실패`);
}
console.log('2개 낱개 연결 적용·재조회 검증 완료');
