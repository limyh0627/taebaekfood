import {lineAmount} from './lineAmount';
import {unpackStockComponent,type StockComponent} from './stockUnitMeasure';
/** 회사·BOM·품목의 kg 해석은 호출자가 검증한다. 이 함수는 확인된 입력의 전표 줄만 만든다. */
export type OemFeeProductInput = {name:string;spec:string;qty:number;unitKg:number};
export type OemFeeBulkInput = {material:string;kg:number};
export type OemFeeLine = {name:string;spec:string;qty:number;price:number;supply:number;tax:number;total:number;isTaxExempt:boolean;accountCode:string};
export type OemFeePlanInput = {receivedKg:number;sentKg:number;perKg:number;exempt:boolean;accountCode:string;products:readonly OemFeeProductInput[];bulk:readonly OemFeeBulkInput[]};
export function oemFeeLineAmount(qty:number,price:number,exempt:boolean):{supply:number;tax:number;total:number}{
  const {gross:total,supply,tax}=lineAmount(qty,price,exempt);
  return {supply,tax,total};
}
export function buildOemFeePlan(input:OemFeePlanInput):{lines:OemFeeLine[];totalSupply:number;totalTax:number;totalAmount:number}{
  const {perKg,exempt,accountCode}=input;
  const overall=oemFeeLineAmount(input.receivedKg,perKg,exempt);
  const products=input.products.map(row=>{
    const unitTotal=Math.round(row.unitKg*perKg),amount=oemFeeLineAmount(row.qty,unitTotal,exempt);
    return {name:row.name,spec:row.spec,qty:row.qty,price:oemFeeLineAmount(1,unitTotal,exempt).supply,...amount,isTaxExempt:exempt,accountCode};
  }).filter(row=>row.qty>0&&row.total>0);
  const bulk=input.bulk.filter(row=>row.kg>0).map(row=>({name:`${row.material} 벌크 가공비`,spec:'kg',qty:row.kg,
    price:oemFeeLineAmount(1,perKg,exempt).supply,...oemFeeLineAmount(row.kg,perKg,exempt),isTaxExempt:exempt,accountCode}));
  const lines:OemFeeLine[]=[...products,...bulk];
  if(!lines.length)lines.push({name:`외주가공비 (${input.sentKg}kg→${input.receivedKg}kg)`,spec:'',qty:1,price:overall.supply,...overall,isTaxExempt:exempt,accountCode});
  const gap=overall.total-lines.reduce((sum,line)=>sum+line.total,0);
  if(gap!==0){
    const last=lines[lines.length-1],corrected=oemFeeLineAmount(last.total+gap,1,exempt);
    if(corrected.total<0)throw new Error('받은 중량과 가공비 전표 줄이 일치하지 않습니다.');
    lines[lines.length-1]={...last,...corrected,price:Math.round(corrected.supply/last.qty)};
  }
  const totalSupply=lines.reduce((sum,line)=>sum+line.supply,0),totalTax=lines.reduce((sum,line)=>sum+line.tax,0);
  return {lines,totalSupply,totalTax,totalAmount:totalSupply+totalTax};
}

/** V2 조건은 실제 입고에서 확인한 품목별 요율을 그대로 보존한다. */
export type OemFeeRateV2 = {unit:'kg'|'piece'|'box';grossUnitPrice:number;taxExempt:boolean};
export type OemFeeTermsRowV2 = {itemId:string;processing:OemFeeRateV2;vendorPackaging:OemFeeRateV2};
export type OemFeeTermsV2 = {version:2;companyId:string;partnerId:string;rows:OemFeeTermsRowV2[];
  bulk?:{grossUnitPrice:number;taxExempt:boolean};nonDuplicatePackagingConfirmed?:boolean};
/** 누락을 0으로 채우지 않고 처음 확인한 조건만 수신한다. */
export function normalizeOemFeeTermsV2(input:unknown):OemFeeTermsV2 {
  const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
  const keys=(v:Record<string,unknown>,allowed:string[])=>Object.keys(v).every(key=>allowed.includes(key));
  const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_:-]{1,160}$/.test(v);
  const rate=(v:unknown):OemFeeRateV2=>{
    if(!object(v)||!keys(v,['unit','grossUnitPrice','taxExempt'])||typeof v.unit!=='string'||!['kg','piece','box'].includes(v.unit)||typeof v.grossUnitPrice!=='number'||!Number.isFinite(v.grossUnitPrice)||v.grossUnitPrice<0||typeof v.taxExempt!=='boolean')throw new Error('OEM 품목별 요율·단위·과세 조건을 확인해 주세요.');
    return {unit:v.unit as OemFeeRateV2['unit'],grossUnitPrice:v.grossUnitPrice,taxExempt:v.taxExempt};
  };
  if(!object(input)||!keys(input,['version','companyId','partnerId','rows','bulk','nonDuplicatePackagingConfirmed'])||input.version!==2||typeof input.companyId!=='string'||!['taebaek','punghoe'].includes(input.companyId)||!id(input.partnerId)||!Array.isArray(input.rows)||input.rows.length>100||typeof input.nonDuplicatePackagingConfirmed!=='undefined'&&typeof input.nonDuplicatePackagingConfirmed!=='boolean')throw new Error('OEM 품목별 조건 원문을 확인해 주세요.');
  const ids=new Set<string>();
  const rows=input.rows.map(row=>{if(!object(row)||!keys(row,['itemId','processing','vendorPackaging'])||!id(row.itemId)||ids.has(row.itemId))throw new Error('OEM 품목별 조건의 품목을 확인해 주세요.');ids.add(row.itemId);return {itemId:row.itemId,processing:rate(row.processing),vendorPackaging:rate(row.vendorPackaging)};});
  let bulk:OemFeeTermsV2['bulk'];
  if(input.bulk!==undefined){if(!object(input.bulk)||!keys(input.bulk,['grossUnitPrice','taxExempt'])||typeof input.bulk.grossUnitPrice!=='number'||!Number.isFinite(input.bulk.grossUnitPrice)||input.bulk.grossUnitPrice<0||typeof input.bulk.taxExempt!=='boolean')throw new Error('OEM 벌크 가공비 조건을 확인해 주세요.');bulk={grossUnitPrice:input.bulk.grossUnitPrice,taxExempt:input.bulk.taxExempt};}
  return {version:2,companyId:input.companyId as string,partnerId:input.partnerId,rows,...(bulk?{bulk}:{}),...(input.nonDuplicatePackagingConfirmed!==undefined?{nonDuplicatePackagingConfirmed:input.nonDuplicatePackagingConfirmed as boolean}:{})};
}
export type OemFeeChargeV2 = OemFeeRateV2 & {quantity:number};
export type OemFeePricedRowV2 = {itemId:string;name:string;spec:string;processing:OemFeeChargeV2;vendorPackaging:OemFeeChargeV2};
export type OemFeePricedBulkV2 = {material:string;kg:number;grossUnitPrice:number;taxExempt:boolean};
export type OemFeePlanV2Input = {rows:readonly OemFeePricedRowV2[];bulk:readonly OemFeePricedBulkV2[];accountCode:string};
export type OemFeeReceiptProductV2 = {itemId:string;name:string;spec:string;itemUnit:string;receivedQty:number;unitKg:number;components:readonly StockComponent[]};
export type OemFeeSnapshotRowV2 = OemFeePricedRowV2 & {itemUnit:string;receivedQty:number;unitKg:number;receivedKg:number;unitsPerBox?:number};
export type OemFeeSnapshotBulkV2 = OemFeePricedBulkV2 & {rawItemId:string;lotId:string};
export type OemFeeSnapshotV2 = {version:2;companyId:string;partnerId:string;rows:OemFeeSnapshotRowV2[];bulk:OemFeeSnapshotBulkV2[];nonDuplicatePackagingConfirmed?:boolean};
/** 입고 수량·규격/BOM은 서버가 같은 거래에서 읽은 값이어야 한다. */
export function buildOemFeeSnapshotV2(terms:OemFeeTermsV2,products:readonly OemFeeReceiptProductV2[],bulk:readonly {rawItemId:string;lotId:string;material:string;kg:number}[]):OemFeeSnapshotV2 {
  const fixed=normalizeOemFeeTermsV2(terms),termsById=new Map(fixed.rows.map(row=>[row.itemId,row]));
  if(products.length!==fixed.rows.length||new Set(products.map(row=>row.itemId)).size!==products.length||products.some(row=>!termsById.has(row.itemId))||bulk.length&&!fixed.bulk)throw new Error('OEM 입고 품목과 품목별 조건이 일치하지 않습니다.');
  const rows=products.map(product=>{
    const term=termsById.get(product.itemId)!;
    if(!product.itemId||typeof product.name!=='string'||typeof product.spec!=='string'||typeof product.itemUnit!=='string'||!Number.isFinite(product.receivedQty)||product.receivedQty<=0||!Number.isFinite(product.unitKg)||product.unitKg<=0)throw new Error('OEM 원입고 품목·단위 근거를 확인해 주세요.');
    const unpack=unpackStockComponent(product.components),count=unpack?.count;
    if(count!==undefined&&(!Number.isSafeInteger(count)||count<=1))throw new Error('OEM 박스의 실제 개입수 근거를 확인해 주세요.');
    const boxed=product.itemUnit==='박스'||!!unpack;
    const kg=Math.round(product.receivedQty*product.unitKg*1000)/1000;
    if(!Number.isFinite(kg)||kg<=0||!Number.isSafeInteger(Math.round(kg*1000)))throw new Error('OEM 입고 중량을 확인해 주세요.');
    const quantity=(unit:OemFeeRateV2['unit'])=>{
      if(unit==='kg')return kg;
      if(unit==='box'){if(!boxed)throw new Error('박스 요율에는 실제 박스 품목 근거가 필요합니다.');return product.receivedQty;}
      if(boxed){if(!count)throw new Error('개당 요율에는 실제 박스 개입수 근거가 필요합니다.');return product.receivedQty*count;}
      if(!['개','병','캔','포'].includes(product.itemUnit))throw new Error('개당 요율의 품목 단위를 확인해 주세요.');
      return product.receivedQty;
    };
    return {itemId:product.itemId,name:product.name,spec:product.spec,itemUnit:product.itemUnit,receivedQty:product.receivedQty,unitKg:product.unitKg,receivedKg:kg,...(count?{unitsPerBox:count}:{}),processing:{...term.processing,quantity:quantity(term.processing.unit)},vendorPackaging:{...term.vendorPackaging,quantity:quantity(term.vendorPackaging.unit)}};
  });
  const bulkRows=bulk.map(row=>{if(!fixed.bulk||!row.rawItemId||!row.lotId||!row.material||!Number.isFinite(row.kg)||row.kg<=0)throw new Error('OEM 벌크 입고 근거를 확인해 주세요.');return {...row,...fixed.bulk};});
  return {version:2,companyId:fixed.companyId,partnerId:fixed.partnerId,rows,bulk:bulkRows,...(fixed.nonDuplicatePackagingConfirmed!==undefined?{nonDuplicatePackagingConfirmed:fixed.nonDuplicatePackagingConfirmed}:{})};
}

/** 각 품목/비용의 확정 수량과 세금 구분을 그대로 사용한다. V1의 전체 kg 잔차 보정은 적용하지 않는다. */
export function buildOemFeePlanV2(input:OemFeePlanV2Input):{lines:OemFeeLine[];totalSupply:number;totalTax:number;totalAmount:number}{
  if(!input||!Array.isArray(input.rows)||!Array.isArray(input.bulk)||!input.accountCode)throw new Error('OEM 품목별 가공비 원문이 잘못되었습니다.');
  const ids=new Set<string>(),lines:OemFeeLine[]=[];
  const append=(name:string,spec:string,charge:OemFeeChargeV2)=>{
    if(!charge||!['kg','piece','box'].includes(charge.unit)||typeof charge.taxExempt!=='boolean'||typeof charge.grossUnitPrice!=='number'||!Number.isFinite(charge.grossUnitPrice)||charge.grossUnitPrice<0||typeof charge.quantity!=='number'||!Number.isFinite(charge.quantity)||charge.quantity<=0)throw new Error('OEM 품목별 수량·요율·과세 근거가 잘못되었습니다.');
    const amount=oemFeeLineAmount(charge.quantity,charge.grossUnitPrice,charge.taxExempt);
    if(!Number.isSafeInteger(amount.total)||amount.total<0)throw new Error('OEM 품목별 가공비 합계 범위를 확인해 주세요.');
    if(amount.total===0)return;
    const price=oemFeeLineAmount(1,charge.grossUnitPrice,charge.taxExempt).supply;
    if(price<=0)throw new Error('전표 공급단가가 0원입니다. 비용 단위를 바꾸어 유효한 단가를 확인해 주세요.');
    const unitLabel=charge.unit==='kg'?'kg':charge.unit==='box'?'박스':'개';
    const pricedSpec=[spec,unitLabel+' 기준'].filter(Boolean).join(' · ');
    lines.push({name,spec:pricedSpec,qty:charge.quantity,price,...amount,isTaxExempt:charge.taxExempt,accountCode:input.accountCode});
  };
  for(const row of input.rows){
    if(!row||typeof row.itemId!=='string'||!row.itemId||ids.has(row.itemId)||typeof row.name!=='string'||typeof row.spec!=='string')throw new Error('OEM 품목별 입고 행이 잘못되었습니다.');
    ids.add(row.itemId);
    append(row.name+' 가공비',row.spec,row.processing);
    append(row.name+' 업체부자재비',row.spec,row.vendorPackaging);
  }
  for(const row of input.bulk){
    if(!row||typeof row.material!=='string'||!row.material)throw new Error('OEM 벌크 입고 행이 잘못되었습니다.');
    append(row.material+' 벌크 가공비','',{unit:'kg',quantity:row.kg,grossUnitPrice:row.grossUnitPrice,taxExempt:row.taxExempt});
  }
  const totalSupply=lines.reduce((sum,line)=>sum+line.supply,0),totalTax=lines.reduce((sum,line)=>sum+line.tax,0),totalAmount=totalSupply+totalTax;
  if(![totalSupply,totalTax,totalAmount].every(Number.isSafeInteger))throw new Error('OEM 가공비 총액 범위를 확인해 주세요.');
  return {lines,totalSupply,totalTax,totalAmount};
}
