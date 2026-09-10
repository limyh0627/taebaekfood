// 남은 거래처 단가의 빈 과세/면세를 채운다 — **참깨 원물만 면세, 나머지는 과세.**
//   기본 = --dry (미리보기).  적용 = --apply.
//   백업: scripts/fix-rest-taxtype-backup.json
//
// 근거 (2026-09-10 사장님) — "그밖은 다 과세고 참깨 원물은 면세".
//   앞서 기름류 98건은 따로 채웠다(`fix-oil-taxtype.mts`). 여기서는 그 나머지다 —
//   가루류·깨류·부자재(박스·캡·페트병) 는 **과세**, **참깨 원물**만 면세.
//
//   볶음참깨·볶음검정참깨는 **볶은 가공품이라 과세**다(원물이 아니다). 실제로 전표 이력도
//   과세로 끊겨 있어 앞 정리에서 이미 과세로 채워졌다.
//
// 안전장치 — 현재 이미 적혀 있는 값과 **어긋나는지 먼저 보여준다.** 빈칸만 채우고
//   기존 값은 덮지 않는다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, writeBatch } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const BACKUP = 'scripts/fix-rest-taxtype-backup.json';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const [pi, items, partners] = await Promise.all([load('partner_item'), load('items'), load('partners')]);
const byId = new Map(items.map((i: any) => [i.id, i]));
const 거래처 = new Map(partners.map((p: any) => [p.id, p.name]));

console.log(`\n═══ ${APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);

/**
 * **참깨 원물인가** — 볶지도 갈지도 않은 생 깨.
 * 볶음참깨·검정참깨가루·참깨가루는 가공품이라 과세다. 이름에 '참깨' 가 들어도 앞뒤를 본다.
 */
const 원물 = (n: string) => {
  const s = String(n ?? '').trim();
  if (/볶음|가루|기름|분|묵/.test(s)) return false;
  return /^(참깨|검정참깨|들깨|생깨)(\/|$|\s)/.test(s);
};

const 채울것: any[] = [];
const 이미있음어긋남: any[] = [];
for (const p of pi) {
  if (!(Number(p.price ?? 0) > 0) || !p.itemId) continue;
  const name = String(byId.get(p.itemId)?.name ?? p.itemId);
  const 답 = 원물(name) ? '면세' : '과세';
  const row = {
    id: p.id, name,
    거래처: 거래처.get(p.partnerId) ?? p.partnerId,
    dir: p.Direction === 'in' ? '매입' : '매출',
    price: p.price, 전: p.taxType ?? null, taxType: 답,
  };
  if (!p.taxType) { 채울것.push(row); continue; }
  if (p.taxType !== 답) 이미있음어긋남.push(row);
}

const 면세것 = 채울것.filter(r => r.taxType === '면세');
const 과세것 = 채울것.filter(r => r.taxType === '과세');
console.log(`빈칸 ${채울것.length}건 — 과세 ${과세것.length} · 면세 ${면세것.length}\n`);

console.log('── 면세로 채울 것 (참깨 원물) ──');
for (const r of 면세것) console.log(`   ${String(r.거래처).slice(0, 14).padEnd(14)} ${r.name.slice(0, 30).padEnd(30)} ${r.dir} ${String(r.price).padStart(8)}`);
console.log('\n── 과세로 채울 것 ──');
for (const r of 과세것.slice(0, 20)) console.log(`   ${String(r.거래처).slice(0, 14).padEnd(14)} ${r.name.slice(0, 30).padEnd(30)} ${r.dir} ${String(r.price).padStart(8)}`);
if (과세것.length > 20) console.log(`   … 외 ${과세것.length - 20}건`);

if (이미있음어긋남.length) {
  console.log(`\n⚠ 이미 적힌 값이 이 규칙과 어긋나는 것 ${이미있음어긋남.length}건 — **안 건드린다**`);
  for (const r of 이미있음어긋남.slice(0, 20)) {
    console.log(`   ${String(r.거래처).slice(0, 14).padEnd(14)} ${r.name.slice(0, 30).padEnd(30)} ${r.dir} 지금 ${r.전} · 규칙은 ${r.taxType}`);
  }
  if (이미있음어긋남.length > 20) console.log(`   … 외 ${이미있음어긋남.length - 20}건`);
}

if (!APPLY) { console.log('\n미리보기만 했다. 실제로 채우려면 --apply 를 붙여라.\n'); process.exit(0); }
if (채울것.length === 0) { console.log('\n할 일 없음.\n'); process.exit(0); }
if (existsSync(BACKUP)) throw new Error(`기존 백업이 있다. 먼저 확인하라: ${BACKUP}`);

writeFileSync(BACKUP, JSON.stringify({
  적은때: new Date().toISOString(),
  설명: '남은 거래처 단가의 빈 과세/면세를 채움 — 되돌리려면 각 id 의 taxType 을 지운다(전부 빈칸이던 것)',
  채운것: 채울것,
  안건드린어긋남: 이미있음어긋남,
}, null, 2), 'utf8');
console.log(`\n백업 → ${BACKUP}`);

for (let i = 0; i < 채울것.length; i += 400) {
  const batch = writeBatch(db);
  for (const r of 채울것.slice(i, i + 400)) batch.update(doc(db, 'partner_item', r.id), { taxType: r.taxType });
  await batch.commit();
  console.log(`  ${Math.min(i + 400, 채울것.length)} / ${채울것.length}`);
}
console.log(`\n✅ ${채울것.length}건 채웠다.\n`);
process.exit(0);
