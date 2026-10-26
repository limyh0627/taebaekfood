import {useEffect,useRef,useState} from 'react';
import {readOwnedCheckpoint,writeOwnedCheckpoint,type CheckpointOwner} from '../../../shared/sessionOwnedCheckpointStore';
import {registerSessionWork,isSessionWorkChecking} from '../../../shared/sessionWorkCheckpoint';
import {appConfirm} from '../../../shared/components/appDialog';
import {adoptionIssue,emptyChatCheckpoint,validChatCheckpoint,reduceChatCheckpoint,chatJSON,type ChatCheckpoint,type ChatOperation} from '../chatOwnedCheckpoint';
const feature='chat';
const validFor=(value:unknown,owner:CheckpointOwner|null):value is ChatCheckpoint=>validChatCheckpoint(value)&&!!owner&&value.packets.every(p=>p.message.companyId===owner.companyId&&p.message.senderId===owner.employeeId);
export function useChatOwnedCheckpoint(owner:CheckpointOwner|null,actorCurrent:()=>boolean=()=>true){
 const [,paint]=useState(0),mounted=useRef(false),latest=useRef(owner);latest.current=owner;const guard=useRef(actorCurrent);guard.current=actorCurrent;
 const validate=(value:unknown):value is ChatCheckpoint=>validFor(value,owner);
 const key=JSON.stringify(owner),handles=useRef(new Set<ReturnType<typeof make>>());
 function make(){let bytes:string|null=null,payload=emptyChatCheckpoint(),error='';if(owner)try{const saved=readOwnedCheckpoint(owner,feature,validate);if(saved){bytes=saved.bytes;payload=saved.envelope.payload;}}catch(e){error=String(e instanceof Error?e.message:e);}
 return{owner,key,bytes,payload,validate,error,dirty:!!error,queue:Promise.resolve(),epoch:0,observers:new Set<Promise<unknown>>(),pending:0,work:0,generation:0,terminalIds:new Set<string>(),failedTerminals:new Map<string,ChatOperation>()};}
 const ref=useRef<ReturnType<typeof make>|null>(null);if(!ref.current||ref.current.key!==key){ref.current=make();handles.current.add(ref.current);}const h=ref.current;
 const current=()=>mounted.current&&ref.current===h&&JSON.stringify(latest.current)===h.key&&guard.current();
 const notify=()=>{if(current())paint(v=>v+1);};
 const saveFor=(h:ReturnType<typeof make>)=>{if(!h.owner)return Promise.reject(Error('로그인을 확인해 주세요.'));h.pending++;const task=h.queue.then(async()=>{const payload=chatJSON(h.payload);const saved=await writeOwnedCheckpoint(h.owner!,feature,h.bytes,payload,h.validate);h.bytes=saved.bytes;h.dirty=JSON.stringify(h.payload)!==JSON.stringify(payload);if(!h.dirty)h.error='';notify();});h.queue=task.catch(e=>{h.error=e instanceof Error?e.message:String(e);h.dirty=true;notify();}).finally(()=>{h.pending--;});return task;};
 const save=()=>saveFor(h);
 const terminal=(op:Extract<ChatOperation,{kind:'ack'|'dismiss'}>)=>{
  if(h.terminalIds.has(op.id))return Promise.resolve();
  h.pending++;h.generation++;
  const task=h.queue.then(async()=>{
   if(!h.owner)throw Error('로그인을 확인해 주세요.');
   const payload=reduceChatCheckpoint(h.payload,op);
   const saved=await writeOwnedCheckpoint(h.owner,feature,h.bytes,payload,h.validate);
   h.bytes=saved.bytes;h.terminalIds.add(op.id);h.failedTerminals.delete(op.id);
   h.payload=reduceChatCheckpoint(h.payload,op);h.dirty=JSON.stringify(h.payload)!==JSON.stringify(payload);if(!h.dirty)h.error='';notify();
  });
  h.queue=task.catch(e=>{h.failedTerminals.set(op.id,op);h.error=e instanceof Error?e.message:String(e);notify();}).finally(()=>{h.pending--;});
  return task;
 };
 const change=(op:ChatOperation)=>{
  if(op.kind==='ack'||op.kind==='dismiss')return terminal(op);
  if(op.kind==='packet'&&h.terminalIds.has(op.packet.message.id))return Promise.resolve();
  h.generation++;h.payload=reduceChatCheckpoint(h.payload,op);h.dirty=true;notify();return save();
 };
 const retry=async()=>{for(const op of [...h.failedTerminals.values()])if(op.kind==='ack'||op.kind==='dismiss')await terminal(op);await save();};
 const flush=async(retry=false)=>{
  const captured=[...handles.current].filter(handle=>handle.owner&&handle.key===h.key);
  for(const handle of captured)handle.epoch++;
  for(const handle of captured){
   for(;;){
    while(handle.observers.size)await Promise.allSettled([...handle.observers]);
    const queued=handle.queue;await queued;await Promise.resolve();
    if(queued===handle.queue&&handle.observers.size===0)break;
   }
   if(retry&&(handle.dirty||handle.failedTerminals.size)){for(const op of [...handle.failedTerminals.values()])if(handle===h&&(op.kind==='ack'||op.kind==='dismiss'))await terminal(op);await saveFor(handle);}
   if(handle.dirty||handle.error)throw Error(handle.error||'메시지 입력을 기기에 보관하지 못했습니다. 다시 보관해 주세요.');
   if(handle.payload.uploads.some(u=>u.files.some(f=>f.state==='selected'||f.state==='failed')))throw Error('남은 파일을 계속 업로드하거나 미시작 파일 선택을 취소해 주세요.');
  }
 };
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{if(!h.owner)return;return registerSessionWork(h.owner,{name:'오피스톡 입력',flush:async retry=>{h.epoch++;await flush(retry);}});},[h]);
 const canSend=(epoch:number)=>current()&&!!h.owner&&!isSessionWorkChecking(h.owner)&&h.epoch===epoch&&!h.error;
 const readAgain=()=>{if(!h.owner)return;try{const saved=readOwnedCheckpoint(h.owner,feature,h.validate);h.error=h.dirty?'현재 입력은 아직 보관되지 않았습니다. 보관본과 비교하거나 다시 보관해 주세요.':'';notify();return saved?.envelope.payload??emptyChatCheckpoint();}catch(e){h.error=e instanceof Error?e.message:String(e);notify();}};
 const adopt=async()=>{
  const fail=(message:string)=>{h.error=message;notify();throw Error(message);};
  try{
   if(!current()||!h.owner)return;
   if(h.work||h.pending||h.observers.size)fail('전송이나 파일 보관이 진행 중이라 보관본을 열지 않았습니다. 작업이 끝난 뒤 다시 확인해 주세요.');
   const read=readAgain();if(!read)return;
   const before=readOwnedCheckpoint(h.owner,feature,h.validate)?.bytes??null,revision=h.payload.draft.revision,generation=h.generation;
   if(!await appConfirm('현재 입력 대신 기기에 보관된 입력을 열까요? 전송 확인 원문은 삭제하지 않습니다.'))return;
   if(!current()||h.payload.draft.revision!==revision||h.generation!==generation||h.work||h.pending||h.observers.size)fail('확인 중 입력이나 작업이 바뀌어 보관본을 열지 않았습니다. 현재 입력은 보존했습니다. 다시 확인해 주세요.');
   const saved=readOwnedCheckpoint(h.owner,feature,h.validate);
   if((saved?.bytes??null)!==before)fail('확인 중 보관 내용이 바뀌었습니다. 다시 읽어 주세요.');
   const payload=saved?.envelope.payload??emptyChatCheckpoint(),issue=adoptionIssue(h.payload,payload);if(issue)fail(issue);
   h.bytes=saved?.bytes??null;h.payload=payload;h.dirty=false;h.error='';notify();return true;
  }catch(e){h.error=e instanceof Error?e.message:String(e);notify();throw e;}
 };
 return{isTerminal:(id:string)=>h.terminalIds.has(id),getPayload:()=>h.payload,payload:h.payload,error:h.error,dirty:h.dirty,change,retry,beginWork:()=>{h.work++;h.generation++;let done=false;return()=>{if(!done){done=true;h.work--;h.generation++;}};},readAgain,adopt,flush,epoch:()=>h.epoch,canSend,observe:<T,>(promise:Promise<T>)=>{h.observers.add(promise);void promise.finally(()=>h.observers.delete(promise)).catch(()=>{});return promise;}};
}


