import {afterAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {Firestore,Transaction} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {withBatchTiming} from './orderProductionBatchTiming';

// 설치 전에 SDK 원본 자리에 가짜를 직접 끼운다(restoreMocks가 되돌리지 않게 spyOn은 쓰지 않는다). 기록 함수는 이 가짜를 원본으로 감싼다.
const proto:any=Transaction.prototype,store:any=Firestore.prototype,real={get:proto.get,getAll:proto.getAll,run:store.runTransaction};
let original=0;
proto.get=async()=>{original++;return {size:3};};
proto.getAll=async(...refs:unknown[])=>{original++;return refs.map(()=>({}));};
store.runTransaction=async(update:(tx:unknown)=>Promise<unknown>)=>{await update({});return update({});};
afterAll(()=>{proto.get=real.get;proto.getAll=real.getAll;store.runTransaction=real.run;});
let log:ReturnType<typeof vi.spyOn>;
beforeEach(()=>{log=vi.spyOn(console,'log').mockImplementation(()=>{});});
const last=()=>JSON.parse(String(log.mock.calls.at(-1)?.[0]));
const tx:any=Object.create(Transaction.prototype);

describe('생산 처리 시간 기록',()=>{
 it('결과를 그대로 돌려주고 읽기·트랜잭션 시도 횟수를 한 줄로 남긴다',async()=>{const result=await withBatchTiming({mode:'prepare-reserve',intent:{action:'complete-partial',reference:{orderId:'o1'}}},async()=>{await store.runTransaction.call({},async()=>{await tx.get('q');await Promise.all([tx.get('a'),tx.getAll('b','c')]);});return 'done';});expect(result).toBe('done');expect(last()).toMatchObject({message:'orderProductionBatch timing',mode:'prepare-reserve',action:'complete-partial',orderId:'o1',outcome:'ok',reads:6,readDocs:16,attempts:2});expect(last().otherMs).toBeGreaterThanOrEqual(0);expect(log).toHaveBeenCalledTimes(1)});
 it('오류는 그대로 던지고 오류 종류를 남긴다',async()=>{await expect(withBatchTiming({mode:'apply'},async()=>{throw new HttpsError('failed-precondition','변경됨');})).rejects.toThrow('변경됨');expect(last()).toMatchObject({mode:'apply',outcome:'failed-precondition',reads:0})});
 it('기록 밖의 읽기는 세지 않고 이상한 입력에도 기록이 실패하지 않는다',async()=>{const before=original;expect(await tx.get('outside')).toEqual({size:3});expect(original).toBe(before+1);expect(await withBatchTiming(null,async()=>1)).toBe(1);expect(last()).toMatchObject({outcome:'ok',reads:0,attempts:0});expect(last().mode).toBeUndefined()});
});
