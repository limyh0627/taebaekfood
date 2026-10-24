/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({add:vi.fn(),update:vi.fn(),pdf:vi.fn(),error:null as null|((s:any)=>void),subs:[] as any[],snap:null as null|((s:any)=>void),unsub:vi.fn(),where:vi.fn((...args:any[])=>args)}));
vi.mock('../../../shared/firebase',()=>({db:{},auth:{currentUser:{uid:'output-test'},onAuthStateChanged:()=>()=>{}}}));
vi.mock('firebase/firestore',()=>({collection:vi.fn((_,name)=>name),where:m.where,query:vi.fn((...args)=>args),onSnapshot:vi.fn((ref,...args)=>{const cb=typeof args[0]==='function'?args[0]:args[1],error=typeof args[0]==='function'?args[1]:args[2];m.snap=cb;m.error=error;m.subs.push({ref,next:cb,error});cb({docs:[],metadata:{fromCache:false}});return m.unsub;})}));
vi.mock('../../../shared/services/firebaseService',()=>({addItem:m.add,updateItem:m.update}));
vi.mock('../infrastructure/downloadAsPDF',()=>({downloadAsPDF:m.pdf}));
import { IncomingForm } from './IncomingForm';
import { HaccpCompanyContext } from '../context/HaccpCompanyContext';
const month=new Date().toISOString().slice(0,7);
const row={date:'',inboundPartner:'원문업체',material:'참깨',materialType:'원료',quantity:'2.50',unit:'kg',lotNo:'LOT',expDate:'',appearance:'',packaging:'',label:'',certAvail:'',result:'',corrective:'',inspector:''};
const receive=(data:any)=>act(()=>m.snap?.({docs:[{id:'record',data:()=>data}],metadata:{fromCache:false}}));
beforeEach(()=>{vi.clearAllMocks();m.subs=[];m.add.mockResolvedValue('new');m.update.mockResolvedValue(undefined);});
it('신규 저장은 기존 컬렉션·행·작성자·revision 계약을 유지한다',async()=>{
 render(<IncomingForm currentUser={{id:'u',name:'합성작성자'}}/>);fireEvent.click(screen.getByRole('button',{name:'행 추가'}));const rows=screen.getByRole('table').querySelectorAll('tbody tr');const fields=rows[0].querySelectorAll('input');fireEvent.change(fields[1],{target:{value:'공급업체'}});fireEvent.change(fields[2],{target:{value:'2.50'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.add).toHaveBeenCalledOnce());const [collection,payload]=m.add.mock.calls[0];expect(collection).toBe('haccp_incoming');expect(payload).toMatchObject({month,createdBy:'합성작성자',updatedBy:'합성작성자',revisionCount:0});expect(payload.rows).toHaveLength(2);expect(payload.rows[0]).toMatchObject({inboundPartner:'공급업체',quantity:'2.50',unit:'kg'});expect(payload.rows[1].inboundPartner).toBe('');
});
it('수신 기록은 편집 초안을 채우고 수정 revision과 관리자 확인을 그대로 보낸다',async()=>{
 render(<IncomingForm currentUser={{id:'u',name:'확인자'}} canConfirm/>);receive({month,rows:[row],revisionCount:3,updatedBy:'이전'});expect(screen.getByDisplayValue('원문업체')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.update).toHaveBeenCalledWith('haccp_incoming','record',expect.objectContaining({revisionCount:4,updatedBy:'확인자',rows:[row]})));fireEvent.click(screen.getByRole('button',{name:'관리자 확인'}));await waitFor(()=>expect(m.update).toHaveBeenCalledWith('haccp_incoming','record',expect.objectContaining({confirmedBy:'확인자'})));
});
it('과거월 직원은 읽기 전용이고 PDF에는 선택 월의 인쇄 영역만 준다',()=>{
 render(<IncomingForm/>);fireEvent.change(screen.getByLabelText(/관리월/),{target:{value:'2020-01'}});expect(screen.getByText('읽기 전용')).toBeInTheDocument();expect(screen.queryByRole('button',{name:'저장'})).toBeNull();expect(screen.queryByRole('button',{name:'행 추가'})).toBeNull();expect(screen.queryByRole('button',{name:'관리자 확인'})).toBeNull();expect(within(screen.getByRole('table')).getAllByRole('combobox')[0]).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'PDF'}));const [element,file]=m.pdf.mock.calls[0];expect(file).toBe('HACCP_입고검사일지_2020-01.pdf');expect(element).toContainElement(screen.getByText('원료·부자재 입고검사일지'));expect(m.add).not.toHaveBeenCalled();
});
it('회사 context는 동일 where 값과 구독 해제를 유지한다',()=>{
 const view=render(<HaccpCompanyContext.Provider value="taebaek"><IncomingForm/></HaccpCompanyContext.Provider>);expect(m.where).toHaveBeenCalledWith('companyId','==','taebaek');view.rerender(<HaccpCompanyContext.Provider value="punghoe"><IncomingForm/></HaccpCompanyContext.Provider>);expect(m.unsub).toHaveBeenCalledOnce();expect(m.where).toHaveBeenCalledWith('companyId','==','punghoe');view.unmount();expect(m.unsub).toHaveBeenCalledTimes(2);
});

it('작성 중 빈 snapshot은 현재 초안을 덮지 않는다',()=>{render(<IncomingForm currentUser={{id:'u',name:'작성자'}}/>);const field=screen.getByRole('table').querySelectorAll('tbody tr')[0].querySelectorAll('input')[1];fireEvent.change(field,{target:{value:'보존초안'}});act(()=>m.snap?.({docs:[],metadata:{fromCache:false}}));expect(field).toHaveValue('보존초안');});
it('신규 ACK 뒤 query를 기다리지 않고 같은 ID로 수정한다',async()=>{render(<IncomingForm currentUser={{id:'u',name:'작성자'}}/>);fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.add).toHaveBeenCalledOnce());await waitFor(()=>expect(screen.getByRole('button',{name:'저장'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.update).toHaveBeenCalledWith('haccp_incoming','new',expect.objectContaining({revisionCount:1})));expect(m.add).toHaveBeenCalledOnce();});

import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as ts from 'typescript';
const monthlyPreserved=(text:string)=>{
 text=text.replace(/ \|\| monthly\.busy/g,'');
 const file=ts.createSourceFile('form.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),result:Record<string,string>={};
 const names=new Set(['RAW_MATERIALS','SUB_MATERIALS','defaultIncomingRow','MACHINES','MACHINE_NAMES','CLEAN_AREAS','SANITIZERS','defaultMachineRows','defaultAreaRows','resultColor','addRow','updateMachine','addMachineRow','addAreaRow','updateArea']);
 const hash=(key:string,node:ts.Node)=>{result[key]=createHash('sha256').update(node.getText(file).replace(/\r\n/g,'\n')).digest('hex');};
 const visit=(node:ts.Node,scope='')=>{
  if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer){const name=node.name.text;if(names.has(name))hash(name,node.initializer);if(['handleSave','handleConfirm'].includes(name))scope=name;if(scope==='handleSave'&&['data','update'].includes(name))hash('payload:'+name,node.initializer);if(scope==='handleConfirm'&&name==='update')hash('payload:confirm',node.initializer);}
  if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&['addItem','updateItem'].includes(node.expression.text)){const value=node.arguments.at(-1);if(value&&ts.isObjectLiteralExpression(value))hash(node.expression.text==='addItem'?'payload:data':scope==='handleConfirm'?'payload:confirm':'payload:update',value);}
  if(ts.isJsxElement(node)){const attr=node.openingElement.attributes.properties.find(attr=>ts.isJsxAttribute(attr)&&attr.name.getText(file)==='ref');if(attr&&ts.isJsxAttribute(attr)&&attr.initializer)hash('pdf:'+attr.initializer.getText(file),node);}
  ts.forEachChild(node,child=>visit(child,scope));
 };visit(file);return result;
};
it('허용수명delta밖도메인·payload·PDF원문AST보존',()=>{expect(monthlyPreserved(readFileSync('src/features/haccp/ui/IncomingForm.tsx','utf8'))).toEqual({
  "RAW_MATERIALS": "0aea2128742921ba71753932d9a24be1901cab26abdee8879266822b89999c6f",
  "SUB_MATERIALS": "296829bb0358b924edd91bee000277ef75f2546ebcac9e100428cb65044718bf",
  "defaultIncomingRow": "4120509eb1f84a54ac3e9239dbe9c8a246aec13be3b563571a9825ace7b39ad1",
  "addRow": "78b99554d2210e68643de28c25b42b52e52b80526cdaec1ab2ed33401d7d3684",
  "payload:data": "ddf234aa98c07e8217084a52ebb1bf095848a24a3521b3d18260769cb861cf3d",
  "payload:update": "90601507d4f05c2024db84825ce1faa20036715e1900df84a14af513441f82bf",
  "payload:confirm": "db6dd5fb8730978b8fc7d999f800ad39b0996b605d49990b1a129f2bf498a89d",
  "resultColor": "dd928ec3161792aebf2f2c18afbba9b1f4899e794c5d2b28fce1e75d0c371c63",
  "pdf:{printRef}": "874758f1b011fe6577858f5e30e6b7b91884c6541021f198a4b540844b24871a"
});});

it('처리중행입력·추가·관리월을잠그고ACK조회오류뒤동일ID수정을허용한다',async()=>{
 let resolve!:(id:string)=>void;m.add.mockReturnValue(new Promise<string>(r=>{resolve=r;}));render(<IncomingForm currentUser={{id:'u',name:'작성자'}}/>);const field=screen.getByRole('table').querySelectorAll('tbody tr')[0].querySelectorAll('input')[1];fireEvent.change(field,{target:{value:'잠금원문'}});const beforeRows=screen.getAllByRole('table')[0].querySelectorAll('tbody tr').length;fireEvent.click(screen.getByRole('button',{name:'저장'}));fireEvent.change(field,{target:{value:'침범'}});fireEvent.change(screen.getByLabelText(/관리월/),{target:{value:'2020-01'}});fireEvent.click(screen.getAllByRole('button',{name:'행 추가'})[0]);expect(field).toHaveValue('잠금원문');expect(screen.getByLabelText(/관리월/)).toHaveValue(month);expect(screen.getAllByRole('table')[0].querySelectorAll('tbody tr').length).toBe(beforeRows);
 act(()=>m.error?.({code:'unavailable'}));await act(async()=>resolve('ack-id'));expect(screen.getByText('저장 완료 · 목록 조회 필요')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'다시 조회'}));expect(m.add).toHaveBeenCalledOnce();fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.update).toHaveBeenCalledWith('haccp_incoming','ack-id',expect.objectContaining({revisionCount:1})));expect(field).toHaveValue('잠금원문');
});
