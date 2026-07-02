// 원료별 수불부 전체 잔량(Σ입고-Σ사용) vs 현재 items.stock 비교 → 복구 목표값 산출 (읽기 전용)
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

const DENSITY = { 통깨참기름: 0.92, 깨분참기름: 0.92, 통들깨들기름: 0.92, 수입들기름: 0.92, 생들기름: 0.92 }; // L 환산용(참고)

const [ledSnap, rawSnap] = await Promise.all([
  getDocs(collection(db, 'rawMaterialLedger')),
  getDocs(query(collection(db, 'items'), where('category', '==', 'raw'))),
]);

const bal = {}; // material → { rec, used, last }
for (const d of ledSnap.docs) {
  const e = d.data();
  const m = e.material ?? '?';
  bal[m] ??= { rec: 0, used: 0, n: 0, last: '' };
  bal[m].rec += e.received ?? 0;
  bal[m].used += e.used ?? 0;
  bal[m].n += 1;
  if ((e.createdAt ?? '') > bal[m].last) bal[m].last = e.createdAt ?? '';
}

console.log('원료명 | 수불부잔량(kg) | 현재stock | 로트합계kg | 기록수 | 마지막기록');
for (const d of rawSnap.docs) {
  const x = d.data();
  const name = (x.name ?? '').replace(/\/.*$/, '');
  const b = bal[name];
  const lots = Array.isArray(x.lots) ? x.lots : null;
  const lotKg = lots ? lots.filter(l => l.status === 'active').reduce((s, l) => s + (l.kgRemaining ?? 0), 0) : null;
  const ledger = b ? Math.round((b.rec - b.used) * 100) / 100 : null;
  console.log(`${name} | ${ledger ?? '기록없음'} | ${x.stock}${x.unit ?? ''} | ${lotKg === null ? 'lots필드없음' : lotKg} | ${b?.n ?? 0} | ${(b?.last ?? '').slice(0, 16)}`);
}
console.log(`\n(수불부 총 ${ledSnap.size}건 · 기름 밀도 0.92 기준 L환산은 kg÷0.92)`);
process.exit(0);
