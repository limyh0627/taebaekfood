import {it,expect,vi} from 'vitest';
import {executeDirectoryDeleteCommand,directoryDeleteReceiptId} from './directoryDeleteCommand';
import {directoryDeleteOpening} from './shared/directoryDeleteCommand';
const reference={companyId:'taebaek' as const,planId:'plan',kind:'partner' as const,targetId:'partner'};
it('잘못된 인증·회사·직원 삭제 권한·형식은 TX 전에 거절한다',async()=>{
  const runTransaction=vi.fn(),db={runTransaction} as never;
  await expect(executeDirectoryDeleteCommand(db,undefined,{mode:'inspect',reference})).rejects.toMatchObject({code:'unauthenticated'});
  await expect(executeDirectoryDeleteCommand(db,{uid:'u',token:{companyId:'taebaek'}},{mode:'inspect',reference})).rejects.toMatchObject({code:'permission-denied'});
  const staff={uid:'u',token:{companyId:'taebaek',employeeId:'staff'}};
  await expect(executeDirectoryDeleteCommand(db,staff,{mode:'inspect',reference:{...reference,kind:'employee'}})).rejects.toMatchObject({code:'permission-denied'});
  await expect(executeDirectoryDeleteCommand(db,staff,{mode:'inspect',reference:{...reference,companyId:'punghoe'}})).rejects.toMatchObject({code:'permission-denied'});
  await expect(executeDirectoryDeleteCommand(db,staff,{mode:'apply',request:{}} as never)).rejects.toMatchObject({code:'invalid-argument'});
  expect(runTransaction).not.toHaveBeenCalled();
});
it('삭제 영수증 번호는 회사·UID·계획에 묶인다',()=>{
  const key=directoryDeleteReceiptId('taebaek','u','p');
  expect(key).toHaveLength(64);
  expect(key).not.toBe(directoryDeleteReceiptId('punghoe','u','p'));
  expect(key).not.toBe(directoryDeleteReceiptId('taebaek','other','p'));
});
it('대상 회사 누락·null은 preview와 apply 모두 삭제하지 않으며 actor legacy와 구분한다',async()=>{
  for(const current of [{name:'이전 자료'},{name:'이전 자료',companyId:null}]){
    const opening=directoryDeleteOpening(current),create=vi.fn(),remove=vi.fn();
    const tx={create,delete:remove,get:vi.fn(async(ref:{path:string})=>{
      if(ref.path.startsWith('directoryDeleteOperations/'))return {exists:false};
      if(ref.path==='employees/staff')return {exists:true,get:()=>undefined};
      return {exists:true,data:()=>current,updateTime:{seconds:123,nanoseconds:1}};
    })};
    const db={collection:(collection:string)=>({doc:(id:string)=>({path:collection+'/'+id})}),runTransaction:async(callback:(value:typeof tx)=>unknown)=>callback(tx)} as never;
    const actor={uid:'u',token:{companyId:'taebaek',employeeId:'staff'}};
    await expect(executeDirectoryDeleteCommand(db,actor,{mode:'preview',reference,opening})).rejects.toMatchObject({code:'failed-precondition'});
    expect(create).not.toHaveBeenCalled();expect(remove).not.toHaveBeenCalled();
    const result=await executeDirectoryDeleteCommand(db,actor,{mode:'apply',request:{version:1,reference,opening,expectedVersion:'123:000000001'}});
    expect(result).toMatchObject({status:'rejected',reference});
    expect(create).toHaveBeenCalledTimes(1);expect(remove).not.toHaveBeenCalled();
  }
});
