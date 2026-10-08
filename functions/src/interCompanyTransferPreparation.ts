import { readClaimsAfterReturns } from './returnClaimReader';
import * as admin from 'firebase-admin';
import {HttpsError,onCall} from 'firebase-functions/v2/https';
import {assertInterCompanyAuthority} from './interCompanyAuthority';
import {assertReleaseActive,assertVoucherDateAllowed,releaseGateRef} from './releaseGate';
import {cashFromEntry,claimFromStatement} from './partnerPaymentCommand';
import {PartnerPaymentValidationError,planPartnerPayment,type Claim,type PaymentCash,type PaymentSettlement} from './partnerPaymentPlan';
type Claims={employeeId?:unknown;companyId?:unknown;isAdmin?:unknown};
const name=(company:string)=>company==='taebaek'?'태백푸드':'풍회유통';
function fail(message:string):never{throw new HttpsError('failed-precondition',message);}
/** 양사 권한을 확인한 뒤 각 회사의 실제 선택지와 정산 revision만 돌려준다. */
export async function prepareInterCompanyTransfer(db:admin.firestore.Firestore,uid:string,claims:Claims,input:{from:string;to:string;tradeDate:string;releaseId:string}){
 if(!input||!['taebaek','punghoe'].includes(input.from)||!['taebaek','punghoe'].includes(input.to)||input.from===input.to||typeof claims.employeeId!=='string'||!uid)fail('회사이체 요청과 직원 인증을 확인해 주세요.');
 return db.runTransaction(async tx=>{
  const gate=await tx.get(releaseGateRef(db));
  const [grant,employee,...cutovers]=await Promise.all([tx.get(db.collection('companyTransferGrants').doc(uid)),tx.get(db.collection('employees').doc(claims.employeeId as string)),...[input.from,input.to].map(company=>tx.get(db.collection('appMeta').doc(`companyTransferCutover_${company}`)))]);
  assertReleaseActive(gate,input.releaseId);assertVoucherDateAllowed(gate,input.from,input.tradeDate);assertVoucherDateAllowed(gate,input.to,input.tradeDate);
  try{assertInterCompanyAuthority(claims,input.from,input.to,grant.data(),uid);}catch{fail('양사 관리자 권한을 증명할 수 없습니다.');}
  const staff=employee.data();if(!staff||staff.authUid!==uid||staff.companyId!==input.from||staff.adminAccess!==true||staff.status==='out')fail('현재 직원 관리자 권한이 없습니다.');
  cutovers.forEach((snap,index)=>{const row=snap.data();if(!row||row.companyId!==[input.from,input.to][index]||row.enabled!==true||row.legacyWritersBlocked!==true||row.auditPassed!==true)fail('회사이체 writer 전환이 준비되지 않았습니다.');});
  const companies=[input.from,input.to];const accounts=await Promise.all(companies.map(company=>tx.get(db.collection('cashAccounts').where('companyId','==',company))));
  const partners=await Promise.all(companies.map((company,index)=>tx.get(db.collection('partners').where('companyId','==',company).where('name','==',name(companies[1-index])))));
  const options=await Promise.all(companies.map(async(company,index)=>{
   const bankRows=accounts[index].docs.filter(snap=>snap.data().active===true&&snap.data().type==='통장').map(snap=>({...snap.data(),id:snap.id}));
   const partnerRows=await Promise.all(partners[index].docs.map(async partner=>{
    try {
    const [state,statements,cash,settlements,returns]=await Promise.all([tx.get(db.collection('appMeta').doc(`partnerPaymentState_${company}_${partner.id}`)),tx.get(db.collection('issuedStatements').where('partnerId','==',partner.id)),tx.get(db.collection('cashEntries').where('partnerId','==',partner.id)),tx.get(db.collection('settlements').where('companyId','==',company)),tx.get(db.collection('returnApplications').where('partnerId','==',partner.id))]);
    const revision=state.data()?.revision??0;if(!Number.isSafeInteger(revision)||revision<0||state.exists&&(state.data()?.companyId!==company||state.data()?.partnerId!==partner.id))fail('거래처 정산 상태를 확인해 주세요.');
    const claimRows=await readClaimsAfterReturns(db,tx,statements.docs.map(snap=>claimFromStatement(snap.id,snap.data())).filter((row):row is Claim=>row!==null),returns.docs.filter(snap=>snap.data().companyId===company).map(snap=>({...snap.data(),id:snap.id})) as any,statements.docs.map(snap=>({...snap.data(),id:snap.id})));
    const plan=planPartnerPayment({companyId:company,partnerId:partner.id,direction:index===0?'출금':'입금',amount:Number.MAX_SAFE_INTEGER,pin:false,allocations:[],claims:claimRows,cashEntries:cash.docs.map(snap=>cashFromEntry(snap.id,snap.data())).filter((row):row is PaymentCash=>row!==null),settlements:settlements.docs.map(snap=>({id:snap.id,...snap.data()} as PaymentSettlement))});
    if(plan.ignoredOrphanSettlementIds.length)fail('양사 정산 원본이 불완전합니다.');
    return {id:partner.id,companyId:company,name:partner.data().name,revision,available:plan.applications.reduce((sum,row)=>sum+row.amount,0)};
    } catch(error) { if(error instanceof PartnerPaymentValidationError) throw new HttpsError('failed-precondition',error.message); throw error; }
   }));
   return {companyId:company,accounts:bankRows,partners:partnerRows};
  }));
  return {from:options[0],to:options[1],releaseId:input.releaseId};
 });
}
export const prepareInterCompanyTransferCommand=onCall({region:'asia-northeast3'},async request=>{if(!request.auth)throw new HttpsError('unauthenticated','로그인이 필요합니다.');const {employeeId,companyId,isAdmin}=request.auth.token;return prepareInterCompanyTransfer(admin.firestore(),request.auth.uid,{employeeId,companyId,isAdmin},request.data);});
