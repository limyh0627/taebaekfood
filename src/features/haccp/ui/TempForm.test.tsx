/** @vitest-environment jsdom */
import React from 'react';
import {fireEvent,render,screen,within} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as ts from 'typescript';
const state=vi.hoisted(()=>({subscriptions:[] as any[],rows:[] as any[],add:vi.fn(),update:vi.fn(),remove:vi.fn()}));
vi.mock('../../../shared/firebase',()=>({db:{}}));
vi.mock('../../../shared/components/appDialog',()=>({appConfirm:vi.fn().mockResolvedValue(true)}));
vi.mock('../../../shared/services/firebaseService',()=>({addItem:state.add,updateItem:state.update,deleteItem:state.remove,setDocument:vi.fn()}));
vi.mock('firebase/firestore',()=>({collection:(_:unknown,name:string)=>({collection:name}),doc:(_:unknown,name:string,id:string)=>({collection:name,id}),where:(field:string,op:string,value:unknown)=>({field,op,value}),query:(ref:object,...clauses:unknown[])=>({...ref,clauses}),onSnapshot:(ref:any,next:any)=>{const stop=vi.fn();state.subscriptions.push({ref,next,stop});if(ref.collection==='haccp_temp')next({docs:state.rows.map(row=>({id:row.id,data:()=>row}))});else next({exists:()=>false});return stop;}}));
import {TempForm} from './TempForm';
import {TempForm as LegacyTempForm} from '../../../../components/HaccpChecklist';
import {HaccpCompanyContext} from '../context/HaccpCompanyContext';
import {STORAGE_ZONES} from '../domain/tempZones';
beforeEach(()=>{state.subscriptions=[];state.rows=[];state.add.mockReset();state.update.mockReset();state.remove.mockReset();});

it('기존 named export는 직접 함수와 같고 온도행 기본구역·검사자·정수입력을 보존한다',()=>{
 expect(LegacyTempForm).toBe(TempForm);render(<TempForm currentUser={{id:'test',name:'합성 측정자'}} isAdmin/>);
 fireEvent.click(screen.getByRole('button',{name:/오늘 온도 측정 기록/}));
 for(const zone of STORAGE_ZONES)expect(screen.getAllByDisplayValue(zone.name).length).toBeGreaterThan(0);
 const row=screen.getAllByRole('row').find(row=>within(row).queryByDisplayValue('냉장창고 1'))!;
 const inputs=within(row).getAllByRole('textbox');fireEvent.change(inputs[0],{target:{value:'-18.7℃'}});expect(inputs[0]).toHaveValue('-187');
 expect(within(row).getByDisplayValue('합성 측정자')).toBeInTheDocument();
});
it('두 구독의 회사 조건·템플릿 문서와 회사 전환 cleanup을 보존한다',()=>{
 const view=render(<HaccpCompanyContext.Provider value="punghoe"><TempForm/></HaccpCompanyContext.Provider>);
 expect(state.subscriptions[0].ref).toEqual({collection:'haccp_temp',clauses:[{field:'companyId',op:'==',value:'punghoe'}]});
 expect(state.subscriptions[1].ref).toEqual({collection:'haccp_templates',id:'punghoe--temp_zones'});
 view.rerender(<HaccpCompanyContext.Provider value="taebaek"><TempForm/></HaccpCompanyContext.Provider>);
 expect(state.subscriptions[0].stop).toHaveBeenCalledOnce();expect(state.subscriptions[1].stop).toHaveBeenCalledOnce();expect(state.subscriptions[2].ref.clauses[0].value).toBe('taebaek');
 view.unmount();expect(state.subscriptions[2].stop).toHaveBeenCalledOnce();expect(state.subscriptions[3].stop).toHaveBeenCalledOnce();
});
it('온도 타입·기본행·폼·구역 원문 AST와 부모 실제 연결을 보존한다',()=>{
 const expected:Record<string,string>={TempRow:'cbf9e771f9aa1b3912e7777f02710170028617a6eba46ec0c097d3b98d60262b',TempRecord:'d0ad44b82a88d8c3d8489d2dc3e17440a7be3fe364375ac8e3ffd9a853823b1f',defaultTempRows:'163abc3178b721404981356ed1b6370db66ee86cc004246c35e58449c7cf99ac',TempForm:'f22b04cb14b8ce2684b41f8e8414aa4f5e36da98c74cc8b531cbbe5a07f3f8a4',STORAGE_ZONES:'b34cf6ad3ad874fd7c4fed9d975ea53e51fe16fb3821c2e0604c8743f68038a5',StorageZone:'049e0d456eb1fc7bab6e9edbdf91e1c98b6df6e6273edefc1fbaf05549103e9a'};
 const found:Record<string,string>={};
 for(const path of ['src/features/haccp/ui/TempForm.tsx','src/features/haccp/domain/tempZones.ts']){const text=readFileSync(path,'utf8'),s=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true,path.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);for(const n of s.statements){if(ts.isVariableStatement(n))for(const d of n.declarationList.declarations){const key=d.name.getText(s);if(expected[key])found[key]=createHash('sha256').update(d.initializer!.getText(s).replace(/\r\n/g,'\n')).digest('hex');}else if(ts.isInterfaceDeclaration(n)||ts.isTypeAliasDeclaration(n)){const key=n.name.text;if(expected[key])found[key]=createHash('sha256').update(n.getText(s).replace(/^export /,'').replace(/\r\n/g,'\n')).digest('hex');}}expect(text).not.toContain('HaccpChecklist');}
 expect(found).toEqual(expected);const parent=readFileSync('components/HaccpChecklist.tsx','utf8');expect(parent).toContain("export {TempForm} from '../src/features/haccp/ui/TempForm'");expect(parent).toContain("{activeTab === 'temp'       && <TempForm currentUser={currentUser} isAdmin={isAdmin} canConfirm={isAdmin} />}");expect(parent).not.toContain('const STORAGE_ZONES =');
});
