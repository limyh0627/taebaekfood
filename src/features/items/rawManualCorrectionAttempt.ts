import type {RawManualCorrectionRequest,RawManualCorrectionResult} from '../../shared/services/rawManualCorrectionService';
export type RawManualOwner={companyId:'taebaek'|'punghoe';actorUid:string;employeeId:string;rawItemId:string};
export type RawManualDraft={originalId:string;material:string;date:string;amount:string;isNegative:boolean;note:string;mode?:'neg'|'pos'|'stocktake'};
export type RawManualEntry={version:1;owner:RawManualOwner;revision:number;state:'draft'|'prepared'|'submitted'|'terminal';draft:RawManualDraft;request?:RawManualCorrectionRequest;result?:RawManualCorrectionResult};
export type RawManualCopy={entry:RawManualEntry;encoded:string};
export class RawManualCasConflict extends Error {}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const scopeKeys=['companyId','actorUid','employeeId','rawItemId'] as const;
const validOwner=(o:RawManualOwner)=>['taebaek','punghoe'].includes(o.companyId)&&scopeKeys.every(key=>typeof o[key]==='string'&&!!o[key]&&!o[key].includes('/'));
export function rawManualAttemptKey(owner:RawManualOwner):string{if(!validOwner(owner))throw Error('정정 보관 범위를 확인해 주세요.');return 'raw-manual-copy-v1:'+scopeKeys.map(key=>encodeURIComponent(owner[key])).join(':');}
function validate(entry:RawManualEntry,owner:RawManualOwner):void{
 if(!entry||entry.version!==1||!same(entry.owner,owner)||!Number.isSafeInteger(entry.revision)||entry.revision<1||!['draft','prepared','submitted','terminal'].includes(entry.state)||Object.keys(entry).some(key=>!['version','owner','revision','state','draft','request','result'].includes(key)))throw Error('보관된 정정 원문이 손상되었습니다. 삭제하지 않고 보존했습니다.');
 const d=entry.draft;if(!d||typeof d.originalId!=='string'||typeof d.material!=='string'||typeof d.date!=='string'||typeof d.amount!=='string'||typeof d.note!=='string'||typeof d.isNegative!=='boolean'||d.mode!==undefined&&!['neg','pos','stocktake'].includes(d.mode))throw Error('보관된 초안을 읽지 못했습니다. 원문은 보존했습니다.');
 if(entry.state==='draft'&&entry.request||entry.state!=='draft'&&!entry.request)throw Error('정정 보관 상태와 최초 요청이 다릅니다. 원문을 보존했습니다.');
 const r=entry.request;if(r&&(r.version!==1||r.actorUid!==owner.actorUid||r.employeeId!==owner.employeeId||r.companyId!==owner.companyId||r.command.rawItemId!==owner.rawItemId||!/^raw-manual-v1-[0-9a-f-]{36}$/i.test(r.operationId)||r.command.operationId!==r.operationId))throw Error('보관된 최초 정정의 계정·품목·번호가 다릅니다.');
 if(entry.state==='terminal'&&(!entry.result||!['applied','cancelled','rejected'].includes(entry.result.status)||entry.result.operationId!==r?.operationId))throw Error('보관된 처리 결과를 확인하지 못했습니다. 원문을 보존했습니다.');
}
export function readRawManualAttempt(owner:RawManualOwner):RawManualCopy|null{
 const encoded=localStorage.getItem(rawManualAttemptKey(owner));if(encoded===null)return null;
 let entry:RawManualEntry;try{entry=JSON.parse(encoded);}catch{throw Error('보관된 정정 원문을 읽지 못했습니다. 삭제하지 말고 원문 복사 후 관리자에게 확인해 주세요.');}validate(entry,owner);return{entry,encoded};
}
export function readRawManualOriginal(owner:RawManualOwner):string{return localStorage.getItem(rawManualAttemptKey(owner))??'';}
export function listRawManualAttempts(scope:Pick<RawManualOwner,'companyId'|'actorUid'|'employeeId'>):{key:string;copy:RawManualCopy|null;error:string;encoded:string}[]{
 const prefix='raw-manual-copy-v1:'+['companyId','actorUid','employeeId'].map(key=>encodeURIComponent(scope[key as keyof typeof scope])).join(':')+':';
 return Object.keys(localStorage).filter(key=>key.startsWith(prefix)).sort().map(key=>{const encoded=localStorage.getItem(key)??'';try{const owner=JSON.parse(encoded).owner as RawManualOwner;if(owner.companyId!==scope.companyId||owner.actorUid!==scope.actorUid||owner.employeeId!==scope.employeeId||rawManualAttemptKey(owner)!==key)throw Error();return{key,copy:readRawManualAttempt(owner),error:'',encoded};}catch{return{key,copy:null,error:'이 기기에 보관된 정정 원문이 손상되었습니다. 삭제하지 말고 원문을 복사해 확인해 주세요.',encoded};}});
}
/** 모든 저장은 같은 owner/holder WebLock과 읽었던 bytes의 CAS를 함께 쓴다. */
async function change(owner:RawManualOwner,expected:string|null,update:(old:RawManualEntry|null)=>RawManualEntry,current:()=>boolean):Promise<RawManualCopy>{
 const key=rawManualAttemptKey(owner);if(!navigator.locks?.request)throw Error('안전한 창 간 보관 잠금을 지원하는 브라우저에서 진행해 주세요.');
 return navigator.locks.request('raw-manual-lock:'+key,{mode:'exclusive'},async()=>{
  if(!current())throw Error('정정 화면 또는 계정이 변경되었습니다. 보관된 원문은 유지했습니다.');
  if(localStorage.getItem(key)!==expected)throw new RawManualCasConflict('다른 창의 보관 원문이 변경되었습니다. 현재 입력을 보존했습니다. 다시 읽어 확인해 주세요.');
  const old=expected===null?null:readRawManualAttempt(owner)!.entry;
  const entry=update(old);validate(entry,owner);const encoded=JSON.stringify(entry);
  localStorage.setItem(key,encoded);const observed=localStorage.getItem(key);if(observed!==encoded){if(observed!==expected)throw new RawManualCasConflict('다른 창의 보관 원문이 변경되었습니다. 다시 읽어 확인해 주세요.');throw Error('정정 요청의 기기 보관을 확인하지 못했습니다. 입력을 보존했습니다.');}
  return{entry:JSON.parse(encoded),encoded};
 });
}
export function checkpointRawManualDraft(owner:RawManualOwner,expected:string|null,draft:RawManualDraft):Promise<RawManualCopy>{
 const fixed=structuredClone(draft);
 // 입력 시 시작한 checkpoint는 로그아웃 뒤에도 원owner bytes CAS로만 끝낸다. 새 계정의 사본은 건드리지 않는다.
 return change(owner,expected,old=>{if(old&&old.state!=='draft')throw Error('먼저 보관된 요청의 처리 결과를 확인해 주세요. 입력과 최초 요청은 보존했습니다.');return{version:1,owner,revision:(old?.revision??0)+1,state:'draft',draft:fixed};},()=>true);
}
export function prepareRawManualAttempt(owner:RawManualOwner,copy:RawManualCopy,request:RawManualCorrectionRequest,current:()=>boolean):Promise<RawManualCopy>{
 const fixed=structuredClone(request);return change(owner,copy.encoded,old=>{if(!old||old.state!=='draft')throw Error('기존 요청을 먼저 확인해 주세요.');return{...old,revision:old.revision+1,state:'prepared',request:fixed};},current);
}
export function submitRawManualAttempt(owner:RawManualOwner,copy:RawManualCopy,current:()=>boolean):Promise<RawManualCopy>{return change(owner,copy.encoded,old=>{if(!old?.request||!['prepared','submitted'].includes(old.state))throw Error('최초 요청을 다시 읽어 확인해 주세요.');return{...old,revision:old.revision+1,state:'submitted'};},current);}
export function recordRawManualResult(owner:RawManualOwner,copy:RawManualCopy,result:RawManualCorrectionResult,current:()=>boolean):Promise<RawManualCopy>{
 const fixed=structuredClone(result);return change(owner,copy.encoded,old=>{if(!old?.request||fixed.operationId!==old.request.operationId||fixed.actorUid!==owner.actorUid||fixed.employeeId!==owner.employeeId||fixed.companyId!==owner.companyId)throw Error('응답과 보관된 원문이 다릅니다. 원문을 유지했습니다.');if(old.state==='terminal'&&fixed.status==='unknown')return old;return{...old,revision:old.revision+1,state:['applied','cancelled','rejected'].includes(fixed.status)?'terminal':'submitted',result:fixed};},current);
}
export function newRawManualDraft(owner:RawManualOwner,copy:RawManualCopy,draft:RawManualDraft,current:()=>boolean):Promise<RawManualCopy>{return change(owner,copy.encoded,old=>{if(!old||!['prepared','terminal'].includes(old.state))throw Error('미확인 요청은 새 번호로 바꾸지 않습니다. 결과 조회 또는 요청 중단을 선택해 주세요.');return{version:1,owner,revision:old.revision+1,state:'draft',draft:structuredClone(draft)};},current);}
