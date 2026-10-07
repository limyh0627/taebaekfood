import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import { assertVoucherDateAllowed } from './releaseGate';

const fail = (): never => { throw new HttpsError('failed-precondition', '신규 번호 카운터 초기화 조건이 준비되지 않았습니다.'); };
const owner = (row: admin.firestore.DocumentData) => row.companyId ?? 'taebaek';

function assertNewScope(gate: admin.firestore.DocumentSnapshot, companyId: string, date: string, oem = false) {
  if (!oem) assertVoucherDateAllowed(gate, companyId, date);
  else {
    const cutover = gate.data()?.oemLotCutoverDate;
    const valid = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
    if (!valid(cutover) || !valid(date) || date < cutover) fail();
  }
  const row = gate.data();
  if (row?.status !== 'active' || typeof row.releaseId !== 'string' || !row.releaseId
    || row.oldWritersBlocked !== true || typeof row.oldWritersBlockedEvidence !== 'string'
    || !row.oldWritersBlockedEvidence.trim()) fail();
}

/** 신규 scope에만 전체 번호 원장을 확인한다. 과거/추가번호 누락은 재생성하지 않는다. */
export async function readVoucherCounter(db: admin.firestore.Firestore, tx: admin.firestore.Transaction,
  snap: admin.firestore.DocumentSnapshot, gate: admin.firestore.DocumentSnapshot,
  companyId: string, date: string, prefix: string): Promise<admin.firestore.DocumentData> {
  if (snap.exists) return snap.data()!;
  if (!['', '가공', '반품', '대체', '급여'].includes(prefix)) fail();
  assertNewScope(gate, companyId, date);
  // ponytail: 첫 발행만 전체 조회. 규모가 커지면 검증된 번호 사용 ledger로 교체한다.
  const collections = await Promise.all(['issuedStatements', 'cashEntries'].map(name => tx.get(db.collection(name))));
  const stamp = date.slice(2).replace(/-/g, '');
  for (const collection of collections) for (const doc of collection.docs) {
    const row = doc.data();
    if (owner(row) !== companyId) continue;
    const number = typeof row.docNo === 'string' ? row.docNo : '';
    const parsed = /^(.*)(\d{6})-(\d+)$/.exec(number);
    if (number.startsWith(`${prefix}${stamp}-`)
      || (row.tradeDate === date || row.date === date) && (!parsed || parsed[1] === prefix)
      || row.issuePrefix === prefix && (row.tradeDate === date || row.date === date)) fail();
  }
  return { companyId, tradeDate: date, prefix, last: 0, initializedByRelease: gate.data()!.releaseId };
}

export function writeVoucherCounter(tx: admin.firestore.Transaction, snap: admin.firestore.DocumentSnapshot,
  state: admin.firestore.DocumentData, last: number) {
  if (snap.exists) tx.update(snap.ref, { last });
  else tx.create(snap.ref, { ...state, last });
}

export async function readOemCounter(db: admin.firestore.Firestore, tx: admin.firestore.Transaction,
  snap: admin.firestore.DocumentSnapshot, gate: admin.firestore.DocumentSnapshot,
  companyId: string, date: string, material: string): Promise<admin.firestore.DocumentData> {
  if (snap.exists) return snap.data()!;
  assertNewScope(gate, companyId, date, true);
  const [items, orders, operations] = await Promise.all([
    tx.get(db.collection('items')), tx.get(db.collection('purchaseOrders')), tx.get(db.collection('oemReceiptOperations')),
  ]);
  const prefix = `${date.slice(2).replace(/-/g, '')}-`;
  for (const doc of items.docs) {
    const row = doc.data();
    if (owner(row) !== companyId) continue;
    if (row.lots !== undefined && !Array.isArray(row.lots)) fail();
    for (const lot of row.lots ?? []) {
      if (!lot || typeof lot !== 'object') fail();
      if ((String(lot.receivedDate ?? '').slice(0, 10) === date || String(lot.lotNo ?? '').startsWith(prefix))
        && (!lot.material || lot.material === material)) fail();
    }
  }
  // 소진 로트가 삭제되어도 발주/operation 근거가 있으면 0으로 되돌리지 않는다.
  for (const doc of orders.docs) {
    const row = doc.data();
    if (owner(row) === companyId && row.poType === 'oem' && row.status === 'received'
      && String(row.receivedAt ?? '').slice(0, 10) === date) {
      const operation = operations.docs.map(candidate => candidate.data()).find(candidate =>
        owner(candidate) === companyId && candidate.poId === doc.id);
      if (!operation || operation.date !== date || !Array.isArray(operation.materials)
        || operation.materials.includes(material)) fail();
    }
  }
  for (const doc of operations.docs) {
    const row = doc.data();
    if (owner(row) === companyId && Object.values(row.lotNos ?? {}).some(no => String(no).startsWith(prefix))
      && (!Array.isArray(row.materials) || row.materials.includes(material))) fail();
  }
  return { companyId, date, material, lastSequence: 0, initializedByRelease: gate.data()!.releaseId };
}
