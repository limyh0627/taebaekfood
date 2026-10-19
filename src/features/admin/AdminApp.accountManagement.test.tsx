import fs from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { primaryCommitted, type SaveOutcome } from '../../shared/saveOutcome';
const source = fs.readFileSync(new URL('./AdminApp.tsx', import.meta.url), 'utf8');
function actualCallbacks() {
  const file = ts.createSourceFile('AdminApp.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = new Map<string, ts.Expression>();
  const ports = new Map<string, string>();
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.initializer) declarations.set(node.name.getText(file), node.initializer);
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(file) === 'ProfitAnalysis') {
      for (const attr of node.attributes.properties) {
        if (ts.isJsxAttribute(attr) && attr.initializer && ts.isJsxExpression(attr.initializer) && attr.initializer.expression)
          ports.set(attr.name.getText(file), attr.initializer.expression.getText(file));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  const names = ['saveProfitAccountEdit', ports.get('onUpdateAccountCode'), ports.get('onUpdateAccountGroup')];
  const body = names.map(name => {
    if (!name || !declarations.has(name)) throw Error('실제 손익 계정 편집 연결이 없습니다.');
    return `const ${name} = ${declarations.get(name)!.getText(file)};`;
  }).join('\n') + `\nreturn {code:${names[1]},group:${names[2]}};`;
  return ts.transpileModule(body, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
}
function harness() {
  let current = true;
  const codeWriter = vi.fn(async (..._args: unknown[]): Promise<SaveOutcome> => ({status:'saved'}));
  const groupWriter = vi.fn(async (..._args: unknown[]): Promise<SaveOutcome> => ({status:'saved'}));
  const refresh = vi.fn();
  const deps = {companyId:'taebaek', primaryCommitted, saveAccountCodeEdit:codeWriter, saveAccountGroupEdit:groupWriter, refreshStaticData:refresh};
  const callbacks = new Function(...Object.keys(deps), actualCallbacks())(...Object.values(deps));
  const context = {companyId:'taebaek',actorUid:'actor',isCurrent:()=>current};
  return {...callbacks,codeWriter,groupWriter,refresh,context,setCurrent:(value:boolean)=>{current=value;}};
}
function deferred<T>() { let resolve!: (value:T)=>void; const promise = new Promise<T>(r=>{resolve=r;}); return {promise,resolve}; }
describe('손익 계정 편집 실제 부모 연결',()=>{
  it('실제 JSX 콜백은 저장 Promise를 반환하고 ACK 뒤에만 목록 갱신을 요청한다',async()=>{
    const h=harness(), d=deferred<SaveOutcome>(), patch={name:'바꾼 계정'};
    h.codeWriter.mockReturnValue(d.promise);
    const result=h.code('code-1',patch,h.context);
    expect(result).toBeInstanceOf(Promise);
    expect(h.codeWriter).toHaveBeenCalledWith('code-1',patch,h.context);
    expect(h.refresh).not.toHaveBeenCalled();
    d.resolve({status:'saved'});
    expect(await result).toEqual({status:'saved'});
    expect(h.refresh).toHaveBeenCalledOnce();
  });
  it('명시 손익 해제를 null 그대로 저장 계층에 전달한다',async()=>{
    const h=harness(), patch={plLine:null};
    await h.group('group-1',patch,h.context);
    expect(h.groupWriter).toHaveBeenCalledWith('group-1',patch,h.context);
    expect(h.refresh).toHaveBeenCalledOnce();
  });
  it.each<SaveOutcome>([
    {status:'unknown',message:'응답 미확인',nextAction:'목록 확인'},
    {status:'rejected',message:'저장 전 거절'},
  ])('미확정·거절은 그대로 반환하고 목록 갱신을 성공처럼 요청하지 않는다: $status',async outcome=>{
    const h=harness(); h.groupWriter.mockResolvedValue(outcome);
    expect(await h.group('group-1',{name:'수정'},h.context)).toEqual(outcome);
    expect(h.refresh).not.toHaveBeenCalled();
  });
  it('예상 밖 Promise 거절도 성공으로 바꾸지 않는다',async()=>{
    const h=harness(); h.codeWriter.mockRejectedValue(Error('예상 밖 오류'));
    await expect(h.code('code-1',{name:'수정'},h.context)).rejects.toThrow('예상 밖 오류');
    expect(h.refresh).not.toHaveBeenCalled();
  });
  it('업무 ACK 뒤 갱신 시작 실패는 주업무 완료를 보존하며 재송신하지 않는다',async()=>{
    const h=harness(); h.refresh.mockImplementation(()=>{throw Error('갱신 실패');});
    const result=await h.code('code-1',{name:'수정'},h.context);
    expect(result).toMatchObject({status:'partial',committedIds:['code-1'],unconfirmedIds:[]});
    expect(result.nextAction).toContain('다시 저장하지 말고');
    expect(h.codeWriter).toHaveBeenCalledOnce();
  });
  it.each(['회사','편집 수명'])('시작 전 %s가 다르면 저장·갱신을 시작하지 않는다',async kind=>{
    const h=harness(); if(kind==='회사') h.context.companyId='punghoe'; else h.setCurrent(false);
    expect(await h.group('group-1',{name:'수정'},h.context)).toMatchObject({status:'rejected'});
    expect(h.groupWriter).not.toHaveBeenCalled(); expect(h.refresh).not.toHaveBeenCalled();
  });
  it('대기 중 편집 수명이 끝나면 늦은 ACK가 새 화면을 갱신하지 않는다',async()=>{
    const h=harness(),d=deferred<SaveOutcome>(); h.codeWriter.mockReturnValue(d.promise);
    const result=h.code('code-1',{name:'수정'},h.context); h.setCurrent(false); d.resolve({status:'saved'});
    expect(await result).toEqual({status:'saved'}); expect(h.refresh).not.toHaveBeenCalled();
  });
});
