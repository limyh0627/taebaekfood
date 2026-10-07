import { readVoucherCounter, writeVoucherCounter } from './newScopeCounter';
import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { createHash } from 'crypto';
import { assertReleaseActive, assertVoucherDateAllowed, releaseGateRef } from './releaseGate';

type Kind = 'issuedStatements' | 'cashEntries';
type Input = { kind: Kind; operationId: string; tradeDate: string; prefix?: string;
  document: Record<string, unknown>; releaseId: string };
const REGION = 'asia-northeast3';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

export function formatVoucherNo(date: string, sequence: number, prefix = ''): string {
  return `${prefix}${date.slice(2).replace(/-/g, '')}-${String(sequence).padStart(3, '0')}`;
}

export const voucherSequenceKey = (companyId: string, date: string, prefix = '') =>
  `voucherNo_${companyId}_${date}_${prefix || 'general'}`;

/** A missing counter is an explicit migration gate: existing numbers must be audited first. */
export async function issueVoucher(db: admin.firestore.Firestore, companyId: string, input: Input) {
  if (!input || typeof input !== 'object') throw new HttpsError('invalid-argument', '발행 요청이 잘못되었습니다.');
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(input.releaseId))
    throw new HttpsError('invalid-argument', '배포 전환 ID가 필요합니다.');
  const { kind, operationId, tradeDate, prefix = '', document } = input;
  if (kind !== 'issuedStatements' && kind !== 'cashEntries') throw new HttpsError('invalid-argument', '전표 종류가 잘못되었습니다.');
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(operationId)) throw new HttpsError('invalid-argument', '작업 ID가 잘못되었습니다.');
  const parsedDate = new Date(`${tradeDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate) || Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== tradeDate) throw new HttpsError('invalid-argument', '전표일이 잘못되었습니다.');
  if (!['', '가공', '반품', '대체', '급여'].includes(prefix)) throw new HttpsError('invalid-argument', '전표 접두사가 잘못되었습니다.');
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new HttpsError('invalid-argument', '전표 내용이 잘못되었습니다.');
  if (document.companyId !== undefined && document.companyId !== companyId) throw new HttpsError('permission-denied', '다른 회사의 전표를 발행할 수 없습니다.');
  const field = kind === 'cashEntries' ? 'date' : 'tradeDate';
  if (document[field] !== tradeDate) throw new HttpsError('invalid-argument', '전표일이 일치하지 않습니다.');
  if (kind === 'cashEntries' && (typeof document.amount !== 'number' || !Number.isFinite(document.amount) || document.amount <= 0)) {
    throw new HttpsError('invalid-argument', '자금전표 금액은 0보다 큰 유한한 수여야 합니다.');
  }
  if (kind === 'cashEntries') {
    const protectedCodes = new Set(['108', '251', '253', '260', '293']);
    const lines = Array.isArray(document.lines) ? document.lines : [];
    const codes = [document.accountCode, ...lines.map(line => (line && typeof line === 'object' ? line.accountCode : undefined))];
    if (codes.some(code => protectedCodes.has(String(code)))
      || ['loanId', 'returnRequestId', 'returnOperationId', 'partnerPaymentOperationId', 'settlementId',
        'settlements', 'allocations', 'paymentId', 'reverse'].some(field => field in document)) {
      throw new HttpsError('failed-precondition', '거래처 지급·대출·반품 연결은 해당 서버 원자 명령에서 처리해야 합니다.');
    }
  }
  if (kind === 'issuedStatements') {
    const { totalAmount, totalSupply, totalTax } = document;
    if (typeof totalAmount !== 'number' || !Number.isFinite(totalAmount) || totalAmount === 0
      || typeof totalSupply !== 'number' || !Number.isFinite(totalSupply)
      || typeof totalTax !== 'number' || !Number.isFinite(totalTax)
      || Math.round((totalSupply + totalTax) * 100) !== Math.round(totalAmount * 100)) {
      throw new HttpsError('invalid-argument', '전표 공급가·세액·총액이 일치하지 않습니다.');
    }
  }
  const { id: _id, docNo: _docNo, issueOperationId: _operation, issuePayloadHash: _hash, issuePrefix: _prefix, ...body } = document;
  const payload: Record<string, unknown> = { ...body, companyId };
  // 발행 시각/담당자는 재시도 때 달라질 수 있다. 금액·상대·계정 등 업무 내용은 고정한다.
  const { createdAt: _createdAt, issuedAt: _issuedAt, createdBy: _createdBy, ...semanticPayload } = payload;
  const issuePayloadHash = createHash('sha256').update(JSON.stringify(canonical(semanticPayload))).digest('hex');
  const target = db.collection(kind).doc(operationId);
  const other = db.collection(kind === 'cashEntries' ? 'issuedStatements' : 'cashEntries').doc(operationId);
  const counter = db.collection('appMeta').doc(voucherSequenceKey(companyId, tradeDate, prefix));
  const catchUpCounter = db.collection('appMeta').doc(voucherSequenceKey(companyId, tradeDate, '추가'));
  const releaseGate = releaseGateRef(db);
  return db.runTransaction(async tx => {
    const [existing, otherKind, normalSequence, catchUpSequence, releaseSnap] = await Promise.all([
      tx.get(target), tx.get(other), tx.get(counter), tx.get(catchUpCounter), tx.get(releaseGate),
    ]);
    assertReleaseActive(releaseSnap, input.releaseId);
    const mode = assertVoucherDateAllowed(releaseSnap, companyId, tradeDate, prefix === '');
    const effectivePrefix = mode === 'catchUp' ? '추가' : prefix;
    const sequence = mode === 'catchUp' ? catchUpSequence : normalSequence;
    if (otherKind.exists) throw new HttpsError('already-exists', '작업 ID가 다른 종류의 전표에 사용되었습니다.');
    if (existing.exists) {
      const data = existing.data()!;
      if (data.companyId !== companyId || data[field] !== tradeDate || data.issueOperationId !== operationId || data.issuePrefix !== effectivePrefix || data.issuePayloadHash !== issuePayloadHash || typeof data.docNo !== 'string') {
        throw new HttpsError('already-exists', '작업 ID가 다른 전표에 사용되었습니다.');
      }
      return { id: operationId, docNo: data.docNo };
    }
    const state = await readVoucherCounter(db, tx, sequence, releaseSnap, companyId, tradeDate, effectivePrefix);
    if (state.companyId !== companyId || state.tradeDate !== tradeDate || state.prefix !== effectivePrefix || !Number.isSafeInteger(state.last) || state.last < 0) {
      throw new HttpsError('failed-precondition', '전표 번호 카운터가 손상되었습니다.');
    }
    const next = state.last + 1;
    if (!Number.isSafeInteger(next)) throw new HttpsError('resource-exhausted', '전표 번호 범위를 초과했습니다.');
    const docNo = formatVoucherNo(tradeDate, next, effectivePrefix);
    writeVoucherCounter(tx, sequence, state, next);
    tx.create(target, { ...payload, docNo, issueOperationId: operationId, issuePrefix: effectivePrefix, issuePayloadHash });
    return { id: operationId, docNo };
  });
}

export const issueNumberedVoucher = onCall({ region: REGION }, async request => {
  const companyId = request.auth?.token.companyId;
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  if (!request.auth.token.isAdmin || (companyId !== 'taebaek' && companyId !== 'punghoe')) {
    throw new HttpsError('permission-denied', '관리자 회사 권한이 필요합니다.');
  }
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(request.data?.releaseId))
    throw new HttpsError('invalid-argument', '배포 전환 ID가 필요합니다.');
  return issueVoucher(admin.firestore(), companyId, request.data as Input);
});
