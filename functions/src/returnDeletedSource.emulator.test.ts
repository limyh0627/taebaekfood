import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {readFileSync} from 'node:fs';
import {doc,getDoc} from 'firebase/firestore';
import {afterAll,beforeAll,describe,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import * as admin from 'firebase-admin';
vi.mock('firebase-functions/v2/https',()=>({HttpsError:class extends Error{constructor(public code:string,message:string,public details?:unknown){super(message)}},onCall:(_:unknown,h:unknown)=>h}));
import {processGeneralStockReturn} from './processReturnCommand';
import {deleteIssuedStatement,statementOriginalHash} from './deleteIssuedStatementCommand';
import {recordPartnerPayment} from './partnerPaymentCommand';
import {allocatePartnerCash} from '../../src/features/admin/cashLedger';
import {voucherSequenceKey} from './voucherIssue';
const id=`return-delete-${randomUUID()}`,co='taebaek',date='2026-10-03',partner=`${id}-partner`,source=`${id}-source`,item=`${id}-item`,bank=`${id}-bank`;
let app:admin.app.App,db:admin.firestore.Firestore;
let rulesEnv:Awaited<ReturnType<typeof initializeTestEnvironment>>;
const paths=new Set<string>();
const ref=(c:string,i:string)=>db.collection(c).doc(i);
async function put(c:string,i:string,d:Record<string,unknown>){paths.add(`${c}/${i}`);await ref(c,i).set(d)}
describe.skipIf(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8082')('RETURN then deleted source read contract',()=>{
 beforeAll(async()=>{app=admin.initializeApp({projectId:'demo-taebaekfood-local'},id);db=admin.firestore(app);rulesEnv=await initializeTestEnvironment({projectId:'demo-taebaekfood-local',firestore:{host:'127.0.0.1',port:8082,rules:readFileSync('firestore.rules','utf8')}})});
 afterAll(async()=>{for(const c of ['returnOperations','returnApplications','returnRequests','issuedStatements','cashEntries','settlements','itemReceipts','partnerPaymentOperations','voucherMutationOperations']){for(const r of (await db.collection(c).get()).docs){if(r.id.includes(id)||r.data().partnerId===partner||r.data().operationId?.includes(id))paths.add(r.ref.path)}}paths.add(`appMeta/partnerPaymentState_${co}_${partner}`);for(const p of paths)await db.doc(p).delete();for(const p of paths)expect((await db.doc(p).get()).exists).toBe(false);await rulesEnv.cleanup();await app.delete()});
 it('반품100의 원전표를 삭제해도 새매출200에 대한 수금100을 발행할 수 있다',async()=>{
 await Promise.all([
 put('partners',partner,{companyId:co,name:'합성 거래처'}),put('cashAccounts',bank,{companyId:co,active:true,type:'통장'}),
 put('items',item,{companyId:co,name:'일반 상품',type:'goods',stock:5,unit:'개'}),
 put('issuedStatements',source,{companyId:co,partnerId:partner,type:'매출',tradeDate:date,totalSupply:200,totalTax:0,totalAmount:200,items:[{itemId:item,accountCode:'404',qty:2,supply:200,tax:0,total:200}]}),
 put('returnRequests',`${id}-request`,{companyId:co,partnerId:partner,linkedStatementId:source,returnType:'매출',status:'pending',totalAmount:100,items:[{itemId:item,quantity:1,isResellable:true}]}),
 ...['404','108'].map(code=>put('accountCodes',`${id}-${code}`,{companyId:co,code})),
 put('appMeta','releaseCutover',{releaseId:id,status:'active',voucherNotBefore:{taebaek:date,punghoe:date}}),
 ...['returnCutover','partnerPaymentCutover'].map(p=>put('appMeta',`${p}_${co}`,{companyId:co,enabled:true,legacyWritersBlocked:true,auditPassed:true})),
 ...['반품',''].map(prefix=>put('appMeta',voucherSequenceKey(co,date,prefix),{companyId:co,tradeDate:date,prefix,last:0}))]);
 await processGeneralStockReturn(db,co,id,{operationId:`${id}-return`,returnRequestId:`${id}-request`,tradeDate:date,expectedPartnerRevision:0,releaseId:id});
 const journal=ref('issuedStatements',`return-${id}-return`),application=ref('returnApplications',`return-${id}-return`);
 const beforeJournal=(await journal.get()).data(),beforeApplication=(await application.get()).data();
 const original=(await ref('issuedStatements',source).get()).data()!;
 await deleteIssuedStatement(db,co,id,{operationId:`${id}-delete`,statementId:source,releaseId:id,expectedRevision:0,expectedOriginalHash:statementOriginalHash(original)});
 await put('issuedStatements',`${id}-new`,{companyId:co,partnerId:partner,type:'매출',tradeDate:date,totalSupply:200,totalTax:0,totalAmount:200,items:[{accountCode:'404',qty:2,supply:200,tax:0,total:200}]});
 let error:unknown;
 try{await recordPartnerPayment(db,co,id,{operationId:`${id}-payment`,tradeDate:date,partnerId:partner,direction:'입금',amount:100,cashAccountId:bank,pin:false,allocations:[],expectedRevision:2,releaseId:id})}catch(e){error=e}
 expect((await ref('issuedStatements',source).get()).exists).toBe(false);
 expect((await journal.get()).data()).toEqual(beforeJournal);expect((await application.get()).data()).toEqual(beforeApplication);
 expect((await ref('items',item).get()).data()?.stock).toBe(6);
 if(error){expect((await ref('cashEntries',`${id}-payment`).get()).exists).toBe(false);expect((await ref('partnerPaymentOperations',`${id}-payment`).get()).data()?.status).toBe('rejected')}
 expect(error).toBeUndefined();
 const statements=(await db.collection('issuedStatements').where('partnerId','==',partner).get()).docs.map(doc=>({...doc.data(),id:doc.id}));
 const client=rulesEnv.authenticatedContext(id,{employeeId:id,companyId:co,isAdmin:true}).firestore();
 const sourceQuery=await getDoc(doc(client,'issuedStatements',source));
 expect(sourceQuery.exists()).toBe(false);
 const operations=(await db.collection('returnOperations').get()).docs.map(doc=>({...doc.data(),id:doc.id,sourcePresence:{[source]:sourceQuery.exists()}}));
 const cash=(await db.collection('cashEntries').where('partnerId','==',partner).get()).docs.map(doc=>({...doc.data(),id:doc.id}));
 const balance=allocatePartnerCash(partner,'매출',statements as any,cash as any,[],undefined,operations as any);
 expect(balance.get(`${id}-new`)).toBe(0);expect(balance.get(`return-${id}-return`)).toBe(0);
 });
 it('실존 타회사 원전표는 부재로 해석하지 않고 Rules 거절을 보존한다',async()=>{
  await put('issuedStatements',`${id}-foreign`,{companyId:'punghoe',partnerId:'foreign',type:'매출',totalAmount:1});
  const client=rulesEnv.authenticatedContext(id,{employeeId:id,companyId:co,isAdmin:true}).firestore();
  await expect(getDoc(doc(client,'issuedStatements',`${id}-foreign`))).rejects.toMatchObject({code:'permission-denied'});
 });
});
