/**
 * 다미원 ORD-260915-016의 권한 실패 잠금을 점검하고, 부분 반영이 전혀 없을 때만 해제한다.
 *
 * 기본은 읽기 전용이다. --apply 때 백업 후 inventoryOperation만 지우며 --undo로 복원한다.
 * 로그인 정보는 환경변수로만 받고 파일·출력에 남기지 않는다.
 */
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithCustomToken } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { collection, deleteField, doc, getDoc, getDocs, getFirestore, query, updateDoc, where } from 'firebase/firestore';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const ORDER_ID = 'ORD-1789455093683';
const COMPANY_ID = 'taebaek';
const BACKUP = '로컬전용/백업/damiwon-inventory-lock-2026-09-17.json';
const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
if (APPLY && UNDO) throw new Error('--apply와 --undo를 함께 쓸 수 없습니다.');

const username = process.env.TAEBAEK_DIAG_USERNAME;
const password = process.env.TAEBAEK_DIAG_PASSWORD;
if (!username || !password) throw new Error('TAEBAEK_DIAG_USERNAME/TAEBAEK_DIAG_PASSWORD가 필요합니다.');

const app = initializeApp({
  apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE',
  authDomain: 'taebaek-3abe4.firebaseapp.com',
  projectId: 'taebaek-3abe4',
});
const auth = getAuth(app);
const functions = getFunctions(app, 'asia-northeast3');
const login = httpsCallable(functions, 'employeeLogin');
const result = await login({ username, password, app: 'admin', companyId: COMPANY_ID });
const customToken = String((result.data as Record<string, unknown>).customToken ?? '');
if (!customToken) throw new Error('직원 로그인 토큰을 받지 못했습니다.');
await signInWithCustomToken(auth, customToken);
const db = getFirestore(app);
const orderRef = doc(db, 'orders', ORDER_ID);

if (UNDO) {
  if (!existsSync(BACKUP)) throw new Error(`백업이 없습니다: ${BACKUP}`);
  const backup = JSON.parse(readFileSync(BACKUP, 'utf8')) as { inventoryOperation: unknown };
  await updateDoc(orderRef, { inventoryOperation: backup.inventoryOperation });
  console.log(`${ORDER_ID} 실패 잠금을 백업 상태로 복원했습니다.`);
  await deleteApp(app);
  process.exit(0);
}

const orderSnap = await getDoc(orderRef);
if (!orderSnap.exists()) throw new Error(`주문이 없습니다: ${ORDER_ID}`);
const order = { id: orderSnap.id, ...orderSnap.data() } as Record<string, any>;
const companyRows = async (name: string) => (await getDocs(query(collection(db, name), where('companyId', '==', COMPANY_ID))))
  .docs.map(row => ({ id: row.id, ...row.data() } as Record<string, any>));

const [items, jobs, ledger, productions, audits] = await Promise.all([
  companyRows('items'), companyRows('rawInventoryJobs'), companyRows('rawMaterialLedger'),
  companyRows('productionRecords'), companyRows('orderStatusAudits'),
]);
const reservations = items.flatMap(item => (Array.isArray(item.inventoryReservations) ? item.inventoryReservations : [])
  .filter((row: Record<string, unknown>) => row.orderId === ORDER_ID)
  .map((row: Record<string, unknown>) => ({ itemId: item.id, ...row })));
const relatedJobs = jobs.filter(row => row.source?.id === ORDER_ID || String(row.id).includes(ORDER_ID));
const relatedLedger = ledger.filter(row => row.source?.id === ORDER_ID || String(row.operationId ?? '').includes(ORDER_ID));
const relatedProductions = productions.filter(row => String(row.id).includes(ORDER_ID));
const relatedAudits = audits.filter(row => row.orderId === ORDER_ID);
const checked = (Array.isArray(order.items) ? order.items : []).filter((item: Record<string, unknown>) => item.checked || item.producedAt);
const partial = reservations.length + relatedJobs.length + relatedLedger.length + relatedProductions.length + relatedAudits.length + checked.length;
const resumableRawUse = relatedJobs.length === 1
  && relatedJobs[0]?.status === 'complete'
  && relatedLedger.length === 1
  && relatedLedger[0]?.operationId === relatedJobs[0]?.expectedOperationIds?.[0]
  && relatedLedger[0]?.kind === 'consume'
  && reservations.length === 0
  && relatedProductions.length === 0
  && relatedAudits.length === 0
  && checked.length === 0;

console.log(JSON.stringify({
  order: { id: order.id, orderNo: order.orderNo, partnerName: order.partnerName, status: order.status },
  inventoryOperation: order.inventoryOperation,
  evidence: {
    checkedItems: checked.length,
    reservations: reservations.length,
    rawInventoryJobs: relatedJobs.length,
    rawMaterialLedger: relatedLedger.length,
    productionRecords: relatedProductions.length,
    orderStatusAudits: relatedAudits.length,
  },
  relatedJobs: relatedJobs.map(row => ({
    id: row.id, status: row.status, source: row.source,
    expectedOperationIds: row.expectedOperationIds, lastError: row.lastError,
  })),
  relatedLedger: relatedLedger.map(row => ({
    id: row.id, operationId: row.operationId, kind: row.kind, rawItemId: row.rawItemId,
    material: row.material, reportedDeltaKg: row.reportedDeltaKg, lotChanges: row.lotChanges,
    source: row.source, createdAt: row.createdAt,
  })),
  relatedProductions: relatedProductions.map(row => ({ id: row.id, itemId: row.itemId, finishedQty: row.finishedQty })),
  reservations,
}, null, 2));

if (order.inventoryOperation?.state !== 'failed') throw new Error('현재 실패 잠금이 아닙니다.');
if (order.inventoryOperation?.error !== 'Missing or insufficient permissions.') throw new Error('예상한 권한 실패가 아닙니다.');
if (partial !== 0 && !resumableRawUse) throw new Error('예상하지 못한 부분 반영 근거가 있어 잠금을 풀지 않습니다.');
if (!APPLY) {
  console.log(resumableRawUse
    ? '원료 차감 1건은 완료됐고 이후 단계는 0건입니다. 재시도 시 같은 작업번호가 중복 차감을 막습니다. --apply 때 실패 잠금만 삭제합니다.'
    : '부분 반영 0건입니다. --apply 때 inventoryOperation만 삭제합니다.');
  await deleteApp(app);
  process.exit(0);
}
if (existsSync(BACKUP)) throw new Error(`백업이 이미 있습니다. 중복 실행을 막았습니다: ${BACKUP}`);
mkdirSync(dirname(BACKUP), { recursive: true });
writeFileSync(BACKUP, JSON.stringify({ backedUpAt: new Date().toISOString(), orderId: ORDER_ID, inventoryOperation: order.inventoryOperation }, null, 2), 'utf8');
await updateDoc(orderRef, { inventoryOperation: deleteField() });
const verified = await getDoc(orderRef);
if (verified.data()?.inventoryOperation != null) throw new Error('잠금 해제 후 재조회 검증에 실패했습니다.');
console.log(`원료 차감 기록은 유지하고 실패 잠금만 해제했습니다. 백업: ${BACKUP}`);
await deleteApp(app);
