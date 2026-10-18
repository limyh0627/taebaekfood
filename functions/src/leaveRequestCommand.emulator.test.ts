import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import * as admin from 'firebase-admin';
import {executeLeaveRequestCommand,leaveBatchReceiptId} from './leaveRequestCommand';
import {LEAVE_BATCH_OPERATIONS,leaveRequestExpected,type LeaveCreateRequest,type LeaveMutationRequest,type LeaveMutationAction} from './shared/leaveRequestCommand';
const host=process.env.FIRESTORE_EMULATOR_HOST;
const available=['127.0.0.1:8182','127.0.0.1:8082'].includes(host??'');
const actor={uid:'admin-actor',token:{companyId:'taebaek',employeeId:'admin-employee',isAdmin:true}};
let app:admin.app.App,db:admin.firestore.Firestore;
const cleanup=new Set<string>();
const ref=(path:string)=>{cleanup.add(path);return db.doc(path);};
const operation=(request:Pick<LeaveCreateRequest,'companyId'|'planId'>,uid=actor.uid)=>ref(LEAVE_BATCH_OPERATIONS+'/'+leaveBatchReceiptId(request.companyId,uid,request.planId));
async function make(count=2):Promise<LeaveCreateRequest>{const id=randomUUID(),rows=Array.from({length:count},(_,i)=>({id:'leave-'+id+'-'+i,employeeId:'employee-'+id+'-'+i,employeeName:'합성직원 '+i,type:'휴가' as const,startDate:'2026-10-19',endDate:'2026-10-20',reason:'단체 휴가',status:'approved' as const,requestedAt:'2026-10-18T12:00:01.123Z',daysUsed:2,deductsLeave:false}));const batch=db.batch();for(const row of rows){batch.set(ref('employees/'+row.employeeId),{name:row.employeeName,companyId:'taebaek'});ref('leaveRequests/'+row.id);}await batch.commit();const request:LeaveCreateRequest={version:1,companyId:'taebaek',planId:'plan-'+id,rows};operation(request);return request;}
const apply=(request:LeaveCreateRequest|LeaveMutationRequest,who=actor)=>executeLeaveRequestCommand(db,who,{mode:'apply',request});
const reference=(r:LeaveCreateRequest)=>({companyId:r.companyId,planId:r.planId});
describe.skipIf(!available)('휴가 원자 명령 실제 SDK',()=>{
 beforeAll(()=>{app=admin.initializeApp({projectId:'demo-leave-'+randomUUID().slice(0,8)},'leave-'+randomUUID());db=admin.firestore(app);});
 afterAll(async()=>{if(!db)return;const paths=[...cleanup];for(let i=0;i<paths.length;i+=400){const batch=db.batch();for(const path of paths.slice(i,i+400))batch.delete(db.doc(path));await batch.commit();}await app.delete();},60000);
 it('전체를 한 번 등록하고 동일 재시도는 삭제된 휴가도 다시 만들지 않는다',async()=>{const r=await make();const first=await apply(r);expect(first.status).toBe('applied');expect(first.requestIds).toEqual(r.rows.map(row=>row.id));for(const row of r.rows)expect((await ref('leaveRequests/'+row.id).get()).data()).toMatchObject({...row,companyId:'taebaek'});const deleted=ref('leaveRequests/'+r.rows[0].id);await deleted.delete();expect((await apply(r)).status).toBe('duplicate');expect((await deleted.get()).exists).toBe(false);expect((await executeLeaveRequestCommand(db,actor,{mode:'cancel',reference:reference(r)})).status).toBe('applied');expect((await deleted.get()).exists).toBe(false);expect((await operation(r).get()).get('status')).toBe('applied');});
 it('기존 휴가가 한 건이라도 있으면 전체 거절하고 삭제 후 재시도도 부활시키지 않는다',async()=>{const r=await make(),old=ref('leaveRequests/'+r.rows[0].id);await old.set({companyId:'taebaek',note:'원본보존'});expect((await apply(r)).status).toBe('rejected');expect((await old.get()).get('note')).toBe('원본보존');expect((await ref('leaveRequests/'+r.rows[1].id).get()).exists).toBe(false);await old.delete();expect((await apply(r)).status).toBe('rejected');expect((await old.get()).exists).toBe(false);});
 it('없는 직원과 다른 회사 직원이면 전체 거절하며 휴가를 한 건도 만들지 않는다',async()=>{for(const foreign of [false,true]){const r=await make();const emp=ref('employees/'+r.rows[1].employeeId);if(foreign)await emp.update({companyId:'punghoe'});else await emp.delete();expect((await apply(r)).status).toBe('rejected');for(const row of r.rows)expect((await ref('leaveRequests/'+row.id).get()).exists).toBe(false);}});
 it('원문이 없어도 reference만으로 중단하고 늦은 apply를 막는다',async()=>{const r=await make(),referenceOnly=reference(r);const cancelled=await executeLeaveRequestCommand(db,actor,{mode:'cancel',reference:referenceOnly});expect(cancelled).toMatchObject({status:'cancelled',requestHash:null,requestIds:[]});expect((await apply(r)).status).toBe('cancelled');expect((await executeLeaveRequestCommand(db,actor,{mode:'inspect',reference:referenceOnly})).status).toBe('cancelled');for(const row of r.rows)expect((await ref('leaveRequests/'+row.id).get()).exists).toBe(false);});
 it('동시 apply는 applied와 duplicate이며 cancel과 경합해도 전부 등록 또는 전부 중단이다',async()=>{const same=await make();expect((await Promise.all([apply(same),apply(same)])).map(r=>r.status).sort()).toEqual(['applied','duplicate']);const r=await make();await Promise.all([apply(r),executeLeaveRequestCommand(db,actor,{mode:'cancel',reference:reference(r)})]);const receipt=await operation(r).get(),exists=await Promise.all(r.rows.map(row=>ref('leaveRequests/'+row.id).get()));expect(exists.every(s=>s.exists)).toBe(receipt.get('status')==='applied');expect(exists.every(s=>!s.exists)).toBe(receipt.get('status')==='cancelled');},60000);
 it('inspect 부재는 unknown이고 쓰지 않으며 회사·계정·최초 hash는 섞지 않는다',async()=>{const r=await make();expect((await executeLeaveRequestCommand(db,actor,{mode:'inspect',reference:reference(r)})).status).toBe('unknown');expect((await operation(r).get()).exists).toBe(false);await apply(r);const other={...actor,uid:'another-admin'};expect((await executeLeaveRequestCommand(db,other,{mode:'inspect',reference:reference(r)})).status).toBe('unknown');await expect(executeLeaveRequestCommand(db,actor,{mode:'inspect',reference:reference(r),requestHash:'a'.repeat(64)})).rejects.toMatchObject({code:'already-exists'});await expect(apply({...r,rows:r.rows.map(row=>({...row,reason:'다른 원문'}))})).rejects.toMatchObject({code:'already-exists'});await expect(executeLeaveRequestCommand(db,{...actor,token:{...actor.token,companyId:'punghoe'}},{mode:'cancel',reference:reference(r)})).rejects.toMatchObject({code:'permission-denied'});});
 it('개인 pending도 자기 고정 요청을 저장·중단·조회하며 관리자 승인 부여로 위조하지 못한다',async()=>{const r=await make(1),row={...r.rows[0],type:'연차' as const,status:'pending' as const,requestedAt:'2026-10-18',daysUsed:0};delete (row as any).deductsLeave;const personal={...r,rows:[row]},staff={uid:'staff-actor',token:{companyId:'taebaek',employeeId:row.employeeId,isAdmin:false}};cleanup.add(LEAVE_BATCH_OPERATIONS+'/'+leaveBatchReceiptId(r.companyId,staff.uid,r.planId));expect((await apply(personal,staff)).status).toBe('applied');expect((await ref('leaveRequests/'+row.id).get()).get('status')).toBe('pending');await expect(apply({...r,planId:r.planId+'-forged'},staff)).rejects.toMatchObject({code:'permission-denied'});});
 it('400명은 한 트랜잭션으로 처리하고 401명은 휴가·영수증을 쓰기 전에 거절한다',async()=>{const r=await make(400);expect((await apply(r)).status).toBe('applied');const tooMany={...r,planId:r.planId+'-large',rows:[...r.rows,{...r.rows[0],id:'overflow',employeeId:'overflow'}]};await expect(apply(tooMany)).rejects.toMatchObject({code:'invalid-argument'});expect((await operation(tooMany).get()).exists).toBe(false);},60000);
 async function mutation(action:LeaveMutationAction, status='pending') {
  const create=await make(1),row={...create.rows[0],companyId:'taebaek',status};
  const target=ref('leaveRequests/'+row.id);await target.set(row);
  const request:LeaveMutationRequest={version:2,kind:'mutation',companyId:'taebaek',planId:'mutation-'+randomUUID(),targetId:row.id,expected:leaveRequestExpected(row),...action};
  operation(request);return {request,target,row};
 }
 it('같은 화면원문 동시결재는 한 건만 적용하며 응답유실 inspect와 삭제후 duplicate는 재생성하지 않는다',async()=>{
  const {request,target}=await mutation({action:'approve'});
  const reject={...request,planId:request.planId+'-reject',action:'reject' as const};operation(reject);
  const results=await Promise.all([apply(request),apply(reject)]);
  expect(results.map(r=>r.status).sort()).toEqual(['applied','rejected']);
  const winner=results[0].status==='applied'?request:reject;
  expect((await executeLeaveRequestCommand(db,actor,{mode:'inspect',reference:reference(winner as any)})).status).toBe('applied');
  await target.delete();expect((await apply(winner)).status).toBe('duplicate');expect((await target.get()).exists).toBe(false);
 },60000);
 it('없는 대상과 바뀐 optional존재도 거절하고 거절영수증은 나중에 원문이 돌아와도 적용하지 않는다',async()=>{
  const {request,target,row}=await mutation({action:'approve'});
  await target.update({deductsLeave:admin.firestore.FieldValue.delete()});
  expect((await apply(request)).status).toBe('rejected');await target.set(row);
  expect((await apply(request)).status).toBe('rejected');expect((await target.get()).get('status')).toBe('pending');
  const missing={...request,planId:request.planId+'-missing'};operation(missing);await target.delete();expect((await apply(missing)).status).toBe('rejected');expect((await target.get()).exists).toBe(false);
 });
 it('직원본인만 승인휴가 취소·변경신청 가능하고 결재권한은 만들지 않는다',async()=>{
  const {request,target,row}=await mutation({action:'request-cancel'},'approved');
  const staff={uid:'employee-'+randomUUID(),token:{companyId:'taebaek',employeeId:row.employeeId,isAdmin:false}};operation(request,staff.uid);
  const other={...staff,uid:'other-'+randomUUID(),token:{...staff.token,employeeId:'other'}};
  await expect(apply(request,other)).rejects.toMatchObject({code:'permission-denied'});
  await expect(apply({...request,action:'approve'},staff)).rejects.toMatchObject({code:'permission-denied'});
  expect((await apply(request,staff)).status).toBe('applied');expect((await target.get()).get('status')).toBe('cancel_pending');
  const change=await mutation({action:'request-modify',modifyRequest:{startDate:'2026-10-21',endDate:'2026-10-21',reason:'변경',daysUsed:0}},'approved');
  const owner={...staff,token:{...staff.token,employeeId:change.row.employeeId}};operation(change.request,owner.uid);
  expect((await apply(change.request,owner)).status).toBe('applied');expect((await change.target.get()).get('modifyRequest')).toMatchObject({status:'pending',daysUsed:0});
 });
 it('변경승인·반려는 원상태를 보존하고 취소완료 뒤 변경으로 부활하지 않는다',async()=>{
  for(const action of ['approve-modify','reject-modify'] as const){
   const item=await mutation({action},'cancel_pending');const modify={startDate:'2026-10-22',endDate:'2026-10-23',reason:'변경사유',daysUsed:2,status:'pending'};
   await item.target.update({modifyRequest:modify});item.request.expected=leaveRequestExpected((await item.target.get()).data());
   expect((await apply(item.request)).status).toBe('applied');const stored=(await item.target.get()).data()!;
   expect(stored.status).toBe('cancel_pending');expect(stored.modifyRequest.status).toBe(action==='approve-modify'?'approved':'rejected');expect(stored.startDate).toBe(action==='approve-modify'?modify.startDate:item.row.startDate);
   const stale={...item.request,planId:item.request.planId+'-after'};operation(stale);await item.target.update({status:'cancelled'});stale.expected=leaveRequestExpected((await item.target.get()).data());expect((await apply(stale)).status).toBe('rejected');expect((await item.target.get()).get('status')).toBe('cancelled');
  }
 });
 it('관리자취소는 claims직원의 현재 이름으로 자국을 남기며 legacy날짜null을 재해석하지 않는다',async()=>{
  await ref('employees/'+actor.token.employeeId).set({companyId:'taebaek',name:'실제 관리자'});
  const {request,target}=await mutation({action:'cancel',reason:'  사유  '},'approved');await target.update({startDate:'옛날짜',deductsLeave:null});request.expected=leaveRequestExpected((await target.get()).data());
  expect((await apply(request)).status).toBe('applied');expect((await target.get()).data()).toMatchObject({status:'cancelled',cancelledBy:actor.token.employeeId,cancelledByName:'실제 관리자',cancelReason:'사유',startDate:'옛날짜',deductsLeave:null});
 });
 it('mutation중단 fence와 apply경합은 업무전체적용 또는 중단이며 inspect부재는 쓰지 않는다',async()=>{
  const {request,target}=await mutation({action:'approve'});
  expect((await executeLeaveRequestCommand(db,actor,{mode:'inspect',reference:reference(request as any)})).status).toBe('unknown');expect((await operation(request).get()).exists).toBe(false);
  await Promise.all([apply(request),executeLeaveRequestCommand(db,actor,{mode:'cancel',reference:reference(request as any)})]);
  const receipt=await operation(request).get();expect((await target.get()).get('status')).toBe(receipt.get('status')==='applied'?'approved':'pending');
  if(receipt.get('status')==='cancelled')expect((await apply(request)).status).toBe('cancelled');
 },60000);
 it('v2 일곱 동작은 회사 누락·null·타회사 휴가를 수정하지 않고 거절 영수증으로 종결한다', async () => {
  const actions: LeaveMutationAction[] = [{action:'approve'},{action:'reject'},{action:'request-cancel'},{action:'cancel',reason:'합성 중단'},{action:'request-modify',modifyRequest:{startDate:'2026-10-21',endDate:'2026-10-21',reason:'합성 변경',daysUsed:1}},{action:'approve-modify'},{action:'reject-modify'}];
  for (const company of [undefined,null,'punghoe']) for (const action of actions) {
   const pending = action.action === 'approve' || action.action === 'reject';
   const item = await mutation(action,pending?'pending':'approved');
   await item.target.update({companyId:company===undefined?admin.firestore.FieldValue.delete():company,...(action.action==='approve-modify'||action.action==='reject-modify'?{modifyRequest:{startDate:'2026-10-21',endDate:'2026-10-21',reason:'변경',daysUsed:1,status:'pending'}}:{})});
   const before=await item.target.get();item.request.expected=leaveRequestExpected(before.data());
   const result=await apply(item.request);expect(result.status).toBe('rejected');expect(result.message).toContain(company==null?'소속 회사':'현재 회사의 휴가가 아니므로');
   const after=await item.target.get();expect(after.data()).toEqual(before.data());expect(after.updateTime!.isEqual(before.updateTime!)).toBe(true);
   expect(result.requestIds).toEqual([item.request.targetId]);expect((await operation(item.request).get()).data()).toMatchObject({status:'rejected',requestHash:expect.stringMatching(/^[a-f0-9]{64}$/),requestText:expect.any(String)});
   expect((await executeLeaveRequestCommand(db,actor,{mode:'inspect',reference:{companyId:item.request.companyId,planId:item.request.planId}})).status).toBe('rejected');
   expect((await apply(item.request)).status).toBe('rejected');
  }
 },60000);
 it('관리자 단체 등록의 한 직원만 회사 누락·null·타회사여도 전체 휴가를 쓰지 않는다',async()=>{
  for(const company of [undefined,null,'punghoe']){
   const request=await make(2),employee=ref('employees/'+request.rows[1].employeeId);
   await employee.update({companyId:company===undefined?admin.firestore.FieldValue.delete():company});const before=await employee.get();
   const result=await apply(request);expect(result.status).toBe('rejected');expect(result.requestIds).toEqual(request.rows.map(row=>row.id));
   for(const row of request.rows)expect((await ref('leaveRequests/'+row.id).get()).exists).toBe(false);
   expect((await employee.get()).data()).toEqual(before.data());expect((await operation(request).get()).get('status')).toBe('rejected');
   await employee.update({companyId:'taebaek'});expect((await apply(request)).status).toBe('rejected');for(const row of request.rows)expect((await ref('leaveRequests/'+row.id).get()).exists).toBe(false);
  }
 });
 it('관리자 자기·대리 pending도 대상 직원의 명시 회사가 없거나 다르면 거절한다',async()=>{
  const actorRef=ref('employees/'+actor.token.employeeId),original=await actorRef.get();
  try{
   for(const own of [true,false])for(const company of [undefined,null,'punghoe']){
    const base=await make(1),{deductsLeave:_unused,...source}=base.rows[0];
    const row={...source,employeeId:own?actor.token.employeeId:source.employeeId,type:'연차' as const,status:'pending' as const,daysUsed:0};
    const request:LeaveCreateRequest={...base,rows:[row]},employee=ref('employees/'+row.employeeId);
    await employee.set({name:'합성 신청대상',...(company===undefined?{}:{companyId:company})});
    expect((await apply(request)).status).toBe('rejected');expect((await ref('leaveRequests/'+row.id).get()).exists).toBe(false);expect((await operation(request).get()).get('status')).toBe('rejected');
   }
  }finally{if(original.exists)await actorRef.set(original.data()!);else await actorRef.delete();}
 });
 it('비관리자 본인 pending의 기존 회사 누락·null 판독은 그대로 허용한다',async()=>{
  for(const company of [undefined,null]){
   const base=await make(1),{deductsLeave:_unused,...source}=base.rows[0],row={...source,type:'연차' as const,status:'pending' as const,daysUsed:0};
   const request:LeaveCreateRequest={...base,rows:[row]},staff={uid:'legacy-staff-'+randomUUID(),token:{companyId:'taebaek',employeeId:row.employeeId,isAdmin:false}};operation(request,staff.uid);
   await ref('employees/'+row.employeeId).update({companyId:company===undefined?admin.firestore.FieldValue.delete():company});
   expect((await apply(request,staff)).status).toBe('applied');expect((await ref('leaveRequests/'+row.id).get()).data()).toMatchObject({status:'pending',companyId:'taebaek'});
  }
 });
 it('종전 create·mutation ACK는 이후 회사 누락보다 우선하고 삭제된 휴가를 재생성하지 않는다',async()=>{
  const create=await make(1);expect((await apply(create)).status).toBe('applied');await ref('employees/'+create.rows[0].employeeId).update({companyId:admin.firestore.FieldValue.delete()});await ref('leaveRequests/'+create.rows[0].id).delete();expect((await apply(create)).status).toBe('duplicate');expect((await ref('leaveRequests/'+create.rows[0].id).get()).exists).toBe(false);
  const item=await mutation({action:'approve'});expect((await apply(item.request)).status).toBe('applied');await item.target.update({companyId:admin.firestore.FieldValue.delete()});const before=await item.target.get();
  expect((await executeLeaveRequestCommand(db,actor,{mode:'inspect',reference:{companyId:item.request.companyId,planId:item.request.planId}})).status).toBe('applied');expect((await apply(item.request)).status).toBe('duplicate');expect((await item.target.get()).updateTime!.isEqual(before.updateTime!)).toBe(true);
  await item.target.delete();expect((await apply(item.request)).status).toBe('duplicate');expect((await item.target.get()).exists).toBe(false);
 });

});
