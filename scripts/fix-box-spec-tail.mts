// 박스 품목의 규격을 BOM 에 맞춘다.
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
//   규격 글자(`180ml * 40`)는 **BOM 을 따라 적는 것**이다. 근거가 아니다.
//   품목 편집창도 BOM 수량을 고칠 때 규격을 따라 쓰는데, 그 길로 안 들어온 품목이 있어
//   글자가 안 따라갔다. 코드는 이제 BOM 을 먼저 보므로 동작엔 지장이 없지만,
//   화면에 찍히는 규격이 다른 131개와 달라 보인다.
//
//   기대값 = (낱개 품목의 규격에서 꼬리를 뗀 것) + ' * ' + (BOM 수량)
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { setBomIndex, buildBomIndex } from '../src/shared/bomIndex';
import { unpackComponent } from '../src/shared/orderUnits';
import { boxSpecOf } from '../src/shared/boxSpec';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-box-spec-tail-backup.json';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('✖ 백업이 없다.'); process.exit(1); }
  for (const before of JSON.parse(readFileSync(BACKUP, 'utf8')).before) {
    const { id, ...rest } = before;
    await setDoc(doc(db, 'items', id), rest);
  }
  console.log('✅ 되돌림'); process.exit(0);
}

const [items, boms] = await Promise.all([load('items'), load('item_bom')]);
setBomIndex(buildBomIndex(items as never, boms as never));
const byId = new Map(items.map((p: any) => [p.id, p]));

//  규칙은 shared/boxSpec 하나에 있다 — 화면(저장 때 전파)과 여기가 같은 셈을 써야 한다
const 기대 = (p: any): string | null => {
  const u = unpackComponent(p); if (!u) return null;
  const child: any = byId.get(u.itemId);
  return boxSpecOf(child?.spec, u.count) || null;
};

console.log(`\n━━ 박스 규격을 BOM 에 맞춘다 ━━  (${APPLY ? '적용' : '미리보기 — 적용하려면 --apply'})\n`);
const before: any[] = [];
const writes: { id: string; spec: string }[] = [];
for (const p of items.filter((x: any) => (x.type === 'product' || x.type === 'goods') && unpackComponent(x))) {
  const want = 기대(p);
  if (!want || String(p.spec ?? '').trim() === want) continue;
  const u = unpackComponent(p)!;
  const 용량바뀜 = String(p.spec ?? '').replace(/\s*\*.*$/, '').trim() !== want.replace(/\s*\*.*$/, '').trim();
  console.log(`   ${String(p.name).slice(0,30).padEnd(30)} '${p.spec ?? '-'}' → '${want}'   BOM ×${u.count}${용량바뀜 ? '   ⚠ 용량도 바뀐다' : ''}`);
  before.push(p); writes.push({ id: p.id, spec: want });
}

if (!writes.length) { console.log('   맞출 게 없다.\n'); process.exit(0); }
console.log(`\n※ 규격은 화면에 찍히는 글자다. 개입수 판단은 이미 BOM 이 하므로 동작은 안 바뀐다.`);
if (!APPLY) { console.log(`\n${writes.length}건이 바뀐다. 적용하려면 --apply\n`); process.exit(0); }

writeFileSync(BACKUP, JSON.stringify({ at: new Date().toISOString(), before }, null, 2), 'utf8');
for (const w of writes) {
  const src = before.find(x => x.id === w.id);
  const { id, ...rest } = { ...src, spec: w.spec };
  await setDoc(doc(db, 'items', w.id), rest);
}
console.log(`\n✅ ${writes.length}건 맞췄다.  백업: ${BACKUP}  (되돌리기: --undo)\n`);
process.exit(0);
