import { describe, it, expect, vi } from 'vitest';
import { webcrypto, createHash } from 'node:crypto';
import { Timestamp } from 'firebase/firestore';
vi.mock('../../../shared/firebase', () => ({
  auth: {},
  authReady: Promise.resolve(),
  functions: {},
  db: {}
}));
import { createQuotationWriter, quotationFromOpening, type QuotationWritePort, type QuotationPlan } from './quotationWrites';
import { quotationSnapshot, serializeQuotationRequest, type QuotationCommand, type QuotationReference } from '../../../shared/quotationCommand';
import type { Quotation } from '../domain/quotation';
Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
  configurable: true
});
const scope = {
  companyId: 'taebaek' as const,
  actorUid: 'uid-a'
};
const quotation: Quotation = {
  id: '견적-01',
  companyId: 'taebaek',
  quoteNo: 'Q261019-01',
  date: '2026-10-19',
  partnerId: '',
  partnerName: '문의처',
  lines: [{
    name: '품목',
    spec: '병',
    qty: 2,
    price: 110,
    isTaxExempt: false
  }],
  totalSupply: 200,
  totalTax: 20,
  totalAmount: 220,
  createdAt: '2026-10-19T00:00:00Z'
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return {
    promise,
    resolve
  };
};
function fixture() {
  const map = new Map<string, string>();
  const storage = {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    }
  };
  const command = vi.fn(async (command: QuotationCommand): Promise<unknown> => {
    if (command.mode === 'open') return {
      reference: command.reference,
      actorUid: scope.actorUid,
      snapshot: quotationSnapshot(quotation),
      expectedVersion: '123:000000007'
    };
    const reference = command.mode === 'apply' ? command.request.reference : command.reference;
    return {
      version: 1,
      reference,
      actorUid: scope.actorUid,
      status: command.mode === 'cancel' ? 'cancelled' : 'applied',
      requestHash: command.mode === 'apply' ? createHash('sha256').update(serializeQuotationRequest(command.request)).digest('hex') : command.requestHash ?? null,
      message: '처리 확인'
    };
  });
  let id = 0;
  const port: QuotationWritePort = {
    storage,
    command,
    id: () => `plan-${++id}`,
    assertScope: vi.fn(async () => {}),
    exclusive: async (_scope, _id, work) => work()
  };
  return {
    map,
    storage,
    command,
    port,
    writer: createQuotationWriter(port)
  };
}
describe('견적 영속 원문 저장 경계', () => {
  it('open은 한 번 읽기만 하며 native ns를 고정하고 명시 apply에서만 업무를 보낸다', async () => {
    const f = fixture(),
      opening = await f.writer.capture(scope, quotation);
    expect(opening.expectedVersion).toBe('123:000000007');
    expect(f.map.size).toBe(0);
    expect(f.command.mock.calls.map(([c]) => c.mode)).toEqual(['open']);
    const prepared = await f.writer.prepare(scope, {
      targetId: quotation.id,
      action: 'update',
      opening,
      snapshot: quotation
    });
    expect(prepared.status).toBe('ready');
    if (prepared.status !== 'ready') throw Error('준비 실패');
    expect(f.command).toHaveBeenCalledTimes(1);
    expect((await f.writer.run(scope, prepared.reference, 'apply')).status).toBe('saved');
    expect(f.command.mock.calls.map(([c]) => c.mode)).toEqual(['open', 'apply']);
    expect(f.map.size).toBe(0);
  });
  it('열기 중 원문·UID·버전이 다르면 현재 값으로 조용히 바꾸지 않고 실패한다', async () => {
    for (const patch of [{
      actorUid: 'uid-b'
    }, {
      expectedVersion: '123:7'
    }, {
      snapshot: quotationSnapshot({
        ...quotation,
        note: '외부 변경'
      })
    }]) {
      const f = fixture();
      f.command.mockImplementation(async command => command.mode === 'open' ? {
        reference: command.reference,
        actorUid: scope.actorUid,
        snapshot: quotationSnapshot(quotation),
        expectedVersion: '123:000000007',
        ...patch
      } : null);
      await expect(f.writer.capture(scope, quotation)).rejects.toThrow();
      expect(f.map.size).toBe(0);
      expect(f.command).toHaveBeenCalledTimes(1);
    }
  });
  it('create 원문은 첫 await 전에 고정하고 저장소 확인 실패면 apply0이며 남은 원문을 대체하지 않는다', async () => {
    const f = fixture(),
      wait = deferred<void>();
    f.port.assertScope = vi.fn(() => wait.promise);
    const mutable = {
      ...quotation,
      lines: quotation.lines.map(row => ({
        ...row
      }))
    };
    const preparing = f.writer.prepare(scope, {
      targetId: quotation.id,
      action: 'create',
      snapshot: mutable
    });
    mutable.partnerName = '나중값';
    mutable.lines[0].price = 999;
    wait.resolve();
    const prepared = await preparing;
    if (prepared.status !== 'ready') throw Error('준비 실패');
    const plan = f.writer.read(scope, prepared.reference);
    expect(JSON.stringify(plan.request.snapshot)).toContain('문의처');
    expect(JSON.stringify(plan.request.snapshot)).not.toContain('999');
    const bad = fixture(),
      get = bad.storage.getItem;
    let written = false;
    bad.storage.setItem = (key, value) => {
      bad.map.set(key, value);
      written = true;
    };
    bad.storage.getItem = key => written ? null : get(key);
    expect((await bad.writer.prepare(scope, {
      targetId: quotation.id,
      action: 'create',
      snapshot: quotation
    })).status).toBe('rejected');
    expect(bad.command).not.toHaveBeenCalled();
    bad.storage.getItem = get;
    expect(bad.writer.pending(scope)).toHaveLength(1);
    expect((await bad.writer.prepare(scope, {
      targetId: quotation.id,
      action: 'create',
      snapshot: quotation
    })).status).toBe('rejected');
  });
  it('응답 유실은 동일 보관 원문을 유지하고 inspect로만 확정하며 undefined 응답은 성공이 아니다', async () => {
    const f = fixture(),
      prepared = await f.writer.prepare(scope, {
        targetId: quotation.id,
        action: 'create',
        snapshot: quotation
      });
    if (prepared.status !== 'ready') throw Error('준비 실패');
    f.command.mockResolvedValueOnce(undefined);
    expect((await f.writer.run(scope, prepared.reference, 'apply')).status).toBe('unknown');
    expect(f.map.size).toBe(1);
    expect((await f.writer.run(scope, prepared.reference, 'inspect')).status).toBe('saved');
    expect(f.command.mock.calls.map(([c]) => c.mode)).toEqual(['apply', 'inspect']);
  });
  it('키와 본문 계획ID·해시 손상은 원문을 보존하고 명시 reference cancel만 허용한다', async () => {
    for (const mode of ['key', 'hash'] as const) {
      const f = fixture(),
        prepared = await f.writer.prepare(scope, {
          targetId: quotation.id,
          action: 'create',
          snapshot: quotation
        });
      if (prepared.status !== 'ready') throw Error('준비 실패');
      const key = [...f.map.keys()][0],
        plan = JSON.parse(f.map.get(key)!) as QuotationPlan;
      if (mode === 'key') { plan.request.reference.planId = '다른 계획'; plan.requestHash = createHash('sha256').update(serializeQuotationRequest(plan.request)).digest('hex'); } else plan.requestHash = 'a'.repeat(64);
      f.map.set(key, JSON.stringify(plan));
      expect((await f.writer.run(scope, prepared.reference, 'apply')).status).toBe('unknown');
      expect(f.command).not.toHaveBeenCalled();
      expect((await f.writer.run(scope, prepared.reference, 'cancel')).status).toBe('cancelled');
      expect(f.command.mock.calls[0][0]).toEqual({
        mode: 'cancel',
        reference: prepared.reference
      });
    }
  });
  it('없는 local 원문은 exact reference로 확인·중단하며 다른 손상 대상은 전역 차단하지 않는다', async () => {
    const f = fixture(),
      reference: QuotationReference = {
        companyId: 'taebaek',
        targetId: '삭제된 견적',
        planId: 'old'
      };
    f.command.mockResolvedValueOnce({
      version: 1,
      reference,
      actorUid: scope.actorUid,
      status: 'unknown',
      requestHash: null,
      message: '미확정'
    });
    expect((await f.writer.run(scope, reference, 'inspect')).status).toBe('unknown');
    expect((await f.writer.run(scope, reference, 'apply')).status).toBe('unknown');
    expect((await f.writer.run(scope, reference, 'cancel')).status).toBe('cancelled');
    f.map.set('tb_quotation_v1:taebaek:uid-a:other:broken', '{');
    expect((await f.writer.prepare(scope, {
      targetId: quotation.id,
      action: 'create',
      snapshot: quotation
    })).status).toBe('ready');
  });
  it('확정 거절과 cleanup 부분성공을 구별하고 late UID·잘못된 hash 응답은 ACK로 보지 않는다', async () => {
    const f = fixture(),
      p = await f.writer.prepare(scope, {
        targetId: quotation.id,
        action: 'create',
        snapshot: quotation
      });
    if (p.status !== 'ready') throw Error('준비 실패');
    const plan = f.writer.read(scope, p.reference);
    f.command.mockResolvedValueOnce({
      version: 1,
      reference: p.reference,
      actorUid: scope.actorUid,
      status: 'rejected',
      requestHash: plan.requestHash,
      message: '원문 버전 변경'
    });
    expect(await f.writer.run(scope, p.reference, 'apply')).toMatchObject({
      status: 'rejected',
      requiresReopen: true,
      message: '원문 버전 변경'
    });
    const g = fixture(),
      gp = await g.writer.prepare(scope, {
        targetId: quotation.id,
        action: 'create',
        snapshot: quotation
      });
    if (gp.status !== 'ready') throw Error('준비 실패');
    g.storage.removeItem = () => {
      throw Error('기기 오류');
    };
    expect(await g.writer.run(scope, gp.reference, 'apply')).toMatchObject({
      status: 'partial',
      committedIds: [quotation.id],
      unconfirmedIds: []
    });
    const h = fixture(),
      hp = await h.writer.prepare(scope, {
        targetId: quotation.id,
        action: 'create',
        snapshot: quotation
      });
    if (hp.status !== 'ready') throw Error('준비 실패');
    h.command.mockResolvedValueOnce({
      version: 1,
      reference: hp.reference,
      actorUid: 'uid-b',
      status: 'applied',
      requestHash: 'a'.repeat(64),
      message: '잘못된 응답'
    });
    expect((await h.writer.run(scope, hp.reference, 'apply')).status).toBe('unknown');
    expect(h.map.size).toBe(1);
  });
  it('줄의 미지 Timestamp·배열은 CatalogValue를 거쳐도 보존한다', async () => {
    const f = fixture(),
      stamp = new Timestamp(100, 7),
      row = {
        ...quotation,
        lines: [{
          ...quotation.lines[0],
          legacy: {
            stamp,
            values: [1, {
              keep: true
            }]
          }
        }]
      };
    f.command.mockImplementation(async command => command.mode === 'open' ? {
      reference: command.reference,
      actorUid: scope.actorUid,
      snapshot: quotationSnapshot(row, {
        special: value => value instanceof Timestamp ? ['timestamp', value.seconds, value.nanoseconds] : undefined
      }),
      expectedVersion: '123:000000007'
    } : null);
    const opening = await f.writer.capture(scope, row),
      decoded = quotationFromOpening(opening),
      legacy = (decoded.lines[0] as unknown as {
        legacy: {
          stamp: Timestamp;
          values: unknown[];
        };
      }).legacy;
    expect(legacy.stamp.isEqual(stamp)).toBe(true);
    expect(legacy.values).toEqual([1, {
      keep: true
    }]);
  });
  it('기존 createdAt·line.spec 누락은 열기와 삭제를 막지 않고 저장 검증에서만 거절한다', async () => {
    const f = fixture(),
      legacy = {
        ...quotation,
        lines: [{
          name: '옛 품목',
          qty: 1,
          price: 1,
          isTaxExempt: true
        }]
      } as unknown as Quotation;
    delete (legacy as Partial<Quotation>).createdAt;
    f.command.mockImplementation(async command => command.mode === 'open' ? {
      reference: command.reference,
      actorUid: scope.actorUid,
      snapshot: quotationSnapshot(legacy),
      expectedVersion: '123:000000007'
    } : null);
    const opening = await f.writer.capture(scope, legacy);
    expect(quotationFromOpening(opening)).not.toHaveProperty('createdAt');
    expect((await f.writer.prepare(scope, {
      targetId: legacy.id,
      action: 'update',
      opening,
      snapshot: legacy
    })).status).toBe('rejected');
    expect((await f.writer.prepare(scope, {
      targetId: legacy.id,
      action: 'delete',
      opening
    })).status).toBe('ready');
    expect(f.command.mock.calls.map(([c]) => c.mode)).toEqual(['open']);
  });
});
