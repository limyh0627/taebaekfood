import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { adminDb } from './_admin.mts';
const db=adminDb(), companyId='punghoe', tradeDate='2026-09-30', prefix='급여';
const amounts=[2800000,3500000];
const refs=amounts.map(amount=>db.doc(`issuedStatements/salary-punghoe-20260930-${amount}`));
const counter=db.doc('appMeta/voucherNo_punghoe_2026-09-30_급여');
const [statements,cash,accounts,counterBefore,gate]=await Promise.all([
  db.collection('issuedStatements').where('companyId','==',companyId).get(),
  db.collection('cashEntries').where('companyId','==',companyId).get(),
  db.collection('accountCodes').where('companyId','==',companyId).get(),counter.get(),db.doc('appMeta/releaseCutover').get(),
]);
for(const [code,name] of [['802','급여'],['275','미지급비용']]){
  const matches=accounts.docs.filter(d=>d.get('code')===code&&d.get('name')===name);
  if(matches.length!==1)throw new Error('풍회 급여 계정 불일치');
}
const sameDay=[...statements.docs,...cash.docs].filter(d=>(d.get('tradeDate')??d.get('date'))===tradeDate);
const duplicate=sameDay.filter(d=>/급여/.test(JSON.stringify(d.data()))&&amounts.includes(d.get('totalAmount')??d.get('amount')));
if(duplicate.length){
  if(duplicate.length===2&&refs.every(ref=>duplicate.some(d=>d.ref.path===ref.path))){console.log('이미 등록됨: '+duplicate.map(d=>d.get('docNo')).join(', '));process.exit(0);}
  throw new Error('동일 날짜·금액 급여 전표가 있어 중복 등록을 중단합니다.');
}
const used=sameDay.map(d=>d.get('docNo')).filter(n=>typeof n==='string'&&n.startsWith('급여260930-'));
if(used.length||counterBefore.exists)throw new Error('급여 번호 범위가 이미 사용 중입니다.');
const line=(amount:number,accountCode:string,side:string,name:string)=>({name,spec:'',qty:1,price:amount,supply:amount,tax:0,total:amount,isTaxExempt:true,accountCode,side});
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])):v;
const documents=amounts.map((amount,i)=>{
  const body={companyId,tradeDate,type:'비용',partnerId:'',partnerName:'급여',orderId:'',totalSupply:amount,totalTax:0,totalAmount:amount,
    items:[line(amount,'802','차변','9월 급여'),line(amount,'275','대변','미지급급여')],
    memo:'사용자 요청: 2026-09-30 풍회 급여 발생 전표',manualBackfill:true};
  return {...body,id:refs[i].id,docNo:`급여260930-${String(i+1).padStart(3,'0')}`,issueOperationId:refs[i].id,issuePrefix:prefix,
    issuePayloadHash:createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex'),issuedAt:new Date().toISOString()};
});
console.log(JSON.stringify({companyId,tradeDate,changes:documents.map(d=>({id:d.id,docNo:d.docNo,totalAmount:d.totalAmount,debit:'802 급여',credit:'275 미지급비용'})),cashWrites:0},null,2));
if(!process.argv.includes('--apply'))process.exit(0);
mkdirSync('outputs',{recursive:true});
writeFileSync('outputs/punghoe-salary-20260930-before.json',JSON.stringify({capturedAt:new Date().toISOString(),gate:gate.data(),counter:{path:counter.path,exists:counterBefore.exists,data:counterBefore.data()??null},companyStatements:statements.docs.map(d=>({path:d.ref.path,data:d.data()})),companyCash:cash.docs.map(d=>({path:d.ref.path,data:d.data()})),accountDefinitions:accounts.docs.map(d=>({path:d.ref.path,data:d.data()})),targets:refs.map(r=>({path:r.path,exists:false})),planned:documents},null,2));
await db.runTransaction(async tx=>{
  const [currentStatements,currentCash,currentCounter,currentGate,currentAccounts]=await Promise.all([
    tx.get(db.collection('issuedStatements').where('companyId','==',companyId)),tx.get(db.collection('cashEntries').where('companyId','==',companyId)),tx.get(counter),tx.get(gate.ref),tx.get(db.collection('accountCodes').where('companyId','==',companyId)),
  ]);
  const unchanged=(a:any,b:any)=>a.docs.length===b.docs.length&&a.docs.every((d:any)=>b.docs.some((e:any)=>e.id===d.id&&e.updateTime.isEqual(d.updateTime)));
  if(!unchanged(statements,currentStatements)||!unchanged(cash,currentCash)||!unchanged(accounts,currentAccounts)||currentCounter.exists||!currentGate.updateTime?.isEqual(gate.updateTime!))throw new Error('등록 직전 자료가 변경됐습니다.');
  documents.forEach((document,i)=>tx.create(refs[i],document));
  tx.create(counter,{companyId,tradeDate,prefix,last:2,initializedByRelease:gate.get('releaseId'),auditReason:'사용자 요청 9월 누락 급여 2건 직접 보완',initializedAt:new Date().toISOString()});
});
const saved=await Promise.all(refs.map(ref=>ref.get()));
saved.forEach((doc,i)=>{if(doc.get('companyId')!==companyId||doc.get('tradeDate')!==tradeDate||doc.get('totalAmount')!==amounts[i]||doc.get('docNo')!==documents[i].docNo)throw new Error('등록 재조회 불일치');});
if((await counter.get()).get('last')!==2)throw new Error('번호 재조회 불일치');
console.log('등록·재조회 완료: '+saved.map(d=>`${d.get('docNo')} ${d.get('totalAmount')}원`).join(', '));
