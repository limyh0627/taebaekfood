// 오늘자 푸미푸드 입고 삭제 — PO + 수불부 + 로트 + 재고 되돌림. dry-run 기본, --apply 실행, --undo 복원.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, deleteDoc, updateDoc, setDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const HERE=path.dirname(fileURLToPath(import.meta.url)); const BK=path.join(HERE,'del-pumi-today-backup.json');
const apply=process.argv.includes('--apply'); const undo=process.argv.includes('--undo');
const load=async c=>(await getDocs(collection(db,c))).docs.map(d=>({_id:d.id,...d.data()}));
const today='2026-07-24';

if(undo){
  const b=JSON.parse(fs.readFileSync(BK,'utf8'));
  for(const po of b.pos) await setDoc(doc(db,'purchaseOrders',po._id),po);
  for(const l of b.ledger) await setDoc(doc(db,'rawMaterialLedger',l._id),l);
  for(const it of b.items) await setDoc(doc(db,'items',it._id),it);
  console.log('복원 완료'); process.exit(0);
}

const pos=(await load('purchaseOrders')).filter(p=>/푸미푸드/.test(JSON.stringify(p)) && String(p.receivedAt||p.createdAt||'').slice(0,10)===today);
const led=(await load('rawMaterialLedger')).filter(l=>/푸미푸드/.test(l.note||'')&&String(l.date||'').slice(0,10)===today);
const items=await load('items');
// 볶음참깨 wip 로트 중 푸미푸드 오늘
const holder=items.find(i=>i._id==='raw-볶음참깨');
const killLots=(holder?.lots||[]).filter(l=>/푸미푸드/.test(l.supplierName||'')&&String(l.receivedDate||'').slice(0,10)===today);
// 낱개/박스 재고는 이 입고가 안 올렸으므로(현재 11/0/0 = 입고 전과 동일) 건드리지 않는다.
const looseAdj={};

console.log(`${apply?'[삭제]':'[DRY RUN — 실행하려면 --apply]'}\n`);
console.log(`purchaseOrders ${pos.length}건:`);
pos.forEach(p=>console.log(`   ${p._id} | ${(p.items||[]).map(i=>`${i.name}×${i.quantity}`).join(', ')}`));
console.log(`rawMaterialLedger ${led.length}건:`);
led.forEach(l=>console.log(`   ${l._id} | ${l.material} received ${l.received}kg | ${l.note}`));
console.log(`볶음참깨 로트 삭제 ${killLots.length}개:`);
killLots.forEach(l=>console.log(`   ${l.lotNo||l.id} kgIn ${l.kgIn} kgRemaining ${l.kgRemaining} (${l.receivedDate})`));
const killKg=killLots.reduce((s,l)=>s+(l.kgRemaining||0),0);
console.log(`\n되돌릴 재고:`);
console.log(`   볶음참깨(wip) 로트 ${killKg}kg 제거 → 현재 stock ${holder?.stock} 재계산`);
for(const [id,q] of Object.entries(looseAdj)){ const it=items.find(x=>x._id===id); console.log(`   ${it?.name} stock ${it?.stock} − ${q} = ${(it?.stock||0)-q}`); }

if(!apply){ console.log('\n실행: node scripts/del-pumi-today.mjs --apply'); process.exit(0); }

// 백업
const looseItems=Object.keys(looseAdj).map(id=>items.find(x=>x._id===id)).filter(Boolean);
fs.writeFileSync(BK,JSON.stringify({pos,ledger:led,items:[holder,...looseItems]},null,2));
// 실행
for(const p of pos) await deleteDoc(doc(db,'purchaseOrders',p._id));
for(const l of led) await deleteDoc(doc(db,'rawMaterialLedger',l._id));
if(holder){
  const killIds=new Set(killLots.map(l=>l.id||l.lotNo));
  const remain=(holder.lots||[]).filter(l=>!killIds.has(l.id||l.lotNo));
  const newKg=remain.filter(l=>l.status==='active').reduce((s,l)=>s+(l.kgRemaining||0),0);
  // stock은 kg (wip 볶음참깨 단위 kg)
  await updateDoc(doc(db,'items','raw-볶음참깨'),{lots:remain,stock:Math.round(newKg*1000)/1000});
}
for(const [id,q] of Object.entries(looseAdj)){ const it=items.find(x=>x._id===id); if(it) await updateDoc(doc(db,'items',id),{stock:Math.round(((it.stock||0)-q)*1000)/1000}); }
console.log(`\n삭제 완료. 백업 ${BK}\n복원: node scripts/del-pumi-today.mjs --undo`);
process.exit(0);
