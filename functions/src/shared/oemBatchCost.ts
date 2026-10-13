export type OemCostEvidence = { version: 1; ownerCompanyId: string;
  rawMaterials: { rawItemId: string; kg: number; supplyAmount: number }[];
  packaging: { confirmed: true; supplyAmount: number }; capturedAt: string };
export type OemCostScope = { companyId: string; sent: readonly { rawItemId?: string; kg: number }[] };
export type OemCostRow = { itemId: string; kg: number; kind?: 'bulk'; rawItemId?: string; lotId?: string };
export type OemBatchCostPreview = { version: 1; status: 'pending-fee'; evidenceSnapshot: OemCostEvidence;
  ownerCompanyId: string; sentKg: number; receivedKg: number; lossKg: number; rawSupplyAmount: number;
  packagingSupplyAmount: number; rows: OemCostRow[] };
export type OemBatchCostBlocked = { version: 1; status: 'blocked'; reason: 'missing-evidence' | 'yield-unconfirmed' | 'fee-changed' | 'fee-deleted'; previousConfirmed?: OemBatchCost; evidenceSnapshot?: OemCostEvidence; ownerCompanyId?: string; sentKg?: number; receivedKg?: number; lossKg?: number; rawSupplyAmount?: number; packagingSupplyAmount?: number; rows?: OemCostRow[] };
export type OemBatchCost = Omit<OemBatchCostPreview,'status'> & { status: 'confirmed'; feeStatementId: string; feeSupplyAmount: number;
  totalSupplyAmount: number; costPerKg: number; allocations: (OemCostRow & { supplyAmount: number; costPerKg: number })[] };
const kg3 = (n: number) => Math.round(n * 1000) / 1000;
const amount = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const positiveKg = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0 && kg3(n) === n && Number.isSafeInteger(Math.round(n*1000));
const fail = (message: string): never => { throw new Error(message); };
const canonical = (value:unknown):unknown => Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,row])=>[key,canonical(row)])):value;

/** 실제 로트별 kg는 먼저 소수 세 자리로 반올림하고 그 합계를 저장한다. */
export function sumOemReceivedKg(rowKg: readonly number[]): number {
  if (!rowKg.length || rowKg.some(kg => typeof kg !== 'number' || !Number.isFinite(kg) || kg <= 0 || !positiveKg(kg3(kg)))) fail('OEM 입고 행 kg 범위를 확인해 주세요.');
  const total = kg3(rowKg.reduce((sum, kg) => sum + kg3(kg), 0));
  if (!positiveKg(total)) fail('OEM 입고 kg 합계 범위를 확인해 주세요.');
  return total;
}
/** 현재 품목 단가를 조회하지 않는다. 명시 확인한 공급가액과 출고 원문만 대조한다. */
export function validateOemCostEvidence(value: unknown, scope: OemCostScope): OemCostEvidence | null {
  if (value === undefined) return null;
  if(!value || typeof value!=='object' || Array.isArray(value))return fail('OEM 원가 확인 근거 형식이 잘못되었습니다.');
  const evidence = value as OemCostEvidence;
  if (evidence.version !== 1 || evidence.ownerCompanyId !== scope.companyId
    || !['taebaek','punghoe'].includes(scope.companyId) || !Array.isArray(evidence.rawMaterials)
    || !evidence.rawMaterials.length || !evidence.packaging || evidence.packaging.confirmed !== true
    || !amount(evidence.packaging.supplyAmount) || typeof evidence.capturedAt !== 'string'
    || !evidence.capturedAt.trim() || !Number.isFinite(Date.parse(evidence.capturedAt))) fail('OEM 원가의 소유회사·공급가 확인 근거가 잘못되었습니다.');
  const sent = new Map<string,number>();
  for (const row of scope.sent) {
    const rawItemId=row?.rawItemId;
    if (!row || typeof rawItemId !== 'string' || !rawItemId || !positiveKg(row.kg)) return fail('OEM 원가에 연결할 출고 원료 ID·kg가 없습니다.');
    const sumKg=kg3((sent.get(rawItemId) ?? 0)+row.kg);
    if(!positiveKg(sumKg))fail('OEM 출고 kg 합계 범위를 확인해 주세요.');
    sent.set(rawItemId,sumKg);
  }
  const ids = new Set<string>();
  for (const row of evidence.rawMaterials) {
    if (!row || typeof row.rawItemId !== 'string' || !row.rawItemId || ids.has(row.rawItemId)
      || !positiveKg(row.kg) || !amount(row.supplyAmount) || sent.get(row.rawItemId) !== row.kg) fail('OEM 원물 공급가 근거가 실제 출고 원료·kg와 다릅니다.');
    ids.add(row.rawItemId);
  }
  if (ids.size !== sent.size) fail('OEM 원물 공급가 근거에 출고 원료가 누락되었습니다.');
  return {version:1,ownerCompanyId:evidence.ownerCompanyId,rawMaterials:evidence.rawMaterials.map(row=>({...row})),packaging:{confirmed:true,supplyAmount:evidence.packaging.supplyAmount},capturedAt:evidence.capturedAt};
}

export function buildOemBatchCostPreview(value: unknown, scope: OemCostScope, rows: OemCostRow[]): OemBatchCostPreview | OemBatchCostBlocked {
  const evidence = validateOemCostEvidence(value,scope);
  if (!evidence) return {version:1,status:'blocked',reason:'missing-evidence'};
  const keys=rows.map(row=>row.kind==='bulk'?`bulk:${row.rawItemId}:${row.lotId}`:`product:${row.itemId}`);
  if (!rows.length || new Set(keys).size !== rows.length
    || rows.some(row=>!row.itemId || !positiveKg(row.kg) || (row.kind!==undefined && row.kind!=='bulk')
      || (row.kind==='bulk' && (!row.rawItemId || row.itemId!==row.rawItemId || !row.lotId))
      || (row.kind===undefined && (row.rawItemId!==undefined || row.lotId!==undefined)))) fail('OEM 원가 배분의 입고 품목·kg를 확인해 주세요.');
  const receivedKg=sumOemReceivedKg(rows.map(row=>row.kg));
  const sentKg=kg3(evidence.rawMaterials.reduce((sum,row)=>sum+row.kg,0));
  const rawSupplyAmount=evidence.rawMaterials.reduce((sum,row)=>sum+row.supplyAmount,0);
  if (!amount(rawSupplyAmount) || !positiveKg(receivedKg) || !positiveKg(sentKg)) fail('OEM 원가 합계·입고량이 잘못되었습니다.');
  const preview: OemBatchCostPreview = {version:1,status:'pending-fee',evidenceSnapshot:evidence,ownerCompanyId:scope.companyId,sentKg,receivedKg,
    lossKg:Math.max(0,kg3(sentKg-receivedKg)),rawSupplyAmount,packagingSupplyAmount:evidence.packaging.supplyAmount,
    rows:rows.map(row=>({...row}))};
  return receivedKg>sentKg ? {...preview,status:'blocked',reason:'yield-unconfirmed'} : preview;
}

/** 확정 전표 공급가만 합산한다. 부가세·기본 가공단가·현재 Item.cost는 계산에 넣지 않는다. */
export function finalizeOemBatchCost(preview: OemBatchCostPreview, fee: {statementId:string;feeSupplyAmount:number}): OemBatchCost {
  if (preview.status !== 'pending-fee' || !fee.statementId || !amount(fee.feeSupplyAmount)) fail('OEM 가공비 공급가 확정 근거가 없습니다.');
  const checked=buildOemBatchCostPreview(preview.evidenceSnapshot,{companyId:preview.ownerCompanyId,sent:preview.evidenceSnapshot.rawMaterials},preview.rows);
  if (JSON.stringify(canonical(checked))!==JSON.stringify(canonical(preview))) fail('OEM 원가 미리보기 근거가 변경되었습니다.');
  const totalSupplyAmount=preview.rawSupplyAmount+preview.packagingSupplyAmount+fee.feeSupplyAmount;
  if (!amount(totalSupplyAmount)) fail('OEM 총 공급가액 범위를 확인해 주세요.');
  let allocated=0,cumulativeMilliKg=BigInt(0);
  const totalWon=BigInt(totalSupplyAmount),receivedMilliKg=BigInt(Math.round(preview.receivedKg*1000));
  const allocations=preview.rows.map((row,index)=>{
    cumulativeMilliKg+=BigInt(Math.round(row.kg*1000));
    const cumulativeAmount=index===preview.rows.length-1?totalSupplyAmount:Number((BigInt(2)*totalWon*cumulativeMilliKg+receivedMilliKg)/(BigInt(2)*receivedMilliKg));
    const supplyAmount=cumulativeAmount-allocated; allocated=cumulativeAmount;
    const costPerKg=supplyAmount/row.kg;
    if(!amount(supplyAmount)||!Number.isFinite(costPerKg))fail('OEM 행별 원가 배분 범위가 잘못되었습니다.');
    return {...row,supplyAmount,costPerKg};
  });
  if(allocations.reduce((sum,row)=>sum+row.supplyAmount,0)!==totalSupplyAmount || !Number.isFinite(totalSupplyAmount/preview.receivedKg))fail('OEM 원가 배분 합계가 잘못되었습니다.');
  return {...preview,status:'confirmed',feeStatementId:fee.statementId,feeSupplyAmount:fee.feeSupplyAmount,totalSupplyAmount,
    costPerKg:totalSupplyAmount/preview.receivedKg,allocations};
}








/** 출고 때 고정한 명시 원가 입력과 현재 배치 원문이 같은지 확인한다. */
export function validateOemCostIssueFingerprint(po: {companyId?:string;partnerId?:string;oemPartnerId?:string;oemSent?:unknown[];oemIssueDate?:string;note?:string;oemCostEvidence?:unknown;oemIssueFingerprint?:string}): void {
  if(po.oemCostEvidence===undefined)return;
  let original:unknown;
  try{original=JSON.parse(po.oemIssueFingerprint ?? '');}catch{fail('OEM 출고 원가 입력 지문이 없습니다.');}
  const expected={companyId:po.companyId ?? 'taebaek',partnerId:po.partnerId,sent:po.oemSent,date:po.oemIssueDate,oemCostEvidence:po.oemCostEvidence};
  const source=original as Record<string,unknown>;
  const recorded=source&&typeof source==='object'?{companyId:source.companyId,partnerId:source.partnerId,sent:source.sent,date:source.date,oemCostEvidence:source.oemCostEvidence}:source;
  if(po.oemPartnerId!==undefined && po.oemPartnerId!==po.partnerId || JSON.stringify(canonical(recorded))!==JSON.stringify(canonical(expected)))
    fail('OEM 출고 회사·거래처·수량·원가 입력 근거가 변경되었습니다.');
}

/** 확인 배치는 현재 규격 대신 입고 때 고정한 행 kg/원 PO 수량을 사용한다. */
export function oemFeeUnitKgFromSavedReceipt(po: {oemCostEvidence?:unknown;oemBatchCost?:unknown;oemReceivedKg?:number;items?:readonly {itemId:string;quantity:number}[];oemReceivedBulk?:readonly {rawItemId?:string;lotId?:string;kg:number}[]}): Map<string,number> | null {
  if (po.oemCostEvidence === undefined) return null;
  const cost=po.oemBatchCost as OemBatchCostPreview | OemBatchCostBlocked | OemBatchCost | undefined;
  const rows=cost?.rows;
  const products=rows?.filter(row=>row.kind!=='bulk') ?? [];
  const bulk=rows?.filter(row=>row.kind==='bulk') ?? [];
  const manifest=po.oemReceivedBulk ?? [];
  const items=po.items ?? [];
  if (!rows?.length || items.length!==products.length || new Set(items.map(row=>row.itemId)).size!==items.length
    || new Set(products.map(row=>row.itemId)).size!==products.length || rows.some(row=>!positiveKg(row.kg))
    || sumOemReceivedKg(rows.map(row=>row.kg))!==po.oemReceivedKg) fail('OEM 원입고 행 중량·수량 근거가 잘못되었습니다.');
  if(bulk.length!==manifest.length || new Set(manifest.map(row=>`${row.rawItemId}:${row.lotId}`)).size!==manifest.length
    || bulk.some(row=>!row.rawItemId || row.itemId!==row.rawItemId || !row.lotId
      || !manifest.some(saved=>saved.rawItemId===row.rawItemId && saved.lotId===row.lotId && saved.kg===row.kg)))
    fail('OEM 원입고 벌크 원료·로트·kg 근거가 다릅니다.');
  const result=new Map<string,number>();
  for (const item of items) {
    const row=products.find(row=>row.itemId===item.itemId);
    if (!row || !Number.isFinite(item.quantity) || item.quantity<=0 || !Number.isFinite(row.kg/item.quantity)) fail('OEM 원입고 품목·수량 근거가 다릅니다.');
    result.set(item.itemId,row!.kg/item.quantity);
  }
  return result;
}
