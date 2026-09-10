// 거래처 단가의 빈 **과세/면세**를 근거가 있는 것만 채운다.
//   기본 = --dry (미리보기, 쓰기 없음).  적용 = --apply.
//   백업: scripts/fix-partner-item-taxtype-backup.json  (되돌리려면 그 줄의 taxType 을 지운다)
//
// 왜 —
//   `partner_item.price` 는 **판매단가(세포함)** 다. 공급가액은 거기서 역산하는데,
//   그러려면 **과세인지 면세인지**를 알아야 한다(2026-09-10 사장님: "단가는 판매단가고
//   공급가액은 공급가액이지"). 그 값이 446건 중 265건에 비어 있어서 견적서·마진·원가가
//   전부 흔들렸다.
//
// 무엇을 근거로 채우나 — 둘뿐이고, **둘이 다르면 안 채운다.**
//   ① 같은 품목의 **다른 거래처 단가**에 적힌 값. 과세 여부는 품목의 성질이라 거래처가
//      달라도 같아야 한다.
//   ② **전표 이력**에 그 품목으로 끊은 줄(`isTaxExempt`). 사람이 발행하며 고른 값이다.
//
//   이름으로 짐작하지 않는다 — "참기름이니까 과세" 같은 추정은 안 한다(인수인계
//   "연결은 이름이 아니라 열쇠(id)로 건다", "이름을 근거로 판정하지 않는다").
//   근거가 없는 것은 **손대지 않고 목록으로 낸다.** 사람이 정해야 한다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, writeBatch } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const BACKUP = 'scripts/fix-partner-item-taxtype-backup.json';
const 남은목록 = 'scripts/fix-partner-item-taxtype-남은것.json';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const [pi, st, items, partners] = await Promise.all(
  [load('partner_item'), load('issuedStatements'), load('items'), load('partners')]);
const byId = new Map(items.map((i: any) => [i.id, i]));
const 거래처 = new Map(partners.map((p: any) => [p.id, p.name]));

console.log(`\n═══ ${APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);

const 한값 = (m: Map<string, Set<string>>, id: string) => {
  const s = m.get(id);
  return s && s.size === 1 ? [...s][0] : null;
};

//  ① 같은 품목의 다른 거래처 단가
const 품목별 = new Map<string, Set<string>>();
for (const p of pi) {
  if (!p.itemId || !p.taxType) continue;
  if (!품목별.has(p.itemId)) 품목별.set(p.itemId, new Set());
  품목별.get(p.itemId)!.add(p.taxType);
}
//  ② 전표 이력
const 전표별 = new Map<string, Set<string>>();
for (const s of st) {
  for (const l of (s.items ?? [])) {
    if (!l.itemId) continue;
    if (!전표별.has(l.itemId)) 전표별.set(l.itemId, new Set());
    전표별.get(l.itemId)!.add(l.isTaxExempt ? '면세' : '과세');
  }
}

const 채울것: any[] = [];
const 남은것: any[] = [];
for (const p of pi) {
  if (!(Number(p.price ?? 0) > 0) || p.taxType || !p.itemId) continue;
  const a = 한값(품목별, p.itemId);
  const b = 한값(전표별, p.itemId);
  if (a && b && a !== b) { 남은것.push({ ...p, 왜: `근거가 어긋난다(단가 ${a} · 전표 ${b})` }); continue; }
  const 답 = a ?? b;
  if (!답) { 남은것.push({ ...p, 왜: '근거 없음' }); continue; }
  채울것.push({
    id: p.id, itemId: p.itemId, partnerId: p.partnerId,
    name: byId.get(p.itemId)?.name ?? p.itemId,
    거래처: 거래처.get(p.partnerId) ?? p.partnerId,
    Direction: p.Direction, price: p.price,
    taxType: 답, 근거: a && b ? '단가+전표' : a ? '다른 거래처 단가' : '전표 이력',
  });
}

console.log(`채울 것 ${채울것.length}건 · 근거 없어 남기는 것 ${남은것.length}건\n`);
const 갈래: Record<string, number> = {};
for (const r of 채울것) { const k = `${r.근거} → ${r.taxType}`; 갈래[k] = (갈래[k] ?? 0) + 1; }
for (const [k, v] of Object.entries(갈래).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(28)} ${v}건`);

console.log('\n── 채울 것 (앞 20) ──');
for (const r of 채울것.slice(0, 20)) {
  console.log(`  ${String(r.거래처).slice(0, 14).padEnd(14)} ${String(r.name).slice(0, 28).padEnd(28)} ${r.Direction === 'in' ? '매입' : '매출'} ${String(r.price).padStart(8)} → ${r.taxType}  (${r.근거})`);
}

//  남은 것은 품목별로 묶어 사람이 한 번에 정하게 낸다
const 남은품목 = new Map<string, { name: string; 건수: number }>();
for (const p of 남은것) {
  const n = byId.get(p.itemId)?.name ?? p.itemId;
  const cur = 남은품목.get(p.itemId) ?? { name: n, 건수: 0 };
  cur.건수++;
  남은품목.set(p.itemId, cur);
}
console.log(`\n남은 것은 품목 ${남은품목.size}종 · 단가 ${남은것.length}건 — ${남은목록} 에 적는다.`);

if (!APPLY) {
  writeFileSync(남은목록, JSON.stringify({
    적은때: new Date().toISOString(),
    설명: '과세/면세를 정할 근거가 없는 거래처 단가 — 사람이 정해야 한다',
    품목: [...남은품목.entries()].map(([itemId, v]) => ({ itemId, name: v.name, 단가건수: v.건수 }))
      .sort((a, b) => b.단가건수 - a.단가건수),
  }, null, 2), 'utf8');
  console.log(`\n미리보기만 했다. 실제로 채우려면 --apply 를 붙여라.\n`);
  process.exit(0);
}
if (채울것.length === 0) { console.log('\n할 일 없음.\n'); process.exit(0); }
if (existsSync(BACKUP)) throw new Error(`기존 백업이 있다. 먼저 확인하라: ${BACKUP}`);

writeFileSync(BACKUP, JSON.stringify({
  적은때: new Date().toISOString(),
  설명: '거래처 단가의 빈 과세/면세를 채움 — 되돌리려면 아래 id 들의 taxType 을 지운다',
  채운것: 채울것.map(r => ({ id: r.id, name: r.name, 거래처: r.거래처, taxType: r.taxType, 근거: r.근거 })),
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
