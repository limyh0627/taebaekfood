/**
 * 고아 BOM `SK` 때문에 멈춘 일성상회 주문의 실패 잠금만 푼다.
 * 원료 job·원료원장·완제품 예약·생산기록이 모두 0건임을 먼저 읽기 전용으로 확인했다.
 *
 *   npx tsx scripts/fix-ilsung-order-inventory-lock.mts
 *   npx tsx scripts/fix-ilsung-order-inventory-lock.mts --apply
 *   npx tsx scripts/fix-ilsung-order-inventory-lock.mts --undo
 */
import { deleteApp, initializeApp } from 'firebase/app';
import { doc, getDoc, getFirestore, updateDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const ORDER_ID = 'ORD-1789085255034';
const BACKUP = 'scripts/fix-ilsung-order-inventory-lock-backup.json';
const mode = process.argv.includes('--apply') ? 'apply'
  : process.argv.includes('--undo') ? 'undo' : 'dry';
const app = initializeApp({
  apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE',
  authDomain: 'taebaek-3abe4.firebaseapp.com',
  projectId: 'taebaek-3abe4',
});
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const ref = doc(db, 'orders', ORDER_ID);

if (mode === 'undo') {
  if (!existsSync(BACKUP)) throw new Error('백업이 없어 되돌릴 수 없다.');
  const backup = JSON.parse(readFileSync(BACKUP, 'utf8')) as { inventoryOperation: unknown };
  await updateDoc(ref, { inventoryOperation: backup.inventoryOperation });
  console.log(`${ORDER_ID} 실패 잠금을 복원했다.`);
  await deleteApp(app);
  process.exit(0);
}

const snapshot = await getDoc(ref);
if (!snapshot.exists()) throw new Error(`주문이 없다: ${ORDER_ID}`);
const order = snapshot.data() as any;
console.log(JSON.stringify({ orderId: ORDER_ID, partnerName: order.partnerName, status: order.status, inventoryOperation: order.inventoryOperation }, null, 2));
if (order.inventoryOperation?.state !== 'failed') {
  console.log('실패 잠금이 없어 손대지 않는다.');
  await deleteApp(app);
  process.exit(0);
}
if (mode === 'dry') {
  console.log('\n미리보기다. 실패 잠금만 풀려면 --apply');
  await deleteApp(app);
  process.exit(0);
}
if (existsSync(BACKUP)) throw new Error(`${BACKUP}이 이미 있다. 두 번 적용하지 않는다.`);
writeFileSync(BACKUP, JSON.stringify({ backedUpAt: new Date().toISOString(), inventoryOperation: order.inventoryOperation }, null, 2), 'utf8');
await updateDoc(ref, { inventoryOperation: null });
console.log(`\n백업을 남기고 ${ORDER_ID} 실패 잠금을 해제했다.`);
await deleteApp(app);
