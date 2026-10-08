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

function mutationCallback(name: string) {
  let expression = '';
  const walk = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(file) === name && node.initializer) expression = node.initializer.getText(file); ts.forEachChild(node, walk); };
  walk(file);
  const mutate = vi.fn().mockResolvedValue({ status: 'applied' }), prepare = vi.fn().mockResolvedValue({ counterpart: { id: 'other' }, expectedRevision: 4, expectedCashHash: 'other-hash' });
  const direct = vi.fn();
  const code = ts.transpile(`const callback = ${expression};`, { target: ts.ScriptTarget.ES2022 });
  const run = new Function('useCallback', 'companyId', 'companyOf', 'mutateCash', 'prepareTransferCash', 'updateItem', 'deleteItem', `${code};return callback;`)((fn: any) => fn, 'taebaek', (row: any) => row.companyId ?? 'taebaek', mutate, prepare, direct, direct);
  return { run, mutate, prepare, direct };
}
it('현금 수정은 UI 원문·급여·이체 입력을 그대로 기다려 보내고 최신 원문으로 바꾸지 않는다', async () => {
  const { run, mutate, direct } = mutationCallback('updateCash');
  const original = { id: 'cash', companyId: 'taebaek', amount: 100, mutationRevision: 3 };
  const payroll = { expectedRevision: 2 }, transfer = { expectedRevision: 1 };
  await run('cash', { amount: 120 }, original, payroll, transfer);
  expect(mutate).toHaveBeenCalledWith('taebaek', original, 'edit', { amount: 120 }, payroll, transfer);
  expect(direct).not.toHaveBeenCalled();
  await expect(run('cash', {}, undefined)).rejects.toThrow();
  await expect(run('cash', {}, { ...original, companyId: 'punghoe' })).rejects.toThrow();
});
it('현금 삭제는 원문과 승인받은 상대 회사 원문을 한 명령에 보내고 개별 연결을 지우지 않는다', async () => {
  const { run, mutate, prepare, direct } = mutationCallback('deleteCashEntry');
  const original = { id: 'cash', companyId: 'taebaek', transferOperationId: 'transfer' };
  await run('cash', original);
  expect(prepare).toHaveBeenCalledWith('taebaek', original);
  expect(mutate).toHaveBeenCalledWith('taebaek', original, 'delete', undefined, undefined,
    { counterpartId: 'other', expectedRevision: 4, expectedCashHash: 'other-hash' });
  expect(direct).not.toHaveBeenCalled();
  mutate.mockRejectedValue(new Error('서버 거절'));
  await expect(run('cash', original)).rejects.toThrow('서버 거절');
});
it('실제 화면 연결은 배분·이전 요청 확인과 계좌원장 원문을 전달한다', () => {
  expect(source).toContain('onMatchCashAllocations={(entry, allocations) => matchCashAllocations(companyId, entry, allocations)}');
  expect(source).toContain('onResumeCashMutation={(id) => resumeCashMutation(companyId, id)}');
  expect(readFileSync('components/CashLedger.tsx', 'utf8')).toContain('onDeleteCashEntry(entry.id, entry)');
});
