import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore, type DocumentSnapshot } from 'firebase-admin/firestore';
import { inventoryDocId, operationDocId, commandHash, type RawInventoryCommand } from './rawInventoryCore';
import { prepareRawCommand } from './rawInventoryPrepare';
import { buildPreparedRawWritePlan } from './rawPreparedWritePlan';
import { buildOrderRawCommands, selectOrderRawUsageNames } from './orderRawCommandPlan';

const enabled = process.env.RAW_TIME_COMPARISON_EMULATOR === 'true';
const projectId = 'demo-raw-time-comparison-20261029';
const prefix = `raw-time-${randomUUID()}-`, owned = new Set<string>(), observations: unknown[] = [];
let app: App, db: Firestore;
function guard() {
  if (!enabled || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8288' || process.env.RAW_TIME_COMPARISON_PROJECT !== projectId || process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_CONFIG) throw Error('명시된 데모 에뮬레이터만 허용');
  for (const key of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT']) if (process.env[key] && process.env[key] !== projectId) throw Error('외부 프로젝트 금지');
}
const snap = (row: DocumentSnapshot) => ({exists: () => row.exists, data: () => row.data()});
async function run(command: RawInventoryCommand) {
  guard();
  const statePath = `rawInventories/${inventoryDocId(command.companyId, command.rawItemId)}`;
  const itemPath = `items/${command.rawItemId}`, movementPath = `rawMaterialLedger/${operationDocId(command.operationId)}`;
  [statePath, itemPath, movementPath].forEach(p => owned.add(p));
  return db.runTransaction(async tx => {
    const stateRef = db.doc(statePath), itemRef = db.doc(itemPath), movementRef = db.doc(movementPath);
    const [state, item, movement] = await Promise.all([tx.get(stateRef), tx.get(itemRef), tx.get(movementRef)]);
    const read = {stateSnap:snap(state), itemSnap:snap(item), movementSnap:snap(movement), originalSnap:null, oldOriginalSnap:null};
    const result = prepareRawCommand(command, read, {now:'2026-10-29T11:00:00.000Z'});
    if (result.status !== 'applied') throw Error(JSON.stringify(result));
    const plan = buildPreparedRawWritePlan(command, read, result);
    tx.set(stateRef, plan.state()); tx.set(movementRef, plan.movement());
    const patch = plan.itemPatch(); if (patch) tx.update(itemRef, patch);
    return result;
  });
}
async function cleanup() {
  for (const path of owned) { guard(); await db.doc(path).delete(); expect((await db.doc(path).get()).exists).toBe(false); }
}
describe.skipIf(!enabled)('원료 시각 비교 실제 Admin SDK', () => {
  beforeAll(() => {guard(); app = initializeApp({projectId}, prefix); db = getFirestore(app);});
  afterAll(async () => {
    let cleaned = false;
    try { if (db) { await cleanup(); cleaned = true; } }
    finally {
      if (app) await deleteApp(app);
      writeFileSync(`work/performance-orders-raw-time-sdk-${randomUUID()}.json`, JSON.stringify({projectId,prefix,sourceSha256:createHash('sha256').update(readFileSync('functions/src/shared/rawInventoryCore.ts')).digest('hex'),ownedPaths:[...owned],cleanupConfirmed:cleaned,observations,wholeClear:0,operatingAccess:0},null,2), {flag:'wx'});
    }
  });
  it('실제 주문 builder와 UTC 표현이 같은 과거 순간을 동일하게 원장에 남긴다', async () => {
    for (const mode of ['builder','utc'] as const) {
      const id = prefix + mode, material = '합성시각원료', itemPath = `items/${id}`; owned.add(itemPath);
      const holder = {id,name:material,rawMaterialName:material,companyId:'taebaek' as const,subtype:'벌크'};
      await db.doc(itemPath).create({...holder,stock:0,lots:[]});
      const base = {companyId:'taebaek' as const,rawItemId:id,materialSnapshot:material,source:{type:'manual' as const,id:prefix}};
      await run({...base,kind:'opening',operationId:prefix+mode+'-opening',effectiveAt:'2026-10-29T00:00:00.000Z',kg:10});
      await run({...base,kind:'stocktake',operationId:prefix+mode+'-anchor',effectiveAt:'2026-10-29T10:00:00.000Z',targetKg:10});
      const usage = {[material]:1};
      const built = buildOrderRawCommands({orderId:prefix+mode,physicalUsage:usage,attempt:1,allItems:[holder],companyId:'taebaek',businessDate:'2026-10-29',customerName:'합성',names:selectOrderRawUsageNames(usage)}).commands[0].command;
      const command = mode === 'utc' ? {...built,effectiveAt:'2026-10-29T03:00:00.000Z'} : built;
      const result = await run(command);
      const movement = (await db.doc(`rawMaterialLedger/${operationDocId(command.operationId)}`).get()).data()!;
      const state = (await db.doc(`rawInventories/${inventoryDocId('taebaek',id)}`).get()).data()!;
      const item = (await db.doc(itemPath).get()).data()!;
      expect(state.stockKg).toBe(10); expect(item.stock).toBe(10);
      expect(result.movement).toMatchObject({reportedDeltaKg:-1,appliedDeltaKg:0,backdatedBeforeStocktake:true,effectiveAt:command.effectiveAt,commandHash:commandHash(command)});
      expect(movement).toMatchObject({reportedDeltaKg:-1,appliedDeltaKg:0,effectiveAt:command.effectiveAt,commandHash:commandHash(command)});
      expect(item.lots).toEqual([...state.activeLots,...state.recentDepletedLots]);
      observations.push({mode,effectiveAt:command.effectiveAt,commandHash:commandHash(command),reportedDeltaKg:result.movement.reportedDeltaKg,appliedDeltaKg:result.movement.appliedDeltaKg,stockKg:state.stockKg});
    }
  });
});
