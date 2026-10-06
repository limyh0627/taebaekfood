import { adminDb } from './_admin.mts';
import { writeFileSync, mkdirSync } from 'node:fs';
const db=adminDb(), ref=db.doc('cashEntries/cash-1791286559391');
const before=await ref.get();
if(!before.exists) { console.log('Already deleted'); process.exit(0); }
const data=before.data()!;
if(data.companyId!=='taebaek'||data.date!=='2026-09-30'||data.amount!==1632579||data.accountCode!=='338'||data.dir!=='출금'||!data.note?.includes('종합소득세')) throw new Error('Target mismatch');
const related=await db.collection('settlements').where('companyId','==','taebaek').get();
const links=related.docs.filter(d=>JSON.stringify(d.data()).includes(ref.id));
if(links.length || data.partnerId || data.allocations?.length) throw new Error('Linked payment must use cancellation route');
mkdirSync('outputs',{recursive:true});
writeFileSync('outputs/owner-draw-20260930-before.json',JSON.stringify({path:ref.path,updateTime:before.updateTime?.toDate().toISOString(),data},null,2));
if(!process.argv.includes('--apply')) { console.log(JSON.stringify({target:ref.id,docNo:data.docNo,backup:'outputs/owner-draw-20260930-before.json',linkedSettlements:0})); process.exit(0); }
await db.runTransaction(async tx=>{const current=await tx.get(ref); if(current.updateTime?.isEqual(before.updateTime!)!==true) throw new Error('Target changed'); tx.delete(ref);});
console.log(JSON.stringify({deleted:!(await ref.get()).exists,id:ref.id,docNo:data.docNo,amount:data.amount}));
