import { afterAll, beforeAll, describe, expect, it as vitestIt } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, getDocs, collection, type Firestore } from 'firebase/firestore';
import { issueOemBatchJob, firestoreOemIssuePorts, oemIssueFingerprint } from './oemIssueJob';
import { applyOemReceiptInventory } from './oemReceiptInventory';
import { executeRawInventoryCommand } from '../../shared/services/rawInventoryService';
import { inventoryDocId, operationDocId, legacyOperationDocId, commandHash, type RawInventoryCommand } from '../../shared/rawInventoryCore';

const inFlight = new Set<Promise<unknown>>();
function it(name:string,run:()=>Promise<void>,timeout=20_000) {
  vitestIt(name,()=>{
    const pending=run();inFlight.add(pending);
    void pending.then(()=>inFlight.delete(pending),()=>inFlight.delete(pending));
    return pending;
  },timeout);
}
const runId = randomUUID();
const fixtureIds = ["oem-raw-a","oem-raw-b","oem-emulator-1","oem-cross-raw","oem-cross-product","oem-cross-receipt","oem-cross-issue"];
const sid = (text: string) => fixtureIds.reduce((value,id)=>value.replaceAll(id,runId+'-'+id),text);
const emulatorReady = async () => {
  try { return (await fetch('http://127.0.0.1:8082/', { signal: AbortSignal.timeout(1500) })).status < 500; }
  catch { return false; }
};
const ready = await emulatorReady();
let env: RulesTestEnvironment;

describe.skipIf(!ready)('OEM 작업 실제 Firestore 에뮬레이터', () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({ projectId: 'demo-r23-'+runId.replaceAll('-','').slice(0,20), firestore: {
      rules: readFileSync('firestore.rules', 'utf-8'), host: '127.0.0.1', port: 8082,
    } });

  }, 20_000);
  afterAll(async () => {
    if (!env) return;
    await Promise.allSettled([...inFlight]);
    try {
      await env.withSecurityRulesDisabled(async ctx => {
        const database = ctx.firestore();
        // 이 UUID가 본문 또는 ID에 기록된 시험 문서만 지운다. 공유 초기화는 하지 않는다.
        for (const name of ['items','purchaseOrders','rawInventoryJobs','rawInventories','rawMaterialLedger','rawInventoryReversalGuards','adjustmentRequests']) {
          const snapshots = await getDocs(collection(database,name));
          for (const snapshot of snapshots.docs) {
            if (!snapshot.id.includes(runId) && !JSON.stringify(snapshot.data()).includes(runId)) continue;
            await deleteDoc(snapshot.ref);
            expect((await getDoc(snapshot.ref)).exists()).toBe(false);
          }
        }
      });
    } finally { await env.cleanup(); }
  },20_000);

  it('두 번째 원료 실패 후 같은 작업을 재개해 첫 원료를 한 번만 차감하고 카드를 확정한다', async () => {
    const db = env.authenticatedContext('u-admin', { employeeId: 'admin', companyId: 'taebaek', isAdmin: true }).firestore() as unknown as Firestore;
    await env.withSecurityRulesDisabled(async ctx => {
      const seedDb = ctx.firestore();
      await setDoc(doc(seedDb, 'items', sid('oem-raw-a')), { id: sid('oem-raw-a'), companyId: 'taebaek', name: 'OEM 원료 A', rawMaterialName: 'OEM 원료 A', subtype: '벌크', unit: 'kg', stock: 0, lots: [] });
      // 원료 B만 품목 사본과 원장이 어긋난 상태로 시작시켜 두 번째 단계에서 멈추게 한다.
      await setDoc(doc(seedDb, 'items', sid('oem-raw-b')), { id: sid('oem-raw-b'), companyId: 'taebaek', name: 'OEM 원료 B', rawMaterialName: 'OEM 원료 B', subtype: '벌크', unit: 'kg', stock: 1, lots: [] });
    });
    const receive = async (rawItemId: string, material: string) => executeRawInventoryCommand({
      operationId: `seed-${rawItemId}`, companyId: 'taebaek', rawItemId, materialSnapshot: material,
      effectiveAt: '2026-09-24T09:00:00+09:00', source: { type: 'manual', id: `seed-${rawItemId}` },
      kind: 'receive', kg: 100, lot: { supplierName: '시험' },
    }, { db });
    expect((await receive(sid('oem-raw-a'), 'OEM 원료 A')).status).toBe('applied');
    const input = {
      jobId: sid('oem-emulator-1'), companyId: 'taebaek' as const, partnerId: 'factory-a', partnerName: '시험 공장',
      sent: [{ rawItemId: sid('oem-raw-a'), material: 'OEM 원료 A', kg: 20 }, { rawItemId: sid('oem-raw-b'), material: 'OEM 원료 B', kg: 10 }],
      date: '2026-09-24',
    };
    await expect(issueOemBatchJob(db, input)).rejects.toThrow('부분 완료');
    expect((await getDoc(doc(db, 'purchaseOrders', input.jobId))).data()).toMatchObject({ status: 'pending', oemIssueStatus: 'failed' });
    expect((await getDoc(doc(db, 'items', sid('oem-raw-a')))).data()?.stock).toBe(80);
    expect((await getDoc(doc(db, 'rawMaterialLedger', operationDocId(sid('oem-issue:oem-emulator-1:oem-raw-a'))))).exists()).toBe(true);
    expect((await getDoc(doc(db, 'rawInventories', inventoryDocId('taebaek', sid('oem-raw-a'))))).exists()).toBe(true);

    await env.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'items', sid('oem-raw-b')), { id: sid('oem-raw-b'), companyId: 'taebaek', name: 'OEM 원료 B', rawMaterialName: 'OEM 원료 B', subtype: '벌크', unit: 'kg', stock: 0, lots: [] });
    });
    expect((await receive(sid('oem-raw-b'), 'OEM 원료 B')).status).toBe('applied');
    expect(await issueOemBatchJob(db, input)).toEqual({ poId: input.jobId });
    expect((await getDoc(doc(db, 'purchaseOrders', input.jobId))).data()).toMatchObject({ status: 'invoiced', oemIssueStatus: 'complete' });
    expect((await getDoc(doc(db, 'items', sid('oem-raw-a')))).data()?.stock).toBe(80);
    expect((await getDoc(doc(db, 'items', sid('oem-raw-b')))).data()?.stock).toBe(90);
    expect(await issueOemBatchJob(db, input)).toEqual({ poId: input.jobId });
    expect((await getDoc(doc(db, 'items', sid('oem-raw-a')))).data()?.stock).toBe(80);
    await expect(issueOemBatchJob(db, { ...input, sent: [{ ...input.sent[0]!, kg: 1 }] })).rejects.toThrow('최초 원문');
    expect((await getDoc(doc(db,'items',sid('oem-raw-a')))).data()?.stock).toBe(80);
  }, 20_000);

  it('회사 다른 원료 출고와 완제품 입고를 실제 규칙·거래 경계에서 거절한다', async () => {
    const taebaekDb = env.authenticatedContext('u-admin', { employeeId: 'admin', companyId: 'taebaek', isAdmin: true }).firestore() as unknown as Firestore;
    await env.withSecurityRulesDisabled(async ctx => {
      const seedDb = ctx.firestore();
      await setDoc(doc(seedDb, 'items', sid('oem-cross-raw')), { id: sid('oem-cross-raw'), companyId: 'punghoe', name: '같은 이름 참깨', subtype: '벌크', unit: 'kg', stock: 0, lots: [] });
      await setDoc(doc(seedDb, 'items', sid('oem-cross-product')), { id: sid('oem-cross-product'), companyId: 'punghoe', name: '풍회 완제품', stock: 0, lots: [] });
      await setDoc(doc(seedDb, 'purchaseOrders', sid('oem-cross-receipt')), { id: sid('oem-cross-receipt'), companyId: 'taebaek', poType: 'oem', status: 'invoiced' });
    });
    await expect(issueOemBatchJob(taebaekDb, {
      jobId: sid('oem-cross-issue'), companyId: 'taebaek', partnerId: 'factory-a', partnerName: '시험 공장',
      sent: [{ rawItemId: sid('oem-cross-raw'), material: '같은 이름 참깨', kg: 1 }], date: '2026-09-24',
    })).rejects.toThrow('부분 완료');
    await env.withSecurityRulesDisabled(async ctx => {
      expect((await getDoc(doc(ctx.firestore(), 'items', sid('oem-cross-raw')))).data()?.stock).toBe(0);
      expect((await getDoc(doc(ctx.firestore(), 'rawMaterialLedger', operationDocId(sid('oem-issue:oem-cross-issue:oem-cross-raw'))))).exists()).toBe(false);
    });
    await expect(applyOemReceiptInventory(taebaekDb, {
      companyId: 'taebaek', poId: sid('oem-cross-receipt'), operationId: sid('oem-receive:oem-cross-receipt'), date: '2026-09-24',
      items: [{ itemId: sid('oem-cross-product'), qty: 1 }], poPatch: { status: 'received' },
      feeRequest: { id: sid('OEMFEE-oem-cross-receipt'), companyId: 'taebaek', itemId: sid('oem-cross-receipt'), itemName: '가공비', originalQuantity: 1, type: 'oem_fee', reason: '시험', status: 'pending', requestedAt: '2026-09-24T00:00:00Z', oemPoId: sid('oem-cross-receipt') },
    })).rejects.toThrow();
    expect((await getDoc(doc(taebaekDb, 'purchaseOrders', sid('oem-cross-receipt')))).data()?.status).toBe('invoiced');
    await env.withSecurityRulesDisabled(async ctx => {
      expect((await getDoc(doc(ctx.firestore(), 'adjustmentRequests', sid('OEMFEE-oem-cross-receipt')))).exists()).toBe(false);
    });
  }, 20_000);
  it('실제 원장 조회는 없는 진행표·부분·정확전체·모순과 hash없는 이력을 구분하고 자동 차감하지 않는다',async()=>{
    const db=env.authenticatedContext('u-'+runId,{employeeId:'admin',companyId:'taebaek',isAdmin:true}).firestore() as unknown as Firestore;
    const jobId=runId+'-evidence',rawA=runId+'-evidence-a',rawB=runId+'-evidence-b';
    const input={jobId,companyId:'taebaek' as const,partnerId:runId+'-partner',partnerName:'시험',date:'2026-10-19',sent:[{rawItemId:rawA,material:'A',kg:2},{rawItemId:rawB,material:'B',kg:3}]};
    const commands:RawInventoryCommand[]=input.sent.map(row=>({operationId:'oem-issue:'+jobId+':'+row.rawItemId,companyId:'taebaek',rawItemId:row.rawItemId,materialSnapshot:row.material,effectiveAt:'2026-10-19T12:00:00+09:00',source:{type:'oem',id:jobId},kind:'consume',kg:row.kg}));
    const stored=async()=>{
      const result:Record<string,unknown>={};
      await env.withSecurityRulesDisabled(async ctx=>{
        for(const name of ['items','purchaseOrders','rawInventoryJobs','rawInventories','rawMaterialLedger']) {
          const rows=await getDocs(collection(ctx.firestore(),name));
          result[name]=rows.docs.map(row=>({id:row.id,data:row.data()}));
        }
      });
      return result;
    };
    const read=async()=>{
      const before=await stored();
      const result=await firestoreOemIssuePorts(db).inspectEvidence(input);
      expect(await stored()).toEqual(before);
      return result;
    };
    const seed=async(index:number,legacy=false,hash:string|undefined=commandHash(commands[index]))=>env.withSecurityRulesDisabled(async ctx=>{
      const command=commands[index],data={...command,...(hash===undefined?{}:{commandHash:hash})};
      await setDoc(doc(ctx.firestore(),'rawMaterialLedger',(legacy?legacyOperationDocId:operationDocId)(command.operationId)),data);
    });
    expect((await read()).status).toBe('absent');
    await env.withSecurityRulesDisabled(async ctx=>setDoc(doc(ctx.firestore(),'purchaseOrders',jobId),{id:jobId,companyId:'taebaek',poType:'oem',status:'invoiced',oemIssueStatus:'complete',oemIssueFingerprint:oemIssueFingerprint(input)}));
    expect(await read()).toMatchObject({status:'absent',cardStatus:'complete',canResume:false});
    await seed(0);expect(await read()).toMatchObject({status:'partial',canResume:false});
    await env.withSecurityRulesDisabled(async ctx=>setDoc(doc(ctx.firestore(),'purchaseOrders',jobId),{id:jobId,companyId:'taebaek',poType:'oem',status:'pending',oemIssueFingerprint:oemIssueFingerprint(input)}));
    expect(await read()).toMatchObject({status:'partial',canResume:true});
    await env.withSecurityRulesDisabled(async ctx=>setDoc(doc(ctx.firestore(),'rawInventoryJobs','oem-issue:'+jobId),{companyId:'taebaek',source:{type:'oem',id:jobId+'-other'},expectedOperationIds:commands.map(row=>row.operationId)}));
    expect((await read()).status).toBe('conflict');
    await env.withSecurityRulesDisabled(async ctx=>deleteDoc(doc(ctx.firestore(),'rawInventoryJobs','oem-issue:'+jobId)));
    await seed(1);expect(await read()).toMatchObject({status:'verified',canResume:true});
    await env.withSecurityRulesDisabled(async ctx=>deleteDoc(doc(ctx.firestore(),'purchaseOrders',jobId)));
    expect(await read()).toMatchObject({status:'verified',cardStatus:'missing'});
    expect((await getDoc(doc(db,'rawInventoryJobs','oem-issue:'+jobId))).exists()).toBe(false);
    await seed(0,true,'conflicting-hash');expect((await read()).status).toBe('conflict');
    await env.withSecurityRulesDisabled(async ctx=>deleteDoc(doc(ctx.firestore(),'rawMaterialLedger',legacyOperationDocId(commands[0].operationId))));
    await env.withSecurityRulesDisabled(async ctx=>setDoc(doc(ctx.firestore(),'rawMaterialLedger',operationDocId(commands[0].operationId)),commands[0]));
    expect((await read()).status).toBe('unknown');
    // 조회는 재고 문서·진행표·카드를 새로 만들지 않는다.
    expect((await getDoc(doc(db,'items',rawA))).exists()).toBe(false);
    expect((await getDoc(doc(db,'purchaseOrders',jobId))).exists()).toBe(false);
    expect((await getDoc(doc(db,'rawInventoryJobs','oem-issue:'+jobId))).exists()).toBe(false);
  },20_000);
  it('실제 조회의 scope교체는 결과반환을 막고 타회사원문은 verified가 되지 않는다',async()=>{
    const db=env.authenticatedContext('u-'+runId,{employeeId:'admin',companyId:'taebaek',isAdmin:true}).firestore() as unknown as Firestore;
    const input={jobId:runId+'-scope',companyId:'taebaek' as const,partnerId:runId+'-partner',partnerName:'시험',date:'2026-10-19',sent:[{rawItemId:runId+'-scope-raw',material:'A',kg:2}]};
    let checks=0;
    await expect(firestoreOemIssuePorts(db,async()=>{if(++checks>1)throw Error('UID 변경');}).inspectEvidence(input)).rejects.toThrow('UID 변경');
    await env.withSecurityRulesDisabled(async ctx=>setDoc(doc(ctx.firestore(),'purchaseOrders',input.jobId),{id:input.jobId,companyId:'punghoe',poType:'oem',status:'invoiced',oemIssueStatus:'complete',oemIssueFingerprint:oemIssueFingerprint(input)}));
    const result=await firestoreOemIssuePorts(db).inspectEvidence(input);expect(result.status).not.toBe('verified');expect(result.canResume).toBe(false);
  },20_000);

});
