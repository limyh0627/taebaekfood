import {afterAll,beforeAll,describe,it,expect} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import * as admin from 'firebase-admin';
import {editIssuedStatement} from './editIssuedStatementCommand';
const available=['127.0.0.1:8082','127.0.0.1:8182'].includes(process.env.FIRESTORE_EMULATOR_HOST??'');
const runId='approval-'+randomUUID(), statementId=runId+'-stmt', pendingId=runId+'-pending', operationId=runId+'-operation';
let app:admin.app.App,db:admin.firestore.Firestore;
const ref=(group:string,id:string)=>db.collection(group).doc(id);
const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])):value;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const patch={tradeDate:'2026-10-08',partnerId:'same',partnerName:'같은 거래처',totalSupply:100,totalTax:10,totalAmount:110,items:[{name:'상품',qty:1,price:100,supply:100,tax:10,total:110}]};
const pending={companyId:'taebaek',statementId,status:'pending',createdAt:'2026-10-08T00:00:00Z',createdBy:'직원',proposedData:patch};
const command=()=>({auth:{uid:'uid',token:{isAdmin:true,employeeId:'employee',companyId:'taebaek'}},data:{statementId,patch,expectedRevision:0,operationId,releaseId:runId,pendingEditRequestId:pendingId,pendingEditRequestHash:hash(pending)}});
async function seed(){await ref('voucherMutationOperations',operationId).delete();await Promise.all([
 ref('appMeta','releaseCutover').set({status:'active',releaseId:runId,testRunId:runId}),
 ref('issuedStatements',statementId).set({companyId:'taebaek',partnerId:'same',totalSupply:200,totalTax:20,totalAmount:220,mutationRevision:0}),
 ref('pendingStatementEdits',pendingId).set(pending),
]);}
describe.skipIf(!available)('전표 수정 요청의 원자 승인',{timeout:30000},()=>{
 beforeAll(()=>{app=admin.initializeApp({projectId:'demo-taebaekfood-local'},runId);db=admin.firestore(app);});
 afterAll(async()=>{if(!db)return;for(const [group,id]of [['issuedStatements',statementId],['pendingStatementEdits',pendingId],['voucherMutationOperations',operationId]])await ref(group,id).delete();const gate=ref('appMeta','releaseCutover');if((await gate.get()).get('testRunId')===runId)await gate.delete();await app.delete();});
 it('동시 승인과 동일 재시도는 전표·요청을 한 번만 바꾼다',async()=>{await seed();const results=await Promise.all([editIssuedStatement(db,command()),editIssuedStatement(db,command())]);expect(results.map(r=>r.status).sort()).toEqual(['applied','duplicate']);expect((await ref('issuedStatements',statementId).get()).data()).toMatchObject({...patch,mutationRevision:1});expect((await ref('pendingStatementEdits',pendingId).get()).data()).toMatchObject({status:'approved',approvalOperationId:operationId,approvedBy:'employee'});const before=await ref('issuedStatements',statementId).get();expect((await editIssuedStatement(db,command())).status).toBe('duplicate');expect((await ref('issuedStatements',statementId).get()).updateTime?.isEqual(before.updateTime!)).toBe(true);});
 it('원문 요청 변경·다른 회사·revision 충돌은 두 원문을 보존한다',async()=>{for(const mode of ['changed','foreign','revision']){await seed();if(mode==='changed')await ref('pendingStatementEdits',pendingId).update({createdAt:'2026-10-09T00:00:00Z'});if(mode==='foreign')await ref('pendingStatementEdits',pendingId).update({companyId:'punghoe'});if(mode==='revision')await ref('issuedStatements',statementId).update({mutationRevision:1});const before=await Promise.all([ref('issuedStatements',statementId).get(),ref('pendingStatementEdits',pendingId).get()]);await expect(editIssuedStatement(db,command())).rejects.toThrow();const after=await Promise.all([ref('issuedStatements',statementId).get(),ref('pendingStatementEdits',pendingId).get()]);after.forEach((snap,i)=>expect(snap.updateTime?.isEqual(before[i].updateTime!)).toBe(true));expect((await ref('voucherMutationOperations',operationId).get()).exists).toBe(false);}});
 it('서버 합계 검증 실패 또는 변경 patch는 승인 상태를 남기지 않는다',async()=>{await seed();const bad={...patch,totalAmount:90};await ref('pendingStatementEdits',pendingId).update({proposedData:bad});const input=command();input.data.patch=bad;input.data.pendingEditRequestHash=hash({...pending,proposedData:bad});await expect(editIssuedStatement(db,input)).rejects.toThrow('합계');expect((await ref('pendingStatementEdits',pendingId).get()).get('status')).toBe('pending');expect((await ref('issuedStatements',statementId).get()).get('mutationRevision')).toBe(0);await seed();const forged=command();forged.data.patch={...patch,partnerName:'바꾼 표시'};await expect(editIssuedStatement(db,forged)).rejects.toThrow('변경');});
 it('승인 뒤 원문을 변조하면 기존 성공 receipt로 덮지 않는다',async()=>{await seed();await editIssuedStatement(db,command());await ref('pendingStatementEdits',pendingId).update({createdBy:'다른 직원'});await expect(editIssuedStatement(db,command())).rejects.toThrow('근거');expect((await ref('issuedStatements',statementId).get()).get('mutationRevision')).toBe(1);});
 it('거래처 변경 기존 guard와 일반 수정 API는 유지한다',async()=>{await seed();const data=command();const changed={...patch,partnerId:'other'};data.data.patch=changed;data.data.pendingEditRequestHash=hash({...pending,proposedData:changed});await ref('pendingStatementEdits',pendingId).update({proposedData:changed});await expect(editIssuedStatement(db,data)).rejects.toThrow('거래처 변경');await seed();const ordinary:any=command();delete ordinary.data.pendingEditRequestId;delete ordinary.data.pendingEditRequestHash;ordinary.data.patch={memo:'일반 수정'};expect((await editIssuedStatement(db,ordinary)).status).toBe('applied');expect((await ref('pendingStatementEdits',pendingId).get()).get('status')).toBe('pending');});
 it('같은 원료의 미입고 20·25kg 행을 원자 수정하고 이미 입고된 수량 변경만 보호한다',async()=>{
  const rawId=runId+'-raw',poId=runId+'-po'; await seed();
  const line=(index:number,unitKg:number,qty:number)=>({itemId:rawId,name:'원료',qty,price:110,supply:100*qty,tax:10*qty,total:110*qty,sourceLineIndex:index,purchaseUnitId:runId+'-u'+unitKg,purchaseUnit:'포',purchaseQty:qty,unitKg,inventoryQty:qty*unitKg});
  const oldLines=[line(0,20,1),line(1,25,1)],newLines=[line(0,20,2),line(1,25,1)];
  await ref('items',rawId).set({companyId:'taebaek',type:'raw',subtype:'벌크'});
  await ref('issuedStatements',statementId).update({type:'매입',items:oldLines});
  await ref('purchaseOrders',poId).set({companyId:'taebaek',partnerId:'same',linkedStatementId:statementId,status:'invoiced',items:oldLines.map(({qty,...row})=>({...row,quantity:qty,unit:'kg'}))});
  const request={auth:command().auth,data:{statementId,releaseId:runId,expectedRevision:0,operationId,patch:{items:newLines,totalSupply:300,totalTax:30,totalAmount:330}}};
  try{
   // 현재 등록표가 없어도 같은 저장 단위의 수량 수정은 그 kg를 유지한다.
   expect((await editIssuedStatement(db,request)).status).toBe('applied');
   expect((await ref('purchaseOrders',poId).get()).get('items')).toMatchObject([{sourceLineIndex:0,quantity:2,inventoryQty:40},{sourceLineIndex:1,quantity:1,inventoryQty:25}]);
   const reordered={...request,data:{...request.data,expectedRevision:1,operationId:runId+'-reorder',patch:{items:[newLines[1],newLines[0]],totalSupply:300,totalTax:30,totalAmount:330}}};
   await expect(editIssuedStatement(db,reordered)).rejects.toThrow('순서');
   expect((await ref('issuedStatements',statementId).get()).get('items')).toEqual(newLines);
   expect((await ref('purchaseOrders',poId).get()).get('items')[0].quantity).toBe(2);
   await ref('purchaseOrders',poId).update({status:'received'});
   const next={...request,data:{...request.data,expectedRevision:1,operationId:runId+'-received',patch:{items:[line(0,20,3),line(1,25,1)],totalSupply:400,totalTax:40,totalAmount:440}}};
   await expect(editIssuedStatement(db,next)).rejects.toThrow('입고');
   expect((await ref('purchaseOrders',poId).get()).get('items')[0].quantity).toBe(2);
   const moneyOnly={...request,data:{...request.data,expectedRevision:1,operationId:runId+'-money',patch:{memo:'금액·메모 수정 가능'}}};
   expect((await editIssuedStatement(db,moneyOnly)).status).toBe('applied');
  } finally {await Promise.all([ref('items',rawId).delete(),ref('purchaseOrders',poId).delete(),ref('voucherMutationOperations',runId+'-money').delete(),ref('voucherMutationOperations',runId+'-received').delete(),ref('voucherMutationOperations',runId+'-reorder').delete()]);}
 });
});
