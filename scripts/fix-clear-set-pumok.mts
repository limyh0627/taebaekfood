// 선물세트에 남은 **서류용 품목**을 지운다.
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// **왜** (2026-09-06 사장님: "지워놔")
// 선물세트는 이제 든 완제품 각각으로 풀려 서류에 올라간다(shared/docOil 의 docUnpack).
// 그래서 세트 자신의 `품목` 은 **아무도 안 읽는다**. 그런데 값이 남아 있으면 다음 사람이
// "세트는 이 품목으로 잡히는구나" 하고 잘못 읽는다 — 실제로 그렇게 적혀 있어서 서류가
// 틀어져 있었다(참+들+볶음참깨가 들기름 하나로만 잡혔다).
//
// **규격(spec)은 안 지운다.** 그건 서류용이 아니라 전표 규격 칸·화면이 쓰는 값이다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc, deleteField } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-clear-set-pumok-backup.json';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('백업이 없다.'); process.exit(1); }
  const prev = JSON.parse(readFileSync(BACKUP, 'utf8')) as { id: string; name: string; 품목: string }[];
  for (const p of prev) await updateDoc(doc(db, 'items', p.id), { 품목: p.품목 });
  console.log(`되돌렸다 — 품목 ${prev.length}개 복구`);
  process.exit(0);
}

const items = (await getDocs(collection(db, 'items'))).docs.map(d => ({ id: d.id, ...(d.data() as any) }));
const byId = new Map(items.map(i => [i.id, i]));
const boms = (await getDocs(collection(db, 'item_bom'))).docs.map(d => d.data() as any);
const 완제품 = (x: any) => x && (x.type === 'product' || x.type === '완제품');
const 든완제품 = (id: string) =>
  boms.filter(b => (b.parentId ?? b.parent_id) === id)
      .filter(b => 완제품(byId.get(b.childId ?? b.child_id)));

//  세트 = 든 완제품이 둘 이상 (shared/orderUnits 의 묶음갈래of 와 같은 규칙)
const 세트 = items.filter(i => 완제품(i) && 든완제품(i.id).length > 1);
const 지울것 = 세트.filter(s => String(s.품목 ?? '').trim());

console.log(`선물세트 ${세트.length} / 그중 서류용 품목이 남은 것 ${지울것.length}`);
for (const s of 지울것) {
  const 든것 = 든완제품(s.id).map(b => byId.get(b.childId ?? b.child_id)?.품목).filter(Boolean);
  console.log(`  ${s.name}`);
  console.log(`     지울 값 '${s.품목}'  →  이제 서류엔 [${[...new Set(든것)].join(', ')}] 로 잡힌다`);
}

if (!APPLY) { console.log('\n--dry (기본). 적용하려면 --apply'); process.exit(0); }

writeFileSync(BACKUP, JSON.stringify(지울것.map(s => ({ id: s.id, name: s.name, 품목: s.품목 })), null, 2), 'utf8');
for (const s of 지울것) await updateDoc(doc(db, 'items', s.id), { 품목: deleteField() });
console.log(`\n✅ 선물세트 ${지울것.length}개에서 서류용 품목을 지웠다. 되돌리려면 --undo`);
process.exit(0);
