// 이미 발행된 전표 줄에 **품목 id 를 채운다** — 이름이 꼭 맞는 것만.
//   기본 = --dry (미리보기).  적용 = --apply.
//   백업: scripts/fix-statement-itemid-backup.json  (전표별 `items` 배열 통째로)
//
// 왜 (2026-09-10 사장님) — "전에 발행된 전표에서 품목이름을 보고 id를 연결해놓으라고".
//
//   전표 줄에 `itemId` 가 없으면 그 줄이 **어느 품목인지 되짚을 수가 없다.** 원가가 틀어져도
//   무엇 때문인지 못 찾고, 거래처 단가·과세면세도 저장되지 않는다(`partnerPriceWrites` 가
//   id 없는 줄을 건너뛴다). 매출·매입 줄 656개 중 id 가 있는 건 **25개뿐**이었다.
//
// 어떻게 고르나 — **이름이 꼭 맞아야 한다.**
//   · **공백만 무시한다** — `시골향 참기름/골드A` 와 `시골향참기름/골드A` 는 같은 것이다.
//     그 밖의 글자는 하나도 안 봐준다(부분 일치·비슷한 것 없음).
//   · 같은 이름이 여럿이면 **전표의 회사**로 좁힌다. 그래도 여럿이면 **안 채운다.**
//   · **박스는 후보에서 뺀다** — 낱개와 이름이 같으면 엉뚱한 데 붙는다(해피유통 300ml 사고).
//   · 폐기(archived)된 품목도 뺀다.
//
//   비용 줄(상차비·택배비·카드대금…)은 품목이 아니라 안 맞는 게 정상이다. 그대로 둔다.
//
//   **거래처 단가는 안 건드린다.** 이 스크립트는 전표 줄에 id 만 적는다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, writeBatch } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const BACKUP = 'scripts/fix-statement-itemid-backup.json';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const [st, items, boms] = await Promise.all([load('issuedStatements'), load('items'), load('item_bom')]);

console.log(`\n═══ ${APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);

//  박스 판정 — BOM 에 완제품 하나 × 수량>1 (orderUnits.unpackComponent 와 같은 규칙)
const 자식 = new Map<string, { childId: string; qty: number }[]>();
for (const b of boms) {
  if (!b?.parent_id || !b?.child_id) continue;
  const a = 자식.get(b.parent_id) ?? [];
  a.push({ childId: b.child_id, qty: typeof b.quantity === 'number' ? b.quantity : 1 });
  자식.set(b.parent_id, a);
}
const byId = new Map(items.map((i: any) => [i.id, i]));
const 박스 = (p: any) => {
  const comps = (자식.get(p.id) ?? []).filter(l => {
    const c = byId.get(l.childId);
    return c && (c.type === 'product' || c.type === '완제품');
  });
  return comps.length === 1 && comps[0].qty > 1;
};

/** 공백만 지운다. 그 밖의 글자는 그대로 견준다. */
const 정규 = (n: string) => String(n ?? '').replace(/\s+/g, '');
const 회사of = (x: any) => x?.companyId ?? 'taebaek';

const 이름별 = new Map<string, any[]>();
for (const i of items) {
  if (i.archived || 박스(i)) continue;
  const k = 정규(i.name);
  if (!k) continue;
  if (!이름별.has(k)) 이름별.set(k, []);
  이름별.get(k)!.push(i);
}

type Plan = { 전표id: string; docNo: string; items: any[]; 채운줄: { name: string; itemId: string }[] };
const 계획: Plan[] = [];
let 이미있음 = 0, 채움 = 0, 여럿 = 0, 없음 = 0;
const 여럿목록 = new Map<string, number>();

for (const s of st) {
  if (s.type !== '매출' && s.type !== '매입') continue;
  const 회사 = 회사of(s);
  const 원본 = (s.items ?? []) as any[];
  const 새줄: any[] = [];
  const 채운줄: { name: string; itemId: string }[] = [];
  let 바뀜 = false;

  for (const l of 원본) {
    if (l.itemId) { 이미있음++; 새줄.push(l); continue; }
    let hit = 이름별.get(정규(l.name)) ?? [];
    if (hit.length > 1) {
      const 회사것 = hit.filter((x: any) => 회사of(x) === 회사);
      if (회사것.length === 1) hit = 회사것;
    }
    if (hit.length === 1) {
      채움++; 바뀜 = true;
      채운줄.push({ name: String(l.name), itemId: hit[0].id });
      새줄.push({ ...l, itemId: hit[0].id });
      continue;
    }
    if (hit.length > 1) { 여럿++; 여럿목록.set(String(l.name), (여럿목록.get(String(l.name)) ?? 0) + 1); }
    else 없음++;
    새줄.push(l);
  }
  if (바뀜) 계획.push({ 전표id: s.id, docNo: String(s.docNo ?? ''), items: 새줄, 채운줄 });
}

console.log(`매출·매입 전표 ${계획.length}건에서 줄 ${채움}개를 채운다`);
console.log(`  이미 id 있음 ${이미있음} · 같은 이름 여럿 ${여럿} · 품목 없음 ${없음}(대부분 비용 줄)`);

console.log('\n── 채우는 예시 (앞 15) ──');
let n = 0;
for (const p of 계획) {
  for (const c of p.채운줄) {
    if (n++ >= 15) break;
    console.log(`   ${p.docNo.padEnd(14)} ${c.name.slice(0, 32).padEnd(32)} → ${c.itemId}`);
  }
  if (n >= 15) break;
}
if (여럿목록.size) {
  console.log('\n⚠ 같은 이름이 여럿이라 안 채운 것');
  for (const [k, v] of [...여럿목록.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${k.slice(0, 34).padEnd(34)} ${v}줄`);
}

if (!APPLY) { console.log('\n미리보기만 했다. 실제로 채우려면 --apply 를 붙여라.\n'); process.exit(0); }
if (계획.length === 0) { console.log('\n할 일 없음.\n'); process.exit(0); }
if (existsSync(BACKUP)) throw new Error(`기존 백업이 있다. 먼저 확인하라: ${BACKUP}`);

//  되돌리려면 전표별 `items` 배열을 통째로 되쓴다 — 줄 안의 값이라 필드 단위로는 못 돌린다.
const 원본보관 = 계획.map(p => {
  const s = st.find((x: any) => x.id === p.전표id);
  return { 전표id: p.전표id, docNo: p.docNo, items: s?.items ?? [] };
});
writeFileSync(BACKUP, JSON.stringify({
  적은때: new Date().toISOString(),
  설명: '전표 줄에 itemId 를 채움 — 되돌리려면 각 전표의 items 배열을 통째로 되쓴다',
  전표: 원본보관,
}, null, 2), 'utf8');
console.log(`\n백업 → ${BACKUP}`);

for (let i = 0; i < 계획.length; i += 300) {
  const batch = writeBatch(db);
  for (const p of 계획.slice(i, i + 300)) batch.update(doc(db, 'issuedStatements', p.전표id), { items: p.items });
  await batch.commit();
  console.log(`  ${Math.min(i + 300, 계획.length)} / ${계획.length}`);
}
console.log(`\n✅ 전표 ${계획.length}건 · 줄 ${채움}개를 채웠다.\n`);
process.exit(0);
