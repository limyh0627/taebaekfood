import { expect, it } from 'vitest';
import { assertOriginReceipt, paymentBusiness, semanticHash, statementBusiness } from './partnerAdvanceReceipt';
const expected = { companyId: 'taebaek', partnerId: 'partner', actorId: 'auth-uid', operationId: 'op' };
it('기존 status 없는 지급 감사와 목적 포함 사업 원문을 검증한다', () => {
  const row = { id: 'cash', companyId: 'taebaek', partnerId: 'partner', createdBy: 'auth-uid',
    issueOperationId: 'op', issuePayloadHash: 'a'.repeat(64), docNo: '261008-001', date: '2026-10-08', cashAccountId: 'bank',
    dir: '출금', amount: 100, lines: [{ accountCode: '133', amount: 100 }], note: '',
    advanceOrigin: { version: 1, contractId: 'contract', purpose: '상품 매입', operationId: 'op' } };
  const receipt = { ...expected, createdBy: 'auth-uid', cashEntryId: 'cash', requestHash: 'a'.repeat(64), docNo: row.docNo, entryHash: semanticHash(paymentBusiness(row)) };
  expect(() => assertOriginReceipt('payment', row, receipt, expected)).not.toThrow();
  expect(() => assertOriginReceipt('payment', { ...row, dir: '입금' }, receipt, expected)).toThrow();
  expect(() => assertOriginReceipt('payment', row, { ...receipt, status: 'rejected' }, expected)).toThrow();
  expect(() => assertOriginReceipt('payment', row, { ...receipt, createdBy: 'foreign' }, expected)).toThrow();
  expect(() => assertOriginReceipt('payment', row, { ...receipt, status: 'failed' }, expected)).toThrow();
  expect(() => assertOriginReceipt('payment', { ...row, issuePayloadHash: undefined }, { ...receipt, requestHash: undefined }, expected)).toThrow();
  expect(() => assertOriginReceipt('payment', row, { ...receipt, docNo: '261008-002' }, expected)).toThrow();
  expect(() => assertOriginReceipt('payment', row, { ...receipt, issuePrefix: '추가' }, expected)).toThrow();
});
it('거래 원천은 전표 자체의 기존 사업 해시를 사용하고 목적 변조를 거절한다', () => {
  const business = { companyId: 'taebaek', partnerId: 'partner', type: '매출', tradeDate: '2026-10-08',
    totalAmount: 100, advanceTarget: { version: 1, contractId: 'contract', purpose: '상품 매출', operationId: 'op' } };
  const row = { ...business, id: 'statement', createdBy: 'auth-uid', issueOperationId: 'op',
    issueStatementHash: semanticHash(business), docNo: '261008-001' };
  expect(() => assertOriginReceipt('statement', row, {}, expected)).not.toThrow();
  expect(() => assertOriginReceipt('statement', { ...row, advanceTarget: { ...business.advanceTarget, purpose: '다른 목적' } }, {}, expected)).toThrow();
  expect(semanticHash(statementBusiness(row))).toBe(row.issueStatementHash);
});
import { assertGenericCashOrigin,genericVoucherBusiness } from './partnerAdvanceReceipt';
it('generic 발행은 지급 감사 없이 실제 voucherIssue 사업 해시로 원문을 증명한다',()=>{const row={id:'cash',companyId:'taebaek',partnerId:'p',createdBy:'uid',issueOperationId:'cash',issuePrefix:'',docNo:'261008-001',date:'2026-10-08',dir:'출금',amount:100,accountCode:'133'};const issued={...row,issuePayloadHash:semanticHash(genericVoucherBusiness(row))};expect(()=>assertGenericCashOrigin(issued,{companyId:'taebaek',partnerId:'p',id:'cash'})).not.toThrow();expect(()=>assertGenericCashOrigin({...issued,amount:101},{companyId:'taebaek',partnerId:'p',id:'cash'})).toThrow();expect(()=>assertGenericCashOrigin(issued,{companyId:'punghoe',partnerId:'p',id:'cash'})).toThrow();});
