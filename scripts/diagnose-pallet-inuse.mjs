// 파레트 '회수 대기(inUse)' 8개 vs 거래처 잔량 불일치 진단 — 읽기 전용
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app); await signInAnonymously(getAuth(app));

console.log('=== pallets 문서 (저장된 카운터) ===');
const ps = await getDocs(collection(db, 'pallets'));
ps.forEach(d => {
  const p = d.data();
  console.log(`  ${p.name} (${d.id}): total=${p.total} inUse=${p.inUse} damaged=${p.damaged}`);
});

console.log('\n=== palletTransactions 전체 ===');
const ts = await getDocs(collection(db, 'palletTransactions'));
const txs = [];
ts.forEach(d => txs.push({ id: d.id, ...d.data() }));
txs.sort((a, b) => String(a.date).localeCompare(String(b.date)));
for (const t of txs) {
  console.log(`  ${t.date} [${t.type}${t.status ? '/' + t.status : ''}${t.isTransfer ? '/이동' : ''}] pallet=${t.palletId} qty=${t.quantity} partner=${t.partnerId} note="${t.note ?? ''}" retQty=${t.exchangeReturnQty ?? '-'}`);
}

// 거래 기준 inUse 기대값(현행 규칙): 일반지급 +, 일반입고 −, 교체지급 +, 교체회수 −. 이동전표 제외.
const expected = new Map();
for (const t of txs) {
  if (t.isTransfer) continue;
  const cur = expected.get(t.palletId) ?? 0;
  expected.set(t.palletId, cur + (t.type === 'out' ? t.quantity : -t.quantity));
}
console.log('\n=== 거래 누적으로 계산한 inUse 기대값 (시드/수동편집 무시) ===');
for (const [pid, v] of expected) console.log(`  ${pid}: ${v >= 0 ? '+' : ''}${v}`);

// 주문에 실린 파레트(비교환) — 거래처 잔량에는 −로 잡히지만 inUse는 안 건드림
console.log('\n=== 주문 출고 파레트 (비교환, SHIPPED/DELIVERED) ===');
let orderOut = 0;
for (const st of ['SHIPPED', 'DELIVERED']) {
  const os = await getDocs(query(collection(db, 'orders'), where('status', '==', st)));
  os.forEach(d => {
    const o = d.data();
    (o.pallets ?? []).filter(p => !p.isExchange).forEach(p => {
      orderOut += p.quantity ?? 0;
      console.log(`  ${String(o.deliveryDate ?? '').slice(0, 10)} [${st}] ${o.partnerName}: ${p.type} × ${p.quantity}`);
    });
  });
}
console.log(`주문 출고 파레트 합계: ${orderOut}개`);
process.exit(0);
