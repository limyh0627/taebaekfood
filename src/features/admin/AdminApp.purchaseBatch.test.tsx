import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';

function actualHandler(bindings: Record<string, unknown>, name = 'handleBulkAddConfirmedOrders') {
  const source = readFileSync('src/features/admin/AdminApp.tsx', 'utf8');
  const tree = ts.createSourceFile('AdminApp.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression = '';
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) expression = node.initializer!.getText(tree);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  const js = ts.transpileModule('return ' + expression, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(bindings), js)(...Object.values(bindings));
}

it('실제 부모의 후행 그룹 거절은 앞 발주도 남기지 않는다', async () => {
  const committed: string[] = [];
  const sequential = vi.fn(async (command: any) => {
    if (committed.length) throw Error('후행 그룹 거절');
    committed.push(command.data.id);
  });
  const prepare = vi.fn(() => ({ orders: ['a', 'b'] }));
  const atomic = vi.fn().mockRejectedValue(new Error('후행 그룹 거절'));
  const run = actualHandler({
    partners: [{ id: 'p1', name: '하나' }, { id: 'p2', name: '둘' }],
    partnerIn: [{ itemId: 'a', partnerId: 'p1' }, { itemId: 'b', partnerId: 'p2' }],
    allItems: [{ id: 'a', name: '가', unit: '개' }, { id: 'b', name: '나', unit: '개' }],
    purchaseOrders: [], today: () => '2026-10-24', nextPoNo: () => 'PO-261024-001',
    executeEmployeeCommand: sequential, handlePreparePurchaseOrderBatch: prepare,
    applyPurchaseOrderBatch: atomic, purchaseBatchScope: () => ({ companyId: 'taebaek' }),
  });
  await expect(run([{ id: 'a', quantity: 2, partnerId: 'p1' }, { id: 'b', quantity: 3, partnerId: 'p2' }])).rejects.toThrow('후행 그룹');
  expect(committed).toEqual([]);
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(atomic).toHaveBeenCalledTimes(1);
});

it('실제 typed prepare 포트는 현재 회사와 전체 장바구니·기존 참조를 한 번에 고정한다', () => {
  const scope = { companyId: 'taebaek', actorUid: 'actor', isCurrent: () => true }, plan = vi.fn().mockReturnValue({ fixed: true });
  const rows = [{ id: 'i', quantity: 24, boxQuantity: 2, partnerId: 'p' }], items = [{ id: 'i' }], partners = [{ id: 'p' }], partnerIn = [{ itemId: 'i', partnerId: 'p' }], purchaseOrders: unknown[] = [];
  const prepare = actualHandler({ purchaseBatchScope: () => scope, planPurchaseOrderBatch: plan,
    crypto: { randomUUID: () => 'fixed' }, today: () => '2026-10-24', allItems: items, partners, partnerIn, purchaseOrders }, 'handlePreparePurchaseOrderBatch');
  expect(prepare(rows)).toEqual({ fixed: true });
  expect(plan).toHaveBeenCalledExactlyOnceWith({ scope, rows, operationId: 'po-batch-fixed', createdAt: expect.any(String), date: '2026-10-24', items, partners, partnerIn, purchaseOrders });
  const source = readFileSync('src/features/admin/AdminApp.tsx', 'utf8');
  expect(source).toContain('onPreparePurchaseOrderBatch={handlePreparePurchaseOrderBatch}');
});

it('부모 scope는 회사/선택세대/실 UID 교체를 현재 요청으로 채택하지 않는다', () => {
  const ref = { current: { token: {}, companyId: 'taebaek' } }, auth = { currentUser: { uid: 'actor' } };
  const capture = actualHandler({ orderAskScope: ref, auth, companyId: 'taebaek' }, 'purchaseBatchScope');
  const first = capture(); expect(first.isCurrent()).toBe(true);
  auth.currentUser.uid = 'other'; expect(first.isCurrent()).toBe(false);
  auth.currentUser.uid = 'actor'; ref.current = { token: {}, companyId: 'taebaek' }; expect(first.isCurrent()).toBe(false);
});

it('legacy callback도 성공을 기다리고 cancelled를 업무 성공으로 알리지 않는다', async () => {
  const fixed = { fixed: true }, scope = { companyId: 'taebaek' }, apply = vi.fn().mockResolvedValue({ status: 'cancelled' });
  const prepare = vi.fn().mockReturnValue(fixed), run = actualHandler({ handlePreparePurchaseOrderBatch: prepare, applyPurchaseOrderBatch: apply, purchaseBatchScope: () => scope });
  await expect(run([{ id: 'i', quantity: 1 }])).rejects.toThrow('중단');
  apply.mockResolvedValue({ status: 'applied' }); await run([{ id: 'i', quantity: 1 }]);
  expect(apply).toHaveBeenLastCalledWith(scope, fixed); expect(apply).toHaveBeenCalledTimes(2);
});
