import { describe, expect, it,vi } from 'vitest';
const dbMemory=vi.hoisted(()=>({rows:new Map<string,any>(),serverReadFailed:false,metadata:{fromCache:false,hasPendingWrites:false},afterRead:undefined as undefined|((path:string)=>void)}));
vi.mock('firebase/firestore',()=>{
 const snapshot=(ref:any)=>{const row=dbMemory.rows.get(ref.path);return {id:ref.id,ref,exists:()=>row!==undefined,data:()=>row,metadata:{...dbMemory.metadata}};};
 return {doc:(_db:any,...parts:string[])=>({path:parts.join('/'),id:parts.at(-1)}),getDoc:async(ref:any)=>snapshot(ref),getDocFromServer:async(ref:any)=>{if(dbMemory.serverReadFailed)throw Error('서버 조회 실패');return snapshot(ref);},
 runTransaction:async(_db:any,callback:any)=>{const writes:any[]=[];const tx={get:async(ref:any)=>{const snap=snapshot(ref);dbMemory.afterRead?.(ref.path);return snap;},set:(ref:any,row:any)=>writes.push([ref.path,row]),update:(ref:any,row:any)=>writes.push([ref.path,{...dbMemory.rows.get(ref.path),...row}])};const result=await callback(tx);for(const [path,row]of writes)dbMemory.rows.set(path,row);return result;}};
});
import { oemIssueFingerprint, recoverableOemDrafts, runOemIssueJob,firestoreOemIssuePorts, type OemIssueDraft, type OemIssueInput, type OemIssuePorts } from './oemIssueJob';
import {executeRawInventoryCommand} from '../../shared/services/rawInventoryService';
import { commandHash, operationDocId } from '../../shared/rawInventoryCore';
import { inspectOemIssueJob } from './oemIssueJob';
import { oemIssueAttemptKey, type OemIssueRequest } from '../../shared/oemIssuePending';
vi.mock('../../shared/firebase',()=>({auth:{currentUser:{uid:'actor',getIdTokenResult:async()=>({claims:{companyId:'taebaek'}})}},authReady:Promise.resolve()}));

const input = (jobId = 'oem-click-1'): OemIssueInput => ({
  jobId, companyId: 'taebaek', partnerId: 'p-oem', partnerName: '외주공장', date: '2026-09-24',
  sent: [{ material: '참깨', rawItemId: 'raw-sesame', kg: 100 }, { material: '들깨', rawItemId: 'raw-perilla', kg: 50 }],
});

function harness() {
  const drafts = new Map<string, OemIssueDraft>();
  const applied = new Set<string>();
  const effects = new Map<string, number>();
  let failRawAt = -1;
  let failFinalize = false;
  const ports: OemIssuePorts = {
    prepareDraft: async command => {
      const fingerprint = oemIssueFingerprint(command);
      const existing = drafts.get(command.jobId);
      if (existing) {
        if (existing.oemIssueFingerprint !== fingerprint) throw new Error('같은 OEM 작업번호의 회사나 내용이 다릅니다.');
        return existing;
      }
      const draft = {
        id: command.jobId, companyId: command.companyId, poType: 'oem' as const,
        status: 'pending' as const, oemIssueStatus: 'processing' as const,
        oemIssueFingerprint: fingerprint, oemIssueDate: command.date,
        oemSent: command.sent, partnerId: command.partnerId, partnerName: command.partnerName,
        oemPartnerId: command.partnerId, itemId: '', itemName: '', quantity: 0, createdAt: '2026-09-24T00:00:00Z',
      };
      drafts.set(command.jobId, draft);
      return draft;
    },
    runRawSteps: async draft => {
      for (const [index, row] of draft.oemSent.entries()) {
        if (index === failRawAt) throw new Error('원료 단계 실패');
        const operationId = `${draft.id}:${row.rawItemId}`;
        if (!applied.has(operationId)) effects.set(operationId, (effects.get(operationId) ?? 0) + 1);
        applied.add(operationId);
      }
    },
    inspectEvidence: async command => {
      const draft = drafts.get(command.jobId), verified = command.sent.filter(row => applied.has(command.jobId + ':' + row.rawItemId)).map(row => row.rawItemId), missing = command.sent.filter(row => !applied.has(command.jobId + ':' + row.rawItemId)).map(row => row.rawItemId);
      const status = missing.length ? verified.length ? 'partial' as const : 'absent' as const : 'verified' as const;
      const cardStatus = !draft ? 'missing' as const : draft.status === 'invoiced' ? 'complete' as const : 'pending' as const;
      return { status, poId: command.jobId, cardStatus, verifiedOperationIds: verified, missingOperationIds: missing, unknownOperationIds: [], conflictingOperationIds: [], message: '실원료 확인', nextAction: '같은 작업 재개', canResume: cardStatus !== 'complete' || status === 'verified' };
    },
    finalizeDraft: async draft => {
      if (failFinalize) throw new Error('카드 확정 실패');
      drafts.set(draft.id, { ...draft, status: 'invoiced', oemIssueStatus: 'complete' });
    },
    markFailed: async (draft, message) => {
      drafts.set(draft.id, { ...draft, oemIssueStatus: 'failed', oemIssueError: message });
    },
  };
  return { drafts, applied, effects, ports, failRawAt: (index: number) => { failRawAt = index; }, failFinalize: (value: boolean) => { failFinalize = value; } };
}

describe('OEM 외주발주 재개 계약', () => {
  it('실제 원료 서비스 읽기 중 UID가 바뀌면 raw 거래 쓰기와 최종 확정을 막는다',async()=>{
    dbMemory.rows.clear();let current=true;
    for(const row of input().sent){dbMemory.rows.set('items/'+row.rawItemId,{companyId:'taebaek',stock:0,lots:[]});await executeRawInventoryCommand({kind:'receive',companyId:'taebaek',rawItemId:row.rawItemId,materialSnapshot:row.material,operationId:'seed-'+row.rawItemId,effectiveAt:'2026-09-01T00:00:00Z',source:{type:'manual',id:'seed'},kg:200,lot:{supplierName:'공급'}},{db:{} as any});}
    const before=structuredClone([...dbMemory.rows.entries()]);
    dbMemory.afterRead=path=>{if(path.startsWith('rawInventories/'))current=false;};
    try{await expect(runOemIssueJob(input(),firestoreOemIssuePorts({} as any,async()=>{if(!current)throw Error('계정 변경');}),async()=>{if(!current)throw Error('계정 변경');})).rejects.toThrow('계정 변경');
     expect([...dbMemory.rows.entries()].filter(([path])=>!path.startsWith('purchaseOrders/')&&!path.startsWith('rawInventoryJobs/'))).toEqual(before);
     expect(dbMemory.rows.get('purchaseOrders/'+input().jobId).status).toBe('pending');
     expect([...dbMemory.rows.values()].some(row=>row.status==='complete')).toBe(false);
    }finally{dbMemory.afterRead=undefined;dbMemory.rows.clear();}
  });
  it('초안 준비 대기 중 계정이 바뀌면 원료 단계와 실패 표식을 새 계정으로 쓰지 않는다',async()=>{
    const h=harness();let current=true;const prepare=h.ports.prepareDraft;h.ports.prepareDraft=async i=>{const draft=await prepare(i);current=false;return draft;};
    await expect(runOemIssueJob(input(),h.ports,async()=>{if(!current)throw Error('계정 변경');})).rejects.toThrow('계정 변경');expect(h.effects.size).toBe(0);expect(h.drafts.get(input().jobId)?.oemIssueStatus).toBe('processing');
  });
  it('원료 완료 이후 계정이 바뀌면 확정이나 failed 덮어쓰기를 하지 않는다',async()=>{
    const h=harness();let current=true;const raw=h.ports.runRawSteps;h.ports.runRawSteps=async draft=>{await raw(draft);current=false;};
    await expect(runOemIssueJob(input(),h.ports,async()=>{if(!current)throw Error('계정 변경');})).rejects.toThrow('계정 변경');expect(h.drafts.get(input().jobId)?.status).toBe('pending');expect(h.drafts.get(input().jobId)?.oemIssueStatus).toBe('processing');
  });
  it('두 번째 원료가 실패해도 같은 jobId 재시도는 첫 원료를 한 번만 반영한다', async () => {
    const h = harness();
    h.failRawAt(1);
    await expect(runOemIssueJob(input(), h.ports)).rejects.toThrow('부분 완료');
    expect(h.applied).toEqual(new Set(['oem-click-1:raw-sesame']));
    expect(recoverableOemDrafts([...h.drafts.values()], 'taebaek')).toHaveLength(1);
    h.failRawAt(-1);
    await runOemIssueJob(input(), h.ports);
    expect(h.applied).toEqual(new Set(['oem-click-1:raw-sesame', 'oem-click-1:raw-perilla']));
    expect(h.effects.get('oem-click-1:raw-sesame')).toBe(1);
    expect(h.drafts.get('oem-click-1')).toMatchObject({ status: 'invoiced', oemIssueStatus: 'complete' });
  });

  it('카드 확정 실패 후 재시도해도 원료를 다시 차감하지 않고 카드 한 건만 확정한다', async () => {
    const h = harness();
    h.failFinalize(true);
    await expect(runOemIssueJob(input(), h.ports)).rejects.toThrow('카드 확정 실패');
    expect(h.applied.size).toBe(2);
    expect(h.drafts.size).toBe(1);
    h.failFinalize(false);
    await runOemIssueJob(input(), h.ports);
    expect(h.applied.size).toBe(2);
    expect(h.effects.get('oem-click-1:raw-sesame')).toBe(1);
    expect(h.effects.get('oem-click-1:raw-perilla')).toBe(1);
    expect(h.drafts.size).toBe(1);
    expect(h.drafts.get('oem-click-1')?.status).toBe('invoiced');
  });

  it('같은 내용의 별도 클릭은 새 jobId로 별도 발주가 된다', async () => {
    const h = harness();
    await runOemIssueJob(input('oem-click-1'), h.ports);
    await runOemIssueJob(input('oem-click-2'), h.ports);
    expect(h.drafts.size).toBe(2);
    expect(h.applied.size).toBe(4);
  });

  it('같은 jobId의 내용 변경은 원료 명령 전에 거절한다', async () => {
    const h = harness();
    await runOemIssueJob(input(), h.ports);
    const altered = { ...input(), sent: [{ material: '참깨', rawItemId: 'raw-sesame', kg: 101 }] };
    await expect(runOemIssueJob(altered, h.ports)).rejects.toThrow('내용이 다릅니다');
    expect(h.applied.size).toBe(2);
    expect(h.drafts.size).toBe(1);
  });

  it('재접속 후에도 저장된 미완료 초안만 찾아 같은 ID로 재개한다', async () => {
    const h = harness();
    h.failRawAt(0);
    await expect(runOemIssueJob(input(), h.ports)).rejects.toThrow('부분 완료');
    const recoverable = recoverableOemDrafts([...h.drafts.values()], 'taebaek');
    expect(recoverable.map(row => row.id)).toEqual(['oem-click-1']);
    expect(recoverableOemDrafts([...h.drafts.values()], 'punghoe')).toEqual([]);
    h.failRawAt(-1);
    await runOemIssueJob(input(recoverable[0]!.id), h.ports);
    expect(recoverableOemDrafts([...h.drafts.values()], 'taebaek')).toEqual([]);
  });
});

const expectedCommands = (command: OemIssueInput) => command.sent.map(row => ({
    operationId: 'oem-issue:' + command.jobId + ':' + row.rawItemId, companyId: command.companyId, rawItemId: row.rawItemId, materialSnapshot: row.material, effectiveAt: command.date + 'T12:00:00+09:00', source: {
        type: 'oem' as const, id: command.jobId
    }, kind: 'consume' as const, kg: row.kg
}));
function putEvidence(command: OemIssueInput) {
    for (const row of expectedCommands(command))
        dbMemory.rows.set('rawMaterialLedger/' + operationDocId(row.operationId), {
            ...row, commandHash: commandHash(row)
        });
}
describe('OEM 최초원문 기반 완료 증거와 재개', () => {
    it('완료카드만있고job·원료이력이없으면성공이나재차감으로넘어가지않는다', async () => {
        dbMemory.rows.clear();
        const command = input(), ports = firestoreOemIssuePorts({} as import('firebase/firestore').Firestore);
        await ports.prepareDraft(command);
        Object.assign(dbMemory.rows.get('purchaseOrders/' + command.jobId), {
            status: 'invoiced', oemIssueStatus: 'complete'
        });
        const before = structuredClone([...dbMemory.rows]);
        expect(await ports.inspectEvidence(command)).toMatchObject({
            status: 'absent', cardStatus: 'complete', canResume: false
        });
        await expect(runOemIssueJob(command, ports)).rejects.toThrow('완료 카드');
        expect([...dbMemory.rows]).toEqual(before);
    });
    it.each(['unknown', 'conflict'] as const)('pending이라도%s증거는진행표·원료·카드쓰기전에멈춘다', async (status) => {
        dbMemory.rows.clear();
        const command = input(), ports = firestoreOemIssuePorts({} as import('firebase/firestore').Firestore);
        await ports.prepareDraft(command);
        putEvidence(command);
        const row = dbMemory.rows.get('rawMaterialLedger/' + operationDocId(expectedCommands(command)[0].operationId));
        if (status === 'unknown')
            delete row.commandHash;
        else
            row.companyId = 'punghoe';
        const before = structuredClone([...dbMemory.rows]);
        expect((await ports.inspectEvidence(command)).status).toBe(status);
        await expect(runOemIssueJob(command, ports)).rejects.toThrow();
        expect([...dbMemory.rows]).toEqual(before);
    });
    it('첫조회pending뒤준비응답이complete로바뀌면새증거없이원료를재실행하지않는다', async () => {
        const h = harness(), prepare = h.ports.prepareDraft;
        let reads = 0;
        const inspect = h.ports.inspectEvidence;
        h.ports.inspectEvidence = async (command) => { reads++; const evidence = await inspect(command); return reads === 1 ? evidence : {
            ...evidence, cardStatus: 'complete', canResume: false
        }; };
        h.ports.prepareDraft = async (command) => ({
            ...await prepare(command), status: 'invoiced', oemIssueStatus: 'complete'
        });
        const raw = vi.spyOn(h.ports, 'runRawSteps');
        await expect(runOemIssueJob(input(), h.ports)).rejects.toThrow();
        expect(raw).not.toHaveBeenCalled();
        expect(reads).toBe(2);
    });
    it('완료PO와모든정확이력이있으면사라진job만같은op중복경로로복원하고재고는그대로다', async () => {
        dbMemory.rows.clear();
        const command = input(), db = {} as import('firebase/firestore').Firestore;
        for (const row of command.sent) {
            dbMemory.rows.set('items/' + row.rawItemId, {
                companyId: 'taebaek', name: row.material, stock: 0, lots: []
            });
            await executeRawInventoryCommand({
                kind: 'receive', companyId: 'taebaek', rawItemId: row.rawItemId, materialSnapshot: row.material, operationId: 'evidence-seed-' + row.rawItemId, effectiveAt: '2026-09-01T00:00:00Z', source: {
                    type: 'manual', id: 'seed'
                }, kg: 200, lot: {
                    supplierName: '공급'
                }
            }, {
                db
            });
        }
        const ports = firestoreOemIssuePorts(db);
        await runOemIssueJob(command, ports);
        dbMemory.rows.delete('rawInventoryJobs/oem-issue:' + command.jobId);
        const stocks = command.sent.map(row => dbMemory.rows.get('items/' + row.rawItemId).stock);
        expect(await ports.inspectEvidence(command)).toMatchObject({
            status: 'verified', cardStatus: 'complete', canResume: true
        });
        await runOemIssueJob(command, ports);
        expect(command.sent.map(row => dbMemory.rows.get('items/' + row.rawItemId).stock)).toEqual(stocks);
        expect(dbMemory.rows.get('rawInventoryJobs/oem-issue:' + command.jobId).status).toBe('complete');
    });
    it('공개readonly조회는계정과최초원문을검증하고ACK·사본정리·DB쓰기를하지않는다', async () => {
        dbMemory.rows.clear();
        const command = input(), request: OemIssueRequest = {
            version: 1, companyId: 'taebaek', actorUid: 'actor', input: command
        }, retained = {
            request, key: oemIssueAttemptKey(request), encoded: JSON.stringify(request)
        };
        const copies = new Map([[retained.key, retained.encoded]]);
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => copies.get(key) ?? null
        });
        try {
            const before = structuredClone([...dbMemory.rows]);
            expect(await inspectOemIssueJob({} as import('firebase/firestore').Firestore, command, {
                actorUid: 'actor', isCurrent: () => true, retained
            })).toMatchObject({
                status: 'absent', canResume: true
            });
            expect([...dbMemory.rows]).toEqual(before);
            expect(copies.get(retained.key)).toBe(retained.encoded);
            await expect(inspectOemIssueJob({} as import('firebase/firestore').Firestore, command, {
                actorUid: 'different', isCurrent: () => true, retained
            })).rejects.toThrow('계정');
            copies.set(retained.key, '바뀐 원문');
            await expect(inspectOemIssueJob({} as import('firebase/firestore').Firestore, command, {
                actorUid: 'actor', isCurrent: () => true, retained
            })).rejects.toThrow('원문');
        }
        finally {
            vi.unstubAllGlobals();
        }
    });
});
it('완료카드의일부이력만있는경우에도재고재개와완료ACK로넘어가지않는다', async () => {
    const h = harness();
    h.failRawAt(1);
    await expect(runOemIssueJob(input(), h.ports)).rejects.toThrow();
    const existing = h.drafts.get(input().jobId)!;
    h.drafts.set(existing.id, {
        ...existing, status: 'invoiced', oemIssueStatus: 'complete'
    });
    h.failRawAt(-1);
    const raw = vi.spyOn(h.ports, 'runRawSteps');
    await expect(runOemIssueJob(input(), h.ports)).rejects.toThrow();
    expect(raw).not.toHaveBeenCalled();
    expect(h.applied.size).toBe(1);
});

it('정확한완료카드와원장이캐시에있어도PO서버조회실패는재개를허용하지않는다',async()=>{
 dbMemory.rows.clear();const command=input(),ports=firestoreOemIssuePorts({} as import('firebase/firestore').Firestore);await ports.prepareDraft(command);Object.assign(dbMemory.rows.get('purchaseOrders/'+command.jobId),{status:'invoiced',oemIssueStatus:'complete'});putEvidence(command);dbMemory.serverReadFailed=true;const before=structuredClone([...dbMemory.rows]);try{expect(await ports.inspectEvidence(command)).toMatchObject({status:'unknown',cardStatus:'unknown',canResume:false});await expect(runOemIssueJob(command,ports)).rejects.toThrow('서버 조회 실패');expect([...dbMemory.rows]).toEqual(before);}finally{dbMemory.serverReadFailed=false;}
});

it('서버조회응답의미승인카드overlay는완료근거와재개로승격하지않는다',async()=>{
 dbMemory.rows.clear();const command=input(),ports=firestoreOemIssuePorts({} as import('firebase/firestore').Firestore);await ports.prepareDraft(command);Object.assign(dbMemory.rows.get('purchaseOrders/'+command.jobId),{status:'invoiced',oemIssueStatus:'complete'});putEvidence(command);dbMemory.metadata.hasPendingWrites=true;try{expect(await ports.inspectEvidence(command)).toMatchObject({status:'unknown',cardStatus:'unknown',canResume:false});}finally{dbMemory.metadata.hasPendingWrites=false;}
});
