// 푸미푸드 기초 전표를 **다른 기초 전표와 같은 모양으로** 세운다.
//   미리보기 기본 · 적용 --apply · 되돌리기 --undo
//   백업: scripts/fix-fumi-opening-backup.json
//
// 왜 (2026-09-14 사장님) — "푸미푸드 7월 31일 기초 전표가 다른거랑 좀 다른거 같은데" → "ㅇㅇ미지급".
//   지금 것은 기초 이월이 아니라 **일반 매입 전표**로 들어가 있다 —
//   갈래 매입 · 한 줄 · 계정 540 · 과세(세액 81,932). 그래서 901,250 이 7월 매입으로 손익에
//   잡히고 매입세액까지 붙는다. 기초 이월에는 부가세가 붙을 이유가 없다.
//   밝은엘앤피(`기초260731-34`)와 같은 모양으로 맞춘다 — 비용(대체) · 차대 두 줄 · 면세 · 375↔251.
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, updateDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const APPLY = process.argv.includes('--apply'), UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-fumi-opening-backup.json';
const ID = 'stmt-1786506939196';
const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app); await signInAnonymously(getAuth(app));
const ref = doc(db, 'issuedStatements', ID);
const s = (await getDoc(ref)).data() as any;

if (UNDO) {
  const b = JSON.parse(readFileSync(BACKUP, 'utf-8'));
  await updateDoc(ref, b); console.log('되돌렸다.'); process.exit(0);
}
const 금액 = 901250;
//  밝은엘앤피 것과 **같은 줄 모양** — 이름만 미지급으로. 차변 375(이월이익잉여금) ↔ 대변 251(외상매입금).
const 줄 = (accountCode: string, side: '차변' | '대변') => ({
  name: '기초 미지급(이월)', spec: '', qty: 1, price: 금액,
  supply: 금액, tax: 0, total: 금액, isTaxExempt: true, accountCode, side,
});
const 고침 = {
  docNo: '기초260731-60', type: '비용',
  items: [줄('375', '차변'), 줄('251', '대변')],
  totalAmount: 금액, totalSupply: 금액, totalTax: 0,
};
console.log(`\n═══ ${APPLY ? '🔴 적용' : '🟢 미리보기'} ═══\n`);
console.log('전  :', s.docNo, s.type, `합 ${s.totalAmount} 공급 ${s.totalSupply} 세 ${s.totalTax}`, `줄 ${(s.items ?? []).length}개 계정 ${(s.items ?? []).map((l: any) => l.accountCode).join(',')}`);
console.log('후  :', 고침.docNo, 고침.type, `합 ${고침.totalAmount} 공급 ${고침.totalSupply} 세 ${고침.totalTax}`, '줄 2개 계정 375(차변),251(대변) 면세');
if (!APPLY) { console.log('\n미리보기였다. --apply 로 적용.\n'); process.exit(0); }
if (existsSync(BACKUP)) { console.error('백업이 이미 있다.'); process.exit(1); }
writeFileSync(BACKUP, JSON.stringify({ docNo: s.docNo, type: s.type, items: s.items, totalAmount: s.totalAmount, totalSupply: s.totalSupply, totalTax: s.totalTax }, null, 1), 'utf-8');
await updateDoc(ref, 고침);
console.log(`\n고쳤다. 백업 → ${BACKUP}\n`);
process.exit(0);
