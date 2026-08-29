// 거래처를 태백푸드 → 태백식품으로 바꾸면서 비고(note)에 남은 옛 이름을 마저 고친다.
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// partnerName만 바꾸고 note는 안 고쳐서, 화면에 '태백식품 … 태백푸드 수금'으로 두 이름이 같이 떴다.
// 자동 생성된 문구라 글자만 바뀌고 뜻은 그대로다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-note-taebaek-food-backup.json';
const OLD = '태백푸드', NEW = '태백식품';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('백업이 없다.'); process.exit(1); }
  const prev: Record<string, string> = JSON.parse(readFileSync(BACKUP, 'utf8'));
  for (const [id, note] of Object.entries(prev)) await updateDoc(doc(db, 'cashEntries', id), { note });
  console.log(`✅ ${Object.keys(prev).length}건 비고 되돌림`);
  process.exit(0);
}

const cash = (await getDocs(collection(db, 'cashEntries'))).docs.map(d => ({ id: d.id, ...d.data() } as any));
//  풍회 장부의 기록만 손댄다 — 태백 쪽에도 같은 글자가 있으면 그건 다른 뜻일 수 있다.
const targets = cash.filter((c: any) => c.companyId === 'punghoe' && String(c.note ?? '').includes(OLD));
console.log(`\n═══ ${APPLY ? '🔴 적용(--apply)' : '🟢 미리보기(dry)'} ═══\n`);
for (const c of targets) console.log(`   ${c.date} "${c.note}"  →  "${String(c.note).split(OLD).join(NEW)}"`);
const other = cash.filter((c: any) => c.companyId !== 'punghoe' && String(c.note ?? '').includes(OLD));
console.log(`\n   ${targets.length}건 변경 예정 (풍회 밖에 남은 '${OLD}' 비고 ${other.length}건은 안 건드린다)`);
console.log(`되돌리기: npx tsx scripts/fix-note-taebaek-food.mts --undo`);
if (!APPLY) { console.log(`\n적용: npx tsx scripts/fix-note-taebaek-food.mts --apply`); process.exit(0); }

writeFileSync(BACKUP, JSON.stringify(Object.fromEntries(targets.map((c: any) => [c.id, c.note])), null, 1), 'utf8');
for (const c of targets) await updateDoc(doc(db, 'cashEntries', c.id), { note: String(c.note).split(OLD).join(NEW) });
console.log(`\n✅ ${targets.length}건 · 백업 ${BACKUP}`);
process.exit(0);
