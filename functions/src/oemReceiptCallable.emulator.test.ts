import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import * as admin from 'firebase-admin';
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';

const prefix = `oem-callable-${randomUUID()}`;
const projectId = 'demo-taebaekfood-local';
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
let db: admin.firestore.Firestore;
const apps: FirebaseApp[] = [];
const userIds: string[] = [];
const clients: Record<string, ReturnType<typeof httpsCallable>> = {};

describe('OEM callable through Auth, Functions and Firestore Emulators', () => {
  beforeAll(async () => {
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8182';
    process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9198';
    process.env.GCLOUD_PROJECT = projectId;
    adminApp = admin.initializeApp({ projectId }, prefix);
    db = adminApp.firestore();
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

  afterAll(async () => {
    if (db) {
      for (const path of [...paths].reverse()) {
        const snap = await db.doc(path).get();
        if (!snap.exists) continue;
        if (path === 'appMeta/releaseCutover' && snap.data()?.testRunId !== prefix) throw new Error('gate ownership changed');
        if (path.includes(prefix) || snap.data()?.testRunId === prefix) await db.doc(path).delete();
      }
    }
    for (const uid of userIds) await admin.auth(adminApp).deleteUser(uid);
    await Promise.all(apps.map(app => deleteApp(app)));
    if (adminApp) await adminApp.delete();
  }, 30000);

  it('rejects anonymous, employee, foreign admin and bulk without mutating inventory', async () => {
    for (const name of ['anonymous', 'staff', 'foreign']) await expect(clients[name]!(intent())).rejects.toThrow();
    await expect(clients.admin!({ ...intent(), bulk: [{ material, kg: 1 }] })).rejects.toThrow();
    expect((await db.doc(`items/${itemId}`).get()).data()?.stock).toBe(2);
    expect((await db.doc(`purchaseOrders/${poId}`).get()).data()?.status).toBe('invoiced');
  }, 30000);

  it('commits once, retries the fixed ID, rejects altered input and paused duplicate', async () => {
    const applied = (await clients.admin!(intent())).data as Record<string, any>;
    expect(applied).toMatchObject({ status: 'applied', receivedKg: 5, loss: 1 });
    expect(((await clients.admin!(intent())).data as Record<string, any>).status).toBe('duplicate');
    await expect(clients.admin!({ ...intent(), unitPricePerKg: 600 })).rejects.toThrow();
    expect((await db.doc(counterPath).get()).data()?.lastSequence).toBe(1);
    expect((await db.doc(`items/${itemId}`).get()).data()?.stock).toBe(7);
    await db.doc('appMeta/releaseCutover').update({ status: 'paused' });
    await expect(clients.admin!(intent())).rejects.toThrow();
  }, 30000);
});
