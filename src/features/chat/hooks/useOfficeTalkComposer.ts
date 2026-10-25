import { useEffect, useRef, useState, type SetStateAction } from 'react';
import type { ChatMessage, Employee } from '../../../../types';
import { companyOf } from '../../../shared/types';
import { mentionedIds } from '../../../shared/mention';
import { replySnippet } from '../../../shared/messageActions';
import { uploadChatFile, imagePatch, type ChatAttachment } from '../../../shared/chatUpload';
import type {PendingSubmissionRead} from '../../../shared/services/pendingSubmissionRead';
export interface AttachmentSubmissionAttempt {
    readonly message:ChatMessage;
    readonly result:PendingSubmissionRead<ChatMessage>|null;
    readonly notice:string;
    readonly reading:boolean;
    readonly matches:boolean;
}
interface Options {
    getSignal:()=>AbortSignal;
    readMessage:(message:ChatMessage,signal:AbortSignal)=>Promise<PendingSubmissionRead<ChatMessage>>;
    getUid: () => string | undefined;
    roomId: string | null;
    currentUser: Employee;
    employees: Employee[];
    send: (message: ChatMessage) => void | Promise<unknown>;
    add: (message: ChatMessage) => void;
    remove: (id: string) => void;
    onError: (message: string) => void;
}
export function useOfficeTalkComposer(options: Options) {
    const [, paint] = useState(0), mounted = useRef(false), latest = useRef(options);
    latest.current = options;
    const make = () => ({ uid: options.getUid(), roomId: options.roomId, scope: companyOf(options.currentUser) + ':' + options.currentUser.id, text: '', reply: null as ChatMessage | null, revision: 0, upload: null as object | null, count: { done: 0, total: 0 } });
    const owner = useRef(make());
    const sameActor = owner.current.scope === companyOf(options.currentUser) + ':' + options.currentUser.id && owner.current.uid === options.getUid();
    if (!sameActor)
        owner.current = make();
    else if (owner.current.roomId !== options.roomId)
        owner.current = { ...make(), text: owner.current.text, reply: owner.current.reply, revision: owner.current.revision };
    const state = owner.current;
    const current = () => mounted.current && owner.current === state && !!state.uid && latest.current.getUid() === state.uid && !latest.current.getSignal().aborted;
    type Attempt={message:ChatMessage;signal:AbortSignal;sending:boolean;readRun:object|null;result:PendingSubmissionRead<ChatMessage>|null;notice:string;matches:boolean};
    const scope=companyOf(options.currentUser)+':'+options.currentUser.id;
    const recovery=useRef({scope,uid:options.getUid(),roomId:options.roomId,open:false,attempts:new Map<string,Attempt>()});
    if(recovery.current.scope!==scope||recovery.current.uid!==options.getUid())recovery.current={scope,uid:options.getUid(),roomId:options.roomId,open:false,attempts:new Map()};
    const retained=recovery.current;
    if(retained.roomId!==options.roomId){
        // 원문은 남기고 이전 방의 늦은 조회가 새 조회를 덮지 못하게 한다.
        for(const attempt of retained.attempts.values())attempt.readRun=null;
        retained.roomId=options.roomId;retained.open=false;
    }
    const actorCurrent=()=>mounted.current&&recovery.current===retained&&!!retained.uid&&latest.current.getUid()===retained.uid&&companyOf(latest.current.currentUser)+':'+latest.current.currentUser.id===retained.scope&&!latest.current.getSignal().aborted;
    const recoveryNotify=()=>{if(actorCurrent())paint(v=>v+1);};
    useEffect(()=>{
        const signal=options.getSignal();
        const abort=()=>{if(!mounted.current||recovery.current!==retained)return;retained.attempts.clear();retained.open=false;owner.current=make();if(latest.current.getUid()!==retained.uid)latest.current.onError('로그인 범위가 변경되었습니다. 대화 화면을 다시 열어 주세요.');paint(v=>v+1);};
        signal.addEventListener('abort',abort);return()=>signal.removeEventListener('abort',abort);
    },[retained,options.getSignal]);
    const readAttachment=async(id:string)=>{
        const attempt=retained.attempts.get(id);
        if(!current()||!actorCurrent()||!attempt||attempt.message.roomId!==state.roomId||attempt.sending||attempt.readRun||attempt.signal.aborted)return;
        const execution={};attempt.readRun=execution;attempt.result=null;attempt.matches=false;attempt.notice='첨부 메시지 저장 여부를 확인 중입니다.';recoveryNotify();
        const live=()=>actorCurrent()&&retained.attempts.get(id)===attempt&&!attempt.signal.aborted&&attempt.readRun===execution;
        try{
            let result=await latest.current.readMessage(JSON.parse(JSON.stringify(attempt.message)) as ChatMessage,attempt.signal);
            if(!live())return;
            if(result.kind==='found'&&(result.record.id!==id||result.record.companyId!==attempt.message.companyId||result.record.roomId!==attempt.message.roomId||result.record.senderId!==attempt.message.senderId))result={kind:'unconfirmed',reason:'현재 요청의 첨부 메시지를 확인하지 못했습니다.'};
            attempt.result=result.kind==='found'?{kind:'found',record:JSON.parse(JSON.stringify(result.record)) as ChatMessage}:result;
            attempt.matches=result.kind==='found'&&!attachmentDeleted(result.record)&&attachmentOriginal(result.record)===attachmentOriginal(attempt.message);
            attempt.notice=result.kind==='missing'?'현재 등록된 메시지를 찾지 못했습니다. 최초 전송의 미처리나 취소를 뜻하지 않습니다. 원문과 파일 주소를 보존했습니다. 다시 조회해 주세요.':result.kind==='unconfirmed'?result.reason:attachmentDeleted(result.record)?'삭제된 메시지입니다. 원문과 파일 주소를 보존했으며 다시 보내지 않았습니다.':attempt.matches?'현재 등록된 메시지가 최초 첨부 내용과 같습니다. 확인한 전송을 보관 목록에서 닫을 수 있습니다.':'현재 등록된 메시지가 최초 첨부 내용과 다릅니다. 원문과 파일 주소를 보존했으며 덮어쓰지 않았습니다. 다시 조회해 주세요.';
        }catch{if(live()){attempt.result={kind:'unconfirmed',reason:'조회하지 못했습니다. 원문과 파일 주소를 보존했습니다. 다시 조회해 주세요.'};attempt.matches=false;attempt.notice=attempt.result.reason;}}
        finally{if(live()){attempt.readRun=null;recoveryNotify();}}
    };
    const dismissConfirmedAttachment=(id:string)=>{
        const attempt=retained.attempts.get(id);
        if(!current()||!actorCurrent()||!attempt||attempt.message.roomId!==state.roomId||attempt.signal.aborted||attempt.sending||attempt.readRun||!attempt.matches||attempt.result?.kind!=='found'||attachmentDeleted(attempt.result.record)||attachmentOriginal(attempt.result.record)!==attachmentOriginal(attempt.message))return;
        retained.attempts.delete(id);if(![...retained.attempts.values()].some(row=>row.message.roomId===state.roomId&&!row.sending))retained.open=false;recoveryNotify();
    };
    const openAttachmentRecovery=()=>{if(current()&&actorCurrent()){retained.open=true;recoveryNotify();}};
    const closeAttachmentRecovery=()=>{if(current()&&actorCurrent()){retained.open=false;recoveryNotify();}};
    const notify = () => {
        if (current())
            paint(v => v + 1);
    };
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    const setText = (value: SetStateAction<string>) => {
        if (!current())
            return;
        state.text = typeof value === 'function' ? value(state.text) : value;
        state.revision++;
        notify();
    };
    const setReply = (value: ChatMessage | null) => {
        if (!current())
            return;
        state.reply = value;
        state.revision++;
        notify();
    };
    const capture = () => ({ text: state.text, reply: state.reply ? { ...state.reply } : null, roomId: state.roomId, user: { ...latest.current.currentUser }, employees: latest.current.employees.map(employee => ({ ...employee })), send: latest.current.send });
    const consume = () => {
        state.text = '';
        state.reply = null;
        state.revision++;
        notify();
        return state.revision;
    };
    const transmit = async (snapshot: ReturnType<typeof capture>, revision: number, attach?: ChatAttachment, photos?: Pick<ChatMessage, 'imageUrl' | 'images'>) => {
        if (!current() || !snapshot.roomId)
            return;
        const mentions = mentionedIds(snapshot.text, snapshot.employees);
        const message: ChatMessage = { id: `MSG-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`, companyId: companyOf(snapshot.user), roomId: snapshot.roomId, senderId: snapshot.user.id, senderName: snapshot.user.name, text: snapshot.text, createdAt: new Date().toISOString(), ...(attach?.isImage ? { imageUrl: attach.url } : {}), ...(attach && !attach.isImage ? { fileUrl: attach.url, fileName: attach.name, fileSize: attach.size } : {}), ...(photos ?? {}), ...(mentions.length ? { mentions } : {}), ...(snapshot.reply ? { replyTo: replySnippet(snapshot.reply) } : {}) };
        const attempt:Attempt|undefined=attach||photos?{message:JSON.parse(JSON.stringify(message)) as ChatMessage,signal:latest.current.getSignal(),sending:true,readRun:null,result:null,notice:'첨부 메시지 저장 결과를 기다리고 있습니다.',matches:false}:undefined;
        if(attempt)retained.attempts.set(message.id,attempt);
        latest.current.add(message);
        try {
            await snapshot.send(message);
            // 정상 ACK는 방 이동이나 후속 query 없이 같은 계정의 보관 시도를 종결한다.
            if(attempt&&actorCurrent()&&retained.attempts.get(message.id)===attempt&&!attempt.signal.aborted){retained.attempts.delete(message.id);recoveryNotify();}
        }
        catch (error) {
            if(!attempt||actorCurrent())latest.current.remove(message.id);
            if(attempt&&actorCurrent()&&retained.attempts.get(message.id)===attempt&&!attempt.signal.aborted){attempt.sending=false;attempt.notice='첨부 메시지 저장 여부를 확인하지 못했습니다. 원문과 파일 주소를 보존했으며 다시 보내지 않았습니다. 첨부 전송 확인에서 조회해 주세요.';recoveryNotify();}
            if (current()) {
                if (state.revision === revision) {
                    state.text = snapshot.text;
                    state.reply = snapshot.reply;
                    state.revision++;
                }
                if(!attempt)latest.current.onError(`메시지 전송 실패: ${error instanceof Error ? error.message : '네트워크 오류'}`);
                notify();
            }
        }
    };
    const send = async () => {
        if (!current() || !state.roomId || !state.text.trim())
            return;
        const snapshot = capture(), revision = consume();
        await transmit(snapshot, revision);
    };
    const sendFiles = async (files: File[]) => {
        if (!current() || !state.roomId || state.upload || !files.length)
            return;
        const snapshot = capture(), run = {}, initialRevision = state.revision;
        let consumedRevision: number | null = null;
        state.upload = run;
        state.count = { done: 0, total: files.length };
        notify();
        const own = () => current() && state.upload === run;
        const failures: string[] = [];
        const sendAttachment = async (attach?: ChatAttachment, photos?: Pick<ChatMessage, 'imageUrl' | 'images'>) => {
            if (!own())
                return;
            if (consumedRevision === null && state.revision === initialRevision)
                consumedRevision = consume();
            await transmit(snapshot, consumedRevision ?? -1, attach, photos);
        };
        const upload = async (file: File) => {
            if (!own())
                return null;
            try {
                const value = await uploadChatFile(companyOf(snapshot.user), snapshot.roomId!, file);
                return own() ? value : null;
            }
            catch (error) {
                if (own())
                    failures.push(`${file.name}: ${error instanceof Error ? error.message : '네트워크 오류'}`);
                return null;
            }
            finally {
                if (own()) {
                    state.count = { ...state.count, done: state.count.done + 1 };
                    notify();
                }
            }
        };
        try {
            const photos = files.filter(f => (f.type || '').startsWith('image/'));
            const docs = files.filter(f => !(f.type || '').startsWith('image/'));
            if (photos.length) {
                const urls = (await Promise.all(photos.map(upload))).filter((a): a is ChatAttachment => !!a).map(a => a.url);
                if (own() && urls.length)
                    await sendAttachment(undefined, imagePatch(urls));
            }
            for (const file of docs) {
                if (!own())
                    break;
                const value = await upload(file);
                if (own() && value)
                    await sendAttachment(value);
            }
            if (own() && failures.length)
                latest.current.onError(`${failures.length}개를 못 보냈습니다 — ${failures[0]}`);
        }
        finally {
            if (own()) {
                state.upload = null;
                state.count = { done: 0, total: 0 };
                notify();
            }
        }
    };
    const attachmentAttempts:AttachmentSubmissionAttempt[]=[...retained.attempts.values()].filter(attempt=>attempt.message.roomId===state.roomId&&!attempt.sending).map(attempt=>({message:attempt.message,result:attempt.result,notice:attempt.notice,reading:!!attempt.readRun,matches:attempt.matches}));
    return { attachmentAttempts,attachmentRecoveryOpen:retained.open,openAttachmentRecovery,closeAttachmentRecovery,readAttachment,dismissConfirmedAttachment, messageText: state.text, replyTo: state.reply, setMessageText: setText, setReplyTo: setReply, send, sendFiles, uploading: !!state.upload, uploadCount: state.count };
}

function attachmentDeleted(message:ChatMessage):boolean{const value=message as unknown as Record<string,unknown>;return !!(value.deletedAt||value.deletedBy||value.isDeleted||value.deleted);}
function attachmentOriginal(message:ChatMessage):string{return JSON.stringify({text:message.text,createdAt:message.createdAt,imageUrl:message.imageUrl,images:message.images,fileUrl:message.fileUrl,fileName:message.fileName,fileSize:message.fileSize,mentions:message.mentions,replyTo:message.replyTo});}
