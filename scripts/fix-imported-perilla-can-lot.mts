/** 수입산들기름 캔의 숫자 재고 40개에 대응하는 출처 미상 이월 로트 복구. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { cert, deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const apply = process.argv.includes('--apply');
const undo = process.argv.includes('--undo');
if (apply && undo) throw new Error('--apply와 --undo를 함께 쓸 수 없습니다.');
const backupPath = 'scripts/fix-imported-perilla-can-lot-backup.json';
const lotId = 'carry-imported-perilla-can-20260930';
const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'C:/Users/TAEBAEK/.secrets/taebaek-admin.json';
const app = initializeApp({ credential: cert(JSON.parse(readFileSync(keyPath, 'utf8'))), projectId: 'taebaek-3abe4' });

try {
  const ref = getFirestore(app).doc('items/p-1773565128048');
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new Error('캔 품목이 없습니다.');
  const data = snapshot.data()!;
  const lots = data.lots ?? [];
  const activeQty = lots.reduce((sum: number, lot: any) => sum + (lot.status === 'active' ? Number(lot.qtyRemaining ?? 0) : 0), 0);
  console.log(JSON.stringify({ stock: data.stock, activeLotQty: activeQty, hasCorrection: lots.some((lot: any) => lot.id === lotId) }));

  if (!apply && !undo) process.exit(0);
  if (apply) {
    if (existsSync(backupPath)) throw new Error('백업이 이미 있습니다. 중복 적용을 중단합니다.');
    if (data.companyId !== 'taebaek' || Number(data.stock) !== 40 || activeQty !== 0 || lots.some((lot: any) => lot.id === lotId)) {
      throw new Error('예상한 재고 40개·활성 로트 0개 상태가 아닙니다. 중단합니다.');
    }
    writeFileSync(backupPath, JSON.stringify({ itemId: ref.id, stock: data.stock, lots }, null, 2));
    await getFirestore(app).runTransaction(async tx => {
      const current = (await tx.get(ref)).data()!;
      if (Number(current.stock) !== 40 || JSON.stringify(current.lots ?? []) !== JSON.stringify(lots)) {
        throw new Error('백업 이후 품목이 바뀌었습니다. 중단합니다.');
      }
      tx.update(ref, { lots: [...lots, {
        id: lotId, material: '수입들기름', supplierName: '출처 미상 이월',
        qtyIn: 40, qtyRemaining: 40, unitKg: 16.5, kgIn: 660, kgRemaining: 660,
        receivedDate: '2026-09-30', status: 'active', createdAt: '2026-09-30T00:00:00+09:00',
      }] });
    });
  } else {
    if (!existsSync(backupPath)) throw new Error('되돌릴 백업이 없습니다.');
    const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
    await getFirestore(app).runTransaction(async tx => {
      const current = (await tx.get(ref)).data()!;
      const correction = (current.lots ?? []).find((lot: any) => lot.id === lotId);
      const without = (current.lots ?? []).filter((lot: any) => lot.id !== lotId);
      if (Number(current.stock) !== backup.stock || correction?.qtyRemaining !== 40 ||
          JSON.stringify(without) !== JSON.stringify(backup.lots)) {
        throw new Error('정정 후 재고·로트가 바뀌었습니다. 자동 되돌리기를 중단합니다.');
      }
      tx.update(ref, { lots: backup.lots });
    });
  }
  const verified = (await ref.get()).data()!;
  const verifiedActive = (verified.lots ?? []).reduce((sum: number, lot: any) => sum + (lot.status === 'active' ? Number(lot.qtyRemaining ?? 0) : 0), 0);
  console.log(JSON.stringify({ action: apply ? 'applied' : 'undone', stock: verified.stock, activeLotQty: verifiedActive }));
} finally {
  await deleteApp(app);
}
