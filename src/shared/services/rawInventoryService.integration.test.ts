/**
 * **서비스 에뮬레이터 시험** — 설계 §16.
 *
 * `executeRawInventoryCommand` 가 상태·이력·품목·`ReversalGuard` 를 한 트랜잭션에서 쓴다는
 * 것을 실제 Firestore 없이 확인한다. 얇은 인메모리 Firestore 를 만들어 `runTransaction` 이
 * 부르는 콜백을 그대로 태워, "한 콜백 안에서 세 문서를 함께 커밋한다"는 계약을 잠근다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── 인메모리 Firestore 흉내 ─────────────────────────────────────────────
const store = new Map<string, Record<string, unknown>>();
type DocRef = { path: string };
const 저장소열쇠 = (ref: DocRef) => ref.path;

vi.mock('../firebase', () => ({ db: { __memory: true } }));
vi.mock('../../constants/formula', () => ({
  baseRawName: (name: string) => String(name ?? '').split('/')[0].trim(),
}));

vi.mock('firebase/firestore', () => {
  const doc = (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') });
  const getDoc = async (ref: DocRef) => {
    const data = store.get(저장소열쇠(ref));
    return { exists: () => !!data, data: () => data };
  };
  const runTransaction = async (_db: unknown, cb: (tx: unknown) => Promise<unknown>) => {
    const writes: Array<{ path: string; data: Record<string, unknown> } | { path: string; delete: true }> = [];
    const tx = {
      get: async (ref: DocRef) => getDoc(ref),
      set: (ref: DocRef, data: Record<string, unknown>) => { writes.push({ path: 저장소열쇠(ref), data }); },
      update: (ref: DocRef, data: Record<string, unknown>) => {
        writes.push({ path: 저장소열쇠(ref), data: { ...(store.get(저장소열쇠(ref)) ?? {}), ...data } });
      },
      delete: (ref: DocRef) => { writes.push({ path: 저장소열쇠(ref), delete: true }); },
    };
    const result = await cb(tx);
    //  실패 결과여도 콜백이 던지지 않으면 write 는 커밋된다 — 서비스가 실패에서 write 를 안 부르는지 확인한다.
    for (const w of writes) {
      if ('delete' in w) store.delete(w.path);
      else store.set(w.path, w.data);
    }
    return result;
  };
  return { doc, getDoc, runTransaction };
});

const { executeRawInventoryCommand, updateRawInventoryLotMetadata } = await import('./rawInventoryService');
const { commandHash, operationDocId, inventoryDocId } = await import('../rawInventoryCore');
import type { RawInventoryCommand } from '../rawInventoryCore';

const 품목 = (id: string, o: Record<string, unknown> = {}) =>
  ({ id, name: `이름-${id}`, subtype: '벌크', unit: 'kg', stock: 0, ...o });

const 명령 = (o: Partial<RawInventoryCommand> = {}): RawInventoryCommand => ({
  operationId: 'op-1',
  companyId: 'taebaek',
  rawItemId: 'raw-x',
  materialSnapshot: 'x',
  effectiveAt: '2026-09-10T09:00:00.000Z',
  source: { type: 'manual', id: 'm1' },
  kind: 'receive', kg: 100, lot: { supplierName: '청정' },
  ...o,
} as RawInventoryCommand);

beforeEach(() => {
  store.clear();
  store.set('items/raw-x', 품목('raw-x'));
});

describe('한 트랜잭션이 상태·이력·품목을 같이 쓴다', () => {
  it('applied 는 셋을 다 남긴다', async () => {
    const r = await executeRawInventoryCommand(명령());
    expect(r.status).toBe('applied');
    const stateId = inventoryDocId('taebaek', 'raw-x');
    expect(store.has(`rawInventories/${stateId}`)).toBe(true);
    expect(store.has(`rawMaterialLedger/${operationDocId('op-1')}`)).toBe(true);
    expect(store.get('items/raw-x')).toMatchObject({ stock: 100 });
  });

  it('rejected 면 아무 write 도 안 남는다', async () => {
    //  상태 문서가 없는데 품목에 로트가 있으면 NOT_MIGRATED
    store.set('items/raw-x', 품목('raw-x', { lots: [{ id: 'legacy', kgRemaining: 50, kgIn: 50 }] }));
    const before = new Map(store);
    const r = await executeRawInventoryCommand(명령());
    expect(r.status).toBe('rejected');
    if (r.status === 'rejected') expect(r.code).toBe('NOT_MIGRATED');
    expect([...store.keys()].sort()).toEqual([...before.keys()].sort());
  });

  it('같은 명령을 두 번 보내면 두 번째는 duplicate — 수량이 두 번 안 움직인다', async () => {
    const first = await executeRawInventoryCommand(명령());
    expect(first.status).toBe('applied');
    const second = await executeRawInventoryCommand(명령());
    expect(second.status).toBe('duplicate');
    expect(store.get('items/raw-x')).toMatchObject({ stock: 100 });
  });

  it('같은 id 인데 다른 수량 → conflict, 아무 것도 안 움직인다', async () => {
    await executeRawInventoryCommand(명령({ kg: 100 }));
    const before = JSON.stringify(store.get('items/raw-x'));
    const r = await executeRawInventoryCommand(명령({ kg: 200 }));
    expect(r.status).toBe('conflict');
    expect(JSON.stringify(store.get('items/raw-x'))).toBe(before);
  });

  it('회사 경계 — 품목 회사가 다르면 거절', async () => {
    store.set('items/raw-x', 품목('raw-x', { companyId: 'punghoe' }));
    const r = await executeRawInventoryCommand(명령({ companyId: 'taebaek' }));
    expect(r.status).toBe('rejected');
    if (r.status === 'rejected') expect(r.code).toBe('COMPANY_MISMATCH');
  });

  it('reverse — 원본 이력과 guard 를 같이 읽어 두 번째 취소를 막는다', async () => {
    //  입고 → 사용 → 취소 → 다른 id 로 또 취소
    await executeRawInventoryCommand(명령({ operationId: 'in-1', kg: 100 }));
    await executeRawInventoryCommand(명령({ operationId: 'use-1', kind: 'consume', kg: 30 } as never));
    const rev1 = await executeRawInventoryCommand(명령({
      operationId: 'rev-A', kind: 'reverse', originalOperationId: 'use-1',
    } as never));
    expect(rev1.status).toBe('applied');
    if (rev1.status === 'applied') {
      const guardKey = `rawInventoryReversalGuards/${operationDocId('use-1')}`;
      expect(store.has(guardKey)).toBe(true);
    }
    const rev2 = await executeRawInventoryCommand(명령({
      operationId: 'rev-B', kind: 'reverse', originalOperationId: 'use-1',
    } as never));
    expect(rev2.status).toBe('rejected');
    if (rev2.status === 'rejected') expect(rev2.code).toBe('ALREADY_REVERSED');
  });

  it('lotsAreTotal 원료는 items.stock 을 안 덮는다', async () => {
    store.set('items/raw-x', 품목('raw-x', { lotsAreTotal: true, stock: 42 }));
    await executeRawInventoryCommand(명령({ kg: 5 }));
    expect(store.get('items/raw-x')).toMatchObject({ stock: 42 });   // 안 덮었다
  });

  it('commandHash 를 이력에 실어 저장한다', async () => {
    const r = await executeRawInventoryCommand(명령({ kg: 100 }));
    expect(r.status).toBe('applied');
    const doc = store.get(`rawMaterialLedger/${operationDocId('op-1')}`);
    expect(doc?.commandHash).toBe(commandHash(명령({ kg: 100 })));
  });

  it('items.stock 과 상태가 어긋나도 실사는 둘을 한 값으로 복구할 수 있다', async () => {
    const stateId = inventoryDocId('taebaek', 'raw-x');
    store.set('items/raw-x', 품목('raw-x', { stock: 80, lots: [] }));
    store.set(`rawInventories/${stateId}`, {
      id: stateId, companyId: 'taebaek', rawItemId: 'raw-x', materialSnapshot: 'x',
      stockKg: 100, activeLots: [{
        id: 'L1', supplierName: '기존', receivedDate: '2026-09-01',
        qtyIn: 0, kgIn: 100, kgRemaining: 100, status: 'active', createdAt: '',
      }], recentDepletedLots: [], revision: 0, lastProcessedAt: '',
    });
    const r = await executeRawInventoryCommand(명령({
      operationId: 'stocktake-fix', kind: 'stocktake', targetKg: 90,
      effectiveAt: '2026-09-10T10:11:12.000Z',
    } as never));
    expect(r.status).toBe('applied');
    expect(store.get('items/raw-x')).toMatchObject({ stock: 90 });
    expect(store.get(`rawInventories/${stateId}`)).toMatchObject({ stockKg: 90 });
  });

  it('FIFO 순서·로트번호는 상태와 화면용 품목 사본을 함께 바꾸고 수량은 못 바꾼다', async () => {
    const stateId = inventoryDocId('taebaek', 'raw-x');
    const lots = [
      { id: 'L1', supplierName: 'A', receivedDate: '2026-09-01', qtyIn: 0, kgIn: 30, kgRemaining: 30, status: 'active', createdAt: '' },
      { id: 'L2', supplierName: 'B', receivedDate: '2026-09-02', qtyIn: 0, kgIn: 20, kgRemaining: 20, status: 'active', createdAt: '' },
    ];
    store.set('items/raw-x', 품목('raw-x', { stock: 50, lots }));
    store.set(`rawInventories/${stateId}`, {
      id: stateId, companyId: 'taebaek', rawItemId: 'raw-x', materialSnapshot: 'x',
      stockKg: 50, activeLots: lots, recentDepletedLots: [], revision: 3, lastProcessedAt: 'old',
    });
    await updateRawInventoryLotMetadata({
      companyId: 'taebaek', rawItemId: 'raw-x',
      transform: cur => [{ ...cur[1], lotNo: '새번호' }, cur[0]],
    });
    expect((store.get(`rawInventories/${stateId}`)?.activeLots as any[]).map(x => x.id)).toEqual(['L2', 'L1']);
    expect((store.get('items/raw-x')?.lots as any[])[0]).toMatchObject({ id: 'L2', lotNo: '새번호' });
    expect(store.get(`rawInventories/${stateId}`)).toMatchObject({ stockKg: 50, revision: 3, lastProcessedAt: 'old' });

    await expect(updateRawInventoryLotMetadata({
      companyId: 'taebaek', rawItemId: 'raw-x',
      transform: cur => cur.map(x => x.id === 'L1' ? { ...x, kgRemaining: 999 } : x),
    })).rejects.toThrow('수량·상태·추가삭제');
  });
});
