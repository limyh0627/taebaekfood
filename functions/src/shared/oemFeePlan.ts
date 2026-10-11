import {lineAmount} from './lineAmount';
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
