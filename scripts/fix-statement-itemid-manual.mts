// 사장님이 직접 짚어 준 매핑으로 전표 줄에 **품목 id** 를 채운다.
//   기본 = --dry (미리보기).  적용 = --apply.
//   백업: scripts/fix-statement-itemid-manual-backup.json (전표별 `items` 배열 통째로)
//
// 왜 — 이름 매칭으로는 못 잡는 것들이다. 이름이 바뀌었거나(흰정사각), 부르는 말이 다르거나
//   (생참깨=참깨, 청양 참기름=깨분참기름), 아예 다른 표기다(5-2박스). **사람만 아는 것**이라
//   사장님이 짚어 준 그대로만 적용한다. 코드가 추측하지 않는다.
//
//   2026-09-10 사장님:
//     "해달 5-2호 박스 / 볶음참깨는 그냥 벌크고 수량이 20 단가는 114000%20 122000%20 이고 /
//      생참깨는 참깨고 / 청양 참기름은 깨분참기름"
//
// **수량·단가는 안 건드린다.** 볶음참깨 벌크 줄의 `20kg 환산`은 전표 금액을 다시 쓰는 일이라
//   따로 확인받고 한다. 여기서는 품목 id 만 잇는다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, writeBatch } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const BACKUP = 'scripts/fix-statement-itemid-manual-backup.json';

/** 전표 줄 이름 → 품목 id. 회사가 갈리는 것은 `회사별` 로 적는다. */
const 매핑: { 이름: string; itemId?: string; 회사별?: Record<string, string>; 메모: string }[] = [
  { 이름: '5-2박스', itemId: 'B-05-2', 메모: '해달 — 5-2호박스' },
  { 이름: '박스', itemId: 'B-05-2', 메모: '해달 — 5-2호박스(같은 단가 800)' },
  { 이름: '볶음참깨(벌크)/20kg', itemId: 'raw-볶음참깨', 메모: '벌크 홀더' },
  { 이름: '시골향 볶음검정참(벌크)/20kg', itemId: 'raw-볶음검정참깨', 메모: '벌크 홀더' },
  {
    이름: '생참깨', 메모: '참깨 — 전표의 회사로 가른다',
    회사별: { taebaek: 'p-1779251176421', punghoe: 'p-1779251176421-punghoe' },
  },
  { 이름: '참깨(기타 페루)', 회사별: { taebaek: 'p-1779251176421', punghoe: 'p-1779251176421-punghoe' }, 메모: '참깨' },
  { 이름: '참기름', itemId: 'p-1779251603644', 메모: '청양식품 매입 — 깨분참기름/16.5kg(캔)' },
];

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const [st, items] = await Promise.all([load('issuedStatements'), load('items')]);
const byId = new Map(items.map((i: any) => [i.id, i]));

console.log(`\n═══ ${APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);

//  적어 둔 id 가 진짜 있는지 먼저 본다 — 없는 id 를 박으면 나중에 더 못 찾는다.
for (const m of 매핑) {
  for (const id of [m.itemId, ...Object.values(m.회사별 ?? {})].filter(Boolean) as string[]) {
    const it = byId.get(id);
    if (!it) throw new Error(`매핑에 적힌 품목이 없다: ${id} (${m.이름})`);
    if (it.archived) throw new Error(`폐기된 품목이다: ${id} ${it.name}`);
  }
}

const 정규 = (n: string) => String(n ?? '').replace(/\s+/g, '');
const 회사of = (x: any) => x?.companyId ?? 'taebaek';
const 찾기 = (name: string) => 매핑.find(m => 정규(m.이름) === 정규(name));

type Plan = { 전표id: string; docNo: string; items: any[]; 채운줄: string[] };
const 계획: Plan[] = [];
let 채움 = 0;

for (const s of st) {
  if (s.type !== '매출' && s.type !== '매입') continue;
  const 회사 = 회사of(s);
  const 새줄: any[] = [];
  const 채운줄: string[] = [];
  let 바뀜 = false;
  for (const l of (s.items ?? [])) {
    if (l.itemId) { 새줄.push(l); continue; }
    const m = 찾기(String(l.name));
    const id = m?.itemId ?? m?.회사별?.[회사];
    if (!m || !id) { 새줄.push(l); continue; }
    채움++; 바뀜 = true;
    채운줄.push(`${String(l.name).slice(0, 28).padEnd(28)} ${String(s.partnerName).slice(0, 12).padEnd(12)} 수량 ${String(l.qty).padStart(6)} 단가 ${String(l.price).padStart(9)} → ${id}  (${m.메모})`);
    새줄.push({ ...l, itemId: id });
  }
  if (바뀜) 계획.push({ 전표id: s.id, docNo: String(s.docNo ?? ''), items: 새줄, 채운줄 });
}

console.log(`전표 ${계획.length}건 · 줄 ${채움}개를 채운다\n`);
for (const p of 계획) {
  for (const c of p.채운줄) console.log(`   ${String(p.docNo).padEnd(14)} ${c}`);
}

if (!APPLY) { console.log('\n미리보기만 했다. 실제로 채우려면 --apply 를 붙여라.\n'); process.exit(0); }
if (계획.length === 0) { console.log('\n할 일 없음.\n'); process.exit(0); }
if (existsSync(BACKUP)) throw new Error(`기존 백업이 있다. 먼저 확인하라: ${BACKUP}`);

writeFileSync(BACKUP, JSON.stringify({
  적은때: new Date().toISOString(),
  설명: '사장님이 짚어 준 매핑으로 전표 줄에 itemId 를 채움 — 되돌리려면 items 배열을 통째로 되쓴다',
  전표: 계획.map(p => ({ 전표id: p.전표id, docNo: p.docNo, items: st.find((x: any) => x.id === p.전표id)?.items ?? [] })),
}, null, 2), 'utf8');
console.log(`\n백업 → ${BACKUP}`);

const batch = writeBatch(db);
for (const p of 계획) batch.update(doc(db, 'issuedStatements', p.전표id), { items: p.items });
await batch.commit();
console.log(`\n✅ 전표 ${계획.length}건 · 줄 ${채움}개를 채웠다.\n`);
process.exit(0);
