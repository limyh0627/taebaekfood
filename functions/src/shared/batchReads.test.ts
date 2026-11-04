import {describe,expect,it,vi} from 'vitest';
import {BATCH_READ_CHUNK,getDocsInOrder,prefetchInOrder} from './batchReads';

const db={doc:(path:string)=>({path})};
const snap=(path:string)=>({path,exists:!path.endsWith('missing')});

describe('getDocsInOrder',()=>{
 it('getAll이 있으면 묶어 읽고 요청 순서대로 돌려준다',async()=>{
  const paths=Array.from({length:BATCH_READ_CHUNK*2+7},(_,i)=>'items/i'+String(i).padStart(4,'0'));
  const tx={get:vi.fn(),getAll:vi.fn(async(...refs:any[])=>{await new Promise(r=>setTimeout(r,refs.length===7?0:5));return refs.map(ref=>snap(ref.path));})};
  const out=await getDocsInOrder(tx,db,paths);
  expect(out.map(row=>row.path)).toEqual(paths);
  expect(tx.getAll).toHaveBeenCalledTimes(3);
  expect(tx.get).not.toHaveBeenCalled();
 });
 it('없는 문서도 순서 자리에 그대로 남는다',async()=>{
  const tx={getAll:async(...refs:any[])=>refs.map(ref=>snap(ref.path))};
  const out=await getDocsInOrder(tx,db,['orders/a','orderStatusAudits/missing','items/b']);
  expect(out.map(row=>row.exists)).toEqual([true,false,true]);
 });
 it('getAll 결과 수가 다르면 거절한다',async()=>{
  const tx={getAll:async(...refs:any[])=>refs.slice(1).map(ref=>snap(ref.path))};
  await expect(getDocsInOrder(tx,db,['a/1','a/2'])).rejects.toThrow('source-unproven');
 });
 it('getAll이 없는 트랜잭션은 예전처럼 한 건씩 읽는다',async()=>{
  const tx={get:vi.fn(async(ref:any)=>snap(ref.path))};
  const out=await getDocsInOrder(tx,db,['a/1','a/2']);
  expect(out.map(row=>row.path)).toEqual(['a/1','a/2']);
  expect(tx.get).toHaveBeenCalledTimes(2);
 });
 it('빈 목록은 읽지 않는다',async()=>{
  const tx={getAll:vi.fn()};
  expect(await getDocsInOrder(tx,db,[])).toEqual([]);
  expect(tx.getAll).not.toHaveBeenCalled();
 });
});

describe('prefetchInOrder',()=>{
 it('동시 실행 수를 지키며 결과는 원래 순서다',async()=>{
  let running=0,peak=0;
  const tasks=Array.from({length:12},(_,i)=>async()=>{running++;peak=Math.max(peak,running);await new Promise(r=>setTimeout(r,(12-i)%4));running--;return i;});
  const get=prefetchInOrder(tasks,3),out:number[]=[];
  for(let i=0;i<tasks.length;i++)out.push(await get(i));
  expect(out).toEqual(tasks.map((_,i)=>i));
  expect(peak).toBeLessThanOrEqual(3);
 });
 it('호출자가 중간에 멈춰도 남은 실패가 처리되지 않은 거부로 새지 않는다',async()=>{
  const unhandled=vi.fn();process.on('unhandledRejection',unhandled);
  try{
   const get=prefetchInOrder([async()=>1,async()=>{throw Error('boom');},async()=>{throw Error('boom2');}],3);
   expect(await get(0)).toBe(1);
   await new Promise(r=>setTimeout(r,10));
   expect(unhandled).not.toHaveBeenCalled();
   await expect(get(1)).rejects.toThrow('boom');
  }finally{process.off('unhandledRejection',unhandled);}
 });
 it('아직 시작하지 않은 뒤쪽 작업을 요청하면 바로 시작한다',async()=>{
  const started:number[]=[];
  const tasks=Array.from({length:5},(_,i)=>()=>{started.push(i);return new Promise<number>(()=>{});});
  const get=prefetchInOrder(tasks,1);
  get(3);
  expect(started).toEqual([0,1,2,3]);
 });
});
