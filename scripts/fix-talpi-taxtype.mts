// 탈피들깨가루 거래처 단가를 **전부 면세**로 맞춘다.
//   기본 = --dry (미리보기).  적용 = --apply.
//   백업: scripts/fix-talpi-taxtype-backup.json
//
// 근거 (2026-09-10 사장님) — "탈피들깨가루는 다 면세고".
//
//   앞서 "그밖은 다 과세" 규칙을 가루류에 그대로 씌운 게 지나쳤다. 탈피들깨가루는 면세다.
//   현재 상태도 그 쪽에 기운다 — 거래처 단가 면세 13 · 과세 13, **전표 이력은 면세 18줄 ·
//   과세 4줄.** 실제로 끊을 때는 면세로 끊고 있었다.
//
// **이건 기존 값도 덮는다.** 사장님이 "다 면세"라고 못박으셨기 때문이다.
//   덮은 값은 전부 백업에 `전` 으로 남는다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, writeBatch } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const BACKUP = 'scripts/fix-talpi-taxtype-backup.json';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const [pi, items, partners] = await Promise.all([load('partner_item'), load('items'), load('partners')]);
const byId = new Map(items.map((i: any) => [i.id, i]));
const 거래처 = new Map(partners.map((p: any) => [p.id, p.name]));

console.log(`\n═══ ${APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);

const 바꿀것: any[] = [];
for (const p of pi) {
  if (!(Number(p.price ?? 0) > 0) || !p.itemId) continue;
  const name = String(byId.get(p.itemId)?.name ?? p.itemId);
  if (!/탈피들깨가루/.test(name)) continue;
  if (p.taxType === '면세') continue;                 // 이미 맞다
  바꿀것.push({
    id: p.id, name,
    거래처: 거래처.get(p.partnerId) ?? p.partnerId,
    dir: p.Direction === 'in' ? '매입' : '매출',
    price: p.price, 전: p.taxType ?? null,
  });
}

console.log(`면세로 바꿀 것 ${바꿀것.length}건`);
for (const r of 바꿀것) {
  console.log(`   ${String(r.거래처).slice(0, 16).padEnd(16)} ${r.name.slice(0, 28).padEnd(28)} ${r.dir} ${String(r.price).padStart(9)}  지금 ${r.전 ?? '(빈칸)'}`);
}

if (!APPLY) { console.log('\n미리보기만 했다. 실제로 바꾸려면 --apply 를 붙여라.\n'); process.exit(0); }
if (바꿀것.length === 0) { console.log('\n할 일 없음.\n'); process.exit(0); }
if (existsSync(BACKUP)) throw new Error(`기존 백업이 있다. 먼저 확인하라: ${BACKUP}`);

writeFileSync(BACKUP, JSON.stringify({
  적은때: new Date().toISOString(),
  설명: '탈피들깨가루를 면세로 — 되돌리려면 각 id 의 taxType 을 `전` 값으로 되쓴다(null 이면 지운다)',
  바꾼것: 바꿀것,
}, null, 2), 'utf8');
console.log(`\n백업 → ${BACKUP}`);

const batch = writeBatch(db);
for (const r of 바꿀것) batch.update(doc(db, 'partner_item', r.id), { taxType: '면세' });
await batch.commit();
console.log(`\n✅ ${바꿀것.length}건 면세로 맞췄다.\n`);
process.exit(0);
