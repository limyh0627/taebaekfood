/** @vitest-environment jsdom */
import React from 'react';
import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import DocumentManager from './DocumentManager';
const service=vi.hoisted(()=>({subscribeToCollection:vi.fn(),fetchCollection:vi.fn(),addItem:vi.fn(),updateItem:vi.fn(),deleteItem:vi.fn()}));
const dialog=vi.hoisted(()=>({appConfirm:vi.fn(),appPrompt:vi.fn()}));
vi.mock('../src/shared/services/firebaseService',()=>service);
vi.mock('../src/shared/components/appDialog',()=>dialog);
const testAuth=vi.hoisted(()=>({currentUser:{uid:'document-auth-uid'}}));
vi.mock('../src/shared/firebase',()=>({storage:{},auth:testAuth}));
const transfer=vi.hoisted(()=>({assertCurrent:vi.fn(),uploadFile:vi.fn(),getFileUrl:vi.fn(),createMetadata:vi.fn(),deleteMetadata:vi.fn(),cleanupStorage:vi.fn()}));
vi.mock('../src/features/documents/infrastructure/documentTransfers',async importOriginal=>{
 const actual=await importOriginal<typeof import('../src/features/documents/infrastructure/documentTransfers')>();return {...actual,createDocumentTransferPort:()=>transfer};
});
const pending=()=>{let resolve!:(value:any)=>void;const promise=new Promise<any>(done=>{resolve=done;});return {resolve,promise};};
beforeEach(()=>{vi.clearAllMocks();testAuth.currentUser.uid='document-auth-uid';dialog.appConfirm.mockReset();dialog.appPrompt.mockReset();transfer.assertCurrent.mockResolvedValue(undefined);transfer.uploadFile.mockResolvedValue(undefined);transfer.getFileUrl.mockResolvedValue('https://example.com/fixed');transfer.createMetadata.mockResolvedValue(undefined);transfer.deleteMetadata.mockResolvedValue(undefined);transfer.cleanupStorage.mockResolvedValue(undefined);});
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
async function openAdd(action:'대분류'|'중분류') {
 const cat={id:'cat-A',companyId:'taebaek',name:'자료',order:0,createdAt:'2026-10-01'};
 service.fetchCollection.mockResolvedValue([cat]);service.subscribeToCollection.mockImplementation((collection:string,callback:(rows:unknown[])=>void)=>{callback(collection==='fileCabinetCategories'?[cat]:[]);return ()=>{};});
 const view=render(<DocumentManager currentUser={{id:'A',name:'태백',companyId:'taebaek'}} />);
 fireEvent.click(await screen.findByRole('button',{name:action==='대분류'?'대분류 추가':'중분류 추가'}));return view;
}
it.each(['대분류','중분류'] as const)('문서함 %s 추가의 늦은 완료가 새 회사 초안을 비우거나 폼을 닫지 않는다',async action=>{
 const save=pending();service.addItem.mockReturnValue(save.promise);const view=await openAdd(action);const placeholder=action==='대분류'?'대분류명':'중분류명';
 fireEvent.change(screen.getByPlaceholderText(placeholder),{target:{value:'A 추가'}});fireEvent.keyDown(screen.getByPlaceholderText(placeholder),{key:'Enter'});expect(service.addItem).toHaveBeenCalledOnce();
 view.rerender(<DocumentManager currentUser={{id:'B',name:'풍회',companyId:'punghoe'}} />);fireEvent.change(screen.getByPlaceholderText(placeholder),{target:{value:'B 초안'}});await act(async()=>save.resolve('saved-A'));
 expect(screen.getByPlaceholderText(placeholder)).toHaveValue('B 초안');
});
it.each(['대분류','중분류'] as const)('현재 회사 문서함 %s 추가는 정상 완료 후 입력창을 닫는다',async action=>{
 const save=pending();service.addItem.mockReturnValue(save.promise);await openAdd(action);const placeholder=action==='대분류'?'대분류명':'중분류명';
 fireEvent.change(screen.getByPlaceholderText(placeholder),{target:{value:' 새 분류 '}});fireEvent.keyDown(screen.getByPlaceholderText(placeholder),{key:'Enter'});
 expect(service.addItem).toHaveBeenCalledWith(action==='대분류'?'fileCabinetCategories':'fileCabinetSubCategories',expect.objectContaining({name:'새 분류',companyId:'taebaek',...(action==='중분류'?{category:'자료'}:{})}));
 await act(async()=>save.resolve('saved'));expect(screen.queryByPlaceholderText(placeholder)).not.toBeInTheDocument();expect(screen.getByRole('button',{name:action==='대분류'?'대분류 추가':'중분류 추가'})).toBeInTheDocument();
});
it.each(['대분류','중분류'] as const)('문서함 %s 추가는 A→B→A 복귀 후에도 이전 완료로 초안을 지우지 않는다',async action=>{
 const save=pending();service.addItem.mockReturnValue(save.promise);const view=await openAdd(action);const placeholder=action==='대분류'?'대분류명':'중분류명';fireEvent.change(screen.getByPlaceholderText(placeholder),{target:{value:'옛 요청'}});fireEvent.keyDown(screen.getByPlaceholderText(placeholder),{key:'Enter'});
 view.rerender(<DocumentManager currentUser={{id:'B',name:'풍회',companyId:'punghoe'}} />);view.rerender(<DocumentManager currentUser={{id:'A',name:'태백',companyId:'taebaek'}} />);fireEvent.change(screen.getByPlaceholderText(placeholder),{target:{value:'새 세션 초안'}});await act(async()=>save.resolve('saved'));expect(screen.getByPlaceholderText(placeholder)).toHaveValue('새 세션 초안');
});

async function openFiles(){
 const cat={id:'cat-A',companyId:'taebaek',name:'자료',order:0,createdAt:'2026-10-01'},sub={id:'sub-A',companyId:'taebaek',name:'계약',category:'자료',order:0,createdAt:'2026-10-01'};
 const doc={id:'doc-A',companyId:'taebaek' as const,category:'자료',subCategory:'계약',fileName:'태백.pdf',size:1,contentType:'application/pdf',uploadedBy:'태백',uploadedAt:'2026-10-01',downloadUrl:'https://example.com/original',storagePath:'companies/taebaek/file-cabinet/자료/계약/original',note:''};
 service.fetchCollection.mockResolvedValue([cat]);service.subscribeToCollection.mockImplementation((name:string,callback:(rows:unknown[])=>void)=>{callback(name==='fileCabinetCategories'?[cat]:name==='fileCabinetSubCategories'?[sub]:[doc]);return()=>{};});
 const view=render(<DocumentManager currentUser={{id:'employee-A',name:'태백',companyId:'taebaek'}}/>);fireEvent.click(await screen.findByRole('button',{name:/계약/}));return {view,doc};
}
it('URL 재시도는 최초 파일·분류·고정 번호를 보존하며 업로드 ACK를 다시 보내지 않는다',async()=>{
 transfer.getFileUrl.mockRejectedValueOnce(new Error('URL 실패'));await openFiles();const file=new File(['pdf'],'새 계약.pdf',{type:'application/pdf'});
 const input=screen.getByLabelText('문서 파일 첨부');fireEvent.change(input,{target:{files:[file]}});
 const retry=await screen.findByRole('button',{name:/새 계약.pdf.*주소 받기 다시 시도/});expect(input).toHaveValue('');expect(transfer.uploadFile).toHaveBeenCalledOnce();
 const first=transfer.uploadFile.mock.calls[0][0];fireEvent.click(screen.getByRole('button',{name:'전체'}));fireEvent.click(retry);
 await waitFor(()=>expect(transfer.createMetadata).toHaveBeenCalledOnce());expect(transfer.uploadFile).toHaveBeenCalledOnce();expect(transfer.createMetadata.mock.calls[0][0]).toBe(first);expect(first).toMatchObject({file,category:'자료',subCategory:'계약',uploadedBy:'태백',scope:{actorUid:'document-auth-uid',employeeId:'employee-A'}});await waitFor(()=>expect(screen.queryByRole('region',{name:'처리 중이거나 확인이 필요한 문서'})).toBeNull());
});
it('목록 등록 미확인은 원문 작업과 안내만 남기고 재등록 버튼 없이 무관 파일을 허용한다',async()=>{
 transfer.createMetadata.mockRejectedValueOnce(new Error('ACK 유실'));await openFiles();fireEvent.change(screen.getByLabelText('문서 파일 첨부'),{target:{files:[new File(['a'],'미확인.pdf')]}});
 const panel=await screen.findByRole('region',{name:'처리 중이거나 확인이 필요한 문서'});await waitFor(()=>expect(panel).toHaveTextContent('목록 등록 결과를 확인하지 못했습니다'));expect(within(panel).queryByRole('button')).toBeNull();expect(screen.getByRole('button',{name:'파일 선택'})).toBeEnabled();
 fireEvent.change(screen.getByLabelText('문서 파일 첨부'),{target:{files:[new File(['b'],'다른 파일.pdf')]}});await waitFor(()=>expect(transfer.createMetadata).toHaveBeenCalledTimes(2));expect(panel).toHaveTextContent('미확인.pdf');expect(panel).not.toHaveTextContent('다른 파일.pdf');
});
it('삭제 목록 ACK 뒤 파일 정리 실패는 파일만 재시도하고 같은 문서 재삭제를 숨긴다',async()=>{
 dialog.appConfirm.mockResolvedValue(true);transfer.cleanupStorage.mockRejectedValueOnce(new Error('정리 실패'));const {doc}=await openFiles();fireEvent.click(screen.getByTitle('삭제'));
 const retry=await screen.findByRole('button',{name:'태백.pdf · doc-A · 파일 정리 다시 시도'});expect(transfer.deleteMetadata).toHaveBeenCalledOnce();expect(screen.queryByTitle('삭제')).toBeNull();expect(screen.getByRole('region',{name:'처리 중이거나 확인이 필요한 문서'})).toHaveTextContent('목록은 삭제됐지만');
 fireEvent.click(retry);await waitFor(()=>expect(screen.queryByRole('region',{name:'처리 중이거나 확인이 필요한 문서'})).toBeNull());expect(transfer.deleteMetadata).toHaveBeenCalledOnce();expect(transfer.cleanupStorage).toHaveBeenCalledTimes(2);expect(transfer.cleanupStorage.mock.calls[1][0]).toBe(doc.storagePath);
});
it('삭제 목록 미확인은 파일을 지우거나 다시 삭제하지 않고 현재 목록 확인을 안내한다',async()=>{
 dialog.appConfirm.mockResolvedValue(true);transfer.deleteMetadata.mockRejectedValueOnce(new Error('응답 유실'));await openFiles();fireEvent.click(screen.getByTitle('삭제'));
 const panel=await screen.findByRole('region',{name:'처리 중이거나 확인이 필요한 문서'});await waitFor(()=>expect(panel).toHaveTextContent('목록 삭제 결과를 확인하지 못해'));expect(transfer.cleanupStorage).not.toHaveBeenCalled();expect(within(panel).queryByRole('button')).toBeNull();expect(screen.queryByTitle('삭제')).toBeNull();
});

it('주소 ACK 뒤 계정 전환으로 미송신한 목록 등록만 원계정에서 이어간다',async()=>{
 const url=pending();transfer.getFileUrl.mockReturnValueOnce(url.promise);const {view}=await openFiles();fireEvent.change(screen.getByLabelText('문서 파일 첨부'),{target:{files:[new File(['a'],'대기 파일.pdf')]}});await waitFor(()=>expect(transfer.getFileUrl).toHaveBeenCalledOnce());const first=transfer.uploadFile.mock.calls[0][0];
 testAuth.currentUser.uid='other-auth';view.rerender(<DocumentManager currentUser={{id:'employee-B',name:'다른 직원',companyId:'taebaek'}}/>);await act(async()=>url.resolve('https://example.com/fixed'));expect(transfer.createMetadata).not.toHaveBeenCalled();expect(screen.queryByRole('region',{name:'처리 중이거나 확인이 필요한 문서'})).toBeNull();
 testAuth.currentUser.uid='document-auth-uid';view.rerender(<DocumentManager currentUser={{id:'employee-A',name:'태백',companyId:'taebaek'}}/>);fireEvent.click(await screen.findByRole('button',{name:/대기 파일.pdf.*목록 등록 이어하기/}));await waitFor(()=>expect(transfer.createMetadata).toHaveBeenCalledOnce());expect(transfer.createMetadata.mock.calls[0][0]).toBe(first);expect(transfer.uploadFile).toHaveBeenCalledOnce();expect(transfer.getFileUrl).toHaveBeenCalledOnce();
});
