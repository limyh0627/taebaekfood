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
  const names = ['saveProfitAccountChange', ports.get('onUpdateAccountCode'), ports.get('onUpdateAccountGroup'), ports.get('onAddAccountCode'), ports.get('onAddAccountGroup'), ports.get('onDeleteAccountCode'), ports.get('onDeleteAccountGroup'), ports.get('onReadAccountOperations'), ports.get('onInspectAccountOperation'), ports.get('onRetryAccountOperation'), ports.get('onCancelAccountOperation'), ports.get('onDiscardAccountOperationCopy'),ports.get('onOpenAccountEdit')];
  const body = names.map(name => {
    if (!name || !declarations.has(name)) throw Error('실제 손익 계정 편집 연결이 없습니다.');
    return `const ${name} = ${declarations.get(name)!.getText(file)};`;
  }).join('\n') + `\nreturn {code:${names[1]},group:${names[2]},createCode:${names[3]},createGroup:${names[4]},deleteCode:${names[5]},deleteGroup:${names[6]},readOperations:${names[7]},inspectOperation:${names[8]},retryOperation:${names[9]},cancelOperation:${names[10]},discardCopy:${names[11]},openEdit:${names[12]}};`;
  return ts.transpileModule(body, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
}
function harness() {
  let current = true;
  const codeWriter = vi.fn(async (..._args: unknown[]): Promise<SaveOutcome> => ({status:'saved'}));
  const groupWriter = vi.fn(async (..._args: unknown[]): Promise<SaveOutcome> => ({status:'saved'}));
  const createCodeWriter = vi.fn(async (..._args: unknown[]): Promise<SaveOutcome> => ({status:'saved'}));
  const createGroupWriter = vi.fn(async (..._args: unknown[]): Promise<SaveOutcome> => ({status:'saved'}));
  const deleteCodeWriter = vi.fn(async (..._args: unknown[]): Promise<SaveOutcome> => ({status:'saved'}));
  const deleteGroupWriter = vi.fn(async (..._args: unknown[]): Promise<SaveOutcome> => ({status:'saved'}));
  const readReferences = vi.fn(async (..._args: unknown[]): Promise<unknown[]> => []);
  const inspect = vi.fn(async (..._args: unknown[]): Promise<SaveOutcome> => ({status:'saved'}));
  const retry = vi.fn(async (..._args: unknown[]): Promise<SaveOutcome> => ({status:'saved'}));
  const cancel = vi.fn(async (..._args: unknown[]): Promise<SaveOutcome> => ({status:'cancelled',message:'적용 전 중단'}));
  const discardWriter = vi.fn(async (..._args: unknown[]): Promise<SaveOutcome> => ({status:'saved'}));
  const openWriter = vi.fn(async (..._args: unknown[]): Promise<unknown> => ({reference:{companyId:'taebaek',planId:'fixed',kind:'code',targetId:'code-1'},actorUid:'actor',expectedVersion:'1:000000001',opening:['map',[]]}));
  const refresh = vi.fn();
  const deps = {captureAccountEditOpening:openWriter,companyId:'taebaek', auth:{currentUser:{uid:'actor'}}, primaryCommitted, saveAccountCodeEdit:codeWriter, saveAccountGroupEdit:groupWriter, saveAccountCodeCreate:createCodeWriter, saveAccountGroupCreate:createGroupWriter, deleteAccountCode:deleteCodeWriter, deleteAccountGroup:deleteGroupWriter, readAccountOperationReferences:readReferences, inspectAccountOperation:inspect, retryAccountOperation:retry, cancelAccountOperation:cancel, discardAccountOperationCopy:discardWriter, refreshStaticData:refresh};
  const callbacks = new Function(...Object.keys(deps), actualCallbacks())(...Object.values(deps));
  const context = {companyId:'taebaek',actorUid:'actor',planId:'plan-fixed',isCurrent:()=>current};
  return {...callbacks,openWriter,codeWriter,groupWriter,createCodeWriter,createGroupWriter,deleteCodeWriter,deleteGroupWriter,readReferences,inspect,retry,cancel,discardWriter,refresh,context,setCurrent:(value:boolean)=>{current=value;}};
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

describe('신규 등록·삭제 실제 부모 연결',()=>{
  it.each(['Code','Group'] as const)('신규 %s의 고정 ID·제출 원문을 그대로 전달하고 업무 ACK 뒤 갱신한다',async kind=>{
    const h=harness(), d=deferred<SaveOutcome>(), writer=kind==='Code'?h.createCodeWriter:h.createGroupWriter;
    writer.mockReturnValue(d.promise);
    const data={id:kind==='Code'?'ac-fixed':'ag-fixed',name:'합성 신규',...(kind==='Code'?{code:'701'}:{type:'비용',plLine:'sgna'})};
    const result=h['create'+kind](data,h.context);
    expect(writer).toHaveBeenCalledWith(data,h.context);expect(h.refresh).not.toHaveBeenCalled();
    d.resolve({status:'saved'});expect(await result).toEqual({status:'saved'});expect(h.refresh).toHaveBeenCalledOnce();
  });
  it.each(['Code','Group'] as const)('삭제 %s도 실제 Promise를 반환하며 ACK 전 갱신하지 않는다',async kind=>{
    const h=harness(), d=deferred<SaveOutcome>(), writer=kind==='Code'?h.deleteCodeWriter:h.deleteGroupWriter;
    writer.mockReturnValue(d.promise);const opening={id:'fixed-id',name:'선택 원문',...(kind==='Code'?{code:'701'}:{type:'자산'})};const result=h['delete'+kind](opening,h.context);
    expect(writer).toHaveBeenCalledWith(opening,h.context);expect(h.refresh).not.toHaveBeenCalled();
    d.resolve({status:'saved'});expect(await result).toEqual({status:'saved'});expect(h.refresh).toHaveBeenCalledOnce();
  });
  it('등록 ACK 뒤 목록 갱신 실패는 등록 완료를 보존하고 새 ID로 다시 등록하지 않는다',async()=>{
    const h=harness();h.refresh.mockImplementation(()=>{throw Error('갱신 시작 실패');});
    const result=await h.createCode({id:'ac-fixed',code:'701',name:'합성 신규'},h.context);
    expect(result).toMatchObject({status:'partial',committedIds:['ac-fixed'],unconfirmedIds:[]});
    expect(h.createCodeWriter).toHaveBeenCalledOnce();expect(result.nextAction).toContain('다시 저장하지 말고');
  });
  it('삭제 미확정은 안내를 보존하고 성공 갱신이나 자동 재삭제를 하지 않는다',async()=>{
    const h=harness(),outcome:SaveOutcome={status:'unknown',message:'삭제 여부 미확인',nextAction:'목록 확인'};
    h.deleteGroupWriter.mockResolvedValue(outcome);expect(await h.deleteGroup({id:'ag-fixed',name:'그룹',type:'자산'},h.context)).toEqual(outcome);
    expect(h.refresh).not.toHaveBeenCalled();expect(h.deleteGroupWriter).toHaveBeenCalledOnce();
  });
  it('등록 중 수명이 바뀌면 늦은 ACK가 다른 화면 갱신을 요청하지 않는다',async()=>{
    const h=harness(),d=deferred<SaveOutcome>();h.createGroupWriter.mockReturnValue(d.promise);
    const result=h.createGroup({id:'ag-fixed',name:'그룹',type:'자산'},h.context);h.setCurrent(false);d.resolve({status:'saved'});
    await result;expect(h.refresh).not.toHaveBeenCalled();
  });
  it('회사 불일치 등록·삭제는 저장 계층을 호출하지 않는다',async()=>{
    const h=harness();h.context.companyId='punghoe';
    expect(await h.createCode({id:'ac-fixed',code:'701',name:'새 계정'},h.context)).toMatchObject({status:'rejected'});
    expect(await h.deleteCode({id:'ac-fixed',name:'계정',code:'701'},h.context)).toMatchObject({status:'rejected'});
    expect(h.createCodeWriter).not.toHaveBeenCalled();expect(h.deleteCodeWriter).not.toHaveBeenCalled();
  });
});

describe('계정 요청별 결과 조회·복구 실제 배선',()=>{
  const reference={companyId:'taebaek',planId:'plan-stored',kind:'code',targetId:'ac-stored'};
  it('영속 복구 목록은 현재 회사·실제 UID scope로 읽는다',async()=>{
    const h=harness(), entries=[{key:'stored-key',reference,status:'valid',description:'원문'}];h.readReferences.mockResolvedValue(entries);
    expect(await h.readOperations(h.context)).toEqual(entries);
    expect(h.readReferences).toHaveBeenCalledWith({companyId:'taebaek',actorUid:'actor'});expect(h.refresh).not.toHaveBeenCalled();
  });
  it.each(['inspectOperation','retryOperation','cancelOperation'] as const)('실제 %s 포트는 고정 reference와 context를 바꾸지 않는다',async mode=>{
    const h=harness(), writer=mode==='inspectOperation'?h.inspect:mode==='retryOperation'?h.retry:h.cancel;
    const gate=deferred<SaveOutcome>();writer.mockReturnValue(gate.promise);const pending=h[mode](reference,h.context);
    expect(writer).toHaveBeenCalledWith(reference,h.context);expect(h.refresh).not.toHaveBeenCalled();
    gate.resolve({status:'saved'});expect(await pending).toEqual({status:'saved'});expect(h.refresh).toHaveBeenCalledOnce();
  });
  it('영수증 부재의 미확정은 성공 갱신하지 않고 같은 요청으로 남긴다',async()=>{
    const h=harness(), result:SaveOutcome={status:'unknown',message:'처리 기록을 아직 확인하지 못했습니다.',nextAction:'같은 요청 결과 확인 또는 중단'};
    h.inspect.mockResolvedValue(result);expect(await h.inspectOperation(reference,h.context)).toEqual(result);
    expect(h.refresh).not.toHaveBeenCalled();expect(h.retry).not.toHaveBeenCalled();expect(h.cancel).not.toHaveBeenCalled();
  });
  it('적용 전 중단 확인은 업무 적용으로 오인해 목록 갱신하지 않는다',async()=>{
    const h=harness();expect(await h.cancelOperation(reference,h.context)).toMatchObject({status:'cancelled'});
    expect(h.refresh).not.toHaveBeenCalled();expect(h.createCodeWriter).not.toHaveBeenCalled();
  });
  it('수명이 끝난 읽기와 복구는 저장 계층에 들어가지 않는다',async()=>{
    const h=harness();h.setCurrent(false);await expect(h.readOperations(h.context)).rejects.toThrow('로그인 계정');
    expect(await h.retryOperation(reference,h.context)).toMatchObject({status:'rejected'});
    expect(h.readReferences).not.toHaveBeenCalled();expect(h.retry).not.toHaveBeenCalled();
  });
});

describe('기기 사본 정리와 업무 처리의 실제 부모 경계',()=>{
  const reference={companyId:'taebaek',planId:'plan-stored',kind:'code',targetId:'ac-stored'};
  it('관측한 사본 원문을 그대로 전달하고 정리 성공을 업무 갱신·재송신으로 연결하지 않는다',async()=>{
    const h=harness(), observed='관측한 원문 문자열';
    expect(await h.discardCopy(reference,observed,h.context)).toEqual({status:'saved'});
    expect(h.discardWriter).toHaveBeenCalledWith(reference,observed,h.context);expect(h.refresh).not.toHaveBeenCalled();
    expect(h.createCodeWriter).not.toHaveBeenCalled();expect(h.deleteCodeWriter).not.toHaveBeenCalled();expect(h.retry).not.toHaveBeenCalled();
  });
  it('서버 미확정의 사본 정리 거절은 그대로 보존한다',async()=>{
    const h=harness(),outcome:SaveOutcome={status:'unknown',message:'서버 확정 기록이 아직 없습니다.',nextAction:'먼저 미처리 요청 중단'};
    h.discardWriter.mockResolvedValue(outcome);expect(await h.discardCopy(reference,'관측 원문',h.context)).toEqual(outcome);
    expect(h.refresh).not.toHaveBeenCalled();expect(h.cancel).not.toHaveBeenCalled();
  });
  it('수명·회사 경계가 다르면 사본 정리 계층을 호출하지 않는다',async()=>{
    const h=harness();h.setCurrent(false);
    expect(await h.discardCopy(reference,'관측 원문',h.context)).toMatchObject({status:'rejected'});
    expect(h.discardWriter).not.toHaveBeenCalled();
  });
});

it('편집 열기는 선택 원문과 고정plan을 서버open에 보내며 업무 목록갱신은 하지 않는다',async()=>{
 const h=harness(),opening={id:'code-1',code:'legacy',name:'최초 선택',note:'미지 원문'},context={...h.context,planId:'opening-plan'};
 const result=await h.openEdit('code',opening,context);
 expect(h.openWriter).toHaveBeenCalledWith('code',opening,context);expect(result.expectedVersion).toBe('1:000000001');expect(h.refresh).not.toHaveBeenCalled();
 const fixed={...context,opening:result};await h.code('code-1',{name:'새 이름'},fixed);
 expect(h.codeWriter).toHaveBeenCalledWith('code-1',{name:'새 이름'},fixed);
});
it('서버open 대기중 회사·UID수명 변경은 편집 준비 결과를 반환하지 않는다',async()=>{
 const h=harness(),pending=deferred<unknown>();h.openWriter.mockReturnValue(pending.promise);
 const result=h.openEdit('group',{id:'g',name:'원본'},h.context);h.setCurrent(false);pending.resolve({expectedVersion:'1:000000001'});
 await expect(result).rejects.toThrow(/회사|로그인/);expect(h.refresh).not.toHaveBeenCalled();
});

it('실제 요청 종결 태그는 갱신실패 partial에도 보존하고 미정리 결과에는 만들지 않는다',async()=>{
 const h=harness();h.refresh.mockImplementation(()=>{throw Error('목록 갱신 실패');});
 h.codeWriter.mockResolvedValue({status:'saved',requestFinalized:true} as SaveOutcome&{requestFinalized:true});
 expect(await h.code('code-1',{name:'수정'},h.context)).toMatchObject({status:'partial',requestFinalized:true,committedIds:['code-1']});
 h.codeWriter.mockResolvedValue({status:'partial',reason:'followup-unconfirmed',committedIds:['code-1'],unconfirmedIds:[],message:'사본 정리 미확인',nextAction:'같은 요청 결과 확인'});
 const result=await h.code('code-1',{name:'수정'},h.context);expect(result).toMatchObject({status:'partial'});expect(result.requestFinalized).toBeUndefined();expect(result.message).toContain('사본 정리 미확인');expect(result.nextAction).toBe('같은 요청 결과 확인');
});
