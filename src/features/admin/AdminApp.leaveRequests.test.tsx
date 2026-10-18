/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { companyOf, type LeaveRequest } from '../../shared/types';
import { leaveStatusPatch } from '../../shared/leave';
import type { SaveOutcome } from '../../shared/saveOutcome';

const source=readFileSync('src/features/admin/AdminApp.tsx','utf8');
const ast=ts.createSourceFile('AdminApp.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const names=['leaveRenderUid','leaveRenderToken','currentLeaveScope','leaveScopeRejected','runLeaveAction','handleAddLeaveRequests','handleInspectLeaveRequest','handleCancelLeaveRequest','handleCancelLeaveReference','readPendingLeaveRequests','readPendingLeaveGroups','readLeaveReferences','handleUpdateLeave','handleUpdateLeaveStatus','handleChecklistLeaveStatus'];
function parentHarness() {
 const declarations:string[]=[];
 const visit=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&names.includes(node.name.getText(ast)))declarations.push(`const ${node.getText(ast)};`);ts.forEachChild(node,visit);};visit(ast);
 expect(declarations).toHaveLength(names.length);
 const row:LeaveRequest={id:'leave',employeeId:'employee',employeeName:'합성 직원',type:'연차',startDate:'2025-02-03',endDate:'2025-02-03',reason:'합성 신청',status:'pending',requestedAt:'2025-02-01T00:00:00Z',daysUsed:1};
 const auth={currentUser:{uid:'actor'}},orderAskScope={current:{companyId:'taebaek',token:{}}};
 const submit=vi.fn(async()=>({outcome:{status:'saved'} as SaveOutcome})),inspect=vi.fn(async()=>({status:'saved'} as SaveOutcome)),cancel=vi.fn(async()=>({status:'cancelled',message:'요청 중단 확인'} as SaveOutcome));
 const pending=vi.fn(()=>[row]),groups=vi.fn(()=>[{id:row.id,requests:[row]}]),references=vi.fn(()=>[{planId:'damaged',readable:false}]),cancelReference=vi.fn(async()=>({status:'cancelled',message:'중단 확인'} as SaveOutcome));
 const update=vi.fn(async()=>{}),notice=vi.fn(),employees=[{id:'employee',companyId:'taebaek'}];
 const deps={auth,orderAskScope,companyId:'taebaek',employees,leaveRequests:[row],currentUser:{id:'employee',name:'관리자'},companyOf,leaveStatusPatch,updateItem:update,setAppNotice:notice,
  submitLeaveRequests:submit,inspectLeaveRequest:inspect,cancelLeaveRequest:cancel,pendingLeaveRequests:pending,pendingLeaveGroups:groups,listLeaveReferences:references,cancelLeaveReference:cancelReference};
 const body=ts.transpileModule(declarations.join('\n')+`\nreturn {${names.join(',')}};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const callbacks=new Function(...Object.keys(deps),body)(...Object.values(deps));
 return {...deps,callbacks,row,submit,inspect,cancel,pending,groups,references,cancelReference,update,notice};
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
 expect((await h.callbacks.handleAddLeaveRequests([h.row],true)).status).toBe('rejected');expect((await h.callbacks.handleUpdateLeave('leave',{status:'approved'})).status).toBe('rejected');
 expect(h.callbacks.readPendingLeaveRequests()).toEqual([]);expect(h.callbacks.readLeaveReferences()).toEqual([]);expect(h.submit).not.toHaveBeenCalled();expect(h.pending).not.toHaveBeenCalled();expect(h.references).not.toHaveBeenCalled();expect(h.update).not.toHaveBeenCalled();
});
it('휴가 변경은 ACK를 기다리고 상태·취소 사유 정본을 유지하며 송신 후 예외만 unknown으로 반환한다',async()=>{
 const h=parentHarness();let resolve!:()=>void;h.update.mockImplementationOnce(()=>new Promise<void>(done=>{resolve=done;}));
 let settled=false;const pending=h.callbacks.handleUpdateLeaveStatus('leave','cancelled','확인 사유').then((value:SaveOutcome)=>{settled=true;return value;});
 expect(settled).toBe(false);expect(h.update).toHaveBeenCalledWith('leaveRequests','leave',expect.objectContaining({status:'cancelled',cancelledBy:'employee',cancelledByName:'관리자',cancelReason:'확인 사유'}));
 resolve();expect(await pending).toEqual({status:'saved'});
 h.update.mockRejectedValueOnce(new Error('응답 유실'));expect(await h.callbacks.handleUpdateLeave('leave',{status:'approved'})).toMatchObject({status:'unknown',nextAction:expect.stringContaining('현재 신청 상태')});
 expect((await h.callbacks.handleUpdateLeave('outside',{status:'approved'})).status).toBe('rejected');expect(h.update).toHaveBeenCalledTimes(2);
});
it('확인사항의 void 소비 경로도 Promise 결과를 반환하고 실패 안내를 남기며 늦은 다른 신원에는 띄우지 않는다',async()=>{
 const h=parentHarness(),callback=jsxCallback('AdminChecklist','onUpdateLeaveStatus',h.callbacks);
 h.update.mockRejectedValueOnce(new Error('응답 유실'));expect((await callback('leave','approved')).status).toBe('unknown');expect(h.notice).toHaveBeenCalledWith(expect.objectContaining({message:expect.stringContaining('결과를 확인하지 못했습니다'),subMessage:expect.stringContaining('현재 신청 상태')}));
 h.notice.mockClear();h.update.mockImplementationOnce(async()=>{h.auth.currentUser={uid:'other'};throw Error('늦은 오류');});await callback('leave','approved');expect(h.notice).not.toHaveBeenCalled();
});
it('부모는 휴가 직접 생성·for-await 단체 등록을 남기지 않고 모든 결재 콜백의 Promise를 전달한다',()=>{
 expect(source).not.toContain("addItem('leaveRequests'");expect(source).not.toContain("for (const r of reqs)");
 const h=parentHarness();for(const component of ['HRManager','LeaveManager']){
  expect(jsxCallback(component,'onUpdateLeaveStatus',h.callbacks)).toBe(h.callbacks.handleUpdateLeaveStatus);
  expect(jsxCallback(component,'onUpdateLeave',h.callbacks)).toBe(h.callbacks.handleUpdateLeave);
 }
});
