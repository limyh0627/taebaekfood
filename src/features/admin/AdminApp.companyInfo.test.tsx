import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {expect,it,vi} from 'vitest';
const source=readFileSync('src/features/admin/AdminApp.tsx','utf8');
const file=ts.createSourceFile('AdminApp.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const declarations=new Map<string,string>();let savePort='',recoveryPort='';
function visit(node:ts.Node){
 if(ts.isVariableDeclaration(node)&&node.initializer)declarations.set(node.name.getText(file),node.initializer.getText(file));
 if((ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))&&node.tagName.getText(file)==='TradeStatement')for(const attribute of node.attributes.properties){
  if(ts.isJsxAttribute(attribute)&&attribute.initializer&&ts.isJsxExpression(attribute.initializer)&&attribute.initializer.expression){
   if(attribute.name.getText(file)==='onSaveCompanyInfo')savePort=attribute.initializer.expression.getText(file);
   if(attribute.name.getText(file)==='companyInfoRecovery')recoveryPort=attribute.initializer.expression.getText(file);
  }
 }
 ts.forEachChild(node,visit);
}visit(file);
function harness(){
 let current=true;
 const call=()=>vi.fn<(...args:unknown[])=>Promise<unknown>>(async()=>({status:'saved',requestFinalized:true}));
 const services={openCompanyInfo:call(),saveCompanyInfo:call(),readCompanyInfoOperations:call(),inspectCompanyInfoOperation:call(),retryCompanyInfoOperation:call(),cancelCompanyInfoOperation:call(),discardCompanyInfoCopy:call(),listCompanyInfoHistory:call()};
 const auth={currentUser:{uid:'A'}};
 const deps={...services,companyId:'taebaek',auth,setDocument:vi.fn(),refreshStaticData:vi.fn()};
 const names=['assertCompanyInfoScope',savePort,recoveryPort];
 const body=names.map(name=>{const value=declarations.get(name);if(!value)throw Error('회사정보 typed 실부모연결누락');return 'const '+name+'='+value+';';}).join('\n')+'return {save:'+savePort+',ports:'+recoveryPort+'};';
 const code=ts.transpileModule(body,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 const result=new Function(...Object.keys(deps),code)(...Object.values(deps));
 return {...result,...services,auth,context:{companyId:'taebaek',actorUid:'A',planId:'fixed-plan',isCurrent:()=>current},setCurrent:(value:boolean)=>{current=value;},generic:deps.setDocument,refresh:deps.refreshStaticData};
}
it('실제 전표 회사정보 부모는 고정 opening과 dirty patch만 typed 포트에 전달한다',async()=>{
 const h=harness(),patch={bankAccount:'',address:'명시 주소'},opening={reference:{companyId:'taebaek',planId:'fixed-plan'},expectedVersion:'1:000000001'};
 const context={...h.context,opening};await h.save(patch,context);
 expect(h.saveCompanyInfo).toHaveBeenCalledWith(patch,context);expect(h.generic).not.toHaveBeenCalled();expect(h.refresh).not.toHaveBeenCalled();
});
it('열기는 선택 raw를 전달하고 async 뒤 계정 교체 결과를 반환하지 않는다',async()=>{
 const h=harness(),raw={name:'회사',adminPassword:'노출하지 않는 원문'};let done!:(value:unknown)=>void;
 h.openCompanyInfo.mockImplementation(()=>new Promise(resolve=>{done=resolve;}));const result=h.ports.onOpenCompanyInfo(raw,h.context);
 expect(h.openCompanyInfo).toHaveBeenCalledWith(raw,h.context);h.auth.currentUser.uid='B';done({expectedVersion:'1:000000001'});await expect(result).rejects.toThrow(/로그인/);
});
it('회사·UID·수명이 바뀐 저장은 generic이나 RPC를 시작하지 않는다',async()=>{
 const h=harness();h.setCurrent(false);expect(await h.save({name:'다른 초안'},h.context)).toMatchObject({status:'rejected'});
 expect(h.saveCompanyInfo).not.toHaveBeenCalled();expect(h.generic).not.toHaveBeenCalled();
});
it('실제 복구 포트는 ref와 화면 관측 raw를 그대로 넘기고 업무 재저장을 호출하지 않는다',async()=>{
 const h=harness(),reference={companyId:'taebaek',planId:'old'};
 await h.ports.onInspectCompanyInfoOperation(reference,h.context);await h.ports.onRetryCompanyInfoOperation(reference,h.context);await h.ports.onCancelCompanyInfoOperation(reference,h.context);
 await h.ports.onDiscardCompanyInfoCopy(reference,'관측 A','참조 A',h.context);
 expect(h.inspectCompanyInfoOperation).toHaveBeenCalledWith(reference,h.context);expect(h.retryCompanyInfoOperation).toHaveBeenCalledWith(reference,h.context);expect(h.cancelCompanyInfoOperation).toHaveBeenCalledWith(reference,h.context);expect(h.discardCompanyInfoCopy).toHaveBeenCalledWith(reference,'관측 A','참조 A',h.context);
 expect(h.saveCompanyInfo).not.toHaveBeenCalled();expect(h.generic).not.toHaveBeenCalled();expect(h.refresh).not.toHaveBeenCalled();
});
it('보관목록과 명시 이력은 현재 회사·UID만 읽고 cursor를 보존한다',async()=>{
 const h=harness();await h.ports.onReadCompanyInfoOperations(h.context);await h.ports.onListCompanyInfoHistory(h.context,'cursor');
 expect(h.readCompanyInfoOperations).toHaveBeenCalledWith({companyId:'taebaek',actorUid:'A'});expect(h.listCompanyInfoHistory).toHaveBeenCalledWith(h.context,'cursor');
 h.setCurrent(false);await expect(h.ports.onListCompanyInfoHistory(h.context)).rejects.toThrow();
});
function documentProps(tag:string,read:unknown){
 let element:ts.JsxOpeningElement|ts.JsxSelfClosingElement|undefined;
 const find=(node:ts.Node)=>{if((ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))&&node.tagName.getText(file)===tag)element=node;ts.forEachChild(node,find);};find(file);
 if(!element)throw Error('실제 서류 컴포넌트 연결 누락');
 const names=new Set(['companyInfo','companyInfoRead','onOpenCompanySettings']);
 const attrs=element.attributes.properties.filter(a=>ts.isJsxAttribute(a)&&names.has(a.name.getText(file))).map(a=>a.getText(file)).join(' ');
 const code=ts.transpileModule('return <Document '+attrs+'/>;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React}}).outputText;
 const setCurrentView=vi.fn(),companyInfo={name:'현재 회사'},React={createElement:(_type:unknown,props:unknown)=>({props})};
 const result=new Function('React','Document','companyInfo','companyInfoRead','setCurrentView',code)(React,()=>null,companyInfo,read,setCurrentView);
 return {props:result.props,setCurrentView,companyInfo};
}
it.each(['TradeStatement','TaxStatement'])('실제 Admin %s JSX는 읽기 관측을 재작성하지 않고 전달한다',tag=>{
 const read={status:'ready',value:{name:'현재 회사'},observationToken:{},isCurrent:vi.fn(()=>true),retry:vi.fn()};const h=documentProps(tag,read);
 expect(h.props.companyInfoRead).toBe(read);expect(h.props.companyInfo).toBe(h.companyInfo);expect(read.isCurrent).not.toHaveBeenCalled();expect(read.retry).not.toHaveBeenCalled();
 const missing=documentProps(tag,undefined);expect(missing.props).toHaveProperty('companyInfoRead',undefined);
 if(tag==='TaxStatement'){h.props.onOpenCompanySettings();expect(h.setCurrentView).toHaveBeenCalledExactlyOnceWith('trade-statement');}
});
