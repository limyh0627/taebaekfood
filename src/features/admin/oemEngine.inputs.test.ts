import {afterEach,expect,it,vi} from 'vitest';
import {createOemEngine,type OemEngineDeps} from './oemEngine';
import {buildBomIndex,getBomIndex,setBomIndex} from '../../shared/bomIndex';
import {buildPackIndex} from '../../shared/packIndex';
import type {Item,PurchaseOrder} from '../../shared/types';
const old=getBomIndex();afterEach(()=>setBomIndex(old));
const items=[{id:'box',name:'묶음',type:'product',unit:'개',spec:'1kg×12',stock:0,minStock:0,image:''},{id:'loose',name:'낱개',type:'product',unit:'개',spec:'1kg',stock:0,minStock:0,image:''}] satisfies Item[];
const own={bom:buildBomIndex(items,[{parent_id:'box',child_id:'loose',quantity:12}]),pack:buildPackIndex([])};
const po={id:'po',companyId:'taebaek',poType:'oem',oemPartnerId:'partner',partnerId:'partner',partnerName:'외주',itemId:'',itemName:'',quantity:0,createdAt:'',status:'invoiced',oemSent:[{material:'참깨',kg:30}]} satisfies PurchaseOrder;
function setup(){
 const receipt=vi.fn<OemEngineDeps['applyOemReceiptInventory']>(async input=>({status:'applied',receivedKg:input.poPatch.oemReceivedKg??0,loss:0,lotNos:{}}));
 const fee=vi.fn<OemEngineDeps['applyOemFeeStatement']>(async input=>input.statement.id);
 const deps:OemEngineDeps={companyId:'taebaek',items,partners:[{id:'partner',name:'외주',companyId:'taebaek'} as OemEngineDeps['partners'][number]],orderUnitInputs:own,issueOemBatchJob:async()=>({poId:'po'}),adjustRawLots:async()=>{},updateItem:async()=>{},addItem:async()=>{},applyOemReceiptInventory:receipt,applyOemFeeStatement:fee,buildFormula:()=>[]};
 return {engine:createOemEngine(deps),receipt,fee};
}
it('회사 엔진 생성 뒤 await 중 전역 교체가 있어도 입고 중량은 명시 BOM 기준이다',async()=>{
 const {engine,receipt}=setup();await Promise.resolve();setBomIndex(buildBomIndex(items,[]));
 await engine.receiveOemBatch({po,returns:[{itemId:'box',qty:2},{itemId:'loose',qty:1}],date:'2026-10-09'});
 expect(receipt.mock.calls[0][0].poPatch.oemReceivedKg).toBe(25);
});
it('가공비 첫 품목 줄은 다른 회사 전역이 아닌 명시 BOM의 개당 중량을 쓴다',async()=>{
 const {engine,fee}=setup();await Promise.resolve();setBomIndex(buildBomIndex(items,[]));
 await engine.issueOemFeeStatement({po:{...po,status:'received',oemReceivedKg:25,items:[{itemId:'box',name:'묶음',unit:'개',quantity:2},{itemId:'loose',name:'낱개',unit:'개',quantity:1}]},date:'2026-10-09',unitPricePerKg:500});
 expect(fee.mock.calls[0][0].statement.items[0].total).toBe(12000);
});
it.each(['taebaek','punghoe'] as const)('%s 벌크만 입고도 한 서버 명령으로 홀더와 원kg를 전달한다',async companyId=>{const raw={id:'raw',name:'볶음참깨',companyId,type:'wip',subtype:'벌크',unit:'kg',stock:0,minStock:0,image:''} as Item,receipt=vi.fn(async(input:any)=>({status:'applied' as const,receivedKg:input.poPatch.oemReceivedKg,loss:0,lotNos:{raw:'lot'}})),oldRaw=vi.fn();const engine=createOemEngine({companyId,items:[raw],partners:[{id:'partner',name:'외주',companyId}],applyOemReceiptInventory:receipt,adjustRawLots:oldRaw} as any);const result=await engine.receiveOemBatch({po:{...po,companyId},returns:[],bulk:[{material:'볶음참깨',kg:100}],date:'2026-10-13'});expect(result.receivedKg).toBe(100);expect(receipt).toHaveBeenCalledOnce();expect(receipt.mock.calls[0][0]).toMatchObject({items:[],bulk:[{material:'볶음참깨',kg:100,rawItemId:'raw'}],poPatch:{oemReceivedKg:100},feeRequest:{originalQuantity:100,oemTotal:50000}});expect(oldRaw).not.toHaveBeenCalled();});
it('12개 묶음 두 개와 벌크3kg는27kg이며 중복 벌크를 홀더별로 합친다',async()=>{const raw={id:'raw',name:'볶음참깨',type:'wip',subtype:'벌크',unit:'kg',companyId:'taebaek'} as Item;const {receipt}=setup();const engine=createOemEngine({companyId:'taebaek',items:[...items,raw],partners:[{id:'partner',name:'외주',companyId:'taebaek'}],orderUnitInputs:own,applyOemReceiptInventory:receipt,buildFormula:()=>[]} as any);await engine.receiveOemBatch({po,returns:[{itemId:'box',qty:2}],bulk:[{material:'볶음참깨',kg:1},{material:'볶음참깨',kg:2}],date:'2026-10-13'});expect(receipt.mock.calls[0][0]).toMatchObject({items:[{itemId:'box',qty:2}],bulk:[{material:'볶음참깨',kg:3,rawItemId:'raw'}],poPatch:{oemReceivedKg:27}});});
it('옛 클라이언트 입고 writer는 벌크가 있으면 품목쓰기 전에 거절한다',async()=>{const {applyOemReceiptInventory}=await import('./oemReceiptInventory');await expect(applyOemReceiptInventory({} as any,{bulk:[{material:'볶음참깨',kg:100}],items:[]} as any)).rejects.toThrow('서버의 단일 거래');});
