import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { resolvedModelFields } from './resolved-model-fields.mjs';

function fixture(source) {
  const path = '/model.ts';
  const host = ts.createCompilerHost({});
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, target, ...rest) => name === path ? ts.createSourceFile(path, source, target, true) : original(name, target, ...rest);
  const program = ts.createProgram([path], { strict: true }, host);
  const file = program.getSourceFile(path);
  const checker = program.getTypeChecker();
  return name => resolvedModelFields(checker, file.statements.find(node => node.name?.text === name), node => `${node.parent.name?.text}.${node.name?.getText()}`);
}

describe('사전의 정적 상속 필드', () => {
  it('상속 필드와 직접 필드를 구분하고 원래 선언을 보존한다', () => {
    const read = fixture('interface Base { kg: number; id?: string } interface Child extends Base { qty: number }');
    expect(read('Child').fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'kg', optional: false, declarations: ['Base.kg'], inherited: true }),
      expect.objectContaining({ field: 'qty', inherited: false }),
    ]));
  });
  it('Partial의 선택 필드를 원본 선언으로 추적하고 교차 모델을 펼친다', () => {
    const read = fixture('interface Snapshot { unitKg: number; inventoryQty: number } interface Line extends Partial<Snapshot> { qty: number } type Joined = Snapshot & { sourceLineIndex: number };');
    expect(read('Line').fields.find(row => row.field === 'unitKg')).toMatchObject({ optional: true, declarations: ['Snapshot.unitKg'] });
    expect(read('Joined').fields.map(row => row.field).sort()).toEqual(['inventoryQty', 'sourceLineIndex', 'unitKg']);
    expect(read('Joined').fields.find(row => row.field === 'sourceLineIndex').inherited).toBe(false);
  });
  it('공용체·동적 any를 임의로 완전한 DB 모델이라고 펼치지 않는다', () => {
    const read = fixture('type Direction = "in" | "out"; type Dynamic = any; type Union = {a: number} | {b: number};');
    expect(read('Direction').scope).toBe('non-object-model-not-expanded');
    expect(read('Dynamic').scope).toBe('unresolved-model');
    expect(read('Union').fields).toEqual([]);
  });
});
