import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {expect,it,vi} from 'vitest';

const source=readFileSync('src/features/admin/AdminApp.tsx','utf8');
const file=ts.createSourceFile('AdminApp.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const declarations=new Map<string,string>();
const attributes=new Map<string,string>();
function visit(node:ts.Node) {
  if(ts.isVariableDeclaration(node)&&node.initializer) declarations.set(node.name.getText(file),node.initializer.getText(file));
  if((ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))&&node.tagName.getText(file)==='NoticeBoard') {
    for(const attribute of node.attributes.properties) {
      if(ts.isJsxAttribute(attribute)&&attribute.initializer&&ts.isJsxExpression(attribute.initializer)&&attribute.initializer.expression) {
        attributes.set(attribute.name.getText(file),attribute.initializer.expression.getText(file));
      }
    }
  }
  ts.forEachChild(node,visit);
}
visit(file);
function harness() {
  let current=true;
  const names=['open','save','read','inspect','retry','cancel','cleanup','discard','history','reservePhoto','observeLegacy'] as const;
  const writer=Object.fromEntries(names.map(name=>[name,vi.fn<(...args:unknown[])=>Promise<unknown>>(async()=>({status:'saved'}))]));
  const auth={currentUser:{uid:'A'}};
  const deps={noticeWriter:writer,companyId:'taebaek',auth,currentUser:{id:'employee-A'}};
  const binding=attributes.get('noticeBindings');
  if(!binding) throw Error('공지 typed 실부모 배선이 없습니다.');
  const body=['assertNoticeScope',binding].map(name=>{
    const value=declarations.get(name);
    if(!value) throw Error('공지 scope/포트 선언이 없습니다.');
    return 'const '+name+'='+value+';';
  }).join('\n')+'return '+binding+';';
  const code=ts.transpileModule(body,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  const ports=new Function(...Object.keys(deps),code)(...Object.values(deps));
  const context={companyId:'taebaek',actorUid:'A',employeeId:'employee-A',planId:'fixed-plan',postId:'fixed-post',isCurrent:()=>current};
  return {ports,writer,auth,context,setCurrent:(value:boolean)=>{current=value;}};
}
it('실제 공지 JSX는 관리자 표시권한과 직원ID 및 typed 묶음만 전달한다',()=>{
  expect(attributes.get('canWrite')).toBe('isAdmin');
  expect(attributes.get('employeeId')).toBe('currentUser.id');
  expect(attributes.has('onAddPost')).toBe(false);
  expect(attributes.has('onUpdatePost')).toBe(false);
  expect(attributes.has('onDeletePost')).toBe(false);
});
it('선택한 원문과 고정 context는 readonly open에 그대로 전달한다',async()=>{
  const h=harness(),post={id:'fixed-post',content:'기존 본문',blocks:undefined};
  await h.ports.open(post,h.context);
  expect(h.writer.open).toHaveBeenCalledWith(post,h.context);
  expect(h.writer.save).not.toHaveBeenCalled();
});
it('본문과 사진 예약은 각각 고정 원문을 전달하며 부모가 내용을 계산하지 않는다',async()=>{
  const h=harness(),input={action:'edit',patch:{title:'수정'}},request={reference:{uploadId:'fixed-upload'}};
  await h.ports.save(input,h.context);
  await h.ports.reservePhoto(request,h.context);
  expect(h.writer.save).toHaveBeenCalledWith(input,h.context);
  expect(h.writer.reservePhoto).toHaveBeenCalledWith(request,h.context);
});
it('결과조회 중단 재개 사진정리와 관측사본은 정확 reference와 두 raw를 보존한다',async()=>{
  const h=harness(),ref={companyId:'taebaek',postId:'fixed-post',planId:'old-plan'};
  for(const mode of ['inspect','retry','cancel','cleanup']) {
    await h.ports[mode](ref,h.context);
    expect(h.writer[mode]).toHaveBeenCalledWith(ref,h.context);
  }
  await h.ports.discard(ref,'본문 관측 A','참조 관측 A',h.context);
  expect(h.writer.discard).toHaveBeenCalledWith(ref,'본문 관측 A','참조 관측 A',h.context);
  expect(h.writer.save).not.toHaveBeenCalled();
});
it('회사 UID 직원 및 화면 수명 변경은 송신 전에 거절한다',async()=>{
  const h=harness();
  for(const context of [{...h.context,companyId:'punghoe'},{...h.context,actorUid:'B'},{...h.context,employeeId:'employee-B'}]) {
    expect(()=>h.ports.save({action:'delete'},context)).toThrow(/로그인/);
  }
  h.setCurrent(false);
  expect(()=>h.ports.cancel({},h.context)).toThrow(/로그인/);
  expect(h.writer.save).not.toHaveBeenCalled();
  expect(h.writer.cancel).not.toHaveBeenCalled();
});
it('readonly 응답 대기 중 UID 변경은 목록과 현재 초안으로 반환하지 않는다',async()=>{
  const h=harness();let finish!:(value:unknown)=>void;
  h.writer.read.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const result=h.ports.read(h.context);
  h.auth.currentUser.uid='B';finish([]);
  await expect(result).rejects.toThrow(/로그인/);
});
it('명시 이력 조회는 cursor를 그대로 전달하고 업무 저장을 호출하지 않는다',async()=>{
  const h=harness();await h.ports.history(h.context,'next-cursor');
  expect(h.writer.history).toHaveBeenCalledWith(h.context,'next-cursor');
  expect(h.writer.save).not.toHaveBeenCalled();
});

it('이전 generic 원문 대조는 별도 readonly observe이며 저장·중단으로 승격하지 않는다',async()=>{
  const h=harness(),reference={companyId:'taebaek',postId:'legacy',planId:'observe-only'};
  await h.ports.observeLegacy(reference,h.context);
  expect(h.writer.observeLegacy).toHaveBeenCalledWith(reference,h.context);
  expect(h.writer.save).not.toHaveBeenCalled();
  expect(h.writer.cancel).not.toHaveBeenCalled();
});
