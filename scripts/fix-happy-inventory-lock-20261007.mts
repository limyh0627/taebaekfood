/** 출고 취소 예약 검증에서 멈춘 해피유통 탈피의 실패 잠금 한 필드만 해제한다. */
import {adminDb} from './_admin.mts';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=adminDb(),id='ORD-1790915834767',base='outputs/happy-unlock-20261007/';
const evidence=JSON.parse(readFileSync(base+id+'-evidence.json','utf8'));
const original=evidence.order,op=original.inventoryOperation,ref=db.collection('orders').doc(id);
const apply=process.argv.includes('--apply'),undo=process.argv.includes('--undo');assert(!(apply&&undo));
const strip=(o:any)=>{const {inventoryOperation,...rest}=o;return rest;};
const same=assert.deepStrictEqual;
if(undo){const old=JSON.parse(readFileSync(base+'before.json','utf8'));await db.runTransaction(async tx=>{const s=await tx.get(ref);assert.equal(s.data()?.inventoryOperation,null);same(strip(s.data()),strip(old));tx.update(ref,{inventoryOperation:old.inventoryOperation});});same((await ref.get()).data(),old);console.log('해피유통 탈피 잠금 복원 검증 완료');process.exit(0);}
assert.equal(original.companyId,'taebaek');assert.equal(original.partnerName,'해피유통');assert.equal(original.status,'SHIPPED');assert.equal(original.shippedOut,true);
assert.equal(op.id,'order-status-ORD-1790915834767-1791362464440');assert.equal(op.state,'failed');assert.equal(op.targetStatus,'DISPATCHED');assert.match(op.error,/현재 0, 다른 주문 예약 0, 이번 주문 36/);
assert(original.inventorySnapshots?.shipment?.stockDeltas.length>0);
const failed=evidence.audits.find((a:any)=>a.id===op.id);assert.equal(failed.data.state,'failed');assert.equal(failed.data.error,op.error);
const failedMs=Date.parse(op.startedAt);
for(const row of evidence.items){assert(row.version._seconds*1000+row.version._nanoseconds/1e6<failedMs);assert((row.data.inventoryReservations??[]).every((r:any)=>r.operationId!==op.id));}
// 실패 감사의 stockAdjustments는 실행 결과가 아니라 승인한 계획이다. 문서 버전으로 미반영을 증명한다.
const shipping=evidence.audits.find((a:any)=>a.data.state==='completed'&&a.data.nextStatus==='SHIPPED');assert(shipping);assert(Date.parse(shipping.data.completedAt)<failedMs);
if(!apply){console.log('검증 완료: 해피유통 탈피 '+original.cardNo+' 실패 전 재고 버전 유지. inventoryOperation 한 필드만 null 예정');process.exit(0);}
if(existsSync(base+'before.json'))same(JSON.parse(readFileSync(base+'before.json','utf8')),original);else writeFileSync(base+'before.json',JSON.stringify(original,null,2));
await db.runTransaction(async tx=>{
 const s=await tx.get(ref);same(s.data(),original);assert.equal(s.updateTime?.seconds,evidence.version._seconds);assert.equal(s.updateTime?.nanoseconds,evidence.version._nanoseconds);
 for(const [collection,rows] of [['items',evidence.items],['orderStatusAudits',evidence.audits]] as const)for(const row of rows){const current=await tx.get(db.collection(collection).doc(row.id));same(current.data(),row.data);assert.equal(current.updateTime?.seconds,row.version._seconds);assert.equal(current.updateTime?.nanoseconds,row.version._nanoseconds);}
 tx.update(ref,{inventoryOperation:null});
});
const after=(await ref.get()).data();assert.equal(after?.inventoryOperation,null);same(strip(after),strip(original));
for(const row of evidence.items){const current=await db.collection('items').doc(row.id).get();same(current.data(),row.data);assert.equal(current.updateTime?.seconds,row.version._seconds);assert.equal(current.updateTime?.nanoseconds,row.version._nanoseconds);}
writeFileSync(base+'verification.json',JSON.stringify({verifiedAt:new Date().toISOString(),orderId:id,cardNo:original.cardNo,status:after?.status,changedFields:['inventoryOperation'],inventoryWrites:0,verified:true},null,2));
console.log('해피유통 탈피 '+original.cardNo+' 실패 잠금 해제 검증 완료. 출고 상태·출고 기록·로트·재고 불변');
