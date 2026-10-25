export type SessionWorkOwner={uid:string;companyId:string;employeeId:string};
type Participant={name:string;flush:(retry?:boolean)=>Promise<void>};
const registrations=new Map<symbol,{owner:string;participant:Participant}>();
const blocks=new Map<string,symbol>();
const key=(owner:SessionWorkOwner)=>JSON.stringify([owner.uid,owner.companyId,owner.employeeId]);
export function registerSessionWork(owner:SessionWorkOwner,participant:Participant){const token=Symbol();registrations.set(token,{owner:key(owner),participant});return()=>{registrations.delete(token);};}
export function isSessionWorkChecking(owner:SessionWorkOwner){return blocks.has(key(owner));}
export function beginSessionWorkCheckpoint(owner:SessionWorkOwner,current:()=>boolean,retry=false){
 const ownerKey=key(owner),captured=[...registrations].filter(([,entry])=>entry.owner===ownerKey);
 if(blocks.has(ownerKey))return{done:Promise.reject(new Error('이미 입력 보관을 확인하고 있습니다.')),release:()=>{}};
 if(!captured.length)return null;
 const token=Symbol();blocks.set(ownerKey,token);
 const release=()=>{if(blocks.get(ownerKey)===token)blocks.delete(ownerKey);};
 const done=(async()=>{
  const failures:string[]=[];
  await Promise.all(captured.map(async([registration,entry])=>{try{await entry.participant.flush(retry);if(registrations.get(registration)!==entry)throw Error('업무 화면의 보관 수명이 바뀌었습니다.');}catch(error){failures.push(entry.participant.name+': '+(error instanceof Error?error.message:String(error)));}}));
  if(!current())throw Error('로그인 세션이 바뀌어 이전 로그아웃을 진행하지 않았습니다.');
  if(failures.length)throw Error(failures.join('\n'));
 })();
 return{done,release};
}
