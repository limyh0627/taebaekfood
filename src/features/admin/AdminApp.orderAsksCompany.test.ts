/** @vitest-environment jsdom */
import React, { useRef, useEffect } from 'react';
import { render, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { planCatalogItemDelete, catalogItemDeleteBlockMessage } from './catalogItemDelete';
import { planOrderItemToggle } from '../../shared/orderCompletion';
import { ensureOrderLineIds } from '../../shared/orderLineInventory';
import { isGoodsItem } from '../../shared/itemTaxonomy';
import { stockUnits, unpackComponent } from '../../shared/orderUnits';
import { unreservedItemStock, reservedItemQty, reservedByOrders } from './orderItemStock';
import { buildStockUseRows } from './stockUseRows';
import { OrderStatus } from '../../shared/types';
const source = readFileSync('src/features/admin/AdminApp.tsx', 'utf8');
const file = ts.createSourceFile('AdminApp.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function actualRequest(deps: Record<string, unknown>) {
 let expression: ts.Expression | undefined;
 const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'requestOrderStatus') expression = node.initializer; ts.forEachChild(node, visit); }; visit(file);
 if (!expression) throw new Error('실제 요청 본문 없음');
 const code = ts.transpileModule(`const request = ${expression.getText(file)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
 return new Function(...Object.keys(deps), `${code};return request;`)(...Object.values(deps)) as (id: string, status: OrderStatus) => Promise<void>;
}
function deferred() { let resolve!: (value: unknown) => void; let reject!: (error: Error) => void; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return {promise,resolve,reject}; }
function harness(scopeOverride?: {current:{companyId:string;token:object}}) {
 const scope = scopeOverride ?? { current: { companyId: 'taebaek', token: {} } };
 let ask: any = null;
 const writer = vi.fn(); const pending = deferred();
 const order = { id: 'A', partnerName: '태백 주문', status: OrderStatus.PENDING, items: [] };
 const request = actualRequest({ orderAskScope: scope, prepareOrderStatusChange: () => pending.promise,
 allOrders: [order], orders: [], workStatusFromItems: () => OrderStatus.DISPATCHED,
 requiresCompleteItemsForStatusChange: () => false, OrderStatus, allItems: [], appData: {orderUnitInputs: undefined}, currentUser: {name:'관리자'},
 buildStockUseRows: () => [{itemId:'item'}], setStockUseAsk: (value: any) => { ask=value; }, setRollbackAsk: (value: any) => {ask=value;}, changeOrderStatus: writer });
 return {scope,request,pending,writer,order,setAsk:(value:any)=>{ask=value;},getAsk:()=>ask};
}
it('실제 prepare 대기 후 이전 회사 결과는 새 회사 확인창을 덮지 않는다', async () => {
 const h=harness(); const waiting=h.request('A',OrderStatus.DISPATCHED);
 h.scope.current={companyId:'punghoe',token:{}}; const next={orderId:'B'};h.setAsk(next);h.pending.resolve({order:h.order});await waiting;
 expect(h.getAsk()).toBe(next);expect(h.writer).not.toHaveBeenCalled();
});
it('A→B→A 전환도 이전 세대의 준비 결과를 버린다', async () => {
 const h=harness();const waiting=h.request('A',OrderStatus.DISPATCHED);
 h.scope.current={companyId:'punghoe',token:{}};h.scope.current={companyId:'taebaek',token:{}};h.pending.resolve({order:h.order});await waiting;
 expect(h.getAsk()).toBeNull();expect(h.writer).not.toHaveBeenCalled();
});

function actualConfirm(modal: 'ConfirmModal' | 'StockUseModal', deps: Record<string, unknown>) {
 let expression: ts.Expression | undefined;
 const visit = (node: ts.Node) => {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === modal) {
   const title = node.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(file) === 'title') as ts.JsxAttribute | undefined;
   if (modal === 'StockUseModal' || (title?.initializer && ts.isStringLiteral(title.initializer) && title.initializer.text === '되돌리기')) {
    const attr=node.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(file)==='onConfirm') as ts.JsxAttribute;
    expression=(attr.initializer as ts.JsxExpression).expression;
   }
  }
  ts.forEachChild(node,visit);
 };visit(file);if(!expression)throw new Error('실제 확인 callback 없음');
 const code=ts.transpileModule(`const confirm=${expression.getText(file)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 return new Function(...Object.keys(deps),`${code};return confirm;`)(...Object.values(deps)) as (...args:any[])=>Promise<void>;
}
it('현재 회사의 정상 준비는 확인창을 열고, stale direct 상태 변경은 실행하지 않는다', async () => {
 const current=harness();const valid=current.request('A',OrderStatus.DISPATCHED);current.pending.resolve({order:current.order});await valid;
 expect(current.getAsk()).toMatchObject({orderId:'A',scope:current.scope.current.token});
 const old=harness();const pending=old.request('A',OrderStatus.SHIPPED);old.scope.current={companyId:'punghoe',token:{}};old.pending.resolve({order:old.order});await pending;
 expect(old.writer).not.toHaveBeenCalled();
});
it('이전 rollback 실행의 늦은 완료는 새 회사 창과 진행 상태를 정리하지 않는다', async () => {
 const pending=deferred();const token={};const nextToken={};
 const ask={scope:token,onConfirm:vi.fn(()=>pending.promise)};const next={scope:nextToken};let current:any=ask;let busy:any=null;
 const orderAskScope={current:{token}};const orderAskCurrent={current:{rollback:ask as object}};const rollbackBusyRef={current:null as object|null};
 const confirm=actualConfirm('ConfirmModal',{rollbackAsk:ask,orderAskScope,orderAskCurrent,rollbackBusyRef,
 setRollbackAsk:(update:any)=>{current=update(current);},setRollbackBusy:(update:any)=>{busy=typeof update==='function'?update(busy):update;},alert:vi.fn(),console});
 const first=confirm();await confirm();expect(ask.onConfirm).toHaveBeenCalledOnce();
 orderAskScope.current={token:nextToken};orderAskCurrent.current={rollback:next};current=next;busy=next;rollbackBusyRef.current=next;
 pending.resolve(undefined);await first;expect(current).toBe(next);expect(busy).toBe(next);expect(rollbackBusyRef.current).toBe(next);
});
it('같은 회사 새 rollback 확인창도 이전 완료가 지우지 않으며 현재 정상 완료만 닫는다',async()=>{
 const pending=deferred();const token={};const ask={scope:token,onConfirm:()=>pending.promise};const next={scope:token};let current:any=ask;let busy:any=null;
 const scope={current:{token}};const refs={current:{rollback:ask as object}};const lock={current:null as object|null};
 const confirm=actualConfirm('ConfirmModal',{rollbackAsk:ask,orderAskScope:scope,orderAskCurrent:refs,rollbackBusyRef:lock,setRollbackAsk:(update:any)=>{current=update(current);},setRollbackBusy:(update:any)=>{busy=typeof update==='function'?update(busy):update;},alert:vi.fn(),console});
 const waiting=confirm();current=next;refs.current={rollback:next};pending.resolve(undefined);await waiting;expect(current).toBe(next);expect(busy).toBeNull();
});
it('이전 stockUse status와 line 확인 callback은 새 회사에서 실행하지 않는다',async()=>{
 for(const mode of ['status','line']) {
  const token={};const writer=vi.fn();const ask={scope:token,mode,orderId:'A',onConfirm:writer};const next={};
  const confirm=actualConfirm('StockUseModal',{stockUseAsk:ask,orderAskScope:{current:{token:next}},orderAskCurrent:{current:{stock:ask}},setStockUseAsk:vi.fn(),changeOrderStatus:writer,OrderStatus,currentUser:{name:'관리자'}});
  await confirm({});expect(writer).not.toHaveBeenCalled();
 }
});

it('실제 렌더의 회사 세대는 A→B→A마다 바뀌고 이전 확인창은 즉시 감춘다', () => {
 let declaration: ts.VariableDeclaration | undefined;
 const visit=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&node.name.getText(file)==='orderAskScope')declaration=node;ts.forEachChild(node,visit);};visit(file);
 if(!declaration)throw new Error('회사 세대 생성 없음');
 const statement=declaration.parent.parent as ts.VariableStatement;const block=statement.parent as ts.Block;
 const index=block.statements.indexOf(statement);const next=block.statements[index+1];
 const code=ts.transpileModule(`${statement.getText(file)}${next.getText(file)}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const renderScope=new Function('companyId','useRef',`${code};return orderAskScope;`);let ref:any;
 const useRef=(value:unknown)=>ref??=( {current:value} );
 const first=renderScope('taebaek',useRef).current.token;const second=renderScope('punghoe',useRef).current.token;const third=renderScope('taebaek',useRef).current.token;
 expect(second).not.toBe(first);expect(third).not.toBe(first);
 for(const modal of ['ConfirmModal','StockUseModal']) {
  let condition:ts.Expression|undefined;
  const find=(node:ts.Node)=>{if(ts.isBinaryExpression(node)&&ts.isParenthesizedExpression(node.right)&&ts.isJsxSelfClosingElement(node.right.expression)&&node.right.expression.tagName.getText(file)===modal) {
   const element=node.right.expression;const title=element.attributes.properties.find(prop=>ts.isJsxAttribute(prop)&&prop.name.getText(file)==='title') as ts.JsxAttribute|undefined;
   if(modal==='StockUseModal'||(title?.initializer&&ts.isStringLiteral(title.initializer)&&title.initializer.text==='되돌리기'))condition=node.left;
  }ts.forEachChild(node,find);};find(file);if(!condition)throw new Error('실제 확인창 조건 없음');
  const view=new Function('rollbackAsk','stockUseAsk','orderAskScope',`return ${condition.getText(file)};`);
  expect(view({scope:first},{scope:first},ref)).toBe(false);
  expect(view({scope:third},{scope:third},ref)).toBe(true);
 }
});
it('현재 rollback 성공만 닫고 실패는 창과 오류를 유지하며 잠금을 해제한다',async()=>{
 for(const fail of [false,true]) {
  const token={};const ask={scope:token,onConfirm:async()=>{if(fail)throw new Error('재고 오류');}};let current:any=ask;let busy:any=null;const notice=vi.fn();const lock={current:null as object|null};
  const confirm=actualConfirm('ConfirmModal',{rollbackAsk:ask,orderAskScope:{current:{token}},orderAskCurrent:{current:{rollback:ask}},rollbackBusyRef:lock,
   setRollbackAsk:(update:any)=>{current=update(current);},setRollbackBusy:(update:any)=>{busy=typeof update==='function'?update(busy):update;},alert:notice,console:{error:vi.fn()}});
  await confirm();expect(current).toBe(fail?ask:null);expect(notice).toHaveBeenCalledTimes(fail?1:0);expect(busy).toBeNull();expect(lock.current).toBeNull();
 }
});

function actualLineSave(deps:Record<string,unknown>) {
 let outer:ts.Expression|undefined;let expression:ts.Expression|undefined;
 const findOuter=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&node.name.getText(file)==='handleToggleItemChecked')outer=node.initializer;ts.forEachChild(node,findOuter);};findOuter(file);
 if(!outer)throw new Error('실제 품목 처리 없음');
 const find=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&node.name.getText(file)==='save')expression=node.initializer;ts.forEachChild(node,find);};find(outer);if(!expression)throw new Error('실제 품목 저장 없음');
 const code=ts.transpileModule(`const save=${expression.getText(file)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 return new Function(...Object.keys(deps),`${code};return save;`)(...Object.values(deps)) as ()=>Promise<void>;
}
it('이전 품목 저장의 늦은 legacy 거절과 일반 오류는 새 회사 확인창이나 알림을 만들지 않는다',async()=>{
 for(const message of ['LEGACY_ORDER_ROLLBACK_REQUIRED','일반 오류']) {
  const pending=deferred();const token={};const orderAskScope={current:{token}};const requests=vi.fn();const notice=vi.fn();
  const completionSaving={current:new Set<string>()};const plan={status:OrderStatus.PROCESSING,items:[{lineId:'line',checked:true}]};
  const save=actualLineSave({askScope:token,orderAskScope,completionSaving,orderId:'A',itemIdx:0,plan,order:{status:OrderStatus.PROCESSING},applying:true,requestOrderStatus:requests,changeOrderItemCompletion:()=>pending.promise,alert:notice,console:{error:vi.fn()}});
  const waiting=save();orderAskScope.current={token:{}};pending.reject(new Error(message));await waiting;
  expect(requests).not.toHaveBeenCalled();expect(notice).not.toHaveBeenCalled();expect(completionSaving.current.size).toBe(0);
 }
});
it('실제 unmount 정리가 세대를 무효화하여 늦은 direct 상태 요청을 막는다',async()=>{
 let effect:ts.Expression|undefined;
 const find=(node:ts.Node)=>{if(ts.isCallExpression(node)&&node.expression.getText(file)==='useEffect'&&node.arguments[0]?.getText(file).includes('orderAskScope.current'))effect=node.arguments[0];ts.forEachChild(node,find);};find(file);if(!effect)throw new Error('회사 세대 unmount 정리 없음');
 const code=ts.transpileModule(`const effect=${effect.getText(file)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const h=harness();const cleanup=new Function('orderAskScope',`${code};return effect();`)(h.scope) as ()=>void;
 const waiting=h.request('A',OrderStatus.SHIPPED);cleanup();h.pending.resolve({order:h.order});await waiting;
 expect(h.writer).not.toHaveBeenCalled();expect(h.getAsk()).toBeNull();
});

it('실제 hook 선언과 회사 조건을 React 재렌더·unmount에서 실행한다',async()=>{
 let declaration:ts.VariableDeclaration|undefined;const find=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&node.name.getText(file)==='orderAskScope')declaration=node;ts.forEachChild(node,find);};find(file);
 if(!declaration)throw new Error('실제 회사 hook 없음');const statement=declaration.parent.parent as ts.VariableStatement;const block=statement.parent as ts.Block;const index=block.statements.indexOf(statement);
 const code=ts.transpileModule(`${statement.getText(file)}${block.statements[index+1].getText(file)}${block.statements[index+2].getText(file)}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const Probe=new Function('useRef','useEffect',`return function Probe({companyId,observe}){${code};observe(orderAskScope);return null;}`)(useRef,useEffect) as React.FC<{companyId:string;observe:(ref:any)=>void}>;
 let observed:any;const observe=(ref:any)=>{observed=ref;};const view=render(React.createElement(Probe,{companyId:'taebaek',observe}));const first=observed.current.token;
 view.rerender(React.createElement(Probe,{companyId:'punghoe',observe}));const second=observed.current.token;
 view.rerender(React.createElement(Probe,{companyId:'taebaek',observe}));const third=observed.current.token;
 expect(second).not.toBe(first);expect(third).not.toBe(first);
 const h=harness(observed);const waiting=h.request('A',OrderStatus.SHIPPED);view.unmount();expect(observed.current.token).not.toBe(third);h.pending.resolve({order:h.order});await waiting;
 expect(h.writer).not.toHaveBeenCalled();expect(h.getAsk()).toBeNull();
});

function goodsHarness(stock:number) {
 let expression:ts.Expression|undefined;const find=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&node.name.getText(file)==='handleToggleItemChecked')expression=node.initializer;ts.forEachChild(node,find);};find(file);if(!expression)throw new Error('실제 품목 함수 없음');
 let ask:any=null;const token={};const scope={current:{token}};const refs={current:{goods:null as any}};const writer=vi.fn(async()=>{});
 const item={id:'goods',name:'사입품',type:'goods',stock,minStock:0,image:'',unit:'개'};
 const order={id:'A',partnerName:'태백 주문',status:OrderStatus.PENDING,items:[{itemId:item.id,name:item.name,quantity:2,lineId:'line'}]};
 const set=(value:any)=>{ask=typeof value==='function'?value(ask):value;refs.current.goods=ask;};
 const deps={OrderStatus,orderAskScope:scope,allOrders:[order],completionSaving:{current:new Set()},ensureOrderLineIds,planOrderItemToggle,currentUser:{name:'관리자'},buildStockUseRows,allItems:[item],appData:{orderUnitInputs:undefined},isGoodsItem,stockUnits,unpackComponent,unreservedItemStock,reservedItemQty,reservedByOrders,setGoodsStockAsk:set,changeOrderItemCompletion:writer,statusLabel:(value:any)=>value,상태색:{},CheckCircle2:{},setAppNotice:vi.fn(),alert:vi.fn(),console};
 const code=ts.transpileModule(`const toggle=${expression.getText(file)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const toggle=new Function(...Object.keys(deps),`${code};return toggle;`)(...Object.values(deps)) as (...args:any[])=>Promise<void>;
 return{toggle,scope,refs,writer,set,get:()=>ask};
}
function actualGoods(prop:'onConfirm'|'onCancel',deps:Record<string,unknown>) {
 let expression:ts.Expression|undefined;const find=(node:ts.Node)=>{
 if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(file)==='ConfirmModal') {
  const title=node.attributes.properties.find(p=>ts.isJsxAttribute(p)&&p.name.getText(file)==='title') as ts.JsxAttribute|undefined;
  if(title?.initializer?.getText(file).includes('goodsStockAsk.title')) {const attr=node.attributes.properties.find(p=>ts.isJsxAttribute(p)&&p.name.getText(file)===prop) as ts.JsxAttribute;expression=(attr.initializer as ts.JsxExpression).expression;}
 }ts.forEachChild(node,find);};find(file);if(!expression)throw new Error('상품 실제 callback 없음');
 const code=ts.transpileModule(`const callback=${expression.getText(file)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 return new Function(...Object.keys(deps),`${code};return callback;`)(...Object.values(deps)) as ()=>unknown;
}
it.each([1,3])('실제 상품 재고 %i 확인창의 이전 확인·취소는 새 회사 창을 지우지 않는다',async stock=>{
 for(const prop of ['onConfirm','onCancel'] as const) {
  const h=goodsHarness(stock);await h.toggle('A',0);const old=h.get();expect(old.title).toBe(stock<2?'재고부족':'작업완료');
  const callback=actualGoods(prop,{goodsStockAsk:old,orderAskScope:h.scope,orderAskCurrent:h.refs,setGoodsStockAsk:h.set});
  h.scope.current={token:{}};const next={scope:h.scope.current.token,title:'풍회 새창'};h.set(next);await callback();expect(h.get()).toBe(next);expect(h.writer).not.toHaveBeenCalled();
 }
});

it('상품 확인창은 회사 전환 즉시 감추고 같은 회사 새창도 이전 callback으로 지우지 않는다',async()=>{
 let condition:ts.Expression|undefined;
 const find=(node:ts.Node)=>{if(ts.isBinaryExpression(node)&&ts.isParenthesizedExpression(node.right)&&ts.isJsxSelfClosingElement(node.right.expression)) {
  const title=node.right.expression.attributes.properties.find(p=>ts.isJsxAttribute(p)&&p.name.getText(file)==='title') as ts.JsxAttribute|undefined;
  if(title?.initializer?.getText(file).includes('goodsStockAsk.title'))condition=node.left;
 }ts.forEachChild(node,find);};find(file);if(!condition)throw new Error('실제 상품 렌더 조건 없음');
 const visible=new Function('goodsStockAsk','orderAskScope',`return ${condition.getText(file)};`);
 for(const prop of ['onConfirm','onCancel'] as const) {
  const h=goodsHarness(3);await h.toggle('A',0);const old=h.get();expect(visible(old,h.scope)).toBe(true);
  const callback=actualGoods(prop,{goodsStockAsk:old,orderAskScope:h.scope,orderAskCurrent:h.refs,setGoodsStockAsk:h.set});
  const next={scope:h.scope.current.token,title:'같은 회사 새창'};h.set(next);await callback();expect(h.get()).toBe(next);expect(h.writer).not.toHaveBeenCalled();
  h.scope.current={token:{}};expect(visible(old,h.scope)).toBe(false);
 }
});
it.each([1,3])('현재 상품 재고 %i 확인은 해당 창만 닫고 정상 저장하며 취소는 저장하지 않는다',async stock=>{
 for(const prop of ['onConfirm','onCancel'] as const) {
  const h=goodsHarness(stock);await h.toggle('A',0);const ask=h.get();expect(ask.scope).toBe(h.scope.current.token);
  expect(ask.message).toContain('사입품');expect(ask.subMessage).toContain(stock<2?'음수가 됩니다':'출고할 때 빠집니다');
  const callback=actualGoods(prop,{goodsStockAsk:ask,orderAskScope:h.scope,orderAskCurrent:h.refs,setGoodsStockAsk:h.set});await callback();expect(h.get()).toBeNull();
  if(prop==='onConfirm')await waitFor(()=>expect(h.writer).toHaveBeenCalledOnce());else expect(h.writer).not.toHaveBeenCalled();
 }
});

function actualNamed(name:string,deps:Record<string,unknown>) {
 let expression:ts.Expression|undefined;const find=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&node.name.getText(file)===name)expression=node.initializer;ts.forEachChild(node,find);};find(file);if(!expression)throw new Error(`실제 함수 없음: ${name}`);
 const code=ts.transpileModule(`const callback=${expression.getText(file)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 return new Function(...Object.keys(deps),`${code};return callback;`)(...Object.values(deps)) as (...args:any[])=>Promise<void>;
}
function catalogHarness() {
 const scope={current:{token:{}}};const current={current:null as any};let ask:any=null;
 const load=deferred();const writer=vi.fn(async(_writes:unknown[])=>{});const notice=vi.fn();const refresh=vi.fn();const alert=vi.fn();
 const set=(value:any)=>{ask=typeof value==='function'?value(ask):value;current.current=ask;};
 const deps={orderAskScope:scope,catalogDeleteCurrent:current,catalogDeleteRequest:{current:null},catalogDeleteBusy:{current:null},allItems:[{id:'item',name:'삭제품목',type:'product'}],itemBoms:[],partnerItems:[],planCatalogItemDelete,catalogItemDeleteBlockMessage,
 loadCatalogDeleteBlockers:()=>load.promise,setCatalogDeleteAsk:set,setAppNotice:notice,commitCompanyWrites:writer,refreshStaticData:refresh,alert,console:{error:vi.fn()},COL:{items:'items',itemBom:'itemBoms',partnerItem:'partnerItems'}};
 return {scope,current,load,writer,notice,refresh,alert,set,get:()=>ask,deps};
}
it.each(['완료','거절'])('품목 삭제 실제 준비의 늦은 %s는 다른 회사 확인창과 안내를 덮지 않는다',async outcome=>{
 const h=catalogHarness();const request=actualNamed('requestCatalogItemDelete',h.deps);const waiting=request('item');h.scope.current={token:{}};const next={scope:h.scope.current.token,itemId:'B'};h.set(next);
 if(outcome==='완료')h.load.resolve([]);else h.load.reject(new Error('조회 거절'));await waiting;
 expect(h.get()).toBe(next);expect(h.notice).not.toHaveBeenCalled();expect(h.writer).not.toHaveBeenCalled();
});
it('같은 회사에서 뒤에 시작한 품목 삭제 요청만 확인창을 연다',async()=>{
 const h=catalogHarness();const first=deferred();const second=deferred();let n=0;
 h.deps.loadCatalogDeleteBlockers=()=> (++n===1?first:second).promise;
 const request=actualNamed('requestCatalogItemDelete',h.deps);const a=request('item');const b=request('item');second.resolve([]);await b;const newer=h.get();first.resolve([]);await a;expect(h.get()).toBe(newer);
});
it.each(['회사 전환','새 확인창'])('삭제 직전 주문 조회 중 %s이면 batch를 실행하지 않는다',async boundary=>{
 const h=catalogHarness();const ask={scope:h.scope.current.token,itemId:'item',itemName:'삭제품목',bomIds:[],partnerItemIds:[]};h.set(ask);
 const waiting=actualNamed('confirmCatalogItemDelete',{...h.deps,catalogDeleteAsk:ask})();
 if(boundary==='회사 전환')h.scope.current={token:{}};const next={...ask,scope:h.scope.current.token,itemId:'B'};h.set(next);h.load.resolve([]);await waiting;
 expect(h.writer).not.toHaveBeenCalled();expect(h.get()).toBe(next);expect(h.refresh).not.toHaveBeenCalled();
});
it.each(['성공','실패'])('삭제 batch의 늦은 %s가 새 회사 화면을 닫거나 갱신하지 않는다',async outcome=>{
 const h=catalogHarness();const commit=deferred();h.writer.mockImplementation(()=>commit.promise as Promise<void>);
 const ask={scope:h.scope.current.token,itemId:'item',bomIds:[],partnerItemIds:[]};h.set(ask);h.load.resolve([]);
 const waiting=actualNamed('confirmCatalogItemDelete',{...h.deps,catalogDeleteAsk:ask})();await waitFor(()=>expect(h.writer).toHaveBeenCalledOnce());
 h.scope.current={token:{}};const next={...ask,scope:h.scope.current.token,itemId:'B'};h.set(next);
 if(outcome==='성공')commit.resolve(undefined);else commit.reject(new Error('삭제 실패'));await waiting;
 expect(h.get()).toBe(next);expect(h.refresh).not.toHaveBeenCalled();expect(h.alert).not.toHaveBeenCalled();
});
it('현재 품목 삭제는 즉시 중복 확인을 막고 연결을 한 batch로 삭제한다',async()=>{
 const h=catalogHarness();const ask={scope:h.scope.current.token,itemId:'item',bomIds:['bom'],partnerItemIds:['partner']};h.set(ask);
 const confirm=actualNamed('confirmCatalogItemDelete',{...h.deps,catalogDeleteAsk:ask});const first=confirm();await confirm();h.load.resolve([]);await first;
 expect(h.writer).toHaveBeenCalledOnce();expect(h.writer.mock.calls[0][0]).toEqual([{kind:'delete',collection:'items',id:'item'},{kind:'delete',collection:'itemBoms',id:'bom'},{kind:'delete',collection:'partnerItems',id:'partner'}]);expect(h.get()).toBeNull();expect(h.refresh).toHaveBeenCalledOnce();
});
it('현재 삭제 실패는 확인창을 보존하고 재시도를 허용한다',async()=>{
 const h=catalogHarness();h.writer.mockRejectedValue(new Error('거절'));const ask={scope:h.scope.current.token,itemId:'item',bomIds:[],partnerItemIds:[]};h.set(ask);h.load.resolve([]);
 const confirm=actualNamed('confirmCatalogItemDelete',{...h.deps,catalogDeleteAsk:ask});await confirm();expect(h.get()).toBe(ask);expect(h.alert).toHaveBeenCalledOnce();await confirm();expect(h.writer).toHaveBeenCalledTimes(2);
});
it('품목 삭제 확인창은 회사 전환 시 숨고 이전 취소가 새 확인창을 지우지 않는다',()=>{
 let condition:ts.Expression|undefined;let cancel:ts.Expression|undefined;
 const find=(node:ts.Node)=>{if(ts.isBinaryExpression(node)&&ts.isParenthesizedExpression(node.right)&&ts.isJsxSelfClosingElement(node.right.expression)){
 const jsx=node.right.expression;const title=jsx.attributes.properties.find(p=>ts.isJsxAttribute(p)&&p.name.getText(file)==='title') as ts.JsxAttribute|undefined;
 if(title?.initializer?.getText(file)==='"품목 삭제"'){condition=node.left;const attr=jsx.attributes.properties.find(p=>ts.isJsxAttribute(p)&&p.name.getText(file)==='onCancel') as ts.JsxAttribute;cancel=(attr.initializer as ts.JsxExpression).expression;}
 }ts.forEachChild(node,find);};find(file);if(!condition||!cancel)throw new Error('실제 품목 삭제 모달 없음');
 const h=catalogHarness();const ask={scope:h.scope.current.token,itemId:'item'};h.set(ask);
 const visible=new Function('catalogDeleteAsk','orderAskScope',`return ${condition.getText(file)};`);expect(visible(ask,h.scope)).toBe(true);
 const code=ts.transpileModule(`const callback=${cancel.getText(file)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const deps={...h.deps,catalogDeleteAsk:ask};const callback=new Function(...Object.keys(deps),`${code};return callback;`)(...Object.values(deps));
 const next={...ask,itemId:'next'};h.set(next);callback();expect(h.get()).toBe(next);
 h.scope.current={token:{}};expect(visible(ask,h.scope)).toBe(false);callback();expect(h.get()).toBe(next);
});
