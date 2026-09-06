// 거래처–품목 연결에서 **옛 방식(items.partnerIds)을 걷어낸다.**
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// **왜** (2026-09-06 사장님: "옛방식은 정리")
// 연결이 두 군데 살면서 서로 어긋났고, 그 바람에 동우 볶음참깨 주문이 10개입 대신
// 20개입으로 들어갔다(재고가 엉뚱한 데서 빠졌다). 근거가 둘이면 언젠가 갈린다.
//
// **어떻게**
//   ① 옛 방식에만 있는 연결 7개를 `partner_item` 으로 옮긴다 (단가는 안 적는다 —
//      단가는 원래 없던 것이고, 없으면 화면이 빈 칸으로 둔다)
//   ② 그러고 나서 모든 품목의 `partnerIds` 를 지운다
//
// `SMARTSTORE` 는 거래처가 아니라 **채널 표식**이라 남긴다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc, updateDoc, deleteDoc, deleteField } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-drop-legacy-partnerids-backup.json';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('백업이 없다.'); process.exit(1); }
  const prev = JSON.parse(readFileSync(BACKUP, 'utf8')) as
    { items: { id: string; partnerIds: string[] }[]; added: string[] };
  for (const it of prev.items) await updateDoc(doc(db, 'items', it.id), { partnerIds: it.partnerIds });
  for (const id of prev.added) await deleteDoc(doc(db, 'partner_item', id));
  console.log(`✅ 품목 ${prev.items.length}개 되돌리고, 새로 만든 연결 ${prev.added.length}개 지움`);
  process.exit(0);
}

const items = (await getDocs(collection(db, 'items'))).docs.map(d => ({ id: d.id, ...(d.data() as any) }));
const pi = (await getDocs(collection(db, 'partner_item'))).docs.map(d => d.data() as any);
const 판매 = new Set(pi.filter(r => r.Direction !== 'in').map(r => `${r.partnerId}|${r.itemId}`));

const 옮길것: { partnerId: string; itemId: string }[] = [];
const 지울품목: { id: string; partnerIds: string[] }[] = [];
for (const i of items) {
  const ids: string[] = i.partnerIds ?? [];
  if (!ids.length) continue;
  const 거래처만 = ids.filter(c => c !== 'SMARTSTORE');
  for (const c of 거래처만) if (!판매.has(`${c}|${i.id}`)) 옮길것.push({ partnerId: c, itemId: i.id });
  //  SMARTSTORE 표식은 남긴다 — 지우면 스마트스토어 품목이 통째로 사라진다
  const 남길 = ids.filter(c => c === 'SMARTSTORE');
  if (거래처만.length) 지울품목.push({ id: i.id, partnerIds: ids });
  else if (!남길.length) 지울품목.push({ id: i.id, partnerIds: ids });
}

console.log(`옛 방식을 쓰는 품목 ${지울품목.length}개`);
console.log(`  ① partner_item 으로 옮길 연결: ${옮길것.length}개`);
옮길것.forEach(x => console.log(`      ${x.partnerId} ← ${items.find(i=>i.id===x.itemId)?.name} [${items.find(i=>i.id===x.itemId)?.spec ?? '-'}]`));
console.log(`  ② 그 뒤 partnerIds 를 비운다 (SMARTSTORE 표식은 남긴다)`);

if (!APPLY) { console.log('\n--dry (기본). 적용하려면 --apply'); process.exit(0); }

const added: string[] = [];
for (const x of 옮길것) {
  const id = `${x.itemId}_${x.partnerId}_out`;
  await setDoc(doc(db, 'partner_item', id), {
    id, itemId: x.itemId, partnerId: x.partnerId, Direction: 'out',
  }, { merge: true });
  added.push(id);
}
writeFileSync(BACKUP, JSON.stringify({ items: 지울품목, added }, null, 2), 'utf8');

for (const it of 지울품목) {
  const 남길 = it.partnerIds.filter(c => c === 'SMARTSTORE');
  await updateDoc(doc(db, 'items', it.id), 남길.length ? { partnerIds: 남길 } : { partnerIds: deleteField() });
}
console.log(`\n✅ 연결 ${added.length}개 옮기고, 품목 ${지울품목.length}개에서 옛 방식을 걷었다. 되돌리려면 --undo`);
process.exit(0);
