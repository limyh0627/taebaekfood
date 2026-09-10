// 과세 품목 원가가 **세포함 값으로 부푼 것**을 공급가액으로 낮춘다.
//   기본 = --dry (미리보기, 쓰기 없음).  적용 = --apply.
//   백업: scripts/fix-cost-vat-inflated-backup.json  (되돌리려면 그 값을 되쓴다)
//
// 왜 —
//   품목 원가는 **공급가액**이고, 전표에 치는 매입단가는 **세포함**이다(인수인계 "원가는 공급가액").
//   둘을 한 필드처럼 복사하던 시절에 과세 품목 원가가 10% 부풀었다. 2026-09-06 에 60개를 되돌렸는데
//   전표를 다시 끊자 되살아났다. 새는 자리는 2026-09-10 에 막았다 —
//   이제 `partnerPriceWrites` 가 **그 전표 줄의 공급가액**을 원가로 쓴다(사장님 지시).
//   이 스크립트는 그때까지 남은 값을 한 번 낮추는 것이다.
//
// 무엇을 고르나 —
//   매입 거래처단가(`partner_item` Direction='in')가 있고, 그 단가의 `taxType` 이 **과세**이며,
//   `items.cost` 가 그 단가와 **같은** 품목. 세포함 단가가 원가 자리에 그대로 앉아 있다는 뜻이다.
//   면세는 세포함 = 공급가라 손대지 않는다(참깨·깨분 같은 농산물).
//
// 무엇을 안 고치나 —
//   `taxType` 이 비어 있는 줄은 **건드리지 않는다.** 과세인지 면세인지 아무도 안 정한 것이라
//   코드가 짐작하면 멀쩡한 값을 깎을 수 있다. 목록만 보여준다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, writeBatch } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync, existsSync } from 'node:fs';
import { costOfPurchase } from '../src/shared/lineAmount';

const APPLY = process.argv.includes('--apply');
const BACKUP = 'scripts/fix-cost-vat-inflated-backup.json';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const [items, partnerItems] = await Promise.all([load('items'), load('partner_item')]);
const byId = new Map(items.map((i: any) => [i.id, i]));

console.log(`\n═══ ${APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);

const 가깝다 = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.005);

const 고칠것: any[] = [];
const 과세미정: any[] = [];
for (const pi of partnerItems) {
  if (pi.Direction !== 'in') continue;
  const price = Number(pi.price ?? 0);
  if (!(price > 0)) continue;
  const it = byId.get(pi.itemId);
  if (!it || it.archived) continue;
  const cost = Number(it.cost ?? 0);
  if (!(cost > 0)) continue;
  if (!가깝다(cost, price)) continue;           // 원가가 단가와 다르면 이 건이 아니다

  if (pi.taxType === '면세') continue;          // 세포함 = 공급가. 정상이다.
  if (pi.taxType !== '과세') { 과세미정.push({ name: it.name, cost, price }); continue; }

  const 정답 = costOfPurchase(price, false);
  if (가깝다(cost, 정답)) continue;              // 이미 맞다
  고칠것.push({ id: it.id, name: it.name, before: cost, after: 정답, 단가: price, 차: Math.round(cost - 정답) });
}

console.log(`고칠 것 ${고칠것.length}개`);
for (const r of 고칠것) {
  console.log(`  ${String(r.name).slice(0, 34).padEnd(34)} 원가 ${String(r.before).padStart(9)} → ${String(r.after).padStart(9)}   (−${r.차})   매입단가 ${r.단가}`);
}
if (고칠것.length) console.log(`\n낮추는 합 ${고칠것.reduce((a, b) => a + b.차, 0).toLocaleString()}원`);

if (과세미정.length) {
  console.log(`\n⚠ 과세/면세가 안 정해진 것 ${과세미정.length}개 — **손대지 않는다.** 사람이 정해야 한다.`);
  for (const r of 과세미정) console.log(`    ${String(r.name).slice(0, 34).padEnd(34)} 원가 ${r.cost} = 단가 ${r.price}`);
}

if (!APPLY) { console.log('\n미리보기만 했다. 실제로 낮추려면 --apply 를 붙여라.\n'); process.exit(0); }
if (고칠것.length === 0) { console.log('\n할 일 없음.\n'); process.exit(0); }
if (existsSync(BACKUP)) throw new Error(`기존 백업이 있다. 먼저 확인하라: ${BACKUP}`);

writeFileSync(BACKUP, JSON.stringify({
  적은때: new Date().toISOString(),
  설명: '과세 품목 원가를 공급가액으로 낮춤 — 되돌리려면 before 를 items.cost 에 되쓴다',
  바꾼것: 고칠것.map(r => ({ id: r.id, name: r.name, before: r.before, after: r.after })),
}, null, 2), 'utf8');
console.log(`\n백업 → ${BACKUP}`);

const batch = writeBatch(db);
for (const r of 고칠것) batch.update(doc(db, 'items', r.id), { cost: r.after });
await batch.commit();
console.log(`\n✅ ${고칠것.length}개 낮췄다.\n`);
process.exit(0);
