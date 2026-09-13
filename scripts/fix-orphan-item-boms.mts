/**
 * 삭제된 품목을 아직 가리키는 item_bom 줄을 정리한다.
 *
 *   npx tsx scripts/fix-orphan-item-boms.mts          # 미리보기
 *   npx tsx scripts/fix-orphan-item-boms.mts --apply  # 백업 후 삭제
 *   npx tsx scripts/fix-orphan-item-boms.mts --undo   # 원래 BOM 줄 복원
 */
import { deleteApp, initializeApp } from 'firebase/app';
import { collection, deleteDoc, doc, getDocs, getFirestore, setDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const BACKUP = 'scripts/fix-orphan-item-boms-backup.json';
const mode = process.argv.includes('--apply') ? 'apply'
  : process.argv.includes('--undo') ? 'undo' : 'dry';

const app = initializeApp({
  apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE',
  authDomain: 'taebaek-3abe4.firebaseapp.com',
  projectId: 'taebaek-3abe4',
});
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

if (mode === 'undo') {
  if (!existsSync(BACKUP)) throw new Error('백업이 없어 되돌릴 수 없다.');
  const backup = JSON.parse(readFileSync(BACKUP, 'utf8')) as { itemBoms: Array<{ id: string } & Record<string, unknown>> };
  for (const row of backup.itemBoms) {
    const { id, ...data } = row;
    await setDoc(doc(db, 'item_bom', id), data);
  }
  console.log(`${backup.itemBoms.length}개 BOM 줄을 복원했다.`);
  await deleteApp(app);
  process.exit(0);
}

const [itemSnap, bomSnap] = await Promise.all([
  getDocs(collection(db, 'items')),
  getDocs(collection(db, 'item_bom')),
]);
const itemIds = new Set(itemSnap.docs.map(snapshot => snapshot.id));
const boms = bomSnap.docs.map(snapshot => ({ id: snapshot.id, ...snapshot.data() } as any));
const targets = boms.filter(row => !itemIds.has(String(row.parent_id)) || !itemIds.has(String(row.child_id)));

console.log(`품목 ${itemIds.size}개 · BOM ${boms.length}줄 · 고아 BOM ${targets.length}줄`);
for (const row of targets) {
  const missing = [
    ...(!itemIds.has(String(row.parent_id)) ? [`부모 ${row.parent_id}`] : []),
    ...(!itemIds.has(String(row.child_id)) ? [`구성품 ${row.child_id}`] : []),
  ];
  console.log(`  ${row.id}: ${row.parent_id} → ${row.child_id} ×${row.quantity ?? 1} (${missing.join(', ')} 없음)`);
}

if (mode === 'dry' || targets.length === 0) {
  console.log(mode === 'dry' && targets.length > 0 ? '\n미리보기다. 실제 적용은 --apply' : '\n정리할 것이 없다.');
  await deleteApp(app);
  process.exit(0);
}

if (existsSync(BACKUP)) {
  throw new Error(`${BACKUP}이 이미 있다. 두 번 적용하지 않는다.`);
}
writeFileSync(BACKUP, JSON.stringify({ backedUpAt: new Date().toISOString(), itemBoms: targets }, null, 2), 'utf8');
for (const row of targets) await deleteDoc(doc(db, 'item_bom', row.id));
console.log(`\n백업 ${BACKUP}을 남기고 고아 BOM ${targets.length}줄을 삭제했다.`);
await deleteApp(app);
