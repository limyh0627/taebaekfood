// 6/29 실사 기준점 + 이후 수불부 흐름 → 원료별 복구 목표값 산출 (읽기 전용)
// 실사 직후 로트합계 = 실사 목표값(사용자 입력값). 이후 auto/manual 흐름을 가감.
// 실사 전 재고 0이었던 원료(차감 노트가 '실사조정' 로트만 가리킴)는 목표값 = 실사 delta.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

const ledSnap = await getDocs(collection(db, 'rawMaterialLedger'));
const entries = ledSnap.docs.map(d => ({ id: d.id, ...d.data() }));

// 원료별: 6/29 마지막 실사(correction '재고실사정정') 시각과 delta, 이후 흐름
const MATS = ['탈피들깨가루', '볶음들깨', '볶음참깨', '볶음검정참깨', '검정깨', '통들깨들기름', '통깨참기름', '깨분참기름', '생들기름', '수입들기름'];
for (const m of MATS) {
  const mine = entries.filter(e => e.material === m).sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  const lastAudit = [...mine].reverse().find(e => e.note === '재고실사정정' && (e.createdAt ?? '').startsWith('2026-06-29'));
  if (!lastAudit) { console.log(`\n■ ${m}: 6/29 실사 기록 없음`); continue; }
  const auditDelta = (lastAudit.received ?? 0) - (lastAudit.used ?? 0);
  const after = mine.filter(e => (e.createdAt ?? '') > (lastAudit.createdAt ?? ''));
  const rec = after.reduce((s, e) => s + (e.received ?? 0), 0);
  const used = after.reduce((s, e) => s + (e.used ?? 0), 0);
  console.log(`\n■ ${m} — 실사 ${(lastAudit.createdAt ?? '').slice(0, 19)} delta=${auditDelta > 0 ? '+' : ''}${auditDelta}kg`);
  console.log(`  실사 이후: +${Math.round(rec * 100) / 100} / -${Math.round(used * 100) / 100}kg (${after.length}건)`);
  console.log(`  → 실사목표값 T라 하면 현재 정상재고 = T ${rec ? `+${Math.round(rec * 100) / 100}` : ''} - ${Math.round(used * 100) / 100}kg`);
  after.slice(0, 15).forEach(e => console.log(`    ${(e.createdAt ?? '').slice(5, 16)} +${e.received ?? 0}/-${e.used ?? 0} ${e.type} "${(e.note ?? '').slice(0, 45)}"`));
  if (after.length > 15) console.log(`    …외 ${after.length - 15}건`);
}
process.exit(0);
