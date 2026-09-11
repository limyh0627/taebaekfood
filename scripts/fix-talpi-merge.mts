// 탈피들깨가루/1kg 정리 — 실링비닐 것을 시골향으로 합치고, 해피유통 것에서 대왕푸드를 뗀다.
//   기본 = --dry (미리보기).  적용 = --apply.
//   백업: scripts/fix-talpi-merge-backup.json
//
// 왜 (2026-09-10 사장님) —
//   "탈피는 해피유통 비닐 쓰는거에 대왕 잘못들어갔고
//    탈피들깨가루 1kg는 시골향탈피들깨가루 1kg로 합쳐 거기 거래처"
//
//   같은 이름 `탈피들깨가루/1kg` 이 둘이라 전표 줄이 어느 쪽인지 못 가렸다. 실제로는 셋이다 —
//     p-104               **시골향탈피들깨가루/1kg** · 비닐 `1KG-탈피들깨가루` — 거래처 29·전표 18. **주력**
//     p-1774849779025     탈피들깨가루/1kg · 비닐 **`1KG-탈피들깨가루(해피유통)`** — 해피유통 전용
//     p-1774415984653     탈피들깨가루/1kg · 비닐 `1KG-실링` — 거래처 3·전표 0
//
// 무엇을 하나
//   ① 해피유통 전용(p-1774849779025)에서 **대왕푸드 연결을 뗀다** — 잘못 들어간 것이다.
//      그 품목 자체는 남긴다(해피유통 포천·쿠팡·고창유통이 쓰고 전표도 1건 있다).
//   ② 실링비닐(p-1774415984653)을 **p-104 로 합친다** — 거래처 연결을 옮기고 archived 로 내린다.
//   ③ 아직 품목이 안 붙은 대왕푸드 전표 줄(`탈피들깨가루/1kg`)을 **p-104** 로 잇는다.
//
//   **지우지 않고 archived 로 내린다** — 이 저장소가 대체된 옛 품목을 다루는 방식이다
//   (`Item.archived`). 화면에서는 똑같이 안 보이고, 옛 기록이 가리키는 대상은 남는다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, writeBatch } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const BACKUP = 'scripts/fix-talpi-merge-backup.json';
const 주력 = 'p-104';                       // 시골향탈피들깨가루/1kg
const 합칠것 = 'p-1774415984653';           // 실링비닐
const 해피 = 'p-1774849779025';             // 해피유통 전용 비닐
//  해피유통 전용 비닐 품목에서 떼어 낼 거래처 — 잘못 들어간 것들(2026-09-10 사장님).
//  뗀 뒤 그 거래처의 탈피들깨가루는 주력(p-104)으로 간다.
const 뗄거래처 = ['대왕푸드', '고창유통'];

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const [items, pi, st, partners] = await Promise.all([load('items'), load('partner_item'), load('issuedStatements'), load('partners')]);
const byId = new Map(items.map((i: any) => [i.id, i]));
const 이름of = new Map(partners.map((p: any) => [p.id, String(p.name ?? '')]));

console.log(`\n═══ ${APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);
for (const id of [주력, 합칠것, 해피]) if (!byId.get(id)) throw new Error(`품목이 없다: ${id}`);

//  ① 해피유통 전용에서 대왕푸드 떼기
const 뗄것 = pi.filter((p: any) => p.itemId === 해피 && 뗄거래처.some(n => 이름of.get(p.partnerId)?.includes(n)));
console.log(`① 해피유통 전용(${해피})에서 ${뗄거래처.join('·')} 연결 ${뗄것.length}건을 뗀다`);
for (const p of 뗄것) console.log(`   ${이름of.get(p.partnerId)} 단가=${p.price ?? '-'}  (${p.id})`);

//  ② 실링비닐 → 주력으로 거래처 옮기기
const 옮김: { 새id: string; partnerId: string; 거래처: string; price?: number; taxType?: string; 옛id: string }[] = [];
const 그냥지움: any[] = [];
for (const p of pi.filter((x: any) => x.itemId === 합칠것)) {
  const 이미 = pi.find((x: any) => x.itemId === 주력 && x.partnerId === p.partnerId && (x.Direction ?? 'out') === (p.Direction ?? 'out'));
  if (이미) { 그냥지움.push(p); continue; }
  옮김.push({
    새id: `${주력}_${p.partnerId}_${p.Direction ?? 'out'}`,
    partnerId: p.partnerId, 거래처: String(이름of.get(p.partnerId) ?? p.partnerId),
    price: p.price, taxType: p.taxType, 옛id: p.id,
  });
}
console.log(`\n② 실링비닐(${합칠것}) 거래처 ${옮김.length}건을 ${주력} 로 옮긴다 (이미 있어 그냥 지우는 것 ${그냥지움.length}건)`);
for (const m of 옮김) console.log(`   ${m.거래처.padEnd(14)} 단가=${m.price ?? '-'} ${m.taxType ?? ''} → ${m.새id}`);
for (const p of 그냥지움) console.log(`   (이미 있음) ${이름of.get(p.partnerId)} — ${p.id} 만 지운다`);

//  ③ 아직 안 붙은 대왕푸드 전표 줄 잇기
const 전표계획: { id: string; docNo: string; items: any[]; 줄: string[] }[] = [];
for (const s of st) {
  const 원본 = (s.items ?? []) as any[];
  const 줄: string[] = [];
  const 새 = 원본.map(l => {
    const 이름 = String(l.name ?? '').replace(/\s+/g, '');
    const 대상 = !l.itemId && 이름 === '탈피들깨가루/1kg';
    const 옛것가리킴 = l.itemId === 합칠것;
    if (!대상 && !옛것가리킴) return l;
    줄.push(`${String(s.partnerName).slice(0, 14).padEnd(14)} ${String(l.name).slice(0, 24).padEnd(24)} 수량 ${String(l.qty).padStart(5)} 단가 ${String(l.price).padStart(8)}  ${l.itemId ?? '(빈칸)'} → ${주력}`);
    return { ...l, itemId: 주력 };
  });
  if (줄.length) 전표계획.push({ id: s.id, docNo: String(s.docNo ?? ''), items: 새, 줄 });
}
console.log(`\n③ 전표 ${전표계획.length}건의 줄을 ${주력} 로 잇는다`);
for (const p of 전표계획) for (const l of p.줄) console.log(`   ${p.docNo.padEnd(13)} ${l}`);

console.log(`\n④ ${합칠것} 를 archived 로 내린다 (재고 ${byId.get(합칠것)?.stock ?? 0})`);

if (!APPLY) { console.log('\n미리보기만 했다. 실제로 바꾸려면 --apply 를 붙여라.\n'); process.exit(0); }
if (existsSync(BACKUP)) throw new Error(`기존 백업이 있다: ${BACKUP}`);

writeFileSync(BACKUP, JSON.stringify({
  적은때: new Date().toISOString(),
  설명: '탈피들깨가루 정리 — 되돌리려면 아래를 그대로 되쓴다',
  뗀연결: 뗄것, 옮긴연결: 옮김, 지운연결: 그냥지움,
  전표: 전표계획.map(p => ({ id: p.id, docNo: p.docNo, items: st.find((x: any) => x.id === p.id)?.items ?? [] })),
  내린품목: [{ id: 합칠것, archived: byId.get(합칠것)?.archived ?? false }],
}, null, 2), 'utf8');
console.log(`\n백업 → ${BACKUP}`);

const batch = writeBatch(db);
for (const p of 뗄것) batch.delete(doc(db, 'partner_item', p.id));
for (const m of 옮김) {
  batch.set(doc(db, 'partner_item', m.새id), {
    id: m.새id, itemId: 주력, partnerId: m.partnerId, Direction: 'out',
    ...(m.price != null ? { price: m.price } : {}), ...(m.taxType ? { taxType: m.taxType } : {}),
  }, { merge: true });
  batch.delete(doc(db, 'partner_item', m.옛id));
}
for (const p of 그냥지움) batch.delete(doc(db, 'partner_item', p.id));
for (const p of 전표계획) batch.update(doc(db, 'issuedStatements', p.id), { items: p.items });
batch.update(doc(db, 'items', 합칠것), { archived: true });
await batch.commit();
console.log('\n✅ 정리했다.\n');
process.exit(0);
