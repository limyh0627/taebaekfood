import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import ts from 'typescript';

const file = ts.createSourceFile('AdminApp.tsx', readFileSync('src/features/admin/AdminApp.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function actualHandler(name: string, context: Record<string, unknown>) {
  let expression: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name) expression = node.initializer;
    if (ts.isJsxAttribute(node) && node.name.getText(file) === name && node.initializer && ts.isJsxExpression(node.initializer)) {
      expression = node.initializer.expression;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!expression) throw new Error(`${name} handler missing`);
  const js = ts.transpile(`const handler = ${expression.getText(file)};`, { target: ts.ScriptTarget.ES2022 });
  return new Function(...Object.keys(context), `${js}; return handler;`)(...Object.values(context));
}

it('박스 생성은 원본의 구형 price를 넘기지 않고 계산 원가를 다시 저장한다', async () => {
  const addItem = vi.fn(async (_collection: string, _data: Record<string, unknown>) => 'box-id');
  const recomputeAllCosts = vi.fn(async () => {});
  const unit = { id: 'unit', name: '낱개', type: 'product', companyId: 'taebaek', stock: 5, cost: 700, price: 9000 };
  const createBoxItem = actualHandler('createBoxItem', {
    useCallback: (fn: unknown) => fn, allItems: [unit], companyOf: (item: typeof unit) => item.companyId,
    companyId: 'taebaek', addItem, writeMany: vi.fn(async () => {}), COL: { itemBom: 'item_bom' },
    refreshStaticData: vi.fn(), itemBoms: [], itemFormulas: [], recomputeAllCosts,
  }) as (item: typeof unit, options: { name: string; count: number; components: [] }) => Promise<void>;

  await createBoxItem(unit, { name: '박스', count: 10, components: [] });
  const saved = addItem.mock.calls[0][1];
  expect(addItem.mock.calls[0][0]).toBe('items');
  expect(saved).not.toHaveProperty('price');
  expect(saved).toMatchObject({ name: '박스', cost: 0, stock: 0, companyId: 'taebaek' });
  expect(unit).toMatchObject({ cost: 700, price: 9000 });
  expect(recomputeAllCosts).toHaveBeenCalledOnce();
});

it('부자재 생성은 items.price 없이 저장한다', async () => {
  const addItem = vi.fn(async (_collection: string, _data: Record<string, unknown>) => 'sub-id');
  const addSubmaterial = actualHandler('onAddSubmaterial', { addItem, companyId: 'taebaek' }) as (name: string, category: string) => Promise<string>;

  expect(await addSubmaterial('새 라벨', '라벨')).toBe('sub-id');
  expect(addItem).toHaveBeenCalledOnce();
  expect(addItem.mock.calls[0][0]).toBe('items');
  expect(addItem.mock.calls[0][1]).toMatchObject({ name: '새 라벨', category: '라벨', unit: '매', companyId: 'taebaek' });
  expect(addItem.mock.calls[0][1]).not.toHaveProperty('price');
});
