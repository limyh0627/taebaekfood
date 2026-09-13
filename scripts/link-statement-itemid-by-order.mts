// 전표 줄의 **품목 id 를 주문에서 가져온다.** 이름으로 더듬지 않는다.
//   기본 = --dry (미리보기).  적용 = --apply.  되돌리기 = --undo (백업대로 복구).
//   백업: scripts/link-statement-itemid-by-order-backup.json  (전표별 `items` 배열 통째로)
//
// 왜 (2026-09-13 사장님) — "ID로 찾는거 아니야?"
//
//   맞다. 먼저 있던 [fix-statement-itemid.mts](fix-statement-itemid.mts) 는 **이름**으로 품목을
//   찾는다. 옛 전표 줄에 id 가 아예 없어서 그렇게 시작했는데, 이름이 같은 품목이 여럿이면
//   (`시골향참기름/A/1750ml` 은 p-106·p-116 둘이다) 거기서 멈춘다. 남은 8줄이 그렇다.
//
//   그런데 전표는 **주문에서 나온다.** 전표 문서에 `orderId` 가 있고(쉼표로 여럿), 주문 줄에는
//   품목 id 가 박혀 있다. 이름을 볼 이유가 없다 — **id → id 로 잇는다.**
//
//   실제로 이름으로 골랐으면 **틀릴 뻔했다**: 일성상회 260805-10 `시골향 참기름/특A/1750ml` 은
//   이름 후보가 p-25 하나였는데, 그 전표에 묶인 주문이 가리키는 것은 `box-p-203-10`(→ p-203)이다.
//
//   **이름이 같아도 다른 물건이다**(2026-09-13 사장님: "bom이 다른거 아니야? 이름은 같은데?").
//   p-25 는 물엿캡-빨강·시골향참④ 라벨, p-203 은 물엿캡-파랑·시골향참① 라벨이다.
//   p-106/p-116 은 캡이 빨강/노랑, p-121/p-1777096833351 은 페트병이 빨강n/노랑n 이다.
//   **이름으로는 영영 못 가른다** — 그러니 이름으로 잇는 것 자체가 답이 아니다. 주문이 안다.
//
// 어떻게 잇나
//   ① 전표의 `orderId` 를 쉼표로 끊어 주문을 찾는다.
//   ② 주문 줄의 품목을 **낱개로 푼다** — 전표는 언제나 낱개 기준이다(박스 품목이면 BOM 의
//      낱개 자식으로 바꾼다). 앱이 쓰는 규칙과 같다(`statementLines.resolveOrderItem`).
//   ③ 그렇게 나온 **후보 안에서만** 전표 줄과 맞춘다. 맞추는 열쇠는 이름이지만 **후보가
//      그 주문의 것뿐이라** 엉뚱한 품목이 끼어들 수 없다. 공백만 무시하고 글자는 그대로 본다.
//   ④ 후보가 하나로 안 좁혀지면 **안 채운다.** 모르는 것은 모르는 채로 둔다.
//
//   비용 줄(택배비·카드대금…)은 주문에서 온 것이 아니라 후보가 없다 — 그대로 둔다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, writeBatch } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/link-statement-itemid-by-order-backup.json';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));

//  **되돌리기** — 백업에 적힌 `items` 배열을 그대로 도로 넣는다. 다른 건 안 건드린다.
if (UNDO) {
  if (!existsSync(BACKUP)) { console.error(`\n백업이 없다(${BACKUP}). 되돌릴 것이 없다.\n`); process.exit(1); }
  const 백업본: Record<string, any> = JSON.parse(readFileSync(BACKUP, 'utf-8'));
  const 되돌림 = writeBatch(db);
  for (const [sid, 줄들] of Object.entries(백업본)) 되돌림.update(doc(db, 'issuedStatements', sid), { items: 줄들 });
  await 되돌림.commit();
  console.log(`\n전표 ${Object.keys(백업본).length}건을 백업 상태로 되돌렸다. 백업 파일은 그대로 둔다.\n`);
  process.exit(0);
}

const [st, orders, items, boms] = await Promise.all(
  [load('issuedStatements'), load('orders'), load('items'), load('item_bom')]);

console.log(`\n═══ ${APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);

const byId = new Map(items.map((i: any) => [i.id, i]));
const 자식 = new Map<string, { childId: string; qty: number }[]>();
for (const b of boms) {
  if (!b?.parent_id || !b?.child_id) continue;
  const a = 자식.get(b.parent_id) ?? [];
  a.push({ childId: b.child_id, qty: typeof b.quantity === 'number' ? b.quantity : 1 });
  자식.set(b.parent_id, a);
}

/** 공백만 지우고 본다 — `시골향 참기름/특A` 와 `시골향참기름/특A` 는 같은 것이다. */
const 글자 = (v: unknown) => String(v ?? '').replace(/\s+/g, '');

/** 박스 품목이면 **낱개 자식**으로 바꾼다. 전표는 낱개 기준이다. */
const 낱개로 = (itemId?: string) => {
  const p = itemId ? byId.get(itemId) : undefined;
  if (!p) return undefined;
  const 자식들 = (자식.get(p.id) ?? [])
    .map(l => byId.get(l.childId))
    .filter((c: any) => c && (c.type === 'product' || c.type === 'wip' || c.type === '완제품'));
  //  박스는 낱개 완제품 하나를 여러 개 담는다. 자식 완제품이 딱 하나면 그것이 낱개다.
  return 자식들.length === 1 ? 자식들[0] : p;
};

type 고침 = { docNo: string; 전표: string; 거래처: string; 줄: number; 이름: string; itemId: string; 주문: string };
const 고칠것: 고침[] = [];
const 못한것: { docNo: string; 이름: string; 까닭: string }[] = [];
const 백업: Record<string, any> = {};

for (const s of st) {
  const 줄들 = Array.isArray(s.items) ? s.items : [];
  const 빈줄 = 줄들.map((l: any, i: number) => ({ l, i })).filter(({ l }: any) => !l.itemId);
  if (!빈줄.length) continue;

  //  전표가 들고 있는 주문 — 쉼표로 여럿일 수 있다
  const 주문ids = String(s.orderId ?? '').split(',').map(v => v.trim()).filter(Boolean);
  if (!주문ids.length) { for (const { l } of 빈줄) 못한것.push({ docNo: s.docNo ?? s.id, 이름: l.name, 까닭: '주문 연결 없음(손입력·비용 줄)' }); continue; }

  //  주문 줄 → 낱개 품목 후보
  const 후보: { id: string; name: string; 출처: string }[] = [];
  for (const oid of 주문ids) {
    const o = orders.find((x: any) => x.id === oid);
    if (!o) continue;
    for (const it of o.items ?? []) {
      const 낱 = 낱개로(it.itemId);
      if (낱 && !후보.some(c => c.id === 낱.id)) 후보.push({ id: 낱.id, name: 낱.name, 출처: oid });
    }
  }
  if (!후보.length) { for (const { l } of 빈줄) 못한것.push({ docNo: s.docNo ?? s.id, 이름: l.name, 까닭: `주문(${주문ids.join(',')})을 못 찾음` }); continue; }

  for (const { l, i } of 빈줄) {
    const 맞는것 = 후보.filter(c => 글자(c.name) === 글자(l.name));
    if (맞는것.length !== 1) {
      못한것.push({ docNo: s.docNo ?? s.id, 이름: l.name, 까닭: 맞는것.length ? `주문 후보 ${맞는것.length}개` : '주문에 같은 이름 없음' });
      continue;
    }
    고칠것.push({ docNo: s.docNo ?? s.id, 전표: s.id, 거래처: s.partnerName ?? s.partnerId, 줄: i, 이름: l.name, itemId: 맞는것[0].id, 주문: 맞는것[0].출처 });
    백업[s.id] = 줄들;
  }
}

console.log(`이을 수 있는 줄 ${고칠것.length}개\n`);
for (const f of 고칠것) console.log(`  ${f.docNo}  ${f.거래처}  «${f.이름}»  → ${f.itemId}  (${byId.get(f.itemId)?.name ?? '?'})  ← ${f.주문}`);

const 갈래 = new Map<string, number>();
for (const m of 못한것) 갈래.set(m.까닭.replace(/\(.*\)/, '(…)'), (갈래.get(m.까닭.replace(/\(.*\)/, '(…)')) ?? 0) + 1);
console.log(`\n못 이은 줄 ${못한것.length}개`);
for (const [k, v] of [...갈래].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);
console.log('\n  ↳ 주문 연결이 없는 줄은 비용·손입력 줄이다. 품목이 없는 게 정상이다.');

if (!APPLY) { console.log('\n미리보기였다. 실제로 적용하려면 --apply 를 붙인다.\n'); process.exit(0); }

if (existsSync(BACKUP)) { console.error(`\n백업 파일이 이미 있다(${BACKUP}). 덮어쓰지 않는다 — 옮기거나 지우고 다시 실행한다.\n`); process.exit(1); }
writeFileSync(BACKUP, JSON.stringify(백업, null, 1), 'utf-8');
console.log(`\n백업 ${Object.keys(백업).length}건 → ${BACKUP}`);

//  전표별로 모아서 한 번에 쓴다
const 전표별 = new Map<string, 고침[]>();
for (const f of 고칠것) 전표별.set(f.전표, [...(전표별.get(f.전표) ?? []), f]);
let batch = writeBatch(db); let n = 0;
for (const [sid, fs] of 전표별) {
  const s = st.find((x: any) => x.id === sid);
  const 새줄 = (s.items as any[]).map((l, i) => {
    const f = fs.find(x => x.줄 === i);
    return f ? { ...l, itemId: f.itemId, lineKind: 'item' } : l;
  });
  batch.update(doc(db, 'issuedStatements', sid), { items: 새줄 });
  if (++n % 400 === 0) { await batch.commit(); batch = writeBatch(db); }
}
await batch.commit();
console.log(`전표 ${전표별.size}건 · 줄 ${고칠것.length}개에 품목 id 를 적었다.\n`);
process.exit(0);
