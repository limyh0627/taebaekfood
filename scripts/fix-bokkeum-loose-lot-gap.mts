/**
 * 볶음참깨-낱개/1kg의 제품 로트를 현재 items.stock에 맞춘다.
 * 기본은 미리보기. 적용: --apply, 복구: --undo
 */
import { readFile, writeFile, access } from 'node:fs/promises';
import { cert, deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { anchorLotsByQty } from '../src/shared/lotAnchor';
import { lotQtyRemaining, pruneDepletedLots } from '../src/shared/lotUtils';
import type { RawMaterialLot } from '../src/shared/types';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const ITEM_ID = 'PLDhkjOgcPIhO1hhReHm';
const BACKUP = 'scripts/fix-bokkeum-loose-lot-gap-backup.json';
const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'C:\\Users\\TAEBAEK\\.secrets\\taebaek-admin.json';
const app = initializeApp({ credential: cert(JSON.parse(await readFile(keyPath, 'utf8'))), projectId: 'taebaek-3abe4' }, `fix-bokkeum-${Date.now()}`);
const db = getFirestore(app);

try {
  const ref = db.collection('items').doc(ITEM_ID);
  if (UNDO) {
    await access(BACKUP);
    const backup = JSON.parse(await readFile(BACKUP, 'utf8')) as { stock: number; lots: RawMaterialLot[] };
    await ref.update({ stock: backup.stock, lots: backup.lots });
    console.log(`복구 완료: stock ${backup.stock}, 로트 ${lotQtyRemaining(backup.lots)}`);
    process.exitCode = 0;
  } else {
    const snap = await ref.get();
    if (!snap.exists) throw new Error(`품목이 없습니다: ${ITEM_ID}`);
    const data = snap.data()!;
    const stock = Number(data.stock ?? 0);
    const lots = (data.lots ?? []) as RawMaterialLot[];
    const before = lotQtyRemaining(lots);
    const result = anchorLotsByQty({
      lots, targetQty: stock,
      unitKg: lots.find(l => l.unitKg)?.unitKg ?? 1,
      det: { id: `stocktake-${ITEM_ID}-${Date.now()}`, createdAt: new Date().toISOString(), receivedDate: new Date().toISOString().slice(0, 10) },
    });
    const nextLots = pruneDepletedLots(result.lots);
    const after = lotQtyRemaining(nextLots);
    console.log(`볶음참깨-낱개/1kg: stock ${stock}, 로트 ${before} → ${after}`);
    if (Math.abs(after - stock) > 0.001) throw new Error(`보정 계산 실패: 목표 ${stock}, 계산 ${after}`);
    if (!APPLY) {
      console.log('미리보기입니다. 적용하려면 --apply');
    } else {
      await access(BACKUP).then(() => { throw new Error(`기존 백업이 있습니다: ${BACKUP}`); }).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      });
      await writeFile(BACKUP, JSON.stringify({ savedAt: new Date().toISOString(), itemId: ITEM_ID, stock, lots }, null, 2), 'utf8');
      await ref.update({ lots: nextLots, stock });
      const verify = (await ref.get()).data()!;
      const verified = lotQtyRemaining((verify.lots ?? []) as RawMaterialLot[]);
      if (Math.abs(Number(verify.stock ?? 0) - verified) > 0.001) throw new Error(`적용 후 검증 실패: stock ${verify.stock}, 로트 ${verified}`);
      console.log(`적용·재조회 검증 완료: stock ${verify.stock}, 로트 ${verified}`);
    }
  }
} finally {
  await deleteApp(app);
}
