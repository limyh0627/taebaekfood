import {useChatOwnedCheckpoint} from './useChatOwnedCheckpoint';
import {canCancelChatFile,chatJSON,type ChatUpload} from '../chatOwnedCheckpoint';
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
    send: (message: ChatMessage, sharedUUID?:string, expectedUid?:string, beforeSend?:()=>void) => void | Promise<unknown>;
    canSendRoom?:(roomId:string)=>boolean;
    add: (message: ChatMessage) => void;
    remove: (id: string) => void;
    onError: (message: string) => void;
}
export function useOfficeTalkComposer(options: Options) {
    const [, paint] = useState(0), mounted = useRef(false), latest = useRef(options);
    latest.current = options;
    const checkpointUid=options.getUid();
    const store=useChatOwnedCheckpoint(checkpointUid?{uid:checkpointUid,companyId:companyOf(options.currentUser),employeeId:options.currentUser.id}:null,()=>options.getUid()===checkpointUid&&!options.getSignal().aborted);
    const make = () => ({ uid: options.getUid(), roomId: options.roomId, scope: companyOf(options.currentUser) + ':' + options.currentUser.id, text: store.payload.draft.text, reply: store.payload.draft.reply as ChatMessage | null, revision: store.payload.draft.revision, failedPacketId:store.payload.draft.failedPacketId, upload: null as object | null, count: { done: 0, total: 0 } });
    const owner = useRef(make());
    const sameActor = owner.current.scope === companyOf(options.currentUser) + ':' + options.currentUser.id && owner.current.uid === options.getUid();
    if (!sameActor)
        owner.current = make();
    else if (owner.current.roomId !== options.roomId)
        owner.current = { ...make(), text: owner.current.text, reply: owner.current.reply, revision: owner.current.revision };
    const state = owner.current;
    const uploadMemory=useRef(new Map<string,{files:File[];snapshot:ReturnType<typeof capture>;revision:number}>());
    const checkpointDraft=()=>store.change({kind:'draft',draft:{text:state.text,reply:state.reply,revision:state.revision,...(state.failedPacketId?{failedPacketId:state.failedPacketId}:{})}});
    const persistDraft=()=>{void checkpointDraft().catch(()=>{});};
    const current = () => mounted.current && owner.current === state && !!state.uid && latest.current.getUid() === state.uid && !latest.current.getSignal().aborted;
    type Attempt={message:ChatMessage;signal:AbortSignal;sending:boolean;acknowledged?:boolean;readRun:object|null;result:PendingSubmissionRead<ChatMessage>|null;notice:string;matches:boolean};
    const scope=companyOf(options.currentUser)+':'+options.currentUser.id;
    const recovery=useRef({scope,uid:options.getUid(),roomId:options.roomId,open:false,attempts:new Map<string,Attempt>()});
    if(recovery.current.scope!==scope||recovery.current.uid!==options.getUid())recovery.current={scope,uid:options.getUid(),roomId:options.roomId,open:false,attempts:new Map()};
    const retained=recovery.current;
    for(const packet of store.payload.packets){if(!options.getSignal().aborted&&packet.phase!=='acknowledged'&&!retained.attempts.has(packet.message.id))retained.attempts.set(packet.message.id,{message:packet.message,signal:options.getSignal(),sending:false,readRun:null,result:null,notice:'기기에 보관된 최초 전송입니다. 저장 여부를 조회해 주세요. 자동으로 다시 보내지 않습니다.',matches:false});}
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
        if(!current()||!actorCurrent()||!attempt||attempt.sending||attempt.readRun||attempt.signal.aborted)return;
        const execution={};attempt.readRun=execution;attempt.result=null;attempt.matches=false;attempt.notice='메시지 저장 여부를 확인 중입니다.';recoveryNotify();
        const live=()=>actorCurrent()&&retained.attempts.get(id)===attempt&&!attempt.signal.aborted&&attempt.readRun===execution;
        try{
            let result=await latest.current.readMessage(JSON.parse(JSON.stringify(attempt.message)) as ChatMessage,attempt.signal);
            if(!live())return;
            if(result.kind==='found'&&(result.record.id!==id||result.record.companyId!==attempt.message.companyId||result.record.roomId!==attempt.message.roomId||result.record.senderId!==attempt.message.senderId))result={kind:'unconfirmed',reason:'현재 요청의 메시지를 확인하지 못했습니다.'};
            attempt.result=result.kind==='found'?{kind:'found',record:JSON.parse(JSON.stringify(result.record)) as ChatMessage}:result;
            attempt.matches=result.kind==='found'&&!attachmentDeleted(result.record)&&attachmentOriginal(result.record)===attachmentOriginal(attempt.message);
            attempt.notice=(attempt.acknowledged?'최초 전송은 완료 응답을 받았습니다. ':'')+(result.kind==='missing'?'현재 등록된 메시지를 찾지 못했습니다. 최초 전송의 미처리나 취소를 뜻하지 않습니다. 원문과 파일 주소를 보존했습니다. 다시 조회해 주세요.':result.kind==='unconfirmed'?result.reason:attachmentDeleted(result.record)?'삭제된 메시지입니다. 원문과 파일 주소를 보존했으며 다시 보내지 않았습니다.':attempt.matches?'현재 등록된 메시지가 최초 메시지 내용과 같습니다. 확인한 전송을 보관 목록에서 닫을 수 있습니다.':'현재 등록된 메시지가 최초 메시지 내용과 다릅니다. 원문과 파일 주소를 보존했으며 덮어쓰지 않았습니다. 다시 조회해 주세요.');
        }catch{if(live()){attempt.result={kind:'unconfirmed',reason:'조회하지 못했습니다. 원문과 파일 주소를 보존했습니다. 다시 조회해 주세요.'};attempt.matches=false;attempt.notice=(attempt.acknowledged?'최초 전송은 완료 응답을 받았습니다. ':'')+attempt.result.reason;}}
        finally{if(live()){attempt.readRun=null;recoveryNotify();}}
    };
    const dismissConfirmedAttachment=(id:string)=>{
        const attempt=retained.attempts.get(id);
        if(!current()||!actorCurrent()||!attempt||attempt.signal.aborted||attempt.sending||attempt.readRun||!attempt.matches||attempt.result?.kind!=='found'||attachmentDeleted(attempt.result.record)||attachmentOriginal(attempt.result.record)!==attachmentOriginal(attempt.message))return;
        const revision=state.revision,linked=state.failedPacketId;
        return store.change({kind:'dismiss',id}).then(()=>{if(current()&&linked===id&&state.failedPacketId===linked&&state.revision===revision){const draft=store.getPayload().draft;state.text=draft.text;state.reply=draft.reply;state.revision=draft.revision;state.failedPacketId=draft.failedPacketId;}if(actorCurrent()){retained.attempts.delete(id);recoveryNotify();}});
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
        state.failedPacketId=undefined;
        state.text = typeof value === 'function' ? value(state.text) : value;
        state.revision++;
        persistDraft();
        notify();
    };
    const setReply = (value: ChatMessage | null) => {
        if (!current())
            return;
        state.failedPacketId=undefined;
        state.reply = value;
        state.revision++;
        persistDraft();
        notify();
    };
    const capture = () => ({ text: state.text, reply: state.reply ? { ...state.reply } : null, roomId: state.roomId, user: { ...latest.current.currentUser }, employees: latest.current.employees.map(employee => ({ ...employee })), send: latest.current.send });
    const consume = () => {
        state.failedPacketId=undefined;
        state.text = '';
        state.reply = null;
        state.revision++;
        persistDraft();
        notify();
        return state.revision;
    };
    const transmit = async (snapshot: ReturnType<typeof capture>, revision: number, attach?: ChatAttachment, photos?: Pick<ChatMessage, 'imageUrl' | 'images'>, capturedEpoch=store.epoch(),link?:{upload:ChatUpload;indices:number[]}) => {
        if (!current() || !snapshot.roomId || (latest.current.canSendRoom&&!latest.current.canSendRoom(snapshot.roomId)))
            return;
        const epoch=capturedEpoch,signal=latest.current.getSignal();
        const mentions = mentionedIds(snapshot.text, snapshot.employees);
        const message: ChatMessage = { id: `MSG-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`, companyId: companyOf(snapshot.user), roomId: snapshot.roomId, senderId: snapshot.user.id, senderName: snapshot.user.name, text: snapshot.text, createdAt: new Date().toISOString(), ...(attach?.isImage ? { imageUrl: attach.url } : {}), ...(attach && !attach.isImage ? { fileUrl: attach.url, fileName: attach.name, fileSize: attach.size } : {}), ...(photos ?? {}), ...(mentions.length ? { mentions } : {}), ...(snapshot.reply ? { replyTo: replySnippet(snapshot.reply) } : {}) };
        const attempt:Attempt={message:JSON.parse(JSON.stringify(message)) as ChatMessage,signal:latest.current.getSignal(),sending:true,readRun:null,result:null,notice:'메시지 저장 결과를 기다리고 있습니다.',matches:false};
        retained.attempts.set(message.id,attempt);
        latest.current.add(message);
        let sent=false;const finish=store.beginWork();
        try {
            if(link){for(const index of link.indices)link.upload.files[index].packetId=message.id;await store.change({kind:'upload',upload:link.upload});}
            await store.change({kind:'packet',packet:{message:chatJSON(message),phase:'prepared',draftRevision:revision}});
            if(!current()||!store.canSend(epoch)||signal.aborted)throw Error('아직 전송하지 않았습니다. 입력과 원문을 보존했습니다.');
            await store.change({kind:'packet',packet:{message:chatJSON(message),phase:'submitted',draftRevision:revision}});
            const beforeSend=()=>{if(!current()||!store.canSend(epoch)||signal.aborted||(latest.current.canSendRoom&&!latest.current.canSendRoom(message.roomId)))throw Error('아직 전송하지 않았습니다. 로그인·대화방과 보관 상태를 확인해 주세요.');sent=true;};
            if(!current()||!store.canSend(epoch)||signal.aborted)throw Error('아직 전송하지 않았습니다. 원문을 보존했습니다.');
            await snapshot.send(message,undefined,state.uid,beforeSend);
            attempt.acknowledged=true;let copyError=false;await store.change({kind:'ack',id:message.id}).catch(()=>{copyError=true;});
            if(copyError){if(actorCurrent()){attempt.sending=false;attempt.notice='메시지 전송은 완료됐지만 기기 기록 갱신에 실패했습니다. 원문을 보존했습니다. 다시 보관하거나 조회해 주세요.';recoveryNotify();}return {id:message.id,confirmed:false};}
            // 정상 ACK는 방 이동이나 후속 query 없이 같은 계정의 보관 시도를 종결한다.
            if(attempt&&actorCurrent()&&retained.attempts.get(message.id)===attempt&&!attempt.signal.aborted){retained.attempts.delete(message.id);recoveryNotify();}
            return {id:message.id,confirmed:true};
        }
        catch (error) {
            if(!attempt||actorCurrent())latest.current.remove(message.id);
            if(attempt&&actorCurrent()&&retained.attempts.get(message.id)===attempt&&!attempt.signal.aborted){attempt.sending=false;attempt.notice=sent?'메시지 저장 여부를 확인하지 못했습니다. 원문과 받은 파일 주소를 보존했습니다. 메시지 전송 확인에서 조회해 주세요.':'전송 시작을 확인하지 못했습니다. 원문을 보존했습니다. 자동으로 다시 보내지 않으며 저장 여부를 조회할 수 있습니다.';recoveryNotify();}
            if (current()) {
                if (state.revision === revision) {
                    state.text = snapshot.text;
                    state.reply = snapshot.reply;
                    state.revision++;
                    state.failedPacketId=message.id;
                    persistDraft();
                }
                if(!attempt)latest.current.onError(`메시지 전송 실패: ${error instanceof Error ? error.message : '네트워크 오류'}`);
                notify();
            }
            return {id:message.id,confirmed:false};
        }finally{finish();}
    };
    const send = async () => {
        if (!current() || !state.roomId || !state.text.trim() || store.error || !store.canSend(store.epoch()))
            return;
        if(store.getPayload().packets.some(p=>p.phase!=='acknowledged'&&p.message.roomId===state.roomId&&p.message.text===state.text&&JSON.stringify(p.message.replyTo??null)===JSON.stringify(state.reply?replySnippet(state.reply):null))){retained.open=true;recoveryNotify();return;}
        const snapshot = capture(), revision = consume();
        await transmit(snapshot, revision);
    };
    const sendFiles = async (files: File[], existing?:ChatUpload) => {
        if (!current() || !state.roomId || state.upload || !files.length || store.error || !store.canSend(store.epoch()))
            return;
        const snapshot = existing?uploadMemory.current.get(existing.id)!.snapshot:capture(), run = {}, initialRevision = existing?uploadMemory.current.get(existing.id)!.revision:state.revision, epoch=store.epoch();
        const uploadRecord:ChatUpload=existing?chatJSON(existing):{id:crypto.randomUUID(),roomId:state.roomId!,text:snapshot.text,reply:snapshot.reply,files:files.map(f=>({name:f.name,size:f.size,type:f.type,state:'selected'}))};
        if(!existing)uploadMemory.current.set(uploadRecord.id,{files,snapshot,revision:initialRevision});
        const persistUpload=()=>store.change({kind:'upload',upload:uploadRecord});
        let consumedRevision: number | null = null;
        state.upload = run;
        const finishUpload=store.beginWork();
        state.count = { done: 0, total: files.length };
        notify();
        const own = () => current() && state.upload === run;
        const failures: string[] = [];
        const sendAttachment = async (attach?: ChatAttachment, photos?: Pick<ChatMessage, 'imageUrl' | 'images'>,indices:number[]=[]) => {
            if (!own())
                return;
            if (consumedRevision === null && state.revision === initialRevision)
                consumedRevision = consume();
            const result=await transmit(snapshot, consumedRevision ?? -1, attach, photos,epoch,{upload:uploadRecord,indices});
            if(result?.confirmed)for(const index of indices)uploadRecord.files[index].confirmed=true;
        };
        const upload = async (file: File) => {
            if (!own()||!store.canSend(epoch))
                return null;
            try {
                const index=files.indexOf(file);
                const saved=uploadRecord.files[index];if(saved.url)return {url:saved.url,path:saved.path??'',type:saved.type,name:saved.name,size:saved.size,isImage:saved.type.startsWith('image/')};
                const task=uploadChatFile(companyOf(snapshot.user), snapshot.roomId!, file).then(async value=>{uploadRecord.files[index]={...uploadRecord.files[index],url:value.url,...(value.path?{path:value.path}:{}),state:'uploaded'};await persistUpload();return value;});
                const value = await store.observe(task);
                return own() ? value : null;
            }
            catch (error) {
                uploadRecord.files[files.indexOf(file)].state='failed';void persistUpload().catch(()=>{});
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
            await persistUpload();
            const photos = files.filter((f,index) => (f.type || '').startsWith('image/')&&!['dispatched','cancelled'].includes(uploadRecord.files[index].state));
            const docs = files.filter((f,index) => !(f.type || '').startsWith('image/')&&!['dispatched','cancelled'].includes(uploadRecord.files[index].state));
            if (photos.length) {
                const urls = (await Promise.all(photos.map(upload))).filter((a): a is ChatAttachment => !!a).map(a => a.url);
                if (own() && urls.length){
                    await sendAttachment(undefined, imagePatch(urls),photos.filter(file=>!!uploadRecord.files[files.indexOf(file)].url).map(file=>files.indexOf(file)));
                    for(const file of photos)if(uploadRecord.files[files.indexOf(file)].url)uploadRecord.files[files.indexOf(file)].state='dispatched';
                    await persistUpload();
                }
            }
            for (const file of docs) {
                if (!own())
                    break;
                const value = await upload(file);
                if (own() && value){
                    await sendAttachment(value,undefined,[files.indexOf(file)]);uploadRecord.files[files.indexOf(file)].state='dispatched';await persistUpload();
                }
            }
            uploadRecord.completed=uploadRecord.files.every(f=>f.state==='dispatched'||f.state==='cancelled');await persistUpload();
            if (own() && failures.length)
                latest.current.onError(`${failures.length}개를 못 보냈습니다 — ${failures[0]}`);
        }
        finally {
            finishUpload();
            if (own()) {
                state.upload = null;
                state.count = { done: 0, total: 0 };
                notify();
            }
        }
    };
    const attachmentAttempts:AttachmentSubmissionAttempt[]=[...retained.attempts.values()].filter(attempt=>!attempt.sending).map(attempt=>({message:attempt.message,result:attempt.result,notice:attempt.notice,reading:!!attempt.readRun,matches:attempt.matches}));
    const continueUploads=async(id:string)=>{const upload=store.getPayload().uploads.find(u=>u.id===id),memory=uploadMemory.current.get(id);if(!upload||!current())return;if(!memory){throw Error('원래 선택한 파일은 이 화면에 없습니다. 파일을 다시 선택해야 합니다. 받은 주소와 전송 원문은 보존했습니다.');}if(upload.roomId!==state.roomId){throw Error('원래 대화방을 선택한 뒤 파일 업로드를 계속해 주세요.');}await sendFiles(memory.files,upload);};
    return { continueUploads,storageError:options.getSignal().aborted?'':store.error,checkpointText:JSON.stringify(store.payload),retryCheckpoint:async()=>{const revision=state.revision,linked=state.failedPacketId;await store.retry();if(!current())return;for(const id of retained.attempts.keys())if(store.isTerminal(id))retained.attempts.delete(id);if(linked&&store.isTerminal(linked)&&state.failedPacketId===linked&&state.revision===revision){const draft=store.getPayload().draft;state.text=draft.text;state.reply=draft.reply;state.revision=draft.revision;state.failedPacketId=draft.failedPacketId;}notify();},readCheckpoint:store.readAgain,restoreCheckpoint:async()=>{if(await store.adopt()&&current()){const draft=store.getPayload().draft;state.text=draft.text;state.reply=draft.reply;state.revision=draft.revision;state.failedPacketId=draft.failedPacketId;notify();}},flushCheckpoint:store.flush,uploads:options.getSignal().aborted?[]:store.payload.uploads,cancelUnstartedUploads:async()=>{for(const upload of store.payload.uploads)if(upload.files.some(canCancelChatFile))await store.change({kind:'upload',upload:{...upload,completed:upload.files.every(f=>f.state!=='uploaded'),files:upload.files.map(f=>canCancelChatFile(f)?{...f,state:'cancelled'}:f)}});}, attachmentAttempts,attachmentRecoveryOpen:retained.open,openAttachmentRecovery,closeAttachmentRecovery,readAttachment,dismissConfirmedAttachment, messageText: state.text, replyTo: state.reply, setMessageText: setText, setReplyTo: setReply, send, sendFiles, uploading: !!state.upload, uploadCount: state.count };
}

function attachmentDeleted(message:ChatMessage):boolean{const value=message as unknown as Record<string,unknown>;return !!(value.deletedAt||value.deletedBy||value.isDeleted||value.deleted);}
function attachmentOriginal(message:ChatMessage):string{return JSON.stringify({text:message.text,createdAt:message.createdAt,imageUrl:message.imageUrl,images:message.images,fileUrl:message.fileUrl,fileName:message.fileName,fileSize:message.fileSize,mentions:message.mentions,replyTo:message.replyTo});}
