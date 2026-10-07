import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { resetDailyWorkOrder } from './workOrderResetService';
const state=vi.hoisted(()=>({lock:undefined as {date:string;companyId?:string}|undefined, sets:vi.fn(), transactions:vi.fn(), query:vi.fn(), remove:vi.fn(), claimError:false}));
vi.mock('../firebase',()=>({db:{}}));
vi.mock('./firebaseService',()=>({deleteItem:state.remove}));
vi.mock('firebase/firestore',()=>({
 doc:(_db:unknown,collection:string,id:string)=>({collection,id}), collection:(_db:unknown,name:string)=>name,
 where:(field:string,op:string,value:string)=>({field,op,value}),query:(...args:unknown[])=>args,
 getDocs:state.query,
 runTransaction:async(_db:unknown,fn:(tx:unknown)=>Promise<unknown>)=>{state.transactions();if(state.claimError)throw new Error('claim failed');return fn({get:async()=>({exists:()=>!!state.lock,data:()=>state.lock}),set:state.sets});},
}));
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-07T03:00:00Z'));state.lock=undefined;state.claimError=false;state.sets.mockReset().mockImplementation((_ref, data)=>{state.lock=data;});state.transactions.mockReset();state.query.mockReset().mockResolvedValue({docs:[{id:'one'},{id:'two'}]});state.remove.mockReset().mockResolvedValue(undefined);vi.spyOn(console,'error').mockImplementation(()=>{});});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
it('잠금 획득 실패는 다른 기기의 도장을 복원하지 않는다',async()=>{state.claimError=true;await resetDailyWorkOrder('taebaek');expect(state.transactions).toHaveBeenCalledTimes(1);expect(state.sets).not.toHaveBeenCalled();expect(state.query).not.toHaveBeenCalled();});
it('오늘 잠금이 있으면 조회와 삭제를 하지 않는다',async()=>{state.lock={date:'2026-10-7',companyId:'taebaek'};await resetDailyWorkOrder('taebaek');expect(state.sets).not.toHaveBeenCalled();expect(state.remove).not.toHaveBeenCalled();});
it('풍회 회사 조회와 기존 공용 삭제 경로를 유지한다',async()=>{await resetDailyWorkOrder('punghoe');expect(state.sets).toHaveBeenCalledWith({collection:'appMeta',id:'workOrderReset_punghoe'},{date:'2026-10-7',companyId:'punghoe'});expect(state.query).toHaveBeenCalledWith(['workOrderItems',{field:'companyId',op:'==',value:'punghoe'}]);expect(state.remove.mock.calls).toEqual([['workOrderItems','one'],['workOrderItems','two']]);});
it('자신이 획득한 잠금은 삭제 실패 시 최신값을 읽고 되돌린다',async()=>{state.remove.mockRejectedValue(new Error('delete failed'));await resetDailyWorkOrder('taebaek');expect(state.transactions).toHaveBeenCalledTimes(2);expect(state.sets).toHaveBeenLastCalledWith({collection:'appMeta',id:'workOrderReset_taebaek'},{date:'',companyId:'taebaek'});});
it.each([{date:'2026-10-8',companyId:'taebaek'},{date:'2026-10-7',companyId:'punghoe'},undefined])('삭제 실패 사이 바뀐 잠금 %j는 되돌리지 않는다',async changed=>{state.remove.mockImplementation(async()=>{state.lock=changed;throw new Error('delete failed');});await resetDailyWorkOrder('taebaek');expect(state.sets).toHaveBeenCalledTimes(1);});
it('다른 회사 잠금 문서는 덮어쓰지 않는다',async()=>{state.lock={date:'2026-10-6',companyId:'punghoe'};await resetDailyWorkOrder('taebaek');expect(state.sets).not.toHaveBeenCalled();expect(state.remove).not.toHaveBeenCalled();expect(state.transactions).toHaveBeenCalledTimes(1);});
it('조회 실패는 획득한 오늘 도장만 되돌린다',async()=>{state.query.mockRejectedValue(new Error('read failed'));await resetDailyWorkOrder('taebaek');expect(state.sets).toHaveBeenLastCalledWith(expect.anything(),{date:'',companyId:'taebaek'});expect(state.remove).not.toHaveBeenCalled();});
it('회사 필드 없는 옛 회사별 잠금은 문서 주소 범위를 유지해 초기화한다',async()=>{state.lock={date:'2026-10-6'};await resetDailyWorkOrder('punghoe');expect(state.sets).toHaveBeenCalledWith({collection:'appMeta',id:'workOrderReset_punghoe'},{date:'2026-10-7',companyId:'punghoe'});expect(state.remove).toHaveBeenCalledTimes(2);});
