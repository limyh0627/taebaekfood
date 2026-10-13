/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { beforeEach, expect, it, vi } from 'vitest';
import { rawHolderByName, rawLedgerKeys } from '../../shared/rawHolder';
import { rawPressText, rawPressYieldKg } from '../../shared/rawPressAttempt';
const source=readFileSync('src/features/admin/AdminApp.tsx','utf8');
const ast=ts.createSourceFile('AdminApp.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let callback='';
function visit(node:ts.Node){if(ts.isJsxAttribute(node)&&node.name.getText(ast)==='onAddRawMaterialEntry'&&node.initializer&&ts.isJsxExpression(node.initializer)&&node.initializer.expression)callback=node.initializer.expression.getText(ast);ts.forEachChild(node,visit);}visit(ast);
const compiled=ts.transpileModule('const callback='+callback,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const executeRawPress=vi.fn(),executeRawInventoryCommand=vi.fn();let pending:any=null;
const entry=()=>({id:'first-entry',material:'참깨',date:'2026-10-12',received:0,used:10,note:'원문',type:'manual',createdAt:'2026-10-12T01:00:00Z',effectiveAt:'2026-10-12T01:00:00Z',targetLotId:'source-lot'});
function actual(rules:any={참깨:{product:'통깨참기름',rate:0.48}},attempts:any[]=[],pinError?:Error){
 const deps={auth:{currentUser:{uid:'uid'}},companyId:'taebaek',yieldRules:rules,listRawPressAttempts:vi.fn(()=>attempts),rawPressText,rawHolderByName,allItems:[{id:'source',name:'참깨',subtype:'벌크',companyId:'taebaek'},{id:'derived',name:'통깨참기름',subtype:'벌크',companyId:'taebaek'}],rawLedgerKeys,rawPressYieldKg,executeRawPress,today:()=> '2026-10-12',executeRawInventoryCommand,rawCancelScopeRef:{current:{companyId:'taebaek'}},rawCancelAlive:{current:true},beginNewRawPressAttempt:async(request:any,current:()=>boolean)=>{if(!current())throw Error('계정변경');if(pinError)throw pinError;return {request,encoded:JSON.stringify(request),state:'prepared'};},assertRawPressAttempt:vi.fn()};
 return new Function(...Object.keys(deps),compiled+';return callback;')(...Object.values(deps));
}
beforeEach(()=>{vi.clearAllMocks();pending=null;executeRawPress.mockResolvedValue({status:'applied',sourceAppliedKg:-10,derivedAppliedKg:4.8});executeRawInventoryCommand.mockResolvedValue({status:'duplicate'});});
it('실제 부모 콜백은 압착 한 명령만 호출하며 원시각·수율·양 출처를 고정한다',async()=>{expect(await actual()(entry())).toMatchObject({ok:true,appliedKg:-10});expect(executeRawInventoryCommand).not.toHaveBeenCalled();const request=executeRawPress.mock.calls[0][0];expect(request).toMatchObject({actorUid:'uid',entry:entry(),derivedCommand:{kg:4.8,effectiveAt:entry().effectiveAt,source:{type:'manual',id:entry().id}},sourceCommand:{source:{type:'manual',id:entry().id}}});});
it('재개는 현재 수율 대신 첫 요청을 사용하고 다른 원문은 보내지 않는다',async()=>{await actual()(entry());pending={request:executeRawPress.mock.calls[0][0],encoded:'first',state:'submitted'};executeRawPress.mockClear();await actual({참깨:{product:'없는 품목',rate:0.9}})(entry(),'resume',pending);expect(executeRawPress).toHaveBeenCalledWith(pending.request,expect.objectContaining({retained:pending,isCurrent:expect.any(Function)}));expect(await actual()({...entry(),used:11},'resume',pending)).toMatchObject({ok:false});expect(executeRawPress).toHaveBeenCalledTimes(1);});
it('확정 신규 거절에만 수정 재입력 표시를 전달한다',async()=>{executeRawPress.mockResolvedValue({status:'blocked',reason:'부족',retainPending:false});expect(await actual()(entry())).toMatchObject({ok:false,canEditRetry:true});executeRawPress.mockResolvedValue({status:'blocked',reason:'과거 부분',retainPending:true});expect(await actual()(entry())).not.toHaveProperty('canEditRetry');});
it('일반 입고 재시도도 최초 effectiveAt을 재생성하지 않는다',async()=>{const inbound={...entry(),received:10,used:0};await actual()(inbound);await new Promise(resolve=>setTimeout(resolve,5));await actual()(inbound);expect(executeRawInventoryCommand.mock.calls.map(c=>c[0].effectiveAt)).toEqual([inbound.effectiveAt,inbound.effectiveAt]);expect(executeRawPress).not.toHaveBeenCalled();});
it('아직 명령을 보내지 않은 신규 품목·로트 오류는 수정 재입력이 가능하다',async()=>{expect(await actual({참깨:{product:'참깨',rate:0.48}})(entry())).toMatchObject({ok:false,canEditRetry:true});expect(await actual()({...entry(),targetLotId:undefined})).toMatchObject({ok:false,canEditRetry:true});expect(executeRawPress).not.toHaveBeenCalled();expect(executeRawInventoryCommand).not.toHaveBeenCalled();});
it('현재 이름이 달라도 fullrequest 실제 source/derived ID 충돌 원문만 전달한다',async()=>{
 const retained={request:{entry:{...entry(),id:'old',material:'과거명'},sourceCommand:{rawItemId:'other-source'},derivedCommand:{rawItemId:'source'}},encoded:'original',storageKey:'own'};
 const outcome=await actual(undefined,[{retained,deleted:true}],Error('같은 실제 품목 충돌'))(entry());expect(outcome).toMatchObject({ok:false,reason:'같은 실제 품목 충돌',relatedRetained:retained});expect(executeRawPress).not.toHaveBeenCalled();expect(executeRawInventoryCommand).not.toHaveBeenCalled();
});
it('수율 매핑이 사라져도 삭제된unknown 실제target을 일반 소비로 우회하지 않는다',async()=>{
 const retained={request:{entry:{...entry(),id:'old',material:'과거명'},sourceCommand:{rawItemId:'old-source'},derivedCommand:{rawItemId:'source'}},encoded:'original',storageKey:'own'};
 expect(await actual({},[{retained,deleted:true}])(entry())).toMatchObject({ok:false,relatedRetained:retained});expect(executeRawPress).not.toHaveBeenCalled();expect(executeRawInventoryCommand).not.toHaveBeenCalled();
});
it('수율 없는 일반 사용의 실제target이 무관하면 기존 단일 소비 명령을 허용한다',async()=>{
 const retained={request:{entry:{...entry(),id:'old'},sourceCommand:{rawItemId:'different'},derivedCommand:{rawItemId:'another'}},encoded:'original'};
 expect(await actual({},[{retained,deleted:true}])(entry())).toMatchObject({ok:true});expect(executeRawPress).not.toHaveBeenCalled();expect(executeRawInventoryCommand).toHaveBeenCalledOnce();expect(executeRawInventoryCommand.mock.calls[0][0]).toMatchObject({rawItemId:'source',kind:'consume-lot',kg:10,effectiveAt:entry().effectiveAt});
});
it('실제 ItemList wrapper가 intent·최초retained·구체적 차단이유를 양방향으로 전달한다',async()=>{
 const source=readFileSync('components/ItemList.tsx','utf8'),tree=ts.createSourceFile('ItemList.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let body='';const walk=(n:ts.Node)=>{if(ts.isJsxOpeningElement(n)&&n.tagName.getText(tree)==='RawMaterialEntryModal'||ts.isJsxSelfClosingElement(n)&&n.tagName.getText(tree)==='RawMaterialEntryModal'){const attr=(n as ts.JsxOpeningElement).attributes.properties.find(p=>ts.isJsxAttribute(p)&&p.name.getText(tree)==='onSubmit') as ts.JsxAttribute;body=(attr.initializer as ts.JsxExpression).expression!.getText(tree);}ts.forEachChild(n,walk);};walk(tree);
 const result={ok:false,reason:'실제target 미확인',relatedRetained:{request:{entry:entry()},encoded:'first'}};
 const onAddRawMaterialEntry=vi.fn(async()=>result),deps={rawEntryGeneration:{current:1},auth:{currentUser:{uid:'uid'}},onAddRawMaterialEntry,setToast:vi.fn(),onLedgerChanged:vi.fn()};const callback=new Function(...Object.keys(deps),ts.transpileModule('const callback='+body,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText+';return callback;')(...Object.values(deps));
 expect(await callback(entry(),'resume',result.relatedRetained)).toEqual(result);expect(onAddRawMaterialEntry).toHaveBeenCalledWith(entry(),'resume',result.relatedRetained);expect(deps.onLedgerChanged).not.toHaveBeenCalled();
});
