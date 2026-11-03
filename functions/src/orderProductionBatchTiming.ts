import {AsyncLocalStorage} from 'node:async_hooks';
import {performance} from 'node:perf_hooks';
import {Firestore,Transaction} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';

/** 생산 처리 요청 하나의 시간 기록. 측정만 하며 읽은 값·처리 결과는 바꾸지 않는다. */
type BatchTiming={reads:number;readDocs:number;readWaitMs:number;inflight:number;inflightSince:number;attempts:number};
const timings=new AsyncLocalStorage<BatchTiming>();
let installed=false;

/** 기록 중인 요청 안에서만 트랜잭션 읽기 대기 시간(동시 읽기는 겹친 구간을 한 번만)과 트랜잭션 시도 횟수를 센다. */
function install():void{
 if(installed)return;installed=true;
 const proto:any=Transaction?.prototype,store:any=Firestore?.prototype;
 if(!proto||!store||typeof store.runTransaction!=='function')return;
 for(const name of ['get','getAll'] as const){const original=proto[name];if(typeof original!=='function')continue;proto[name]=function(this:Transaction,...args:unknown[]){const result=original.apply(this,args),t=timings.getStore();if(!t)return result;t.reads++;if(t.inflight++===0)t.inflightSince=performance.now();const done=(snap?:any)=>{if(--t.inflight===0)t.readWaitMs+=performance.now()-t.inflightSince;if(snap!==undefined)t.readDocs+=typeof snap?.size==='number'?snap.size:Array.isArray(snap)?snap.length:1;};return result.then((snap:unknown)=>{done(snap);return snap;},(error:unknown)=>{done();throw error;});};}
 const run=store.runTransaction;store.runTransaction=function(this:Firestore,update:(tx:Transaction)=>unknown,options?:unknown){const t=timings.getStore();return run.call(this,t?(tx:Transaction)=>{t.attempts++;return update(tx);}:update,options);};
}

const text=(value:unknown)=>typeof value==='string'?value.slice(0,200):undefined;

/** 요청 전체 시간을 재고 끝나면 로그 한 줄을 남긴다. 기록이 실패해도 요청 결과에는 영향을 주지 않는다. */
export async function withBatchTiming<T>(data:unknown,run:()=>Promise<T>):Promise<T>{
 install();const t:BatchTiming={reads:0,readDocs:0,readWaitMs:0,inflight:0,inflightSince:0,attempts:0},start=performance.now();let outcome='ok';
 try{return await timings.run(t,run);}catch(error){outcome=error instanceof HttpsError?error.code:'error';throw error;}
 finally{try{const d:any=data&&typeof data==='object'?data:{},totalMs=performance.now()-start;console.log(JSON.stringify({severity:'INFO',message:'orderProductionBatch timing',mode:text(d.mode),action:text(d.intent?.action),orderId:text(d.orderId??d.intent?.reference?.orderId??d.locator?.reference?.orderId??d.reference?.orderId??d.source?.reference?.orderId),outcome,totalMs:Math.round(totalMs),readWaitMs:Math.round(t.readWaitMs),otherMs:Math.round(totalMs-t.readWaitMs),reads:t.reads,readDocs:t.readDocs,attempts:t.attempts}));}catch{}}
}
