// 박스 품목의 거래처 단가를 **낱개 단가 × 입수** 로 맞춘다.
//   기본 = --dry (미리보기).  적용 = --apply.
//   백업: scripts/fix-box-partner-price-backup.json
//
// 왜 (2026-09-10 사장님) — 품목단가 화면에서 `들깨가루(중간)/거산 20개입` 이
//   **원가 125,220 · 공급가 6,818 · 마진 −1737%** 로 떴다.
//
//   박스 품목의 원가는 BOM 에서 나온다 — 낱개 6,191 × 20 = 125,220 (맞다).
//   그런데 그 박스의 거래처 단가에는 **한 병 값 7,500** 이 적혀 있었다. 20병 원가와
//   1병 판매가를 견주니 −1737% 가 된다. 숫자가 이상한 게 아니라 **단가가 틀린 것**이다.
//
// 근거 — 규칙은 이미 앱 안에 있다.
//   `orderUnits.boxDerivedUnitPrice()` = `낱개단가 × 입수`. 주문 화면은 이걸 쓴다.
//   저장된 박스 row 를 쓰는 건 품목단가·견적·전표 쪽이라, 같은 박스가 화면마다
//   다른 값으로 보였다. **저장된 값을 앱의 규칙에 맞춘다.**
//
//   박스 줄에 적힌 값이 낱개 값과 다른 데가 있다(대성농산 골드/1800 — 낱개 22,000, 박스 19,500).
//   **사장님 말씀: 박스 할인가 같은 건 없다.** 그러니 적힌 값이 아니라 **낱개 값을 곱한다.**
//
// 무엇을 하나 — 박스 품목(BOM 에 완제품 하나 × 수량>1)의 판매 단가를
//   ① 같은 거래처 **낱개 단가가 있으면** → `낱개 × 입수`. 이미 그 값이면 그냥 넘어간다.
//   ② 낱개 단가가 **없으면** → 곱할 낱개 값이 없으니 적힌 값을 한 병 값으로 보고 `적힌값 × 입수`.
//      단, **그 박스 원가의 절반이 넘는 값은 이미 박스값**이라 안 건드린다.
//   ③ 낱개 단가가 **낱개 원가의 절반도 안 되면** — 낱개 쪽이 되레 1/입수 로 들어간 것이다.
//      그걸 곱해 봐야 여전히 틀린 값이라 **안 건드리고 목록만 낸다.**
//
//   **과세/면세는 안 건드린다** — 거래처마다 다르고 사장님이 직접 봐야 한다(2026-09-10).
//   대신 박스와 낱개가 어긋난 것만 끝에 알린다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, writeBatch } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const BACKUP = 'scripts/fix-box-partner-price-backup.json';
const CSV = 'scripts/박스단가-고칠목록.csv';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const [items, pi, boms, partners] = await Promise.all(
  [load('items'), load('partner_item'), load('item_bom'), load('partners')]);

const byId = new Map(items.map((i: any) => [i.id, i]));
const 이름of = new Map(partners.map((p: any) => [p.id, String(p.name ?? '')]));

//  박스 판정 — orderUnits.unpackComponent 와 같은 근거(완제품 자식 하나 × 수량>1)
const 자식 = new Map<string, { childId: string; qty: number }[]>();
for (const b of boms) {
  if (!b?.parent_id || !b?.child_id) continue;
  const a = 자식.get(b.parent_id) ?? [];
  a.push({ childId: b.child_id, qty: typeof b.quantity === 'number' ? b.quantity : 1 });
  자식.set(b.parent_id, a);
}
const 낱개of = (p: any) => {
  const c = (자식.get(p.id) ?? []).filter(l => {
    const x = byId.get(l.childId);
    return x && (x.type === 'product' || x.type === '완제품');
  });
  return c.length === 1 && c[0].qty > 1 ? c[0] : null;
};
const 판매 = (p: any) => (p.Direction ?? 'out') !== 'in';

console.log(`\n═══ ${APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);

type 고칠것 = { id: string; 거래처: string; 박스명: string; 입수: number; 옛값: number; 새값: number; 원가: number; 근거: string };
const 고침: 고칠것[] = [];
const 그대로: 고칠것[] = [];
const 낱개가1할: string[] = [];
const 세금어긋남: string[] = [];

for (const it of items) {
  if (it.archived) continue;
  const 낱 = 낱개of(it);
  if (!낱) continue;
  const 박스원가 = Number(it.cost ?? NaN);
  const 낱원가 = Number(byId.get(낱.childId)?.cost ?? NaN);

  for (const p of pi.filter((x: any) => x.itemId === it.id && 판매(x))) {
    const 낱row = pi.find((x: any) => x.itemId === 낱.childId && x.partnerId === p.partnerId && 판매(x));
    const 줄 = `${String(이름of.get(p.partnerId) ?? p.partnerId).slice(0, 14).padEnd(14)} ${String(it.name).slice(0, 28).padEnd(28)} ${String(낱.qty).padStart(3)}개입`;

    //  과세/면세가 박스와 낱개에서 갈린 것 — 고치진 않고 알리기만 한다.
    if (낱row && p.taxType && 낱row.taxType && p.taxType !== 낱row.taxType) {
      세금어긋남.push(`${줄}  박스 ${p.taxType} ↔ 낱개 ${낱row.taxType}`);
    }

    const 옛 = Number(p.price ?? NaN);
    if (!(옛 > 0)) continue;                                   // 값이 없으면 셀 것도 없다
    const 낱값 = Number(낱row?.price ?? NaN);

    let 새 = NaN, 근거 = '';
    if (낱값 > 0) {
      //  ③ 낱개 쪽이 1/입수 로 들어간 것 — 곱해 봐야 여전히 틀리다. 손대지 않는다.
      if (낱원가 > 0 && 낱값 < 낱원가 / 2) {
        낱개가1할.push(`${줄}  낱개단가 ${String(낱값).padStart(7)} (낱개원가 ${낱원가}) · 박스단가 ${옛}  → 낱개가 ${옛} 이어야 맞아 보인다  (${낱row!.id})`);
        continue;
      }
      새 = 낱값 * 낱.qty;                                       // ① 낱개 × 입수
      근거 = `낱개 ${낱값} × ${낱.qty}`;
    } else {
      //  ② 곱할 낱개 값이 없다. 적힌 값이 박스 원가의 절반이 넘으면 이미 박스값이다.
      if (!(박스원가 > 0) || 옛 >= 박스원가 / 2) {
        그대로.push({ id: p.id, 거래처: String(이름of.get(p.partnerId) ?? p.partnerId), 박스명: String(it.name), 입수: 낱.qty, 옛값: 옛, 새값: 옛, 원가: 박스원가 > 0 ? 박스원가 : 0, 근거: '낱개단가 없음 · 이미 박스값으로 보인다' });
        continue;
      }
      새 = 옛 * 낱.qty;
      근거 = `낱개단가 없음 · 적힌값 ${옛} × ${낱.qty}`;
    }

    const 한줄: 고칠것 = {
      id: p.id, 거래처: String(이름of.get(p.partnerId) ?? p.partnerId),
      박스명: String(it.name), 입수: 낱.qty, 옛값: 옛, 새값: Math.round(새),
      원가: 박스원가 > 0 ? 박스원가 : 0, 근거,
    };
    if (Math.abs(옛 - 한줄.새값) < 1) 그대로.push({ ...한줄, 근거: '이미 맞다' });
    else 고침.push(한줄);
  }
}

const 정렬 = (a: 고칠것, b: 고칠것) => a.거래처.localeCompare(b.거래처) || a.박스명.localeCompare(b.박스명);
고침.sort(정렬); 그대로.sort(정렬);

console.log(`① 박스 단가 ${고침.length}건을 고친다\n`);
for (const m of 고침) {
  console.log(`   ${m.거래처.slice(0, 14).padEnd(14)} ${m.박스명.slice(0, 28).padEnd(28)} ${String(m.입수).padStart(3)}개입  ${String(m.옛값).padStart(8)} → ${String(m.새값).padStart(9)}   원가 ${String(m.원가 || '-').padStart(8)}   ${m.근거}`);
}

console.log(`\n② 그대로 두는 것 ${그대로.length}건`);
for (const m of 그대로) {
  console.log(`   ${m.거래처.slice(0, 14).padEnd(14)} ${m.박스명.slice(0, 28).padEnd(28)} ${String(m.입수).padStart(3)}개입  ${String(m.옛값).padStart(9)}   원가 ${String(m.원가 || '-').padStart(8)}   ${m.근거}`);
}

if (낱개가1할.length) {
  console.log(`\n⚠ **낱개 단가가 1/입수로 들어간 것 ${낱개가1할.length}건 — 안 고친다.** 사장님이 봐야 한다.`);
  for (const s of 낱개가1할) console.log(`   ${s}`);
}

if (세금어긋남.length) {
  console.log(`\n⚠ 박스와 낱개의 과세/면세가 갈린 것 ${세금어긋남.length}건 — **안 고친다.** 사장님이 봐야 한다.`);
  for (const s of 세금어긋남) console.log(`   ${s}`);
}

//  엑셀로도 낸다 — 화면으로 훑기에 길다.
writeFileSync(CSV, '﻿' + [
  ['거래처', '박스 품목', '입수', '지금 단가', '고칠 단가', '박스 원가', '근거', 'partner_item id'].join(','),
  ...고침.map(m => [m.거래처, m.박스명, m.입수, m.옛값, m.새값, m.원가 || '', m.근거, m.id]
    .map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')),
].join('\r\n'), 'utf8');
console.log(`\n엑셀 → ${CSV}`);

if (!APPLY) { console.log('\n미리보기만 했다. 실제로 바꾸려면 --apply 를 붙여라.\n'); process.exit(0); }
if (고침.length === 0) { console.log('\n할 일 없음.\n'); process.exit(0); }
if (existsSync(BACKUP)) throw new Error(`기존 백업이 있다. 먼저 확인하라: ${BACKUP}`);

writeFileSync(BACKUP, JSON.stringify({
  적은때: new Date().toISOString(),
  설명: '박스 거래처 단가를 낱개 × 입수 로 맞춤 — 되돌리려면 각 id 의 price 를 옛값으로 되쓴다',
  고친것: 고침,
}, null, 2), 'utf8');
console.log(`백업 → ${BACKUP}`);

for (let i = 0; i < 고침.length; i += 300) {
  const batch = writeBatch(db);
  for (const m of 고침.slice(i, i + 300)) batch.update(doc(db, 'partner_item', m.id), { price: m.새값 });
  await batch.commit();
  console.log(`  ${Math.min(i + 300, 고침.length)} / ${고침.length}`);
}
console.log(`\n✅ 박스 단가 ${고침.length}건을 고쳤다.\n`);
process.exit(0);
