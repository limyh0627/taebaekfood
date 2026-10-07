import { readVoucherCounter, writeVoucherCounter } from './newScopeCounter';
import * as admin from 'firebase-admin';
import { createHash } from 'crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { formatVoucherNo, voucherSequenceKey } from './voucherIssue';
import { assertReleaseActive, assertVoucherDateAllowed, releaseGateRef } from './releaseGate';

type Row = Record<string, any>;
type Input = { poId: string; perKg: number; statement: Row; releaseId: string };
const fail = (message: string): never => { throw new HttpsError('failed-precondition', message); };
const invalid = (message: string): never => { throw new HttpsError('invalid-argument', message); };
const ownCompany = (row: Row) => row.companyId ?? 'taebaek';
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
const lineAmount = (qty: number, price: number, exempt: boolean) => {
  const total = Math.round(qty * price);
  const supply = exempt ? total : Math.round(total / 1.1);
  return { supply, tax: total - supply, total };
};
const packageKg = (value: unknown) => {
  const matched = /([\d.]+)\s*kg/i.exec(String(value ?? ''));
  return matched ? Number(matched[1]) : 0;
};
const specCount = (value: unknown) => {
  const matched = /[*x×]\s*([\d.]+)/i.exec(String(value ?? ''));
  const count = matched ? Number(matched[1]) : NaN;
  return Number.isFinite(count) && count > 0 ? count : 1;
};
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value as Row).filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
    : value;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const business = (row: Row) => {
  const { id: _id, docNo: _no, issuedAt: _time, createdBy: _by,
    issueOperationId: _op, issuePayloadHash: _hash, issueVoucherNo: _savedNo, ...body } = row;
  return body;
};

/** One OEM fee, its PO link and the shared 가공 sequence are a single transaction. */
export async function issueOemFeeVoucher(db: admin.firestore.Firestore, companyId: string, input: Input): Promise<string> {
  if (!input || typeof input !== 'object') invalid('가공비 발행 요청이 잘못되었습니다.');
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(input.releaseId)) invalid('배포 전환 ID가 필요합니다.');
  const { poId, perKg, statement: supplied } = input;
  if (typeof poId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(poId)
    || !finite(perKg) || perKg <= 0 || !supplied || typeof supplied !== 'object' || Array.isArray(supplied)) invalid('가공비 입력이 잘못되었습니다.');
  const stmt = supplied as Row;
  const statementId = `OEMFEE-${poId}`;
  if (stmt.id !== statementId || stmt.orderId !== poId || stmt.type !== '매입'
    || (stmt.companyId !== undefined && stmt.companyId !== companyId)) invalid('가공비 전표 회사·배치가 일치하지 않습니다.');
  const date = stmt.tradeDate;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) invalid('가공비 전표일이 잘못되었습니다.');
  if (!Array.isArray(stmt.items) || !stmt.items.length || stmt.items.some((line: Row) =>
    !line || typeof line !== 'object' || !line.accountCode || !finite(line.qty)
    || line.qty <= 0 || !finite(line.price) || line.price <= 0
    || !finite(line.supply) || line.supply < 0 || !finite(line.tax) || line.tax < 0
    || !finite(line.total) || line.total <= 0 || line.supply + line.tax !== line.total
    || line.accountCode !== '540' || typeof line.isTaxExempt !== 'boolean'
    || lineAmount(1, line.total, line.isTaxExempt).supply !== line.supply)) invalid('가공비 전표 줄이 잘못되었습니다.');
  const sums = stmt.items.reduce((acc: number[], line: Row) => [acc[0] + line.supply, acc[1] + line.tax, acc[2] + line.total], [0, 0, 0]);
  if (![stmt.totalSupply, stmt.totalTax, stmt.totalAmount].every(finite)
    || sums.some((n: number, i: number) => n !== [stmt.totalSupply, stmt.totalTax, stmt.totalAmount][i])) invalid('가공비 전표 합계가 일치하지 않습니다.');
  const exempt = stmt.items.every((line: Row) => line.isTaxExempt === true);
  const taxable = stmt.items.every((line: Row) => line.isTaxExempt === false);
  if (!exempt && !taxable) invalid('가공비 과세 기준이 섞였습니다.');
  const semantic = { ...business(stmt), companyId };
  const payloadHash = hash({ statement: semantic, perKg });
  const poRef = db.collection('purchaseOrders').doc(poId);
  const statementRef = db.collection('issuedStatements').doc(statementId);
  const feeRef = db.collection('adjustmentRequests').doc(statementId);
  const counterRef = db.collection('appMeta').doc(voucherSequenceKey(companyId, date, '가공'));
  const sameBatchQuery = db.collection('issuedStatements').where('orderId', '==', poId);
  const codeQuery = db.collection('accountCodes');
  const releaseGate = releaseGateRef(db);
  return db.runTransaction(async tx => {
    const [poSnap, stmtSnap, feeSnap, batchStatements, codes, releaseSnap] = await Promise.all([
      tx.get(poRef), tx.get(statementRef), tx.get(feeRef), tx.get(sameBatchQuery), tx.get(codeQuery), tx.get(releaseGate),
    ]);
    assertReleaseActive(releaseSnap, input.releaseId);
    assertVoucherDateAllowed(releaseSnap, companyId, date);
    if (!poSnap.exists) fail('OEM 배치가 없습니다.');
    const po = poSnap.data()!;
    if (ownCompany(po) !== companyId || po.poType !== 'oem' || po.status !== 'received') fail('가공비를 발행할 수 없는 OEM 배치입니다.');
    if (feeSnap.exists) {
      const fee = feeSnap.data()!;
      if (ownCompany(fee) !== companyId || fee.type !== 'oem_fee' || fee.oemPoId !== poId
        || fee.oemFeePerKg !== perKg || fee.status !== 'pending' && fee.status !== 'processed') {
        fail('OEM 가공비 확인 요청이 입고와 일치하지 않습니다.');
      }
    }
    const partnerId = po.oemPartnerId ?? po.partnerId;
    if (!partnerId || stmt.partnerId !== partnerId) fail('OEM 거래처가 일치하지 않습니다.');
    const partner = await tx.get(db.collection('partners').doc(partnerId));
    if (!partner.exists || ownCompany(partner.data()!) !== companyId) fail('OEM 거래처 회사가 일치하지 않습니다.');
    if (!finite(po.oemReceivedKg) || po.oemReceivedKg <= 0) fail('가공입고 중량이 확인되지 않았습니다.');
    const gross = Math.round(po.oemReceivedKg * perKg);
    if (feeSnap.exists && feeSnap.data()!.oemTotal !== gross) fail('OEM 가공비 확인 요청 금액이 입고와 다릅니다.');
    const supply = exempt ? gross : Math.round(gross / 1.1);
    if (gross <= 0 || stmt.totalAmount !== gross) fail('가공입고 중량·단가와 전표 금액이 다릅니다.');
    const poItems: Row[] = (po.items ?? []).filter((item: Row) => Number(item.quantity) > 0);
    const bulk: Row[] = (po.oemReceivedBulk ?? []).filter((item: Row) => Number(item.kg) > 0);
    const [products, bomRows] = await Promise.all([
      Promise.all(poItems.map(item => tx.get(db.collection('items').doc(item.itemId)))),
      Promise.all(poItems.map(item => tx.get(db.collection('item_bom').where('parent_id', '==', item.itemId)))),
    ]);
    const childIds = [...new Set(bomRows.flatMap(rows => rows.docs.map(snap => snap.data().child_id as string)).filter(Boolean))];
    const childDocs = await Promise.all(childIds.map(id => tx.get(db.collection('items').doc(id))));
    const children = new Map(childDocs.filter(snap => snap.exists).map(snap => [snap.id, snap.data()!]));
    const expected: Row[] = [];
    for (const [index, product] of products.entries()) {
      const poItem = poItems[index];
      if (!product.exists || ownCompany(product.data()!) !== companyId) fail('현재 회사의 OEM 전표 품목을 찾을 수 없습니다.');
      const item = product.data()!;
      const finishedChildren = bomRows[index].docs.map(snap => snap.data())
        .filter(row => ['product', '완제품'].includes(children.get(row.child_id)?.type));
      const boxed = (finishedChildren.length === 1 && Number(finishedChildren[0].quantity ?? 1) > 1)
        || Number(item.unpackTo?.count ?? 0) > 1 || item.unit === '박스';
      const kg = item.packageKg || (packageKg(item.spec) || packageKg(item.name)) * (boxed ? specCount(item.spec) : 1);
      const unitTotal = Math.round(kg * perKg);
      const amount = lineAmount(poItem.quantity, unitTotal, exempt);
      if (amount.total <= 0) continue;
      expected.push({ name: poItem.name, spec: item.spec ?? poItem.unit ?? '', qty: poItem.quantity,
        price: lineAmount(1, unitTotal, exempt).supply, ...amount,
        isTaxExempt: exempt, accountCode: '540' });
    }
    for (const row of bulk) {
      const amount = lineAmount(row.kg, perKg, exempt);
      expected.push({ name: `${row.material} 벌크 가공비`, spec: 'kg', qty: row.kg,
        price: lineAmount(1, perKg, exempt).supply, ...amount,
        isTaxExempt: exempt, accountCode: '540' });
    }
    if (!expected.length) {
      const sent = (po.oemSent ?? []).reduce((sum: number, row: Row) => sum + Number(row.kg || 0), 0);
      expected.push({ name: `외주가공비 (${sent}kg→${po.oemReceivedKg}kg)`, spec: '', qty: 1,
        price: supply, supply, tax: gross - supply, total: gross,
        isTaxExempt: exempt, accountCode: '540' });
    }
    const gap = gross - expected.reduce((sum, line) => sum + line.total, 0);
    if (gap !== 0) {
      const last = expected[expected.length - 1];
      const corrected = lineAmount(last.total + gap, 1, exempt);
      if (corrected.total < 0) fail('가공입고 중량과 전표 줄이 일치하지 않습니다.');
      expected[expected.length - 1] = { ...last, ...corrected, price: Math.round(corrected.supply / last.qty) };
    }
    if (hash(stmt.items) !== hash(expected)
      || stmt.totalSupply !== expected.reduce((sum, line) => sum + line.supply, 0)
      || stmt.totalTax !== expected.reduce((sum, line) => sum + line.tax, 0)) {
      fail('가공비 전표 줄이 OEM 입고 내역과 다릅니다.');
    }
    const allowedCodes = new Set(codes.docs.filter(snap => ownCompany(snap.data()) === companyId).map(snap => snap.data().code));
    if (stmt.items.some((line: Row) => !allowedCodes.has(line.accountCode))) fail('가공비 회사 계정과목이 일치하지 않습니다.');
    if (batchStatements.docs.some(snap => snap.id !== statementId
      && ownCompany(snap.data()) === companyId && snap.data().type === '매입')) fail('연결되지 않은 기존 가공비 전표가 있습니다.');
    if (po.linkedStatementId && po.linkedStatementId !== statementId) fail('이미 다른 가공비 전표가 연결된 배치입니다.');
    if (po.linkedStatementId === statementId && !stmtSnap.exists) fail('연결된 가공비 전표가 없어 정합성 확인이 필요합니다.');
    if (stmtSnap.exists) {
      const existing = stmtSnap.data()!;
      if (ownCompany(existing) !== companyId || existing.orderId !== poId || existing.type !== '매입'
        || existing.partnerId !== partnerId || existing.tradeDate !== date
        || typeof existing.docNo !== 'string' || !existing.docNo
        || hash({ ...business(existing), companyId }) !== hash(semantic)
        || (existing.issueOperationId && (existing.issueOperationId !== statementId || existing.issuePayloadHash !== payloadHash
          || existing.issueVoucherNo !== existing.docNo))) fail('기존 가공비 전표와 요청 내용이 다릅니다.');
      if (!po.linkedStatementId) {
        if (po.oemFeePerKg !== undefined && po.oemFeePerKg !== perKg) fail('기존 가공비 단가가 변경되었습니다.');
        tx.update(poRef, { linkedStatementId: statementId, oemFeePerKg: perKg });
      }
      else if ((existing.issueOperationId && po.oemFeePerKg !== perKg)
        || (po.oemFeePerKg !== undefined && po.oemFeePerKg !== perKg)) fail('기존 가공비 단가가 변경되었습니다.');
      if (feeSnap.exists && feeSnap.data()!.status === 'pending') tx.update(feeRef, { status: 'processed', processedAt: new Date().toISOString() });
      return statementId;
    }
    const sequence = await tx.get(counterRef);
    const state = await readVoucherCounter(db, tx, sequence, releaseSnap, companyId, date, '가공');
    if (state.companyId !== companyId || state.tradeDate !== date || state.prefix !== '가공'
      || !Number.isSafeInteger(state.last) || state.last < 0 || !Number.isSafeInteger(state.last + 1)) fail('가공비 전표 번호 카운터가 손상되었습니다.');
    const docNo = formatVoucherNo(date, state.last + 1, '가공');
    writeVoucherCounter(tx, sequence, state, state.last + 1);
    tx.create(statementRef, { ...stmt, companyId, docNo, issueOperationId: statementId,
      issuePayloadHash: payloadHash, issueVoucherNo: docNo });
    tx.update(poRef, { linkedStatementId: statementId, oemFeePerKg: perKg });
    if (feeSnap.exists && feeSnap.data()!.status === 'pending') tx.update(feeRef, { status: 'processed', processedAt: new Date().toISOString() });
    return statementId;
  });
}

export const issueOemFeeVoucherCommand = onCall({ region: 'asia-northeast3' }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  const companyId = request.auth.token.companyId;
  if (!request.auth.token.isAdmin || (companyId !== 'taebaek' && companyId !== 'punghoe')) {
    throw new HttpsError('permission-denied', '관리자 회사 권한이 필요합니다.');
  }
  return issueOemFeeVoucher(admin.firestore(), companyId, request.data as Input);
});
