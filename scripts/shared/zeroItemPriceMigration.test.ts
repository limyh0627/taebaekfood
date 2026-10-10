import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { expect, it, vi } from 'vitest';
import { prepareZeroItemPrice, commitZeroItemPrice, checkPlan, checkMigrationState, type Document } from './zeroItemPriceMigration';
const row = (id: string, data: Record<string, unknown>, nanos = 7): Document => ({ id, data, version: {seconds: 100, nanoseconds: nanos} });
it('현재 회사의 own numeric0만 제거하고 원가 미확인/다른 원문은 그대로 보존한다', () => {
  const inherited = Object.create({price:0}); inherited.companyId='taebaek';
  const input = [row('missingCost',{price:0,stock:4}), row('known0',{price:0,cost:0}), row('foreign',{price:0,companyId:'punghoe'}), row('positive',{price:2}), row('negative',{price:-2}), row('negativeZero',{price:-0}), row('nan',{price:NaN}), row('undefined',{price:undefined}), row('string',{price:'0'}), row('missing',{}),row('inherited',inherited)];
  const plan=prepareZeroItemPrice('taebaek',input);
  expect(plan.documents.map(doc=>doc.id)).toEqual(['known0','missingCost']);
  expect(plan.documents[0].after).toEqual({cost:0});
  expect(plan.documents[1].after).toEqual({stock:4});
  expect(input[0].data).toEqual({price:0,stock:4});
  expect(prepareZeroItemPrice('punghoe',input).documents.map(doc=>doc.id)).toEqual(['foreign']);
});
it('모든 apply 원문과 나노초 버전을 검사하고 미확인 cost를 생성하지 않는다', () => {
 const before=[row('a',{price:0,name:'a',lots:[{kgRemaining:2}]}),row('b',{price:0,cost:5})];
 const plan=prepareZeroItemPrice('taebaek',before);
 expect(()=>checkMigrationState(plan,before,'apply')).not.toThrow();
 expect(()=>checkMigrationState(plan,[before[0],row('b',before[1].data,8)],'apply')).toThrow();
 expect(()=>checkMigrationState(plan,[row('a',{...before[0].data,cost:0}),before[1]],'apply')).toThrow();
 expect(()=>checkPlan({...plan,documents:plan.documents.map(doc=>({...doc,after:{}}))})).toThrow();
});
it('duplicate/undo는 정확한 적용 후 원문과 receipt 버전만 허용한다', () => {
 const plan=prepareZeroItemPrice('taebaek',[row('a',{price:0,cost:12})]);
 const after=[row('a',{cost:12},9)];
 const receipt={version:1 as const,planHash:'proof',documents:after.map(doc=>({id:doc.id,version:doc.version}))};
 expect(()=>checkMigrationState(plan,after,'duplicate',receipt,'proof')).not.toThrow();
 expect(()=>checkMigrationState(plan,after,'undo',receipt,'proof')).not.toThrow();
 expect(()=>checkMigrationState(plan,after,'undo',receipt,'other')).toThrow();
 expect(()=>checkMigrationState(plan,[row('a',{cost:12},10)],'undo',receipt,'proof')).toThrow();
 expect(()=>checkMigrationState(plan,[row('a',{cost:13},9)],'duplicate',receipt,'proof')).toThrow();
 expect(()=>checkMigrationState(plan,after,'duplicate')).toThrow();
 const restored=[row('a',{price:0,cost:12},11)];
 const undoReceipt={...receipt,documents:restored.map(doc=>({id:doc.id,version:doc.version}))};
 expect(()=>checkMigrationState(plan,restored,'undone',undoReceipt,'proof')).not.toThrow();
 expect(()=>checkMigrationState(plan,restored,'apply')).toThrow();
});

it('모든 batch쓰기의 원버전 precondition과 commit 실제버전을 보존한다', async () => {
 const before=[row('a',{price:0,cost:7}),row('b',{price:0})];
 const plan=prepareZeroItemPrice('taebaek',before);
 const batch={update:vi.fn(),commit:vi.fn(async()=>[{writeTime:new Timestamp(101,3)},{writeTime:new Timestamp(101,4)}])};
 const db={batch:()=>batch,collection:()=>({doc:(id:string)=>({id})})} as unknown as Firestore;
 const receipt=await commitZeroItemPrice(db,plan,before,'apply','proof');
 expect(batch.update.mock.calls.map(call=>call[2].lastUpdateTime)).toEqual([new Timestamp(100,7),new Timestamp(100,7)]);
 expect(receipt.documents).toEqual([{id:'a',version:{seconds:101,nanoseconds:3}},{id:'b',version:{seconds:101,nanoseconds:4}}]);
 const replaced=[row('a',{cost:7},9),row('b',{},9)];
 expect(()=>checkMigrationState(plan,replaced,'duplicate',receipt,'proof')).toThrow();
 const after=[{...replaced[0],version:receipt.documents[0].version},{...replaced[1],version:receipt.documents[1].version}];
 await commitZeroItemPrice(db,plan,after,'undo','proof',receipt);
 expect(batch.update.mock.calls.slice(2).map(call=>[call[1],call[2].lastUpdateTime])).toEqual([[{price:0},new Timestamp(101,3)],[{price:0},new Timestamp(101,4)]]);
});
it('precondition 실패에는 적용 receipt를 반환하지 않는다', async () => {
 const before=[row('a',{price:0})],plan=prepareZeroItemPrice('taebaek',before);
 const db={batch:()=>({update:vi.fn(),commit:vi.fn(async()=>{throw Error('precondition failed');})}),collection:()=>({doc:(id:string)=>({id})})} as unknown as Firestore;
 await expect(commitZeroItemPrice(db,plan,before,'apply','proof')).rejects.toThrow('precondition failed');
});

// root 전용: ZERO_ITEM_PRICE_EMULATOR_TEST=1 + FIRESTORE_EMULATOR_HOST 명시 후 실행한다.
it.runIf(process.env.ZERO_ITEM_PRICE_EMULATOR_TEST === '1')('actual Admin batch apply/undo/replay는 원문과 commit 버전을 보존한다', async () => {
 const {initializeApp,deleteApp}=await import('firebase-admin/app');
 const {getFirestore}=await import('firebase-admin/firestore');
 const {randomUUID}=await import('node:crypto');
 expect(process.env.FIRESTORE_EMULATOR_HOST).toMatch(/^(127\.0\.0\.1|localhost):\d+$/);
 const suffix=randomUUID(),app=initializeApp({projectId:'demo-zero-item-price'},suffix),db=getFirestore(app);
 const refs=['a','b'].map(id=>db.collection('items').doc(`zero-price-${suffix}-${id}`));
 const current=async()=> (await db.getAll(...refs)).map(snap=>({id:snap.id,data:snap.data()!,version:{seconds:snap.updateTime!.seconds,nanoseconds:snap.updateTime!.nanoseconds}}));
 try {
  await refs[0].set({companyId:'taebaek',price:0,cost:9,stock:3});
  await refs[1].set({companyId:'taebaek',price:0,stock:4});
  const before=await current(),plan=prepareZeroItemPrice('taebaek',before);
  const receipt=await commitZeroItemPrice(db,plan,before,'apply','proof');
  const after=await current();checkMigrationState(plan,after,'duplicate',receipt,'proof');
  expect(after[0].data).toEqual({companyId:'taebaek',cost:9,stock:3});
  expect(after[1].data).toEqual({companyId:'taebaek',stock:4});
  const undone=await commitZeroItemPrice(db,plan,after,'undo','proof',receipt);
  const restored=await current();checkMigrationState(plan,restored,'undone',undone,'proof');
  expect(restored.map(doc=>doc.data)).toEqual(before.map(doc=>doc.data));
  // 같은 원문을 다시 저장해도 새 버전을 이번 적용 증명으로 채택하지 않는다.
  const newPlan=prepareZeroItemPrice('taebaek',restored);
  const second=await commitZeroItemPrice(db,newPlan,restored,'apply','new-proof');
  const originalAfter = (await refs[0].get()).data()!;
  await refs[0].set({ ...originalAfter, temporaryField: 'changed' });
  await refs[0].set(originalAfter);
  const replaced=await current();
  expect(()=>checkMigrationState(newPlan,replaced,'undo',second,'new-proof')).toThrow();
 } finally {await Promise.all(refs.map(ref=>ref.delete()));await deleteApp(app);}
},30000);
it.runIf(process.env.ZERO_ITEM_PRICE_EMULATOR_TEST === '1')('actual batch precondition 경합은 모든 품목을 원자 보존한다', async () => {
 const {initializeApp,deleteApp}=await import('firebase-admin/app');
 const {getFirestore}=await import('firebase-admin/firestore');
 const {randomUUID}=await import('node:crypto');
 expect(process.env.FIRESTORE_EMULATOR_HOST).toMatch(/^(127\.0\.0\.1|localhost):\d+$/);
 const suffix=randomUUID(),app=initializeApp({projectId:'demo-zero-item-price'},suffix),db=getFirestore(app);
 const refs=['a','b'].map(id=>db.collection('items').doc(`zero-race-${suffix}-${id}`));
 try {
  await Promise.all(refs.map(ref=>ref.set({companyId:'taebaek',price:0,cost:12})));
  const before=(await db.getAll(...refs)).map(snap=>({id:snap.id,data:snap.data()!,version:{seconds:snap.updateTime!.seconds,nanoseconds:snap.updateTime!.nanoseconds}}));
  const plan=prepareZeroItemPrice('taebaek',before);
  await refs[1].update({cost:13});
  await expect(commitZeroItemPrice(db,plan,before,'apply','proof')).rejects.toThrow();
  expect((await refs[0].get()).data()).toEqual({companyId:'taebaek',price:0,cost:12});
  expect((await refs[1].get()).data()).toEqual({companyId:'taebaek',price:0,cost:13});
 } finally {await Promise.all(refs.map(ref=>ref.delete()));await deleteApp(app);}
},30000);
