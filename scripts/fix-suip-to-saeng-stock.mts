// 수입들기름 마이너스를 생들기름에서 뺀다.
//   기본 = --dry (미리보기, 쓰기 없음).  실제 적용 = --apply.  되돌리기 = --undo
//
// 수입들기름 재고가 -512.848L로 내려가 있다. 실제로는 수입분이 모자라 **생들기름(자가 착유)을
// 대신 쓴 것**이라, 그 양만큼 생들기름에서 빼고 수입들기름은 0으로 맞춘다.
//   수입들기름  -512.848L → 0
//   생들기름    3,039.048L → 2,526.200L
//
// items.stock만 건드린다 — 원료수불부(rawDocEntries)·원장(rawMaterialLedger)은 손대지 않는다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-suip-to-saeng-stock-backup.json';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('백업 파일이 없다 — 되돌릴 수 없다.'); process.exit(1); }
  const prev: Record<string, number> = JSON.parse(readFileSync(BACKUP, 'utf8'));
  for (const [id, v] of Object.entries(prev)) await updateDoc(doc(db, 'items', id), { stock: v });
  console.log(`✅ ${Object.keys(prev).length}건 재고 되돌림`);
  process.exit(0);
}

const items = (await getDocs(collection(db, 'items'))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const 수입 = items.find((i: any) => i.name === '수입들기름' && !i.archived);
const 생 = items.find((i: any) => i.name === '생들기름' && !i.archived);
if (!수입 || !생) { console.error('수입들기름/생들기름을 못 찾았다.'); process.exit(1); }
if (수입.unit !== 생.unit) { console.error(`단위가 다르다: 수입 ${수입.unit} / 생 ${생.unit}`); process.exit(1); }

const 부족 = Number(수입.stock ?? 0);
if (부족 >= 0) { console.log(`수입들기름 재고가 ${부족}${수입.unit} — 마이너스가 아니라 옮길 게 없다.`); process.exit(0); }
const 옮길양 = -부족;                                   // 512.848
const 생새재고 = Math.round((Number(생.stock ?? 0) - 옮길양) * 1000) / 1000;

const f = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 3 });
console.log(`\n═══ ${APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);
console.log(`   옮길 양 ${f(옮길양)}${수입.unit}\n`);
console.log(`   수입들기름  ${f(Number(수입.stock))}${수입.unit}  →  0`);
console.log(`   생들기름    ${f(Number(생.stock ?? 0))}${생.unit}  →  ${f(생새재고)}`);
if (생새재고 < 0) console.log(`\n   ⚠ 생들기름이 마이너스가 된다 — 그래도 진행한다.`);
console.log(`\n되돌리기: npx tsx scripts/fix-suip-to-saeng-stock.mts --undo  (백업 ${BACKUP})`);

if (!APPLY) { console.log(`\n적용하려면: npx tsx scripts/fix-suip-to-saeng-stock.mts --apply`); process.exit(0); }

writeFileSync(BACKUP, JSON.stringify({ [수입.id]: Number(수입.stock ?? 0), [생.id]: Number(생.stock ?? 0) }, null, 1), 'utf8');
await updateDoc(doc(db, 'items', 수입.id), { stock: 0 });
await updateDoc(doc(db, 'items', 생.id), { stock: 생새재고 });
console.log(`\n✅ 재고 이동 완료 · 백업 ${BACKUP}`);
process.exit(0);
