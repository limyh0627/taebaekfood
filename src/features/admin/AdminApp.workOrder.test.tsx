/** @vitest-environment jsdom */
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {expect,it,vi} from 'vitest';
const source=readFileSync('src/features/admin/AdminApp.tsx','utf8');
const tree=ts.createSourceFile('AdminApp.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function parentPorts(deps:Record<string,unknown>){
 const expressions=new Map<string,string>();
 const visit=(node:ts.Node)=>{
  if((ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))&&node.tagName.getText(tree)==='OrdersList'){
   for(const attr of node.attributes.properties)if(ts.isJsxAttribute(attr)&&attr.initializer&&ts.isJsxExpression(attr.initializer)&&attr.initializer.expression)expressions.set(attr.name.getText(tree),attr.initializer.expression.getText(tree));
  }
  ts.forEachChild(node,visit);
 };
 visit(tree);
 const value=(name:string)=>{const expression=expressions.get(name);if(!expression)throw Error('실제 OrdersList 포트 누락: '+name);return Function(...Object.keys(deps),'return ('+expression+');')(...Object.values(deps));};
 return {value,has:(name:string)=>expressions.has(name)};
}
it('실제 목록 부모는 선택된 작업행과 typed bundle을 그대로 전달하고 개별 diff writer를 연결하지 않는다',()=>{
 const rows=[{id:'원문-ID',key:'order-line',groupId:'기존-묶음',sortIndex:3,note:'미지 필드'}],bindings={open:vi.fn(),command:vi.fn()};
 const ports=parentPorts({companyId:'taebaek',workOrderItems:rows,workOrderWrites:bindings});
 expect(ports.value('companyId')).toBe('taebaek');expect(ports.value('workOrderItems')).toBe(rows);expect(ports.value('workOrderBindings')).toBe(bindings);expect(ports.has('onSetWorkOrderItems')).toBe(false);
});
it('부모 typed 포트는 실제 그룹·항목 ACK promise와 오류를 변환하거나 먼저 완료하지 않는다',async()=>{
 let finish!:(value:{status:string})=>void;const pending=new Promise<{status:string}>(resolve=>finish=resolve),command=vi.fn(()=>pending),bindings={command};
 const ports=parentPorts({workOrderWrites:bindings}),forwarded=ports.value('workOrderBindings');
 const scope={companyId:'taebaek',actorUid:'actor'},entry={reference:{companyId:'taebaek',planId:'fixed'},observedLocalText:'관측 원문',observedReferenceText:'관측 참조'},current=()=>true;
 const actual=forwarded.command(scope,entry,'apply',current);expect(actual).toBe(pending);expect(command).toHaveBeenCalledWith(scope,entry,'apply',current);finish({status:'saved'});await expect(actual).resolves.toEqual({status:'saved'});
 command.mockImplementationOnce(()=>Promise.reject(Error('원본이 바뀌었습니다.')));await expect(forwarded.command(scope,entry,'apply',current)).rejects.toThrow('원본이 바뀌었습니다.');expect(entry.observedLocalText).toBe('관측 원문');
});
it('일일 초기화도 현재 회사·UID 수명 포트를 전달해 이전 회사의 늦은 작업을 이어가지 않는다',()=>{
 let expression='';const visit=(node:ts.Node)=>{if(ts.isCallExpression(node)&&node.expression.getText(tree)==='useEffect'&&node.arguments[0]?.getText(tree).includes('resetDailyWorkOrder(companyId'))expression=node.arguments[0].getText(tree);ts.forEachChild(node,visit);};visit(tree);expect(expression).not.toBe('');
 const owner={companyId:'taebaek',uid:'actor'},deps={companyId:'taebaek',rawCancelScopeRef:{current:owner},rawCancelAlive:{current:true},auth:{currentUser:{uid:'actor'}},resetDailyWorkOrder:vi.fn()};
 const js=ts.transpileModule('const effect='+expression,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 Function(...Object.keys(deps),js+';effect();')(...Object.values(deps));const [company,current]=deps.resetDailyWorkOrder.mock.calls[0];expect(company).toBe('taebaek');expect(current()).toBe(true);deps.auth.currentUser.uid='other';expect(current()).toBe(false);deps.auth.currentUser.uid='actor';deps.rawCancelScopeRef.current={companyId:'taebaek',uid:'actor'};expect(current()).toBe(false);deps.rawCancelScopeRef.current=owner;deps.rawCancelAlive.current=false;expect(current()).toBe(false);
});
