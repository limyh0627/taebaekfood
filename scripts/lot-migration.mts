/**
 * 원료 로트 도입 마이그레이션 (되돌리기 가능)
 *   apply : ① 재고>0·로트없음 raw 품목에 '이월' 로트 시드(수불부 잔량 이월)
 *           ② 캔 누적 SKU(깨분참기름/16.5kg, p-1779251603644) stock 0으로 정리
 *   undo  : 백업(scripts/lot-migration-backup.json)으로 원복
 *
 * 실행: npx tsx scripts/lot-migration.mts --dry    (미리보기, 쓰기 없음)
 *       npx tsx scripts/lot-migration.mts          (적용)
 *       npx tsx scripts/lot-migration.mts --undo   (원복)
 * 변환은 실제 앱 함수(withCarryOverLot/lotStockInUnit)를 그대로 사용해 드리프트 방지.
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { baseRawName, lotStockInUnit } from '../src/constants/formula';
import { withCarryOverLot } from '../src/shared/lotUtils';

const firebaseConfig = { apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' };
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

const BACKUP = new URL('./lot-migration-backup.json', import.meta.url);
const CAN_SKU = 'p-1779251603644'; // 깨분참기름/16.5kg (캔 누적 SKU)
const undo = process.argv.includes('--undo');
const dry = process.argv.includes('--dry');

if (undo) {
  if (!existsSync(BACKUP)) { console.error('백업 파일이 없습니다. 원복 불가.'); process.exit(1); }
  const backup = JSON.parse(readFileSync(BACKUP, 'utf8')) as Record<string, { stock: number; lots: unknown[] | null }>;
  let n = 0;
  for (const [id, prev] of Object.entries(backup)) {
    await updateDoc(doc(db, 'items', id), { stock: prev.stock, lots: prev.lots ?? [] });
    console.log(`  ↩ 원복 ${id}: stock=${prev.stock}, lots=${(prev.lots ?? []).length}건`);
    n++;
  }
  console.log(`\n원복 완료: ${n}건`);
  process.exit(0);
}

const itemsSnap = await getDocs(collection(db, 'items'));
const backup: Record<string, { stock: number; lots: unknown[] | null }> = {};
const plan: string[] = [];

for (const d of itemsSnap.docs) {
  const x = d.data();
  // ① raw 품목 이월 로트 시드
  if (x.category === 'raw' && (x.stock ?? 0) > 0 && !(Array.isArray(x.lots) && x.lots.length > 0)) {
    const material = baseRawName(x.name);
    const seeded = withCarryOverLot([], x.stock, material);
    if (seeded.length > 0) {
      const newStock = lotStockInUnit(seeded, material);
      backup[d.id] = { stock: x.stock ?? 0, lots: x.lots ?? null };
      if (!dry) await updateDoc(doc(db, 'items', d.id), { lots: seeded, stock: newStock });
      plan.push(`  ✚ 이월 로트  ${d.id} "${x.name}"  ${seeded[0].kgRemaining}kg (stock ${x.stock}→${newStock})`);
    }
  }
}

// ② 캔 누적 SKU stock 0 정리
const canDoc = itemsSnap.docs.find(d => d.id === CAN_SKU);
if (canDoc && (canDoc.data().stock ?? 0) !== 0) {
  backup[CAN_SKU] = { stock: canDoc.data().stock ?? 0, lots: canDoc.data().lots ?? null };
  if (!dry) await updateDoc(doc(db, 'items', CAN_SKU), { stock: 0 });
  plan.push(`  🧹 캔 누적 정리  ${CAN_SKU} "${canDoc.data().name}"  stock ${canDoc.data().stock}→0`);
}

console.log(dry ? '████ [DRY-RUN] 변경 예정 (쓰기 없음) ████' : '████ 적용 내역 ████');
plan.forEach(p => console.log(p));
if (!dry) {
  writeFileSync(BACKUP, JSON.stringify(backup, null, 2), 'utf8');
  console.log(`\n총 ${plan.length}건 적용. 백업: scripts/lot-migration-backup.json (원복: --undo)`);
} else {
  console.log(`\n총 ${plan.length}건 예정. 실제 적용하려면 --dry 빼고 실행.`);
}
process.exit(0);
