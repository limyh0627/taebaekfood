import { assertAdvanceOperationProof } from './partnerAdvanceAudit';
import { createHash } from 'node:crypto';

type Row = Record<string, unknown>;
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value as Row).filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
export const semanticHash = (row: Row) => createHash('sha256').update(JSON.stringify(canonical(row))).digest('hex');

// 제품 partnerPaymentCommand의 entryHash 대상과 같은 명시 사업 필드다.
export function paymentBusiness(row: Row): Row {
  return { companyId: row.companyId, partnerId: row.partnerId, date: row.date,
    cashAccountId: row.cashAccountId, dir: row.dir, amount: row.amount, lines: row.lines,
    note: row.note ?? '', ...(row.advanceOrigin === undefined ? {} : { advanceOrigin: row.advanceOrigin }) };
}
// 제품 tradeStatementIssue.statementBusiness와 같은 제외 필드다.
export function statementBusiness(row: Row): Row {
  const { docNo, id, issuedAt, createdBy, issueOperationId, issuePayloadHash,
    issueStatementHash, issueVoucherNo, issuePrefix, ...business } = row;
  return business;
}
/** 저장 원문과 기존 발행 감사의 사업 해시를 연결한다. 잔량 증명은 별도 reader 책임이다. */
export function assertOriginReceipt(kind: 'payment' | 'statement', row: Row, receipt: Row,
  expected: { companyId: string; partnerId: string; actorId: string; operationId: string }) {
  if (row.companyId !== expected.companyId || row.partnerId !== expected.partnerId
    || row.issueOperationId !== expected.operationId || row.createdBy !== expected.actorId)
    throw new Error('원본 발행 회사·거래처·작성자가 다릅니다.');
  if (kind === 'payment') {
    // 현재 applied 감사에는 status가 생략된다. rejected는 원천이 아니다.
    if (receipt.companyId !== expected.companyId || receipt.partnerId !== expected.partnerId
      || receipt.createdBy !== expected.actorId || ![undefined, 'applied'].includes(receipt.status as undefined | string) || receipt.cashEntryId !== row.id
      || typeof row.issuePayloadHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.issuePayloadHash)
      || typeof row.docNo !== 'string' || !row.docNo || receipt.docNo !== row.docNo
      || (receipt.issuePrefix ?? '') !== (row.issuePrefix ?? '')
      || receipt.requestHash !== row.issuePayloadHash || receipt.entryHash !== semanticHash(paymentBusiness(row)))
      throw new Error('원본 지급 감사와 사업 해시가 다릅니다.');
  } else {
    // 거래 발행은 별도 operation 문서 대신 전표에 저장한 사업 해시가 증거다.
    if (row.issueStatementHash !== semanticHash(statementBusiness(row)))
      throw new Error('원본 전표 사업 해시가 다릅니다.');
  }
}

/** Exact generic voucherIssue business hash. No payment receipt fallback when one exists. */
export function genericVoucherBusiness(row: Row): Row {
 const { id, docNo, issueOperationId, issuePayloadHash, issuePrefix, createdAt, issuedAt, createdBy, ...business }=row;
 return business;
}
export function assertGenericCashOrigin(row: Row, expected: {companyId:string;partnerId:string;id:string}) {
 if(row.companyId!==expected.companyId || row.partnerId!==expected.partnerId || row.id!==expected.id
  || row.issueOperationId!==expected.id || typeof row.docNo!=='string' || !row.docNo
  || typeof row.createdBy!=='string' || !row.createdBy || typeof row.issuePrefix!=='string'
  || typeof row.issuePayloadHash!=='string' || !/^[a-f0-9]{64}$/.test(row.issuePayloadHash)
  || row.issuePayloadHash!==semanticHash(genericVoucherBusiness(row)))
  throw new Error('원본 자금전표의 발행 증거가 다릅니다.');
}

export function assertAdvanceOperation(statement: Row, operation: Row) {
 assertAdvanceOperationProof(statement,operation,{commandHash:semanticHash(operation.command as Row),requestHash:semanticHash({companyId:operation.companyId,actorId:operation.createdBy,action:operation.action,command:operation.command}),statementHash:semanticHash(statementBusiness(statement))});
}
