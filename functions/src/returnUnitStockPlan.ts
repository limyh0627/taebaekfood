import { ReturnValidationError } from './returnValidationError';
import { buildProductLot, withCarryOverProductLot, lotQtyRemaining, deductLotsByQty, type RawMaterialLot } from './shared/productLot';
import { planReturnReceiptBase, type ReturnStockInput } from './returnGeneralStockPlan';

/** receiveUnitStock과 같은 개수 재고/로트 계산. unitKg은 서버의 회사 BOM·포장 원본에서 해석한다. */
export function planUnitReturnReceipt(input:ReturnStockInput,unitKg:number) {
  const item=input.item;
  if(!['product','wip'].includes(item.type??'') || item.subtype==='벌크' || ['kg','KG','L','l','리터','ℓ'].includes(String(item.unit??'').trim()))
    throw new ReturnValidationError('개수로 재고를 드는 완제품·반제품이 아닙니다.');
  if(!Number.isFinite(unitKg) || unitKg<0 || (item.lots!==undefined && !Array.isArray(item.lots))) throw new ReturnValidationError('품목 로트·중량을 확인해 주세요.');
  const stock=Number(item.stock??0);
  const base=planReturnReceiptBase({...input,item:{...item,stock}}),clock={now:input.createdAt,date:input.date,id:`carry:${base.receiptId}`};
  const lots=withCarryOverProductLot((item.lots??[]) as RawMaterialLot[],stock,item.rawMaterialName||item.name,unitKg,undefined,clock);
  if(Math.abs(lotQtyRemaining(lots)-stock)>0.0001) throw new ReturnValidationError('품목 재고와 로트 잔량이 다릅니다.');
  const lot=buildProductLot({material:item.rawMaterialName||item.name,itemId:item.id,supplierName:input.partnerName,supplierId:input.partnerId,qtyIn:base.receipt.quantity,unitKg,receivedDate:input.date}, {...clock,id:`receipt:${base.receiptId}`});
  return {...base,receipt:{...base.receipt,productLotId:lot.id},lots:[...lots,lot]};
}

/** 매입 반품은 기존 개수 FIFO 출고와 동일하게 kg 잔량을 함께 내린다. */
export function planUnitReturnIssue(input:ReturnStockInput,unitKg:number) {
  if(!Number.isFinite(input.quantityDelta) || input.quantityDelta>=0) throw new ReturnValidationError('매입 반품 출고 수량이 잘못되었습니다.');
  const validated=planUnitReturnReceipt({...input,quantityDelta:-input.quantityDelta},unitKg);
  const lots=validated.lots.slice(0,-1),result=deductLotsByQty(lots,validated.receipt.quantity);
  if(result.shortageQty>0) throw new ReturnValidationError('매입 반품 로트 재고가 부족합니다.');
  const nextStock=Math.round((Number(input.item.stock)-validated.receipt.quantity)*1000)/1000;
  if(nextStock<0) throw new ReturnValidationError('매입 반품 재고가 부족합니다.');
  return {itemId:input.item.id,nextStock,lots:result.lots,lotTaken:result.distribution,movement:{lotTaken:result.distribution,itemId:input.item.id,quantityDelta:-validated.receipt.quantity,companyId:input.companyId,partnerId:input.partnerId,date:input.date,operationId:input.operationId,createdAt:input.createdAt}};
}
