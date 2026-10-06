/** 김밥담 출고 실패 잠금만 해제. 재고 변경 없이 백업/transaction 재확인/재조회. */
import {adminDb} from './_admin.mts';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=adminDb(),id='ORD-1791261355911',ref=db.collection('orders').doc(id);
const base='outputs/gimbapdam-unlock-20261007/',backup=base+'before.json';
const apply=process.argv.includes('--apply'),undo=process.argv.includes('--undo');
assert(!(apply&&undo));
const proof=JSON.parse(readFileSync(base+'evidence.json','utf8'));
const strip=o=>{const {inventoryOperation,...rest}=o;return rest;};
const same=(a,b)=>assert.deepStrictEqual(a,b);
if(undo){
 const old=JSON.parse(readFileSync(backup,'utf8'));
 await db.runTransaction(async tx=>{const s=await tx.get(ref);const current=s.data();assert(current?.inventoryOperation==null);same(strip(current),strip(old));tx.update(ref,{inventoryOperation:old.inventoryOperation});});
 same((await ref.get()).data(),old);console.log('실패 잠금 복원 검증 완료');process.exit(0);
}
const original=proof.order,op=original.inventoryOperation;
assert.equal(original.companyId,'taebaek');assert.equal(original.partnerName,'김밥담');assert.equal(original.status,'DISPATCHED');
assert.equal(op.id,'order-status-ORD-1791261355911-1791273219444');assert.equal(op.state,'failed');assert.equal(op.targetStatus,'SHIPPED');
assert(!original.shippedOut);assert(!original.inventorySnapshots?.shipment);assert(!(original.productConsumedLots?.length));
const audit=proof.evidence.orderStatusAudits.find(a=>a.id===op.id);
assert.equal(audit.state,'failed');assert.equal(audit.stockAdjustments.length,0);assert.equal(audit.error,op.error);
assert(proof.evidence.rawInventoryJobs.every(j=>j.status==='complete'&&j.completedAt<op.startedAt));
assert(proof.evidence.rawMaterialLedger.every(l=>l.recordedAt<op.startedAt));
assert(proof.evidence.items.every(i=>(i.inventoryReservations??[]).every(r=>r.operationId!==op.id)));
if(!apply){console.log('대상/실패/출고 미반영 검증 완료. 변경: orders/'+id+' inventoryOperation=null 1필드');process.exit(0);}
if(existsSync(backup))same(JSON.parse(readFileSync(backup,'utf8')),original);else writeFileSync(backup,JSON.stringify(original,null,2));
await db.runTransaction(async tx=>{
 const snap=await tx.get(ref);same(snap.data(),original);
 for(const [name,rows] of Object.entries(proof.evidence))for(const row of rows){const {id:docId,...data}=row;const s=await tx.get(db.collection(name).doc(docId));const {id:storedId,...stored}=s.data();same(stored,data);}
 tx.update(ref,{inventoryOperation:null});
});
const after=(await ref.get()).data();assert.equal(after.inventoryOperation,null);same(strip(after),strip(original));
writeFileSync(base+'verification.json',JSON.stringify({verifiedAt:new Date().toISOString(),project:'taebaek-3abe4',orderId:id,cardNo:original.cardNo,changedFields:['inventoryOperation'],inventoryWrites:0,status:after.status,remainingLock:after.inventoryOperation},null,2));
console.log('김밥담 '+original.cardNo+' 잠금 해제·재조회 검증 완료. 재고쓰기 0, 주문상태 유지.');

