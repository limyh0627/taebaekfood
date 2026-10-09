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
