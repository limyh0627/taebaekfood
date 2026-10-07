import { adminDb } from './_admin.mts';
import { Timestamp } from 'firebase-admin/firestore';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = adminDb();
const sourceId = 'inv-snap-punghoe-2026-10', targetId = 'inv-snap-punghoe-2026-09';
const backup = 'work/punghoe-snapshot-month-backup-20261007.json';
const mode = process.argv.includes('--undo') ? 'undo' : process.argv.includes('--apply') ? 'apply' : 'dry';
const encode = (v:any):any => v instanceof Timestamp ? {__timestamp:{seconds:v.seconds,nanoseconds:v.nanoseconds}} : Array.isArray(v) ? v.map(encode) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)])) : v;
const decode = (v:any):any => v?.__timestamp ? new Timestamp(v.__timestamp.seconds,v.__timestamp.nanoseconds) : Array.isArray(v) ? v.map(decode) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k,x])=>[k,decode(x)])) : v;
const version = (d:any) => ({seconds:d.updateTime.seconds,nanoseconds:d.updateTime.nanoseconds});
const ref = (id:string) => db.collection('inventorySnapshots').doc(id);
const equal = (actual:any, expected:any) => assert.deepStrictEqual(encode(actual),expected);

if (mode === 'dry') {
  assert(!existsSync(backup),'기존 원본 백업 덮어쓰기 금지');
  const [source,target] = await Promise.all([ref(sourceId).get(),ref(targetId).get()]);
  assert(source.exists && target.exists,'이동 원본/기존9월 문서 확인 필요');
  const s = source.data()!, t = target.data()!;
  assert.equal(s.companyId,'punghoe'); assert.equal(t.companyId,'punghoe');
  assert.equal(s.yearMonth,'2026-10'); assert.equal(t.yearMonth,'2026-09');
  assert.equal(s.recordedAt,'2026-10-01T05:46:08.576Z');
  assert.equal(s.value,23568000); assert(Array.isArray(s.items) && s.items.length === 5);
  // 실제 촬영시각·품목·평가액은 보존하고 귀속 월만 이동한다.
  const after = {...s,yearMonth:'2026-09'};
  writeFileSync(backup,JSON.stringify({authorization:'사용자: 깨분 재고 뺄 필요없이 10월1일 재고를9월30일로 옮겨',sourceId,targetId,source:encode(s),target:encode(t),sourceVersion:version(source),targetVersion:version(target),after:encode(after)},null,2),{flag:'wx'});
  console.log(JSON.stringify({mode,writes:0,sourceId,targetId,value:s.value,items:s.items.length,sourceCapturePreserved:true,oldSeptemberValue:t.value,backup}));
} else {
  const plan = JSON.parse(readFileSync(backup,'utf8'));
  assert.equal(plan.sourceId,sourceId); assert.equal(plan.targetId,targetId);
  assert.equal(plan.source.companyId,'punghoe'); assert.equal(plan.target.companyId,'punghoe');
  equal(plan.after,{...plan.source,yearMonth:'2026-09'});
  await db.runTransaction(async tx => {
    const [source,target] = await tx.getAll(ref(sourceId),ref(targetId));
    if (mode === 'apply') {
      assert(source.exists && target.exists,'원본 문서 상태 변경');
      equal(version(source),plan.sourceVersion); equal(version(target),plan.targetVersion);
      equal(source.data(),plan.source); equal(target.data(),plan.target);
      tx.set(ref(targetId),decode(plan.after)); tx.delete(ref(sourceId));
    } else {
      assert(!source.exists && target.exists,'이동 이후 원본/대상 상태 변경');
      equal(target.data(),plan.after);
      tx.set(ref(sourceId),decode(plan.source)); tx.set(ref(targetId),decode(plan.target));
    }
  });
  const [source,target] = await Promise.all([ref(sourceId).get(),ref(targetId).get()]);
  if (mode === 'apply') { assert(!source.exists); equal(target.data(),plan.after); }
  else { equal(source.data(),plan.source); equal(target.data(),plan.target); }
  const result = {mode,changedDocuments:2,verified:true,companyId:'punghoe',yearMonth:mode==='apply'?'2026-09':'2026-10',value:plan.source.value,items:plan.source.items.length,stockWrites:0,lotWrites:0,checkedAt:new Date().toISOString()};
  writeFileSync(`work/punghoe-snapshot-month-${mode}-verification-20261007.json`,JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
}
