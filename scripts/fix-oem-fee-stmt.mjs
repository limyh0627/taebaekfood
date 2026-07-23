// 잘못 계산된 OEM 가공비 전표 정정 — 단가를 공급가로 보고 부가세를 얹었던 것을
// '단가=부가세 포함'(앱 공통 규칙)으로 재계산. dry-run 기본, --apply 반영, --undo 되돌리기.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const app = initializeApp({
  apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE',
  authDomain: 'taebaek-3abe4.firebaseapp.com',
  projectId: 'taebaek-3abe4',
});
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKUP = path.join(HERE, 'fix-oem-fee-stmt-backup.json');
const apply = process.argv.includes('--apply');
const undo = process.argv.includes('--undo');

const load = async (c) => (await getDocs(collection(db, c))).docs.map(d => ({ _id: d.id, ...d.data() }));

if (undo) {
  const bak = JSON.parse(fs.readFileSync(BACKUP, 'utf8'));
  for (const s of bak.statements) {
    await updateDoc(doc(db, 'issuedStatements', s.id), {
      totalSupply: s.totalSupply, totalTax: s.totalTax, totalAmount: s.totalAmount, items: s.items,
    });
    console.log(`  ✓ ${s.id} 복원 (합계 ${s.totalAmount})`);
  }
  process.exit(0);
}

const stmts = await load('issuedStatements');
const targets = stmts.filter(s => (s.items ?? []).some(i => String(i.name ?? '').includes('외주가공비')));

console.log(`${apply ? '[반영]' : '[DRY RUN — 반영하려면 --apply]'}  가공비 전표 ${targets.length}건\n`);

const backup = { at: new Date().toISOString(), statements: [] };

for (const s of targets) {
  // 기존: 입력단가×kg = 공급가, 세액을 얹음 → 원래 의도한 '합계'는 기존 공급가(totalSupply)다
  const total = s.totalSupply;
  const taxable = !(s.items?.[0]?.isTaxExempt);
  const supply = taxable ? Math.round(total / 1.1) : total;
  const tax = total - supply;

  console.log(`  ${s._id} | ${s.tradeDate} | ${s.partnerName}`);
  console.log(`    이전: 공급가 ${s.totalSupply} + 세액 ${s.totalTax} = ${s.totalAmount}`);
  console.log(`    이후: 공급가 ${supply} + 세액 ${tax} = ${total}`);
  if (!apply) continue;

  backup.statements.push({
    id: s._id, totalSupply: s.totalSupply, totalTax: s.totalTax, totalAmount: s.totalAmount, items: s.items,
  });
  const items = (s.items ?? []).map(i =>
    String(i.name ?? '').includes('외주가공비')
      ? { ...i, price: total, supply, tax, total }
      : i);
  await updateDoc(doc(db, 'issuedStatements', s._id), {
    totalSupply: supply, totalTax: tax, totalAmount: total, items,
  });
  console.log(`    ✓ 반영`);
}

if (apply && backup.statements.length > 0) {
  fs.writeFileSync(BACKUP, JSON.stringify(backup, null, 2));
  console.log(`\n백업: ${BACKUP}`);
}
process.exit(0);
