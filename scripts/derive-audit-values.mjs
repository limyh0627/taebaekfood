// 통깨참기름·깨분참기름·생들기름 6/29 실사 입력값 역산 (읽기 전용)
// 방법: 로트=0 앵커(부족알림/실사0) 이후 로트영향 입출고 롤포워드 → 실사 직전 로트합계 P → 실사값 V=(P+delta)/밀도
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

const [ledSnap, notifSnap] = await Promise.all([
  getDocs(collection(db, 'rawMaterialLedger')),
  getDocs(query(collection(db, 'notifications'), where('type', '==', 'inventory_shortage'))),
]);
const entries = ledSnap.docs.map(d => ({ id: d.id, ...d.data() }));
const shortages = notifSnap.docs.map(d => d.data()).filter(n => (n.body ?? '').includes('로트 잔량보다'));

// 로트에 영향을 주는 항목 분류: rm-corr-*(수불부 정정추가)는 로트 미연동이므로 제외
const lotAffecting = (e) => !(String(e.id ?? '').startsWith('rm-corr-'));

for (const M of ['통깨참기름', '깨분참기름', '생들기름']) {
  console.log(`\n████ ${M} ████`);
  // 이 원료의 부족알림(=그 순간 로트 0) 전체
  const sh = shortages.filter(n => (n.body ?? '').startsWith(`${M}:`)).sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  console.log(`부족알림 ${sh.length}건:`);
  sh.forEach(n => console.log(`  ${(n.createdAt ?? '').slice(0, 19)} ${n.body.slice(0, 80)}`));

  // 6/10 이후 전체 수불부 (createdAt 순)
  const mine = entries.filter(e => e.material === M && (e.createdAt ?? '') >= '2026-06-10')
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  console.log(`수불부 6/10 이후 ${mine.length}건:`);
  mine.forEach(e => console.log(`  ${(e.createdAt ?? '').slice(5, 19)} +${e.received ?? 0}/-${e.used ?? 0} ${e.type ?? '-'} ${lotAffecting(e) ? '' : '[로트무관]'} "${(e.note ?? '').slice(0, 50)}" id=${String(e.id).slice(0, 20)}`));

  // 통깨참기름: 마지막 앵커(6/29 06:25 이전 마지막 부족알림) 이후 롤포워드
  if (M === '통깨참기름') {
    const AUDIT_AT = '2026-06-29T06:25:15';
    const anchor = [...sh].reverse().find(n => (n.createdAt ?? '') < AUDIT_AT);
    const from = anchor ? anchor.createdAt : '2026-06-10T00:00:00';
    let p = 0;
    const flows = mine.filter(e => (e.createdAt ?? '') > from && (e.createdAt ?? '') < AUDIT_AT && lotAffecting(e));
    for (const e of flows) p += (e.received ?? 0) - (e.used ?? 0);
    p = Math.round(p * 1000) / 1000;
    const shBetween = sh.filter(n => (n.createdAt ?? '') > from && (n.createdAt ?? '') < AUDIT_AT);
    console.log(`앵커: ${anchor ? (anchor.createdAt ?? '').slice(0, 19) + ' (로트=0)' : '6/10 가정'} → 실사직전 P=${p}kg (중간 부족알림 ${shBetween.length}건${shBetween.length ? ' ⚠️ 롤포워드 부정확' : ''})`);
    const T = Math.round((p - 321.5) * 1000) / 1000;
    console.log(`→ 실사목표 T = P − 321.5 = ${T}kg = ${Math.round(T / 0.916 * 100) / 100}L`);
  }
}
process.exit(0);
