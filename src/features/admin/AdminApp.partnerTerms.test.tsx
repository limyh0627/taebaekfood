import fs from 'node:fs';
import ts from 'typescript';
import {expect,it,vi} from 'vitest';
import type {SaveOutcome} from '../../shared/saveOutcome';
const source=fs.readFileSync(new URL('./AdminApp.tsx',import.meta.url),'utf8');
function expression(name:string){
 const file=ts.createSourceFile('AdminApp.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let value:ts.Expression|undefined;
 const visit=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&node.name.getText(file)===name)value=node.initializer;ts.forEachChild(node,visit);};visit(file);
 if(!value)throw Error(name+' 실제 콜백 없음');
 return ts.transpileModule('return ('+value.getText(file)+');',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
}
function runner(current=()=>true){
 const refresh=vi.fn(async()=>{}),notice=vi.fn();
 const run=new Function('isCurrentPartnerTerms','termsActor','companyId','refreshStaticData','setAppNotice',expression('runPartnerItemTerms'))(current,'actor','taebaek',refresh,notice);
 return {run,refresh,notice};
}
it('부모는 선택 원문과 수정값을 재구성하지 않고 고정 회사 UID·안내 포트로 전달한다',async()=>{
 const {run}=runner(),submit=vi.fn(async():Promise<SaveOutcome>=>({status:'saved'})),notice=vi.fn(),current=()=>true;
 const save=new Function('runPartnerItemTerms','submitPartnerItemTerms','awaitNotice','isCurrentPartnerTerms',expression('savePartnerItemTerms'))(run,submit,notice,current);
 const input={target:{itemId:'item',partnerId:'partner',direction:'out',opening:{id:'original',price:10}},terms:{price:0}};
 await save(input);expect(submit).toHaveBeenCalledExactlyOnceWith({companyId:'taebaek',actorUid:'actor'},input,notice,current);
});
it('회사 UID 또는 화면 세대 만료는 전송하지 않고 원인과 다시 열기 행동을 반환한다',async()=>{
 const {run}=runner(()=>false),work=vi.fn();const result=await run(work);
 expect(work).not.toHaveBeenCalled();expect(result.status).toBe('rejected');expect(result.nextAction).toContain('다시 열어');
 const token={},scope={current:token},alive={current:true},auth={currentUser:{uid:'actor'}};
 const current=new Function('termsAlive','termsActor','auth','termsScope','termsRenderScope',expression('isCurrentPartnerTerms'))(alive,'actor',auth,scope,token);
 expect(current()).toBe(true);auth.currentUser.uid='other';expect(current()).toBe(false);auth.currentUser.uid='actor';scope.current={};expect(current()).toBe(false);
});
it('저장 ACK만 화면 갱신하고 갱신 실패는 이미 저장된 결과를 실패로 바꾸지 않는다',async()=>{
 const {run,refresh,notice}=runner();
 await run(async()=>({status:'unknown',message:'응답 미확인',nextAction:'결과 확인'}));expect(refresh).not.toHaveBeenCalled();
 refresh.mockRejectedValueOnce(Error('화면 갱신 실패'));const result=await run(async()=>({status:'saved'}));
 expect(result.status).toBe('saved');expect(notice).toHaveBeenCalledWith(expect.objectContaining({subMessage:expect.stringContaining('다시 저장하지 말고')}));
});
it('두 소비자는 같은 typed 복구 배선을 쓰고 옛 재귀 writer를 사용하지 않는다',()=>{
 expect(source.match(/\.\.\.partnerTermsBindings/g)).toHaveLength(2);
 expect(source).not.toContain('const handleUpsertPartnerItem');expect(source).not.toContain('const upsertPartnerItemSafe');
 expect(source).toContain('onInspectPartnerItemTerms:inspectPartnerTerms');expect(source).toContain('onReadPartnerItemTermsReferences:readPartnerTermsReferences');
});
it('사본 정리는 업무갱신 helper를 거치지 않고 관측원문과 scope만 직접전달한다',async()=>{
 let current=true;const discard=vi.fn(async()=>({status:'cleared',message:'사본만'})),ref={companyId:'taebaek',planId:'plan',targetId:'link',itemId:'item',partnerId:'partner',direction:'in'};const run=new Function('isCurrentPartnerTerms','termsActor','companyId','discardPartnerItemTermsCopy',expression('discardPartnerTerms'))(()=>current,'actor','taebaek',discard);expect(await run(ref,'observed')).toMatchObject({status:'cleared'});expect(discard).toHaveBeenCalledWith({companyId:'taebaek',actorUid:'actor'},ref,'observed',expect.any(Function));current=false;expect((await run(ref,'observed')).status).toBe('blocked');expect(discard).toHaveBeenCalledOnce();expect(expression('discardPartnerTerms')).not.toMatch(/runPartnerItemTerms|refreshStaticData|submit/);expect(source).toContain('onDiscardPartnerItemTermsCopy:discardPartnerTerms');
});
