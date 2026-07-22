// 볶음참깨 낱개1kg·10kg박스·20kg박스 → procureType '완사입' → '임가공' (OEM, 푸미푸드)
// 기본 dry-run. 반영하려면 --apply, 되돌리려면 --undo
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, updateDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const app = initializeApp({
  apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE',
  authDomain: 'taebaek-3abe4.firebaseapp.com',
  projectId: 'taebaek-3abe4',
});
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

const apply = process.argv.includes('--apply');
const undo = process.argv.includes('--undo');
const TARGET = undo ? '완사입' : '임가공';

const IDS = [
  ['볶음참깨-낱개/1kg', 'PLDhkjOgcPIhO1hhReHm'],
  ['볶음참깨/10kg박스', 'p-1780625531675'],
  ['볶음참깨/20kg박스', 'p-1780625559322'],
];

console.log(`${undo ? '되돌리기' : '전환'}: procureType → '${TARGET}'   ${apply ? '[반영]' : '[DRY RUN — 반영하려면 --apply]'}\n`);

for (const [label, id] of IDS) {
  const snap = await getDoc(doc(db, 'items', id));
  if (!snap.exists()) { console.log(`  ✗ ${label} — 문서 없음 (${id})`); continue; }
  const d = snap.data();
  console.log(`  ${label.padEnd(20)} category=${d.category}  procureType=${d.procureType ?? '(없음)'}  →  ${TARGET}`);
  if (apply) {
    await updateDoc(doc(db, 'items', id), { procureType: TARGET });
    console.log(`     ✓ 반영`);
  }
}

if (apply) {
  console.log('\n검증:');
  for (const [label, id] of IDS) {
    const s = await getDoc(doc(db, 'items', id));
    console.log(`  ${label.padEnd(20)} procureType=${s.data()?.procureType}`);
  }
}
process.exit(0);
