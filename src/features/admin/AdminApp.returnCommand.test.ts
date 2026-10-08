import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
function handler(deps: Record<string, unknown>) {
  const source = readFileSync(process.env.ADMIN_RETURN_SOURCE_PATH || 'src/features/admin/AdminApp.tsx', 'utf8');
  const file = ts.createSourceFile('AdminApp.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression: ts.Expression | undefined;
  const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'handleProcessReturn') expression = node.initializer; ts.forEachChild(node, visit); }; visit(file);
  if (!expression) throw new Error('실제 반품 handler가 없습니다.');
  const code = ts.transpileModule(`const handle = ${expression.getText(file)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(deps), `${code};return handle;`)(...Object.values(deps)) as (request: unknown) => Promise<void>;
}
function fixture() {
  const deps = { isAdmin: true, companyId: 'taebaek', currentUser: { id: 'u', name: '관리자' },
    orderAskScope: { current: { companyId: 'taebaek', token: {} } }, processReturn: vi.fn().mockResolvedValue({ status: 'applied' }),
    setLedgerReloadKey: vi.fn(), allItems: [{ id: 'box', name: '박스', type: 'submaterial', unit: '개' }],
    issuedStatements: [{ id: 'source', partnerId: 'p', type: '매입' }], recordReceipt: vi.fn(), addCashEntry: vi.fn(), updateItem: vi.fn(),
    buildPaymentEntry: vi.fn().mockReturnValue({}), today: () => '2026-10-07' };
  const request = { id: 'r', companyId: 'taebaek', partnerId: 'p', linkedStatementId: 'source', totalAmount: 100,
    items: [{ itemId: 'box', name: '박스', quantity: 1, isResellable: true }] };
  return { deps, request };
}
describe('관리자 실제 반품 처리 본문', () => {
  it('원자 callable만 실행하고 옛 재고·가짜 현금·status 개별 writer는 실행하지 않는다', async () => {
    const { deps, request } = fixture(); await handler(deps)(request);
    expect(deps.processReturn).toHaveBeenCalledExactlyOnceWith('taebaek', request);
    expect(deps.recordReceipt).not.toHaveBeenCalled(); expect(deps.addCashEntry).not.toHaveBeenCalled(); expect(deps.updateItem).not.toHaveBeenCalled();
    expect(deps.setLedgerReloadKey).toHaveBeenCalledOnce();
  });
  it('서버 실패는 전파하고 성공 표시나 옛 writer fallback을 하지 않는다', async () => {
    const { deps, request } = fixture(); deps.processReturn.mockRejectedValue(new Error('원자 실패'));
    await expect(handler(deps)(request)).rejects.toThrow('원자 실패');
    expect(deps.setLedgerReloadKey).not.toHaveBeenCalled(); expect(deps.recordReceipt).not.toHaveBeenCalled();
  });
  it('회사 변경 전 handler와 타회사 요청은 서버 호출 전에 차단한다', async () => {
    const { deps, request } = fixture(); deps.orderAskScope.current.companyId = 'punghoe';
    await expect(handler(deps)(request)).rejects.toThrow('회사'); expect(deps.processReturn).not.toHaveBeenCalled();
  });
  it('회사 변경 뒤 늦은 성공은 새 화면 reload를 하지 않는다', async () => {
    const { deps, request } = fixture(); let resolve!: () => void;
    deps.processReturn.mockImplementation(() => new Promise<void>(done => { resolve = done; }));
    const pending = handler(deps)(request); deps.orderAskScope.current.token = {}; resolve(); await pending;
    expect(deps.setLedgerReloadKey).not.toHaveBeenCalled();
  });
});
