import {validateOemCostEvidence, type OemCostEvidence} from '../../shared/oemBatchCost';
export type {OemCostEvidence} from '../../shared/oemBatchCost';
import type { CompanyId } from '../../shared/types';

export interface OemCostInputRow {rawItemId?:string;kg:number;supplyAmount:string}
const validAmount = (amount:unknown):amount is number => typeof amount==='number' && Number.isSafeInteger(amount) && amount>=0;
const kg3=(kg:number)=>Math.round(kg*1000)/1000;

/** 현재 품목 원가로 빈칸을 채우지 않는다. 직접 확인한 총 공급가액만 보존한다. */
export function captureOemCostEvidence(companyId:CompanyId, rows:readonly OemCostInputRow[], packagingSupply:string, packagingConfirmed:boolean, capturedAt:string): {status:'empty'|'incomplete'|'complete';evidence?:OemCostEvidence} {
  const touched=rows.some(row=>row.supplyAmount.trim()!=='') || packagingSupply.trim()!=='' || packagingConfirmed;
  if(!touched)return {status:'empty'};
  if(!rows.length || !packagingConfirmed || packagingSupply.trim()==='' || !validAmount(Number(packagingSupply)) || rows.some(row=>!row.rawItemId || !Number.isFinite(row.kg) || row.kg<=0 || row.supplyAmount.trim()==='' || !validAmount(Number(row.supplyAmount))))return {status:'incomplete'};
  const evidence:OemCostEvidence={version:1,ownerCompanyId:companyId,rawMaterials:rows.map(row=>({rawItemId:row.rawItemId!,kg:row.kg,supplyAmount:Number(row.supplyAmount)})),packaging:{confirmed:true,supplyAmount:Number(packagingSupply)},capturedAt};
  try{return {status:'complete',evidence:validateAndMergeOemCostEvidence(evidence,companyId,rows.map(row=>({rawItemId:row.rawItemId!,kg:row.kg})))};}catch{return {status:'incomplete'};}
}

/** 같은 원료를 두 줄로 내보내도 금액과 kg를 함께 합쳐 출고 명령과 짝을 맞춘다. */
export function validateAndMergeOemCostEvidence(evidence:OemCostEvidence, companyId:CompanyId, sent:readonly {rawItemId:string;kg:number}[]):OemCostEvidence {
  if(evidence?.version!==1 || evidence.ownerCompanyId!==companyId || !Array.isArray(evidence.rawMaterials) || !evidence.rawMaterials.length || evidence.packaging?.confirmed!==true || !validAmount(evidence.packaging.supplyAmount) || typeof evidence.capturedAt!=='string' || !Number.isFinite(Date.parse(evidence.capturedAt))) throw new Error('OEM 원가 근거의 소유회사와 확인 정보를 검증하지 못했습니다.');
  const amounts=new Map<string,{rawItemId:string;kg:number;supplyAmount:number}>();
  for(const row of evidence.rawMaterials){
    if(!row.rawItemId || row.rawItemId.includes('/') || !Number.isFinite(row.kg) || row.kg<=0 || !validAmount(row.supplyAmount))throw new Error('OEM 원료의 직접 확인한 중량·공급가액을 확인해 주세요.');
    const old=amounts.get(row.rawItemId);const value={rawItemId:row.rawItemId,kg:kg3((old?.kg??0)+row.kg),supplyAmount:(old?.supplyAmount??0)+row.supplyAmount};
    if(!validAmount(value.supplyAmount) || value.kg<=0)throw new Error('OEM 원가 합계 범위를 확인해 주세요.');
    amounts.set(row.rawItemId,value);
  }
  const kilograms=new Map<string,number>();
  for(const row of sent){if(!row.rawItemId || !Number.isFinite(row.kg) || row.kg<=0)throw new Error('OEM 출고 원료를 확인해 주세요.');kilograms.set(row.rawItemId,kg3((kilograms.get(row.rawItemId)??0)+row.kg));}
  if(kilograms.size!==amounts.size || [...kilograms].some(([id,kg])=>amounts.get(id)?.kg!==kg))throw new Error('OEM 원가 근거와 내보낼 원료가 다릅니다.');
  const totalSupply=[...amounts.values()].reduce((sum,row)=>sum+row.supplyAmount,0)+evidence.packaging.supplyAmount;
  if(!validAmount(totalSupply))throw new Error('OEM 원가 합계 범위를 확인해 주세요.');
  return validateOemCostEvidence({...evidence,rawMaterials:[...amounts.values()],packaging:{...evidence.packaging}},{companyId,sent})!;
}
