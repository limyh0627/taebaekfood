import {buildPartnerAnchor} from '../../src/features/admin/partnerAnchor';
import {buildJournals} from '../../src/shared/buildJournals';
import {verifyAdvanceStatements} from '../../src/shared/partnerAdvanceAudit';
import {deletedReturnCredits} from '../../functions/src/shared/returnClaimProjection';
import {companyOf,type CompanyId} from '../../src/shared/types';
export async function buildVerifiedAnchor(companyId:CompanyId,year:string,rows:Record<string,any[]>){
 const scoped=(name:string)=>{if(!Array.isArray(rows[name]))throw new Error('전체 조회 자료 누락: '+name);return rows[name].filter(row=>companyOf(row)===companyId);};
 const statements=scoped('issuedStatements'),cashEntries=scoped('cashEntries'),settlements=scoped('settlements');
 const operations=scoped('returnOperations'),applications=scoped('returnApplications');
 if(new Set(rows.issuedStatements.map(row=>row.id)).size!==rows.issuedStatements.length) throw new Error('원전표 ID가 중복되어 전체 조회 증명을 확인해야 합니다.');
 for(const application of applications){
  const source=rows.issuedStatements.find(row=>row.id===application.statementId);
  if(source&&companyOf(source)!==companyId) throw new Error('반품 원전표가 다른 회사 자료입니다.');
 }
 const returnJournals=statements.filter(s=>s.returnOperationId);
 // Validation only: returned credits are deliberately unused; app allocation owns projection.
 deletedReturnCredits([],applications,returnJournals,operations);
 const sourcePresence=Object.fromEntries(applications.map(row=>[row.statementId,statements.some(s=>s.id===row.statementId)]));
 const returnOperations=operations.map(row=>({...row,sourcePresence}));
 const advanceStatements=await verifyAdvanceStatements(companyId,statements,scoped('partnerAdvanceOperations'));
 const {entries,skipped}=buildJournals({statements,cashEntries,accounts:rows.accounts});
 if(skipped.length)throw new Error('분개 확인이 필요한 자료가 있어 결산 계획을 중단합니다.');
 return buildPartnerAnchor(companyId,year,{journals:entries,statements,cashEntries,settlements,returnOperations,advanceStatements,nameOf:id=>rows.partners?.find(p=>p.id===id&&companyOf(p)===companyId)?.name});
}
