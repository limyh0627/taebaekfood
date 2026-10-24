/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({add:vi.fn(),update:vi.fn(),pdf:vi.fn(),error:null as null|((s:any)=>void),subs:[] as any[],snap:null as null|((s:any)=>void),unsub:vi.fn(),where:vi.fn((...args:any[])=>args)}));
vi.mock('../../../shared/firebase',()=>({db:{},auth:{currentUser:{uid:'output-test'},onAuthStateChanged:()=>()=>{}}}));
vi.mock('firebase/firestore',()=>({collection:vi.fn((_,n)=>n),query:vi.fn((...args)=>args),where:m.where,onSnapshot:vi.fn((ref,...args)=>{const cb=typeof args[0]==='function'?args[0]:args[1],error=typeof args[0]==='function'?args[1]:args[2];m.snap=cb;m.error=error;m.subs.push({ref,next:cb,error});cb({docs:[],metadata:{fromCache:false}});return m.unsub;})}));
vi.mock('../../../shared/services/firebaseService',()=>({addItem:m.add,updateItem:m.update}));
vi.mock('../infrastructure/downloadAsPDF',()=>({downloadAsPDF:m.pdf}));
import { CleaningForm } from './CleaningForm';
import { HaccpCompanyContext } from '../context/HaccpCompanyContext';
const month=new Date().toISOString().slice(0,7);
beforeEach(()=>{vi.clearAllMocks();m.subs=[];m.add.mockResolvedValue('new');m.update.mockResolvedValue(undefined);});
it('기계·구역 기본행과 행별 수정·추가를 신규 저장 계약 그대로 보낸다',async()=>{
 render(<CleaningForm currentUser={{id:'u',name:'작업자'}}/>);const methods=screen.getAllByPlaceholderText('세척방법 기재');const second=(methods[1] as HTMLInputElement).value;fireEvent.change(methods[0],{target:{value:'합성방법'}});expect(methods[1]).toHaveValue(second);fireEvent.click(screen.getAllByRole('button',{name:'+ 행 추가'})[0]);fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.add).toHaveBeenCalledOnce());const [collection,payload]=m.add.mock.calls[0];expect(collection).toBe('haccp_cleaning');expect(payload).toMatchObject({month,createdBy:'작업자',updatedBy:'작업자',revisionCount:0});expect(payload.machineRows[0].cleanMethod).toBe('합성방법');expect(payload.areaRows.length).toBeGreaterThan(0);expect(payload.machineRows.length).toBe(methods.length+1);
});
it('기록 수신 후 수정 차수와 확인권한의 서비스 인자를 보존한다',async()=>{
 render(<CleaningForm currentUser={{id:'u',name:'확인자'}} canConfirm/>);act(()=>m.snap?.({docs:[{id:'rec',data:()=>({month,machineRows:[],areaRows:[],revisionCount:2,updatedBy:'이전'})}],metadata:{fromCache:false}}));fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.update).toHaveBeenCalledWith('haccp_cleaning','rec',expect.objectContaining({revisionCount:3,machineRows:[],areaRows:[]})));fireEvent.click(screen.getByRole('button',{name:'관리자 확인'}));await waitFor(()=>expect(m.update).toHaveBeenCalledWith('haccp_cleaning','rec',expect.objectContaining({confirmedBy:'확인자'})));
});
it('직원 과거월은 저장·추가를 숨기고 두 PDF의 별도 영역·파일명을 유지한다',()=>{
 render(<CleaningForm/>);fireEvent.change(screen.getByLabelText(/관리월/),{target:{value:'2020-01'}});expect(screen.getByText('읽기 전용')).toBeInTheDocument();expect(screen.queryByRole('button',{name:'저장'})).toBeNull();expect(screen.queryByRole('button',{name:'+ 행 추가'})).toBeNull();expect(within(screen.getAllByRole('table')[0]).getAllByRole('combobox')[0]).toBeDisabled();screen.getAllByRole('button',{name:'PDF 저장'}).forEach(button=>fireEvent.click(button));expect(m.pdf.mock.calls.map(c=>c[1])).toEqual(['HACCP_기계세척소독일지_2020-01.pdf','HACCP_구역청소일지_2020-01.pdf']);expect(m.pdf.mock.calls[0][0]).not.toBe(m.pdf.mock.calls[1][0]);
});
it('회사별 구독 인자와 cleanup을 보존한다',()=>{
 const view=render(<HaccpCompanyContext.Provider value="taebaek"><CleaningForm/></HaccpCompanyContext.Provider>);view.rerender(<HaccpCompanyContext.Provider value="punghoe"><CleaningForm/></HaccpCompanyContext.Provider>);expect(m.where).toHaveBeenCalledWith('companyId','==','punghoe');expect(m.unsub).toHaveBeenCalledOnce();view.unmount();expect(m.unsub).toHaveBeenCalledTimes(2);
});
it('회사 변경과 화면 해제는 두 출력 영역의 이전 미리보기 수명을 끝낸다',()=>{
 const view=render(<HaccpCompanyContext.Provider value="taebaek"><CleaningForm/></HaccpCompanyContext.Provider>);fireEvent.click(screen.getAllByRole('button',{name:'PDF 저장'})[0]);const first=m.pdf.mock.calls[0][2] as AbortSignal;expect(first.aborted).toBe(false);view.rerender(<HaccpCompanyContext.Provider value="punghoe"><CleaningForm/></HaccpCompanyContext.Provider>);expect(first.aborted).toBe(true);fireEvent.click(screen.getAllByRole('button',{name:'PDF 저장'})[1]);const second=m.pdf.mock.calls[1][2] as AbortSignal;view.unmount();expect(second.aborted).toBe(true);expect(m.add).not.toHaveBeenCalled();expect(m.update).not.toHaveBeenCalled();
});

it('작성 중 빈 snapshot은 현재 초안을 덮지 않는다',()=>{render(<CleaningForm currentUser={{id:'u',name:'작성자'}}/>);const field=screen.getAllByPlaceholderText('세척방법 기재')[0];fireEvent.change(field,{target:{value:'보존초안'}});act(()=>m.snap?.({docs:[],metadata:{fromCache:false}}));expect(field).toHaveValue('보존초안');});
it('신규 ACK 뒤 query를 기다리지 않고 같은 ID로 수정한다',async()=>{render(<CleaningForm currentUser={{id:'u',name:'작성자'}}/>);fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.add).toHaveBeenCalledOnce());await waitFor(()=>expect(screen.getByRole('button',{name:'저장'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.update).toHaveBeenCalledWith('haccp_cleaning','new',expect.objectContaining({revisionCount:1})));expect(m.add).toHaveBeenCalledOnce();});

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
it('허용수명delta밖도메인·payload·PDF원문AST보존',()=>{expect(monthlyPreserved(readFileSync('src/features/haccp/ui/CleaningForm.tsx','utf8'))).toEqual({
  "MACHINES": "721db8f01831fb38fb8de3e857834b1f009a1c05695f02d06a2d777f9952484c",
  "MACHINE_NAMES": "d3f575146bbbdfe8a530dcb3aa6a8f2012dad68388dfe6bdfd7ccf136915d127",
  "CLEAN_AREAS": "f2b537c8be67b6eaaf3908308a2b0687b2dc658ecc300f7b6713283f63cc3d49",
  "SANITIZERS": "0c09cdcdc022d3432d882a0905117890fca865cc8cf0f7c3008b030236d96379",
  "defaultMachineRows": "3959986763dd6c58ee23e17952dd1f260ad71a895c9e50e90e4d776320691a6d",
  "defaultAreaRows": "0c3a14dbd5bdb3cfee31b433a721a4e2984389289d6cfe1654150ca9ea163275",
  "addMachineRow": "7a50644cbd28900dbf1d2f67c958dd847ca53e642dcf0e138ed58f640e10e123",
  "updateMachine": "ba8bacdd06a6f2e8efb0cd1120692e66ce4c9bf3c745015fa4b0b5e323972482",
  "addAreaRow": "56e7574cbf20f6c4b0f9496d30f9dd62a4559af587b4b8233810c43557f981ee",
  "updateArea": "88941b76fec02c5387fb6f7e040df4db561258e29e43ca50eaf8845a5344837c",
  "payload:data": "1026089cefa1cb20f981a938091837fd4e91c39945b082037a22edc2d6b6a864",
  "payload:update": "ad047e59d8631e1f925c5c31f8c0d9a21964550eb3b23e0f02a7eb5a2c201d7d",
  "payload:confirm": "db6dd5fb8730978b8fc7d999f800ad39b0996b605d49990b1a129f2bf498a89d",
  "pdf:{machineRef}": "3930cb178bebab3314f788cd1dbba51cfa1e66fc0b3ab296096e12f695f2bada",
  "pdf:{areaRef}": "5e77d74d159e1f71a1fdf5b63eb557f83391882ff3aa5c8d41d71358c3c9b3f0"
});});

it('처리중행입력·추가·관리월을잠그고ACK조회오류뒤동일ID수정을허용한다',async()=>{
 let resolve!:(id:string)=>void;m.add.mockReturnValue(new Promise<string>(r=>{resolve=r;}));render(<CleaningForm currentUser={{id:'u',name:'작성자'}}/>);const field=screen.getAllByPlaceholderText('세척방법 기재')[0];fireEvent.change(field,{target:{value:'잠금원문'}});const beforeRows=screen.getAllByRole('table')[0].querySelectorAll('tbody tr').length;fireEvent.click(screen.getByRole('button',{name:'저장'}));fireEvent.change(field,{target:{value:'침범'}});fireEvent.change(screen.getByLabelText(/관리월/),{target:{value:'2020-01'}});fireEvent.click(screen.getAllByRole('button',{name:'+ 행 추가'})[0]);expect(field).toHaveValue('잠금원문');expect(screen.getByLabelText(/관리월/)).toHaveValue(month);expect(screen.getAllByRole('table')[0].querySelectorAll('tbody tr').length).toBe(beforeRows);
 act(()=>m.error?.({code:'unavailable'}));await act(async()=>resolve('ack-id'));expect(screen.getByText('저장 완료 · 목록 조회 필요')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'다시 조회'}));expect(m.add).toHaveBeenCalledOnce();fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.update).toHaveBeenCalledWith('haccp_cleaning','ack-id',expect.objectContaining({revisionCount:1})));expect(field).toHaveValue('잠금원문');
});
