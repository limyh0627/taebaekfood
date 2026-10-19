/** @vitest-environment jsdom */
import React from 'react';
import { webcrypto } from 'node:crypto';
import { decodeCatalogValue } from '../functions/src/shared/catalogOrderReferenceProof';
import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import DocumentManager from './DocumentManager';
import {assertDocumentFileIdentity,documentFileSha256} from '../src/features/documents/infrastructure/documentTransfers';
const service=vi.hoisted(()=>({subscribeToCollection:vi.fn(),fetchCollection:vi.fn(),addItem:vi.fn(),updateItem:vi.fn(),deleteItem:vi.fn()}));
const dialog=vi.hoisted(()=>({appConfirm:vi.fn(),appPrompt:vi.fn()}));
vi.mock('../src/shared/services/firebaseService',()=>service);
vi.mock('../src/shared/components/appDialog',()=>dialog);
const authState=vi.hoisted(()=>({listeners:new Set<(user:{uid:string}|null)=>void>()}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_auth:unknown,listener:(user:{uid:string}|null)=>void)=>{authState.listeners.add(listener);listener(testAuth.currentUser);return()=>{authState.listeners.delete(listener);};}}));
const testAuth=vi.hoisted(()=>({currentUser:{uid:'document-auth-uid'}}));
vi.mock('../src/shared/firebase',()=>({storage:{},auth:testAuth,authReady:Promise.resolve()}));
const transfer=vi.hoisted(()=>({assertCurrent:vi.fn(),uploadFile:vi.fn(),getFileUrl:vi.fn(),createMetadata:vi.fn(),deleteMetadata:vi.fn(),cleanupStorage:vi.fn(),uploadReservedFile:vi.fn()}));
vi.mock('../src/features/documents/infrastructure/documentTransfers',async importOriginal=>{
 const actual=await importOriginal<typeof import('../src/features/documents/infrastructure/documentTransfers')>();return {...actual,createDocumentTransferPort:()=>transfer};
});

const metadata=vi.hoisted(()=>({prepare:vi.fn(),open:vi.fn(),command:vi.fn(),list:vi.fn(),listPending:vi.fn(),discard:vi.fn(),read:vi.fn(),noteWrite:vi.fn(),entries:new Map<string,any>(),documents:new Map<string,any>(),uploads:new Map<string,any>()}));
vi.mock('../src/features/documents/infrastructure/documentMetadataWrites',async importOriginal=>({...await importOriginal<typeof import('../src/features/documents/infrastructure/documentMetadataWrites')>(),documentMetadataWrites:metadata}));
Object.defineProperty(globalThis,'crypto',{configurable:true,value:webcrypto});
Object.defineProperty(File.prototype,'arrayBuffer',{configurable:true,value:function(){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsArrayBuffer(this);});}});
const pending=()=>{let resolve!:(value:any)=>void;const promise=new Promise<any>(done=>{resolve=done;});return {resolve,promise};};
beforeEach(()=>{vi.clearAllMocks();testAuth.currentUser.uid='document-auth-uid';dialog.appConfirm.mockReset();dialog.appPrompt.mockReset();transfer.assertCurrent.mockReset().mockResolvedValue(undefined);transfer.uploadFile.mockReset().mockResolvedValue(undefined);transfer.getFileUrl.mockReset().mockResolvedValue('https://example.com/fixed');transfer.createMetadata.mockReset().mockResolvedValue(undefined);transfer.deleteMetadata.mockReset().mockResolvedValue(undefined);transfer.cleanupStorage.mockReset().mockResolvedValue(undefined);});

beforeEach(()=>{
 metadata.command.mockReset();metadata.prepare.mockReset();metadata.open.mockReset();metadata.list.mockReset();metadata.listPending.mockReset();metadata.discard.mockReset();metadata.read.mockReset();metadata.entries.clear();metadata.documents.clear();metadata.uploads.clear();metadata.noteWrite.mockResolvedValue(undefined);
 metadata.listPending.mockImplementation(async scope=>({version:1,...scope,entries:[],nextCursor:null}));
 metadata.list.mockImplementation(async scope=>[...metadata.entries.values()].filter(entry=>entry.scope.companyId===scope.companyId&&entry.scope.actorUid===scope.actorUid&&entry.scope.employeeId===scope.employeeId));
 metadata.read.mockImplementation(async(_scope,reference)=>metadata.entries.get(reference.planId)??{key:reference.planId,reference,readable:false,status:'corrupt',description:'사본 없음',observedLocalText:'{"body":null,"sidecar":null}'});
 metadata.prepare.mockImplementation(async(scope,request,description)=>{const entry={key:request.reference.planId,reference:request.reference,request,description,readable:true,status:'valid',requestHash:'a'.repeat(64),observedLocalText:JSON.stringify(request),scope};metadata.entries.set(entry.key,entry);return entry;});
 metadata.open.mockImplementation(async(scope,reference,opening)=>{metadata.documents.set(reference.documentId,decodeCatalogValue(opening,{special:()=>undefined,timestamp:(seconds,nanos)=>({seconds,nanos}),reference:path=>path,geo:(latitude,longitude)=>({latitude,longitude}),bytes:values=>values}));return {reference,actorUid:scope.actorUid,employeeId:scope.employeeId,snapshot:opening,expectedVersion:'1:000000001'};});
 transfer.uploadReservedFile.mockImplementation(async(file,identity,context)=>{await assertDocumentFileIdentity(file,identity);const request=[...metadata.entries.values()].find(entry=>entry.request.upload?.uploadId===identity.uploadId)?.request;const plan={...request?.metadata,file,fileName:file.name,documentId:request?.reference.documentId,path:identity.path,scope:context.scope};metadata.uploads.set(identity.uploadId,plan);await transfer.uploadFile(plan,context);});
 metadata.command.mockImplementation(async(scope,input,mode)=>{
  const entry=input.request?input:metadata.entries.get(input.planId),request=entry?.request,reference=entry?.reference??input;
  let status='active',uploadStatus=request?.action==='create'?'reserved':'not-required',cleanupStatus='not-required',message='파일 전송 준비 확인';
  if(mode==='inspect'){status=entry?.result?.status??'unknown';uploadStatus=request?.action==='create'?(metadata.uploads.has(request.upload.uploadId)?'verified':entry?.result?.uploadStatus??'absent'):'not-required';cleanupStatus=entry?.result?.cleanupStatus??'not-required';message='서버 결과를 확인했습니다.';}
  if(mode==='apply'){
   if(request.action==='create')await transfer.createMetadata(metadata.uploads.get(request.upload.uploadId)??request,'서버에서 확인한 URL');
   else if(request.action==='delete')await transfer.deleteMetadata(metadata.documents.get(reference.documentId));
   else if(request.action==='note')await metadata.noteWrite(request);
   status='applied';uploadStatus=request.action==='create'?'verified':'not-required';cleanupStatus=request.action==='delete'?'pending':'not-required';message=request.action==='delete'?'목록 삭제는 확인됐지만 파일 정리가 남았습니다.':'문서 정보 반영 확인';
  }
  if(mode==='cancel'){status='cancelled';uploadStatus='absent';cleanupStatus='absent';message='적용 전 요청 중단 확인';}
  if(mode==='cleanup'){await transfer.cleanupStorage(metadata.documents.get(reference.documentId)?.storagePath??request?.upload?.path);status=entry?.result?.status??'applied';uploadStatus=request?.action==='create'?'verified':'not-required';cleanupStatus='deleted';message='파일 정리 완료';}
  const result={version:1,reference,actorUid:scope.actorUid,employeeId:scope.employeeId,requestHash:entry?.requestHash??null,status,uploadStatus,cleanupStatus,message};
  if(entry)entry.result=result;if(['applied','cancelled','rejected'].includes(status)&&cleanupStatus!=='pending')metadata.entries.delete(reference.planId);
  return {result,copyMismatch:false,cleanupFailed:false,message};
 });
 metadata.discard.mockImplementation(async(_scope,reference,observed)=>{const entry=metadata.entries.get(reference.planId);if(!entry||entry.observedLocalText!==observed)return {status:'blocked',message:'관측 사본 변경'};metadata.entries.delete(reference.planId);return {status:'cleared',message:'이 기기 사본만 정리했습니다.'};});
});
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
 if(action==='메모'){expect(metadata.prepare).toHaveBeenCalledWith(expect.any(Object),expect.objectContaining({action:'note',note:' 메모 원문 '}),expect.any(String),expect.any(Function));expect(service.updateItem).not.toHaveBeenCalled();}else expect(service.deleteItem).toHaveBeenCalledWith(action==='대분류'?'fileCabinetCategories':'fileCabinetSubCategories',action==='대분류'?'cat-A':'sub-A');
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
it('업로드 ACK 유실 조회 뒤 이어하기는 최초 파일·분류·고정 번호를 보존하며 업로드를 다시 보내지 않는다',async()=>{
 transfer.uploadFile.mockRejectedValueOnce(new Error('업로드 ACK 유실'));await openFiles();const file=new File(['pdf'],'새 계약.pdf',{type:'application/pdf'});
 const input=screen.getByLabelText('문서 파일 첨부');fireEvent.change(input,{target:{files:[file]}});
 const inspect=await screen.findByRole('button',{name:/새 계약.pdf.*결과 확인/});expect(input).toHaveValue('');await waitFor(()=>expect(transfer.uploadFile).toHaveBeenCalledOnce());
 const first=transfer.uploadFile.mock.calls[0][0];fireEvent.click(screen.getByRole('button',{name:'전체'}));fireEvent.click(inspect);
 fireEvent.click(await screen.findByRole('button',{name:/새 계약.pdf.*같은 요청 이어하기/}));
 await waitFor(()=>expect(transfer.createMetadata).toHaveBeenCalledOnce());expect(transfer.uploadFile).toHaveBeenCalledOnce();expect(transfer.createMetadata.mock.calls[0][0]).toBe(first);expect(first).toMatchObject({file,category:'자료',subCategory:'계약',uploadedBy:'태백',scope:{actorUid:'document-auth-uid',employeeId:'employee-A'}});await waitFor(()=>expect(screen.queryByRole('region',{name:'처리 중이거나 확인이 필요한 문서'})).toBeNull());
});
it('목록 등록 미확인은 결과 확인·중단만 제공하고 원문 재등록 없이 무관 파일을 허용한다',async()=>{
 transfer.createMetadata.mockRejectedValueOnce(new Error('ACK 유실'));await openFiles();fireEvent.change(screen.getByLabelText('문서 파일 첨부'),{target:{files:[new File(['a'],'미확인.pdf')]}});
 const panel=await screen.findByRole('region',{name:'처리 중이거나 확인이 필요한 문서'});await waitFor(()=>expect(transfer.createMetadata).toHaveBeenCalledOnce());expect(within(panel).getByRole('button',{name:/미확인.pdf.*결과 확인/})).toBeEnabled();expect(within(panel).queryByRole('button',{name:/미확인.pdf.*같은 요청 이어하기/})).toBeNull();expect(screen.getByRole('button',{name:'파일 선택'})).toBeEnabled();
 fireEvent.change(screen.getByLabelText('문서 파일 첨부'),{target:{files:[new File(['b'],'다른 파일.pdf')]}});await waitFor(()=>expect(transfer.createMetadata).toHaveBeenCalledTimes(2));expect(panel).toHaveTextContent('미확인.pdf');expect(panel).not.toHaveTextContent('다른 파일.pdf');
});
it('삭제 목록 ACK 뒤 파일 정리 실패는 결과를 조회한 뒤 파일만 다시 정리하고 문서 삭제를 반복하지 않는다',async()=>{
 dialog.appConfirm.mockResolvedValue(true);transfer.cleanupStorage.mockRejectedValueOnce(new Error('정리 실패'));const {doc}=await openFiles();fireEvent.click(screen.getByTitle('삭제'));
 let cleanup=await screen.findByRole('button',{name:'태백.pdf · 삭제 · doc-A · 남은 파일 정리'});expect(transfer.deleteMetadata).toHaveBeenCalledOnce();expect(screen.queryByTitle('삭제')).toBeNull();
 const panel=screen.getByRole('region',{name:'처리 중이거나 확인이 필요한 문서'});expect(panel).toHaveTextContent('문서 정보: 반영 확인');expect(panel).toHaveTextContent('파일 정리: 정리 대기');
 fireEvent.click(cleanup);await waitFor(()=>expect(transfer.cleanupStorage).toHaveBeenCalledOnce());
 fireEvent.click(await screen.findByRole('button',{name:'태백.pdf · 삭제 · doc-A · 결과 확인'}));cleanup=await screen.findByRole('button',{name:'태백.pdf · 삭제 · doc-A · 남은 파일 정리'});fireEvent.click(cleanup);
 await waitFor(()=>expect(screen.queryByRole('region',{name:'처리 중이거나 확인이 필요한 문서'})).toBeNull());expect(transfer.deleteMetadata).toHaveBeenCalledOnce();expect(transfer.cleanupStorage).toHaveBeenCalledTimes(2);expect(transfer.cleanupStorage.mock.calls[1][0]).toBe(doc.storagePath);
});
it('삭제 목록 미확인은 파일을 지우거나 다시 삭제하지 않고 같은 요청 결과 확인을 제공한다',async()=>{
 dialog.appConfirm.mockResolvedValue(true);transfer.deleteMetadata.mockRejectedValueOnce(new Error('응답 유실'));await openFiles();fireEvent.click(screen.getByTitle('삭제'));
 const panel=await screen.findByRole('region',{name:'처리 중이거나 확인이 필요한 문서'});await waitFor(()=>expect(transfer.deleteMetadata).toHaveBeenCalledOnce());expect(transfer.cleanupStorage).not.toHaveBeenCalled();expect(within(panel).getByRole('button',{name:/태백.pdf.*결과 확인/})).toBeEnabled();expect(within(panel).queryByRole('button',{name:/같은 요청 이어하기/})).toBeNull();expect(screen.queryByTitle('삭제')).toBeNull();
});

it('업로드 ACK 뒤 계정 전환으로 미송신한 목록 등록만 원계정에서 조회하고 이어간다',async()=>{
 const uploaded=pending();transfer.uploadFile.mockReturnValueOnce(uploaded.promise);const {view}=await openFiles();fireEvent.change(screen.getByLabelText('문서 파일 첨부'),{target:{files:[new File(['a'],'대기 파일.pdf')]}});await waitFor(()=>expect(transfer.uploadFile).toHaveBeenCalledOnce());const first=transfer.uploadFile.mock.calls[0][0];
 testAuth.currentUser.uid='other-auth';view.rerender(<DocumentManager currentUser={{id:'employee-B',name:'다른 직원',companyId:'taebaek'}}/>);await act(async()=>{authState.listeners.forEach(listener=>listener(testAuth.currentUser));uploaded.resolve(undefined);});expect(transfer.createMetadata).not.toHaveBeenCalled();expect(screen.queryByRole('region',{name:'처리 중이거나 확인이 필요한 문서'})).toBeNull();
 testAuth.currentUser.uid='document-auth-uid';view.rerender(<DocumentManager currentUser={{id:'employee-A',name:'태백',companyId:'taebaek'}}/>);await act(async()=>authState.listeners.forEach(listener=>listener(testAuth.currentUser)));
 fireEvent.click(await screen.findByRole('button',{name:/대기 파일.pdf.*결과 확인/}));fireEvent.click(await screen.findByRole('button',{name:/대기 파일.pdf.*같은 요청 이어하기/}));await waitFor(()=>expect(transfer.createMetadata).toHaveBeenCalledOnce());expect(transfer.createMetadata.mock.calls[0][0]).toBe(first);expect(transfer.uploadFile).toHaveBeenCalledOnce();
});

async function retainedUpload(file:File){
 const reference={companyId:'taebaek' as const,planId:'retained-plan',documentId:'retained-doc'},scope={companyId:'taebaek',actorUid:'document-auth-uid',employeeId:'employee-A'};
 const request={version:1,reference,action:'create',metadata:{category:'자료',subCategory:'계약',fileName:file.name,note:'',uploadedBy:'태백',uploadedAt:'2026-10-19T01:00:00.000Z'},upload:{uploadId:'retained-upload',path:'companies/taebaek/file-cabinet/uploads/retained-upload/'+file.name,sha256:await documentFileSha256(file),size:file.size,contentType:file.type||'application/octet-stream'}};
 const result={version:1,reference,actorUid:scope.actorUid,employeeId:scope.employeeId,requestHash:'a'.repeat(64),status:'active',uploadStatus:'absent',cleanupStatus:'not-required',message:'최초 파일을 다시 선택해 주세요.'};
 const entry={key:'retained-key',reference,request,requestHash:'a'.repeat(64),description:file.name,readable:true,status:'valid',observedLocalText:'관측한 원래 body와 ref',scope,result};metadata.entries.set(entry.key,entry);
 // mock 저장 key와 ref 조회 key를 실제 journal의동일plan에맞춘다.
 metadata.entries.delete(entry.key);entry.key=reference.planId;metadata.entries.set(entry.key,entry);return entry;
}
it('재시작 보관 업로드는 같은 SHA File을 명시 선택하고 입력을 비운 뒤 원문 분류로만 이어간다',async()=>{
 const original=new File(['original'],'원본.pdf',{type:'application/pdf'});await retainedUpload(original);await openFiles();
 const choose=await screen.findByLabelText('원본.pdf · retained-doc · 같은 SHA 파일 다시 선택');
 fireEvent.change(choose,{target:{files:[new File(['wrong'],'다른.pdf',{type:'application/pdf'})]}});await waitFor(()=>expect(screen.getByRole('region',{name:'처리 중이거나 확인이 필요한 문서'})).toHaveTextContent('처음 선택한 파일과'));expect(transfer.uploadFile).not.toHaveBeenCalled();expect(choose).toHaveValue('');
 fireEvent.click(screen.getByRole('button',{name:'원본.pdf · retained-doc · 결과 확인'}));const retry=await screen.findByLabelText('원본.pdf · retained-doc · 같은 SHA 파일 다시 선택');fireEvent.click(screen.getByRole('button',{name:'전체'}));fireEvent.change(retry,{target:{files:[original]}});
 await waitFor(()=>expect(transfer.createMetadata).toHaveBeenCalledOnce());expect(transfer.uploadFile).toHaveBeenCalledOnce();expect(transfer.createMetadata.mock.calls[0][0]).toMatchObject({file:original,category:'자료',subCategory:'계약',documentId:'retained-doc'});expect(retry).toHaveValue('');
});
it('문서 메모도 typed 원문으로 저장하고 ACK 유실 뒤 같은 요청 조회만 연결한다',async()=>{
 metadata.noteWrite.mockRejectedValueOnce(new Error('메모 ACK 유실'));dialog.appPrompt.mockResolvedValue(' 메모 원문 ');await openFiles();fireEvent.click(screen.getByRole('button',{name:'메모'}));
 await waitFor(()=>expect(metadata.noteWrite).toHaveBeenCalledOnce());expect(metadata.noteWrite).toHaveBeenCalledWith(expect.objectContaining({action:'note',note:' 메모 원문 ',expectedVersion:'1:000000001'}));expect(service.updateItem).not.toHaveBeenCalled();
 const job=[...metadata.entries.values()][0];job.result={...job.result,status:'applied',uploadStatus:'not-required',cleanupStatus:'not-required'};
 fireEvent.click(await screen.findByRole('button',{name:/태백.pdf.*결과 확인/}));await waitFor(()=>expect(screen.queryByRole('region',{name:'처리 중이거나 확인이 필요한 문서'})).toBeNull());expect(metadata.noteWrite).toHaveBeenCalledOnce();
});
it('다른 사본의 실제 서버 완료는 관측한 사본 정리만 제공하고 현재 문서·분류를 바꾸지 않는다',async()=>{
 const entry=await retainedUpload(new File(['old'],'다른 사본.pdf'));
 metadata.command.mockResolvedValueOnce({result:{...entry.result,status:'applied',uploadStatus:'verified',cleanupStatus:'not-required'},copyMismatch:true,cleanupFailed:false,message:'서버 원요청은 완료됐지만 다른 사본입니다.'});await openFiles();
 const panel=await screen.findByRole('region',{name:'처리 중이거나 확인이 필요한 문서'});await waitFor(()=>expect(panel).toHaveTextContent('다른 사본입니다.'));expect(panel).toHaveTextContent('문서 정보: 반영 확인');expect(within(panel).queryByRole('button',{name:/같은 요청 이어하기/})).toBeNull();
 fireEvent.click(within(panel).getByRole('button',{name:/이 기기 사본 정리/}));await waitFor(()=>expect(metadata.discard).toHaveBeenCalledWith(expect.any(Object),entry.reference,entry.observedLocalText,expect.any(Function),entry.key));
 expect(screen.getByText('태백.pdf')).toBeInTheDocument();expect(screen.getByRole('button',{name:/계약/})).toBeInTheDocument();expect(service.deleteItem).not.toHaveBeenCalled();expect(transfer.createMetadata).not.toHaveBeenCalled();
});
it('실제 UID 구독 전환만으로 옛 문서 job을 숨기고 새 계정에 완료 안내를 섞지 않는다',async()=>{
 await retainedUpload(new File(['old'],'이전 계정.pdf'));await openFiles();await screen.findByText('이전 계정.pdf');
 await act(async()=>{testAuth.currentUser.uid='new-uid';authState.listeners.forEach(listener=>listener(testAuth.currentUser));});
 await waitFor(()=>expect(screen.queryByRole('region',{name:'처리 중이거나 확인이 필요한 문서'})).toBeNull());expect(metadata.entries.size).toBe(1);
 await act(async()=>{testAuth.currentUser.uid='document-auth-uid';authState.listeners.forEach(listener=>listener(testAuth.currentUser));});await screen.findByText('이전 계정.pdf');
});
it('삭제 확인 대기에는 중복 삭제·메모를 잠그고 취소하면 업무 요청을 만들지 않는다',async()=>{
 const confirm=pending();dialog.appConfirm.mockReturnValue(confirm.promise);await openFiles();fireEvent.click(screen.getByTitle('삭제'));await waitFor(()=>expect(screen.getByTitle('삭제')).toBeDisabled());expect(screen.getByRole('button',{name:'메모'})).toBeDisabled();
 await act(async()=>confirm.resolve(false));expect(metadata.prepare).not.toHaveBeenCalled();expect(transfer.deleteMetadata).not.toHaveBeenCalled();expect(screen.getByTitle('삭제')).toBeEnabled();
});
it('hideDocs는 파일 작업과 복구 영역을 감추고 기존 분류 임베딩만 유지한다',async()=>{
 const cat={id:'cat-A',companyId:'taebaek',name:'자료',order:0,createdAt:'2026-10-01'};service.fetchCollection.mockResolvedValue([cat]);service.subscribeToCollection.mockImplementation((collection,cb)=>{cb(collection==='fileCabinetCategories'?[cat]:[]);return()=>{};});
 render(<DocumentManager currentUser={{id:'employee-A',name:'태백',companyId:'taebaek'}} hideDocs/>);expect(await screen.findByRole('button',{name:/자료/})).toBeInTheDocument();expect(screen.queryByLabelText('문서 파일 첨부')).toBeNull();expect(screen.queryByRole('button',{name:'파일 선택'})).toBeNull();
});

it('최초 보관 요청 조회 대기·실패에는 신규 문서 작업을 잠그고 같은 목록 재조회로 복구한다',async()=>{
 const read=pending();metadata.list.mockReturnValueOnce(read.promise);const {view}=await openFiles();expect(screen.getByLabelText('문서 파일 첨부')).toBeDisabled();expect(screen.getByRole('button',{name:'메모'})).toBeDisabled();
 await act(async()=>read.resolve([]));await waitFor(()=>expect(screen.getByLabelText('문서 파일 첨부')).toBeEnabled());view.unmount();
 metadata.list.mockRejectedValueOnce(new Error('보관 요청 읽기 실패'));await openFiles();expect(await screen.findByRole('alert')).toHaveTextContent('보관 요청 읽기 실패');expect(screen.getByLabelText('문서 파일 첨부')).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'보관 요청 다시 읽기'}));await waitFor(()=>expect(screen.getByLabelText('문서 파일 첨부')).toBeEnabled());expect(metadata.prepare).not.toHaveBeenCalled();expect(transfer.uploadFile).not.toHaveBeenCalled();
});

it('요청 준비의 미송신 거절은 행이 없어도 원인을 남기며 문서 목록 조회 실패로 잠그지 않는다',async()=>{
 metadata.open.mockRejectedValueOnce(new Error('문서 원문이 바뀌었습니다. 다시 열어 주세요.'));dialog.appPrompt.mockResolvedValue('새 메모');await openFiles();
 fireEvent.click(screen.getByRole('button',{name:'메모'}));
 expect(await screen.findByText('문서 원문이 바뀌었습니다. 다시 열어 주세요.')).toHaveAttribute('role','status');
 expect(metadata.prepare).not.toHaveBeenCalled();expect(screen.queryByRole('alert')).toBeNull();expect(screen.getByRole('button',{name:'파일 선택'})).toBeEnabled();
});

function pendingServerResult(status:'active'|'applied'|'cancelled'='active',cleanupStatus:'not-required'|'pending'='not-required'){
 return {version:1 as const,reference:{companyId:'taebaek' as const,planId:'server-plan',documentId:'server-doc'},actorUid:'document-auth-uid',employeeId:'employee-A',requestHash:'b'.repeat(64),status,uploadStatus:'absent' as const,cleanupStatus,message:'서버에 남은 요청입니다.'};
}
it('로컬 원문이 없는 서버 요청은 결과 확인·중단만 제공하고 빈 페이지의 다음 cursor도 확인한다',async()=>{
 const result=pendingServerResult(),nextCursor='c'.repeat(64);metadata.listPending.mockImplementation(async(scope,cursor)=>({version:1,...scope,entries:cursor?[{result,label:'서버 계약.pdf'}]:[],nextCursor:cursor?null:nextCursor}));
 await openFiles();expect(await screen.findByText('더 확인할 요청이 있습니다.')).toBeInTheDocument();expect(screen.queryByText(/모든.*완료/)).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'다음 요청 확인'}));const panel=await screen.findByRole('region',{name:'처리 중이거나 확인이 필요한 문서'});
 expect(panel).toHaveTextContent('서버 계약.pdf');expect(within(panel).getByRole('button',{name:/결과 확인/})).toBeEnabled();expect(within(panel).getByRole('button',{name:/미처리 요청 중단/})).toBeEnabled();
 expect(within(panel).queryByRole('button',{name:/같은 요청 이어하기|이 기기 사본 정리/})).toBeNull();expect(within(panel).queryByLabelText(/같은 SHA/)).toBeNull();
 expect(metadata.listPending).toHaveBeenCalledWith(expect.objectContaining({actorUid:'document-auth-uid',employeeId:'employee-A'}),nextCursor,expect.any(Function));
 metadata.command.mockResolvedValueOnce({result:{...result,status:'cancelled',cleanupStatus:'absent'},message:'미처리 요청 중단 확인',copyMismatch:false,cleanupFailed:false});
 fireEvent.click(within(panel).getByRole('button',{name:/미처리 요청 중단/}));await waitFor(()=>expect(metadata.command).toHaveBeenCalledWith(expect.any(Object),result.reference,'cancel',expect.any(Function)));expect(metadata.prepare).not.toHaveBeenCalled();expect(transfer.uploadFile).not.toHaveBeenCalled();
});
it('서버에서 문서 반영이 끝나고 파일 정리만 남은 요청은 정리만 실행한다',async()=>{
 const result=pendingServerResult('applied','pending');metadata.listPending.mockImplementation(async scope=>({version:1,...scope,entries:[{result,label:'정리 대기.pdf'}],nextCursor:null}));await openFiles();
 const panel=await screen.findByRole('region',{name:'처리 중이거나 확인이 필요한 문서'});expect(panel).toHaveTextContent('문서 정보: 반영 확인');expect(within(panel).queryByRole('button',{name:/같은 요청 이어하기|미처리 요청 중단/})).toBeNull();
 metadata.command.mockResolvedValueOnce({result:{...result,cleanupStatus:'deleted'},message:'파일 정리 완료',copyMismatch:false,cleanupFailed:false});fireEvent.click(within(panel).getByRole('button',{name:/남은 파일 정리/}));
 await waitFor(()=>expect(metadata.command).toHaveBeenCalledWith(expect.any(Object),result.reference,'cleanup',expect.any(Function)));expect(metadata.prepare).not.toHaveBeenCalled();expect(transfer.createMetadata).not.toHaveBeenCalled();
});
it('같은 reference의 로컬·서버 요청은 한 행으로 합치고 서버 조회 실패는 새로 조회할 수 있다',async()=>{
 const entry=await retainedUpload(new File(['old'],'같은 요청.pdf'));metadata.listPending.mockImplementation(async scope=>({version:1,...scope,entries:[{result:entry.result,label:'서버 중복 이름.pdf'}],nextCursor:null}));await openFiles();
 const panel=await screen.findByRole('region',{name:'처리 중이거나 확인이 필요한 문서'});expect(within(panel).getAllByText(/문서 번호:/)).toHaveLength(1);expect(panel).toHaveTextContent('같은 요청.pdf');
 metadata.listPending.mockRejectedValueOnce(new Error('서버 요청 조회 실패'));fireEvent.click(screen.getByRole('button',{name:'서버 미완료 요청 새로 조회'}));expect(await screen.findByRole('alert')).toHaveTextContent('서버 요청 조회 실패');
 fireEvent.click(screen.getByRole('button',{name:'서버 미완료 요청 새로 조회'}));await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());
});
