// 금빛 350ml BOM 수량을 L → kg로 정정.
//   기본 = --dry (미리보기, 쓰기 없음).  실제 적용 = --apply.
//
// BOM 수량은 **언제나 kg**으로 저장한다(items.stock·로트·원료수불부와 같은 단위).
// 화면이 kg 숫자에 'L' 딱지만 붙여 용량이 모자라 보였고, 그걸 맞추려다 이 한 줄만
// L(0.35)로 들어갔다. 다른 116줄은 전부 kg이다. 표시 쪽은 밀도로 나눠 L로 보여주도록 고쳤다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const APPLY = process.argv.includes('--apply');
const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const [items, boms] = await Promise.all([load('items'), load('item_bom')]);
const byId = new Map(items.map((i: any) => [i.id, i]));
const ml = (s: string) => { const m = /([\d.]+)\s*(ml|l)/i.exec(String(s)); return m ? (m[2].toLowerCase() === 'l' ? parseFloat(m[1]) * 1000 : parseFloat(m[1])) : 0; };

console.log(`\n═══ ${APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);

const plan: { id: string; label: string; from: number; to: number }[] = [];
for (const b of boms) {
  const child = byId.get(b.child_id), parent = byId.get(b.parent_id);
  if (!child?.density || !parent || parent.archived) continue;
  const vol = ml(parent.spec ?? '') || ml(parent.name ?? '');
  if (!vol) continue;
  const asL = vol / 1000, asKg = asL * child.density, q = Number(b.quantity ?? 0);
  //  L로 들어간 줄만 — kg 값보다 L 값에 가까운 것.
  if (Math.abs(q - asL) < Math.abs(q - asKg)) {
    plan.push({ id: b.id, label: `${parent.name} ← ${child.name}`, from: q, to: Math.round(asKg * 10000) / 10000 });
  }
}
for (const r of plan) console.log(`  ${r.label.padEnd(46)} ${r.from} L → ${r.to} kg`);
console.log(`\n총 ${plan.length}줄`);
console.log('되돌리기: quantity를 위 왼쪽 값으로.');

if (!APPLY) { console.log(`\n적용하려면: npx tsx scripts/fix-bom-금빛-kg.mts --apply`); process.exit(0); }
for (const r of plan) await updateDoc(doc(db, 'item_bom', r.id), { quantity: r.to });
console.log(`\n✅ ${plan.length}줄 kg으로 정정`);
process.exit(0);
