// 시골향참기름/특A/1750ml 중복 품목 정리 — 파랑마개(p-203)를 빨강마개(p-25)로 합친다.
//   기본 = --dry (미리보기).  적용 = --apply.
//   백업: scripts/fix-teuka-merge-backup.json
//
// 왜 (2026-09-10 사장님, 품목관리 화면을 보며) —
//   "여기 유박사랑 대농은 특a 빨간마개 인걸로 옮기고 농가식품은 이미 있으니까 품목 삭제해버려
//    저건 안 쓰는 품목이다"
//
//   같은 이름 `시골향참기름/특A/1750ml` 이 둘이라 전표 줄이 어느 쪽인지 못 가렸다.
//     p-203  마개 **물엿캡-파랑** · 라벨 시골향참①  — 안 쓰는 품목
//     p-25   마개 **물엿캡-빨강** · 라벨 시골향참④  — 이쪽이 진짜
//
// 무엇을 하나
//   ① 전표 3줄의 품목을 p-203 → **p-25** 로 고친다(대농 2건·유박사 1건, 전부 21,000원).
//      그 3줄은 내가 이름만 보고 p-203 을 붙였던 것이다 — 사장님이 빨강이 맞다고 하셨다.
//   ② 거래처 단가를 옮긴다 — 유박사·대농의 21,000 을 p-25 쪽에 적는다(지금 비어 있다).
//      농가식품은 **p-25 에 이미 19,000 이 있어** 옮기지 않는다.
//   ③ p-203 과 그 박스 box-p-203-10 의 거래처 단가를 지운다.
//   ④ p-203 · box-p-203-10 을 **`archived: true`** 로 내린다.
//
// **왜 지우지 않고 archived 인가** — 이 저장소는 대체된 옛 품목을 그렇게 다룬다
//   (`Item.archived` = "통합 마이그레이션으로 대체된 구 품목"). 문서를 지워 버리면 옛 전표·주문이
//   가리키는 대상이 사라져 되짚을 수가 없다. 화면에서는 똑같이 안 보인다.
//   **박스는 재고가 1 남아 있다** — 그것도 같이 알린다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, writeBatch } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const BACKUP = 'scripts/fix-teuka-merge-backup.json';
const 옛것 = 'p-203', 옛박스 = 'box-p-203-10', 진짜 = 'p-25';
const 옮길거래처 = ['C013', 'C052'];   // 대농라이스푸드 · 유박사칼국수

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const [items, pi, st, partners] = await Promise.all([load('items'), load('partner_item'), load('issuedStatements'), load('partners')]);
const byId = new Map(items.map((i: any) => [i.id, i]));
const 거래처 = new Map(partners.map((p: any) => [p.id, p.name]));

console.log(`\n═══ ${APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);
for (const id of [옛것, 옛박스, 진짜]) if (!byId.get(id)) throw new Error(`품목이 없다: ${id}`);

//  ① 전표 줄 고치기
const 전표계획: { id: string; docNo: string; items: any[]; 줄: string[] }[] = [];
for (const s of st) {
  const 원본 = (s.items ?? []) as any[];
  if (!원본.some(l => l.itemId === 옛것 || l.itemId === 옛박스)) continue;
  const 줄: string[] = [];
  const 새 = 원본.map(l => {
    if (l.itemId !== 옛것 && l.itemId !== 옛박스) return l;
    줄.push(`${String(s.partnerName).slice(0, 14).padEnd(14)} ${String(l.name).slice(0, 26).padEnd(26)} 수량 ${String(l.qty).padStart(5)} 단가 ${String(l.price).padStart(8)}  ${l.itemId} → ${진짜}`);
    return { ...l, itemId: 진짜 };
  });
  전표계획.push({ id: s.id, docNo: String(s.docNo ?? ''), items: 새, 줄 });
}
console.log(`① 전표 ${전표계획.length}건의 줄을 ${진짜} 로 고친다`);
for (const p of 전표계획) for (const l of p.줄) console.log(`   ${p.docNo.padEnd(13)} ${l}`);

//  ② 거래처 단가 옮기기 — 옛것에 있는 값을 진짜 쪽에 적는다(진짜가 비어 있을 때만)
const 단가옮김: { id: string; 거래처: string; price: number; taxType?: string }[] = [];
for (const cid of 옮길거래처) {
  const 옛 = pi.find((p: any) => p.itemId === 옛것 && p.partnerId === cid && (p.Direction ?? 'out') === 'out');
  const 새 = pi.find((p: any) => p.itemId === 진짜 && p.partnerId === cid && (p.Direction ?? 'out') === 'out');
  if (!옛 || !(Number(옛.price ?? 0) > 0)) continue;
  if (새 && Number(새.price ?? 0) > 0) { console.log(`   (건너뜀) ${거래처.get(cid)} — ${진짜} 에 이미 ${새.price} 가 있다`); continue; }
  const 대상 = 새 ?? { id: `${진짜}_${cid}_out` };
  단가옮김.push({ id: 대상.id, 거래처: String(거래처.get(cid) ?? cid), price: Number(옛.price), taxType: 옛.taxType });
}
console.log(`\n② 거래처 단가 ${단가옮김.length}건을 ${진짜} 로 옮긴다`);
for (const m of 단가옮김) console.log(`   ${m.거래처.padEnd(16)} ${m.price} ${m.taxType ?? ''}  → ${m.id}`);

//  ③ 옛 품목·박스의 거래처 단가 지우기
const 지울단가 = pi.filter((p: any) => p.itemId === 옛것 || p.itemId === 옛박스);
console.log(`\n③ 옛 품목의 거래처 단가 ${지울단가.length}건을 지운다`);
for (const p of 지울단가) console.log(`   ${String(거래처.get(p.partnerId) ?? p.partnerId).padEnd(16)} ${String(byId.get(p.itemId)?.name ?? '').slice(0, 26).padEnd(26)} ${p.price ?? '-'}  (${p.id})`);

//  ④ 내리기
const 박스재고 = Number(byId.get(옛박스)?.stock ?? 0);
console.log(`\n④ ${옛것} · ${옛박스} 를 archived 로 내린다`);
if (박스재고 !== 0) console.log(`   ⚠ ${옛박스} 에 재고가 ${박스재고} 남아 있다 — 내려도 숫자는 그대로 남는다. 실물을 확인하라.`);

if (!APPLY) { console.log('\n미리보기만 했다. 실제로 바꾸려면 --apply 를 붙여라.\n'); process.exit(0); }
if (existsSync(BACKUP)) throw new Error(`기존 백업이 있다: ${BACKUP}`);

writeFileSync(BACKUP, JSON.stringify({
  적은때: new Date().toISOString(),
  설명: '특A 파랑마개(p-203)를 빨강마개(p-25)로 합침 — 되돌리려면 아래를 그대로 되쓴다',
  전표: 전표계획.map(p => ({ id: p.id, docNo: p.docNo, items: st.find((x: any) => x.id === p.id)?.items ?? [] })),
  지운단가: 지울단가,
  옮긴단가: 단가옮김,
  내린품목: [옛것, 옛박스].map(id => ({ id, archived: byId.get(id)?.archived ?? false })),
}, null, 2), 'utf8');
console.log(`\n백업 → ${BACKUP}`);

const batch = writeBatch(db);
for (const p of 전표계획) batch.update(doc(db, 'issuedStatements', p.id), { items: p.items });
for (const m of 단가옮김) batch.set(doc(db, 'partner_item', m.id), {
  id: m.id, itemId: 진짜, partnerId: m.id.split('_')[1], Direction: 'out',
  price: m.price, ...(m.taxType ? { taxType: m.taxType } : {}),
}, { merge: true });
for (const p of 지울단가) batch.delete(doc(db, 'partner_item', p.id));
for (const id of [옛것, 옛박스]) batch.update(doc(db, 'items', id), { archived: true });
await batch.commit();
console.log('\n✅ 합쳤다.\n');
process.exit(0);
