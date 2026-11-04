import type {Firestore} from 'firebase-admin/firestore';

/** getAll 한 번에 보낼 문서 수. 너무 크면 응답 하나가 커지고, 작으면 왕복이 늘어난다. */
export const BATCH_READ_CHUNK=300;
/** 범위 쿼리를 동시에 몇 개까지 보낼지. Firestore 트랜잭션 하나가 감당할 수 있는 수준으로 묶는다. */
export const BATCH_QUERY_PARALLEL=20;

/**
 * 트랜잭션 안에서 여러 문서를 묶어 읽고 **paths 순서 그대로** 돌려준다.
 *
 * 2026-11-04: 생산 처리 inspect·apply가 계획 근거(품목·BOM 등 수천 건)를 `for … await tx.get`으로
 * 한 건씩 읽어 문서 수만큼 Firestore 왕복이 생겼다. 읽는 문서와 검증 순서는 그대로 두고 왕복만 줄인다.
 * 트랜잭션 잠금 범위도 전과 같다(같은 문서를 같은 트랜잭션에서 읽는다).
 *
 * getAll이 없는 시험용 가짜 트랜잭션은 예전처럼 한 건씩 읽는다.
 */
export async function getDocsInOrder(tx:any,db:Pick<Firestore,'doc'>,paths:readonly string[]):Promise<any[]>{
 if(!paths.length)return [];
 if(typeof tx?.getAll!=='function'){const out:any[]=[];for(const path of paths)out.push(await tx.get(db.doc(path)));return out;}
 const chunks:string[][]=[];for(let i=0;i<paths.length;i+=BATCH_READ_CHUNK)chunks.push(paths.slice(i,i+BATCH_READ_CHUNK));
 const results=await Promise.all(chunks.map(chunk=>tx.getAll(...chunk.map(path=>db.doc(path)))));
 const out=results.flat();
 if(out.length!==paths.length)throw Error('source-unproven');
 return out;
}

/**
 * 순서가 정해진 읽기 작업들을 최대 `parallel`개씩 미리 시작하고, 호출자는 원래 순서대로 결과를 받는다.
 * 호출자가 중간에 오류로 멈춰도 남은 작업의 실패가 처리되지 않은 거부(unhandled rejection)로 새지 않게 한다.
 */
export function prefetchInOrder<T>(tasks:readonly (()=>Promise<T>)[],parallel=BATCH_QUERY_PARALLEL):(index:number)=>Promise<T>{
 const slots:Promise<T>[]=new Array(tasks.length);let next=0;
 const start=(i:number)=>{const p=tasks[i]();p.catch(()=>{});slots[i]=p;p.then(launch,launch);};
 const launch=()=>{if(next<tasks.length)start(next++);};
 for(let i=0;i<Math.min(parallel,tasks.length);i++)launch();
 return (index:number)=>{while(slots[index]===undefined&&next<=index)launch();return slots[index];};
}
