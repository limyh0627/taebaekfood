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
  const writeMany = vi.fn(async (_ops: any[], _options?: unknown) => {});
  const recomputeAllCosts = vi.fn(async () => {});
  const unit = { id: 'unit', name: '낱개', type: 'product', companyId: 'taebaek', stock: 5, cost: 700, price: 9000 };
  const createBoxItem = actualHandler('createBoxItem', {
    useCallback: (fn: unknown) => fn, allItems: [unit], companyOf: (item: typeof unit) => item.companyId,
    companyId: 'taebaek', addItem, writeMany, COL: { itemBom: 'item_bom' },
    refreshStaticData: vi.fn(), itemBoms: [], itemFormulas: [], recomputeAllCosts,
    auth: { currentUser: { uid: 'u' } }, orderAskScope: { current: { companyId: 'taebaek', token: {} } }, awaitNotice: vi.fn(),
  }) as (item: typeof unit, options: { name: string; count: number; components: [] }) => Promise<void>;

  await createBoxItem(unit, { name: '박스', count: 10, components: [] });
  const saved = writeMany.mock.calls[0][0][0].data;
  expect(writeMany.mock.calls[0][0][0]).toMatchObject({ collection: 'items', id: 'box-unit-10', createOnly: true });
  expect(addItem).not.toHaveBeenCalled();
  expect(saved).not.toHaveProperty('price');
  expect(saved).toMatchObject({ name: '박스', cost: 0, stock: 0, companyId: 'taebaek' });
  expect(unit).toMatchObject({ cost: 700, price: 9000 });
  expect(recomputeAllCosts).toHaveBeenCalledOnce();
  expect(writeMany.mock.calls[0][0][1]).toEqual({ collection: 'item_bom', id: 'bom-box-unit-10__unit', createOnly: true, data: { parent_id: 'box-unit-10', child_id: 'unit', quantity: 10 } });
});

it('생성 완료 뒤 원가 실패는 재생성 유도 없이 별도 단계 안내로 마친다', async () => {
  const unit = { id: 'unit', name: '낱개', companyId: 'taebaek', stock: 0, lots: [], cost: 7 }, writeMany = vi.fn().mockResolvedValue(undefined), notice = vi.fn().mockResolvedValue(undefined);
  const create = actualHandler('createBoxItem', { useCallback: (fn: unknown) => fn, allItems: [unit], companyOf: (row: typeof unit) => row.companyId,
    companyId: 'taebaek', writeMany, COL: { itemBom: 'item_bom' }, refreshStaticData: vi.fn(), itemBoms: [], itemFormulas: [],
    recomputeAllCosts: vi.fn().mockRejectedValue(Error('비공개 원가 오류')), awaitNotice: notice,
    auth: { currentUser: { uid: 'u' } }, orderAskScope: { current: { companyId: 'taebaek', token: {} } } });
  await expect(create(unit, { name: '박스', count: 10, components: [] })).resolves.toBeUndefined();
  expect(writeMany).toHaveBeenCalledOnce(); expect(notice).toHaveBeenCalledWith(expect.stringContaining('박스 품목과 구성은 생성되었습니다'), '박스 생성 후 원가 확인');
  expect(notice.mock.calls[0][0]).not.toContain('비공개');
});

it('회사 또는 실제 UID가 바뀐 생성 요청은 송신 전 차단한다', async () => {
  const unit = { id: 'unit', name: '낱개', companyId: 'taebaek' }, writeMany = vi.fn(), auth = { currentUser: null };
  const create = actualHandler('createBoxItem', { useCallback: (fn: unknown) => fn, allItems: [unit], companyOf: (row: typeof unit) => row.companyId,
    companyId: 'taebaek', writeMany, COL: { itemBom: 'item_bom' }, refreshStaticData: vi.fn(), itemBoms: [], itemFormulas: [], recomputeAllCosts: vi.fn(), awaitNotice: vi.fn(), auth,
    orderAskScope: { current: { companyId: 'punghoe', token: {} } } });
  await expect(create(unit, { name: '박스', count: 10, components: [] })).rejects.toThrow('로그인'); expect(writeMany).not.toHaveBeenCalled();
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

it('실제 박스 생성의 후행 BOM 거절은 박스 문서도 남기지 않는다', async () => {
  const docs = new Map<string, unknown>(), unit = { id: 'unit', name: '낱개', companyId: 'taebaek', stock: 0, lots: [], cost: 7 };
  const create = actualHandler('createBoxItem', {
    useCallback: (fn: unknown) => fn, allItems: [unit], companyOf: (item: typeof unit) => item.companyId, companyId: 'taebaek',
    addItem: vi.fn(async (_collection: string, data: any) => { docs.set('items/' + data.id, data); return data.id; }),
    writeMany: vi.fn().mockRejectedValue(Error('후행 BOM 거절')), COL: { itemBom: 'item_bom' },
    refreshStaticData: vi.fn(), itemBoms: [], itemFormulas: [], recomputeAllCosts: vi.fn(),
    auth: { currentUser: { uid: 'u' } }, orderAskScope: { current: { companyId: 'taebaek', token: {} } }, awaitNotice: vi.fn(),
  });
  await expect(create(unit, { name: '박스', count: 10, components: [] })).rejects.toThrow('후행 BOM');
  expect(docs.size).toBe(0);
});
