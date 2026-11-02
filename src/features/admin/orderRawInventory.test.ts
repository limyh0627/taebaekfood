import { describe, expect, it } from 'vitest';
import { operationDocId, legacyOperationDocId } from '../../shared/rawInventoryCore';
import { orderRawTracesFromMovement,rawLedgerDocIds } from './orderRawInventory';
import type {RawInventoryCommand,RawInventoryMovement} from '../../shared/rawInventoryCore';

describe('rawLedgerDocIds', () => {
  it('일괄과 순차가 같은 영수증의 실제 로트 메타를 보존한다',()=>{
    const command={operationId:'operation',rawItemId:'raw',materialSnapshot:'참깨',kind:'consume'} as RawInventoryCommand;
    const movement={id:'saved',lotChanges:[{lotId:'lot',lotNo:'no',supplierName:'공급',receivedDate:'2026-10-01',deltaKg:-3}]} as RawInventoryMovement;
    expect(orderRawTracesFromMovement(command,movement)).toEqual([{operationId:'operation',rawItemId:'raw',material:'참깨',ledgerId:'saved',supplierName:'공급',kg:3,lotId:'lot',lotNo:'no',receivedDate:'2026-10-01'}]);
  });
  it('소급 적용0의 physical은 로트를 추정하지 않고 ledger-only는 보고 사용량을 보존한다',()=>{
    const command={operationId:'operation',rawItemId:'raw',materialSnapshot:'참깨',kind:'consume'} as RawInventoryCommand;
    const movement={id:'saved',reportedDeltaKg:-3,appliedDeltaKg:0,lotChanges:[]} as unknown as RawInventoryMovement;
    expect(orderRawTracesFromMovement(command,movement)).toEqual([]);
    expect(orderRawTracesFromMovement({...command,kind:'ledger-consume',kg:3},movement)).toMatchObject([{kg:3,ledgerOnly:true,operationId:'operation',ledgerId:'saved'}]);
  });
  it('재개된 옛 원장은 계산 ID가 아니라 실제 저장 문서 ID를 남긴다', () => {
    const operationId = 'production:order-1:line-1:a1:raw-1';
    expect(rawLedgerDocIds([{
      material: '볶음참깨', rawItemId: 'raw-1', operationId,
      ledgerId: 'rm-auto-order-1-raw-1', supplierName: '거래처', kg: 10,
    }])).toEqual(['rm-auto-order-1-raw-1']);
  });

  it('옛 trace에는 현재 계산 ID를 사용한다', () => {
    const operationId = 'production:order-1:line-1:a1:raw-1';
    expect(rawLedgerDocIds([{
      material: '볶음참깨', rawItemId: 'raw-1', operationId,
      supplierName: '거래처', kg: 10,
    }])).toEqual([operationDocId(operationId)]);
  });
});
import { buildOrderRawCommands, createOrderRawInventoryOperations, cancellationRawCommands, buildOrderRawReversalPlan } from './orderRawInventory';
import type {Item,Order} from '../../shared/types';
it('사전검사와 실제 원료 job은 같은 physical·OEM 원문과 혼합 설정을 소비한다',async()=>{
 const holder={id:'raw',companyId:'taebaek',name:'볶음참깨',type:'raw',subtype:'벌크',unit:'kg',stock:100,mixEnabled:true,mixTopPercent:60,minStock:0,image:''} as Item;
 const order={id:'order',companyId:'taebaek',deliveredAt:'2026-10-12',items:[],partnerName:'합성'} as unknown as Order;
 const args={order,physicalUsage:{볶음참깨:2.12345},ledgerOnlyUsage:{볶음참깨:5},attempt:2,lineId:'line-b',allItems:[holder],partners:[],actorName:'직원'};
 const expected=buildOrderRawCommands(args);let actual:unknown;
 const runner:any=async(input:any)=>{actual=input.commands;return {job:{status:'complete'},results:input.commands.map((row:any)=>({input:row,result:{status:'applied',movement:{id:operationDocId(row.command.operationId),reportedDeltaKg:-row.command.kg,lotChanges:[]}}}))};};
 const operations=createOrderRawInventoryOperations({allItems:[holder],partners:[],db:{} as any,actorName:'직원',addNotification:async()=>{},runRawInventoryJob:runner});
 await operations.applyOrderRawUsage(order,args.physicalUsage,2,args.ledgerOnlyUsage,'line-b');expect(actual).toEqual(expected.commands);
 expect(expected.commands.map(row=>row.command.kind)).toEqual(['consume','ledger-consume']);expect(expected.commands[0].command).toMatchObject({kg:2.123,mix:{topPercent:60},effectiveAt:'2026-10-12T12:00:00+09:00'});
});

import {parseClientProductionOperationV2,parseClientRawReverseOperationV2} from '../../../functions/src/shared/orderProductionBatchContract';
it('신규 생산과 취소는 최초 계획에 충돌 없는 프레임과 원장 주소를 고정한다',()=>{
 const order={id:'A:B😀',companyId:'taebaek',deliveredAt:'2026-10-12',items:[]} as unknown as Order;
 const holder={id:'raw:1',companyId:'taebaek',name:'볶음참깨',type:'raw',subtype:'벌크',unit:'kg',stock:100} as Item;
 const result=buildOrderRawCommands({order,physicalUsage:{볶음참깨:2},ledgerOnlyUsage:{볶음참깨:3},attempt:1,lineId:'C:D',allItems:[holder],partners:[]});
 const [physical,oem]=result.commands;expect(parseClientProductionOperationV2(physical.command.operationId)).toMatchObject({kind:'production',orderId:order.id});expect(parseClientProductionOperationV2(oem.command.operationId)).toMatchObject({kind:'production-ledger',orderId:order.id});
 expect(physical.options?.newLotId).toBe('lot-'+operationDocId(physical.command.operationId));
 const [reverse]=cancellationRawCommands(order,new Map([[physical.command.operationId,holder.id]]),'2026-10-12');
 expect(parseClientRawReverseOperationV2(reverse.operationId)).toMatchObject({modernLedgerId:operationDocId(physical.command.operationId),legacyLedgerId:legacyOperationDocId(physical.command.operationId)});expect(reverse.kind).toBe('reverse');if(reverse.kind!=='reverse')throw Error('취소 명령이 아닙니다');expect(reverse.originalOperationId).toBe(physical.command.operationId);
});

it('기존 생산 원장을 취소할 때 원본 operation을 바꾸지 않고 현대·옛 주소를 프레임에 담는다',()=>{
 const original='production:옛:주문:line:a1:raw';const order={id:'옛:주문',companyId:'taebaek',rawConsumedLots:[{operationId:original,rawItemId:'raw'}]} as unknown as Order;
 const raw={id:'raw',companyId:'taebaek',name:'볶음참깨',type:'raw',subtype:'벌크',unit:'kg',stock:1} as Item;
 const plan=buildOrderRawReversalPlan({order,allItems:[raw],effectiveAt:'2026-10-12'});const command=plan!.commands[0].command;if(command.kind!=='reverse')throw Error('취소 명령 아님');
 expect(command.originalOperationId).toBe(original);expect(parseClientRawReverseOperationV2(command.operationId)).toMatchObject({modernLedgerId:operationDocId(original),legacyLedgerId:legacyOperationDocId(original)});
});
