import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { resolvedModelFields, collectFieldReferences, referencesOfDeclarations } from './resolved-model-fields.mjs';
import { resolve } from 'node:path';

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

function indexed(source) {
  const path='/references.ts', host=ts.createCompilerHost({});
  const original=host.getSourceFile.bind(host);
  host.getSourceFile=(name,target,...rest)=>name===path?ts.createSourceFile(path,source,target,true):original(name,target,...rest);
  const program=ts.createProgram([path],{strict:true},host), file=program.getSourceFile(path), checker=program.getTypeChecker(), refs=new Map();
  const location=node=>`${node.getSourceFile().fileName}:${node.getStart()}`;
  const visit=node=>{collectFieldReferences(checker,node,location,refs);ts.forEachChild(node,visit);};visit(file);visit(file);
  return {read:name=>resolvedModelFields(checker,file.statements.find(node=>node.name?.text===name),location,refs),refs,file};
}
describe('원선언에 연결된 정적 사용처',()=>{
  it('동명 모델을 분리하고 상속·Partial에는 같은 원선언 참조를 중복 없이 연결한다',()=>{
    const {read}=indexed('interface A { kg:number } interface B { kg:number } interface Child extends A {} type P=Partial<A>; declare let a:A,b:B,c:Child,p:P; a.kg; c.kg; p.kg; b.kg;');
    const a=read('A').fields[0], b=read('B').fields[0];expect(a.references).toHaveLength(3);expect(b.references).toHaveLength(1);expect(a.references).not.toContain(b.references[0]);expect(read('Child').fields[0].references).toEqual(a.references);expect(read('P').fields[0].references).toEqual(a.references);expect(JSON.parse(JSON.stringify(read('A')))).toEqual(read('A'));
  });
  it('교차 필드의 복수 원선언을 합치되 불명확한 공용체·any·인덱스·구조분해는 추정하지 않는다',()=>{
    const {read}=indexed('interface A {kg:number} interface B {kg:number} type Joined=A&B; type Union=A|B; declare let j:Joined,u:Union,x:any,a:A; j.kg; u.kg; x.kg; a["kg"]; const {kg}=a;');
    expect(read('Joined').fields[0].declarations).toHaveLength(2);expect(read('Joined').fields[0].references).toHaveLength(1);expect(read('A').fields[0].references).toEqual(read('Joined').fields[0].references);expect(read('Union').fields).toEqual([]);
  });
  it('실제 PackRow와 RawInventoryState 원선언에 운영 소스의 참조를 연결한다',()=>{
    const files=['src/shared/packIndex.ts','src/shared/services/rawInventoryService.ts','functions/src/shared/rawInventoryCore.ts'].map(name=>resolve(name));
    const program=ts.createProgram(files,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,skipLibCheck:true}), checker=program.getTypeChecker(),refs=new Map();
    const location=node=>`${node.getSourceFile().fileName.replaceAll('\\','/')}:${node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line+1}`;
    for(const file of program.getSourceFiles()){if(file.fileName.includes('node_modules'))continue;const visit=node=>{collectFieldReferences(checker,node,location,refs);ts.forEachChild(node,visit);};visit(file);}
    for(const [path,model,field,consumer] of [['src/shared/packIndex.ts','PackRow','units_per_box','packIndex.ts:43'],['functions/src/shared/rawInventoryCore.ts','RawInventoryState','stockKg','rawInventoryService.ts:109']]){
      const declaration=program.getSourceFile(resolve(path)).statements.find(node=>node.name?.text===model), result=resolvedModelFields(checker,declaration,location,refs).fields.find(row=>row.field===field);
      expect(result.references.some(value=>value.endsWith(consumer))).toBe(true);const original=declaration.members.find(node=>node.name?.getText()===field);expect(referencesOfDeclarations([original],refs)).toEqual(result.references);
    }
  });
});
