// 회사가 없는 옛 품목을 태백으로 명시한다. 기본은 dry, --apply 적용, --undo 복원.
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { collection, deleteField, doc, getDocs, getFirestore, writeBatch } from 'firebase/firestore';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-item-company-backup.json';
const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
await signInAnonymously(getAuth(app));
const db = getFirestore(app);

const commitChunks = async (ids: string[], remove: boolean) => {
  for (let offset = 0; offset < ids.length; offset += 400) {
    const batch = writeBatch(db);
    for (const id of ids.slice(offset, offset + 400)) {
      batch.update(doc(db, 'items', id), { companyId: remove ? deleteField() : 'taebaek' });
    }
    await batch.commit();
  }
};

if (UNDO) {
  if (!existsSync(BACKUP)) throw new Error(`백업이 없다: ${BACKUP}`);
  const backup = JSON.parse(readFileSync(BACKUP, 'utf8')) as { ids: string[] };
  await commitChunks(backup.ids, true);
  console.log(`복원 완료: ${backup.ids.length}개 품목의 companyId 제거`);
  process.exit(0);
}

const snapshot = await getDocs(collection(db, 'items'));
const all = snapshot.docs.map(document => ({ id: document.id, ...document.data() })) as Array<Record<string, unknown> & { id: string }>;
const punghoe = all.filter(item => item.companyId === 'punghoe');
const targets = all.filter(item => item.companyId == null);
const other = all.filter(item => item.companyId != null && item.companyId !== 'taebaek' && item.companyId !== 'punghoe');

console.log(`전체 ${all.length}개 · 풍회 ${punghoe.length}개 · companyId 없음 ${targets.length}개 · 알 수 없는 회사 ${other.length}개`);
console.log(`풍회: ${punghoe.map(item => `${item.name}(${item.id})`).join(', ')}`);
console.log(`태백 지정 대상 예시: ${targets.slice(0, 10).map(item => `${item.name}(${item.id})`).join(', ')}`);
if (other.length) throw new Error(`알 수 없는 companyId가 있다: ${other.map(item => `${item.id}:${item.companyId}`).join(', ')}`);
if (!APPLY) {
  console.log('적용: npx tsx scripts/fix-item-company.mts --apply');
  process.exit(0);
}
if (existsSync(BACKUP)) throw new Error(`백업이 이미 있다. 중복 실행하지 않는다: ${BACKUP}`);
writeFileSync(BACKUP, JSON.stringify({ createdAt: new Date().toISOString(), ids: targets.map(item => item.id) }, null, 2), 'utf8');
await commitChunks(targets.map(item => item.id), false);
console.log(`적용 완료: ${targets.length}개 품목에 companyId=taebaek · 백업 ${BACKUP}`);
process.exit(0);
