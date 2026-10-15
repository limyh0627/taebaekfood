import {companyOf,type CompanyId,type PurchaseOrder} from '../../shared/types';
import {validateOemCostEvidence,validateOemCostIssueFingerprint} from '../../shared/oemBatchCost';
import {projectOemExternalEvidence,type OemExternalEvidence,type OemExternalRow} from './oemExternalStock';
export type OemExternalCostReason='invalid-scope'|'issue-evidence-unconfirmed'|'cancelled-with-evidence'|'received-po-out-of-open-scope'|'issue-not-complete'|'receipt-cost-only'|'cost-source-unconfirmed'|'cost-evidence-missing'|'cost-evidence-mismatch'|'cost-snapshot-mismatch'|'cost-amount-out-of-range'|'issue-raw-cost-candidate';
export interface OemExternalCostDiagnostic {poId:string;classification:'candidate'|'excluded'|'unconfirmed';reason:OemExternalCostReason;sourceState:OemExternalRow['state'];currentOnly:true;assetValuationConfirmed:false;rawSupplyAmountCandidate?:number;}
/** 현재 시점의 송출 근거와 명시 원물 공급액만 분류한다. 월말 자산·FIFO 금액을 계산하지 않는다. */
export function diagnoseOemExternalCost(po:PurchaseOrder,companyId:CompanyId,evidence?:OemExternalEvidence):OemExternalCostDiagnostic{
 const result=(classification:OemExternalCostDiagnostic['classification'],reason:OemExternalCostReason,sourceState:OemExternalRow['state']='unknown',amount?:number):OemExternalCostDiagnostic=>({poId:po.id,classification,reason,sourceState,currentOnly:true,assetValuationConfirmed:false,...(amount===undefined?{}:{rawSupplyAmountCandidate:amount})});
 if(!['taebaek','punghoe'].includes(companyId)||companyOf(po)!==companyId||po.poType!=='oem')return result('unconfirmed','invalid-scope');
 const projected=projectOemExternalEvidence(po,companyId,evidence),state=projected.state;
 if(state==='cancelled')return result('excluded','cancelled-with-evidence',state);
 // received는 현재 PO 입고 표시일 뿐 실제 입고 영수증·금액 증명이 아니며 열린 발주 진단에서 제외한다.
 if(state==='received')return result('excluded','received-po-out-of-open-scope',state);
 if(state!=='confirmed')return result('unconfirmed','issue-evidence-unconfirmed',state);
 if(po.status!=='invoiced'||po.oemIssueStatus!=='complete'||evidence?.job?.status!=='complete')return result('unconfirmed','issue-not-complete',state);
 if(po.oemCostEvidenceSource==='receipt')return result('unconfirmed','receipt-cost-only',state);
 if(po.oemCostEvidenceSource!==undefined&&po.oemCostEvidenceSource!=='issue')return result('unconfirmed','cost-source-unconfirmed',state);
 if(po.oemCostEvidence===undefined)return result('unconfirmed','cost-evidence-missing',state);
 try{
  validateOemCostIssueFingerprint(po);
  const cost=validateOemCostEvidence(po.oemCostEvidence,{companyId,sent:po.oemSent??[]});
  if(!cost)return result('unconfirmed','cost-evidence-missing',state);
  // 송출 비교용 key에는 금액이 없으므로 다른 조회 시점의 비용 원문을 섞지 않는다.
  const current=evidence?.po;
  if(!current||current.oemIssueFingerprint!==po.oemIssueFingerprint||(current.oemCostEvidenceSource??'issue')!==(po.oemCostEvidenceSource??'issue'))return result('unconfirmed','cost-snapshot-mismatch',state);
  validateOemCostIssueFingerprint(current);
  const currentCost=validateOemCostEvidence(current.oemCostEvidence,{companyId,sent:current.oemSent??[]});
  if(JSON.stringify(currentCost)!==JSON.stringify(cost))return result('unconfirmed','cost-snapshot-mismatch',state);
  const amount=cost.rawMaterials.reduce((sum,row)=>sum+row.supplyAmount,0);
  if(!Number.isSafeInteger(amount)||amount<0)return result('unconfirmed','cost-amount-out-of-range',state);
  return result('candidate','issue-raw-cost-candidate',state,amount);
 }catch{return result('unconfirmed','cost-evidence-mismatch',state);}
}
