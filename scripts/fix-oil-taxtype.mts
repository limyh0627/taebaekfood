// 기름류 거래처 단가의 과세/면세를 바로잡는다.
//   기본 = --dry (미리보기).  빈 것 채우기 = --apply.  면세로 잘못 적힌 것까지 = --apply --fix-exempt.
//   백업: scripts/fix-oil-taxtype-backup.json
//
// 근거 (2026-09-10 사장님) —
//   "근거1 현재상태 / 근거2 기름종류는 99퍼센트 과세"
//
//   ① **현재 상태** — 거래처 단가에 이미 적힌 기름류는 과세 155 · 면세 25 다.
//   ② **전표 이력** — 기름이 실제로 끊긴 줄은 과세 15 · 면세 **0**. 면세로 끊은 적이 없다.
//
//   그래서 빈 것은 **과세**로 채운다. 면세로 적힌 25건은 전표와 어긋나므로 잘못 적힌 것으로
//   보이지만, **기존 값을 덮는 일**이라 `--fix-exempt` 를 따로 붙여야 바꾼다.
//
// 무엇을 기름으로 보나 — 품목 이름에 '기름' 이 든 것. **이름으로 판정하는 예외다.**
//   과세 여부는 품목 성질이고 사장님이 갈래로 규칙을 주셨기 때문이다. 그래도 바꾼 것은
//   전부 백업에 남기고, 이름이 애매한 것(참고소·참향기름 같은 것)은 목록으로 보여준다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, writeBatch } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const FIX_EXEMPT = process.argv.includes('--fix-exempt');
const BACKUP = 'scripts/fix-oil-taxtype-backup.json';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const [pi, items, partners] = await Promise.all([load('partner_item'), load('items'), load('partners')]);
const byId = new Map(items.map((i: any) => [i.id, i]));
const 거래처 = new Map(partners.map((p: any) => [p.id, p.name]));

console.log(`\n═══ ${APPLY ? (FIX_EXEMPT ? '🔴 적용 + 면세 뒤집기' : '🔴 적용 — 빈 것만') : '🟢 미리보기(dry)'} ═══\n`);

const 기름 = (n: string) => /기름/.test(String(n ?? ''));
const 줄 = (p: any) => ({
  id: p.id,
  name: String(byId.get(p.itemId)?.name ?? p.itemId),
  거래처: 거래처.get(p.partnerId) ?? p.partnerId,
  dir: p.Direction === 'in' ? '매입' : '매출',
  price: p.price,
  전: p.taxType ?? '(빈칸)',
});

const 빈것: any[] = [], 면세인것: any[] = [];
for (const p of pi) {
  if (!(Number(p.price ?? 0) > 0) || !p.itemId) continue;
  const n = byId.get(p.itemId)?.name ?? '';
  if (!기름(n)) continue;
  if (!p.taxType) 빈것.push(줄(p));
  else if (p.taxType === '면세') 면세인것.push(줄(p));
}

console.log(`빈칸인 기름류 단가 ${빈것.length}건 → **과세** 로 채운다`);
for (const r of 빈것.slice(0, 12)) console.log(`   ${String(r.거래처).slice(0, 14).padEnd(14)} ${r.name.slice(0, 30).padEnd(30)} ${r.dir} ${String(r.price).padStart(8)}`);
if (빈것.length > 12) console.log(`   … 외 ${빈것.length - 12}건`);

console.log(`\n면세로 적힌 기름류 ${면세인것.length}건 — 전표에서는 기름이 면세로 끊긴 적이 **0줄**이다`);
for (const r of 면세인것) console.log(`   ${String(r.거래처).slice(0, 14).padEnd(14)} ${r.name.slice(0, 30).padEnd(30)} ${r.dir} ${String(r.price).padStart(8)}`);
console.log(FIX_EXEMPT ? '   → **과세로 바꾼다**(--fix-exempt)' : '   → 안 바꾼다. 바꾸려면 --fix-exempt 를 붙여라.');

const 바꿀것 = FIX_EXEMPT ? [...빈것, ...면세인것] : 빈것;
console.log(`\n바꿀 것 모두 ${바꿀것.length}건`);

if (!APPLY) { console.log('\n미리보기만 했다. 실제로 바꾸려면 --apply 를 붙여라.\n'); process.exit(0); }
if (바꿀것.length === 0) { console.log('\n할 일 없음.\n'); process.exit(0); }
if (existsSync(BACKUP)) throw new Error(`기존 백업이 있다. 먼저 확인하라: ${BACKUP}`);

writeFileSync(BACKUP, JSON.stringify({
  적은때: new Date().toISOString(),
  설명: '기름류 거래처 단가의 과세/면세 — 되돌리려면 각 id 의 taxType 을 `전` 값으로 되쓴다(빈칸이면 지운다)',
  바꾼것: 바꿀것,
}, null, 2), 'utf8');
console.log(`\n백업 → ${BACKUP}`);

for (let i = 0; i < 바꿀것.length; i += 400) {
  const batch = writeBatch(db);
  for (const r of 바꿀것.slice(i, i + 400)) batch.update(doc(db, 'partner_item', r.id), { taxType: '과세' });
  await batch.commit();
  console.log(`  ${Math.min(i + 400, 바꿀것.length)} / ${바꿀것.length}`);
}
console.log(`\n✅ ${바꿀것.length}건 과세로 맞췄다.\n`);
process.exit(0);
