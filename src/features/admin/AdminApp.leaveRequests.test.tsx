/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { companyOf, type LeaveRequest } from '../../shared/types';
import { leaveStatusPatch } from '../../shared/leave';
import type { SaveOutcome } from '../../shared/saveOutcome';

const source=readFileSync('src/features/admin/AdminApp.tsx','utf8');
const ast=ts.createSourceFile('AdminApp.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const names=['leaveRenderUid','leaveRenderToken','currentLeaveScope','leaveScopeRejected','runLeaveAction','handleAddLeaveRequests','handleInspectLeaveRequest','handleCancelLeaveRequest','handleCancelLeaveReference','readPendingLeaveRequests','readPendingLeaveGroups','readLeaveReferences','handleLeaveAction','readPendingLeaveActions','handleInspectLeaveAction','handleCancelLeaveAction'];
function parentHarness() {
 const declarations:string[]=[];
 const visit=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&names.includes(node.name.getText(ast)))declarations.push(`const ${node.getText(ast)};`);ts.forEachChild(node,visit);};visit(ast);
 expect(declarations).toHaveLength(names.length);
 const row:LeaveRequest={id:'leave',employeeId:'employee',employeeName:'합성 직원',type:'연차',startDate:'2025-02-03',endDate:'2025-02-03',reason:'합성 신청',status:'pending',requestedAt:'2025-02-01T00:00:00Z',daysUsed:1};
 const auth={currentUser:{uid:'actor'}},orderAskScope={current:{companyId:'taebaek',token:{}}};
 const submit=vi.fn(async()=>({outcome:{status:'saved'} as SaveOutcome})),inspect=vi.fn(async()=>({status:'saved'} as SaveOutcome)),cancel=vi.fn(async()=>({status:'cancelled',message:'요청 중단 확인'} as SaveOutcome));
 const actionSubmit=vi.fn(async(..._args:unknown[])=>({outcome:{status:'saved'} as SaveOutcome})),inspectAction=vi.fn(async()=>({status:'unknown',message:'수정 미확인',nextAction:'수정 요청 중단'} as SaveOutcome)),cancelAction=vi.fn(async()=>({status:'cancelled',message:'수정 중단'} as SaveOutcome)),pendingActions=vi.fn(()=>[]);
 const pending=vi.fn(()=>[row]),groups=vi.fn(()=>[{id:row.id,requests:[row]}]),references=vi.fn(()=>[{planId:'damaged',readable:false}]),cancelReference=vi.fn(async()=>({status:'cancelled',message:'중단 확인'} as SaveOutcome));
 const update=vi.fn(async()=>{}),notice=vi.fn(),employees=[{id:'employee',companyId:'taebaek'}];
 const deps={auth,orderAskScope,companyId:'taebaek',employees,leaveRequests:[row],currentUser:{id:'employee',name:'관리자'},companyOf,leaveStatusPatch,updateItem:update,setAppNotice:notice,
  submitLeaveRequests:submit,submitLeaveAction:actionSubmit,inspectLeaveAction:inspectAction,cancelLeaveAction:cancelAction,pendingLeaveActions:pendingActions,inspectLeaveRequest:inspect,cancelLeaveRequest:cancel,pendingLeaveRequests:pending,pendingLeaveGroups:groups,listLeaveReferences:references,cancelLeaveReference:cancelReference};
 const body=ts.transpileModule(declarations.join('\n')+`\nreturn {${names.join(',')}};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const callbacks=new Function(...Object.keys(deps),body)(...Object.values(deps));
 return {...deps,callbacks,row,actionSubmit,inspectAction,cancelAction,pendingActions,submit,inspect,cancel,pending,groups,references,cancelReference,update,notice};
}
function jsxCallback(component:string,prop:string,bindings:Record<string,unknown>) {
 let expression:ts.Expression|undefined;
 const visit=(node:ts.Node)=>{if((ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))&&node.tagName.getText(ast)===component){
  const attribute=node.attributes.properties.find(p=>ts.isJsxAttribute(p)&&p.name.getText(ast)===prop) as ts.JsxAttribute|undefined;
  if(attribute?.initializer&&ts.isJsxExpression(attribute.initializer))expression=attribute.initializer.expression;
 }ts.forEachChild(node,visit);};visit(ast);expect(expression).toBeDefined();
 const code=ts.transpileModule(`const callback=${expression!.getText(ast)};return callback;`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 return new Function(...Object.keys(bindings),code)(...Object.values(bindings));
}
it('개인·단체의 실제 부모 콜백은 같은 서비스에 정확한 알림 플래그를 보내고 outcome을 그대로 반환한다',async()=>{
 const h=parentHarness(),personal=jsxCallback('LeaveManager','onAddLeaveRequest',h.callbacks),group=jsxCallback('HRManager','onAddLeaveRequests',h.callbacks);
 const rejected:SaveOutcome={status:'rejected',message:'원문 보관 공간 부족',nextAction:'공간을 확인한 뒤 다시 신청해 주세요.'};h.submit.mockResolvedValueOnce({outcome:rejected});
 expect(await personal(h.row)).toBe(rejected);expect(h.submit).toHaveBeenLastCalledWith({companyId:'taebaek',actorUid:'actor'},[h.row],h.employees,true);
 expect(await group([h.row])).toEqual({status:'saved'});expect(h.submit).toHaveBeenLastCalledWith({companyId:'taebaek',actorUid:'actor'},[h.row],h.employees,false);expect(h.update).not.toHaveBeenCalled();
 const partial:SaveOutcome={status:'partial',reason:'followup-unconfirmed',committedIds:['leave'],unconfirmedIds:[],message:'신청 저장 완료 · 알림 결과 미확인',nextAction:'신청을 다시 보내지 말고 알림을 확인해 주세요.'};h.submit.mockResolvedValueOnce({outcome:partial});expect(await personal(h.row)).toBe(partial);
});
it('보관 원문·손상 참조·결과 확인·중단 API를 두 실제 화면에 빠짐없이 연결한다',async()=>{
 const h=parentHarness(),scope={companyId:'taebaek',actorUid:'actor'};
 for(const component of ['HRManager','LeaveManager']){
  expect(jsxCallback(component,'requestScopeKey',h.callbacks)).toBe('actor');
  await jsxCallback(component,'onInspectLeaveRequest',h.callbacks)('leave');expect(h.inspect).toHaveBeenLastCalledWith(scope,'leave',h.employees);
  await jsxCallback(component,'onCancelLeaveRequest',h.callbacks)('leave');expect(h.cancel).toHaveBeenLastCalledWith(scope,'leave');
  expect(jsxCallback(component,'onReadLeaveReferences',h.callbacks)()).toEqual([{planId:'damaged',readable:false}]);expect(h.references).toHaveBeenLastCalledWith(scope);
  await jsxCallback(component,'onCancelLeaveReference',h.callbacks)('damaged');expect(h.cancelReference).toHaveBeenLastCalledWith(scope,'damaged');
 }
 expect(jsxCallback('LeaveManager','onReadPendingLeaveRequests',h.callbacks)()).toEqual([h.row]);expect(h.pending).toHaveBeenCalledWith(scope);
 expect(jsxCallback('HRManager','onReadPendingLeaveGroups',h.callbacks)()).toEqual([{id:'leave',requests:[h.row]}]);expect(h.groups).toHaveBeenCalledWith(scope);
});
it.each(['uid','company','token'])('렌더 이후 %s 경계가 바뀌면 휴가 요청·보관 조회·변경 쓰기를 시작하지 않는다',async boundary=>{
 const h=parentHarness();if(boundary==='uid')h.auth.currentUser={uid:'other'};if(boundary==='company')h.orderAskScope.current.companyId='punghoe';if(boundary==='token')h.orderAskScope.current.token={};
 expect((await h.callbacks.handleAddLeaveRequests([h.row],true)).status).toBe('rejected');expect((await h.callbacks.handleLeaveAction(h.row,{action:'approve'})).status).toBe('rejected');
 expect(h.callbacks.readPendingLeaveRequests()).toEqual([]);expect(h.callbacks.readLeaveReferences()).toEqual([]);expect(h.submit).not.toHaveBeenCalled();expect(h.pending).not.toHaveBeenCalled();expect(h.references).not.toHaveBeenCalled();expect(h.update).not.toHaveBeenCalled();
});
it('mutation은 UI가 표시한 원문을 그대로 전송하고 부모의 최신 목록으로 재조립하지 않는다',async()=>{
 const h=parentHarness(),original={...h.row,reason:'작성 당시 원문'};h.leaveRequests[0]={...h.row,reason:'나중 목록'};
 await h.callbacks.handleLeaveAction(original,{action:'approve-modify'});
 expect(h.actionSubmit).toHaveBeenCalledExactlyOnceWith({companyId:'taebaek',actorUid:'actor'},original,{action:'approve-modify'});expect(h.actionSubmit.mock.calls[0][1]).toBe(original);expect(h.update).not.toHaveBeenCalled();
});
it('create 완료와 mutation 미확인이 섞여도 수정 복구는 정확한 v2 plan API만 호출한다',async()=>{
 const h=parentHarness();await h.callbacks.handleInspectLeaveRequest('leave');expect(h.inspect).toHaveBeenCalled();
 for(const component of ['HRManager','LeaveManager','AdminChecklist']){
  expect((await jsxCallback(component,'onInspectLeaveAction',h.callbacks)('mutation-plan')).status).toBe('unknown');
  expect(h.inspectAction).toHaveBeenLastCalledWith({companyId:'taebaek',actorUid:'actor'},'mutation-plan');
  await jsxCallback(component,'onCancelLeaveAction',h.callbacks)('mutation-plan');expect(h.cancelAction).toHaveBeenLastCalledWith({companyId:'taebaek',actorUid:'actor'},'mutation-plan');
 }
 expect(h.inspect).toHaveBeenCalledTimes(1);
});
it('실제 3메뉴는 같은 action 콜백을 전달하고 휴가 직접 생성·수정 writer를 남기지 않는다',()=>{
 expect(source).not.toContain("addItem('leaveRequests'");expect(source).not.toContain("updateItem('leaveRequests'");
 const h=parentHarness();for(const component of ['HRManager','LeaveManager','AdminChecklist'])expect(jsxCallback(component,'onLeaveAction',h.callbacks)).toBe(h.callbacks.handleLeaveAction);
});
