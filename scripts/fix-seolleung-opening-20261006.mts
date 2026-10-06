import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { adminDb } from './_admin.mts';
import { openingPartnerStatement } from '../src/shared/openingPartnerBalance.ts';
import type { Partner } from '../src/shared/types.ts';

const db = adminDb();
const date = '2026-07-31';
const partnerId = 'c-1773552167101';
const amount = 252_000;
const voucherId = `opening-partner-taebaek-${date}-${partnerId}-108`;
const openingRef = db.doc('openingBalances/main');
const partnerRef = db.doc(`partners/${partnerId}`);
const voucherRef = db.doc(`issuedStatements/${voucherId}`);
const backupPath = 'outputs/seolleung-opening-backup-20261006.json';
const apply = process.argv.includes('--apply');
const undo = process.argv.includes('--undo');
if (apply && undo) throw new Error('--apply와 --undo를 함께 사용할 수 없습니다.');

if (undo) {
  const backup = JSON.parse(readFileSync(backupPath, 'utf8')) as { opening: Record<string, unknown>; voucher: Record<string, unknown> | null; appliedUpdateTime?: string };
  await db.runTransaction(async tx => {
    const [opening, voucher] = await Promise.all([tx.get(openingRef), tx.get(voucherRef)]);
    if (!opening.exists || !voucher.exists || voucher.get('totalAmount') !== amount || voucher.get('partnerId') !== partnerId) throw new Error('현재 문서가 적용 결과와 달라 되돌리기를 중단합니다.');
    if (!backup.appliedUpdateTime || opening.updateTime?.toDate().toISOString() !== backup.appliedUpdateTime) throw new Error('적용 뒤 회계 기초 문서가 바뀌어 자동 복구를 중단합니다.');
    if (backup.voucher) throw new Error('백업 당시 전표가 이미 있어 자동 복구할 수 없습니다.');
    tx.delete(voucherRef);
    tx.set(openingRef, backup.opening);
  });
  console.log('전표 삭제와 회계 기초 문서 복구 완료');
  process.exit(0);
}

const [opening, partner, existing] = await Promise.all([openingRef.get(), partnerRef.get(), voucherRef.get()]);
if (!opening.exists || opening.get('companyId') !== 'taebaek' || opening.get('date') !== date || Number(opening.get('amounts')?.['108'] ?? 0) !== 0) throw new Error('태백 7월 31일 회계 기초일·108 합계가 예상과 다릅니다.');
if (!partner.exists || partner.get('companyId') !== 'taebaek' || partner.get('name') !== '논두렁오리주물럭(선릉)') throw new Error('거래처 ID·회사·이름이 예상과 다릅니다.');
const voucher = openingPartnerStatement('taebaek', date, { id: partner.id, ...partner.data() } as Partner, '108', amount);
if (existing.exists) {
  if (JSON.stringify(existing.data()) === JSON.stringify(voucher)) { console.log('이미 동일 전표가 있습니다. 변경 없음.'); process.exit(0); }
  throw new Error('기초 미수 전표 ID가 이미 사용 중입니다.');
}
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry', partnerId, partnerName: partner.get('name'), date, amount, voucherId,
  lines: voucher.items.map(line => ({ accountCode: line.accountCode, side: line.side, total: line.total })) }, null, 2));
if (!apply) process.exit(0);

mkdirSync('outputs', { recursive: true });
writeFileSync(backupPath, JSON.stringify({ opening: opening.data(), voucher: existing.data() ?? null, openingUpdateTime: opening.updateTime?.toDate().toISOString() }, null, 2), { flag: 'wx' });
await db.runTransaction(async tx => {
  const [freshOpening, freshPartner, freshVoucher] = await Promise.all([tx.get(openingRef), tx.get(partnerRef), tx.get(voucherRef)]);
  if (!freshOpening.updateTime?.isEqual(opening.updateTime!) || !freshPartner.updateTime?.isEqual(partner.updateTime!) || freshVoucher.exists) throw new Error('조회 이후 원본이 바뀌어 중단했습니다.');
  tx.update(openingRef, { hasPartnerOpening: true });
  tx.create(voucherRef, voucher);
});
const [afterOpening, afterVoucher] = await Promise.all([openingRef.get(), voucherRef.get()]);
if (!afterVoucher.exists || afterVoucher.get('totalAmount') !== amount || afterVoucher.get('partnerId') !== partnerId || afterOpening.get('hasPartnerOpening') !== true) throw new Error('쓰기 후 검증에 실패했습니다.');
writeFileSync(backupPath, JSON.stringify({ opening: opening.data(), voucher: null,
  openingUpdateTime: opening.updateTime?.toDate().toISOString(), appliedUpdateTime: afterOpening.updateTime?.toDate().toISOString() }, null, 2));
console.log(`적용 및 재조회 완료: ${voucherId}; 백업 ${backupPath}`);
