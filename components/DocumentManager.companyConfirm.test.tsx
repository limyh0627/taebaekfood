/** @vitest-environment jsdom */
import React from 'react';
import {act,fireEvent,render,screen} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import DocumentManager from './DocumentManager';
const service=vi.hoisted(()=>({subscribeToCollection:vi.fn(),fetchCollection:vi.fn(),addItem:vi.fn(),updateItem:vi.fn(),deleteItem:vi.fn()}));
const dialog=vi.hoisted(()=>({appConfirm:vi.fn(),appPrompt:vi.fn()}));
vi.mock('../src/shared/services/firebaseService',()=>service);
vi.mock('../src/shared/components/appDialog',()=>dialog);
vi.mock('../src/shared/firebase',()=>({storage:{}}));
const pending=()=>{let resolve!:(value:any)=>void;const promise=new Promise<any>(done=>{resolve=done;});return {resolve,promise};};
beforeEach(()=>{vi.clearAllMocks();dialog.appConfirm.mockReset();dialog.appPrompt.mockReset();});
async function open(action:'메모'|'대분류'|'중분류') {
 const cat={id:'cat-A',companyId:'taebaek',name:'자료',order:0,createdAt:'2026-10-01'};
 const sub={id:'sub-A',companyId:'taebaek',name:'계약',category:'자료',order:0,createdAt:'2026-10-01'};
 const doc={id:'doc-A',companyId:'taebaek',category:'자료',subCategory:'',fileName:'태백.pdf',size:1,contentType:'application/pdf',uploadedBy:'태백',uploadedAt:'2026-10-01',downloadUrl:'',storagePath:'',note:'기존 메모'};
 service.fetchCollection.mockResolvedValue([cat]);
 service.subscribeToCollection.mockImplementation((collection:string,callback:(rows:unknown[])=>void)=>{callback(collection==='fileCabinetCategories'?[cat]:collection==='fileCabinetSubCategories'?(action==='중분류'?[sub]:[]):action==='메모'?[doc]:[]);return ()=>{};});
 const view=render(<DocumentManager currentUser={{id:'A',name:'태백',companyId:'taebaek'}} />);
 if(action==='메모')fireEvent.click(await screen.findByRole('button',{name:'메모'}));
 else if(action==='대분류')fireEvent.click(await screen.findByTitle('빈 대분류 지우기'));
 else{fireEvent.click(await screen.findByRole('button',{name:/계약/}));fireEvent.click(screen.getByTitle('빈 중분류 지우기'));}
 return view;
}
it.each(['메모','대분류','중분류'] as const)('문서함 %s 확인 중 회사가 바뀌면 이전 저장을 시작하지 않는다',async action=>{
 const request=pending();dialog.appConfirm.mockReturnValue(request.promise);dialog.appPrompt.mockReturnValue(request.promise);const view=await open(action);
 view.rerender(<DocumentManager currentUser={{id:'B',name:'풍회',companyId:'punghoe'}} />);await act(async()=>request.resolve(action==='메모'?'새 메모':true));
 expect(service.updateItem).not.toHaveBeenCalled();expect(service.deleteItem).not.toHaveBeenCalled();
});
it.each(['메모','대분류','중분류'] as const)('문서함 %s 확인은 A→B→A 복귀와 화면 종료 뒤에도 이전 요청을 무효화한다',async action=>{
 const request=pending();dialog.appConfirm.mockReturnValue(request.promise);dialog.appPrompt.mockReturnValue(request.promise);const view=await open(action);
 view.rerender(<DocumentManager currentUser={{id:'B',name:'풍회',companyId:'punghoe'}} />);view.rerender(<DocumentManager currentUser={{id:'A',name:'태백',companyId:'taebaek'}} />);await act(async()=>request.resolve(action==='메모'?'늦은 메모':true));expect(service.updateItem).not.toHaveBeenCalled();expect(service.deleteItem).not.toHaveBeenCalled();
});
it.each(['메모','대분류','중분류'] as const)('문서함 %s 확인 중 화면 종료는 저장을 시작하지 않는다',async action=>{
 const request=pending();dialog.appConfirm.mockReturnValue(request.promise);dialog.appPrompt.mockReturnValue(request.promise);const view=await open(action);view.unmount();await act(async()=>request.resolve(action==='메모'?'메모':true));expect(service.updateItem).not.toHaveBeenCalled();expect(service.deleteItem).not.toHaveBeenCalled();
});
it.each(['메모','대분류','중분류'] as const)('현재 회사 문서함 %s 승인은 기존 저장 인수를 유지한다',async action=>{
 const request=pending();dialog.appConfirm.mockReturnValue(request.promise);dialog.appPrompt.mockReturnValue(request.promise);await open(action);await act(async()=>request.resolve(action==='메모'?' 메모 원문 ':true));
 if(action==='메모')expect(service.updateItem).toHaveBeenCalledWith('fileCabinetDocs','doc-A',{note:' 메모 원문 '});else expect(service.deleteItem).toHaveBeenCalledWith(action==='대분류'?'fileCabinetCategories':'fileCabinetSubCategories',action==='대분류'?'cat-A':'sub-A');
});
it.each(['메모','대분류','중분류'] as const)('현재 회사 문서함 %s 확인 취소는 저장하지 않는다',async action=>{
 const request=pending();dialog.appConfirm.mockReturnValue(request.promise);dialog.appPrompt.mockReturnValue(request.promise);await open(action);await act(async()=>request.resolve(action==='메모'?null:false));expect(service.updateItem).not.toHaveBeenCalled();expect(service.deleteItem).not.toHaveBeenCalled();
});
