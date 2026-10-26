import type {ChatMessage} from '../../../types';
export type ChatDraft={revision:number;text:string;reply:ChatMessage|null;failedPacketId?:string};
export type ChatPacket={message:ChatMessage;phase:'prepared'|'submitted'|'acknowledged';draftRevision:number};
export type ChatUpload={id:string;completed?:boolean;roomId:string;text:string;reply:ChatMessage|null;files:{name:string;size:number;type:string;url?:string;path?:string;packetId?:string;confirmed?:boolean;state:'selected'|'uploaded'|'failed'|'cancelled'|'dispatched'}[]};
export type ChatCheckpoint={draft:ChatDraft;packets:ChatPacket[];uploads:ChatUpload[]};
export const emptyChatCheckpoint=():ChatCheckpoint=>({draft:{revision:0,text:'',reply:null},packets:[],uploads:[]});
export const chatJSON=<T,>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
export function validChatCheckpoint(value:unknown):value is ChatCheckpoint{
 const v=value as ChatCheckpoint;
 if(!v||!v.draft||!Number.isSafeInteger(v.draft.revision)||v.draft.revision<0||typeof v.draft.text!=='string'||!(v.draft.reply===null||validMessage(v.draft.reply))||(v.draft.failedPacketId!==undefined&&typeof v.draft.failedPacketId!=='string')||!Array.isArray(v.packets)||!Array.isArray(v.uploads))return false;
 const ids=new Set<string>();
 for(const p of v.packets){if(!p||!validMessage(p.message)||!['prepared','submitted','acknowledged'].includes(p.phase)||!Number.isSafeInteger(p.draftRevision)||ids.has(p.message.id))return false;ids.add(p.message.id);}
 return v.uploads.every(u=>u&&typeof u.id==='string'&&typeof u.roomId==='string'&&typeof u.text==='string'&&(u.reply===null||validMessage(u.reply))&&Array.isArray(u.files)&&u.files.every(f=>typeof f.name==='string'&&Number.isFinite(f.size)&&f.size>=0&&typeof f.type==='string'&&['selected','uploaded','failed','cancelled','dispatched'].includes(f.state)&&(f.url===undefined||typeof f.url==='string')&&(f.path===undefined||typeof f.path==='string')&&(f.packetId===undefined||typeof f.packetId==='string')&&(f.confirmed===undefined||typeof f.confirmed==='boolean')));
}
function validMessage(m:ChatMessage){return !!m&&typeof m.id==='string'&&!!m.id&&typeof m.roomId==='string'&&typeof m.senderId==='string'&&typeof m.text==='string'&&typeof m.createdAt==='string';}
export type ChatOperation={kind:'draft';draft:ChatDraft}|{kind:'packet';packet:ChatPacket}|{kind:'ack'|'dismiss';id:string}|{kind:'upload';upload:ChatUpload};
export const hasChatUploadEvidence=(file:ChatUpload['files'][number])=>!!(file.url||file.path||file.packetId||file.confirmed);
export const canCancelChatFile=(file:ChatUpload['files'][number])=>(file.state==='selected'||file.state==='failed')&&!hasChatUploadEvidence(file);
function compact(state:ChatCheckpoint){state.uploads=state.uploads.filter(u=>!(u.completed&&u.files.every(f=>f.state==='cancelled'&&!hasChatUploadEvidence(f)||!!f.url&&!!f.packetId&&f.confirmed===true&&f.state==='dispatched')));}
export function reduceChatCheckpoint(previous:ChatCheckpoint,operation:ChatOperation):ChatCheckpoint{
 const next=chatJSON(previous);
 if(operation.kind==='draft'){
  if(operation.draft.revision>=next.draft.revision)next.draft=chatJSON(operation.draft);
 }else if(operation.kind==='upload'){
  const index=next.uploads.findIndex(u=>u.id===operation.upload.id),incoming=chatJSON(operation.upload);
  if(index>=0)incoming.files=incoming.files.map((file,i)=>{const old=next.uploads[index].files[i];return old?.packetId===file.packetId&&old?.confirmed?{...file,confirmed:true}:file;});
  if(index<0)next.uploads.push(incoming);else next.uploads[index]=incoming;
 }else if(operation.kind==='packet'){
  const old=next.packets.find(p=>p.message.id===operation.packet.message.id);
  if(old&&JSON.stringify(old.message)!==JSON.stringify(operation.packet.message))throw Error('같은 메시지 번호의 원문이 다릅니다. 보관본을 덮지 않았습니다.');
  if(!old)next.packets.push(chatJSON(operation.packet));else if(old.phase!=='acknowledged')old.phase=operation.packet.phase;
 }else{
  next.packets=next.packets.filter(p=>p.message.id!==operation.id);
  if(next.draft.failedPacketId===operation.id)next.draft={revision:next.draft.revision+1,text:'',reply:null};
  for(const upload of next.uploads)for(const file of upload.files)if(file.packetId===operation.id)file.confirmed=true;
 }
 compact(next);
 return next;
}
export function adoptionIssue(current:ChatCheckpoint,saved:ChatCheckpoint):string|null{
 const rank={prepared:0,submitted:1,acknowledged:2};
 for(const p of current.packets){const other=saved.packets.find(s=>s.message.id===p.message.id);if(!other||JSON.stringify(other.message)!==JSON.stringify(p.message)||rank[other.phase]<rank[p.phase])return '현재 전송 원문이나 확인 상태가 보관본에 없어 열지 않았습니다. 원문을 복사하고 다시 보관해 주세요.';}
 for(const upload of current.uploads){const other=saved.uploads.find(u=>u.id===upload.id);if(!other||other.roomId!==upload.roomId||other.text!==upload.text||JSON.stringify(other.reply)!==JSON.stringify(upload.reply)||other.files.length!==upload.files.length)return '현재 파일 선택과 원문이 보관본에 없어 열지 않았습니다. 현재 입력은 보존했습니다.';
  for(let i=0;i<upload.files.length;i++){const a=upload.files[i],b=other.files[i];if(a.name!==b.name||a.size!==b.size||a.type!==b.type||(a.url&&a.url!==b.url)||(a.path&&a.path!==b.path)||(a.packetId&&a.packetId!==b.packetId)||(a.confirmed&&!b.confirmed)||a.state!==b.state)return '현재 받은 파일 주소나 진행 상태가 보관본과 달라 열지 않았습니다. 현재 원문과 주소는 보존했습니다. 다시 보관해 주세요.';}
 }
 return null;
}
