import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

/** 화면이 열렸다는 이유만으로 품목·월말 재고를 만들거나 지우지 못하도록 effect의 쓰기 경로를 점검한다. */
function inventoryWritesOnMount(source: string): number[] {
  const file = ts.createSourceFile('AdminApp.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: number[] = [];
  const isNamed = (node: ts.Expression, name: string) => ts.isIdentifier(node) && node.text === name;
  const itemCollection = (node: ts.Expression | undefined) => !!node && ts.isStringLiteral(node) && ['items', 'inventorySnapshots'].includes(node.text);
  const itemDoc = (node: ts.Expression | undefined) => !!node && ts.isCallExpression(node)
    && isNamed(node.expression, 'doc') && itemCollection(node.arguments[1]);
  const inspectEffect = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const args = node.arguments;
      const direct = (isNamed(node.expression, 'addItem') || isNamed(node.expression, 'updateItem')) && itemCollection(args[0]);
      const document = ['setDoc', 'updateDoc', 'deleteDoc'].some(name => isNamed(node.expression, name)) && itemDoc(args[0]);
      if (direct || document) found.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1);
    }
    ts.forEachChild(node, inspectEffect);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isNamed(node.expression, 'useEffect') && node.arguments[0]) {
      inspectEffect(node.arguments[0]);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe('관리자 화면 진입 시 품목·월말 재고 DB 쓰기', () => {
  it('effect 안에서 품목·월말 재고를 자동 생성·수정·삭제하지 않는다', () => {
    const source = readFileSync('src/features/admin/AdminApp.tsx', 'utf8');
    expect(inventoryWritesOnMount(source)).toEqual([]);
  });

  it('수동 월말 저장 callback은 자동 쓰기로 오인하지 않는다', () => {
    expect(inventoryWritesOnMount("const save = () => addItem('inventorySnapshots', { id: 'manual' });")).toEqual([]);
  });

  it('위험한 자동 쓰기를 검사기가 잡는다', () => {
    expect(inventoryWritesOnMount("useEffect(() => { void addItem('items', { id: 'f1' }); }, []);"))
      .toEqual([1]);
    expect(inventoryWritesOnMount("useEffect(() => { void addItem('inventorySnapshots', { id: 'inv-snap-old', value: 0 }); }, []);")).toEqual([1]);
    expect(inventoryWritesOnMount("useEffect(() => { void setDoc(doc(db, 'inventorySnapshots', 'old'), { value: 0 }); }, []);")).toEqual([1]);
    expect(inventoryWritesOnMount("useEffect(() => { void deleteDoc(doc(db, 'items', 's-auto-x')); }, []);"))
      .toEqual([1]);
  });
});
