/** @vitest-environment jsdom */
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {expect,it,vi} from 'vitest';
import {captureStatementEdit} from '../statements/application/statementEditor';
import {statementEditPatch} from '../../shared/statementEdit';
import type {IssuedStatement} from '../../shared/types';
const source=readFileSync('src/features/admin/AdminApp.tsx','utf8');
const tree=ts.createSourceFile('AdminApp.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let expression='';function visit(n:ts.Node){if(ts.isVariableDeclaration(n)&&n.name.getText(tree)==='updateStatement'&&n.initializer)expression=n.initializer.getText(tree);ts.forEachChild(n,visit);}visit(tree);
const original={id:'statement',companyId:'taebaek',mutationRevision:0,type:'매출',docNo:'old-doc',tradeDate:'2026-10-01',issuedAt:'2026-10-01T09:00:00Z',partnerId:'p',partnerName:'거래처',orderId:'',totalSupply:100,totalTax:10,totalAmount:110,items:[]} as IssuedStatement;
function parent(live:IssuedStatement=original){const auth={currentUser:{uid:'actor-A'}};const rpc=vi.fn(async(_id:string,_patch:unknown,revision:number)=>{if(revision!==live.mutationRevision)throw Error('전표가 변경되었습니다');});const deps={useCallback:(fn:unknown)=>fn,companyId:'taebaek',issuedStatements:[live],captureStatementEdit,statementEditPatch,editIssuedStatementCommand:rpc,auth,crypto:{randomUUID:()=> 'fixed-operation'}};const js=ts.transpileModule('const result='+expression+';',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;const callback=Function(...Object.keys(deps),js+'return result;')(...Object.values(deps));return {callback,rpc,auth};}
it('실부모는 처음 선택한 r0를 최신 r1로 포장하지 않고 기존 서버 충돌을 전달한다',async()=>{const h=parent({...original,mutationRevision:1,memo:'다른 직원 수정'});await expect(h.callback(original.id,{memo:'r0 초안'},original,'actor-A',()=>true)).rejects.toThrow('전표가 변경되었습니다');expect(h.rpc).toHaveBeenCalledWith(original.id,expect.objectContaining({memo:'r0 초안'}),0,'fixed-operation',undefined,'actor-A',expect.any(Function));});
it.each([{memo:'전체 편집'},{tradeDate:'2026-11-01'},{evidence:'계산서'}])('편집·날짜·증빙 모두 선택 원문과 UID를 같은 부모 저장 경로에 전달한다 %j',async patch=>{const h=parent();await h.callback(original.id,patch,original,'actor-A',()=>true);expect(h.rpc.mock.calls[0][2]).toBe(0);expect(h.rpc).toHaveBeenCalledOnce();});
it('원문 없거나 ID·회사·UID·수명이 다르면 최신 목록에 존재해도 송신하지 않는다',()=>{const h=parent();for(const args of [[original.id,{},undefined,'actor-A',()=>true],['other',{},original,'actor-A',()=>true],[original.id,{}, {...original,companyId:'punghoe'},'actor-A',()=>true],[original.id,{},original,'actor-B',()=>true],[original.id,{},original,'actor-A',()=>false]])expect(()=>h.callback(...args)).toThrow();expect(h.rpc).not.toHaveBeenCalled();});
