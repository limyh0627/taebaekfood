/** @vitest-environment jsdom */
import React,{useEffect,useState} from 'react';
import {act,render,screen,fireEvent} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import ItemManager from '../../../components/ItemManager';
import type {Item} from '../../shared/types';
vi.mock('../../shared/services/firebaseService',()=>({fetchCollection:vi.fn().mockResolvedValue([])}));
import {normalizeViewAlias} from '../../shared/startView';
const source=readFileSync(process.env.TODO039_CANDIDATE_SOURCE || 'src/features/admin/AdminApp.tsx','utf8');
const parsed=ts.createSourceFile('AdminApp.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const effects:ts.ArrowFunction[]=[];const visit=(node:ts.Node)=>{if(ts.isCallExpression(node)&&node.expression.getText(parsed)==='useEffect'&&ts.isArrowFunction(node.arguments[0]))effects.push(node.arguments[0]);ts.forEachChild(node,visit);};visit(parsed);
function effectContaining(marker:string,currentView:string,setCurrentView:(view:string)=>void){const matches=effects.filter(node=>node.getText(parsed).includes(marker));if(matches.length!==1)throw Error('실제 effect가 유일하지 않음: '+marker+' '+matches.length);const callback=matches[0];const js=ts.transpileModule('const callback='+callback.getText(parsed),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;return new Function('normalizeViewAlias','currentView','setCurrentView',js+';return callback;')(normalizeViewAlias,currentView,setCurrentView) as ()=>void;}
const branches:ts.BinaryExpression[]=[];
function findBranch(node:ts.Node){if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.AmpersandAmpersandToken&&node.left.getText(parsed)==="normalizeViewAlias(currentView) === 'item-management'"){let count=0;function findItem(child:ts.Node){if((ts.isJsxOpeningElement(child)||ts.isJsxSelfClosingElement(child))&&child.tagName.getText(parsed)==='ItemManager')count++;ts.forEachChild(child,findItem);}findItem(node.right);if(count===1)branches.push(node);}ts.forEachChild(node,findBranch);}findBranch(parsed);
if(branches.length!==1)throw Error('현대 ItemManager 분기가 유일하지 않음: '+branches.length);
const itemBranch=new Function('normalizeViewAlias','currentView','return '+branches[0].left.getText(parsed));
const edit=vi.fn();
const item={id:'current',companyId:'taebaek',name:'현대 참기름',type:'product',unit:'개',spec:'350ml',stock:0,minStock:0,image:''} as Item;
const sw=new EventTarget();
beforeEach(()=>{edit.mockClear();window.history.replaceState(null,'','/');Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:sw});});
afterEach(()=>{vi.restoreAllMocks();window.history.replaceState(null,'','/');});
function Host({initial='inventory'}:{initial?:string}){const [view,setView]=useState(initial);useEffect(effectContaining("get('notif')",view,setView),[]);useEffect(effectContaining('const resolved = normalizeViewAlias(currentView)',view,setView),[view]);return <div>{itemBranch(normalizeViewAlias,view)?<div data-testid="current-item-manager"><ItemManager companyId="taebaek" items={[item]} partners={[]} onEditProduct={edit} onAddItem={vi.fn()} onDeleteItem={vi.fn()} onLinkItem={vi.fn()} onUnlinkItem={vi.fn()}/></div>:view}</div>;}
it('실제 notif URL effect는 옛 alias를 현재 ItemManager 분기로 보낸다',()=>{window.history.replaceState(null,'','/?notif=item-price-management');render(<Host/>);expect(screen.getByTestId('current-item-manager')).toBeInTheDocument();expect(window.location.search).toBe('');fireEvent.click(screen.getByTitle('수정'));expect(edit).toHaveBeenCalledWith(item);});
it('실제 service worker 알림과 상위 currentView alias도 현재 ItemManager를 연다',()=>{const rendered=render(<Host/>);act(()=>sw.dispatchEvent(new MessageEvent('message',{data:{type:'notif-open',view:'item-price-management'}})));expect(screen.getByTestId('current-item-manager')).toBeInTheDocument();fireEvent.click(screen.getByTitle('수정'));expect(edit).toHaveBeenCalledWith(item);rendered.unmount();render(<Host initial="item-price-management"/>);expect(screen.getByTestId('current-item-manager')).toBeInTheDocument();});
it('다른 화면 알림과 구독 정리는 기존대로 유지한다',()=>{const rendered=render(<Host/>);act(()=>sw.dispatchEvent(new MessageEvent('message',{data:{type:'notif-open',view:'orders'}})));expect(screen.getByText('orders')).toBeInTheDocument();const removed=vi.spyOn(sw,'removeEventListener');rendered.unmount();expect(removed).toHaveBeenCalledWith('message',expect.any(Function));});
it('구 원가 writer/lazy 분기는 닫고 현대 품목 수정과 BOM 계산 연결은 보존한다',()=>{expect(source).not.toContain('<ItemPriceManager');expect(source).not.toContain("import('../../../components/ItemPriceManager')");expect(source).not.toContain("onUpdateCost={(itemId, cost) => updateItem('items', itemId, { cost })}");expect(source).toContain('onCalcCost={(rows, opts) => calcCost(rows, allItems, itemBoms');expect(source).toContain('items={companyItems}');expect(source).toContain('orderUnitInputs={appData.orderUnitInputs}');});
