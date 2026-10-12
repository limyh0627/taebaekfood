import {beforeEach,expect,it} from 'vitest';
import {Timestamp} from 'firebase-admin/firestore';
import {GOODS_RECEIPT_TARGETS,prepareGoodsReceiptLots,validateGoodsRepairPlan,commitGoodsReceiptLots,goodsRepairHash,safeGoodsRepairFailure,createGoodsRepairAuthClient,type RepairSnapshot,type QueryProof} from './fix-goods-receipt-lots-20261012.mts';
const ids=GOODS_RECEIPT_TARGETS.map(row=>row.itemId);
it('실제 설치된 gRPC가 읽을 수 있는 plain 인증 헤더를 만든다',async()=>{
 const client=createGoodsRepairAuthClient('test-only-no-network',Date.now()+3600000),headers=await client.getRequestHeaders('https://firestore.googleapis.com');
 expect(Object.keys(headers).map(key=>key.toLowerCase())).toContain('authorization');expect(headers.Authorization).toBe('Bearer test-only-no-network');
});
it('SDK 오류의 이름·코드만 출력하고 인증값·원문 메시지는 노출하지 않는다',()=>{
 const result=safeGoodsRepairFailure({name:'FirebaseError',code:7,message:'secret-access-token',access_token:'secret-access-token'});
 expect(result).toMatchObject({name:'FirebaseError',code:7});expect(JSON.stringify(result)).not.toContain('secret-access-token');
});
const queries:QueryProof[]=[{collection:'item_bom',field:'parent_id',ids:[...ids],paths:[]},{collection:'item_pack',field:'item_id',ids:[...ids],paths:[]}];
let sources:RepairSnapshot[];
beforeEach(()=>{
 const stock={f1:396,f2:372,f5:324,f4:560},known={f1:12,f2:228,f5:84,f4:176};const docs=new Map<string,any>();
 for(const target of GOODS_RECEIPT_TARGETS){
  docs.set('items/'+target.itemId,{name:'상품 '+target.itemId,type:'goods',companyId:'taebaek',unit:'개',spec:'1kg',stock:stock[target.itemId],cost:0,createdAt:new Timestamp(123,456),lots:[{id:'known-'+target.itemId,supplierName:'기존',qtyIn:known[target.itemId],qtyRemaining:known[target.itemId],kgRemaining:known[target.itemId],unitKg:1,status:'active',receivedDate:'2026-10-01'}]});
  docs.set('itemReceipts/'+target.receiptId,{id:target.receiptId,companyId:'taebaek',itemId:target.itemId,quantity:target.quantity,date:target.date,poId:target.poId,partnerId:'C001',partnerName:'확인 공급자',createdAt:target.date+'T00:00:00Z'});
  const po=docs.get('purchaseOrders/'+target.poId)??{companyId:'taebaek',status:'received',partnerId:'C001',items:[]};po.items.push({itemId:target.itemId,quantity:target.quantity});docs.set('purchaseOrders/'+target.poId,po);
 }
 sources=[...docs].map(([path,data])=>({path,data,version:{seconds:100,nanoseconds:0}}));
});
it('정확한 네 원입고 로트만 붙이고 stock·원가·기존 로트·입고·발주는 보존한다',()=>{
 const before=goodsRepairHash(sources),plan=prepareGoodsReceiptLots(sources,queries);validateGoodsRepairPlan(plan);expect(plan.documents).toHaveLength(4);
 for(const row of plan.documents){const target=GOODS_RECEIPT_TARGETS.find(target=>target.itemId===row.id)!;
  expect(row.after).toEqual({...row.before,lots:[...row.before.lots,row.after.lots.at(-1)]});expect(row.after.lots[0]).toEqual(row.before.lots[0]);
  expect(row.after.lots.at(-1)).toMatchObject({id:'receipt:'+target.receiptId,qtyIn:target.quantity,qtyRemaining:target.quantity,unitKg:1,receivedDate:target.date,poId:target.poId,supplierId:'C001'});
 }
 expect(goodsRepairHash(sources)).toBe(before);
});
it('운영과 같은 1.8L 규격·등록 kg 없음은 기존 공용 함수의 0을 그대로 남긴다',()=>{
 sources.filter(row=>row.path.startsWith('items/')).forEach(row=>{row.data.spec='1.8L';row.data.lots[0].unitKg=0;row.data.lots[0].kgRemaining=0;});
 const plan=prepareGoodsReceiptLots(sources,queries);for(const row of plan.documents)expect(row.after.lots.at(-1)).toMatchObject({qtyIn:GOODS_RECEIPT_TARGETS.find(target=>target.itemId===row.id)!.quantity,unitKg:0,kgIn:0,kgRemaining:0});
});
it.each(GOODS_RECEIPT_TARGETS)('$itemId도 입고·발주 양쪽을 다른 공급자로 바꾼 근거는 거절한다',target=>{
 sources.find(row=>row.path==='itemReceipts/'+target.receiptId)!.data.partnerId='other';sources.find(row=>row.path==='purchaseOrders/'+target.poId)!.data.partnerId='other';
 expect(()=>prepareGoodsReceiptLots(sources,queries)).toThrow('공급자');
});
it.each(['company','type','gap','receipt','po','supplier','duplicate','quantity'])('%s 근거가 다르면 계획도 만들지 않는다',field=>{
 const target=GOODS_RECEIPT_TARGETS[0],item=sources.find(row=>row.path==='items/'+target.itemId)!.data,receipt=sources.find(row=>row.path==='itemReceipts/'+target.receiptId)!.data,po=sources.find(row=>row.path==='purchaseOrders/'+target.poId)!.data;
 if(field==='company')item.companyId='punghoe';if(field==='type')item.type='submaterial';if(field==='gap')item.stock+=1;if(field==='receipt')receipt.quantity+=1;if(field==='po')po.status='invoiced';if(field==='supplier')receipt.partnerId='other';if(field==='duplicate')item.lots.push({...item.lots[0],id:'receipt:'+target.receiptId});if(field==='quantity')po.items[0].quantity+=1;
 expect(()=>prepareGoodsReceiptLots(sources,queries)).toThrow();
});
it('계획의 stock 변경·대상 추가·중량 조회 생략·백업 해시 변경은 허용하지 않는다',()=>{
 const plan=prepareGoodsReceiptLots(sources,queries);plan.documents[0].after.stock+=1;expect(()=>validateGoodsRepairPlan(plan)).toThrow();
 expect(()=>prepareGoodsReceiptLots(sources,[])).toThrow();expect(()=>prepareGoodsReceiptLots([...sources,{path:'items/extra',data:{},version:{seconds:1,nanoseconds:0}}],queries)).toThrow();
});
function memory(){
 const docs=new Map(sources.map(row=>[row.path,{...row,data:{...row.data}}]));let writes=0,failAt=0;
 const snap=(path:string)=>{const row=docs.get(path);return {exists:!!row,ref:{path},data:()=>row?.data,updateTime:row?new Timestamp(row.version.seconds,row.version.nanoseconds):undefined};};
 const store={doc:(path:string)=>({path}),collection:(collection:string)=>({where:()=>({collection})}),runTransaction:async(fn:any)=>{
  const pending:{path:string;data:any}[]=[];const result=await fn({getAll:async(...refs:any[])=>refs.map(ref=>snap(ref.path)),get:async(query:any)=>({docs:[...docs.keys()].filter(path=>path.startsWith(query.collection+'/')).map(snap)}),update:(ref:any,patch:any,precondition:any)=>{writes++;if(failAt===writes)throw Error('합성 쓰기 실패');expect(precondition.lastUpdateTime).toBeInstanceOf(Timestamp);pending.push({path:ref.path,data:{...docs.get(ref.path)!.data,...patch}});}});
  pending.forEach(row=>{const old=docs.get(row.path)!;docs.set(row.path,{...old,data:row.data,version:{seconds:old.version.seconds,nanoseconds:old.version.nanoseconds+1}});});return result;
 }};
 return {store:store as any,docs,get writes(){return writes;},set failAt(value:number){failAt=value;}};
}
it('네 lots는 한 TX로 적용·중복0·조건부 undo되며 원입고 근거는 그대로다',async()=>{
 const plan=prepareGoodsReceiptLots(sources,queries),mem=memory(),before=goodsRepairHash([...mem.docs]);
 expect(await commitGoodsReceiptLots(mem.store,plan,'apply')).toBe('applied');expect(mem.writes).toBe(4);const after=goodsRepairHash([...mem.docs]);
 expect(await commitGoodsReceiptLots(mem.store,plan,'apply')).toBe('duplicate');expect(mem.writes).toBe(4);expect(goodsRepairHash([...mem.docs])).toBe(after);
 expect(await commitGoodsReceiptLots(mem.store,plan,'undo')).toBe('undone');expect(mem.writes).toBe(8);
 for(const source of sources)expect(mem.docs.get(source.path)!.data).toEqual(source.data);
 expect(await commitGoodsReceiptLots(mem.store,plan,'undo')).toBe('duplicate');expect(mem.writes).toBe(8);expect(before).not.toBe(after);
});
it('두번째 쓰기 실패면 네 품목도 원문 그대로다',async()=>{
 const plan=prepareGoodsReceiptLots(sources,queries),mem=memory(),before=goodsRepairHash([...mem.docs]);mem.failAt=2;
 await expect(commitGoodsReceiptLots(mem.store,plan,'apply')).rejects.toThrow('합성');expect(goodsRepairHash([...mem.docs])).toBe(before);
});
it.each(['item-version','receipt-version','item-body','undo-body'])('%s 경합은 쓰기0·원문보존이다',async scenario=>{
 const plan=prepareGoodsReceiptLots(sources,queries),mem=memory();let mode:'apply'|'undo'='apply';
 if(scenario==='undo-body'){await commitGoodsReceiptLots(mem.store,plan,'apply');mode='undo';mem.docs.get('items/f1')!.data.cost=99;}
 else if(scenario==='item-version')mem.docs.get('items/f1')!.version={seconds:101,nanoseconds:0};
 else if(scenario==='receipt-version')mem.docs.get('itemReceipts/'+GOODS_RECEIPT_TARGETS[0].receiptId)!.version={seconds:101,nanoseconds:0};
 else mem.docs.get('items/f1')!.data.stock+=1;
 const before=goodsRepairHash([...mem.docs]),writes=mem.writes;await expect(commitGoodsReceiptLots(mem.store,plan,mode)).rejects.toThrow();expect(mem.writes).toBe(writes);expect(goodsRepairHash([...mem.docs])).toBe(before);
});
