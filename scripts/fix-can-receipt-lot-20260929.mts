import { adminDb } from './_admin.mts';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
const db = adminDb();
const itemId = 'p-1779251603644';
const receiptId = 'rcv-1790558348178-ebd9';
const poId = 'po-1790558331203';
const backupPath = '로컬전용/db-backups/can-receipt-lot-20260929.json';
const ref = db.collection('items').doc(itemId);
const apply = process.argv.includes('--apply');
const undo = process.argv.includes('--undo');
if (apply && undo) throw new Error('apply/undo 동시 실행 금지');
if (undo) {
 const b = JSON.parse(readFileSync(backupPath, 'utf8'));
 await db.runTransaction(async tx => {
  const s = await tx.get(ref);
  if (s.data()?.stock !== b.stock || !isDeepStrictEqual(s.data()?.lots, b.after)) throw new Error('후속 재고/로트 변경: 자동 원복 중단');
  tx.update(ref, { lots: b.before });
 });
 console.log('로트만 원복, 재고 불변');
} else {
 const receipts = await db.collection('itemReceipts').where('itemId', '==', itemId).get();
 const matches = receipts.docs.filter(d => d.id === receiptId || d.data().id === receiptId);
 if (matches.length !== 1) throw new Error('입고 원본 식별 불가');
 const receipt = matches[0];
 const r = receipt.data();
 if (r.quantity !== 31 || r.companyId !== 'taebaek' || r.poId !== poId || r.date !== '2026-09-28') throw new Error('입고 원본 변경');
 const s = await ref.get(); const v = s.data();
 if (!v || v.companyId !== 'taebaek' || v.stock !== 31 || v.type !== 'wip' || v.spec !== '16.5kg') throw new Error('현재 품목/재고 변경: 재조사 필요');
 const before = v.lots ?? [];
 if (before.some((l:any) => Number(l.qtyRemaining ?? 0) !== 0 || l.poId === poId || l.id === `receipt:${receiptId}`)) throw new Error('활성/복구 로트 존재: 중복 복구 금지');
 const after = [...before, { id: `receipt:${receiptId}`, material: '깨분참기름', supplierId: r.partnerId, supplierName: r.partnerName,
  qtyIn: 31, qtyRemaining: 31, unitKg: 16.5, kgIn: 511.5, kgRemaining: 511.5,
  receivedDate: r.date, createdAt: r.createdAt, status: 'active', poId }];
 console.log(JSON.stringify({mode:apply?'apply':'dry', itemId, receiptDoc:receipt.id, stockBefore:v.stock,stockAfter:v.stock, addedLot:after.at(-1)}));
 if (apply) {
  if (existsSync(backupPath)) throw new Error('백업 존재: 재실행 금지');
  mkdirSync('로컬전용/db-backups', {recursive:true});
  writeFileSync(backupPath, JSON.stringify({itemId,receiptDoc:receipt.id,stock:v.stock,before,after}, null, 2), {flag:'wx'});
  await db.runTransaction(async tx => {
   const [current, source] = await Promise.all([tx.get(ref),tx.get(receipt.ref)]);
   if (current.updateTime?.toMillis() !== s.updateTime?.toMillis() || !isDeepStrictEqual(source.data(), r)) throw new Error('동시 변경: 적용 중단');
   tx.update(ref, {lots:after});
  });
  const verified = (await ref.get()).data();
  if (verified?.stock !== 31 || !isDeepStrictEqual(verified.lots, after)) throw new Error('적용 후 검증 실패');
  console.log('검증 완료: 재고31 유지, 로트잔량31, 기존 소진로트 보존');
 }
}
