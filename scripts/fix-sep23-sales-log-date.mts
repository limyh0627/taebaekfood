/**
 * 9/23에 저장했지만 9/1로 잘못 찍힌 생산판매일지 1건과 연결 주문 5건의
 * 서류 기준일만 정정한다. 생산·원료·로트·실제 배송예정일은 바꾸지 않는다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { adminDb, 실행모드 } from './_admin.mts';

const db = adminDb();
const { APPLY, UNDO, 나머지 } = 실행모드();
if (APPLY && UNDO || 나머지.length ||
  process.argv.slice(2).some(arg => !['--dry', '--apply', '--undo'].includes(arg))) {
  throw new Error('지원 옵션: --dry(기본), --apply, --undo');
}
const LOG_ID = 'psl-1790145403309';
const OLD_DATE = '2026-09-01';
const NEW_DATE = '2026-09-23';
const OLD_DELIVERED_AT = `${OLD_DATE}T00:00:00.000Z`;
const NEW_DELIVERED_AT = `${NEW_DATE}T00:00:00.000Z`;
const BACKUP = '로컬전용/백업/sep23-sales-log-date-2026-09-25.json';
const ORDERS = [
  ['ORD-1789945052958', '훈장골'],
  ['ORD-1790062289178', '다농식품'],
  ['ORD-1790064230339', '거산농산'],
  ['ORD-1790120075766', '일성상회'],
  ['ORD-1790136107227', '대왕푸드'],
] as const;
const paths = [`productionSalesLogs/${LOG_ID}`, ...ORDERS.map(([id]) => `orders/${id}`)];
type Backup = {
  projectId: 'taebaek-3abe4';
  savedAt: string;
  before: Record<string, FirebaseFirestore.DocumentData>;
  changedFields: Record<string, { before: string; after: string }>;
};
const canon = (data: FirebaseFirestore.DocumentData) => JSON.parse(JSON.stringify(data));
const refs = paths.map(path => db.doc(path));

async function readOriginal(tx?: FirebaseFirestore.Transaction) {
  const docs = await Promise.all(refs.map(ref => tx ? tx.get(ref) : ref.get()));
  if (docs.some(doc => !doc.exists)) throw new Error('판매일지 또는 연결 주문을 찾을 수 없습니다.');
  const data = Object.fromEntries(docs.map((doc, index) => [paths[index], canon(doc.data()!)]));
  const log = data[paths[0]];
  if (log.companyId !== 'taebaek' || log.date !== OLD_DATE ||
    log.createdAt !== '2026-09-23T06:36:43.309Z' || log.orderCount !== 5 ||
    JSON.stringify(log.orderSummaries?.map((row: any) => row.partnerName)) !==
      JSON.stringify(ORDERS.map(([, name]) => name))) {
    throw new Error('9/23 판매일지 원본이 사전 조사와 다릅니다.');
  }
  for (const [index, [id, partner]] of ORDERS.entries()) {
    const order = data[`orders/${id}`];
    if (order.companyId !== 'taebaek' || order.partnerName !== partner ||
      order.status !== 'DELIVERED' || order.deliveredAt !== OLD_DELIVERED_AT ||
      String(order.createdAt ?? '') < '2026-09-20') {
      throw new Error(`연결 주문이 사전 조사와 다릅니다: ${id}`);
    }
  }
  return data;
}

if (UNDO) {
  if (!existsSync(BACKUP)) throw new Error('되돌릴 백업이 없습니다.');
  const backup = JSON.parse(readFileSync(BACKUP, 'utf8')) as Backup;
  if (backup.projectId !== 'taebaek-3abe4' ||
    JSON.stringify(Object.keys(backup.before)) !== JSON.stringify(paths)) {
    throw new Error('백업 대상이 다릅니다.');
  }
  await db.runTransaction(async tx => {
    const docs = await Promise.all(refs.map(ref => tx.get(ref)));
    docs.forEach((doc, index) => {
      const path = paths[index];
      const field = index === 0 ? 'date' : 'deliveredAt';
      if (!doc.exists || doc.data()?.[field] !== backup.changedFields[path]?.after) {
        throw new Error(`다른 값으로 바뀐 문서라 복원을 중단합니다: ${path}`);
      }
    });
    refs.forEach((ref, index) => {
      const path = paths[index];
      tx.update(ref, { [index === 0 ? 'date' : 'deliveredAt']: backup.changedFields[path].before });
    });
  });
  console.log('복원 완료: 판매일지 1건과 주문 5건의 서류 날짜를 9/1로 되돌렸습니다.');
  process.exit(0);
}

const before = await readOriginal();
if (existsSync(BACKUP)) throw new Error(`백업이 이미 있어 중복 적용을 중단합니다: ${BACKUP}`);
const changedFields = Object.fromEntries(paths.map((path, index) => [path,
  { before: index === 0 ? OLD_DATE : OLD_DELIVERED_AT,
    after: index === 0 ? NEW_DATE : NEW_DELIVERED_AT }]));
console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry',
  projectId: 'taebaek-3abe4', log: LOG_ID, oldDate: OLD_DATE, newDate: NEW_DATE,
  orders: ORDERS.map(([id, partner]) => ({ id, partner })),
  documentCount: paths.length, unchanged: ['생산·원료 원장', '재고·로트', '배송예정일'],
  backupOnApply: BACKUP,
}, null, 2));
if (!APPLY) process.exit(0);

mkdirSync(dirname(BACKUP), { recursive: true });
writeFileSync(BACKUP, JSON.stringify({ projectId: 'taebaek-3abe4',
  savedAt: new Date().toISOString(), before, changedFields } satisfies Backup, null, 2),
  { encoding: 'utf8', flag: 'wx' });
await db.runTransaction(async tx => {
  const current = await readOriginal(tx);
  if (JSON.stringify(current) !== JSON.stringify(before)) {
    throw new Error('사전 확인 이후 판매일지·주문 본문이 바뀌어 적용을 중단합니다.');
  }
  refs.forEach((ref, index) => tx.update(ref,
    { [index === 0 ? 'date' : 'deliveredAt']: index === 0 ? NEW_DATE : NEW_DELIVERED_AT }));
});
const verified = await db.getAll(...refs);
verified.forEach((doc, index) => {
  const expected = index === 0 ? NEW_DATE : NEW_DELIVERED_AT;
  if (!doc.exists || doc.data()?.[index === 0 ? 'date' : 'deliveredAt'] !== expected) {
    throw new Error(`적용 뒤 재조회가 다릅니다: ${paths[index]}`);
  }
});
console.log('적용·재조회 완료: 판매일지 1건·주문 5건.');
