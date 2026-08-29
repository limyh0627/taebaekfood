// 푸드원 7/31 기초 전표를 다른 기초 전표와 같은 모양으로 고친다.
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// 기초이월 61건은 전부 **type='비용' · 108(차변) + 375(대변)** 두 줄인데
// 푸드원만 **type='매출' · 계정 800(일반매출) 한 줄 · side 없음**이었다.
//   → 466,800원이 7월 **매출로 잡힌다.** 기초이월은 매출이 아니라 이월이익잉여금(375)이다.
//   → autoJournal이 (차)108 / (대)800을 세워 손익이 그만큼 부푼다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-open-foodone-backup.json';
const OLD_ID = 'stmt-1786084601851';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('백업이 없다.'); process.exit(1); }
  const prev = JSON.parse(readFileSync(BACKUP, 'utf8'));
  await setDoc(doc(db, 'issuedStatements', OLD_ID), prev.old);
  if (prev.newId) await deleteDoc(doc(db, 'issuedStatements', prev.newId));
  console.log('✅ 되돌림');
  process.exit(0);
}

const snap = await getDoc(doc(db, 'issuedStatements', OLD_ID));
if (!snap.exists()) { console.error('전표가 없다 — 이미 고쳤나?'); process.exit(1); }
const old = { id: OLD_ID, ...snap.data() } as any;
const amt = Number(old.totalAmount || 0);
const NEW_ID = `stmt-open-${old.partnerId}-매출`;

//  다른 기초 전표와 똑같은 모양 — 108 차변 / 375 대변, type='비용'
const line = (name: string, code: string, side: '차변' | '대변') => ({
  name, spec: '', qty: 1, price: amt, supply: amt, tax: 0, total: amt,
  isTaxExempt: true, accountCode: code, side,
});
const next = {
  id: NEW_ID, companyId: old.companyId ?? 'taebaek',
  issuedAt: old.issuedAt ?? '2026-07-31T00:00:00.000Z', tradeDate: '2026-07-31',
  type: '비용', partnerId: old.partnerId, partnerName: old.partnerName,
  orderId: '', docNo: old.docNo ?? '기초260731-푸드원',
  totalSupply: amt, totalTax: 0, totalAmount: amt,
  items: [line('기초 미수금(이월)', '108', '차변'), line('기초 미수금(이월)', '375', '대변')],
};

console.log(`\n═══ ${APPLY ? '🔴 적용(--apply)' : '🟢 미리보기(dry)'} ═══\n`);
console.log(`   전  ${old.tradeDate} type=${old.type} ${old.docNo}  ${amt.toLocaleString()}원`);
for (const i of (old.items ?? [])) console.log(`        ${i.name} | 계정 ${i.accountCode} | side ${i.side ?? '없음'} | ${i.total}`);
console.log(`        → 분개: (차)108 / (대)800 일반매출  ← **7월 매출이 그만큼 부푼다**`);
console.log(`\n   후  ${next.tradeDate} type=비용 ${next.docNo}  ${amt.toLocaleString()}원   id=${NEW_ID}`);
for (const i of next.items) console.log(`        ${i.name} | 계정 ${i.accountCode} | ${i.side} | ${i.total}`);
console.log(`        → 분개: (차)108 외상매출금 / (대)375 이월이익잉여금  ← 나머지 61건과 같은 모양`);
console.log(`\n되돌리기: npx tsx scripts/fix-open-foodone.mts --undo`);
if (!APPLY) { console.log(`\n적용: npx tsx scripts/fix-open-foodone.mts --apply`); process.exit(0); }

writeFileSync(BACKUP, JSON.stringify({ old, newId: NEW_ID }, null, 1), 'utf8');
await setDoc(doc(db, 'issuedStatements', NEW_ID), next);
await deleteDoc(doc(db, 'issuedStatements', OLD_ID));
console.log(`\n✅ ${NEW_ID}로 다시 세우고 옛 전표(${OLD_ID}) 삭제 · 백업 ${BACKUP}`);
process.exit(0);
