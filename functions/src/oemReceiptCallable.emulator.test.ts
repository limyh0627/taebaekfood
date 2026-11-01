import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import {appendFileSync,writeFileSync} from 'node:fs';
import type {Firestore} from 'firebase-admin/firestore';
import * as admin from 'firebase-admin';
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';

const prefix = `oem-callable-${randomUUID()}`;
const projectId = 'demo-failure-repair-20261101';
const poId = `${prefix}-po`;
const itemId = `${prefix}-item`;
const partnerId = `${prefix}-partner`;
const material = `${prefix}-material`;
const date = '2026-10-03';
const operationId = `oem-receive:${poId}`;
const counterPath = `appMeta/oemLotSequence_taebaek_20261003_${encodeURIComponent(material)}`;
const paths = [
  'appMeta/releaseCutover', counterPath, `purchaseOrders/${poId}`, `items/${itemId}`,
  `partners/${partnerId}`, `item_formula/${prefix}-formula`,
  `adjustmentRequests/OEMFEE-${poId}`, `oemReceiptOperations/${operationId}`,
];
const intent = () => ({ poId, operationId, date, releaseId: prefix,
  returns: [{ itemId, qty: 5 }], unitPricePerKg: 500 });
let adminApp: admin.app.App;
let db: admin.firestore.Firestore,rawDb:admin.firestore.Firestore;
const owned=new Set<string>(),planned=new Set<string>(),stem='work/failure-sdk-'+prefix,sentinelPath='items/'+prefix+'-sentinel';let sentinel:any;
function markIntent(path:string){appendFileSync(stem+'-paths.jsonl',JSON.stringify({intent:path})+'\n');}
function track(db0:Firestore):Firestore{return new Proxy(db0,{get(target,key){if(key==='runTransaction')return async(fn:any,...options:any[])=>{let writes:string[]=[];const result=await (target.runTransaction as any)(async(tx:any)=>{writes=[];const reads=new Map<string,any>();const wrapped=new Proxy(tx,{get(inner,k){if(k==='get')return async(ref:any)=>{const snap=await inner.get(ref);if(ref.path)reads.set(ref.path,snap);return snap;};if(['create','set','update','delete'].includes(String(k)))return(ref:any,...args:any[])=>{const path=ref.path,snap=reads.get(path);if(!owned.has(path)&&!planned.has(path)&&!path.includes(prefix))throw Error('unexpected write '+path);if(!owned.has(path)&&k!=='create'&&(!snap||snap.exists))throw Error('write path not proven absent '+path);markIntent(path);writes.push(path);return inner[k](ref,...args);};const v=inner[k];return typeof v==='function'?v.bind(inner):v;}});return fn(wrapped);},...options);for(const path of writes)owned.add(path);return result;};if(key==='doc')return (path:string)=>{const ref=target.doc(path);return new Proxy(ref,{get(r,k){if(['create','set','update','delete'].includes(String(k)))return async(...args:any[])=>{if(!owned.has(path)&&!planned.has(path)&&!path.includes(prefix))throw Error('unexpected direct write '+path);if(k==='create'&&!owned.has(path)&&(await r.get()).exists)throw Error('preexisting direct '+path);if(k!=='create'&&!owned.has(path))throw Error('direct write not owned '+path);markIntent(path);const result=await (r as any)[k](...args);owned.add(path);return result;};const v=(r as any)[k];return typeof v==='function'?v.bind(r):v;}});};const v=(target as any)[key];return typeof v==='function'?v.bind(target):v;}}) as Firestore;}


const apps: FirebaseApp[] = [];
const userIds: string[] = [];
const clients: Record<string, ReturnType<typeof httpsCallable>> = {};

describe.skipIf(process.env.FAILURE_REPAIR_SDK !== 'true')('OEM callable through Auth, Functions and Firestore Emulators', () => {
  beforeAll(async () => {
    if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8082'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9198'||process.env.GCLOUD_PROJECT!==projectId||process.env.GOOGLE_APPLICATION_CREDENTIALS||process.env.FIREBASE_CONFIG)throw Error('isolated emulator required');
    writeFileSync(stem+'-paths.jsonl','',{flag:'wx'});
    adminApp = admin.initializeApp({ projectId }, prefix);
    rawDb=adminApp.firestore();db=track(rawDb);for(const path of paths)planned.add(path);const sent=rawDb.doc(sentinelPath);if((await sent.get()).exists)throw Error('sentinel exists');await sent.create({marker:prefix});sentinel=await sent.get();
    for (const path of paths) expect((await db.doc(path).get()).exists).toBe(false);
    await Promise.all([
      db.doc('appMeta/releaseCutover').create({ status: 'active', releaseId: prefix, oemLotCutoverDate: date, testRunId: prefix }),
      db.doc(counterPath).create({ companyId: 'taebaek', material, date, lastSequence: 0, testRunId: prefix }),
      db.doc(`purchaseOrders/${poId}`).create({ id: poId, companyId: 'taebaek', poType: 'oem',
        status: 'invoiced', oemPartnerId: partnerId, partnerName: 'demo OEM', oemSent: [{ material, kg: 6 }], testRunId: prefix }),
      db.doc(`items/${itemId}`).create({ id: itemId, companyId: 'taebaek', name: `${prefix} product`,
        품목: `${prefix} product`, procureType: '임가공', unit: '개', packageKg: 1, stock: 2, lots: [], testRunId: prefix }),
      db.doc(`partners/${partnerId}`).create({ companyId: 'taebaek', name: 'demo OEM', testRunId: prefix }),
      db.doc(`item_formula/${prefix}-formula`).create({ parent_key: `${prefix} product`, child_name: material,
        ratio: 1, yield_rate: 1, testRunId: prefix }),
    ]);
    const client = async (name: string, claims?: { companyId: string; isAdmin: boolean }) => {
      const app = initializeApp({ projectId, apiKey: 'demo-only' }, `${prefix}-${name}`);
      apps.push(app);
      const auth = getAuth(app);
      connectAuthEmulator(auth, 'http://127.0.0.1:9198', { disableWarnings: true });
      const fn = getFunctions(app, 'asia-northeast3');
      connectFunctionsEmulator(fn, '127.0.0.1', 5001);
      if (claims) {
        const email = `${prefix}-${name}@local.test`;
        const password = 'demo-OEM-only-password';
        const user = await admin.auth(adminApp).createUser({ email, password });
        userIds.push(user.uid);
        await admin.auth(adminApp).setCustomUserClaims(user.uid, { employeeId: `${prefix}-${name}`, ...claims });
        await signInWithEmailAndPassword(auth, email, password);
      }
      clients[name] = httpsCallable(fn, 'receiveOemFinishedGoodsCommand');
    };
    await client('anonymous');
    await client('staff', { companyId: 'taebaek', isAdmin: false });
    await client('foreign', { companyId: 'punghoe', isAdmin: true });
    await client('admin', { companyId: 'taebaek', isAdmin: true });
  }, 30000);

  afterAll(async()=>{if(db){for(const path of owned){await rawDb.doc(path).delete();expect((await rawDb.doc(path).get()).exists,path).toBe(false);}if(sentinel){const snap=await rawDb.doc(sentinelPath).get();expect(snap.data()).toEqual(sentinel.data());expect(snap.updateTime).toEqual(sentinel.updateTime);await rawDb.doc(sentinelPath).delete();expect((await rawDb.doc(sentinelPath).get()).exists).toBe(false);}writeFileSync(stem+'-cleanup.json',JSON.stringify({projectId,owned:[...owned],planned:[...planned],authUids:userIds,sentinelPreserved:!!sentinel,allAbsent:true},null,2),{flag:'wx'});}for(const uid of userIds){await admin.auth(adminApp).deleteUser(uid);await expect(admin.auth(adminApp).getUser(uid)).rejects.toMatchObject({code:'auth/user-not-found'});}await Promise.all(apps.map(app=>deleteApp(app)));if(adminApp)await adminApp.delete();},30000);

  it('rejects anonymous, employee, foreign admin and bulk without mutating inventory', async () => {
    for (const name of ['anonymous', 'staff', 'foreign']) await expect(clients[name]!(intent())).rejects.toThrow();
    await expect(clients.admin!({ ...intent(), bulk: [{ material, kg: 1 }] })).rejects.toThrow();
    expect((await db.doc(`items/${itemId}`).get()).data()?.stock).toBe(2);
    expect((await db.doc(`purchaseOrders/${poId}`).get()).data()?.status).toBe('invoiced');
  }, 30000);

  it('commits once, retries the fixed ID, rejects altered input and paused duplicate', async () => {
    const operationPath='oemReceiptOperations/'+operationId,feePath='adjustmentRequests/OEMFEE-'+poId;markIntent(operationPath);markIntent(feePath);
    let response:any;try{response=await clients.admin!(intent());}finally{const [op,fee]=await Promise.all([rawDb.doc(operationPath).get(),rawDb.doc(feePath).get()]);if(op.exists){expect(op.data()).toMatchObject({companyId:'taebaek',poId,releaseId:prefix});owned.add(operationPath);}if(fee.exists){expect(fee.data()).toMatchObject({companyId:'taebaek',oemPoId:poId});owned.add(feePath);}}
    const applied=response.data as Record<string, any>;
    expect(applied).toMatchObject({ status: 'applied', receivedKg: 5, loss: 1 });
    expect(((await clients.admin!(intent())).data as Record<string, any>).status).toBe('duplicate');
    await expect(clients.admin!({ ...intent(), unitPricePerKg: 600 })).rejects.toThrow();
    expect((await db.doc(counterPath).get()).data()?.lastSequence).toBe(1);
    expect((await db.doc(`items/${itemId}`).get()).data()?.stock).toBe(7);
    await db.doc('appMeta/releaseCutover').update({ status: 'paused' });
    await expect(clients.admin!(intent())).rejects.toThrow();
  }, 30000);
});
