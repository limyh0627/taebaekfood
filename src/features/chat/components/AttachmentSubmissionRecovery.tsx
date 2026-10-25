import React from 'react';
import {fileSizeLabel} from '../../../shared/chatUpload';
import {officeTalkStamp} from '../../../shared/officeTalkTime';
import ModalShell from '../../../shared/components/ModalShell';
import type {ChatMessage} from '../../../../types';
import type {AttachmentSubmissionAttempt} from '../hooks/useOfficeTalkComposer';
interface Props {
    attempts:readonly AttachmentSubmissionAttempt[];
    open:boolean;
    onOpen:()=>void;
    onClose:()=>void;
    onRead:(id:string)=>void|Promise<void>;
    onDismissConfirmed:(id:string)=>void;
}
function Content({message}:{message:ChatMessage}){
    const images=message.images?.length?message.images:message.imageUrl?[message.imageUrl]:[];
    return <><p className="whitespace-pre-wrap break-words">{message.text||'본문 없음'}</p>
        {message.replyTo&&<p>답장: {message.replyTo.senderName} · {message.replyTo.text}</p>}
        {images.map((url,index)=><a key={index} href={url} target="_blank" rel="noopener noreferrer" className="block underline">사진 {index+1} 확인</a>)}
        {message.fileUrl&&<a href={message.fileUrl} target="_blank" rel="noopener noreferrer" className="block underline">{message.fileName||'첨부 파일'}{message.fileSize!==undefined?' · '+fileSizeLabel(message.fileSize):''}</a>}
    </>;
}
/** 조회/소유 판단은 composer가 맡고 이 모듈은 현재 보관 원문만 표시한다. */
export default function AttachmentSubmissionRecovery({attempts,open,onOpen,onClose,onRead,onDismissConfirmed}:Props){
    if(!attempts.length)return null;
    return <><button type="button" onClick={onOpen} className="mb-2 rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">첨부 전송 확인 {attempts.length}</button>
        {open&&<ModalShell title="첨부 전송 확인" onClose={onClose} footer={<button type="button" onClick={onClose} className="rounded border px-3 py-2">닫기</button>}>
            <p className="mb-3 text-sm text-slate-600">원문과 파일 주소는 현재 화면에서만 보관합니다. 닫아도 전송은 취소되지 않으며 새로고침 뒤 복구는 보장하지 않습니다.</p>
            <div className="space-y-4">{attempts.map(attempt=><section key={attempt.message.id} aria-label={'첨부 요청 '+attempt.message.id} className="break-words border-t border-slate-200 pt-3 text-sm text-slate-700">
                <p>요청 번호: {attempt.message.id}</p><p>최초 전송: {officeTalkStamp(attempt.message.createdAt).label}</p><Content message={attempt.message}/>
                <p role="status" className="my-2">{attempt.notice}</p>
                {attempt.result?.kind==='found'&&<div aria-label="현재 등록된 메시지" className="my-2 border-l border-slate-200 pl-3"><p>현재 등록된 메시지</p><Content message={attempt.result.record}/></div>}
                <button type="button" disabled={attempt.reading} onClick={()=>void onRead(attempt.message.id)} className="rounded border px-3 py-2 disabled:opacity-40">{attempt.reading?'확인 중…':attempt.result?'다시 조회':'메시지 저장 여부 확인'}</button>
                {attempt.matches&&<button type="button" disabled={attempt.reading} onClick={()=>onDismissConfirmed(attempt.message.id)} className="ml-2 rounded border px-3 py-2 disabled:opacity-40">확인한 전송 닫기</button>}
            </section>)}</div>
        </ModalShell>}
    </>;
}
