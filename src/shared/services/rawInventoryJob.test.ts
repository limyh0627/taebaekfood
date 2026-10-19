import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RawInventoryCommand } from '../rawInventoryCore';

/**
 * **RawInventoryJob 러너 시험** — 설계 §8.
 *
 * 여러 원료를 묶은 업무 하나가 도중에 실패해도 진행표에 흔적을 남기고, 재실행하면
 * 이미 성공한 명령은 `duplicate` 로 건너뛴다. 완료 판정은 진행표가 아니라 이력의 존재 여부다.
 */

vi.mock('../firebase', () => ({ db: { __memory: true } }));
vi.mock('../../constants/formula', () => ({
  baseRawName: (name: string) => String(name ?? '').split('/')[0].trim(),
}));

const store = new Map<string, Record<string, unknown>>();
const readFailures = new Set<string>();
const serverReadFailures = new Set<string>();
const snapshotMetadata = {fromCache:false,hasPendingWrites:false};
type DocRef = { path: string };

vi.mock('firebase/firestore', () => {
  const doc = (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') });
  const getDoc = async (ref: DocRef) => {
    if (readFailures.has(ref.path)) throw Error('원료 조회 응답 실패');
    const d = store.get(ref.path);
    return { exists: () => !!d, data: () => d, metadata:{...snapshotMetadata} };
  };
  const runTransaction = async (_db: unknown, cb: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      get: async (ref: DocRef) => getDoc(ref),
      set: (ref: DocRef, data: Record<string, unknown>) => { store.set(ref.path, data); },
      update: (ref: DocRef, data: Record<string, unknown>) => {
        store.set(ref.path, { ...(store.get(ref.path) ?? {}), ...data });
      },
      delete: (ref: DocRef) => { store.delete(ref.path); },
    };
    return cb(tx);
  };
  return { doc, getDoc, getDocFromServer: async (ref: DocRef) => { if (serverReadFailures.has(ref.path)) throw Error('서버에 연결할 수 없습니다. 캐시를 완료 근거로 사용하지 않습니다.'); return getDoc(ref); }, runTransaction };
});

const { runRawInventoryJob, verifyRawInventoryJobComplete } = await import('./rawInventoryJob');
const { operationDocId, legacyOperationDocId, inventoryDocId } = await import('../rawInventoryCore');

const 명령 = (op: string, o: Partial<RawInventoryCommand> = {}): RawInventoryCommand => ({
  operationId: op,
  companyId: 'taebaek',
  rawItemId: 'raw-x',
  materialSnapshot: 'x',
  effectiveAt: '2026-09-10T09:00:00.000Z',
  source: { type: 'production', id: 'ORD-1' },
  kind: 'consume', kg: 10,
  ...o,
} as RawInventoryCommand);

beforeEach(() => {
  store.clear();
  readFailures.clear();
  serverReadFailures.clear();
  snapshotMetadata.fromCache=false; snapshotMetadata.hasPendingWrites=false;
  store.set('items/raw-x', { id: 'raw-x', name: 'x', subtype: '벌크', unit: 'kg', stock: 100, lots: [] });
  //  이관된 상태 문서를 미리 심어 둔다
  store.set(`rawInventories/${inventoryDocId('taebaek', 'raw-x')}`, {
    id: inventoryDocId('taebaek', 'raw-x'), companyId: 'taebaek', rawItemId: 'raw-x',
    materialSnapshot: 'x', stockKg: 100, activeLots: [
      { id: 'L1', supplierName: '옛것', kgIn: 100, kgRemaining: 100, receivedDate: '2026-09-01', status: 'active', createdAt: '' },
    ], recentDepletedLots: [], revision: 0, lastProcessedAt: '',
  });
});

describe('RawInventoryJob 러너', () => {
  it('두 원료 명령이 다 통과하면 complete', async () => {
    //  두 번째 원료를 위해 상태·품목을 하나 더 심는다
    store.set('items/raw-y', { id: 'raw-y', name: 'y', subtype: '벌크', unit: 'kg', stock: 50, lots: [] });
    store.set(`rawInventories/${inventoryDocId('taebaek', 'raw-y')}`, {
      id: inventoryDocId('taebaek', 'raw-y'), companyId: 'taebaek', rawItemId: 'raw-y',
      materialSnapshot: 'y', stockKg: 50, activeLots: [
        { id: 'L2', supplierName: '옛것', kgIn: 50, kgRemaining: 50, receivedDate: '2026-09-01', status: 'active', createdAt: '' },
      ], recentDepletedLots: [], revision: 0, lastProcessedAt: '',
    });
    const { job, results } = await runRawInventoryJob({
      jobId: 'production:ORD-1:r0', companyId: 'taebaek',
      source: { type: 'production', id: 'ORD-1' },
      commands: [
        { command: 명령('production:ORD-1:raw-x', { kg: 10 }) },
        { command: 명령('production:ORD-1:raw-y', { rawItemId: 'raw-y', materialSnapshot: 'y', kg: 5 }) },
      ],
    });
    expect(job.status).toBe('complete');
    expect(results.every(r => r.result.status === 'applied')).toBe(true);
    const j = store.get('rawInventoryJobs/production:ORD-1:r0');
    expect(j?.status).toBe('complete');
  });

  it('명령 하나가 거절되면 failed 로 남고 뒤 명령은 안 돈다', async () => {
    //  두 번째 명령을 못 처리하도록 raw-y 를 만들지 않는다 → ITEM_NOT_FOUND
    const { job, results } = await runRawInventoryJob({
      jobId: 'production:ORD-2:r0', companyId: 'taebaek',
      source: { type: 'production', id: 'ORD-2' },
      commands: [
        { command: 명령('production:ORD-2:raw-x') },
        { command: 명령('production:ORD-2:raw-y', { rawItemId: 'raw-y', materialSnapshot: 'y' }) },
      ],
    });
    expect(job.status).toBe('failed');
    expect(job.lastError).toContain('ITEM_NOT_FOUND');
    expect(results).toHaveLength(2);
    expect(results[0].result.status).toBe('applied');
    expect(results[1].result.status).toBe('rejected');
  });

  it('재실행하면 이미 성공한 명령은 duplicate 로 지나간다', async () => {
    await runRawInventoryJob({
      jobId: 'production:ORD-3:r0', companyId: 'taebaek',
      source: { type: 'production', id: 'ORD-3' },
      commands: [{ command: 명령('production:ORD-3:raw-x') }],
    });
    const 두번째 = await runRawInventoryJob({
      jobId: 'production:ORD-3:r0', companyId: 'taebaek',
      source: { type: 'production', id: 'ORD-3' },
      commands: [{ command: 명령('production:ORD-3:raw-x') }],
    });
    expect(두번째.job.status).toBe('complete');
    expect(두번째.results[0].result.status).toBe('duplicate');
  });

  it('verifyRawInventoryJobComplete 는 이력 존재로 다시 센다', async () => {
    await runRawInventoryJob({
      jobId: 'production:ORD-4:r0', companyId: 'taebaek',
      source: { type: 'production', id: 'ORD-4' },
      commands: [{ command: 명령('production:ORD-4:raw-x') }],
    });
    const 결과 = await verifyRawInventoryJobComplete('production:ORD-4:r0');
    expect(결과.job?.status).toBe('complete');
    expect(결과.missing).toEqual([]);

    //  이력을 손으로 지우고 다시 검사 — 안 맞는 걸 잡아야 한다.
    store.delete(`rawMaterialLedger/${operationDocId('production:ORD-4:raw-x')}`);
    const 재검 = await verifyRawInventoryJobComplete('production:ORD-4:r0');
    expect(재검.missing).toContain('production:ORD-4:raw-x');
  });

  it('같은 job 번호에 다른 명령 목록을 끼워 넣지 못한다', async () => {
    await runRawInventoryJob({
      jobId: 'production:ORD-5:r0', companyId: 'taebaek',
      source: { type: 'production', id: 'ORD-5' },
      commands: [{ command: 명령('production:ORD-5:raw-x') }],
    });
    await expect(runRawInventoryJob({
      jobId: 'production:ORD-5:r0', companyId: 'taebaek',
      source: { type: 'production', id: 'ORD-5' },
      commands: [{ command: 명령('production:ORD-5:DIFFERENT') }],
    })).rejects.toThrow('같은 job 번호로 다른 업무');
  });

  it('감사 검사는 옛 방식 문서 id도 찾는다', async () => {
    const jobId = 'legacy-job';
    const opId = 'old/op:id';
    store.set(`rawInventoryJobs/${jobId}`, {
      id: jobId, companyId: 'taebaek', source: { type: 'manual', id: 'old' },
      expectedOperationIds: [opId], status: 'complete', createdAt: '',
    });
    store.set(`rawMaterialLedger/${legacyOperationDocId(opId)}`, { operationId: opId });
    const result = await verifyRawInventoryJobComplete(jobId);
    expect(result.missing).toEqual([]);
  });
});

const { inspectRawInventoryJobEvidence } = await import('./rawInventoryJob');
const { commandHash } = await import('../rawInventoryCore');
const evidenceInput = (commands = [명령('OEM/작업:raw-x')]) => ({
    jobId: 'evidence-job', companyId: 'taebaek' as const, source: {
        type: 'production' as const, id: 'ORD-1'
    }, commands, db: {} as import('firebase/firestore').Firestore
});
function ledger(command: RawInventoryCommand) { return {
    operationId: command.operationId, companyId: command.companyId, rawItemId: command.rawItemId, source: command.source, commandHash: commandHash(command), effectiveAt: command.effectiveAt
}; }
describe('원문 명령 기반 원료 완료 증거', () => {
    it('job과이력부재는완료가아니며읽기중진행표나재고를쓰지않는다', async () => {
        const before = structuredClone([...store]);
        const result = await inspectRawInventoryJobEvidence(evidenceInput());
        expect(result.status).toBe('absent');
        expect(result.missingOperationIds).toEqual(['OEM/작업:raw-x']);
        expect([...store]).toEqual(before);
    });
    it.each(['modern', 'legacy', 'both'] as const)('job이없어도%s의정확이력은완료증거가된다', async (kind) => {
        const input = evidenceInput(), command = input.commands[0];
        if (kind !== 'legacy')
            store.set('rawMaterialLedger/' + operationDocId(command.operationId), ledger(command));
        if (kind !== 'modern')
            store.set('rawMaterialLedger/' + legacyOperationDocId(command.operationId), ledger(command));
        expect((await inspectRawInventoryJobEvidence(input)).status).toBe('verified');
        expect(store.has('rawInventoryJobs/evidence-job')).toBe(false);
    });
    it.each(['company', 'source', 'empty', 'different'] as const)('기존job의%s불일치는이력이있어도충돌이다', async (kind) => {
        const input = evidenceInput(), command = input.commands[0];
        store.set('rawMaterialLedger/' + operationDocId(command.operationId), ledger(command));
        store.set('rawInventoryJobs/evidence-job', {
            companyId: kind === 'company' ? 'punghoe' : 'taebaek', source: kind === 'source' ? {
                type: 'oem', id: 'other'
            } : input.source, expectedOperationIds: kind === 'empty' ? [] : kind === 'different' ? ['another'] : [command.operationId]
        });
        expect((await inspectRawInventoryJobEvidence(input)).status).toBe('conflict');
    });
    it.each(['operationId', 'companyId', 'rawItemId', 'source', 'commandHash'] as const)('실이력%s가다르면같은문서번호라도완료로보지않는다', async (field) => {
        const input = evidenceInput(), command = input.commands[0], row: Record<string, unknown> = ledger(command);
        row[field] = field === 'source' ? {
            type: 'oem', id: 'other'
        } : 'different';
        store.set('rawMaterialLedger/' + operationDocId(command.operationId), row);
        expect((await inspectRawInventoryJobEvidence(input)).status).toBe('conflict');
    });
    it('modern정상이더라도legacy의모순이나hash없는원문을숨기지않는다', async () => {
        const input = evidenceInput(), command = input.commands[0];
        store.set('rawMaterialLedger/' + operationDocId(command.operationId), ledger(command));
        store.set('rawMaterialLedger/' + legacyOperationDocId(command.operationId), {
            ...ledger(command), commandHash: 'different'
        });
        expect((await inspectRawInventoryJobEvidence(input)).status).toBe('conflict');
        const old = ledger(command);
        delete (old as Partial<typeof old>).commandHash;
        store.set('rawMaterialLedger/' + legacyOperationDocId(command.operationId), old);
        expect((await inspectRawInventoryJobEvidence(input)).status).toBe('unknown');
    });
    it('일부정확이력과없는이력을구분하며jobstatuscomplete를완료근거로쓰지않는다', async () => {
        const input = evidenceInput([명령('one'), 명령('two')]);
        store.set('rawMaterialLedger/' + operationDocId('one'), ledger(input.commands[0]));
        store.set('rawInventoryJobs/evidence-job', {
            companyId: 'taebaek', source: input.source, status: 'complete', expectedOperationIds: ['two', 'one']
        });
        const result = await inspectRawInventoryJobEvidence(input);
        expect(result.status).toBe('partial');
        expect(result.verifiedOperationIds).toEqual(['one']);
        expect(result.missingOperationIds).toEqual(['two']);
    });
    it('실조회중scope가바뀌면확인결과도새계정으로반환하지않는다', async () => {
        let checks = 0;
        await expect(inspectRawInventoryJobEvidence({
            ...evidenceInput(), assertScope: async () => { if (++checks >= 2)
                throw Error('계정 변경'); }
        })).rejects.toThrow('계정 변경');
        expect(store.has('rawInventoryJobs/evidence-job')).toBe(false);
    });
});
it('원료이력조회실패는없는이력으로바꾸지않고unknown으로보존한다', async () => {
    const input = evidenceInput();
    readFailures.add('rawMaterialLedger/' + operationDocId(input.commands[0].operationId));
    const before = structuredClone([...store]);
    expect(await inspectRawInventoryJobEvidence(input)).toMatchObject({
        status: 'unknown', message: '원료 조회 응답 실패'
    });
    expect([...store]).toEqual(before);
});

it('정확한캐시이력이있어도서버읽기실패는verified가아니라unknown이다',async()=>{
 const input=evidenceInput(),command=input.commands[0];store.set('rawMaterialLedger/'+operationDocId(command.operationId),ledger(command));serverReadFailures.add('rawMaterialLedger/'+operationDocId(command.operationId));const result=await inspectRawInventoryJobEvidence(input);expect(result.status).toBe('unknown');expect(result.message).toContain('서버에 연결');
});

it.each(['fromCache','hasPendingWrites'] as const)('서버조회라도%s가true인미확정스냅샷은완료가아니다',async field=>{
 const input=evidenceInput(),command=input.commands[0];store.set('rawMaterialLedger/'+operationDocId(command.operationId),ledger(command));snapshotMetadata[field]=true;expect(await inspectRawInventoryJobEvidence(input)).toMatchObject({status:'unknown'});
});
