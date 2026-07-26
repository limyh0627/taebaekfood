/**
 * 계정 없는 전표 39건 정리:
 *   · 금액 0원 → 삭제(미완성 전표)
 *   · 금액 있음 → 품목 성격으로 계정과목 매핑(원료/상품/부자재/외주가공비 매입, 매출)
 * dry-run 기본, --apply 반영, --undo 되돌리기(백업 필요).
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc, deleteDoc, setDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BK = path.join(HERE, 'fix-noaccount-backup.json');
const apply = process.argv.includes('--apply');
const undo = process.argv.includes('--undo');

if (undo) {
  const bak = JSON.parse(fs.readFileSync(BK, 'utf8'));
  for (const s of bak.deleted) await setDoc(doc(db, 'issuedStatements', s.id), s);
  for (const u of bak.updated) await updateDoc(doc(db, 'issuedStatements', u.id), { items: u.prevItems });
  console.log(`복원: 삭제 ${bak.deleted.length} 되살림, 수정 ${bak.updated.length} 되돌림`); process.exit(0);
}

const items = (await getDocs(collection(db, 'items'))).docs.map(d => ({ id: d.id, ...d.data() }));
const byName = new Map(items.map(i => [i.name, i]));
const st = (await getDocs(collection(db, 'issuedStatements'))).docs.map(d => ({ _id: d.id, ...d.data() }));
const noAcc = st.filter(s => new Set((s.items || []).map(i => i.accountCode).filter(Boolean)).size === 0);

// 품목명 → 계정 (매입)
const accountForPurchase = (name) => {
  const it = byName.get(name);
  const cat = it?.category, sub = it?.subtype;
  if (/가공비/.test(name)) return '540';                          // 외주가공비
  if (cat === 'raw' || cat === 'wip') return '500';               // 원료매입
  if (cat === 'submaterial' || /박스|병|캡|페트|실링|테이프|라벨/.test(name)) return '505'; // 부자재매입
  if (cat === 'goods' || it?.procureType === '완사입') return '501'; // 상품매입(완사입)
  if (cat === 'product') return '500';                            // 완제품 형태지만 매입=원료성(참고소 등 완사입 아니면)
  return null;
};

const zero = noAcc.filter(s => !s.totalAmount);
const nonzero = noAcc.filter(s => s.totalAmount > 0);

console.log(`${apply ? '[반영]' : '[DRY RUN — 반영하려면 --apply]'}`);
console.log(`계정 없는 전표 ${noAcc.length}건 — 0원 삭제 ${zero.length} · 금액 매핑 ${nonzero.length}\n`);

const plan = [];
for (const s of nonzero) {
  const codes = (s.items || []).map(it => {
    if (s.type === '매출') return { name: it.name, code: '800' };  // 매출 → 일반매출
    return { name: it.name, code: accountForPurchase(it.name) };
  });
  const miss = codes.filter(c => !c.code);
  plan.push({ s, codes, miss });
  const tag = miss.length ? `⚠ 미매핑 ${miss.map(m => m.name).join(',')}` : '';
  console.log(`  ${s.tradeDate} | ${s.type} | ${s.partnerName} | ${s.totalAmount.toLocaleString()}원 → ${[...new Set(codes.map(c => c.code))].join(',')} ${tag}`);
}
const anyMiss = plan.some(p => p.miss.length);
if (anyMiss) console.log('\n⚠ 미매핑 있음 — 반영 전 규칙 보완 필요');

if (!apply) { console.log('\n반영: node scripts/fix-noaccount-statements.mjs --apply'); process.exit(0); }
if (anyMiss) { console.log('\n미매핑이 있어 중단. 규칙 보완 후 재실행.'); process.exit(1); }

const backup = { at: new Date().toISOString(), deleted: zero.map(({ _id, ...r }) => ({ id: _id, ...r })), updated: [] };
for (const z of zero) await deleteDoc(doc(db, 'issuedStatements', z._id));
console.log(`0원 ${zero.length}건 삭제`);
for (const { s, codes } of plan) {
  const map = new Map(codes.map(c => [c.name, c.code]));
  const nextItems = (s.items || []).map(it => ({ ...it, accountCode: it.accountCode || map.get(it.name) }));
  backup.updated.push({ id: s._id, prevItems: s.items || [] });
  await updateDoc(doc(db, 'issuedStatements', s._id), { items: nextItems });
}
console.log(`금액 ${plan.length}건 계정 매핑`);
fs.writeFileSync(BK, JSON.stringify(backup, null, 2));
console.log(`\n백업 ${BK}\n되돌리기: node scripts/fix-noaccount-statements.mjs --undo`);
process.exit(0);
