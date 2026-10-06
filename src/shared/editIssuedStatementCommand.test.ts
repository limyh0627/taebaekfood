import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  old: {} as Record<string, unknown>, settled: 0, update: vi.fn(), create: vi.fn(),
}));
vi.mock('../../functions/node_modules/firebase-functions/lib/v2/providers/https.js', () => ({
  onCall: (_options: unknown, handler: unknown) => handler,
  HttpsError: class extends Error { constructor(public code: string, message: string) { super(message); } },
}));
vi.mock('../../functions/node_modules/firebase-admin/lib/index.js', () => ({
  firestore: Object.assign(() => ({
    doc: (path: string) => path,
    collection: (name: string) => ({ doc: (id: string) => `${name}/${id}`, where: () => 'settlements' }),
    runTransaction: (run: (tx: unknown) => unknown) => run({
      get: async (ref: string) => {
        if (ref === 'appMeta/releaseCutover') return { get: (key: string) => ({ status: 'active', releaseId: 'live' } as Record<string, string>)[key] };
        if (ref.startsWith('voucherMutationOperations/')) return { exists: false };
        if (ref === 'settlements') return { size: state.settled ? 1 : 0, docs: state.settled ? [{ get: () => state.settled }] : [] };
        return { exists: true, data: () => state.old };
      },
      update: state.update, create: state.create,
    }),
  }), { FieldValue: { serverTimestamp: () => 'server-time' } }),
}));
import { editIssuedStatementCommand } from '../../functions/src/editIssuedStatementCommand';
const run = editIssuedStatementCommand as unknown as (input: unknown) => Promise<unknown>;
const request = (patch: Record<string, unknown> = { memo: '수정' }) => ({
  auth: { uid: 'user', token: { isAdmin: true, employeeId: 'employee', companyId: 'taebaek' } },
  data: { statementId: 'stmt-1', operationId: 'operation-1', expectedRevision: 0, releaseId: 'live', patch },
});

beforeEach(() => {
  state.old = { companyId: 'taebaek', partnerId: 'partner', orderId: 'order', totalAmount: 965000, mutationRevision: 0 };
  state.settled = 245000;
  state.update.mockClear(); state.create.mockClear();
});

describe('발행 전표 서버 수정', () => {
  it('주문·수금이 연결된 전표도 같은 거래처의 비고 수정은 저장한다', async () => {
    expect(await run(request())).toEqual({ status: 'applied', revision: 1 });
    expect(state.update).toHaveBeenCalledWith('issuedStatements/stmt-1', expect.objectContaining({ memo: '수정', mutationRevision: 1 }));
  });
  it('수금 이상인 금액 수정은 저장한다', async () => {
    await run(request({ totalAmount: 500000 }));
    expect(state.update).toHaveBeenCalled();
  });
  it('이미 받은 수금보다 적은 금액은 거부한다', async () => {
    await expect(run(request({ totalAmount: 100000 }))).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(state.update).not.toHaveBeenCalled();
  });
  it('다른 회사 전표 수정은 거부한다', async () => {
    state.old.companyId = 'punghoe';
    await expect(run(request())).rejects.toMatchObject({ code: 'permission-denied' });
    expect(state.update).not.toHaveBeenCalled();
  });
  it('충돌한 전표 버전은 덮어쓰지 않는다', async () => {
    state.old.mutationRevision = 1;
    await expect(run(request())).rejects.toMatchObject({ code: 'aborted' });
    expect(state.update).not.toHaveBeenCalled();
  });
  it('품목 합계가 틀리면 저장하지 않는다', async () => {
    await expect(run(request({ items: [{ name: '참기름', qty: 1, price: 1000, supply: 1000, tax: 0, total: 1000 }],
      totalSupply: 2000, totalTax: 0, totalAmount: 2000 }))).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(state.update).not.toHaveBeenCalled();
  });
});
