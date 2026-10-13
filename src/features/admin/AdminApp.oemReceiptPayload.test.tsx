import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';

const source = readFileSync('src/features/admin/AdminApp.tsx', 'utf8');
const ast = ts.createSourceFile('AdminApp.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function actualCallback() {
  let expression = '';
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'createOemEngine') {
      const options = node.arguments[0];
      if (ts.isObjectLiteralExpression(options)) {
        const property = options.properties.find(p => p.name?.getText(ast) === 'applyOemReceiptInventory');
        if (property && ts.isPropertyAssignment(property)) expression = property.initializer.getText(ast);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  expect(expression).not.toBe('');
  const js = ts.transpileModule(`const callback = ${expression};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function('receiveOemFinishedGoodsCommand', `${js}; return callback;`);
}
const base = { poId: 'po', operationId: 'op', date: '2026-10-13', items: [{ itemId: '완제품', qty: 7 }], feeRequest: { oemFeePerKg: 500 } };
const expected = { poId: 'po', operationId: 'op', date: '2026-10-13', returns: [{ itemId: '완제품', qty: 7 }], unitPricePerKg: 500 };
it('실제 관리자 입고 callback은 확인된 원가 근거를 원문 그대로 전달한다', async () => {
  const evidence = { version: 1, ownerCompanyId: 'taebaek', rawMaterials: [{ rawItemId: '원료', kg: 100, supplyAmount: 123456 }], packaging: { confirmed: true, supplyAmount: 900 }, capturedAt: '2026-10-13T01:00:00Z' };
  const send = vi.fn().mockResolvedValue({ status: 'applied' });
  const input = { ...base, oemCostEvidence: evidence };
  const before = JSON.stringify(input);
  await actualCallback()(send)(input);
  expect(send).toHaveBeenCalledExactlyOnceWith({ ...expected, oemCostEvidence: evidence });
  expect(send.mock.calls[0][0].oemCostEvidence).toBe(evidence);
  expect(JSON.stringify(input)).toBe(before);
});
it.each([{}, { oemCostEvidence: undefined }])('근거 없는 기존 입고는 새 필드나 새 가드 없이 같은 요청을 보낸다', async extra => {
  const send = vi.fn().mockResolvedValue({ status: 'duplicate' });
  await actualCallback()(send)({ ...base, ...extra });
  expect(send).toHaveBeenCalledExactlyOnceWith(expected);
  expect(Object.hasOwn(send.mock.calls[0][0], 'oemCostEvidence')).toBe(false);
});
it('벌크만 또는 혼합 입고의 홀더 ID와 kg를 실제 관리자 callback이 그대로 전달한다',async()=>{const bulk=[{material:'볶음참깨',kg:100,rawItemId:'raw'}],send=vi.fn().mockResolvedValue({status:'applied'});await actualCallback()(send)({...base,items:[],bulk});expect(send).toHaveBeenCalledWith({...expected,returns:[],bulk});expect(send.mock.calls[0][0].bulk).toBe(bulk);});
it('빈 벌크 목록은 기존 완제품 요청에 필드를 추가하지 않는다',async()=>{const send=vi.fn();await actualCallback()(send)({...base,bulk:[]});expect(send).toHaveBeenCalledWith(expected);});
