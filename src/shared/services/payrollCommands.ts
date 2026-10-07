import {doc,getDoc} from 'firebase/firestore';
import {httpsCallable} from 'firebase/functions';
import {auth,authReady,db,functions} from '../firebase';
import {payrollDocId,type CompanyId,type PayrollLine} from '../types';

export type PayrollCommandInput={yearMonth:string;payDate:string;lines:PayrollLine[];expectedRevision:number};
async function ownCompany(companyId:CompanyId){
 await authReady;const user=auth.currentUser;
 if(!user)throw new Error('로그인이 만료되었습니다.');
 const {claims}=await user.getIdTokenResult();
 if(auth.currentUser?.uid!==user.uid||claims.companyId!==companyId||claims.isAdmin!==true)throw new Error('급여대장의 관리자 회사 권한이 바뀌었습니다.');
}
async function current(companyId:CompanyId,input:PayrollCommandInput){
 if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)throw new Error('급여대장 원본 버전이 잘못되었습니다.');
 await ownCompany(companyId);
 const snap=await getDoc(doc(db,'payrolls',payrollDocId(companyId,input.yearMonth)));
 const row=snap.data();
 if(row&&(row.companyId??'taebaek')!==companyId)throw new Error('급여대장의 회사가 맞지 않습니다.');
 const revision=row?.revision??0;
 if(!Number.isSafeInteger(revision)||revision<0)throw new Error('급여대장 버전이 잘못되었습니다.');
 return {row,revision};
}
export async function savePayrollDraft(companyId:CompanyId,input:PayrollCommandInput){
 await current(companyId,input);await ownCompany(companyId);
 const call=httpsCallable<unknown,{revision:number}>(functions,'savePayrollDraftCommand');
 return (await call(input)).data;
}
/** 월별 작업 ID는 서버가 고정한다. 응답 유실 뒤에는 발행 당시 버전으로 같은 전표를 확인한다. */
export async function issuePayrollVoucher(companyId:CompanyId,input:PayrollCommandInput,mode:'cash'|'accrual',cashAccountId?:string){
 const {row}=await current(companyId,input);
 const gate=(await getDoc(doc(db,'appMeta','releaseCutover'))).data();
 if(gate?.status!=='active'||typeof gate.releaseId!=='string')throw new Error('급여 발행 서버가 준비되지 않았습니다.');
 const expectedRevision=row?.issueOperationId?row.issueExpectedRevision:input.expectedRevision;
 if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw new Error('기존 급여 발행 버전을 확인해야 합니다.');
 const selectedBank=row?.issueOperationId ? row.issueCashAccountId : cashAccountId;
 await ownCompany(companyId);
 const call=httpsCallable<unknown,{id:string;docNo:string;kind:'cashEntries'|'issuedStatements'}>(functions,'issuePayrollVoucherCommand');
 return (await call({...input,mode,expectedRevision,releaseId:gate.releaseId,...(selectedBank ? {cashAccountId:selectedBank} : {})})).data;
}
