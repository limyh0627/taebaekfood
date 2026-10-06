import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { adminDb } from './_admin.mts';
import { nextDocNo } from '../src/shared/voucherStamp.ts';
import { allocatePartnerCash } from '../src/features/admin/cashLedger.ts';
import type { CashEntry, IssuedStatement, Settlement } from '../src/shared/types.ts';

const db = adminDb();
const companyId = 'taebaek';
const partnerId = 'C078';
const date = '2026-09-10';
const amount = 6_000_000;
const id = 'cash-manual-haenaeum-20260910-6000000';
const ref = db.doc(`cashEntries/${id}`);
const partnerRef = db.doc(`partners/${partnerId}`);
const backupPath = 'outputs/haenaeum-receipt-backup-20261006.json';
const apply = process.argv.includes('--apply');
const undo = process.argv.includes('--undo');
const own = (data: Record<string, any>) => (data.companyId ?? 'taebaek') === companyId;
if (apply && undo) throw new Error('apply와 undo 동시 사용 금지');
if (undo) {
  const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
  await db.runTransaction(async tx => {
    const [current, linked] = await Promise.all([tx.get(ref), tx.get(db.collection('settlements').where('cashEntryId', '==', id))]);
    if (!current.exists || JSON.stringify(current.data()) !== JSON.stringify(backup.created) || linked.size) throw new Error('등록 후 변경·배분된 기록은 자동 복구하지 않습니다.');
    tx.delete(ref);
  });
  console.log('이번 수금 한 건만 복구(삭제)했습니다. 기존 기록은 유지됩니다.');
  process.exit(0);
}

const [partner, cashSnap, stmtSnap, settlementsSnap, existing] = await Promise.all([
  partnerRef.get(), db.collection('cashEntries').get(), db.collection('issuedStatements').get(),
  db.collection('settlements').get(), ref.get(),
]);
if (!partner.exists || partner.get('name') !== '해내음식품' || partner.get('companyId') !== companyId) throw new Error('거래처 확인 실패');
if (existing.exists) {
  if (existing.get('amount') === amount && existing.get('partnerId') === partnerId && existing.get('date') === date && existing.get('cashAccountId') === '') {
    console.log('요청한 동일 수금이 이미 있습니다. 추가하지 않습니다.'); process.exit(0);
  }
  throw new Error('수금 ID 충돌');
}
const cash = cashSnap.docs.filter(d => own(d.data())).map(d => ({ ...d.data(), id: d.id })) as CashEntry[];
const statements = stmtSnap.docs.filter(d => own(d.data())).map(d => ({ ...d.data(), id: d.id })) as IssuedStatement[];
const settlements = settlementsSnap.docs.map(d => ({ ...d.data(), id: d.id })) as Settlement[];
if (cash.some(entry => entry.partnerId === partnerId && entry.date === date && entry.amount === amount && entry.dir === '입금')) throw new Error('동일 날짜·금액의 수금이 이미 있습니다.');
const before = allocatePartnerCash(partnerId, '매출', statements, cash, settlements);
const unpaidBefore = [...before.values()].reduce((sum, value) => sum + value, 0);
if (unpaidBefore < amount) throw new Error('수금이 미수보다 큽니다. 선수금 처리 확인이 필요합니다.');
const receipt: CashEntry = {
  id, companyId, date, docNo: nextDocNo(date, [...cash, ...statements]),
  cashAccountId: '', dir: '입금', amount, partnerId, partnerName: '해내음식품', accountCode: '108',
  note: '해내음식품 수금 · 계좌 미지정 · 본부장 요청 등록',
  createdAt: '2026-09-10T14:59:59.000Z', createdBy: '본부장 요청',
};
const after = allocatePartnerCash(partnerId, '매출', statements, [...cash, receipt], settlements);
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry', receipt,
  unpaidBefore, unpaidAfter: [...after.values()].reduce((sum, value) => sum + value, 0),
  allocation: [...after].map(([statementId, remaining]) => ({ statementId, docNo: statements.find(s => s.id === statementId)?.docNo, remaining })),
}, null, 2));
if (!apply) process.exit(0);
mkdirSync('outputs', { recursive: true });
writeFileSync(backupPath, JSON.stringify({ original: null, created: receipt,
  previousCash: cash.filter(entry => entry.partnerId === partnerId), previousOpen: [...before] }, null, 2), { flag: 'wx' });
await db.runTransaction(async tx => {
  const [freshPartner, freshCash, freshStatements, fresh] = await Promise.all([
    tx.get(partnerRef), tx.get(db.collection('cashEntries').where('date', '==', date)),
    tx.get(db.collection('issuedStatements').where('tradeDate', '==', date)), tx.get(ref),
  ]);
  if (!freshPartner.updateTime?.isEqual(partner.updateTime!) || fresh.exists) throw new Error('원본이 변경돼 등록을 중단했습니다.');
  const dayDocs = [...freshCash.docs, ...freshStatements.docs].filter(doc => own(doc.data()));
  if (dayDocs.some(doc => doc.get('docNo') === receipt.docNo) || freshCash.docs.some(doc => doc.get('partnerId') === partnerId && doc.get('amount') === amount && doc.get('dir') === '입금')) throw new Error('동시 수금·번호 중복으로 중단했습니다.');
  tx.create(ref, receipt);
});
const [saved, finalCash] = await Promise.all([ref.get(), db.collection('cashEntries').where('partnerId', '==', partnerId).get()]);
if (!saved.exists || saved.get('amount') !== amount || saved.get('date') !== date || saved.get('cashAccountId') !== '') throw new Error('등록 후 재조회 실패');
const currentCash = finalCash.docs.filter(doc => own(doc.data())).map(doc => ({ ...doc.data(), id: doc.id })) as CashEntry[];
const finalOpen = [...allocatePartnerCash(partnerId, '매출', statements, currentCash, settlements).values()].reduce((sum, value) => sum + value, 0);
if (finalOpen !== unpaidBefore - amount) throw new Error('수금 후 미수 감소 검증 실패');
console.log(JSON.stringify({ saved: true, id, docNo: receipt.docNo, unpaidAfter: finalOpen, backupPath }, null, 2));
