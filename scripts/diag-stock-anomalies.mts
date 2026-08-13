// [읽기 전용] 재고 이상 3건 진단
//   ① 참기름/병/특/알찬/350ml (낱개) — 현재고 0인데 작업완료 900 → 재고 −900
//   ② 시골향 들기름/병/특/350ml (20개입) — 재고 −1
//   ③ 들기름/알이네/1800ml (10개입) — 재고 −2
// 목적: 값을 고치기 전에 "왜 그런지"와 "정답이 데이터로 결정되는지"를 본다. 아무것도 쓰지 않는다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const [items, orders] = await Promise.all([load('items'), load('orders')]);
const byId = new Map(items.map((i: any) => [i.id, i]));

const TARGETS = ['참기름/병/특/알찬/350ml', '시골향 들기름/병/특/350ml (20개입)', '들기름/알이네/1800ml (10개입)'];

for (const t of TARGETS) {
  const hits = items.filter((p: any) => !p.archived && (p.name ?? '') === t || (p.name ?? '').startsWith(t));
  for (const p of hits) {
    console.log(`\n════════ ${p.name} ════════`);
    console.log(`id=${p.id}  category=${p.category}  unit=${p.unit}  spec=${p.spec ?? '-'}  procureType=${p.procureType ?? '-'}`);
    console.log(`stock=${p.stock}  boxSize=${p.boxSize ?? (p.defaultBoxConfig?.unitsPerBox ?? '-')}`);

    // 이 품목을 참조하는 주문 라인 전부 — 상태별로
    const lines: any[] = [];
    for (const o of orders) {
      for (const it of (o.items ?? [])) {
        if (it.itemId !== p.id) continue;
        lines.push({ o, it });
      }
    }
    const prod = lines.filter(({ o }) => o.producedAt && !o.shippedOut);
    console.log(`참조 주문라인 ${lines.length}건 / 그중 작업완료·미출고 ${prod.length}건`);
    for (const { o, it } of prod) {
      console.log(`  ▶ ${o.id}  ${o.partnerName ?? ''}  qty=${it.quantity} isBox=${it.isBox ?? false} unit=${it.unit ?? '-'}  producedAt=${(o.producedAt ?? '').toString().slice(0, 19)}  shippedOut=${o.shippedOut ?? false}  status=${o.status ?? '-'}`);
    }
    // 최근 라인 몇 건 (상태 무관) — 언제 마지막으로 움직였나
    const recent = lines.sort((a, b) => String(b.o.createdAt ?? '').localeCompare(String(a.o.createdAt ?? ''))).slice(0, 6);
    console.log('  최근 주문라인:');
    for (const { o, it } of recent) {
      console.log(`    · ${(o.createdAt ?? '').toString().slice(0, 10)}  ${o.partnerName ?? ''}  qty=${it.quantity} isBox=${it.isBox ?? false}  producedAt=${o.producedAt ? 'Y' : 'N'} shippedOut=${o.shippedOut ? 'Y' : 'N'} status=${o.status ?? '-'}`);
    }
  }
}

// ① 이중집계 의심 검증: 낱개 900 = 박스 45 × 20 인지
console.log('\n\n════════ 알찬 350ml 낱개 vs 20개입 대조 ════════');
const loose = items.find((p: any) => p.name === '참기름/병/특/알찬/350ml' && !p.archived);
const box = items.find((p: any) => (p.name ?? '').startsWith('참기름/병/특/알찬/350ml (20개입)') && !p.archived);
for (const p of [loose, box]) {
  if (!p) continue;
  let q = 0; const os: string[] = [];
  for (const o of orders) {
    if (!o.producedAt || o.shippedOut) continue;
    for (const it of (o.items ?? [])) if (it.itemId === p.id) { q += it.quantity ?? 0; os.push(`${o.id}(qty ${it.quantity},isBox=${it.isBox ?? false})`); }
  }
  console.log(`${p.name}\n   id=${p.id}  stock=${p.stock}  작업완료합(quantity 단순합)=${q}\n   주문: ${os.join(', ') || '없음'}`);
}
process.exit(0);
