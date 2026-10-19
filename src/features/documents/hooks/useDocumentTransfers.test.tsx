// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { CabinetDoc } from '../../../shared/types';
import { useDocumentTransfers } from './useDocumentTransfers';
import { createDocumentTransferPort, DocumentTransferNotStartedError } from '../infrastructure/documentTransfers';
const auth = vi.hoisted(() => ({currentUser:{uid:'A'}}));
vi.mock('../../../shared/firebase',()=>({auth}));
vi.mock('../../../shared/components/appDialog',()=>({appConfirm:vi.fn(async()=>true)}));
vi.mock('../infrastructure/documentTransfers',()=>{ class NotStarted extends Error {} return {
 DocumentTransferNotStartedError:NotStarted,isDocumentTransferNotStarted:(error:unknown)=>error instanceof NotStarted,
 createDocumentTransferPlan:(scope:unknown,file:File,category:string,subCategory:string,uploadedBy:string)=>({scope,file,category,subCategory,uploadedBy,documentId:crypto.randomUUID(),path:`fixed/${crypto.randomUUID()}`,uploadedAt:'fixed-date'}),
 createDocumentTransferPort:()=>({assertCurrent:vi.fn(async()=>{}),uploadFile:vi.fn(async()=>{}),getFileUrl:vi.fn(async()=>'url'),createMetadata:vi.fn(async()=>{}),deleteMetadata:vi.fn(async()=>{}),cleanupStorage:vi.fn(async()=>{})})
};});
const file=()=>new File(['a'],'원문.pdf',{type:'application/pdf'});
const doc={id:'doc',fileName:'삭제.pdf',storagePath:'fixed/delete',category:'업무용',subCategory:'원문',companyId:'taebaek'} as CabinetDoc;
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};}
beforeEach(()=>{auth.currentUser.uid='A';});
it('업로드 실패는 같은 File·ID·경로·분류 원문으로 재시도한다',async()=>{
 const ports=createDocumentTransferPort();vi.mocked(ports.uploadFile).mockRejectedValueOnce(Error('upload'));const {result}=renderHook(()=>useDocumentTransfers({companyId:'taebaek',employeeId:'employee',actorUid:'A',uploadedBy:'작성자',ports}));const input=file();
 await act(()=>result.current.startUploads([input],'원분류','원중분류'));const job=result.current.jobs[0];expect(job.stage).toBe('upload');await act(()=>result.current.retry(job.jobId));
 const first=vi.mocked(ports.uploadFile).mock.calls[0][0],second=vi.mocked(ports.uploadFile).mock.calls[1][0];expect(second).toBe(first);expect(first.file).toBe(input);expect(first.category).toBe('원분류');expect(result.current.jobs).toHaveLength(0);
});
it('URL 실패는 업로드 ACK를 재송신하지 않는다',async()=>{
 const ports=createDocumentTransferPort();vi.mocked(ports.getFileUrl).mockRejectedValueOnce(Error('url'));const {result}=renderHook(()=>useDocumentTransfers({companyId:'taebaek',employeeId:'employee',actorUid:'A',uploadedBy:'작성자',ports}));
 await act(()=>result.current.startUploads([file()],'c','s'));expect(result.current.jobs[0].stage).toBe('url');await act(()=>result.current.retry(result.current.jobs[0].jobId));expect(ports.uploadFile).toHaveBeenCalledOnce();expect(ports.getFileUrl).toHaveBeenCalledTimes(2);
});
it('목록 등록 미확정은 재송신하지 않고 무관 파일은 허용한다',async()=>{
 const ports=createDocumentTransferPort();vi.mocked(ports.createMetadata).mockRejectedValueOnce(Error('lost'));const {result}=renderHook(()=>useDocumentTransfers({companyId:'taebaek',employeeId:'employee',actorUid:'A',uploadedBy:'작성자',ports}));
 await act(()=>result.current.startUploads([file()],'c','s'));const job=result.current.jobs[0];expect(job.stage).toBe('unknown');expect(job.canRetry).toBe(false);expect(job.message).toContain('미등록을 확정할 수 없습니다');await act(()=>result.current.retry(job.jobId));expect(ports.createMetadata).toHaveBeenCalledOnce();await act(()=>result.current.startUploads([file()],'다른','분류'));expect(ports.createMetadata).toHaveBeenCalledTimes(2);expect(result.current.jobs).toHaveLength(1);
});
it('삭제 metadata 미확정이면 파일을 지우거나 본문을 다시 삭제하지 않는다',async()=>{
 const ports=createDocumentTransferPort();vi.mocked(ports.deleteMetadata).mockRejectedValueOnce(Error('lost'));const {result}=renderHook(()=>useDocumentTransfers({companyId:'taebaek',employeeId:'employee',actorUid:'A',uploadedBy:'작성자',ports}));
 await act(()=>result.current.deleteDocument(doc));expect(ports.cleanupStorage).not.toHaveBeenCalled();await act(()=>result.current.retry(result.current.jobs[0].jobId));await act(()=>result.current.deleteDocument(doc));expect(ports.deleteMetadata).toHaveBeenCalledOnce();
});
it('삭제 ACK 뒤 파일 실패는 동일 경로 정리만 재시도한다',async()=>{
 const ports=createDocumentTransferPort();vi.mocked(ports.cleanupStorage).mockRejectedValueOnce(Error('storage'));const {result}=renderHook(()=>useDocumentTransfers({companyId:'taebaek',employeeId:'employee',actorUid:'A',uploadedBy:'작성자',ports}));
 await act(()=>result.current.deleteDocument(doc));expect(result.current.jobs[0].stage).toBe('cleanup');await act(()=>result.current.retry(result.current.jobs[0].jobId));expect(ports.deleteMetadata).toHaveBeenCalledOnce();expect(vi.mocked(ports.cleanupStorage).mock.calls.map(call=>call[0])).toEqual(['fixed/delete','fixed/delete']);
});
it('삭제 확인 대기 중 UID 전환이면 송신하지 않는다',async()=>{
 const ports=createDocumentTransferPort(),gate=deferred<boolean>();const {result,rerender}=renderHook(({uid})=>useDocumentTransfers({companyId:'taebaek',employeeId:'employee',actorUid:uid,uploadedBy:'작성자',ports,confirm:()=>gate.promise}),{initialProps:{uid:'A'}});let run!:Promise<void>;act(()=>{run=result.current.deleteDocument(doc);});auth.currentUser.uid='B';rerender({uid:'B'});await act(async()=>{gate.resolve(true);await run;});expect(ports.deleteMetadata).not.toHaveBeenCalled();
});
it('늦은 업로드 ACK는 새 scope 후속 송신0·원 scope 복귀 뒤 URL부터 이어진다',async()=>{
 const ports=createDocumentTransferPort(),gate=deferred<void>();vi.mocked(ports.uploadFile).mockImplementationOnce(()=>gate.promise);const {result,rerender}=renderHook(({uid})=>useDocumentTransfers({companyId:'taebaek',employeeId:'employee',actorUid:uid,uploadedBy:'작성자',ports}),{initialProps:{uid:'A'}});let run!:Promise<void>;act(()=>{run=result.current.startUploads([file()],'c','s');});await act(async()=>{await Promise.resolve();});auth.currentUser.uid='B';rerender({uid:'B'});await act(async()=>{gate.resolve();await run;});expect(ports.getFileUrl).not.toHaveBeenCalled();expect(result.current.jobs).toHaveLength(0);auth.currentUser.uid='A';rerender({uid:'A'});expect(result.current.jobs[0].stage).toBe('url');await act(()=>result.current.retry(result.current.jobs[0].jobId));expect(ports.uploadFile).toHaveBeenCalledOnce();
});
it('여러 파일은 각각의 busy로 처리되어 이전 finally가 새 작업을 풀지 않는다',async()=>{
 const ports=createDocumentTransferPort(),old=deferred<void>(),fresh=deferred<void>();vi.mocked(ports.uploadFile).mockImplementationOnce(()=>old.promise).mockImplementationOnce(()=>fresh.promise);const {result}=renderHook(()=>useDocumentTransfers({companyId:'taebaek',employeeId:'employee',actorUid:'A',uploadedBy:'작성자',ports}));let a!:Promise<void>,b!:Promise<void>;act(()=>{a=result.current.startUploads([file()],'c','s');});act(()=>{b=result.current.startUploads([file()],'c2','s2');});await act(async()=>{await Promise.resolve();old.resolve();await a;});expect(result.current.jobs).toHaveLength(1);expect(result.current.jobs[0].busy).toBe(true);expect(result.current.jobs[0].category).toBe('c2');await act(async()=>{fresh.resolve();await b;});
});

it('같은 UID의 직원 전환은 숨겨진 이전 작업의 직접 재시도도 차단한다',async()=>{
 const ports=createDocumentTransferPort();vi.mocked(ports.uploadFile).mockRejectedValueOnce(Error('upload'));
 const {result,rerender}=renderHook(({employeeId})=>useDocumentTransfers({companyId:'taebaek',employeeId,actorUid:'A',uploadedBy:'작성자',ports}),{initialProps:{employeeId:'old'}});
 await act(()=>result.current.startUploads([file()],'c','s'));const id=result.current.jobs[0].jobId;rerender({employeeId:'new'});expect(result.current.jobs).toHaveLength(0);
 await act(()=>result.current.retry(id));expect(ports.uploadFile).toHaveBeenCalledOnce();rerender({employeeId:'old'});expect(result.current.jobs).toHaveLength(1);
});

it('URL ACK 뒤 미송신 metadata는 복귀 후 이어가고 URL을 다시 받지 않는다',async()=>{
 const ports=createDocumentTransferPort(),gate=deferred<string>();vi.mocked(ports.getFileUrl).mockImplementationOnce(()=>gate.promise);
 const {result,rerender}=renderHook(({uid})=>useDocumentTransfers({companyId:'taebaek',employeeId:'employee',actorUid:uid,uploadedBy:'작성자',ports}),{initialProps:{uid:'A'}});
 let run!:Promise<void>;act(()=>{run=result.current.startUploads([file()],'c','s');});await act(async()=>{await Promise.resolve();await Promise.resolve();});
 auth.currentUser.uid='B';rerender({uid:'B'});await act(async()=>{gate.resolve('fixed-url');await run;});expect(ports.createMetadata).not.toHaveBeenCalled();
 auth.currentUser.uid='A';rerender({uid:'A'});expect(result.current.jobs[0]).toMatchObject({stage:'metadata',canRetry:true,busy:false});
 await act(()=>result.current.retry(result.current.jobs[0].jobId));expect(ports.getFileUrl).toHaveBeenCalledOnce();expect(ports.createMetadata).toHaveBeenCalledOnce();expect(result.current.jobs).toHaveLength(0);
});

it('목록 송신 전 검증 거절은 원인과 미송신 단계를 유지한다',async()=>{
 const ports=createDocumentTransferPort();vi.mocked(ports.createMetadata).mockRejectedValueOnce(new DocumentTransferNotStartedError('관리자 직원 정보를 확인해 주세요.'));
 const {result}=renderHook(()=>useDocumentTransfers({companyId:'taebaek',employeeId:'employee',actorUid:'A',uploadedBy:'작성자',ports}));
 await act(()=>result.current.startUploads([file()],'c','s'));expect(result.current.jobs[0]).toMatchObject({stage:'metadata',canRetry:true});expect(result.current.jobs[0].message).toContain('관리자 직원 정보');
 await act(()=>result.current.retry(result.current.jobs[0].jobId));expect(ports.uploadFile).toHaveBeenCalledOnce();expect(ports.getFileUrl).toHaveBeenCalledOnce();expect(result.current.jobs).toHaveLength(0);
});
