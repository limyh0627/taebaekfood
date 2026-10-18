import { describe, it, expect, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
vi.mock('../firebase', () => ({
  auth: {},
  authReady: Promise.resolve(),
  functions: {}
}));
import { createDirectoryDeleteWriter, type DirectoryDeleteWritePort, type DirectoryDeletePlan } from './directoryDeleteWrites';
import { serializeDirectoryDeleteRequest, type DirectoryDeleteReference, type DirectoryDeleteCommand } from '../directoryDeleteCommand';
Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
  configurable: true
});
const scope = {
  companyId: 'taebaek' as const,
  actorUid: 'actor'
};
const input = {
  kind: 'partner' as const,
  targetId: 'partner-a',
  opening: {
    name: '원거래처',
    companyId: 'taebaek'
  }
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
  const command = vi.fn(async (cmd: DirectoryDeleteCommand): Promise<unknown> => {
    if (cmd.mode === 'preview') return {
      reference: cmd.reference,
      actorUid: scope.actorUid,
      opening: cmd.opening,
      expectedVersion: '123:000000007'
    };
    const reference = cmd.mode === 'apply' ? cmd.request.reference : cmd.reference;
    return {
      version: 1,
      reference,
      actorUid: scope.actorUid,
      status: cmd.mode === 'cancel' ? 'cancelled' : 'applied',
      requestHash: cmd.mode === 'apply' ? createHash('sha256').update(serializeDirectoryDeleteRequest(cmd.request)).digest('hex') : cmd.requestHash ?? null,
      message: '결과 확인'
    };
  });
  const port: DirectoryDeleteWritePort = {
    storage,
    command,
    assertScope: vi.fn(async () => {}),
    exclusive: async (_s, _id, work) => work(),
    id: () => 'plan-a'
  };
  return {
    map,
    storage,
    command,
    port,
    writer: createDirectoryDeleteWriter(port)
  };
}
describe('삭제 고정 원문·복구 저장 경계', () => {
  it('읽기 전용 preview 뒤 원문을 영속하고 명시 confirm에서만 삭제를 보낸다', async () => {
    const f = fixture(),
      result = await f.writer.prepare(scope, input);
    expect(result.status).toBe('ready');
    expect(f.command.mock.calls.map(([c]) => c.mode)).toEqual(['preview']);
    expect(f.writer.pending(scope)[0].description).toContain('원거래처');
    const stored = JSON.parse([...f.map.values()][0]) as DirectoryDeletePlan;
    expect(stored.request.expectedVersion).toBe('123:000000007');
    expect((await f.writer.run(scope, 'reference' in result ? result.reference : (() => {
      throw Error('준비 실패');
    })(), 'apply')).status).toBe('saved');
    expect(f.map.size).toBe(0);
  });
  it('선택 원문은 첫 await 전에 고정하고 preview scope·버전 불일치는 삭제를 보내지 않는다', async () => {
    const f = fixture(),
      wait = deferred<void>();
    f.port.assertScope = vi.fn(() => wait.promise);
    const mutable = {
        ...input,
        opening: {
          ...input.opening
        }
      },
      pending = f.writer.prepare(scope, mutable);
    mutable.opening.name = '변경';
    wait.resolve();
    await pending;
    const call = f.command.mock.calls[0][0];
    expect(call.mode).toBe('preview');
    if (call.mode === 'preview') expect(JSON.stringify(call.opening)).toContain('원거래처');
    const bad = fixture();
    bad.command.mockImplementation(async cmd => cmd.mode === 'preview' ? {
      reference: cmd.reference,
      actorUid: 'other',
      opening: cmd.opening,
      expectedVersion: '123:7'
    } : null);
    expect((await bad.writer.prepare(scope, input)).status).toBe('rejected');
    expect(bad.map.size).toBe(0);
    expect(bad.command).toHaveBeenCalledTimes(1);
  });
  it('저장소 readback 실패는 삭제 미전송으로 반환하고 남은 원문을 새 요청으로 대체하지 않는다', async () => {
    const f = fixture();
    const original = f.storage.getItem;
    let writes = false;
    f.storage.setItem = (key, value) => {
      f.map.set(key, value);
      writes = true;
    };
    f.storage.getItem = key => writes ? null : original(key);
    expect((await f.writer.prepare(scope, input)).status).toBe('rejected');
    expect(f.command.mock.calls.map(([c]) => c.mode)).toEqual(['preview']);
    f.storage.getItem = original;
    expect(f.writer.pending(scope)).toHaveLength(1);
    expect((await f.writer.prepare(scope, input)).status).toBe('rejected');
    expect(f.command).toHaveBeenCalledTimes(1);
  });
  it('응답 유실은 원문을 유지하고 같은 ref inspect만 보내며 void를 완료로 판단하지 않는다', async () => {
    const f = fixture(),
      result = await f.writer.prepare(scope, input);
    f.command.mockResolvedValueOnce(undefined);
    expect((await f.writer.run(scope, 'reference' in result ? result.reference : (() => {
      throw Error('준비 실패');
    })(), 'apply')).status).toBe('unknown');
    expect(f.map.size).toBe(1);
    expect((await f.writer.run(scope, 'reference' in result ? result.reference : (() => {
      throw Error('준비 실패');
    })(), 'inspect')).status).toBe('saved');
    expect(f.command.mock.calls.map(([c]) => c.mode)).toEqual(['preview', 'apply', 'inspect']);
  });
  it('잘못된 key본문·해시는 보존하고 명시 중단만 reference-only로 보낸다', async () => {
    const f = fixture(),
      result = await f.writer.prepare(scope, input),
      key = [...f.map.keys()][0],
      plan = JSON.parse(f.map.get(key)!) as DirectoryDeletePlan;
    plan.request.reference.planId = 'other-plan';
    f.map.set(key, JSON.stringify(plan));
    expect(f.writer.references(scope)[0].readable).toBe(false);
    expect((await f.writer.run(scope, 'reference' in result ? result.reference : (() => {
      throw Error('준비 실패');
    })(), 'inspect')).status).toBe('unknown');
    expect(f.command).toHaveBeenCalledTimes(1);
    expect((await f.writer.run(scope, 'reference' in result ? result.reference : (() => {
      throw Error('준비 실패');
    })(), 'cancel')).status).toBe('cancelled');
    expect(f.command.mock.calls.at(-1)![0]).toEqual({
      mode: 'cancel',
      reference: result.reference
    });
  });
  it('로컬 원문 부재도 정확 ref 조회·중단만 가능하며 다른 대상 손상은 전역 차단하지 않는다', async () => {
    const f = fixture(),
      ref: DirectoryDeleteReference = {
        companyId: 'taebaek',
        kind: 'employee',
        targetId: 'missing',
        planId: 'missing-plan'
      };
    f.command.mockResolvedValueOnce({
      version: 1,
      reference: ref,
      actorUid: scope.actorUid,
      status: 'unknown',
      requestHash: null,
      message: '미확정'
    });
    expect((await f.writer.run(scope, ref, 'inspect')).status).toBe('unknown');
    expect((await f.writer.run(scope, ref, 'apply')).status).toBe('unknown');
    f.map.set('tb_directory_delete_v1:taebaek:actor:partner:other:broken', '{');
    expect((await f.writer.prepare(scope, input)).status).toBe('ready');
  });
  it('서버 거절 원인과 정리실패의 업무 ACK를 구별하며 계정 교체 응답은 성공이 아니다', async () => {
    const f = fixture(),
      prepared = await f.writer.prepare(scope, input),
      ref = 'reference' in prepared ? prepared.reference : (() => {
        throw Error('준비 실패');
      })(),
      plan = f.writer.read(scope, ref);
    f.command.mockResolvedValueOnce({
      version: 1,
      reference: ref,
      actorUid: scope.actorUid,
      status: 'rejected',
      requestHash: plan.requestHash,
      message: '버전 변경'
    });
    expect(await f.writer.run(scope, ref, 'apply')).toMatchObject({
      status: 'rejected',
      message: '버전 변경',
      requiresReopen: true
    });
    const g = fixture(),
      p = await g.writer.prepare(scope, input);
    g.storage.removeItem = () => {
      throw Error('기기 실패');
    };
    expect(await g.writer.run(scope, 'reference' in p ? p.reference : (() => {
      throw Error('준비 실패');
    })(), 'apply')).toMatchObject({
      status: 'partial',
      committedIds: [input.targetId],
      unconfirmedIds: []
    });
    const h = fixture(),
      hp = await h.writer.prepare(scope, input);
    h.port.assertScope = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValue(Error('UID교체'));
    expect((await h.writer.run(scope, 'reference' in hp ? hp.reference : (() => {
      throw Error('준비 실패');
    })(), 'apply')).status).toBe('unknown');
    expect(h.map.size).toBe(1);
  });
  it('preview 뒤 scope 변경은 영속·apply0이고 해시 손상은 같은 원문을 보존한다', async () => {
    const changed = fixture();
    changed.port.assertScope = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(Error('화면 변경'));
    expect((await changed.writer.prepare(scope, input)).status).toBe('rejected');
    expect(changed.map.size).toBe(0);
    expect(changed.command.mock.calls.map(([c]) => c.mode)).toEqual(['preview']);
    const f = fixture(),
      prepared = await f.writer.prepare(scope, input);
    if (prepared.status !== 'ready') throw Error('준비 실패');
    const key = [...f.map.keys()][0],
      body = JSON.parse(f.map.get(key)!) as DirectoryDeletePlan;
    body.request.expectedVersion = '124:000000007';
    const changedText = JSON.stringify(body);
    f.map.set(key, changedText);
    expect((await f.writer.run(scope, prepared.reference, 'apply')).status).toBe('unknown');
    expect(f.command).toHaveBeenCalledTimes(1);
    expect(f.map.get(key)).toBe(changedText);
    const bad = fixture(),
      ready = await bad.writer.prepare(scope, input);
    if (ready.status !== 'ready') throw Error('준비 실패');
    bad.command.mockResolvedValueOnce({
      version: 1,
      reference: ready.reference,
      actorUid: '다른계정',
      status: 'applied',
      requestHash: bad.writer.read(scope, ready.reference).requestHash,
      message: '확인'
    });
    expect((await bad.writer.run(scope, ready.reference, 'apply')).status).toBe('unknown');
    expect(bad.map.size).toBe(1);
  });
});
