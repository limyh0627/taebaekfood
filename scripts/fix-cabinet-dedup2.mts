/**
 * 문서함 '서류관리' 대분류 7개를 하나로 — 중분류 겹친 것도 같이.
 *
 * 2026-09-01(7d6d889)에 한 번 고쳤는데 **또 났다.** 이번엔 7개가 7분 사이에
 * 하나씩 생겼다(09-02 08:11~08:18) — 화면을 켤 때마다 하나씩이다.
 * `fetchCollection` 으로 "이미 있나" 보고 없으면 만드는데, 그게 못 막는다.
 *
 * 그래서 코드는 **문서 id 를 이름에서 뽑도록** 바꿨다(DocumentManager). 같은 이름이면
 * 같은 문서라 두 번 써도 덮어써진다 — `rm-auto-{주문}-{원료}` 와 같은 수다.
 * 이 스크립트는 이미 생긴 찌꺼기를 치운다.
 *
 * **가장 오래된 것을 남기고** 나머지를 지운다. 중분류·파일은 이름으로 붙어 있어
 * (category 칸이 이름이다) 다시 이을 게 없다.
 *
 *   --dry (기본) / --apply / --undo
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BACKUP = fileURLToPath(new URL('./fix-cabinet-dedup2-backup.json', import.meta.url));
const mode = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--undo') ? 'undo' : 'dry';
const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const grab = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...(d.data() as any) }));

if (mode === 'undo') {
  if (!existsSync(BACKUP)) { console.log('되돌릴 backup 이 없다.'); process.exit(1); }
  for (const b of JSON.parse(readFileSync(BACKUP, 'utf8'))) await setDoc(doc(db, b.col, b.id), b.data);
  console.log('되돌렸다.'); process.exit(0);
}

const 지울: { col: string; id: string; data: any; 왜: string }[] = [];
const 뭉치 = <T extends { id: string; createdAt?: string }>(rows: T[], 열쇠: (r: T) => string) => {
  const m = new Map<string, T[]>();
  for (const r of rows) { const k = 열쇠(r); (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
  return m;
};

for (const [name, a] of 뭉치(await grab('fileCabinetCategories'), (c: any) => String(c.name))) {
  if (a.length < 2) continue;
  const 남길 = [...a].sort((x: any, y: any) => String(x.createdAt ?? '').localeCompare(String(y.createdAt ?? '')))[0];
  for (const c of a) if (c.id !== 남길.id) {
    const { id, ...data } = c as any;
    지울.push({ col: 'fileCabinetCategories', id, data, 왜: `대분류 "${name}" 중복 (남길 것 ${남길.id})` });
  }
}
for (const [k, a] of 뭉치(await grab('fileCabinetSubCategories'), (s: any) => `${s.category}|${s.name}`)) {
  if (a.length < 2) continue;
  const 남길 = [...a].sort((x: any, y: any) => String(x.createdAt ?? '').localeCompare(String(y.createdAt ?? '')))[0];
  for (const s of a) if (s.id !== 남길.id) {
    const { id, ...data } = s as any;
    지울.push({ col: 'fileCabinetSubCategories', id, data, 왜: `중분류 "${k}" 중복` });
  }
}

console.log(`[${mode}] 지울 것 ${지울.length}개`);
for (const x of 지울) console.log(`  ${x.col.replace('fileCabinet','')}  ${x.id}  ${x.왜}`);
if (!지울.length) { console.log('  치울 게 없다.'); process.exit(0); }
if (mode === 'dry') { console.log('\n--apply 를 붙여야 실제로 지운다.'); process.exit(0); }

writeFileSync(BACKUP, JSON.stringify(지울.map(({ col, id, data }) => ({ col, id, data })), null, 2), 'utf8');
for (const x of 지울) await deleteDoc(doc(db, x.col, x.id));
console.log(`\n${지울.length}개 지웠다. backup:`, BACKUP);
console.log('되돌리려면  npx tsx scripts/fix-cabinet-dedup2.mts --undo');
process.exit(0);
