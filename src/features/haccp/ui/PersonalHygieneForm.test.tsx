/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({subs:[] as any[],auth:{currentUser:{uid:'output-test'},onAuthStateChanged:()=>()=>{}},add:vi.fn(),update:vi.fn(),del:vi.fn(),confirm:vi.fn(),pdf:vi.fn(),records:null as null|((s:any)=>void),unsub:vi.fn(),where:vi.fn((...args:any[])=>args)}));
vi.mock('../../../shared/firebase',()=>({db:{},auth:m.auth}));
vi.mock('firebase/firestore',()=>({collection:vi.fn((_,n)=>({kind:'collection',n})),doc:vi.fn((_,n,id)=>({kind:'doc',n,id})),query:vi.fn((source,...args)=>({...source,args})),where:m.where,onSnapshot:vi.fn((source,...args)=>{const raw=typeof args[0]==='function'?args[0]:args[1],error=typeof args[0]==='function'?args[1]:args[2],cb=(snapshot:any)=>raw({metadata:{fromCache:false},...snapshot});m.subs.push({source,next:cb,error});if(source.kind==='doc')cb({exists:()=>true,data:()=>({cols:['건강']})});else{m.records=cb;cb({docs:[]});}return m.unsub;})}));
vi.mock('../../../shared/services/firebaseService',()=>({addItem:m.add,updateItem:m.update,deleteItem:m.del}));
vi.mock('../../../shared/components/appDialog',()=>({appConfirm:m.confirm}));
vi.mock('../infrastructure/downloadAsPDF',()=>({downloadAsPDF:m.pdf}));
import { PersonalHygieneForm } from './PersonalHygieneForm';
import { HaccpCompanyContext } from '../context/HaccpCompanyContext';
import { todayStr } from '../domain/haccpDate';
beforeEach(()=>{vi.clearAllMocks();m.subs=[];m.auth.currentUser={uid:'output-test'};m.add.mockResolvedValue('new');m.update.mockResolvedValue(undefined);m.confirm.mockResolvedValue(false);});
it('선택된 이름 행만 필수검사하고 신규·수정차수·관리자확인 인자를 보존한다',async()=>{
 render(<PersonalHygieneForm isAdmin canConfirm currentUser={{id:'u',name:'관리자'}}/>);fireEvent.click(screen.getByRole('button',{name:/오늘 개인위생 점검/}));expect(screen.getByRole('button',{name:'저장 먼저'})).toBeDisabled();fireEvent.change(screen.getAllByPlaceholderText('성명')[0],{target:{value:'작업자'}});fireEvent.click(screen.getAllByRole('button',{name:'O'})[0]);fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.add).toHaveBeenCalledOnce());expect(m.add.mock.calls[0][0]).toBe('haccp_personal_hygiene');expect(m.add.mock.calls[0][1]).toMatchObject({checkDate:todayStr(),createdBy:'관리자',revisionCount:0});await screen.findByRole('button',{name:'관리자 확인'});fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.update).toHaveBeenCalledWith('haccp_personal_hygiene','new',expect.objectContaining({revisionCount:1})));fireEvent.click(screen.getByRole('button',{name:'관리자 확인'}));await waitFor(()=>expect(m.update).toHaveBeenCalledWith('haccp_personal_hygiene','new',expect.objectContaining({confirmedBy:'관리자'})));
});
it('미완료 검사 확인을 막고 비관리자 본인 행만 체크할 수 있다',()=>{
 render(<PersonalHygieneForm currentUser={{id:'u',name:'본인'}}/>);fireEvent.click(screen.getByRole('button',{name:/오늘 개인위생 점검/}));expect(screen.queryByPlaceholderText('성명')).toBeNull();const buttons=screen.getAllByRole('button',{name:'O'});expect(buttons[0]).not.toBeDisabled();expect(buttons[1]).toBeDisabled();fireEvent.click(buttons[0]);expect(buttons[0]).toHaveClass('bg-emerald-500');expect(m.update).not.toHaveBeenCalled();
});
it('이전 기록 삭제 취소는 자료를 유지하고 PDF에는 선택일 영역만 전달한다',async()=>{
 render(<PersonalHygieneForm isAdmin/>);act(()=>m.records?.({docs:[{id:'past',data:()=>({checkDate:'2020-01-01',rows:[{name:'과거',checks:{건강:'O'},note:''}],inspector:'이전',revisionCount:0})}]}));fireEvent.click(screen.getByRole('button',{name:/이전 점검 기록/}));const date=screen.getByText('2020-01-01');const card=date.parentElement!;fireEvent.click(card.querySelector('button')!);await waitFor(()=>expect(m.confirm).toHaveBeenCalledOnce());expect(m.del).not.toHaveBeenCalled();fireEvent.click(card);expect(screen.queryByRole('button',{name:'저장'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'PDF'}));expect(m.pdf.mock.calls[0][1]).toBe('개인위생점검표_2020-01-01.pdf');expect(m.pdf.mock.calls[0][0]).toContainElement(screen.getByText('개인위생점검표'));
});
it('회사 전환은 기록과 템플릿 두 구독을 해제한다',()=>{
 const view=render(<HaccpCompanyContext.Provider value="taebaek"><PersonalHygieneForm/></HaccpCompanyContext.Provider>);view.rerender(<HaccpCompanyContext.Provider value="punghoe"><PersonalHygieneForm/></HaccpCompanyContext.Provider>);expect(m.where).toHaveBeenCalledWith('companyId','==','punghoe');expect(m.unsub).toHaveBeenCalledTimes(2);view.unmount();expect(m.unsub).toHaveBeenCalledTimes(4);
});
it('저장된 이름 행의 미완료 검사는 확인을 막고 같은 체크 재클릭은 빈 값으로 되돌린다',()=>{
 render(<PersonalHygieneForm isAdmin canConfirm/>);act(()=>m.records?.({docs:[{id:'today',data:()=>({checkDate:todayStr(),rows:[{name:'작업자',checks:{건강:''},note:''},{name:'',checks:{건강:''},note:''}],inspector:'',revisionCount:0})}]}));fireEvent.click(screen.getByRole('button',{name:/오늘 개인위생 점검/}));expect(screen.getByRole('button',{name:'항목 미완료'})).toBeDisabled();const check=screen.getAllByRole('button',{name:'O'})[0];fireEvent.click(check);expect(screen.getByRole('button',{name:'관리자 확인'})).not.toBeDisabled();fireEvent.click(check);expect(screen.getByRole('button',{name:'항목 미완료'})).toBeDisabled();expect(m.update).not.toHaveBeenCalled();
});

it('저장 대기 중 새 입력과 다른 기록 선택을 막는다',async()=>{
 let finish!:(id:string)=>void;m.add.mockImplementation(()=>new Promise<string>(resolve=>{finish=resolve;}));
 render(<PersonalHygieneForm isAdmin currentUser={{id:'u',name:'관리자'}}/>);fireEvent.click(screen.getByRole('button',{name:/오늘 개인위생 점검/}));
 const name=screen.getAllByPlaceholderText('성명')[0];fireEvent.change(name,{target:{value:'고정 원문'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));
 expect(name).toBeDisabled();expect(screen.getByRole('button',{name:/오늘 개인위생 점검/})).toBeDisabled();
 await act(async()=>finish('saved'));
});
it('관리자 확인 대기 중 행 편집과 저장을 함께 잠근다',async()=>{
 let finish!:()=>void;m.update.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));
 render(<PersonalHygieneForm isAdmin canConfirm currentUser={{id:'u',name:'관리자'}}/>);
 act(()=>m.records?.({docs:[{id:'today',data:()=>({checkDate:todayStr(),rows:[{name:'작업자',checks:{건강:'O'},note:''}],inspector:'',revisionCount:0})}]}));
 fireEvent.click(screen.getByRole('button',{name:/오늘 개인위생 점검/}));fireEvent.click(screen.getByRole('button',{name:'관리자 확인'}));
 for(const input of screen.getAllByPlaceholderText('성명'))expect(input).toBeDisabled();expect(screen.getByRole('button',{name:/^저장/})).toBeDisabled();await act(async()=>finish());
});

it('저장 거절은 초안을 보존하고 한국어 안내 뒤 명시 재시도한다',async()=>{
 m.add.mockRejectedValueOnce({code:'unavailable'});render(<PersonalHygieneForm isAdmin currentUser={{id:'u',name:'관리자'}}/>);fireEvent.click(screen.getByRole('button',{name:/오늘 개인위생 점검/}));
 fireEvent.change(screen.getAllByPlaceholderText('성명')[0],{target:{value:'유지할 이름'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('네트워크');expect(screen.getAllByDisplayValue('유지할 이름')[0]).toBeEnabled();fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.add).toHaveBeenCalledTimes(2));
});
it('삭제 확인 대기 중 렌더없이 실제 UID가 바뀌면 삭제하지 않는다',async()=>{
 let finish!:(value:boolean)=>void;m.confirm.mockImplementation(()=>new Promise<boolean>(resolve=>{finish=resolve;}));
 render(<PersonalHygieneForm isAdmin currentUser={{id:'u',name:'관리자'}}/>);act(()=>m.records?.({docs:[{id:'past',data:()=>({checkDate:'2020-01-01',rows:[],revisionCount:0})}]}));
 fireEvent.click(screen.getByRole('button',{name:/이전 점검 기록/}));fireEvent.click(screen.getByText('2020-01-01').parentElement!.querySelector('button')!);m.auth.currentUser={uid:'other'};await act(async()=>finish(true));expect(m.del).not.toHaveBeenCalled();
});
it('조회 오류 뒤 재구독 성공하며 이전 구독의 늦은 값은 현재 기록에 나타나지 않는다',()=>{
 render(<PersonalHygieneForm isAdmin/>);fireEvent.click(screen.getByRole('button',{name:/이전 점검 기록/}));const previous=m.subs[0];act(()=>previous.error(new Error('offline')));expect(screen.queryByText('이전 기록이 없습니다')).toBeNull();expect(screen.queryByText('미작성')).toBeNull();expect(screen.getByText('조회 필요')).toBeTruthy();expect(screen.getByRole('button',{name:/오늘 개인위생 점검/})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'다시 조회'}));
 expect(screen.getByRole('button',{name:/오늘 개인위생 점검/})).toBeEnabled();act(()=>previous.next({docs:[{id:'late',data:()=>({checkDate:'2000-01-01',rows:[],revisionCount:0})}]}));expect(screen.queryByText('2000-01-01')).toBeNull();
});

it.each(['collection','doc'])('현재cache%s는송신을막는다',kind=>{render(<PersonalHygieneForm isAdmin currentUser={{id:'u',name:'작성자'}}/>);fireEvent.click(screen.getByRole('button',{name:/오늘 개인위생 점검/}));act(()=>{const sub=m.subs.find(s=>s.source.kind===kind);sub.next(kind==='collection'?{docs:[],metadata:{fromCache:true}}:{exists:()=>true,data:()=>({cols:['건강']}),metadata:{fromCache:true}});});fireEvent.click(screen.getByRole('button',{name:'저장'}));expect(m.add).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'저장'})).toBeDisabled();});
it('정상ACK뒤오늘재선택은확정ID로수정한다',async()=>{render(<PersonalHygieneForm isAdmin currentUser={{id:'u',name:'작성자'}}/>);const open=()=>fireEvent.click(screen.getByRole('button',{name:/오늘 개인위생 점검/}));open();fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.add).toHaveBeenCalledOnce());await waitFor(()=>expect(screen.getByRole('button',{name:'저장'})).toBeEnabled());expect(screen.getByRole('button',{name:/오늘 개인위생 점검/})).toHaveTextContent('Rev.0 저장됨');open();fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.update).toHaveBeenCalledWith('haccp_personal_hygiene','new',expect.objectContaining({revisionCount:1})));expect(m.add).toHaveBeenCalledOnce();});
it('server정본resolve뒤본인이름주입이이중resolve로사라지지않는다',async()=>{
 render(<PersonalHygieneForm currentUser={{id:'u',name:'본인'}}/>);act(()=>m.records?.({docs:[{id:'existing',data:()=>({checkDate:todayStr(),rows:[{name:'',checks:{건강:''},note:''},{name:'다른사람',checks:{건강:''},note:''}],inspector:'',revisionCount:0})}]}));fireEvent.click(screen.getByRole('button',{name:/오늘 개인위생 점검/}));expect(screen.getAllByText('본인').length).toBeGreaterThan(0);fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.update).toHaveBeenCalledWith('haccp_personal_hygiene','existing',expect.objectContaining({rows:[expect.objectContaining({name:'본인'}),expect.objectContaining({name:'다른사람'})]})));
});
it('cache안내retry는실구독을교체하고옛callback·누락metadata를정본으로쓰지않는다',()=>{
 render(<PersonalHygieneForm isAdmin/>);const old=m.subs.find(s=>s.source.kind==='collection');act(()=>old.next({docs:[],metadata:{fromCache:true}}));expect(screen.getByRole('status')).toHaveTextContent('확인 중');fireEvent.click(screen.getByRole('button',{name:'다시 조회'}));expect(m.unsub).toHaveBeenCalledTimes(2);act(()=>old.next({docs:[],metadata:{fromCache:true}}));expect(screen.getByRole('button',{name:/오늘 개인위생 점검/})).toBeEnabled();const current=m.subs.filter(s=>s.source.kind==='collection').at(-1);act(()=>current.next({docs:[],metadata:undefined}));expect(screen.getByRole('button',{name:/오늘 개인위생 점검/})).toBeDisabled();act(()=>current.next({docs:[],metadata:{fromCache:false,hasPendingWrites:true}}));expect(screen.getByRole('button',{name:/오늘 개인위생 점검/})).toBeEnabled();
});

import {readFileSync} from 'node:fs';
import{createHash}from'node:crypto';
import * as ts from'typescript';
const editorDomainPreserved=(text:string)=>{
 const file=ts.createSourceFile('form.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),out:Record<string,string>={};
 const names=new Set(['emptyPersonalRecord','defaultTempRows','filledRows','allChecked','myRowIdx','canEditRow','toggleCheck','setRowField','addRow','revLabel','isReadOnly','pastRecords','update']);
 const hash=(key:string,node:ts.Node)=>{out[key]=createHash('sha256').update(node.getText(file).replace(/\r\n/g,'\n')).digest('hex');};
 const visit=(node:ts.Node,scope='')=>{if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer){const name=node.name.text;if(names.has(name))hash(name,node.initializer);if(['handleSave','handleConfirm'].includes(name))scope=name;if(['handleSave','handleConfirm'].includes(scope)&&['data','update','upd','now','userName'].includes(name))hash(scope+':'+name,node.initializer);}if(ts.isJsxElement(node)&&node.openingElement.attributes.properties.some(a=>ts.isJsxAttribute(a)&&a.name.getText(file)==='ref'&&a.initializer?.getText(file)==='{printRef}'))hash('printRefPDF',node);ts.forEachChild(node,c=>visit(c,scope));};visit(file);return out;
};
it('허용editor연결밖도메인·payload·PDFoldAST보존',()=>expect(editorDomainPreserved(readFileSync('src/features/haccp/ui/PersonalHygieneForm.tsx','utf8'))).toEqual({
  "emptyPersonalRecord": "dae2d50a783ea5c0363699aa49209564a5d28b340884c745d2d5d5e0743d5e57",
  "isReadOnly": "4f31912621c9eb5c3f80265c11a17eb6149f711b0e75883c802cfffbbdda6065",
  "filledRows": "2b79d09d4d9bc886751138062ff4297af232d2c4a5b58a772fe42139d2eff214",
  "allChecked": "bcca9fdbb82593f2aebbf1e065d781d18986dc2aa6a6d71df85bca9b681116de",
  "myRowIdx": "048e306bdc73ef0a284f48bb0b2f8151cbc3d917654aea88998a774231310392",
  "canEditRow": "3a22de3f4dcbf3002d1ebda25c8f4188a7be4084dc4d0561a4b0c37595b02a13",
  "toggleCheck": "469c49bb8cc93394cda5364543f8ea3ef1a2ecd74838b120baaa949bd0064fd1",
  "setRowField": "86ae9e2d9533719eadfb9cefaa4235aadc98a3bfbf74ca3bc47424b5e51285d2",
  "addRow": "b8f023385b8928b47a397f419dba99d47722f4e2ba2306789dc1307fdb128afe",
  "revLabel": "3c860ea894f02aa8c486a54281451151125525095f85b54943c8f78a2c86ab79",
  "handleSave:now": "c3b9a00586a0c69c38799a013a999abea28ca2bccd7793a4b699be0ca103b3c4",
  "handleSave:userName": "2b1992e6ddcd85779420d239aa027eceee0f9ac628bd341312f87d7b42043060",
  "handleSave:data": "feedd33dbc5f30e35e8674f0cef9e74d2faa75162b29051d66b64a5de82e46d8",
  "update": "4cdbbf364560832019122e5738505425a43fdc6c0cc28b6376b8391887bd562a",
  "handleSave:update": "c70ade805d4a7df1dbcef829bcca6dd9e76f800f981fc17876b977a64568d66e",
  "handleConfirm:now": "c3b9a00586a0c69c38799a013a999abea28ca2bccd7793a4b699be0ca103b3c4",
  "handleConfirm:userName": "0faa609927b8d86194cd0c310b0d8cf5329e005e92fec4062807ecf2cca6eeb9",
  "handleConfirm:update": "4cdbbf364560832019122e5738505425a43fdc6c0cc28b6376b8391887bd562a",
  "pastRecords": "a5d180142bb9448b0e9de64c2de5af3589e8d4124ba756ce4676bfbb397856cb",
  "printRefPDF": "f4fbde76cd49262a50d23ca7f88ed06d4d33d5ecb5d6aa5a1acb4149c27a4595"
}));

