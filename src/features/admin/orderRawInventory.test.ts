import { describe, expect, it } from 'vitest';
import { operationDocId } from '../../shared/rawInventoryCore';
import { rawLedgerDocIds } from './orderRawInventory';

describe('rawLedgerDocIds', () => {
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
import { buildOrderRawCommands, createOrderRawInventoryOperations } from './orderRawInventory';
import type {Item,Order} from '../../shared/types';
it('사전검사와 실제 원료 job은 같은 physical·OEM 원문과 혼합 설정을 소비한다',async()=>{
 const holder={id:'raw',companyId:'taebaek',name:'볶음참깨',type:'raw',subtype:'벌크',unit:'kg',stock:100,mixEnabled:true,mixTopPercent:60,minStock:0,image:''} as Item;
 const order={id:'order',companyId:'taebaek',deliveredAt:'2026-10-12',items:[],partnerName:'합성'} as unknown as Order;
 const args={order,physicalUsage:{볶음참깨:2.12345},ledgerOnlyUsage:{볶음참깨:5},attempt:2,lineId:'line-b',allItems:[holder],partners:[],actorName:'직원'};
 const expected=buildOrderRawCommands(args);let actual:unknown;
 const runner:any=async(input:any)=>{actual=input.commands;return {job:{status:'complete'},results:input.commands.map((row:any)=>({input:row,result:{status:'applied',movement:{id:operationDocId(row.command.operationId),reportedDeltaKg:-row.command.kg,lotChanges:[]}}}))};};
 const operations=createOrderRawInventoryOperations({allItems:[holder],partners:[],db:{} as any,actorName:'직원',addNotification:async()=>{},runRawInventoryJob:runner});
 await operations.applyOrderRawUsage(order,args.physicalUsage,2,args.ledgerOnlyUsage,'line-b');expect(actual).toEqual(expected.commands);
 expect(expected.commands.map(row=>row.command.kind)).toEqual(['consume','ledger-consume']);expect(expected.commands[0].command).toMatchObject({operationId:'production:order:line-b:a2:raw',kg:2.123,mix:{topPercent:60},effectiveAt:'2026-10-12T12:00:00+09:00'});
});
