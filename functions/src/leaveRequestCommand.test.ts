import {expect,it,vi} from 'vitest';
import {executeLeaveRequestCommand,leaveBatchReceiptId} from './leaveRequestCommand';
import {leaveRequestExpected,type LeaveBatchRequest,type LeaveCreateRequest,type LeaveMutationRequest} from './shared/leaveRequestCommand';
const actor={uid:'actor',token:{companyId:'taebaek',employeeId:'e1',isAdmin:true}};
const row={id:'lv1',employeeId:'e1',employeeName:'직원',type:'연차',startDate:'2026-10-19',endDate:'2026-10-19',reason:'휴무',status:'approved',requestedAt:'2026-10-18',daysUsed:1,deductsLeave:true};
const request={version:1,companyId:'taebaek',planId:'plan1',rows:[row]};
it('인증·회사·관리자·초과행 검사는 DB를 읽거나 쓰기 전에 거절한다',async()=>{const collection=vi.fn(()=>{throw Error('DB접근');}),db={collection} as any;await expect(executeLeaveRequestCommand(db,undefined,{mode:'apply',request} as any)).rejects.toMatchObject({code:'unauthenticated'});await expect(executeLeaveRequestCommand(db,{...actor,token:{...actor.token,isAdmin:false}},{mode:'apply',request} as any)).rejects.toMatchObject({code:'permission-denied'});await expect(executeLeaveRequestCommand(db,actor,{mode:'apply',request:{...request,companyId:'punghoe'}} as any)).rejects.toMatchObject({code:'permission-denied'});await expect(executeLeaveRequestCommand(db,actor,{mode:'apply',request:{...request,rows:Array.from({length:401},(_,i)=>({...row,id:'lv'+i,employeeId:'e'+i}))}} as any)).rejects.toMatchObject({code:'invalid-argument'});expect(collection).not.toHaveBeenCalled();});
it('개인pending도본인만허용하고임의결재필드를거절한다',async()=>{const pending={...row,status:'pending',daysUsed:0} as any;delete pending.deductsLeave;const db={} as any,staff={...actor,token:{...actor.token,isAdmin:false}};await expect(executeLeaveRequestCommand(db,staff,{mode:'apply',request:{...request,rows:[{...pending,employeeId:'other'}]}} as any)).rejects.toMatchObject({code:'permission-denied'});await expect(executeLeaveRequestCommand(db,staff,{mode:'apply',request:{...request,rows:[{...pending,approvedBy:'fake'}]}} as any)).rejects.toMatchObject({code:'invalid-argument'});});
it('receipt번호는회사·로그인UID·planID별로격리한다',()=>{const key=leaveBatchReceiptId('taebaek','u','p');expect(key).toMatch(/^[a-f0-9]{64}$/);expect(leaveBatchReceiptId('taebaek','u','p')).toBe(key);for(const args of [['punghoe','u','p'],['taebaek','v','p'],['taebaek','u','q']])expect(leaveBatchReceiptId(...args as [string,string,string])).not.toBe(key);});

interface RuntimeRef {path:string}
function runtime(initial:Record<string,Record<string,unknown>>){
 const rows=new Map(Object.entries(initial)),writes:{path:string;data:Record<string,unknown>}[]=[],reads:string[]=[];
 const snapshot=(ref:RuntimeRef)=>{reads.push(ref.path);const value=rows.get(ref.path);return {exists:value!==undefined,data:()=>value};};
 const db={collection:(name:string)=>({doc:(id:string)=>({path:name+'/'+id})}),runTransaction:async<T>(work:(tx:unknown)=>Promise<T>)=>{
  const staged:typeof writes=[];
  const tx={get:async(ref:RuntimeRef)=>snapshot(ref),getAll:async(...refs:RuntimeRef[])=>refs.map(snapshot),create:(ref:RuntimeRef,data:Record<string,unknown>)=>{if(rows.has(ref.path))throw Error('이미 존재');staged.push({path:ref.path,data});},update:(ref:RuntimeRef,data:Record<string,unknown>)=>{if(!rows.has(ref.path))throw Error('부재');staged.push({path:ref.path,data:{...rows.get(ref.path),...data}});}};
  const result=await work(tx);for(const write of staged){rows.set(write.path,write.data);writes.push(write);}return result;
 }};
 return {db:db as unknown as import('firebase-admin').firestore.Firestore,rows,writes,reads};
}
const pendingRow=(employeeId='e1')=>({id:'lv-'+employeeId,employeeId,employeeName:'직원',type:'연차' as const,startDate:'2026-10-19',endDate:'2026-10-19',reason:'휴무',status:'pending' as const,requestedAt:'2026-10-18',daysUsed:0});
const companyRow=(company:unknown)=>company===undefined?{}:{companyId:company};
const mutationOf=(current:Record<string,unknown>):LeaveMutationRequest=>({version:2,kind:'mutation',companyId:'taebaek',planId:'mutation',targetId:'leave',expected:leaveRequestExpected(current),action:'approve'});

it('기존 휴가의 부재·회사 누락·null·타회사는 업무0과 원인별 거절 영수증으로 종결한다',async()=>{
 for(const company of ['absent',undefined,null,'punghoe']){
  const current={...pendingRow(),...companyRow(company)};
  const f=runtime({'employees/e1':{companyId:'taebaek'},...(company!=='absent'?{'leaveRequests/leave':current}:{})});
  const input=mutationOf(current),before=JSON.stringify(f.rows.get('leaveRequests/leave'));
  const result=await executeLeaveRequestCommand(f.db,actor,{mode:'apply',request:input});
  expect(result.status).toBe('rejected');expect(result.message).toContain(company==='absent'?'찾을 수 없습니다':company==null?'소속 회사가 지정되지':'현재 회사의 휴가가 아니므로');
  expect(JSON.stringify(f.rows.get('leaveRequests/leave'))).toBe(before);
  expect(f.writes).toHaveLength(1);expect(f.writes[0].path).toMatch(/^leaveRequestOperations\//);
 }
});
it('관리자 단체와 본인·대리 pending 모두 대상 직원의 명시 회사가 없거나 다르면 전체 등록0이다',async()=>{
 for(const company of [undefined,null,'punghoe'])for(const kind of ['batch','self','delegate']){
  const rows=kind==='batch'?[{...pendingRow(),status:'approved' as const,daysUsed:1,deductsLeave:true},{...pendingRow('e2'),status:'approved' as const,daysUsed:1,deductsLeave:true}]:[pendingRow(kind==='self'?'e1':'e2')];
  const badId=kind==='self'?'e1':'e2';
  const f=runtime({'employees/e1':{companyId:'taebaek'},['employees/'+badId]:companyRow(company)});
  const input:LeaveCreateRequest={version:1,companyId:'taebaek',planId:'create',rows};
  const result=await executeLeaveRequestCommand(f.db,actor,{mode:'apply',request:input});
  expect(result.status).toBe('rejected');expect(result.message).toContain(company==null?'소속 회사가 지정되지':'현재 회사에 속하지 않는 직원');
  expect(f.writes).toHaveLength(1);expect(f.writes[0].path).toMatch(/^leaveRequestOperations\//);expect(rows.every(row=>!f.rows.has('leaveRequests/'+row.id))).toBe(true);
 }
});
it('일반 직원 pending의 기존 회사 누락·null 판독은 유지하고 신규 휴가에는 회사를 주입한다',async()=>{
 for(const company of [undefined,null]){
  const f=runtime({'employees/e1':companyRow(company)}),input:LeaveCreateRequest={version:1,companyId:'taebaek',planId:'personal',rows:[pendingRow()]};
  expect((await executeLeaveRequestCommand(f.db,{...actor,token:{...actor.token,isAdmin:false}},{mode:'apply',request:input})).status).toBe('applied');
  expect(f.rows.get('leaveRequests/lv-e1')).toMatchObject({companyId:'taebaek',status:'pending'});
 }
});
it('명시 회사 관리자 생성과 기존 휴가의 legacy 직원 참조는 정상 처리한다',async()=>{
 const f=runtime({'employees/e1':{companyId:'taebaek'}}),input:LeaveCreateRequest={version:1,companyId:'taebaek',planId:'normal',rows:[pendingRow()]};
 expect((await executeLeaveRequestCommand(f.db,actor,{mode:'apply',request:input})).status).toBe('applied');
 const current={...pendingRow(),companyId:'taebaek'},legacy=runtime({'employees/e1':{},'leaveRequests/leave':current});
 expect((await executeLeaveRequestCommand(legacy.db,actor,{mode:'apply',request:mutationOf(current)})).status).toBe('applied');
 expect(legacy.rows.get('leaveRequests/leave')).toMatchObject({status:'approved',companyId:'taebaek'});
});
it('종전 완료 ACK는 대상 회사가 사라져도 먼저 반환하고 업무를 다시 쓰지 않는다',async()=>{
 const current={...pendingRow(),companyId:'taebaek'},f=runtime({'employees/e1':{companyId:'taebaek'},'leaveRequests/leave':current});
 const input:LeaveBatchRequest=mutationOf(current);
 expect((await executeLeaveRequestCommand(f.db,actor,{mode:'apply',request:input})).status).toBe('applied');
 f.rows.set('leaveRequests/leave',{...current,companyId:null});f.reads.length=0;const count=f.writes.length;
 expect((await executeLeaveRequestCommand(f.db,actor,{mode:'apply',request:input})).status).toBe('duplicate');
 expect((await executeLeaveRequestCommand(f.db,actor,{mode:'inspect',reference:{companyId:input.companyId,planId:input.planId}})).status).toBe('applied');
 expect(f.writes).toHaveLength(count);expect(f.reads.every(path=>path.startsWith('leaveRequestOperations/'))).toBe(true);
});
