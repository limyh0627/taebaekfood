export type CheckpointOwner={uid:string;companyId:string;employeeId:string};
export type OwnedCheckpoint<T>={bytes:string;envelope:{schemaVersion:1;feature:string;owner:CheckpointOwner;revision:number;payload:T}};
export class CheckpointConflict extends Error{}
const ownerSame=(a:CheckpointOwner,b:CheckpointOwner)=>a.uid===b.uid&&a.companyId===b.companyId&&a.employeeId===b.employeeId;
export const ownedCheckpointKey=(owner:CheckpointOwner,feature:string)=>'session-owned-v1:'+JSON.stringify([owner.uid,owner.companyId,owner.employeeId,feature]);
function assertJSON(value:unknown):void{if(value===null||typeof value==='string'||typeof value==='boolean')return;if(typeof value==='number'&&Number.isFinite(value))return;if(Array.isArray(value)){value.forEach(assertJSON);return;}if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype){Object.values(value).forEach(assertJSON);return;}throw Error('보관할 입력이 올바른 JSON 형식이 아닙니다. 입력 원문은 화면에 보존했습니다.');}
export function readOwnedCheckpoint<T>(owner:CheckpointOwner,feature:string,validate:(payload:unknown)=>payload is T):OwnedCheckpoint<T>|null{
 const bytes=localStorage.getItem(ownedCheckpointKey(owner,feature));if(bytes===null)return null;
 let envelope:OwnedCheckpoint<T>['envelope'];try{envelope=JSON.parse(bytes);assertJSON(envelope);if(!envelope||envelope.schemaVersion!==1||envelope.feature!==feature||!envelope.owner||!ownerSame(envelope.owner,owner)||!Number.isSafeInteger(envelope.revision)||envelope.revision<1||!validate(envelope.payload))throw Error();}catch{throw Error('기기에 보관된 입력 형식을 확인하지 못했습니다. 원문을 지우지 않았습니다. 다시 읽거나 원문을 복사해 주세요.');}
 return{bytes,envelope};
}
export async function writeOwnedCheckpoint<T>(owner:CheckpointOwner,feature:string,expectedBytes:string|null,payload:T,validate:(payload:unknown)=>payload is T):Promise<OwnedCheckpoint<T>>{
 assertJSON(payload);if(!validate(payload))throw Error('현재 입력의 보관 형식을 확인하지 못했습니다.');
 const fixed=JSON.parse(JSON.stringify(payload)) as T,fixedOwner={...owner},key=ownedCheckpointKey(fixedOwner,feature);
 if(!navigator.locks)throw Error('이 브라우저에서 안전한 입력 보관 잠금을 사용할 수 없습니다. 입력을 복사하고 지원되는 브라우저에서 다시 보관해 주세요.');
 return navigator.locks.request(key,{mode:'exclusive'},()=>{const previous=readOwnedCheckpoint(fixedOwner,feature,validate);if((previous?.bytes??null)!==expectedBytes)throw new CheckpointConflict('다른 창의 보관 내용이 바뀌었습니다. 현재 입력은 보존했습니다. 다시 읽어 확인해 주세요.');const envelope={schemaVersion:1 as const,feature,owner:fixedOwner,revision:(previous?.envelope.revision??0)+1,payload:fixed},bytes=JSON.stringify(envelope);localStorage.setItem(key,bytes);if(localStorage.getItem(key)!==bytes)throw new CheckpointConflict('보관 직후 다른 내용이 확인됐습니다. 입력은 보존했습니다. 다시 읽어 주세요.');return{bytes,envelope};});
}
export async function clearOwnedCheckpoint(owner:CheckpointOwner,feature:string,expectedBytes:string){const key=ownedCheckpointKey(owner,feature);if(!navigator.locks)throw Error('보관 잠금을 사용할 수 없습니다.');await navigator.locks.request(key,{mode:'exclusive'},()=>{if(localStorage.getItem(key)!==expectedBytes)throw new CheckpointConflict('다른 창의 보관 내용을 지우지 않았습니다.');localStorage.removeItem(key);if(localStorage.getItem(key)!==null)throw new CheckpointConflict('보관 정리를 확인하지 못했습니다.');});}
