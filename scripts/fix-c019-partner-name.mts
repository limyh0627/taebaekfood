/** C019 거래처 옛 표시명만 정정한다. 기본 dry / --apply / --undo. 주문은 --orders로 별도 선택. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { adminDb, 실행모드 } from './_admin.mts';

const { APPLY, UNDO } = 실행모드();
const WITH_ORDERS = process.argv.includes('--orders');
if (APPLY && UNDO) throw new Error('--apply와 --undo를 함께 쓸 수 없습니다.');
const db = adminDb();
const PARTNER_ID = 'C019';
const BEFORE_NAME = '대한농산';
const AFTER_NAME = '오남두부야';
const BACKUP = '로컬전용/백업/c019-partner-name-2026-09-24.json';

type Target = { path: string; date: string; dateField: 'tradeDate' | 'date' | 'createdAt' };
const required: Target[] = [
  { path: 'issuedStatements/stmt-1788797362181', date: '2026-09-07', dateField: 'tradeDate' },
  { path: 'issuedStatements/stmt-open-C019-매출', date: '2026-07-31', dateField: 'tradeDate' },
  { path: 'cashEntries/cash-1789367246555', date: '2026-08-31', dateField: 'date' },
  { path: 'cashEntries/cash-1790252416259', date: '2026-09-21', dateField: 'date' },
];
const optional: Target[] = [
  { path: 'orders/ORD-1788767317389', date: '2026-09-07', dateField: 'createdAt' },
  { path: 'orders/ORD-1788769243192', date: '2026-09-07', dateField: 'createdAt' },
];

type BackupRow = Target & { before: { companyId: string; partnerId: string; partnerName: string; dateValue: string }; afterName: string };
type Backup = { savedAt: string; partnerId: string; rows: BackupRow[] };

function assertRow(data: FirebaseFirestore.DocumentData | undefined, row: BackupRow, expectedName: string): void {
  if (data?.companyId !== row.before.companyId || data?.partnerId !== row.before.partnerId ||
      data?.partnerName !== expectedName || String(data?.[row.dateField] ?? '') !== row.before.dateValue) {
    throw new Error(`현재 문서가 백업의 회사·거래처·날짜·이름과 다릅니다: ${row.path}`);
  }
}

if (UNDO) {
  if (!existsSync(BACKUP)) throw new Error(`백업이 없습니다: ${BACKUP}`);
  const backup = JSON.parse(readFileSync(BACKUP, 'utf8')) as Backup;
  if (backup.partnerId !== PARTNER_ID || backup.rows.length < 4) throw new Error('백업 대상이 예상과 다릅니다.');
  await db.runTransaction(async tx => {
    const snaps = await Promise.all(backup.rows.map(row => tx.get(db.doc(row.path))));
    snaps.forEach((snap, index) => {
      if (!snap.exists) throw new Error(`되돌리기 대상이 없습니다: ${backup.rows[index].path}`);
      assertRow(snap.data(), backup.rows[index], backup.rows[index].afterName);
    });
    backup.rows.forEach(row => tx.update(db.doc(row.path), { partnerName: row.before.partnerName }));
  });
  for (const row of backup.rows) {
    const snap = await db.doc(row.path).get();
    if (snap.data()?.partnerName !== row.before.partnerName) throw new Error(`되돌리기 재조회 실패: ${row.path}`);
  }
  console.log(`복구·재조회 완료: ${backup.rows.length}건`);
  process.exit(0);
}

const partner = await db.doc(`partners/${PARTNER_ID}`).get();
if (!partner.exists || partner.data()?.companyId !== 'taebaek' || partner.data()?.name !== AFTER_NAME) {
  throw new Error(`partners/${PARTNER_ID}의 현재 회사·이름이 예상과 다릅니다.`);
}
const targets = [...required, ...(WITH_ORDERS ? optional : [])];
const rows: BackupRow[] = [];
for (const target of targets) {
  const snap = await db.doc(target.path).get();
  const data = snap.data();
  if (!snap.exists || data?.companyId !== 'taebaek' || data?.partnerId !== PARTNER_ID || data?.partnerName !== BEFORE_NAME) {
    throw new Error(`대상 회사·거래처·옛 이름이 예상과 다릅니다: ${target.path}`);
  }
  const actualDate = String(data[target.dateField] ?? '').slice(0, 10);
  if (actualDate !== target.date) throw new Error(`날짜가 예상과 다릅니다: ${target.path} ${target.dateField}=${actualDate}`);
  rows.push({ ...target, before: { companyId: data.companyId, partnerId: data.partnerId,
    partnerName: data.partnerName, dateValue: String(data[target.dateField]) }, afterName: AFTER_NAME });
}
console.log(`${APPLY ? '적용' : '미리보기(dry)'}: C019 ${BEFORE_NAME} → ${AFTER_NAME}, ${rows.length}건${WITH_ORDERS ? ' (주문 포함)' : ' (주문 제외)'}`);
for (const row of rows) console.log(`  ${row.path}: ${row.before.partnerName} → ${row.afterName}`);
if (!APPLY) { console.log('쓰기 없음. 적용하려면 --apply (주문은 --orders)'); process.exit(0); }
if (existsSync(BACKUP)) throw new Error(`기존 백업이 있습니다. 중복 적용을 막습니다: ${BACKUP}`);
mkdirSync(dirname(BACKUP), { recursive: true });
writeFileSync(BACKUP, JSON.stringify({ savedAt: new Date().toISOString(), partnerId: PARTNER_ID, rows } satisfies Backup, null, 2), { encoding: 'utf8', flag: 'wx' });
try {
  await db.runTransaction(async tx => {
    const snaps = await Promise.all(rows.map(row => tx.get(db.doc(row.path))));
    snaps.forEach((snap, index) => {
      if (!snap.exists) throw new Error(`적용 대상이 없습니다: ${rows[index].path}`);
      assertRow(snap.data(), rows[index], rows[index].before.partnerName);
    });
    rows.forEach(row => tx.update(db.doc(row.path), { partnerName: row.afterName }));
  });
} catch (error) {
  // 서버 커밋 뒤 응답만 끊길 수도 있다. 백업은 남기고 실제 문서를 재조회해 사람이 판정한다.
  console.error(`트랜잭션 결과 불명확: ${error instanceof Error ? error.message : String(error)}`);
  console.error(`백업 보존: ${BACKUP}. 적용·재시도 전에 다음 재조회 결과를 확인하세요.`);
  for (const row of rows) {
    try {
      const current = (await db.doc(row.path).get()).data();
      console.error(`  ${row.path}: ${current?.partnerName ?? '(읽기 실패/문서 없음)'}`);
    } catch (readError) {
      console.error(`  ${row.path}: 재조회 실패 (${readError instanceof Error ? readError.message : String(readError)})`);
    }
  }
  throw error;
}
for (const row of rows) {
  const snap = await db.doc(row.path).get();
  if (snap.data()?.partnerName !== row.afterName) throw new Error(`적용 뒤 재조회 실패: ${row.path}`);
}
console.log(`적용·재조회 완료: ${rows.length}건. 백업: ${BACKUP}`);
