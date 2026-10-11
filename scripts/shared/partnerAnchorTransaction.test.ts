import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {describe,it,expect,vi,beforeAll,afterAll} from 'vitest';
import {initializeApp,deleteApp,type App} from 'firebase-admin/app';
import {getFirestore,type Firestore,Timestamp} from 'firebase-admin/firestore';
import {prepareAnchor,applyAnchor,captureApplied,undoAnchor,SOURCE_COLLECTIONS,encode,decode} from './partnerAnchorTransaction';
function fake(){
 let tick=0,writes=0;const data=new Map<string,{body:any;version:number}>();
 const snapshot=(path:string)=>{const row=data.get(path);return {id:path.split('/').at(-1),exists:!!row,updateTime:row?{seconds:row.version,nanoseconds:7}:undefined,data:()=>decode(encode(row?.body))};};
 const query=(name:string)=>({docs:[...data.keys()].filter(p=>p.startsWith(name+'/')).map(snapshot)});
 const db:any={collection:(name:string)=>({name,get:async()=>query(name),doc:(id:string)=>({path:name+'/'+id,id,get:async()=>snapshot(name+'/'+id)})}),
  runTransaction:async(fn:any)=>{const pending:any[]=[];const result=await fn({get:async(ref:any)=>{if(pending.length)throw Error('read after write');return ref.path?snapshot(ref.path):query(ref.name);},set:(ref:any,body:any)=>pending.push([ref.path,body]),delete:(ref:any)=>pending.push([ref.path,null])});for(const [path,body]of pending){writes++;if(body===null)data.delete(path);else data.set(path,{body:structuredClone(body),version:++tick});}return result;}};
 return {db:db as Firestore,write:(path:string,body:any)=>data.set(path,{body,version:++tick}),data,writes:()=>writes};
}
describe('043 conditional single anchor',()=>{
 it('empty verified source applies once, exact replay writes0, undo restores absence',async()=>{const f=fake();const p=await prepareAnchor(f.db,'taebaek','2025','anchor-unit','actual-uid');expect((await applyAnchor(f.db,p,p.planHash)).status).toBe('applied');expect(f.writes()).toBe(1);expect((await applyAnchor(f.db,p,p.planHash)).status).toBe('duplicate');expect(f.writes()).toBe(1);const r=await captureApplied(f.db,p);expect(await undoAnchor(f.db,p,r)).toBe('restored');expect(f.data.size).toBe(0);expect(await undoAnchor(f.db,p,r)).toBe('already-restored');expect(f.writes()).toBe(2);});
 it('source membership/version and current anchor changed after dry reject without writes',async()=>{for(const mode of ['source','anchor']){const f=fake();const p=await prepareAnchor(f.db,'punghoe','2025','anchor-cas','uid');f.write(mode==='source'?'partners/new':'partnerBalanceSnapshots/punghoe-2025',{companyId:'punghoe',name:'new'});await expect(applyAnchor(f.db,p,p.planHash)).rejects.toThrow('변경');expect(f.writes()).toBe(0);}});
 it('tampered approval/full plan and future year fail closed',async()=>{const f=fake();const p=await prepareAnchor(f.db,'taebaek','2025','anchor-proof','uid');await expect(applyAnchor(f.db,p,'x')).rejects.toThrow('지문');await expect(applyAnchor(f.db,{...p,actorId:'other'},p.planHash)).rejects.toThrow('지문');await expect(prepareAnchor(f.db,'taebaek','9999','anchor-future','uid')).rejects.toThrow('미래');expect(f.writes()).toBe(0);});
 it('existing anchor backup restored, later same-body new version blocks undo',async()=>{const f=fake();f.write('partnerBalanceSnapshots/taebaek-2025',{companyId:'taebaek',year:'2025',rows:[],custom:'preserve'});const p=await prepareAnchor(f.db,'taebaek','2025','anchor-old','uid');await applyAnchor(f.db,p,p.planHash);const r=await captureApplied(f.db,p);f.write('partnerBalanceSnapshots/taebaek-2025',structuredClone(r.after.data));await expect(undoAnchor(f.db,p,r)).rejects.toThrow('変更'.replace('変更','변경'));expect(f.writes()).toBe(1);});
 it('changed saved body cannot become an apply receipt or duplicate proof',async()=>{const f=fake();const p=await prepareAnchor(f.db,'taebaek','2025','anchor-rewrite','uid');await applyAnchor(f.db,p,p.planHash);const r=await captureApplied(f.db,p);f.write('partnerBalanceSnapshots/taebaek-2025',{...decode(r.after.data),custom:'changed'});await expect(captureApplied(f.db,p)).rejects.toThrow('원문');await expect(applyAnchor(f.db,p,p.planHash)).rejects.toThrow('변경');expect(f.writes()).toBe(1);});
 it('timestamp backup round trips seconds and nanos',()=>{const t=new Timestamp(123,456);const r=decode(encode({t}));expect(r.t).toBeInstanceOf(Timestamp);expect(r.t.isEqual(t)).toBe(true);});
 it('domain journal failure rejects prepare rather than silently producing a balance',async()=>{const f=fake();f.write('issuedStatements/bad',{companyId:'taebaek',type:'매출',items:[],tradeDate:'2025-01-01'});await expect(prepareAnchor(f.db,'taebaek','2025','anchor-invalid','uid')).rejects.toThrow();expect(f.writes()).toBe(0);});
});
const enabled=process.env.PARTNER_ANCHOR_EMULATOR_TEST==='true'&&['127.0.0.1:8082','127.0.0.1:8182'].includes(process.env.FIRESTORE_EMULATOR_HOST??'');
describe.skipIf(!enabled)('043 actual Admin emulator',()=>{
 let app:App,db:Firestore;const project=`demo-anchor-${Date.now()}`;
 beforeAll(()=>{app=initializeApp({projectId:project},project);db=getFirestore(app);});
 afterAll(async()=>{if(app)await deleteApp(app);});
 it('same-plan concurrency one applied/one duplicate and financial originals unchanged; conditional undo',async()=>{
  const partner=db.collection('partners').doc('synthetic-partner');await partner.set({companyId:'taebaek',name:'합성'});const before=await partner.get();
  const p=await prepareAnchor(db,'taebaek','2025','anchor-sdk','uid');const results=await Promise.allSettled([applyAnchor(db,p,p.planHash),applyAnchor(db,p,p.planHash)]);expect(results.filter(r=>r.status==='rejected').map(r=>(r as PromiseRejectedResult).reason?.message)).toEqual([]);expect(results.map(r=>r.status==='fulfilled'?r.value.status:'error').sort()).toEqual(['applied','duplicate']);const r=await captureApplied(db,p);expect((await partner.get()).updateTime!.isEqual(before.updateTime!)).toBe(true);await undoAnchor(db,p,r);expect((await db.collection('partnerBalanceSnapshots').doc(p.anchorId).get()).exists).toBe(false);
 });
 it('actual changes after captured receipt block undo even when the saved body is restored',async()=>{const p=await prepareAnchor(db,'punghoe','2025','anchor-sdk-rewrite','uid');await applyAnchor(db,p,p.planHash);const r=await captureApplied(db,p);const ref=db.collection('partnerBalanceSnapshots').doc(p.anchorId);const body=(await ref.get()).data()!;await ref.set({...body,external:'changed'});await expect(captureApplied(db,p)).rejects.toThrow('원문');await expect(applyAnchor(db,p,p.planHash)).rejects.toThrow('변경');await ref.set(body);await expect(undoAnchor(db,p,r)).rejects.toThrow('변경');await ref.delete();});
 it.each(['', '2025-02-30'])('실제 SDK 날짜 %s는 dry 및 기존 계획 apply를 쓰기 전에 차단한다',async date=>{
  const ref=db.collection('issuedStatements').doc('calendar-guard');const body={companyId:'taebaek',partnerId:'p',type:'매입',tradeDate:'2025-10-01',totalSupply:100,totalTax:0,totalAmount:100,items:[{name:'합성',qty:1,price:100,supply:100,tax:0,total:100,isTaxExempt:true,accountCode:'500'}]};
  try {await ref.set(body);const p=await prepareAnchor(db,'taebaek','2025','anchor-calendar-'+(date?'invalid':'empty'),'uid');
   await ref.update({tradeDate:date});const before=await ref.get();
   await expect(prepareAnchor(db,'taebaek','2025','anchor-calendar-dry','uid')).rejects.toThrow('거래 날짜');
   await expect(applyAnchor(db,p,p.planHash)).rejects.toThrow('변경');
   expect((await db.collection('partnerBalanceSnapshots').doc(p.anchorId).get()).exists).toBe(false);
   const after=await ref.get();expect(after.data()).toEqual(before.data());expect(after.updateTime!.isEqual(before.updateTime!)).toBe(true);
  } finally {await ref.delete();}
 });
 it('fresh membership change after dry gives no anchor write',async()=>{const p=await prepareAnchor(db,'punghoe','2025','anchor-sdk-cas','uid');await db.collection('partners').doc('new').set({companyId:'punghoe',name:'합성새'});await expect(applyAnchor(db,p,p.planHash)).rejects.toThrow('변경');expect((await db.collection('partnerBalanceSnapshots').doc(p.anchorId).get()).exists).toBe(false);expect(SOURCE_COLLECTIONS).toHaveLength(8);});
});
it('CLI completed undo receipt rejects same-run apply before credentials or database access',()=>{
 const dir=mkdtempSync(join(tmpdir(),'anchor-undo-'));
 try{const backup=join(dir,'backup.json');writeFileSync(backup+'.undone.json',JSON.stringify({runId:'anchor-unit'}));
 const result=spawnSync(process.execPath,[resolve('node_modules/tsx/dist/cli.mjs'),resolve('scripts/stamp-partner-anchor.mts'),'--apply','--company=taebaek','--year=2025','--run-id=anchor-unit','--actor=uid',`--backup=${backup}`],{encoding:'utf8',env:{...process.env,FIRESTORE_EMULATOR_HOST:'127.0.0.1:8082'}});
 expect(result.status).not.toBe(0);expect(result.stderr).toContain('복구가 완료된 실행');expect(result.stderr).not.toContain('운영 CLI는 에뮬레이터');
 }finally{rmSync(dir,{recursive:true,force:true});}
},20000);
