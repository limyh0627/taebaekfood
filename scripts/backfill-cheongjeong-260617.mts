/**
 * 06-17 (인천)청정식품 깨분참기름 20캔(330kg) 입고 백필 — quota로 누락된 로트+수불부 복구.
 * 멱등(이미 있으면 skip), 되돌리기 가능(--undo).
 *   npx tsx scripts/backfill-cheongjeong-260617.mts          (적용)
 *   npx tsx scripts/backfill-cheongjeong-260617.mts --undo   (원복)
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, updateDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { buildReceiveLot, nextLotNo } from '../src/shared/lotUtils';
import { lotStockInUnit } from '../src/constants/formula';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

const RAW = 'raw-깨분참기름';
const MATERIAL = '깨분참기름';
const SUPPLIER = '(인천)청정식품';
const DATE = '2026-06-17';
const QTY = 20, PKG = 16.5, KG = QTY * PKG; // 330
const LEDGER_ID = 'rm-backfill-cheongjeong-20260617';
const BACKUP = new URL('./backfill-cheongjeong-backup.json', import.meta.url);
const undo = process.argv.includes('--undo');

const ref = doc(db, 'items', RAW);

if (undo) {
  if (!existsSync(BACKUP)) { console.error('백업 없음, 원복 불가'); process.exit(1); }
  const prev = JSON.parse(readFileSync(BACKUP, 'utf8'));
  await updateDoc(ref, { lots: prev.lots, stock: prev.stock });
  await deleteDoc(doc(db, 'rawMaterialLedger', LEDGER_ID));
  console.log(`원복 완료: lots ${prev.lots.length}건/stock ${prev.stock}로 복구 + 수불부 삭제`);
  process.exit(0);
}

const snap = await getDoc(ref);
if (!snap.exists()) { console.error('raw-깨분참기름 없음'); process.exit(1); }
const cur = Array.isArray(snap.data().lots) ? snap.data().lots : [];

// 멱등: 같은 거래처+날짜 로트가 이미 있으면 중단
if (cur.some(l => l.supplierName === SUPPLIER && l.receivedDate === DATE)) {
  console.log('이미 06-17 청정식품 로트가 있음 → 백필 안 함(중복 방지).');
  process.exit(0);
}

// 백업
writeFileSync(BACKUP, JSON.stringify({ lots: cur, stock: snap.data().stock ?? 0 }, null, 2), 'utf8');

// 로트 생성 (앱 코드와 동일 함수)
const lot = buildReceiveLot({ material: MATERIAL, supplierName: SUPPLIER, qtyIn: QTY, kgIn: KG, packageType: '캔', packageKg: PKG, receivedDate: DATE });
lot.lotNo = nextLotNo(cur, DATE);
const nextLots = [...cur, lot];
const newStock = lotStockInUnit(nextLots, MATERIAL);
const stripped = JSON.parse(JSON.stringify(nextLots)); // undefined 제거
await updateDoc(ref, { lots: stripped, stock: newStock });

// 수불부 기록 (kg)
await setDoc(doc(db, 'rawMaterialLedger', LEDGER_ID), {
  id: LEDGER_ID, material: MATERIAL, date: DATE, received: KG, used: 0,
  note: `${SUPPLIER} 입고 (백필)`, createdAt: new Date().toISOString(),
  type: 'manual', unit: 'kg', canSize: PKG, canCount: QTY, originalAmount: QTY, originalUnit: 'kg',
});

console.log(`✅ 백필 완료`);
console.log(`  로트 추가: ${SUPPLIER} ${QTY}캔×${PKG}=${KG}kg, lotNo=${lot.lotNo}`);
console.log(`  원료 재고: ${snap.data().stock} → ${newStock} L`);
console.log(`  수불부: +${KG}kg (${LEDGER_ID})`);
console.log(`  되돌리기: npx tsx scripts/backfill-cheongjeong-260617.mts --undo`);
process.exit(0);
