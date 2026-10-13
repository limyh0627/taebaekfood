import { describe, expect, it,vi } from 'vitest';
const dbMemory=vi.hoisted(()=>({rows:new Map<string,any>(),afterRead:undefined as undefined|((path:string)=>void)}));
vi.mock('firebase/firestore',()=>{
 const snapshot=(ref:any)=>{const row=dbMemory.rows.get(ref.path);return {id:ref.id,ref,exists:()=>row!==undefined,data:()=>row};};
 return {doc:(_db:any,...parts:string[])=>({path:parts.join('/'),id:parts.at(-1)}),getDoc:async(ref:any)=>snapshot(ref),
 runTransaction:async(_db:any,callback:any)=>{const writes:any[]=[];const tx={get:async(ref:any)=>{const snap=snapshot(ref);dbMemory.afterRead?.(ref.path);return snap;},set:(ref:any,row:any)=>writes.push([ref.path,row]),update:(ref:any,row:any)=>writes.push([ref.path,{...dbMemory.rows.get(ref.path),...row}])};const result=await callback(tx);for(const [path,row]of writes)dbMemory.rows.set(path,row);return result;}};
});
import { oemIssueFingerprint, recoverableOemDrafts, runOemIssueJob,firestoreOemIssuePorts, type OemIssueDraft, type OemIssueInput, type OemIssuePorts } from './oemIssueJob';
import {executeRawInventoryCommand} from '../../shared/services/rawInventoryService';

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
    missingRawSteps: async draft => draft.oemSent.filter(row => !applied.has(`${draft.id}:${row.rawItemId}`)).map(row => row.rawItemId ?? ''),
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
