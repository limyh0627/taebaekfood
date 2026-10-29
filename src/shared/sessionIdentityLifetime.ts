export interface SessionIdentityObservation {readonly identity:unique symbol}
export interface SessionIdentityTicket {readonly identity:unique symbol}

/** 확인 중에는 결과 반영을 보류하고 실제로 관찰된 신원 변화만 이전 수명을 끝낸다. */
export function createSessionIdentityLifetime(){
 let epoch=0,sequence=0,latest=0,uid:string|null=null,actor:string|null=null,ready=false,latestSucceeded=false;
 const observations=new Map<SessionIdentityObservation,{sequence:number;uid:string|null}>();
 const tickets=new WeakMap<SessionIdentityTicket,{epoch:number;actor:string}>();
 const waiters=new Set<()=>void>();
 const wake=()=>{for(const callback of [...waiters])callback();};
 const begin=(nextUid:string|null):SessionIdentityObservation=>{
  if(uid!==nextUid){uid=nextUid;epoch++;actor=null;latestSucceeded=false;observations.clear();}
  ready=false;const observation={} as SessionIdentityObservation;latest=++sequence;observations.set(observation,{sequence:latest,uid:nextUid});wake();return observation;
 };
 const finish=(observation:SessionIdentityObservation,key:string|null,success:boolean)=>{
  const item=observations.get(observation);if(!item)return;observations.delete(observation);
  if(success&&key!==null&&item.uid===uid){if(actor!==null&&actor!==key)epoch++;if(item.sequence===latest){actor=key;latestSucceeded=true;}}
  if(item.sequence===latest&&(!success||key===null)){epoch++;actor=null;latestSucceeded=false;}
  ready=latestSucceeded&&actor!==null&&observations.size===0;wake();
 };
 const resolve=(observation:SessionIdentityObservation,key:string|null)=>finish(observation,key,key!==null);
 const reject=(observation:SessionIdentityObservation)=>finish(observation,null,false);
 const dispose=()=>{epoch++;sequence++;latest=sequence;observations.clear();uid=null;actor=null;ready=false;latestSucceeded=false;wake();};
 const capture=(expectedActorKey:string):SessionIdentityTicket|null=>{if(!ready||actor!==expectedActorKey)return null;const ticket={} as SessionIdentityTicket;tickets.set(ticket,{epoch,actor});return ticket;};
 const isCurrent=(ticket:SessionIdentityTicket)=>{const saved=tickets.get(ticket);return !!saved&&ready&&saved.epoch===epoch&&saved.actor===actor;};
 const waitUntilReady=(ticket:SessionIdentityTicket):Promise<boolean>=>new Promise(done=>{
  const check=()=>{const saved=tickets.get(ticket);if(!saved||saved.epoch!==epoch||saved.actor!==actor){waiters.delete(check);done(false);}else if(ready){waiters.delete(check);done(true);}};
  waiters.add(check);check();
 });
 return {begin,resolve,reject,dispose,capture,waitUntilReady,isCurrent};
}
export const sessionIdentityLifetime=createSessionIdentityLifetime();
