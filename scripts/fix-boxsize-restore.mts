// 짝 박스가 없는 낱개 품목에 개입수(boxSize)를 되살린다 — 규격은 낱개 그대로.
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// 규격(spec)은 낱개 용량만 적는다. 다만 화면에서 "몇 박스인지"를 보려면 개입수를 알아야 하는데,
//   · 짝 박스 품목이 있으면 그쪽이 개입수를 쥔다(boxSiblings) — 낱개엔 안 적어도 된다
//   · 고춧가루처럼 짝이 없으면 boxSize가 유일한 근거다 — 그건 되살린다
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc, deleteField } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
//  [품목 id, 개입수]  — fix-spec-loose-bulk이 빼기 전 값
const RESTORE: [string, number][] = [['gck-1', 20], ['gck-5', 4]];

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const items = (await getDocs(collection(db, 'items'))).docs.map(d => ({ id: d.id, ...d.data() } as any));

console.log(`\n═══ ${UNDO ? '↩ 되돌리기' : APPLY ? '🔴 적용(--apply)' : '🟢 미리보기(dry)'} ═══\n`);
for (const [id, n] of RESTORE) {
  const it = items.find((x: any) => x.id === id);
  if (!it) { console.log(`   ⚠ ${id} 없음`); continue; }
  console.log(`   ${String(it.name).padEnd(16)} 규격 [${it.spec}]  boxSize ${it.boxSize ?? '없음'} → ${UNDO ? '없앰' : n}   재고 ${it.stock}${it.unit} = ${Math.floor(Number(it.stock) / n)}박스 ${Number(it.stock) % n}${it.unit}`);
  if (APPLY || UNDO) await updateDoc(doc(db, 'items', id), { boxSize: UNDO ? deleteField() : n });
}
if (!APPLY && !UNDO) console.log(`\n적용: npx tsx scripts/fix-boxsize-restore.mts --apply`);
else console.log(`\n✅ 완료  (되돌리기: npx tsx scripts/fix-boxsize-restore.mts --undo)`);
process.exit(0);
