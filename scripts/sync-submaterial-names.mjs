/**
 * 품목 문서 내 submaterials[].name (용기/마개/라벨 표시용 스냅샷)을
 * items 컬렉션의 현재 이름과 동기화
 *  - 차감 로직은 id 기준이라 동작에는 영향 없음 — 표시 이름만 갱신
 *  - id로 못 찾는 항목은 이름의 "태백"→"시골향" 치환 폴백
 *
 * 사용법:
 *   node scripts/sync-submaterial-names.mjs          # 드라이런
 *   node scripts/sync-submaterial-names.mjs --apply  # 실제 적용
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, writeBatch } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const APPLY = process.argv.includes('--apply');

const firebaseConfig = {
  apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE',
  authDomain: 'taebaek-3abe4.firebaseapp.com',
  projectId: 'taebaek-3abe4',
};

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);
await signInAnonymously(auth);

const itemsSnap = await getDocs(collection(db, 'items'));
const itemMap = new Map(itemsSnap.docs.map(d => [d.id, d.data()]));

const updates = []; // { id, parentName, submaterials, changed: [{old,new}] }
for (const d of itemsSnap.docs) {
  const x = d.data();
  if (!Array.isArray(x.submaterials) || x.submaterials.length === 0) continue;
  const changed = [];
  const newSubs = x.submaterials.map(s => {
    const current = itemMap.get(s.id);
    let newName = null;
    if (current && current.name && current.name !== s.name) newName = current.name;
    else if (!current && (s.name ?? '').includes('태백')) newName = s.name.replaceAll('태백', '시골향');
    if (!newName || newName === s.name) return s;
    changed.push({ old: s.name, new: newName });
    return { ...s, name: newName };
  });
  if (changed.length > 0) updates.push({ id: d.id, parentName: x.name, submaterials: newSubs, changed });
}

console.log(`═══ submaterials 이름 동기화 대상: ${updates.length}개 품목 ═══`);
for (const u of updates) {
  console.log(`  ${u.parentName} (${u.id}):`);
  for (const c of u.changed) console.log(`    ${c.old} → ${c.new}`);
}

if (!APPLY) {
  console.log('\n(드라이런 — 실제 변경 없음. 적용하려면 --apply 옵션을 붙이세요)');
  process.exit(0);
}

console.log('\n═══ 적용 시작 ═══');
for (let i = 0; i < updates.length; i += 400) {
  const batch = writeBatch(db);
  for (const u of updates.slice(i, i + 400)) batch.update(doc(db, 'items', u.id), { submaterials: u.submaterials });
  await batch.commit();
  console.log(`  ${Math.min(i + 400, updates.length)}/${updates.length} 커밋 완료`);
}
console.log(`✅ 완료: ${updates.length}개 품목의 submaterials 이름 동기화`);
process.exit(0);
