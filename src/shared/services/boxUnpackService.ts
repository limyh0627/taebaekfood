import {runInventoryWriterTransaction,captureInventoryWriterContext} from '../inventoryWriterProtocol';
import { doc, runTransaction } from 'firebase/firestore';
import {protectItemInventoryPatch} from '../inventoryWriterProtocol';
import { db } from '../firebase';
import { companyOf, type RawMaterialLot } from '../types';
import { deductLotsByQty, lotQtyRemaining, pruneDepletedLots } from '../lotUtils';
import { itemKg, type OrderUnitInputs } from '../orderUnits';
import { getBomIndex } from '../bomIndex';
import { getPackIndex } from '../packIndex';
import {ItemInventoryRejected,rejectItemInventory,prepareItemInventory,assertItemInventoryWriteBudget,validateItemInventoryRequest,itemInventoryRequestHash,itemInventoryRequestText,itemInventoryResultText,runItemInventoryAttempt,type BoxUnpackRequest,type ItemInventoryOutcome} from '../itemInventoryAttempt';
import {productStocktakeActor} from './unpackService';

const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** 박스 한 개를 낱개로 옮긴다. 두 재고와 로트, 이동 근거는 함께 확정된다. */
export async function unpackBoxStock(params: {
  boxItemId: string; unitItemId: string; count: number; operationId: string;
}, inputs?: OrderUnitInputs,context?:{request:BoxUnpackRequest;mode:'apply'|'inspect';check:()=>Promise<void>}): Promise<{ ok: boolean; message: string;status?:ItemInventoryOutcome['status'] }> {
  const fixedInputs = inputs ?? { bom: getBomIndex(), pack: getPackIndex() };
  const { boxItemId, unitItemId, count, operationId } = params;
  if (!boxItemId || !unitItemId || boxItemId === unitItemId || !Number.isSafeInteger(count) || count < 1 || !operationId) {
    return { ok: false, message: '개봉할 박스와 낱개 품목, 수량을 확인하세요.' };
  }
  const now = context?.request.capturedAt??new Date().toISOString();
  try {
    if(context){validateItemInventoryRequest(context.request);if(context.request.kind!=='box-unpack'||context.request.boxItemId!==boxItemId||context.request.unitItemId!==unitItemId||context.request.count!==count||context.request.operationId!==operationId)throw Error('박스 개봉의 최초 원문과 입력이 다릅니다.');context={...context,request:JSON.parse(JSON.stringify(context.request))};await context.check();}
    const requestHash=context?await itemInventoryRequestHash(context.request):undefined;if(context)await context.check();let duplicate=false;
    await runInventoryWriterTransaction(db,await captureInventoryWriterContext(db,{requestIdentity:context?itemInventoryRequestText(context.request):JSON.stringify({boxItemId,unitItemId,count,operationId}),companyId:context?.request.companyId,isStillCurrent:async()=>{await context?.check();return true;}}), async tx => {
      if(context)await context.check();
      const boxRef = doc(db, 'items', boxItemId);
      const unitRef = doc(db, 'items', unitItemId);
      const moveRef = doc(db, 'itemUnpackMovements', operationId);
      const moveSnap=await tx.get(moveRef);
      if(context)await context.check();
      if (moveSnap.exists()) {
        const move = moveSnap.data();
        if (move.boxItemId !== boxItemId || move.unitItemId !== unitItemId || move.count !== count) throw new Error('이미 다른 개봉에 사용된 작업번호입니다.');
        if(context&&(move.inventoryRequestHash!==requestHash||itemInventoryRequestText(move.inventoryRequest)!==itemInventoryRequestText(context.request)||move.companyId!==context.request.companyId||move.id!==operationId||move.createdAt!==now||move.boxQty!==1||!Array.isArray(move.sourceLots)||!Array.isArray(move.createdLotIds)||move.sourceLots.length!==move.createdLotIds.length||move.sourceLots.some((row:any)=>!Number.isFinite(row.qty)||row.qty<=0)||Math.abs(move.sourceLots.reduce((n:number,row:any)=>n+row.qty,0)-1)>0.000001||move.createdLotIds.some((lotId:any,index:number)=>lotId!==`lot-${operationId}-${index}`)||move.inventoryResult?.sourceText!==itemInventoryResultText(move.sourceLots)))throw Error('박스 개봉 영수증이 최초 원문과 다릅니다.');
        if(context){const result=move.inventoryResult;if(!move.sourceLots.length||![result.boxBefore,result.boxAfter,result.unitBefore,result.unitAfter,result.unitKg].every(Number.isFinite)||result.boxBefore-result.boxAfter!==1||result.unitAfter-result.unitBefore!==count||result.unitKg!==context.request.unitKg||result.boxAfter<0||result.unitAfter<0||move.sourceLots.some((row:any)=>typeof row.lotId!=='string'||!row.lotId))throw Error('박스 개봉 수량·로트 결과 근거가 다릅니다.');}
        duplicate=true;
        return;
      }
      if(context?.mode==='inspect')throw Error('최초 박스 개봉 영수증이 없습니다. 다시 개봉하지 않았습니다.');
      const [boxSnap,unitSnap]=await Promise.all([tx.get(boxRef),tx.get(unitRef)]);if(context)await context.check();
      if (!boxSnap.exists() || !unitSnap.exists()) rejectItemInventory('개봉할 품목을 찾을 수 없습니다.');
      const box = boxSnap.data()!;
      const unit = unitSnap.data()!;
      if (companyOf(box) !== companyOf(unit)) rejectItemInventory('두 품목의 회사가 다릅니다.');
      if(context&&companyOf(box)!==context.request.companyId)rejectItemInventory('박스 개봉 최초 회사가 다릅니다.');
      const boxStock = Number(box.stock ?? 0);
      const unitStock = Number(unit.stock ?? 0);
      if (!Number.isSafeInteger(boxStock) || boxStock < 1 || !Number.isSafeInteger(unitStock) || unitStock < 0) rejectItemInventory('재고 수량을 확인하세요.');
      const boxLots = (box.lots ?? []) as RawMaterialLot[];
      const unitLots = (unit.lots ?? []) as RawMaterialLot[];
      if (lotQtyRemaining(boxLots) !== boxStock || lotQtyRemaining(unitLots) !== unitStock) {
        rejectItemInventory('재고와 로트 수량이 다릅니다. 먼저 두 품목을 실사해 맞춘 뒤 개봉하세요.');
      }
      const taken = prepareItemInventory(()=>deductLotsByQty(boxLots, 1));
      if (taken.shortageQty > 0) rejectItemInventory('개봉할 박스 로트가 없습니다.');
      const unitWeight = context?.request.unitKg??itemKg({ ...unit, id: unitSnap.id } as Parameters<typeof itemKg>[0], fixedInputs);
      const addedLots: RawMaterialLot[] = taken.distribution.map((source, index) => ({
        id: `lot-${operationId}-${index}`, material: String(unit.name ?? box.name ?? ''),
        supplierName: source.supplierName, lotNo: source.lotNo,
        receivedDate: source.receivedDate || context?.request.date || now.slice(0, 10), createdAt: now,
        qtyIn: count * source.qty, qtyRemaining: count * source.qty,
        unitKg: unitWeight, kgIn: count * source.qty * unitWeight,
        kgRemaining: count * source.qty * unitWeight, status: 'active',
      }));
      const evidence=context?{inventoryRequest:context.request,inventoryRequestHash:requestHash,inventoryResult:{sourceText:itemInventoryResultText(taken.distribution),boxBefore:boxStock,boxAfter:boxStock-1,unitBefore:unitStock,unitAfter:unitStock+count,unitKg:unitWeight}}:{};
      assertItemInventoryWriteBudget([{...box,lots:pruneDepletedLots(taken.lots)},{...unit,lots:[...unitLots,...addedLots]},{...evidence,sourceLots:taken.distribution,createdLotIds:addedLots.map(lot=>lot.id)}]);
      if(context)await context.check();
      tx.update(boxRef, protectItemInventoryPatch(box,{ stock: boxStock - 1, lots: clean(pruneDepletedLots(taken.lots)) }));
      tx.update(unitRef, protectItemInventoryPatch(unit,{ stock: unitStock + count, lots: clean([...unitLots, ...addedLots]) }));
      tx.set(moveRef, clean({ id: operationId, companyId: companyOf(box), boxItemId, unitItemId,
        count, boxQty: 1, createdAt: now, sourceLots: taken.distribution,
        createdLotIds: addedLots.map(lot => lot.id),...evidence }));
    });
    if(context)await context.check();return { ok: true,status:duplicate?'duplicate':'applied',message: '박스 1개를 낱개로 개봉했습니다.' };
  } catch (error) {
    return { ok: false,status:context?.mode==='apply'&&error instanceof ItemInventoryRejected?'rejected':context?'unknown':'blocked',message: error instanceof Error ? error.message : String(error) };
  }
}
export async function durableBoxUnpack(request:BoxUnpackRequest):Promise<ItemInventoryOutcome>{
 const companyId=request.companyId,uid=request.uid;return runItemInventoryAttempt(request,async()=>{await productStocktakeActor(companyId,uid,true);},async(mode,check,first)=>{const fixed=first as BoxUnpackRequest;const result=await unpackBoxStock(fixed,undefined,{request:fixed,mode,check});return {ok:result.ok,status:result.status??'unknown',message:result.message,retainPending:!result.ok};});
}
