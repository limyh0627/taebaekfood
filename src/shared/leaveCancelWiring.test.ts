import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {expect,it} from 'vitest';

it('취소 승인과 관리자 직접 취소는 실제 표시한 row와 cancel action으로 연결한다',()=>{
 for(const file of ['components/AdminChecklist.tsx','components/HRManager.tsx','components/hr/LeaveApprovalList.tsx']){
  const source=readFileSync(file,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let cancelCalls=0;
  const visit=(node:ts.Node)=>{if(ts.isCallExpression(node)&&node.expression.getText(ast)==='actions.run'){
   const [row,action]=node.arguments;if(action&&ts.isObjectLiteralExpression(action)){
    const value=action.properties.find(property=>ts.isPropertyAssignment(property)&&property.name.getText(ast)==='action') as ts.PropertyAssignment|undefined;
    if(value?.initializer.getText(ast)==="'cancel'"){expect(['req','r']).toContain(row.getText(ast));cancelCalls++;}
   }
  }ts.forEachChild(node,visit);};visit(ast);expect(cancelCalls,file).toBeGreaterThan(0);expect(source).not.toContain('onUpdateLeaveStatus');
 }
});
it('부모는 원문을 새로 조립하거나 직접 상태를 쓰지 않고 공용 mutation service로 전달한다',()=>{
 const source=readFileSync('src/features/admin/AdminApp.tsx','utf8');expect(source).not.toContain("updateItem('leaveRequests'");expect(source).not.toContain('leaveStatusPatch(');
 const ast=ts.createSourceFile('AdminApp.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let body='';const visit=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='handleLeaveAction')body=node.initializer!.getText(ast);ts.forEachChild(node,visit);};visit(ast);
 expect(body).toContain('submitLeaveAction(scope,row,action)');expect(body).not.toContain('.find(');
});
