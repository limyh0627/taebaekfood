import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';

vi.mock('firebase-functions/v2/https', () => ({
  HttpsError: class extends Error { constructor(public code: string, message: string, public details?: unknown) { super(message); } },
  onCall: (_options: unknown, handler: unknown) => handler,
}));

import { issueTradeStatement } from './tradeStatementIssue';
import { issueVoucher } from './voucherIssue';
import {makeManualPurchaseUnitSnapshot} from './shared/purchaseUnit';
import {statementIssueIdentity,statementIssueRef,STATEMENT_ISSUE_FENCE_GENERATION} from './statementIssueReceipt';

const available = /^(?:127\.0\.0\.1|localhost):(8082|8182)$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '');
const projectId = `demo-trade-statement-${Math.random().toString(36).slice(2)}`;
let app: admin.app.App;
let db: admin.firestore.Firestore;
const date = '2026-10-03';
const releaseId = 'trade-test-release';
const statement = (id: string) => ({
  id, companyId: 'taebaek', issuedAt: `${date}T09:00:00.000Z`, tradeDate: date,
  type: '매출', partnerId: 'p1', partnerName: '거래처', orderId: 'o1', docNo: 'untrusted',
  totalSupply: 100, totalTax: 0, totalAmount: 100,
  items: [{ itemId: 'i1', name: '상품', spec: '', qty: 1, price: 100,
    supply: 100, tax: 0, total: 100, isTaxExempt: true, accountCode: '800' }],
});
const input = (id: string) => ({ operationId: `${id}:ISSUE`, statement: statement(id),
  orderIds: ['o1'], poIds: [] as string[], costUpdates: [] as never[], releaseId,
});
const issue = (request: Parameters<typeof issueTradeStatement>[3]) => issueTradeStatement(db, 'taebaek', 'auth-user', request);
async function seed(orderId = 'o1', counter = true) {
  await Promise.all([
    db.collection('partners').doc('p1').set({ companyId: 'taebaek', name: '거래처' }),
    db.collection('accountCodes').doc('sale').set({ companyId: 'taebaek', code: '800', name: '매출' }),
    db.collection('accountCodes').doc('purchase').set({ companyId: 'taebaek', code: '500', name: '매입' }),
    db.collection('orders').doc(orderId).set({ companyId: 'taebaek', partnerId: 'p1', invoicePrinted: false }),
    counter ? db.collection('appMeta').doc(`voucherNo_taebaek_${date}_general`)
      .set({ companyId: 'taebaek', tradeDate: date, prefix: '', last: 0 }) : Promise.resolve(),
    db.collection('appMeta').doc('releaseCutover').set({ status: 'active', releaseId, voucherNotBefore: { taebaek: date } }),
  ]);
}

describe.skipIf(!available)('일반 전표 Firestore SDK 거래', () => {
  it('옛 앱의 빈 선택 발주 null 송신은 첫 발행과 동일 원문 재시도에서 한 번만 저장한다',async()=>{
    await seed();const id='legacy-empty-po-'+randomUUID(),original=input(id),text=JSON.stringify(original,null,2);
    const wire={...original,newPo:null,requestText:text} as unknown as Parameters<typeof issue>[0],identity=statementIssueIdentity('taebaek','auth-user',wire);
    try{const first=await issue(wire),before=await statementIssueRef(db,identity).get();
    expect(first.status).toBe('applied');expect(await issue(wire)).toEqual({...first,status:'duplicate'});
    const after=await before.ref.get();expect(after.data()).toEqual(before.data());expect(after.updateTime!.isEqual(before.updateTime!)).toBe(true);
    expect(after.get('requestText')).toBe(text);expect(after.get('requestHash')).toBe(identity.requestHash);
    expect((await db.collection('issuedStatements').doc(id).get()).get('docNo')).toBe(first.docNo);
    expect((await db.collection('appMeta').doc(`voucherNo_taebaek_${date}_general`).get()).get('last')).toBe(1);
    expect((await db.collection('orders').doc('o1').get()).get('linkedStatementId')).toBe(id);
    expect((await db.collection('purchaseOrders').where('linkedStatementId','==',id).get()).empty).toBe(true);
    }finally{await Promise.all([db.collection('issuedStatements').doc(id).delete(),statementIssueRef(db,identity).delete()]);}
  });
  it('취소 봉인은 회사 전환이나 새 원문으로도 재발행하지 않는다',async()=>{
    await seed();const id='stmt-'+Date.now(),request={...input(id),orderIds:[],statement:{...statement(id),orderId:''}},identity=statementIssueIdentity('taebaek','auth-user',request);
    await statementIssueRef(db,identity).set({companyId:'taebaek',actorId:'auth-user',operationId:request.operationId,statementId:id,status:'cancelled',revision:1,cancellationId:'sdk-cancel',drainGeneration:STATEMENT_ISSUE_FENCE_GENERATION});
    await expect(issue(request)).rejects.toThrow('취소한');
    await expect(issueTradeStatement(db,'punghoe','auth-user',{...request,statement:{...request.statement,companyId:'punghoe'}})).rejects.toThrow('다른 회사');
    expect((await db.collection('issuedStatements').doc(id).get()).exists).toBe(false);
  });
  it.each(['order','po'] as const)('다른 작업 두 개가 동일 %s에 실제 동시 발행해도 금융 반영은 한 번이다',async kind=>{
    await seed();const key='parallel-'+randomUUID(),itemId=key+'-item';
    const resource=db.collection(kind==='order'?'orders':'purchaseOrders').doc(key);
    const item=db.collection('items').doc(itemId);
    await Promise.all([resource.set({companyId:'taebaek',partnerId:'p1',status:'pending',invoicePrinted:false,items:[]}),
      item.set({companyId:'taebaek',name:'합성 보존 품목',stock:7,cost:80,lots:[{id:'보존로트',remaining:7}]})]);
    const requests=[key+'-a',key+'-b'].map(id=>({...input(id),orderIds:kind==='order'?[key]:[],poIds:kind==='po'?[key]:[],
      statement:{...statement(id),type:kind==='po'?'매입':'매출',orderId:kind==='order'?key:'',items:[{...statement(id).items[0],itemId,accountCode:kind==='po'?'500':'800'}]}}));
    const counter=db.collection('appMeta').doc(`voucherNo_taebaek_${date}_general`);
    const beforeItem=await item.get(),beforeCounter=(await counter.get()).get('last');
    try{
      const results=await Promise.allSettled(requests.map(issue));
      expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
      expect(results.filter(result=>result.status==='rejected')).toHaveLength(1);
      const rows=await Promise.all(requests.map(request=>db.collection('issuedStatements').doc(request.statement.id).get()));
      expect(rows.filter(row=>row.exists)).toHaveLength(1);
      const winner=rows.find(row=>row.exists)!;
      expect((await resource.get()).get('linkedStatementId')).toBe(winner.id);
      expect((await counter.get()).get('last')).toBe(beforeCounter+1);
      expect((await item.get()).updateTime!.isEqual(beforeItem.updateTime!)).toBe(true);
      expect((await db.collection('cashEntries').where('partnerId','==','p1').get()).docs.filter(doc=>requests.some(request=>request.statement.id===doc.id))).toHaveLength(0);
      expect((await db.collection('itemCostHistory').where('itemId','==',itemId).get()).empty).toBe(true);
    }finally{await Promise.all([resource.delete(),item.delete(),...requests.map(request=>db.collection('issuedStatements').doc(request.statement.id).delete())]);}
  },30000);
  it.each(['taxable','exempt','default-kg','fractional','g-taxable','g-exempt','wrong-unit','wrong-item','wrong-company','wrong-po','wrong-cost'] as const)('직접 kg 매입 %s는 등록표 없이 원료·행·PO·원가 근거를 함께 보호한다',async scenario=>{
    await seed();const id='manual-'+randomUUID(),rawId=id+'-raw',poId='po-'+id,cardNo='PO-261003-'+Math.floor(100000000+Math.random()*899999999);
    const owned=[db.collection('items').doc(rawId),db.collection('issuedStatements').doc(id),db.collection('purchaseOrders').doc(poId),db.collection('itemCostHistory').doc(`${id}_${rawId}_0`),db.collection('appMeta').doc(`poCardNo_taebaek_${cardNo}`),db.collection('rawInventories').doc('taebaek__'+rawId),db.collection('item_purchase_unit').doc('manual-kg')];
    const [item,issued,po,history,reservation,rawState,pretendRegistration]=owned;
    try{
      await item.set({companyId:scenario==='wrong-company'?'punghoe':'taebaek',name:'합성 원료',type:scenario==='wrong-item'?'product':'raw',subtype:scenario==='wrong-item'?'낱개':'벌크',unit:'kg',cost:80,stock:7,lots:[{id:id+'-lot',kgRemaining:7}]});
      await rawState.set({companyId:'taebaek',rawItemId:rawId,stockKg:7,revision:3});
      // reserved ID의 가짜 등록표가 있어도 직접 kg는 그 표를 근거로 바꾸지 않는다.
      await pretendRegistration.set({companyId:'punghoe',itemId:'other',purchaseUnit:'포',unitKg:999,active:false});
      const qty=scenario==='fractional'?1.5:2,snapshot=makeManualPurchaseUnitSnapshot(scenario==='default-kg'?'kg':scenario.startsWith('g-')?'20g':'20kg',qty),exempt=scenario==='exempt'||scenario==='g-exempt';
      const total=Math.round(qty*44000),supply=exempt?total:Math.round(total/1.1),line={itemId:rawId,name:'합성 원료',qty,price:44000,supply,tax:total-supply,total,isTaxExempt:exempt,accountCode:'500',sourceLineIndex:0,...snapshot};
      if(scenario==='wrong-unit'){line.unitKg=25;line.inventoryQty=qty*25;}
      const poLine={itemId:rawId,itemName:'합성 원료',quantity:qty,isBox:false,unit:'kg',sourceLineIndex:0,...snapshot};
      if(scenario==='wrong-unit'){poLine.unitKg=line.unitKg;poLine.inventoryQty=line.inventoryQty;}
      if(scenario==='wrong-po')poLine.inventoryQty+=1;
      const cost=scenario==='wrong-cost'?Math.round(supply/qty):Math.round(supply/line.inventoryQty);
      const request={...input(id),orderIds:[],statement:{...statement(id),type:'매입',orderId:'',totalSupply:supply,totalTax:total-supply,totalAmount:total,items:[line]},newPo:{id:poId,cardNo,items:[poLine]},costUpdates:[{itemId:rawId,price:cost,beforeCost:80,sourceLineIndex:0}]};
      const before=await Promise.all([item.get(),rawState.get(),pretendRegistration.get()]);
      if(scenario.startsWith('wrong')){await expect(issue(request)).rejects.toThrow();expect((await issued.get()).exists).toBe(false);expect((await po.get()).exists).toBe(false);expect((await history.get()).exists).toBe(false);expect((await reservation.get()).exists).toBe(false);expect((await item.get()).get('cost')).toBe(80);}
      else{
        const result=await issue(request);expect(result.status).toBe('applied');expect(await issue(request)).toEqual({...result,status:'duplicate'});
        expect((await issued.get()).get('items')[0]).toEqual(line);expect((await po.get()).get('items')[0]).toEqual(poLine);
        expect((await item.get()).get('cost')).toBe(cost);expect((await history.get()).get('purchaseCostBasis')).toMatchObject({confirmedKg:snapshot.inventoryQty,calculatedCost:cost,lines:[{purchaseUnitId:'manual-kg',purchaseUnit:snapshot.purchaseUnit,purchaseQty:qty,inventoryQty:snapshot.inventoryQty}]});
        if(scenario==='taxable')expect(cost).toBe(2000);if(scenario==='exempt')expect(cost).toBe(2200);
        if(scenario.startsWith('g-')){expect(snapshot).toMatchObject({purchaseUnit:'20g',unitKg:0.02,inventoryQty:0.04});expect(cost).toBe(scenario==='g-exempt'?2200000:2000000);}
      }
      expect((await item.get()).get('stock')).toBe(7);expect((await item.get()).get('lots')).toEqual(before[0].get('lots'));
      expect((await rawState.get()).updateTime!.isEqual(before[1].updateTime!)).toBe(true);expect((await pretendRegistration.get()).updateTime!.isEqual(before[2].updateTime!)).toBe(true);
      expect((await db.collection('rawMaterialLedger').where('rawItemId','==',rawId).get()).empty).toBe(true);
    }finally{await Promise.all(owned.map(ref=>ref.delete()));expect((await Promise.all(owned.map(ref=>ref.get()))).every(snap=>!snap.exists)).toBe(true);}
  },30000);

  // 실제 로컬 Admin SDK TX를 호출한다. Callable·실제 로그인 검증 시험으로 확대하지 않는다.
  it.each(['manual','unit','mixed','same-cost','missing-kg','truthy-tax-exempt'] as const)('TODO028 신규 원가 근거 %s는 최초 공급가·kg만 보존하고 입고를 만들지 않는다',async scenario=>{
    await seed();
    const id='basis-'+randomUUID(),rawId=id+'-raw',cardNo='PO-261003-'+Math.floor(100000000+Math.random()*899999999);
    const owned:admin.firestore.DocumentReference[]=[];
    const own=(collection:string,key:string)=>{const ref=db.collection(collection).doc(key);owned.push(ref);return ref;};
    const item=own('items',rawId),rawState=own('rawInventories','taebaek__'+rawId),history=own('itemCostHistory',id+'_'+rawId+'_0');
    const issued=own('issuedStatements',id),po=own('purchaseOrders','po-'+id),reservation=own('appMeta','poCardNo_taebaek_'+cardNo);
    const beforeCost=scenario==='same-cost'?1000:80;
    const lot={id:id+'-lot',qtyIn:7,qtyRemaining:7,kgIn:7,kgRemaining:7,unitKg:1,status:'active'};
    try{
      await item.set({companyId:'taebaek',name:'합성 원료',type:'raw',subtype:'벌크',unit:'포',cost:beforeCost,stock:7,lots:[lot]});
      await rawState.set({companyId:'taebaek',rawItemId:rawId,stockKg:7,revision:3,activeLots:[lot]});
      let lines:Record<string,any>[];
      if(scenario==='unit'||scenario==='mixed'){
        const weights=scenario==='mixed'?[20,25]:[22.5];
        lines=weights.map((unitKg,index)=>{const qty=scenario==='unit'?1.5:1,isTaxExempt=scenario==='mixed'&&index===1;
          const price=scenario==='unit'?7333:unitKg*(isTaxExempt?1000:1100),total=Math.round(qty*price),supply=isTaxExempt?total:Math.round(total/1.1);
          return {itemId:rawId,name:'합성 원료',qty,price,supply,tax:total-supply,total,isTaxExempt,accountCode:'500',sourceLineIndex:index,
            purchaseUnitId:id+'-u'+index,purchaseUnit:'포',purchaseQty:qty,unitKg,inventoryQty:qty*unitKg};});
        for(const line of lines)await own('item_purchase_unit',line.purchaseUnitId).set({companyId:'taebaek',itemId:rawId,purchaseUnit:'포',unitKg:line.unitKg,active:true,isDefault:false});
      }else lines=[{itemId:rawId,name:'합성 원료',qty:2,price:22000,supply:scenario==='truthy-tax-exempt'?44000:40000,tax:scenario==='truthy-tax-exempt'?0:4000,total:44000,isTaxExempt:scenario==='truthy-tax-exempt'?'면세':false,accountCode:'500',...(scenario==='missing-kg'?{}:{purchaseQuantityKg:40})}];
      const supply=lines.reduce((n,line)=>n+line.supply,0),tax=lines.reduce((n,line)=>n+line.tax,0),total=supply+tax;
      const kg=lines.reduce((n,line)=>n+(line.inventoryQty??line.purchaseQuantityKg??0),0),cost=kg?Math.round(supply/kg):null;
      const request:Parameters<typeof issueTradeStatement>[3]={...input(id),orderIds:[],statement:{...statement(id),type:'매입',orderId:'',totalSupply:supply,totalTax:tax,totalAmount:total,items:lines},
        newPo:{id:po.id,cardNo,items:lines.map((line,index)=>({itemId:rawId,itemName:line.name,quantity:line.qty,isBox:false,unit:'포',...(line.purchaseUnitId?{sourceLineIndex:index,purchaseUnitId:line.purchaseUnitId,purchaseUnit:line.purchaseUnit,purchaseQty:line.purchaseQty,unitKg:line.unitKg,inventoryQty:line.inventoryQty}:{})}))},
        costUpdates:cost===null?[]:[{itemId:rawId,price:cost,beforeCost,sourceLineIndex:0,...(scenario==='mixed'?{sourceLineIndices:[0,1]}:{})}]};
      const initialItem=await item.get(),initialRaw=await rawState.get();const first=await issue(request);
      const saved=await issued.get(),savedPo=await po.get(),savedItem=await item.get();
      expect(saved.get('items')).toEqual(lines);
      if(scenario==='truthy-tax-exempt'){expect(saved.get('items')[0].isTaxExempt).toBe('면세');expect(saved.get('items')[0].tax).toBe(0);expect(saved.get('items')[0].supply).toBe(44000);}expect(savedItem.get('stock')).toBe(7);expect(savedItem.get('lots')).toEqual([lot]);expect((await db.collection('rawMaterialLedger').where('rawItemId','==',rawId).get()).empty).toBe(true);
      expect((await rawState.get()).updateTime!.isEqual(initialRaw.updateTime!)).toBe(true);
      expect(savedPo.get('items').map((row:any)=>row.quantity)).toEqual(lines.map(line=>line.qty));
      expect(savedItem.get('cost')).toBe(cost??beforeCost);
      if(scenario==='manual'||scenario==='same-cost'||scenario==='missing-kg'||scenario==='truthy-tax-exempt'){
        expect(savedPo.get('items')[0]).not.toHaveProperty('inventoryQty');expect(savedPo.get('items')[0]).not.toHaveProperty('purchaseQuantityKg');
      }
      const h=await history.get();
      if(scenario==='same-cost'||scenario==='missing-kg'){expect(h.exists).toBe(false);if(scenario==='missing-kg')expect(savedItem.updateTime!.isEqual(initialItem.updateTime!)).toBe(true);}
      else{
        const expectedLines=lines.map((line,index)=>({sourceLineIndex:index,qty:line.qty,price:line.price,supply:line.supply,tax:line.tax,total:line.total,isTaxExempt:Boolean(line.isTaxExempt),confirmedKg:line.inventoryQty??line.purchaseQuantityKg,
          ...(line.purchaseUnitId?{kgBasis:'registered-purchase-unit',purchaseUnitId:line.purchaseUnitId,purchaseUnit:line.purchaseUnit,purchaseQty:line.purchaseQty,unitKg:line.unitKg,inventoryQty:line.inventoryQty}:{kgBasis:'manual-purchase-kg',purchaseQuantityKg:line.purchaseQuantityKg})}));
        expect(h.get('purchaseCostBasis')).toEqual({version:1,kind:'raw',baseUnit:'kg',supplyAmount:supply,confirmedKg:kg,calculatedCost:cost,sourceLineIndices:lines.map((_line,index)=>index),lines:expectedLines});
        expect(h.get('purchaseCostBasis')).not.toHaveProperty('ownerCompanyId');
      }
      const snapshots=await Promise.all([issued,po,item,rawState,reservation,db.collection('appMeta').doc('voucherNo_taebaek_'+date+'_general')].map(ref=>ref.get()));
      expect(await issue(request)).toEqual({...first,status:'duplicate'});
      for(const old of snapshots)expect((await old.ref.get()).updateTime!.isEqual(old.updateTime!)).toBe(true);
      if(h.exists)expect((await history.get()).updateTime!.isEqual(h.updateTime!)).toBe(true);
      if(scenario==='unit'){
        const changedLines=lines.map(line=>({...line,unitKg:line.unitKg+1,inventoryQty:line.inventoryQty+line.purchaseQty}));
        const changedKg=changedLines.reduce((n,line)=>n+line.inventoryQty,0);
        const changed={...request,statement:{...request.statement,items:changedLines},newPo:{...request.newPo!,items:request.newPo!.items.map((line,index)=>({...line,unitKg:changedLines[index].unitKg,inventoryQty:changedLines[index].inventoryQty}))},costUpdates:[{...request.costUpdates[0],price:Math.round(supply/changedKg)}]};
        await expect(issue(changed)).rejects.toThrow();
        for(const old of snapshots)expect((await old.ref.get()).updateTime!.isEqual(old.updateTime!)).toBe(true);
      }

    }finally{
      await Promise.all(owned.map(ref=>ref.delete()));
      expect((await Promise.all(owned.map(ref=>ref.get()))).every(snap=>!snap.exists)).toBe(true);
    }
  },30_000);

  it.each(['metadata-edit','legacy-metadata-missing','history-delete','history-amount-edit'] as const)('TODO028 원가 이력 %s는 금융 duplicate 증거가 아니며 되쓰지 않는다',async mutation=>{
    await seed();const id='basis-ack-'+randomUUID(),rawId=id+'-raw';
    const owned=[db.collection('items').doc(rawId),db.collection('issuedStatements').doc(id),db.collection('itemCostHistory').doc(id+'_'+rawId+'_0')];
    const [item,issued,history]=owned;
    try{
      await item.set({companyId:'taebaek',name:'합성 원료',type:'raw',subtype:'벌크',stock:7,lots:[],cost:80});
      const line={itemId:rawId,name:'합성 원료',qty:2,price:22000,supply:40000,tax:4000,total:44000,isTaxExempt:false,accountCode:'500',purchaseQuantityKg:40};
      const request={...input(id),orderIds:[],statement:{...statement(id),type:'매입',orderId:'',totalSupply:40000,totalTax:4000,totalAmount:44000,items:[line]},costUpdates:[{itemId:rawId,price:1000,beforeCost:80,sourceLineIndex:0}]};
      const first=await issue(request);expect((await history.get()).get('purchaseCostBasis')).toMatchObject({confirmedKg:40,calculatedCost:1000});
      await item.update({cost:777});
      if(mutation==='metadata-edit')await history.update({purchaseCostBasis:{userNote:'수동 이력 보존',confirmedKg:999}});
      if(mutation==='legacy-metadata-missing')await history.update({purchaseCostBasis:admin.firestore.FieldValue.delete()});
      if(mutation==='history-delete')await history.delete();
      if(mutation==='history-amount-edit')await history.update({beforeCost:11,afterCost:404,userNote:'수동 금액 보존'});
      const refs=[...owned,db.collection('appMeta').doc('voucherNo_taebaek_'+date+'_general')],before=await Promise.all(refs.map(ref=>ref.get()));
      expect(await issue(request)).toEqual({...first,status:'duplicate'});
      const after=await Promise.all(refs.map(ref=>ref.get()));
      for(let i=0;i<before.length;i++){expect(after[i].exists).toBe(before[i].exists);expect(after[i].data()).toEqual(before[i].data());if(before[i].exists)expect(after[i].updateTime!.isEqual(before[i].updateTime!)).toBe(true);}
      expect((await item.get()).get('cost')).toBe(777);
      for(const changed of [
        {...request,statement:{...request.statement,items:[{...line,purchaseQuantityKg:20}]},costUpdates:[{...request.costUpdates[0],price:2000}]},
        {...request,statement:{...request.statement,totalSupply:40200,totalTax:4020,totalAmount:44220,items:[{...line,price:22110,supply:40200,tax:4020,total:44220}]},costUpdates:[{...request.costUpdates[0],price:1005}]},
      ])await expect(issue(changed)).rejects.toThrow();
      for(let i=0;i<before.length;i++){const current=await refs[i].get();expect(current.data()).toEqual(before[i].data());if(before[i].exists)expect(current.updateTime!.isEqual(before[i].updateTime!)).toBe(true);}
    }finally{await Promise.all(owned.map(ref=>ref.delete()));expect((await Promise.all(owned.map(ref=>ref.get()))).every(snap=>!snap.exists)).toBe(true);}
  },30_000);

  it.each([false,true])('TODO027 소수 포 매입은 면세=%s에서도 거래금액 반올림과 저장 kg 원가를 보존한다',async isTaxExempt=>{
    await seed();const id='fraction-unit-'+isTaxExempt,rawId=id+'-raw',unitId=id+'-unit';
    await db.collection('items').doc(rawId).set({companyId:'taebaek',name:'소수 포 원료',type:'raw',subtype:'벌크',unit:'L',stock:7,lots:[],cost:80});
    await db.collection('item_purchase_unit').doc(unitId).set({companyId:'taebaek',itemId:rawId,purchaseUnit:'포',unitKg:22.5,active:true,isDefault:false});
    const supply=isTaxExempt?11000:10000,tax=isTaxExempt?0:1000,cost=isTaxExempt?326:296;
    const snapshot={sourceLineIndex:0,purchaseUnitId:unitId,purchaseUnit:'포',purchaseQty:1.5,unitKg:22.5,inventoryQty:33.75};
    const line={itemId:rawId,name:'소수 포 원료',qty:1.5,price:7333,supply,tax,total:11000,isTaxExempt,accountCode:'500',...snapshot};
    const request={...input(id),orderIds:[],statement:{...statement(id),type:'매입',orderId:'',totalSupply:supply,totalTax:tax,totalAmount:11000,items:[line]},newPo:{id:'po-'+id,cardNo:'PO-261003-'+(isTaxExempt?'098':'097'),items:[{itemId:rawId,itemName:'소수 포 원료',quantity:1.5,unit:'L',isBox:false,...snapshot}]},costUpdates:[{itemId:rawId,price:cost,beforeCost:80,sourceLineIndex:0}]};
    const issued=await issue(request);
    const saved=await db.collection('issuedStatements').doc(id).get();expect(saved.get('items')[0]).toEqual(line);expect(saved.data()).toMatchObject({totalSupply:supply,totalTax:tax,totalAmount:11000});
    const po=await db.collection('purchaseOrders').doc(request.newPo.id).get(),item=await db.collection('items').doc(rawId).get(),counter=await db.collection('appMeta').doc('voucherNo_taebaek_'+date+'_general').get();
    expect(po.get('items')[0]).toMatchObject({quantity:1.5,...snapshot});expect(item.get('cost')).toBe(cost);expect(item.get('stock')).toBe(7);
    expect(await issue(request)).toEqual({...issued,status:'duplicate'});
    for(const old of [saved,po,item,counter])expect((await old.ref.get()).updateTime!.isEqual(old.updateTime!)).toBe(true);
  });

  it('kg 미확인 벌크의 거래·발주는 발행하되 품목 원가와 원가 이력은 바꾸지 않는다', async () => {
    await seed(); const id='raw-no-kg';
    await db.collection('items').doc('raw-no-kg-item').set({companyId:'taebaek',name:'원료',type:'raw',subtype:'벌크',unit:'포',cost:80});
    const line={itemId:'raw-no-kg-item',name:'원료',spec:'20kg',qty:2,price:22000,supply:40000,tax:4000,total:44000,isTaxExempt:false,accountCode:'500'};
    const request={...input(id),statement:{...statement(id),type:'매입',orderId:'',items:[line],totalSupply:40000,totalTax:4000,totalAmount:44000},orderIds:[],
      newPo:{id:'po-raw-no-kg',cardNo:'PO-261003-091',items:[{itemId:line.itemId,itemName:'원료',quantity:2,isBox:false,unit:'포'}]}};
    const result=await issue(request);
    expect((await db.collection('items').doc(line.itemId).get()).data()?.cost).toBe(80);
    expect((await db.collection('itemCostHistory').doc(`${id}_${line.itemId}_0`).get()).exists).toBe(false);
    expect((await db.collection('issuedStatements').doc(id).get()).data()?.items[0]).toEqual(line);
    expect((await db.collection('purchaseOrders').doc(request.newPo.id).get()).data()?.items[0]).toMatchObject({quantity:2,unit:'포'});
    expect(await issue(request)).toEqual({...result,status:'duplicate'});
    expect((await db.collection('appMeta').doc(`voucherNo_taebaek_${date}_general`).get()).data()?.last).toBe(1);
  },20_000);

  it('kg 미확인 벌크에 거래 수량 분모 원가를 송신하면 번호·전표·품목 쓰기 모두 거절한다', async () => {
    await seed(); const id='raw-no-kg-cost';
    await db.collection('items').doc('raw-no-kg-cost-item').set({companyId:'taebaek',name:'원료',type:'raw',subtype:'벌크',cost:80});
    const line={itemId:'raw-no-kg-cost-item',name:'원료',spec:'20kg',qty:2,price:22000,supply:40000,tax:4000,total:44000,isTaxExempt:false,accountCode:'500'};
    await expect(issue({...input(id),statement:{...statement(id),type:'매입',orderId:'',items:[line],totalSupply:40000,totalTax:4000,totalAmount:44000},orderIds:[],
      costUpdates:[{itemId:line.itemId,price:20000,beforeCost:80,sourceLineIndex:0}]})).rejects.toThrow('kg 수량');
    expect((await db.collection('issuedStatements').doc(id).get()).exists).toBe(false);
    expect((await db.collection('items').doc(line.itemId).get()).data()?.cost).toBe(80);
    expect((await db.collection('itemCostHistory').doc(`${id}_${line.itemId}_0`).get()).exists).toBe(false);
    expect((await db.collection('appMeta').doc(`voucherNo_taebaek_${date}_general`).get()).data()?.last).toBe(0);
  },20_000);

  it('신규 원료 거래2포/확인40kg를 원가1000으로 저장하고 번호·발주수량·동일원문을 보존한다', async () => {
    await seed(); const id='explicit-raw-kg';
    await db.collection('items').doc('raw-kg').set({companyId:'taebaek',name:'원료20kg포',type:'raw',subtype:'벌크',unit:'포',cost:80});
    const line={itemId:'raw-kg',name:'원료20kg포',spec:'20kg',qty:2,price:22000,supply:40000,tax:4000,total:44000,
      isTaxExempt:false,accountCode:'500',purchaseQuantityKg:40};
    const request={...input(id),orderIds:[],statement:{...statement(id),type:'매입',orderId:'',totalSupply:40000,totalTax:4000,totalAmount:44000,items:[line]},
      newPo:{id:`po-${id}`,cardNo:'PO-261003-090',items:[{itemId:'raw-kg',itemName:'원료20kg포',quantity:2,isBox:false,unit:'포'}]},
      costUpdates:[{itemId:'raw-kg',price:1000,beforeCost:80,sourceLineIndex:0}]};
    const first=await issue(request);
    const saved=(await db.collection('issuedStatements').doc(id).get()).data()!;
    const po=(await db.collection('purchaseOrders').doc(`po-${id}`).get()).data()!;
    expect(saved.items[0]).toEqual(line);expect(saved.totalAmount).toBe(44000);
    expect(po.items[0]).toMatchObject({quantity:2,unit:'포'});expect((await db.collection('items').doc('raw-kg').get()).data()?.cost).toBe(1000);
    const counter=db.collection('appMeta').doc(`voucherNo_taebaek_${date}_general`),before=(await counter.get()).data();
    expect(await issue(request)).toEqual({...first,status:'duplicate'});expect((await counter.get()).data()).toEqual(before);
    await expect(issue({...request,statement:{...request.statement,items:[{...line,purchaseQuantityKg:20}]},
      costUpdates:[{itemId:'raw-kg',price:2000,beforeCost:80,sourceLineIndex:0}]})).rejects.toThrow();
    expect((await counter.get()).data()).toEqual(before);expect((await db.collection('issuedStatements').doc(id).get()).data()).toEqual(saved);
  });

  it('명시 kg의 타회사/일반품목 및 거래qty 분모 원가는 쓰기·번호 없이 거절한다',async()=>{
    await seed();const counter=db.collection('appMeta').doc(`voucherNo_taebaek_${date}_general`),before=(await counter.get()).data();
    for(const [index,itemData] of [{companyId:'punghoe',type:'raw',subtype:'벌크'},{companyId:'taebaek',type:'raw',subtype:'낱개'}].entries()){
      const itemId=`invalid-kg-${index}`,id=`invalid-kg-statement-${index}`;
      await db.collection('items').doc(itemId).set({...itemData,cost:80});
      const line={...statement(id).items[0],itemId,accountCode:'500',qty:2,price:22000,supply:40000,tax:4000,total:44000,isTaxExempt:false,purchaseQuantityKg:40};
      const request={...input(id),orderIds:[],statement:{...statement(id),type:'매입',orderId:'',totalSupply:40000,totalTax:4000,totalAmount:44000,items:[line]},
        costUpdates:[{itemId,price:1000,beforeCost:80,sourceLineIndex:0}]};
      await expect(issue(request)).rejects.toThrow();expect((await db.collection('issuedStatements').doc(id).get()).exists).toBe(false);
      expect((await db.collection('items').doc(itemId).get()).data()?.cost).toBe(80);
      await expect(issue({...request,costUpdates:[{...request.costUpdates[0],price:20000}]})).rejects.toThrow('원문');
    }
    expect((await counter.get()).data()).toEqual(before);
  });

  it('등록된 매입 단위 22.5kg포를 거래2포·원가kg·발주 스냅샷으로 일치 저장한다',async()=>{
    await seed(); const id='registered-purchase-unit'; const rawId='registered-raw';
    await db.collection('items').doc(rawId).set({companyId:'taebaek',name:'합성 원료',type:'raw',subtype:'벌크',unit:'L',cost:80});
    const snapshot={sourceLineIndex:0,purchaseUnitId:'registered-unit',purchaseUnit:'22.5kg포',purchaseQty:2,unitKg:22.5,inventoryQty:45};
    await db.collection('item_purchase_unit').doc(snapshot.purchaseUnitId).set({companyId:'taebaek',itemId:rawId,partnerId:'p1',purchaseUnit:snapshot.purchaseUnit,unitKg:22.5,isDefault:true,active:true});
    const line={itemId:rawId,name:'합성 원료',qty:2,price:22000,supply:40000,tax:4000,total:44000,isTaxExempt:false,accountCode:'500',...snapshot};
    const request={...input(id),orderIds:[],statement:{...statement(id),type:'매입',orderId:'',totalSupply:40000,totalTax:4000,totalAmount:44000,items:[line]},
      newPo:{id:`po-${id}`,cardNo:'PO-261003-092',items:[{itemId:rawId,itemName:'합성 원료',quantity:2,unit:'L',isBox:false,...snapshot}]},costUpdates:[{itemId:rawId,price:889,beforeCost:80,sourceLineIndex:0}]};
    const result=await issue(request);
    expect((await db.collection('issuedStatements').doc(id).get()).data()?.items[0]).toEqual(line);
    expect((await db.collection('purchaseOrders').doc(`po-${id}`).get()).data()?.items[0]).toMatchObject({quantity:2,unit:'L',...snapshot});
    expect((await db.collection('items').doc(rawId).get()).data()?.cost).toBe(889);
    await db.collection('item_purchase_unit').doc(snapshot.purchaseUnitId).update({active:false,unitKg:25});
    expect(await issue(request)).toEqual({...result,status:'duplicate'});
  });
  it.each(['foreign','inactive','supplier','weight','po-snapshot'])('매입 단위 등록표·전표·발주 불일치 %s는 쓰기 전 거절한다',async scenario=>{
    await seed(); const id=`unit-reject-${scenario}`; const rawId=`unit-raw-${scenario}`; const unitId=`unit-${scenario}`;
    await db.collection('items').doc(rawId).set({companyId:'taebaek',name:'원료',type:'raw',subtype:'벌크',unit:'kg',cost:80});
    const snapshot={sourceLineIndex:0,purchaseUnitId:unitId,purchaseUnit:'포',purchaseQty:2,unitKg:20,inventoryQty:40};
    await db.collection('item_purchase_unit').doc(unitId).set({companyId:scenario==='foreign'?'punghoe':'taebaek',itemId:rawId,partnerId:scenario==='supplier'?'other':'p1',purchaseUnit:'포',unitKg:scenario==='weight'?25:20,isDefault:true,active:scenario!=='inactive'});
    const line={itemId:rawId,name:'원료',qty:2,price:100,supply:200,tax:0,total:200,isTaxExempt:true,accountCode:'500',...snapshot};
    const poSnapshot=scenario==='po-snapshot'?{...snapshot,unitKg:25,inventoryQty:50}:snapshot;
    await expect(issue({...input(id),orderIds:[],statement:{...statement(id),type:'매입',orderId:'',totalSupply:200,totalTax:0,totalAmount:200,items:[line]},
      newPo:{id:`po-${id}`,cardNo:'PO-261003-093',items:[{itemId:rawId,itemName:'원료',quantity:2,unit:'kg',isBox:false,...poSnapshot}]}})).rejects.toThrow();
    expect((await db.collection('issuedStatements').doc(id).get()).exists).toBe(false);
    expect((await db.collection('purchaseOrders').doc(`po-${id}`).get()).exists).toBe(false);
    expect((await db.collection('items').doc(rawId).get()).data()?.cost).toBe(80);
  });
  it.each(['valid','duplicate','missing'])('같은 원료 20·25kg 포 행의 신규 발주 coverage와 가중 원가 %s',async mode=>{
    await seed(); const id=`mixed-${mode}`,rawId=`mixed-raw-${mode}`;
    await db.collection('items').doc(rawId).set({companyId:'taebaek',name:'원료',type:'raw',subtype:'벌크',unit:'kg',cost:80});
    const lines=[20,25].map((unitKg,sourceLineIndex)=>({itemId:rawId,name:'원료',qty:1,price:unitKg*1100,supply:unitKg*1000,tax:unitKg*100,total:unitKg*1100,isTaxExempt:false,accountCode:'500',sourceLineIndex,purchaseUnitId:`${id}-u${unitKg}`,purchaseUnit:'포',purchaseQty:1,unitKg,inventoryQty:unitKg}));
    for(const line of lines)await db.collection('item_purchase_unit').doc(line.purchaseUnitId).set({companyId:'taebaek',itemId:rawId,purchaseUnit:'포',unitKg:line.unitKg,isDefault:false,active:true});
    const poLines=lines.map(({qty,...row})=>({...row,itemName:row.name,quantity:qty,unit:'kg',isBox:false}));
    const request={...input(id),orderIds:[],statement:{...statement(id),type:'매입',orderId:'',items:lines,totalSupply:45000,totalTax:4500,totalAmount:49500},newPo:{id:`po-${id}`,cardNo:`PO-261003-${mode==='valid'?'094':mode==='duplicate'?'095':'096'}`,items:mode==='duplicate'?[poLines[0],poLines[0]]:mode==='missing'?[poLines[0]]:poLines},costUpdates:[{itemId:rawId,price:1000,beforeCost:80,sourceLineIndex:0,sourceLineIndices:[0,1]}]};
    if(mode==='valid'){expect((await issue(request)).status).toBe('applied');expect((await db.collection('items').doc(rawId).get()).get('cost')).toBe(1000);expect((await db.collection('purchaseOrders').doc(`po-${id}`).get()).get('items')).toHaveLength(2);}
    else{await expect(issue(request)).rejects.toThrow('중복되거나 누락');expect((await db.collection('issuedStatements').doc(id).get()).exists).toBe(false);expect((await db.collection('items').doc(rawId).get()).get('cost')).toBe(80);}
  });
  beforeAll(async () => { app = admin.initializeApp({ projectId }, projectId); db = admin.firestore(app); });
  afterAll(async () => {
    // 이 파일이 만든 격리 project의 최초 요청 영수증만 정리한다. 공유 운영·타 시험 자료를 지우지 않는다.
    const receipts=await db.collection('statementIssueOperations').get();await Promise.all(receipts.docs.map(doc=>doc.ref.delete()));
    expect((await db.collection('statementIssueOperations').get()).empty).toBe(true);await app?.delete();
  });

  it('최신 생산용 주문은 매출 연결을 거절하고 번호·원문을 바꾸지 않는다', async () => {
    await seed('stock-production-order');
    const ref=db.collection('orders').doc('stock-production-order');
    await ref.update({purpose:'stock-production'});
    const before=(await ref.get()).data();
    const counter=db.collection('appMeta').doc('voucherNo_taebaek_'+date+'_general');
    const originalCounter=(await counter.get()).data();
    const request={...input('stock-sale'),statement:{...statement('stock-sale'),orderId:'stock-production-order'},orderIds:['stock-production-order']};
    await expect(issue(request)).rejects.toThrow('생산용 주문');
    expect((await ref.get()).data()).toEqual(before);
    expect((await counter.get()).data()).toEqual(originalCounter);
    expect((await db.collection('issuedStatements').doc('stock-sale').get()).exists).toBe(false);
  });

  it('9/30 추가 번호를 일반 전표와 자금전표가 공유하고 재시도해도 기존 번호통은 그대로 둔다', async () => {
    await seed('catch-up-order');
    const extraDate = '2026-09-30';
    const extraCounter = db.collection('appMeta').doc('voucherNo_taebaek_2026-09-30_추가');
    await extraCounter.set({ companyId: 'taebaek', tradeDate: extraDate, prefix: '추가', last: 0 });
    await db.collection('appMeta').doc('releaseCutover').set({ status: 'active', releaseId,
      voucherNotBefore: { taebaek: date }, catchUp: { companyId: 'taebaek', tradeDate: extraDate, status: 'open' } });
    const request = { ...input('catch-up-statement'), statement: { ...statement('catch-up-statement'),
      orderId: 'catch-up-order', tradeDate: extraDate, issuedAt: `${extraDate}T09:00:00.000Z` },
      orderIds: ['catch-up-order'] };
    expect((await issue(request)).docNo).toBe('추가260930-001');
    const cash = { kind: 'cashEntries' as const, operationId: 'catch-up-cash', releaseId, tradeDate: extraDate,
      document: { date: extraDate, amount: 100, accountCode: '811' } };
    expect((await issueVoucher(db, 'taebaek', cash)).docNo).toBe('추가260930-002');
    expect((await issue(request)).status).toBe('duplicate');
    expect((await issueVoucher(db, 'taebaek', cash)).docNo).toBe('추가260930-002');
    expect((await extraCounter.get()).data()?.last).toBe(2);
    expect((await db.collection('appMeta').doc(`voucherNo_taebaek_${date}_general`).get()).data()?.last).toBe(0);
  }, 20_000);

  it('단일 발행은 주문·전표·번호를 함께 쓰고 동일 요청은 원번호를 반환한다', async () => {
    await seed();
    const result = await issue(input('stmt-1'));
    expect(result).toEqual({ status: 'applied', id: 'stmt-1', docNo: '261003-001' });
    await db.collection('appMeta').doc('releaseCutover').update({ status: 'paused' });
    expect(await issue(input('stmt-1'))).toEqual({...result,status:'duplicate'});
    await db.collection('appMeta').doc('releaseCutover').update({ status: 'active' });
    await expect(issue({ ...input('stmt-1'), actorId: 'spoofed', recordedAt: '2000-01-01T00:00:00.000Z' } as never)).rejects.toThrow('원문');
    expect(await issue(input('stmt-1'))).toEqual({ ...result, status: 'duplicate' });
    expect((await db.collection('orders').doc('o1').get()).data()?.linkedStatementId).toBe('stmt-1');
    expect((await db.collection('orders').doc('o1').get()).data()?.invoicePrinted).toBe(false);
    expect((await db.collection('issuedStatements').doc('stmt-1').get()).data()?.docNo).toBe(result.docNo);
    expect((await db.collection('appMeta').doc(`voucherNo_taebaek_${date}_general`).get()).data()?.last).toBe(1);
    await db.collection('orders').doc('o1').update({ linkedStatementId: 'other' });
    await expect(issue(input('stmt-1'))).rejects.toThrow('주문 연결');
    await db.collection('orders').doc('o1').update({ linkedStatementId: 'stmt-1' });
    await db.collection('issuedStatements').doc('stmt-1').update({ totalAmount: 1 });
    const tamperedStatement = (await db.collection('issuedStatements').doc('stmt-1').get()).data();
    const originalCounter = (await db.collection('appMeta').doc(`voucherNo_taebaek_${date}_general`).get()).data();
    await expect(issue(input('stmt-1'))).rejects.toThrow('전표 원 발행과 변경 감사 사슬');
    expect((await db.collection('issuedStatements').doc('stmt-1').get()).data()).toEqual(tamperedStatement);
    expect((await db.collection('appMeta').doc(`voucherNo_taebaek_${date}_general`).get()).data()).toEqual(originalCounter);
    await expect(issue(input('stmt-2'))).rejects.toThrow('주문');
    expect((await db.collection('issuedStatements').doc('stmt-2').get()).exists).toBe(false);
  }, 20_000);

  it('송장 출력만 된 주문은 발행하고, 과거 전표가 이미 연결된 주문은 다시 발행하지 않는다', async () => {
    await seed('printed-order');
    await db.collection('orders').doc('printed-order').update({ invoicePrinted: true });
    const printed = { ...input('stmt-printed'), statement: { ...statement('stmt-printed'), orderId: 'printed-order' }, orderIds: ['printed-order'] };
    expect((await issue(printed)).status).toBe('applied');
    expect((await db.collection('orders').doc('printed-order').get()).data()?.invoicePrinted).toBe(true);

    await seed('legacy-order', false);
    await db.collection('issuedStatements').doc('legacy-statement').set({
      companyId: 'taebaek', partnerId: 'p1', orderId: 'legacy-order', docNo: '260901-001',
    });
    const duplicate = { ...input('stmt-duplicate'), statement: { ...statement('stmt-duplicate'), orderId: 'legacy-order' }, orderIds: ['legacy-order'] };
    await expect(issue(duplicate)).rejects.toThrow('이미 연결된 전표');
    expect((await db.collection('issuedStatements').doc('stmt-duplicate').get()).exists).toBe(false);
  }, 20_000);

  it('같은 주문을 동시에 두 전표로 발행해도 한 장만 저장한다', async () => {
    await seed('same-order');
    const request = (id: string) => ({ ...input(id), statement: { ...statement(id), orderId: 'same-order' }, orderIds: ['same-order'] });
    const results = await Promise.allSettled([issue(request('same-a')), issue(request('same-b'))]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const linked = (await db.collection('orders').doc('same-order').get()).data()?.linkedStatementId;
    expect(['same-a', 'same-b']).toContain(linked);
  }, 20_000);

  it('카운터가 없으면 주문·전표·발주 링크가 모두 미반영이다', async () => {
    await db.collection('appMeta').doc(`voucherNo_taebaek_${date}_general`).delete();
    await seed('o2', false);
    const request = { ...input('stmt-3'), statement: { ...statement('stmt-3'), orderId: 'o2' }, orderIds: ['o2'] };
    await expect(issue(request)).rejects.toThrow('카운터');
    expect((await db.collection('orders').doc('o2').get()).data()?.invoicePrinted).toBe(false);
    expect((await db.collection('issuedStatements').doc('stmt-3').get()).exists).toBe(false);
  });
  it('이전 release·추가창 종료 뒤 일반 전표 정확 원문 ACK는 번호·주문·원문을 쓰지 않는다',async()=>{
    await seed('previous-release-order');const id='old-release-'+randomUUID(),extraDate='2026-09-30';
    const counter=db.doc('appMeta/voucherNo_taebaek_2026-09-30_추가');await counter.set({companyId:'taebaek',tradeDate:extraDate,prefix:'추가',last:0});
    await db.doc('appMeta/releaseCutover').update({catchUp:{companyId:'taebaek',tradeDate:extraDate,status:'open'}});
    const request={...input(id),statement:{...statement(id),tradeDate:extraDate,orderId:'previous-release-order'},orderIds:['previous-release-order']},first=await issue(request);
    await db.doc('appMeta/releaseCutover').update({releaseId:'new-release',catchUp:{companyId:'taebaek',tradeDate:extraDate,status:'closed'},voucherNotBefore:{taebaek:'2099-01-01'}});
    const before=await Promise.all([db.doc('issuedStatements/'+id).get(),db.doc('orders/previous-release-order').get(),counter.get()]);
    expect(await issue(request)).toEqual({...first,status:'duplicate'});const after=await Promise.all(before.map(snap=>snap.ref.get()));after.forEach((snap,index)=>expect(snap.updateTime!.isEqual(before[index].updateTime!)).toBe(true));
    const nextId=id+'-new';await expect(issue({...request,operationId:nextId+':ISSUE',statement:{...request.statement,id:nextId}})).rejects.toThrow('활성화');
    await db.doc('issuedStatements/'+id).delete();await counter.delete();
  });

  it('매입 전표와 발주 링크·원가·이력을 한 거래로 저장한다', async () => {
    await seed('o3');
    await Promise.all([
      db.collection('items').doc('i1').set({ companyId: 'taebaek', name: '상품', type: 'product', cost: 80 }),
      db.collection('purchaseOrders').doc('po1').set({ companyId: 'taebaek', partnerId: 'p1', status: 'pending' }),
    ]);
    const purchase = {
      ...statement('stmt-4'), type: '매입', orderId: '',
      items: [{ ...statement('stmt-4').items[0], accountCode: '500' }],
    };
    const request = { ...input('stmt-4'), actorId:'spoofed',recordedAt:'2000-01-01T00:00:00.000Z',statement: purchase, orderIds: [], poIds: ['po1'],
      costUpdates: [{ itemId: 'i1', price: 100, beforeCost: 80, sourceLineIndex: 0 }] };
    const result = await issue({ ...request, actorId: 'spoofed', recordedAt: '2000-01-01T00:00:00.000Z' } as never);
    expect(result.status).toBe('applied');
    expect((await db.collection('purchaseOrders').doc('po1').get()).data()?.linkedStatementId).toBe('stmt-4');
    expect((await db.collection('items').doc('i1').get()).data()?.cost).toBe(100);
    const history = (await db.collection('itemCostHistory').doc('stmt-4_i1_0').get()).data();
    expect(history?.companyId).toBe('taebaek');
    expect(history?.afterCost).toBe(100);
    expect(history?.actorId).toBe('auth-user');
    expect(history?.recordedAt).not.toBe('2000-01-01T00:00:00.000Z');
    expect(await issue(request)).toEqual({ ...result, status: 'duplicate' });
    await db.collection('purchaseOrders').doc('po1').update({ linkedStatementId: 'other' });
    await expect(issue(request)).rejects.toThrow('발주 연결');
  });

  it('서로 다른 주문을 동시 발행해도 일반 번호가 겹치지 않는다', async () => {
    await seed('o4');
    await seed('o5', false);
    const a = { ...input('stmt-5'), statement: { ...statement('stmt-5'), orderId: 'o4' }, orderIds: ['o4'] };
    const b = { ...input('stmt-6'), statement: { ...statement('stmt-6'), orderId: 'o5' }, orderIds: ['o5'] };
    const results = await Promise.all([issue(a), issue(b)]);
    expect(new Set(results.map(r => r.docNo)).size).toBe(2);
    expect((await db.collection('appMeta').doc(`voucherNo_taebaek_${date}_general`).get()).data()?.last).toBe(2);
  }, 20_000);

  it('새 발주카드도 전표와 함께 만들고 카드번호 충돌은 전체 거절한다', async () => {
    await seed('o6');
    await db.collection('items').doc('i1').set({ companyId: 'taebaek', name: '상품', type: 'product', cost: 80 });
    const purchase = { ...statement('stmt-7'), type: '매입', orderId: '',
      items: [{ ...statement('stmt-7').items[0], accountCode: '500' }] };
    const request = { ...input('stmt-7'), statement: purchase, orderIds: [],
      newPo: { id: 'po-stmt-7', cardNo: 'PO-261003-001',
        items: [{ itemId: 'i1', itemName: '상품', quantity: 1, isBox: false, unit: '개' }] } };
    const result = await issue(request);
    expect((await db.collection('purchaseOrders').doc('po-stmt-7').get()).data()?.linkedStatementId).toBe(result.id);
    const clash = { ...request, operationId: 'stmt-8:ISSUE',
      statement: { ...purchase, id: 'stmt-8' }, newPo: { ...request.newPo, id: 'po-stmt-8' } };
    await expect(issue(clash)).rejects.toThrow('발주카드 번호');
    expect((await db.collection('issuedStatements').doc('stmt-8').get()).exists).toBe(false);
  });

  it('같은 발주카드 번호의 동시 발행은 예약 문서에서 하나만 성공한다', async () => {
    await seed('o7');
    await db.collection('items').doc('i1').set({ companyId: 'taebaek', name: '상품', type: 'product', cost: 80 });
    const request = (id: string) => ({ ...input(id), orderIds: [],
      statement: { ...statement(id), type: '매입', orderId: '',
        items: [{ ...statement(id).items[0], accountCode: '500' }] },
      newPo: { id: `po-${id}`, cardNo: 'PO-261003-002',
        items: [{ itemId: 'i1', itemName: '상품', quantity: 1, isBox: false, unit: '개' }] } });
    const results = await Promise.allSettled([issue(request('stmt-9')), issue(request('stmt-10'))]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await db.collection('appMeta').doc('poCardNo_taebaek_PO-261003-002').get()).exists).toBe(true);
    expect((await db.collection('purchaseOrders').where('cardNo', '==', 'PO-261003-002').get()).size).toBe(1);
  }, 20_000);

  it('0수량과 전체 음수 신규 발행은 거절하되 양수 총액의 할인 줄은 허용한다', async () => {
    const zero = { ...statement('stmt-11'), orderId: '', items: [
      { ...statement('stmt-11').items[0], qty: 0, price: 100, supply: 0, tax: 0, total: 0 },
      statement('stmt-11').items[0],
    ] };
    await expect(issue({ ...input('stmt-11'), statement: zero, orderIds: [] })).rejects.toThrow('전표 줄');
    const negative = { ...statement('stmt-12'), orderId: '', totalSupply: -100, totalAmount: -100,
      items: [{ ...statement('stmt-12').items[0], price: -100, supply: -100, total: -100 }] };
    await expect(issue({ ...input('stmt-12'), statement: negative, orderIds: [] })).rejects.toThrow('전표 합계');
    await seed('o8');
    const discounted = { ...statement('stmt-13'), orderId: '', items: [
      { ...statement('stmt-13').items[0], price: 200, supply: 200, total: 200 },
      { name: '할인', spec: '', qty: 1, price: -100, supply: -100, tax: 0, total: -100,
        isTaxExempt: true, accountCode: '800' },
    ] };
    expect((await issue({ ...input('stmt-13'), statement: discounted, orderIds: [] })).status).toBe('applied');
  });
});
