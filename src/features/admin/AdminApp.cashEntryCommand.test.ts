import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import ts from 'typescript';
import { defaultCashAccountId } from '../../shared/defaultCashAccount';

// 실제 관리자 callback을 실행해 화면의 직접 쓰기가 다시 들어오는 경우도 검출한다.
const source = readFileSync('src/features/admin/AdminApp.tsx', 'utf8');
const file = ts.createSourceFile('AdminApp.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback = '';
function find(node: ts.Node): void {
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'addCashEntry' && node.initializer) callback = node.initializer.getText(file);
  ts.forEachChild(node, find);
}
find(file);
if (!callback) throw new Error('관리자 자금 발행 callback이 없습니다.');
const compiled = ts.transpile(`const callback = ${callback};`, { target: ts.ScriptTarget.ES2022 });
function setup() {
  const issue = vi.fn().mockResolvedValue({ id: 'cash-one', docNo: '261007-001' });
  const direct = vi.fn();
  const loan = vi.fn().mockResolvedValue({ status: 'applied', id: 'loan-movement', balanceAfter: 900 });
  const accounts = [
    { id: 'cashacct-temp-main', companyId: 'taebaek', active: true, type: '통장' },
    { id: 'punghoe-main', companyId: 'punghoe', active: true, type: '통장' },
  ];
  const run = new Function('recordLoanCashEntry', 'issueNumberedCashEntry', 'addItem', 'defaultCashAccountId', 'appData', 'companyId', 'currentUser', `${compiled}; return callback;`)(loan, issue, direct, defaultCashAccountId, { cashAccounts: accounts }, 'taebaek', { name: '담당자' });
  return { loan, issue, direct, run };
}
it('일반 출금은 기본 통장·담당자를 보존하고 서버 번호 발행 결과를 기다린다', async () => {
  const { issue, direct, run } = setup();
  const entry = { id: 'cash-one', date: '2026-10-07', dir: '출금', amount: 1234, accountCode: '811' };
  await expect(run(entry)).resolves.toEqual({ id: 'cash-one', docNo: '261007-001' });
  expect(issue).toHaveBeenCalledWith({ ...entry, cashAccountId: 'cashacct-temp-main', companyId: 'taebaek', createdBy: '담당자' });
  expect(direct).not.toHaveBeenCalled();
});
it('명시한 회사·계좌·담당자·분할 줄은 바꾸지 않는다', async () => {
  const { issue, run } = setup();
  const entry = { id: 'cash-one', date: '2026-10-07', dir: '출금', amount: 900, cashAccountId: 'selected', createdBy: '작성자', lines: [{ accountCode: '811', amount: 900 }] };
  await run(entry, 'punghoe');
  expect(issue).toHaveBeenCalledWith({ ...entry, companyId: 'punghoe' });
});
it('서버 실패를 화면에 전달하고 직접 저장으로 대체하지 않는다', async () => {
  const { issue, direct, run } = setup();
  issue.mockRejectedValue(new Error('발행 실패'));
  await expect(run({ id: 'cash-one', date: '2026-10-07', dir: '입금', amount: 100 })).rejects.toThrow('발행 실패');
  expect(direct).not.toHaveBeenCalled();
});
it('대출은 일반 발행 대신 원금·현금 동시 저장 명령으로 보낸다', async () => {
  const { loan, issue, direct, run } = setup();
  const entry = { id: 'cash-loan', date: '2026-10-07', loanId: 'loan-a', dir: '출금', amount: 105,
    lines: [{ accountCode: '293', amount: 100 }, { accountCode: '931', amount: 5 }] };
  await expect(run(entry)).resolves.toMatchObject({ balanceAfter: 900 });
  expect(loan).toHaveBeenCalledWith('taebaek', { ...entry, cashAccountId: 'cashacct-temp-main', companyId: 'taebaek', createdBy: '담당자' });
  expect(issue).not.toHaveBeenCalled();
  expect(direct).not.toHaveBeenCalled();
});
