/**
 * 서류 품목 「시골향들기름2」에 물린 품목을 「시골향들기름3」으로 옮긴다 — **그날 이후 서류만**.
 *
 * 2026-10-08 사장님: "들기름 2번에 물려있는 것들 다 3번으로 교체". 결정:
 *   · 지난 서류는 2번 그대로("오늘 이후만 3번") — `품목이력`에 { 품목: 들기름2, until } 을 남긴다.
 *     until = **마지막으로 저장한 판매일지의 다음 날**. 이미 찍은 일지(들기름②)와 서류가 안 갈린다.
 *     읽는 곳은 docPumokAt 하나 — 이 코드가 **배포된 뒤에** 적용한다(옛 코드는 이력을 모른다).
 *   · 수입산들기름-캔(p-1773565128048)은 2번에 둔다 — 수입산 100%가 실제 내용물과 맞다.
 *   · 생들기름/350ml 3개도 3번으로.
 *   · 진들기름/1500ml(p-1786496156778)은 BOM에 기름이 없어 원료 차감·원가가 품목 배합으로 떨어진다.
 *     형제(진들기름 1800ml = wip-들기름 1.663)처럼 반제품 들기름 1.386kg(1.5L × 0.924)을 넣는다.
 *
 *   npx tsx scripts/fix-deulgireum2-to-3-20261008.mts          (미리보기)
 *   npx tsx scripts/fix-deulgireum2-to-3-20261008.mts --apply
 *   npx tsx scripts/fix-deulgireum2-to-3-20261008.mts --undo
 */
import { FieldValue } from 'firebase-admin/firestore';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { adminDb, 실행모드 } from './_admin.mts';

const COMPANY_ID = 'taebaek';
const FROM = '시골향들기름2';
const TO = '시골향들기름3';
const KEEP = new Set(['p-1773565128048']);   // 수입산들기름-캔 — 2번에 둔다
const EXPECTED = 32;
const BOM_PARENT = 'p-1786496156778';         // 진들기름/1500ml
const BOM_CHILD = 'wip-들기름';
const BOM_QTY = 1.386;
const BOM_ID = `bom-${BOM_PARENT}-${BOM_CHILD}`;
const BACKUP = '로컬전용/백업/deulgireum2-to-3-20261008.json';

type 이력 = { 품목: string; until: string }[];
type Row = { id: string; name: string; before: { 품목: string; 품목이력: 이력 | null }; after: { 품목: string; 품목이력: 이력 } };
type Backup = { savedAt: string; until: string; rows: Row[]; bom: { id: string; data: Record<string, unknown> } };

const { APPLY, UNDO } = 실행모드();
const db = adminDb();
const itemRef = (id: string) => db.collection('items').doc(id);
const bomRef = db.collection('item_bom').doc(BOM_ID);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// ── 되돌리기가 맨 앞이다 ──
if (UNDO) {
  if (!existsSync(BACKUP)) throw new Error(`백업이 없습니다: ${BACKUP}`);
  const b = JSON.parse(readFileSync(BACKUP, 'utf8')) as Backup;
  await db.runTransaction(async tx => {
    const curs = await Promise.all(b.rows.map(r => tx.get(itemRef(r.id))));
    const bom = await tx.get(bomRef);
    curs.forEach((snap, i) => {
      const r = b.rows[i], cur = snap.data();
      if (cur?.품목 !== r.after.품목 || !same(cur?.품목이력, r.after.품목이력)) throw new Error(`${r.name} [${r.id}]: 그 뒤에 바뀌어 되돌리지 않습니다.`);
    });
    if (!bom.exists || bom.data()?.quantity !== BOM_QTY) throw new Error(`${BOM_ID}: BOM 줄이 바뀌어 되돌리지 않습니다.`);
    b.rows.forEach(r => tx.update(itemRef(r.id), { 품목: r.before.품목, 품목이력: r.before.품목이력 ?? FieldValue.delete() }));
    tx.delete(bomRef);
  });
  console.log(`${b.rows.length}건 품목과 진들기름/1500ml BOM 줄을 적용 전으로 되돌렸습니다.`);
  process.exit(0);
}

// ── 대상 세기 ──
const items = (await db.collection('items').where('companyId', '==', COMPANY_ID).get()).docs.map(d => ({ id: d.id, ...d.data() } as any));
const tagged = items.filter(i => i.품목 === FROM);
const targets = tagged.filter(i => !KEEP.has(i.id));
console.log(`품목="${FROM}" ${tagged.length}건 — 2번에 둠 ${tagged.length - targets.length}건(${tagged.filter(i => KEEP.has(i.id)).map(i => i.name).join(', ')}), 옮길 것 ${targets.length}건`);

const 멈춤: string[] = [];
if (targets.length !== EXPECTED) 멈춤.push(`옮길 것이 ${EXPECTED}건이 아니라 ${targets.length}건이다`);
for (const i of targets) if ((i.품목이력 ?? []).some((h: any) => h.품목 === FROM)) 멈춤.push(`${i.name} [${i.id}]: 이미 들기름2 이력이 있다`);

//  until = 마지막 판매일지의 다음 날. 그날까지 찍은 일지는 들기름②로 적혀 있다.
const logs = (await db.collection('productionSalesLogs').where('companyId', '==', COMPANY_ID).get()).docs.map(d => d.data() as any);
const lastLog = logs.map(l => String(l.date ?? '')).filter(Boolean).sort().at(-1);
if (!lastLog) 멈춤.push('판매일지가 없다');
const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
const until = lastLog ? nextDay(lastLog) : '';
console.log(`마지막 판매일지 ${lastLog} → ${until} 서류부터 ${TO}, 그 전은 ${FROM}`);

//  진들기름/1500ml BOM
const parent = items.find(i => i.id === BOM_PARENT);
const child = items.find(i => i.id === BOM_CHILD);
const parentBoms = (await db.collection('item_bom').where('parent_id', '==', BOM_PARENT).get()).docs.map(d => d.data() as any);
if (!parent || parent.품목 !== FROM) 멈춤.push(`${BOM_PARENT}: 진들기름/1500ml이 아니거나 이미 바뀌었다`);
if (!child || child.type !== 'wip' || child.companyId !== COMPANY_ID) 멈춤.push(`${BOM_CHILD}: 반제품 들기름이 아니다`);
if (parentBoms.some(b => b.child_id === BOM_CHILD)) 멈춤.push(`${BOM_PARENT}: 이미 들기름 BOM 줄이 있다`);
if ((await bomRef.get()).exists) 멈춤.push(`${BOM_ID}: 문서가 이미 있다`);

const rows: Row[] = targets.map(i => ({
  id: i.id, name: i.name,
  before: { 품목: i.품목, 품목이력: i.품목이력 ?? null },
  after: { 품목: TO, 품목이력: [...(i.품목이력 ?? []), { 품목: FROM, until }] },
}));
const bomData = { id: BOM_ID, parent_id: BOM_PARENT, child_id: BOM_CHILD, quantity: BOM_QTY, companyId: COMPANY_ID };

console.log('\n| 품목 | 규격 | 품목 | 품목이력 |');
for (const r of rows) {
  const i = targets.find(t => t.id === r.id);
  console.log(`| ${r.name} [${r.id}] | ${i.spec || '(빈칸)'} | ${r.before.품목} → ${r.after.품목} | +{${FROM}, until ${until}} |`);
}
console.log(`\nBOM 추가: ${parent?.name} [${BOM_PARENT}] ← ${child?.name} [${BOM_CHILD}] × ${BOM_QTY}kg (문서 ${BOM_ID})`);
console.log(`  지금 BOM: ${parentBoms.map(b => `${items.find(i => i.id === b.child_id)?.name ?? b.child_id} ×${b.quantity}`).join(' | ')}`);

if (멈춤.length) { console.log(`\n⛔ ${멈춤.join('\n⛔ ')}\n아무것도 쓰지 않습니다.`); process.exit(1); }
if (!APPLY) { console.log('\n미리보기(dry) — 쓰기 없음. --apply 로 적용.'); process.exit(0); }

if (existsSync(BACKUP)) throw new Error(`기존 백업이 있습니다: ${BACKUP}`);
mkdirSync(dirname(BACKUP), { recursive: true });
writeFileSync(BACKUP, JSON.stringify({ savedAt: new Date().toISOString(), until, rows, bom: { id: BOM_ID, data: bomData } } satisfies Backup, null, 2), 'utf8');
console.log(`백업 저장: ${BACKUP}`);

//  한 트랜잭션 — 읽은 값이 그 사이 바뀌었으면 통째로 안 쓴다.
await db.runTransaction(async tx => {
  const curs = await Promise.all(rows.map(r => tx.get(itemRef(r.id))));
  curs.forEach((snap, i) => {
    const r = rows[i], cur = snap.data();
    if (cur?.품목 !== r.before.품목 || !same(cur?.품목이력, r.before.품목이력)) throw new Error(`${r.name} [${r.id}]: 그 사이 바뀌었습니다.`);
  });
  rows.forEach(r => tx.update(itemRef(r.id), { 품목: r.after.품목, 품목이력: r.after.품목이력 }));
  tx.create(bomRef, bomData);
});

// ── 썼다고 믿지 않는다 ──
for (const r of rows) {
  const cur = (await itemRef(r.id).get()).data();
  if (cur?.품목 !== TO || !same(cur?.품목이력, r.after.품목이력)) throw new Error(`${r.id}: 재조회 검증 실패`);
}
const bomNow = (await bomRef.get()).data();
if (bomNow?.quantity !== BOM_QTY || bomNow?.child_id !== BOM_CHILD) throw new Error(`${BOM_ID}: 재조회 검증 실패`);
console.log(`${rows.length}건 품목 교체 + BOM 1줄 추가, 재조회 확인 완료.`);
process.exit(0);
