/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { isSmartStoreItem } from '../../shared/partnerPrice';

function source(path: string) {
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
const admin = source('src/features/admin/AdminApp.tsx');
function initializer(ast: ts.SourceFile, name: string) {
  let expression = '';
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer) expression = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  expect(expression, `${ast.fileName} 실제 ${name}`).not.toBe('');
  return expression;
}
function execute(ast: ts.SourceFile, name: string, dependencies: Record<string, unknown>): any {
  const javascript = ts.transpileModule(`const result = ${initializer(ast, name)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(dependencies), javascript + ';return result;')(...Object.values(dependencies));
}
const useMemo = (calculate: () => unknown) => calculate();
function projection() {
  const products = [
    { id: 'legacy', name: '옛 채널 품목', type: 'product', partnerIds: ['SMARTSTORE', 'old-unlinked'], isSmartStore: false },
    { id: 'modern', name: '새 채널 품목', type: 'product', partnerIds: [], isSmartStore: true },
    { id: 'ordinary', name: '일반 품목', type: 'product', partnerIds: ['old-unlinked'], isSmartStore: false },
  ];
  const submaterials = [{ id: 'sub', name: '부자재', type: 'submaterial', partnerIds: [] }];
  for (const item of [...products, ...submaterials]) { Object.freeze(item.partnerIds); Object.freeze(item); }
  const original = JSON.stringify({ products, submaterials });
  const productClientMap = execute(admin, 'productClientMap', { useMemo, partnerOut: [{ itemId: 'modern', partnerId: 'current-out', Direction: 'out' }] });
  const allItems = execute(admin, 'allItems', { useMemo, products, submaterials, productClientMap, isSmartStoreItem });
  return { products, submaterials, original, allItems };
}

describe('실제 관리자 품목 투영의 스마트스토어 채널 보존', () => {
  it('옛 표식은 공용 OR 판독으로 보존하고 판매 연결은 현재 관계만 남기며 원본을 변경하지 않는다', () => {
    const f = projection();
    expect(f.allItems.map((item: any) => [item.id, item.isSmartStore, item.partnerIds])).toEqual([
      ['legacy', true, []], ['modern', true, ['current-out']], ['ordinary', false, []], ['sub', false, []],
    ]);
    expect(JSON.stringify({ products: f.products, submaterials: f.submaterials })).toBe(f.original);
    expect(f.allItems[0]).not.toBe(f.products[0]);
  });

  it.each(['AddOrderModal', 'PasteOrderModal', 'SmartStoreAnalytics'])('실제 %s 전달 속성은 부모 투영 결과를 사용한다', component => {
    const bindings: string[] = [];
    const visit = (node: ts.Node) => {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(admin) === component) {
        for (const attr of node.attributes.properties) {
          if (ts.isJsxAttribute(attr) && attr.name.getText(admin) === 'items' && attr.initializer && ts.isJsxExpression(attr.initializer)) bindings.push(attr.initializer.expression?.getText(admin) ?? '');
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(admin);
    expect(bindings).toEqual(['allItems']);
  });

  it('부모 투영을 받은 직접 주문·복사 주문·분석의 실제 판독 경로에서 옛 채널 품목이 유지된다', () => {
    const { allItems } = projection();
    const selected = { id: 'smart-partner', type: '스마트스토어' };
    const orderable = execute(source('components/AddOrderModal.tsx'), 'orderableForPartner', { selectedPartner: selected, partnerOutIds: new Set(), isSmartStoreItem });
    expect(allItems.filter(orderable).map((item: any) => item.id)).toEqual(['legacy', 'modern']);
    const copied = execute(source('components/PasteOrderModal.tsx'), 'productPool', { useMemo, items: allItems, partnerOutIds: new Set(), selectedClient: selected, shipToId: null, isSmartStoreItem });
    expect(copied.map((item: any) => item.id)).toEqual(['legacy', 'modern']);
    const analytics = execute(source('components/SmartStoreAnalytics.tsx'), 'ssProducts', { useMemo, items: allItems, isSmartStoreItem });
    expect(new Set(analytics.map((item: any) => item.id))).toEqual(new Set(['legacy', 'modern']));
    const ordinary = execute(source('components/AddOrderModal.tsx'), 'orderableForPartner', { selectedPartner: { id: 'old-unlinked', type: '일반' }, partnerOutIds: new Set(), isSmartStoreItem });
    expect(allItems.filter(ordinary)).toEqual([]);
  });
});
