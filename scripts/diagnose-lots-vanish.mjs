// 원료 로트 소실 시점 추적 (읽기 절약: raw 품목 쿼리 + ledger 1회)
// A) raw 품목별 lots 필드 형태([] vs 없음) — 어떤 쓰기 경로가 지웠는지 단서
// B) 수불부에서 "▸ 분배 표기 있는 마지막 auto"(로트가 살아있던 마지막 시점)와
//    "분배 표기 없는 첫 auto"(로트가 비어버린 첫 시점) 비교 → 소실 구간 특정
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

console.log('████ A) raw 품목 lots 필드 형태 ████');
const rawSnap = await getDocs(query(collection(db, 'items'), where('category', '==', 'raw')));
for (const d of rawSnap.docs) {
  const x = d.data();
  const kind = !('lots' in x) ? '필드없음' : Array.isArray(x.lots) ? (x.lots.length === 0 ? '빈배열[]' : `${x.lots.length}개(active ${x.lots.filter(l => l.status === 'active').length})`) : typeof x.lots;
  console.log(`  ${d.id} "${x.name}" stock=${x.stock}${x.unit ?? ''} lots=${kind}`);
}

console.log('\n████ B) 원료별 로트 소실 구간 (수불부 auto 노트 기준) ████');
const ledSnap = await getDocs(collection(db, 'rawMaterialLedger'));
const entries = ledSnap.docs.map(d => ({ id: d.id, ...d.data() }));
const MATS = ['탈피들깨가루', '통깨참기름', '통들깨들기름', '깨분참기름', '볶음참깨', '볶음들깨', '볶음검정참깨', '검정깨', '참깨', '수입들기름'];
for (const m of MATS) {
  const autos = entries.filter(e => e.material === m && e.type === 'auto').sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  const lastWith = [...autos].reverse().find(e => (e.note ?? '').includes('▸'));
  const firstWithout = autos.find(e => !(e.note ?? '').includes('▸') && (!lastWith || (e.createdAt ?? '') > (lastWith.createdAt ?? '')));
  console.log(`  ${m}:`);
  console.log(`    로트 살아있던 마지막 차감: ${lastWith ? `${(lastWith.createdAt ?? '').slice(0, 19)} "${lastWith.note}"` : '없음'}`);
  console.log(`    로트 비어버린 첫 차감:   ${firstWithout ? `${(firstWithout.createdAt ?? '').slice(0, 19)} "${firstWithout.note}"` : '없음'}`);
}

// C) 6/29~7/1 사이 전체 수불부 수동/정정 기록 — 소실 구간에 사람이 한 조작 확인
console.log('\n████ C) 6/29~7/02 수동·정정 수불부 기록 전체 ████');
entries
  .filter(e => (e.createdAt ?? '') >= '2026-06-29' && e.type !== 'auto')
  .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
  .forEach(e => console.log(`  ${(e.createdAt ?? '').slice(0, 19)} ${e.material} +${e.received ?? 0}/-${e.used ?? 0} type=${e.type ?? '-'} note="${e.note ?? ''}"`));

process.exit(0);
