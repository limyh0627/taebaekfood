import {ReturnValidationError} from '../returnValidationError';
type Row = Record<string, any>;
export type ReturnQuantityUpdate = {itemId:string;previousQuantity:number;quantity:number};
/** 최신 pending 원문에 수량과 그 수량에 귀속된 명시 금액만 반영한다. */
export function pendingReturnQuantityPatch(record:Row, updates:ReturnQuantityUpdate[], companyId:string) {
 if(!Array.isArray(updates)||!updates.length||updates.some(row=>!row||!Number.isFinite(row.quantity)||row.quantity<=0||Math.abs(Math.round(row.quantity*1000)-row.quantity*1000)>1e-6))throw new ReturnValidationError('수량은 0보다 큰 숫자로 소수 셋째 자리까지 입력해야 합니다.');
 if((record.companyId??'taebaek')!==companyId)throw new ReturnValidationError('다른 회사의 기록은 수정할 수 없습니다.');
 if(record.status!=='pending')throw new ReturnValidationError('반품 대기 상태에서만 수량을 수정할 수 있습니다.');
 if(!Array.isArray(record.items)||record.items.length!==updates.length||record.items.some((row:Row,index:number)=>!row||row.itemId!==updates[index].itemId||row.quantity!==updates[index].previousQuantity))throw new ReturnValidationError('품목이나 수량이 바뀌었습니다. 상세창을 다시 열어주세요.');
 const standalone=!record.linkedStatementId;
 if(standalone&&record.items.reduce((sum:number,row:Row)=>sum+row.supply+row.tax,0)!==record.totalAmount)throw new ReturnValidationError('기존 반품 공급가·세액 합계를 확인해주세요.');
 const items=record.items.map((row:Row,index:number)=>{
  if(!standalone)return {...row,quantity:updates[index].quantity};
  if(!Number.isSafeInteger(row.supply)||row.supply<0||!Number.isSafeInteger(row.tax)||row.tax<0||typeof row.accountCode!=='string'||!row.accountCode)throw new ReturnValidationError('반품 공급가·세액·계정을 확인해주세요.');
  const before=Math.round(row.quantity*1000),after=Math.round(updates[index].quantity*1000);
  if(before<=0||!Number.isSafeInteger(before)||!Number.isSafeInteger(after))throw new ReturnValidationError('기존 수량을 확인해주세요.');
  let a=before,b=after;while(b){const remainder=a%b;a=b;b=remainder;}const numerator=after/a,denominator=before/a;
  const scale=(amount:number)=>{if(amount%denominator!==0)throw new ReturnValidationError('수량에 비례한 공급가·세액이 정확한 원 단위가 아닙니다.');const result=(amount/denominator)*numerator;if(!Number.isSafeInteger(result))throw new ReturnValidationError('반품 금액을 확인해주세요.');return result;};
  return {...row,quantity:updates[index].quantity,supply:scale(row.supply),tax:scale(row.tax)};
 });
 const totalAmount=items.reduce((sum:number,row:Row)=>sum+(standalone?row.supply+row.tax:row.quantity*row.price),0);
 if(!Number.isFinite(totalAmount)||totalAmount<=0||(standalone&&!Number.isSafeInteger(totalAmount)))throw new ReturnValidationError('반품 합계 금액을 확인해주세요.');
 return {items,totalAmount};
}
