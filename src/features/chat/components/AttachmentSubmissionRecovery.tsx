import React,{useState} from 'react';
import {fileSizeLabel} from '../../../shared/chatUpload';
import {officeTalkStamp} from '../../../shared/officeTalkTime';
import ModalShell from '../../../shared/components/ModalShell';
import {validChatCheckpoint,type ChatCheckpoint,type ChatUpload} from '../chatOwnedCheckpoint';
import type {ChatMessage} from '../../../../types';
import type {AttachmentSubmissionAttempt} from '../hooks/useOfficeTalkComposer';
interface Props {
 attempts:readonly AttachmentSubmissionAttempt[];open:boolean;onOpen:()=>void;onClose:()=>void;
 onRead:(id:string)=>void|Promise<void>;onDismissConfirmed:(id:string)=>void|Promise<void>;
 storageError?:string;checkpointText?:string;uploads?:readonly ChatUpload[];roomName?:(id:string)=>string|undefined;
 onRetry?:()=>Promise<unknown>;onReadCheckpoint?:()=>unknown;onRestore?:()=>Promise<unknown>;
 onCancelFiles?:()=>Promise<unknown>;onContinueFiles?:(id:string)=>Promise<unknown>;
}
function Content({message}:{message:ChatMessage}){
 const images=message.images?.length?message.images:message.imageUrl?[message.imageUrl]:[];
 return <><p className="whitespace-pre-wrap break-words">{message.text||'본문 없음'}</p>
  {message.replyTo&&<p>답장: {message.replyTo.senderName} · {message.replyTo.text}</p>}
  {images.map((url,index)=><a key={index} href={url} target="_blank" rel="noopener noreferrer" className="block underline">사진 {index+1} 확인</a>)}
  {message.fileUrl&&<a href={message.fileUrl} target="_blank" rel="noopener noreferrer" className="block underline">{message.fileName||'첨부 파일'}{message.fileSize!==undefined?' · '+fileSizeLabel(message.fileSize):''}</a>}
 </>;
}
function FileContent({upload}:{upload:ChatUpload}){
 return <><p className="whitespace-pre-wrap">{upload.text}</p>{upload.files.map((file,index)=><p key={index}>{file.name} · {fileSizeLabel(file.size)} · {file.confirmed?'메시지 전송 확인됨':file.url?'파일 주소 보관됨':file.state==='cancelled'?'선택 취소됨':'파일 재선택 또는 현재 화면에서 계속 필요'}</p>)}</>;
}
export default function AttachmentSubmissionRecovery({attempts,open,onOpen,onClose,onRead,onDismissConfirmed,storageError,checkpointText,uploads=[],roomName,onRetry,onReadCheckpoint,onRestore,onCancelFiles,onContinueFiles}:Props){
 const [stored,setStored]=useState<ChatCheckpoint|null>(null),[error,setError]=useState(''),[fallback,setFallback]=useState(false);
 const pendingUploads=uploads.filter(u=>!u.completed),count=attempts.length+pendingUploads.length;
 if(!count&&!storageError)return null;
 const action=async(run:()=>unknown|Promise<unknown>)=>{setError('');try{await run();}catch(e){setError((e instanceof Error?e.message:'작업을 진행하지 못했습니다.')+' 현재 원문은 보존했습니다. 다시 확인하거나 원문을 복사해 주세요.');}};
 const room=(id:string)=><><p>대화방: {roomName?.(id)||'현재 목록에서 이름을 확인하지 못한 대화방'}</p><p className="text-xs text-slate-500">대화방 번호: {id}</p></>;
 const copy=async()=>{try{if(!navigator.clipboard)throw Error();await navigator.clipboard.writeText(checkpointText??'');setFallback(false);}catch{setFallback(true);throw Error('자동으로 복사하지 못했습니다. 아래 원문을 직접 선택해 복사해 주세요.');}};
 return <><button type="button" onClick={onOpen} className="mb-2 rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">메시지 전송 확인 {count||1}</button>
  {open&&<ModalShell title="메시지 전송 확인" onClose={onClose} footer={<button type="button" onClick={onClose} className="rounded border px-3 py-2">닫기</button>}>
   <p className="mb-3 text-sm text-slate-600">같은 계정의 이 브라우저에 원문과 받은 파일 주소를 보관합니다. 조회 전에는 다시 보내지 않습니다. 닫아도 전송은 취소되지 않습니다. 선택한 파일 자체는 새로고침 뒤 다시 선택해야 합니다.</p>
   {(storageError||error)&&<div role="alert"><p>{error||storageError}</p><p>현재 입력과 전송 원문은 보존했습니다.</p></div>}
   <div className="mb-3 flex flex-wrap gap-2">
    <button type="button" onClick={()=>void action(copy)}>현재 입력 복사</button>
    <button type="button" onClick={()=>void action(()=>onRetry?.())}>다시 보관</button>
    <button type="button" onClick={()=>void action(()=>{const value=onReadCheckpoint?.();if(validChatCheckpoint(value))setStored(value);else throw Error('보관본을 읽지 못했습니다.');})}>보관본 다시 읽기</button>
    <button type="button" onClick={()=>void action(()=>onRestore?.())}>보관본 열기</button>
   </div>
   {fallback&&<label className="block">복사할 원문<textarea aria-label="복사할 원문" readOnly value={checkpointText??''} className="w-full border" onFocus={event=>event.target.select()}/></label>}
   {stored&&<section aria-label="읽은 보관본" className="mb-3 border-t py-2"><h3>기기에 보관된 작성 내용</h3><p className="whitespace-pre-wrap">{stored.draft.text||'작성 중인 본문 없음'}</p>{stored.draft.reply&&<p>답장: {stored.draft.reply.senderName} · {stored.draft.reply.text}</p>}<p>확인할 전송 {stored.packets.length}건 · 파일 선택 {stored.uploads.length}건</p>{stored.packets.map(packet=><div key={packet.message.id} className="border-t py-2">{room(packet.message.roomId)}<p>{packet.phase==='prepared'?'전송 준비 보관':packet.phase==='submitted'?'전송 결과 확인 필요':'전송 완료 응답 확인'}</p><Content message={packet.message}/><p className="text-xs">전송 번호: {packet.message.id}</p></div>)}{stored.uploads.map(upload=><div key={upload.id}>{room(upload.roomId)}<FileContent upload={upload}/></div>)}</section>}
   {pendingUploads.map(upload=><section key={upload.id} className="mb-3 border-t py-2">{room(upload.roomId)}<p>파일 선택</p><FileContent upload={upload}/><button type="button" onClick={()=>void action(()=>onContinueFiles?.(upload.id))}>현재 파일 업로드 계속</button><button type="button" onClick={()=>void action(()=>onCancelFiles?.())}>미시작 파일 선택 취소</button></section>)}
   <div className="space-y-4">{attempts.map(attempt=><section key={attempt.message.id} aria-label={'메시지 요청 '+attempt.message.id} className="break-words border-t border-slate-200 pt-3 text-sm text-slate-700">
    {room(attempt.message.roomId)}<p className="text-xs">요청 번호: {attempt.message.id}</p><p>최초 전송: {officeTalkStamp(attempt.message.createdAt).label}</p><Content message={attempt.message}/>
    <p role="status" className="my-2">{attempt.notice}</p>
    {attempt.result?.kind==='found'&&<div aria-label="현재 등록된 메시지" className="my-2 border-l border-slate-200 pl-3"><p>현재 등록된 메시지</p><Content message={attempt.result.record}/></div>}
    <button type="button" disabled={attempt.reading} onClick={()=>void action(()=>onRead(attempt.message.id))} className="rounded border px-3 py-2 disabled:opacity-40">{attempt.reading?'확인 중…':attempt.result?'다시 조회':'메시지 저장 여부 확인'}</button>
    {attempt.matches&&<button type="button" disabled={attempt.reading} onClick={()=>void action(()=>onDismissConfirmed(attempt.message.id))} className="ml-2 rounded border px-3 py-2 disabled:opacity-40">확인한 전송 닫기</button>}
   </section>)}</div>
  </ModalShell>}
 </>;
}
