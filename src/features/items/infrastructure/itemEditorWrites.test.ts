import { beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
const sdk = vi.hoisted(() => ({
  query: vi.fn(),
  call: vi.fn(),
  auth: {
    currentUser: {
      uid: 'actor',
      getIdTokenResult: vi.fn(async () => ({
        claims: {
          companyId: 'taebaek',
          employeeId: 'emp'
        }
      }))
    }
  }
}));
vi.mock('../../../shared/firebase', () => ({
  auth: sdk.auth,
  authReady: Promise.resolve(),
  db: {},
  functions: {}
}));
vi.mock('firebase/functions', () => ({
  httpsCallable: () => sdk.call
}));
vi.mock('firebase/firestore', async original => ({
  ...(await original<typeof import('firebase/firestore')>()),
  collection: (_db: unknown, name: string) => name,
  where: (field: string, op: string, value: string) => ({
    field,
    op,
    value
  }),
  query: (name: string, condition: unknown) => ({
    name,
    condition
  }),
  getDocsFromServer: sdk.query
}));
import { createItemEditorWriter, captureItemEditorOpening, itemEditorOpeningMatches, createPendingItemEditorProgress, type ItemEditorWritePort, type ItemEditorScope, type ItemEditorSaveInput } from './itemEditorWrites';
import { createItemEditorProgress } from '../application/itemEditorSave';
import { ITEM_EDITOR_STAGES, serializeItemEditorRequest, type ItemEditorCommand, type ItemEditorDraft, type ItemEditorGraphDocuments, type ItemEditorReference, type ItemEditorResult } from '../../../shared/itemEditorCommand';
const scope: ItemEditorScope = {
  companyId: 'taebaek',
  actorUid: 'actor'
};
const documents = (): ItemEditorGraphDocuments => ({
  items: [{
    id: 'item',
    data: {
      companyId: 'taebaek',
      name: '품목',
      type: 'product',
      cost: 0,
      costSource: 'manual',
      image: 'url',
      imagePath: 'companies/taebaek/items/item/photo.png'
    }
  }],
  boms: [],
  formulas: [],
  links: []
});
const draft = (): ItemEditorDraft => ({
  isNew: false,
  metadata: {
    name: '수정 품목',
    type: 'product',
    cost: 0,
    costSource: 'manual',
    image: 'url',
    imagePath: 'companies/taebaek/items/item/photo.png'
  },
  bomDraft: [],
  inPartnerIds: [],
  photoChanged: false
});
const hash = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(n => n.toString(16).padStart(2, '0')).join('');
let memory: Map<string, string>, port: ItemEditorWritePort, receipts: Map<string, ItemEditorResult>, sequence: number;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('crypto', webcrypto);
  memory = new Map();
  receipts = new Map();
  sequence = 0;
  port = {
    storage: {
      get length() {
        return memory.size;
      },
      key: i => [...memory.keys()][i] ?? null,
      getItem: key => memory.get(key) ?? null,
      setItem: (key, value) => {
        memory.set(key, value);
      },
      removeItem: key => {
        memory.delete(key);
      }
    },
    assertScope: vi.fn(async () => {}),
    fetchGraph: vi.fn(async () => documents()),
    exclusive: async (_scope, _target, work) => work(),
    id: () => `plan-${++sequence}`,
    command: vi.fn(async command => {
      const ref = command.mode === 'apply' ? command.request : command.reference,
        key = ref.planId;
      let row = receipts.get(key);
      if (command.mode === 'apply') {
        if (row?.status === 'cancelled' || row?.status === 'completed') return row;
        const confirmed = [...(row?.confirmedStageIds ?? [])];
        const index = ITEM_EDITOR_STAGES.indexOf(command.stage);
        if (index === confirmed.length) confirmed.push(command.stage);
        row = {
          companyId: ref.companyId,
          targetId: ref.targetId,
          planId: ref.planId,
          actorUid: 'actor',
          status: confirmed.length === 5 ? 'completed' : 'active',
          confirmedStageIds: confirmed,
          requestHash: await hash(serializeItemEditorRequest(command.request)),
          message: ''
        };
        receipts.set(key, row);
        return row;
      }
      if (command.mode === 'cancel' && row?.status !== 'completed') {
        row = {
          companyId: ref.companyId,
          targetId: ref.targetId,
          planId: ref.planId,
          actorUid: 'actor',
          status: 'cancelled',
          requestHash: row?.requestHash ?? null,
          confirmedStageIds: row?.confirmedStageIds ?? [],
          message: '남은 단계 중단'
        };
        receipts.set(key, row);
      }
      return row ?? {
        companyId: ref.companyId,
        targetId: ref.targetId,
        planId: ref.planId,
        actorUid: 'actor',
        status: 'unknown',
        requestHash: null,
        confirmedStageIds: [],
        message: '아직 확인되지 않음'
      };
    })
  };
});
async function setup() {
  const service = createItemEditorWriter(port),
    opening = await service.capture(scope, 'item', () => true),
    input: ItemEditorSaveInput = {
      opening,
      draft: draft()
    },
    progress = createItemEditorProgress('item');
  return {
    service,
    opening,
    input,
    progress
  };
}
it('실SDK server query 네개와 doc identity/body id를 구분하여 최초 snapshot만 캡처한다', async () => {
  vi.stubGlobal('localStorage', port.storage);
  sdk.query.mockImplementation(async ({
    name
  }: {
    name: string;
  }) => ({
    docs: name === 'items' ? [{
      id: 'item',
      data: () => documents().items[0].data
    }, {
      id: 'other',
      data: () => ({
        id: 'legacy-other',
        companyId: 'taebaek',
        name: '기타',
        type: 'raw'
      })
    }] : []
  }));
  const opening = await captureItemEditorOpening(scope, 'item', () => true);
  expect(sdk.query).toHaveBeenCalledTimes(4);
  expect(sdk.query.mock.calls.map(call => call[0])).toEqual(expect.arrayContaining(['items', 'item_bom', 'item_formula', 'partner_item'].map(name => ({
    name,
    condition: {
      field: 'companyId',
      op: '==',
      value: 'taebaek'
    }
  }))));
  expect(opening.documents.items[0].data).not.toHaveProperty('id');
  expect(opening.documents.items[1]).toMatchObject({
    id: 'other',
    data: {
      id: 'legacy-other'
    }
  });
  expect(opening.graph.items.count).toBe(2);
});
it('선택한 target의 body id 충돌만 거절하고 다른 graph행은 전체 차단하지 않는다', async () => {
  const data = documents();
  data.items.push({
    id: 'other',
    data: {
      id: 'mismatch',
      companyId: 'taebaek',
      name: '다른 품목',
      type: 'raw'
    }
  });
  port.fetchGraph = async () => data;
  const service = createItemEditorWriter(port);
  await expect(service.capture(scope, 'item', () => true)).resolves.toMatchObject({
    targetId: 'item'
  });
  data.items[0].data.id = 'wrong';
  await expect(service.capture(scope, 'item', () => true)).rejects.toThrow('문서 번호');
});
it('선택 화면 메타데이터가 달라지면 조용히 최신화하지 않고 불일치로 표시한다', async () => {
  const {
    opening
  } = await setup();
  const selected = {
    id: 'item',
    ...opening.target!
  } as Parameters<typeof itemEditorOpeningMatches>[0];
  expect(itemEditorOpeningMatches(selected, opening)).toBe(true);
  expect(itemEditorOpeningMatches({
    ...selected!,
    name: '옛 이름'
  }, opening)).toBe(false);
});
it('네 query의 일부 실패와 UID 전환은 opening 증거를 만들지 않는다', async () => {
  port.fetchGraph = async () => {
    throw Error('query 실패');
  };
  await expect(createItemEditorWriter(port).capture(scope, 'item', () => true)).rejects.toThrow('query 실패');
  let current = true;
  port.fetchGraph = async () => {
    current = false;
    return documents();
  };
  await expect(createItemEditorWriter(port).capture(scope, 'item', () => current)).rejects.toThrow('편집 화면');
  expect(port.command).not.toHaveBeenCalled();
});
it('영속 원문 readback 이후 동일 plan만 다섯 단계에 전달하고 전체 ACK만 saved다', async () => {
  const {
    service,
    input,
    progress
  } = await setup();
  const result = await service.submit(scope, input, progress, () => true);
  expect(result.outcome.status).toBe('saved');
  expect(progress.confirmedStageIds).toEqual([...ITEM_EDITOR_STAGES]);
  expect(port.command).toHaveBeenCalledTimes(5);
  const commands = vi.mocked(port.command).mock.calls.map(([command]) => command);
  expect(commands.map(c => c.mode === 'apply' ? c.stage : null)).toEqual([...ITEM_EDITOR_STAGES]);
  expect(new Set(commands.map(c => c.mode === 'apply' ? serializeItemEditorRequest(c.request) : '')).size).toBe(1);
  expect(memory.size).toBe(0);
});
it('원문 저장 또는 재읽기 확인 실패는 서버0이며 남은 entry는 새 요청 생성보다 복구를 우선한다', async () => {
  const {
    service,
    input,
    progress
  } = await setup();
  const original = port.storage.getItem;
  let once = true;
  port.storage.getItem = key => {
    if (once && memory.has(key)) {
      once = false;
      throw Error('readback');
    }
    return original(key);
  };
  expect((await service.submit(scope, input, progress, () => true)).outcome.status).toBe('rejected');
  expect(port.command).not.toHaveBeenCalled();
  expect(memory.size).toBe(1);
  expect((await service.submit(scope, input, progress, () => true)).outcome.status).toBe('rejected');
  expect(memory.size).toBe(1);
  expect(port.command).not.toHaveBeenCalled();
});
it('응답 유실 뒤 refresh inspect는 쓰기0이고 명시 continue만 미완료 단계를 보낸다', async () => {
  const {
      service,
      input,
      progress
    } = await setup(),
    remote = port.command;
  let lose = true;
  port.command = vi.fn(async command => {
    const result = await remote(command);
    if (command.mode === 'apply' && command.stage === 'bom-cost' && lose) {
      lose = false;
      throw Error('lost ACK');
    }
    return result;
  });
  expect((await service.submit(scope, input, progress, () => true)).outcome.status).toBe('partial');
  expect(progress.confirmedStageIds).toEqual(['primary']);
  const plan = service.pending(scope)[0],
    restored = createPendingItemEditorProgress(plan);
  expect(JSON.stringify(plan)).toContain('photo.png');
  const before = vi.mocked(port.command).mock.calls.length;
  expect((await service.resolve(scope, plan.reference, restored, () => true, 'inspect')).serverStatus).toBe('active');
  expect(vi.mocked(port.command).mock.calls.length).toBe(before + 1);
  expect(restored.confirmedStageIds).toEqual(['primary', 'bom-cost']);
  expect((await service.execute(scope, plan.reference, restored, () => true)).outcome.status).toBe('saved');
  const applied = vi.mocked(port.command).mock.calls.map(([c]) => c).filter(c => c.mode === 'apply');
  expect(applied.map(c => c.stage)).toEqual([...ITEM_EDITOR_STAGES]);
});
it('명시 continue는 inspect 부재를 미저장으로 단정하지 않고 최초 plan만 재사용한다', async () => {
  const {
      service,
      input
    } = await setup(),
    plan = await service.prepare(scope, input, () => true);
  const progress = createPendingItemEditorProgress(plan);
  expect((await service.execute(scope, plan.reference, progress, () => true)).outcome.status).toBe('saved');
  expect(vi.mocked(port.command).mock.calls[0][0]).toEqual({
    mode: 'inspect',
    reference: plan.reference,
    requestHash: plan.requestHash
  });
  expect(vi.mocked(port.command).mock.calls.filter(([c]) => c.mode === 'apply').every(([c]) => c.mode === 'apply' && c.request.planId === plan.reference.planId)).toBe(true);
});
it('잘못된 actor·hash·단계 응답은 ACK/삭제/다음 apply로 이어지지 않는다', async () => {
  for (const bad of ['actor', 'hash', 'prefix']) {
    const {
      service,
      input,
      progress
    } = await setup();
    port.command = vi.fn(async command => {
      const ref = command.mode === 'apply' ? command.request : command.reference;
      return {
        companyId: ref.companyId,
        targetId: ref.targetId,
        planId: ref.planId,
        actorUid: bad === 'actor' ? 'foreign' : 'actor',
        status: 'active',
        requestHash: bad === 'hash' ? 'f'.repeat(64) : await hash(command.mode === 'apply' ? serializeItemEditorRequest(command.request) : ''),
        confirmedStageIds: bad === 'prefix' ? ['formula'] : ['primary'],
        message: ''
      };
    });
    expect((await service.submit(scope, input, progress, () => true)).outcome.status).toBe('unknown');
    expect(port.command).toHaveBeenCalledOnce();
    expect(memory.size).toBe(1);
    memory.clear();
  }
});
it('다른 품목의 손상 entry는 새 품목을 막지 않고 같은 품목만 복구를 요구한다', async () => {
  const {
      service,
      input
    } = await setup(),
    plan = await service.prepare(scope, input, () => true),
    key = [...memory.keys()][0];
  memory.set(key, '{bad');
  expect(service.references(scope)[0]).toMatchObject({
    reference: plan.reference,
    readable: false
  });
  const other = {
    ...input,
    opening: {
      ...input.opening,
      targetId: 'other',
      target: null,
      targetExpected: null
    },
    draft: {
      ...input.draft,
      isNew: true
    }
  };
  await expect(service.prepare(scope, other, () => true)).resolves.toMatchObject({
    request: {
      targetId: 'other'
    }
  });
  await expect(service.prepare(scope, input, () => true)).rejects.toThrow('보관 요청');
});
it('키·본문 번호 불일치 또는 hash손상은 새 apply0이며 ref cancel로만 종결한다', async () => {
  const {
      service,
      input
    } = await setup(),
    plan = await service.prepare(scope, input, () => true),
    key = [...memory.keys()][0],
    value = JSON.parse(memory.get(key)!);
  value.request.planId = 'wrong-plan';
  memory.set(key, JSON.stringify(value));
  expect(service.references(scope)[0].readable).toBe(false);
  const progress = createPendingItemEditorProgress(plan);
  expect((await service.execute(scope, plan.reference, progress, () => true)).outcome.status).toBe('unknown');
  expect(vi.mocked(port.command).mock.calls.some(([c]) => c.mode === 'apply')).toBe(false);
  expect((await service.resolve(scope, plan.reference, progress, () => true, 'cancel')).outcome.status).toBe('cancelled');
  expect(port.command).toHaveBeenLastCalledWith({
    mode: 'cancel',
    reference: plan.reference
  });
  expect(memory.size).toBe(0);
});
it('중간 cancel은 완료 단계는 유지하고 같은 plan의 남은 쓰기만 봉쇄한다', async () => {
  const {
      service,
      input
    } = await setup(),
    plan = await service.prepare(scope, input, () => true),
    progress = createPendingItemEditorProgress(plan);
  await service.resolve(scope, plan.reference, progress, () => true, 'apply', 'primary');
  const cancelled = await service.resolve(scope, plan.reference, progress, () => true, 'cancel');
  expect(cancelled.outcome.status).toBe('cancelled');
  expect(progress.confirmedStageIds).toEqual(['primary']);
  expect(progress.terminalStatus).toBe('cancelled');
  expect((await service.execute(scope, plan.reference, progress, () => true)).outcome.status).toBe('cancelled');
  expect(vi.mocked(port.command).mock.calls.filter(([c]) => c.mode === 'apply')).toHaveLength(1);
});
it('다른 탭이 먼저 보관본을 정리했어도 완료 ACK를 업무 미확정으로 바꾸지 않는다', async () => {
  const {
      service,
      input,
      progress
    } = await setup(),
    remote = port.command;
  port.command = vi.fn(async command => {
    const result = await remote(command);
    if ((result as ItemEditorResult).status === 'completed') memory.clear();
    return result;
  });
  expect((await service.submit(scope, input, progress, () => true)).outcome.status).toBe('saved');
});
it('기존 4차 unknown 진행표를 새 서버 계획으로 자동 승격하지 않는다', async () => {
  const {
    service,
    input,
    progress
  } = await setup();
  progress.unknownStageId = 'primary';
  expect((await service.submit(scope, input, progress, () => true)).outcome.status).toBe('unknown');
  expect(port.command).not.toHaveBeenCalled();
  expect(memory.size).toBe(0);
});
it('보관 조회 실패와 현재 scope 종료는 다음 단계 전송을 만들지 않는다', async () => {
  const {
    service,
    input,
    progress
  } = await setup();
  port.storage.getItem = () => {
    throw Error('storage denied');
  };
  expect((await service.submit(scope, input, progress, () => true)).outcome.status).toBe('rejected');
  expect(port.command).not.toHaveBeenCalled();
});
it('continue의 손상된 inspect 응답을 부재로 간주해 apply하지 않는다', async () => {
  const {
      service,
      input
    } = await setup(),
    plan = await service.prepare(scope, input, () => true),
    progress = createPendingItemEditorProgress(plan);
  port.command = vi.fn(async () => ({
    companyId: 'taebaek',
    planId: plan.reference.planId,
    targetId: 'item',
    actorUid: 'foreign',
    status: 'unknown',
    requestHash: null,
    confirmedStageIds: [],
    message: ''
  }));
  expect((await service.execute(scope, plan.reference, progress, () => true)).outcome.status).toBe('unknown');
  expect(port.command).toHaveBeenCalledOnce();
  expect(vi.mocked(port.command).mock.calls[0][0].mode).toBe('inspect');
  expect(memory.size).toBe(1);
});
it('늦은 ACK 뒤 회사나 편집 세대가 바뀌면 다음 단계와 로컬 원문 삭제를 시작하지 않는다', async () => {
  const {
      service,
      input,
      progress
    } = await setup(),
    remote = port.command;
  let current = true;
  port.command = vi.fn(async command => {
    const result = await remote(command);
    current = false;
    return result;
  });
  expect((await service.submit(scope, input, progress, () => current)).outcome.status).toBe('unknown');
  expect(port.command).toHaveBeenCalledOnce();
  expect(memory.size).toBe(1);
  expect(progress.confirmedStageIds).toEqual([]);
});
it('같은 원문 hash가 맞지 않으면 inspect는 reference 조회만 하고 continue 전송은 차단한다', async () => {
  const {
      service,
      input
    } = await setup(),
    plan = await service.prepare(scope, input, () => true),
    key = [...memory.keys()][0],
    body = JSON.parse(memory.get(key)!);
  body.request.draft.metadata.name = '변경된 원문';
  memory.set(key, JSON.stringify(body));
  const progress = createPendingItemEditorProgress(plan);
  expect((await service.execute(scope, plan.reference, progress, () => true)).outcome.status).toBe('unknown');
  expect(port.command).toHaveBeenCalledExactlyOnceWith({
    mode: 'inspect',
    reference: plan.reference
  });
  expect(memory.size).toBe(1);
});
it('정규화된 ACK 이후 다른 원문이 같은 키에 들어오면 삭제하지 않고 완료 사실은 보존한다', async () => {
  const {
      service,
      input,
      progress
    } = await setup(),
    remote = port.command;
  port.command = vi.fn(async command => {
    const result = await remote(command);
    if ((result as ItemEditorResult).status === 'completed') {
      const key = [...memory.keys()][0];
      memory.set(key, '다른 원문');
    }
    return result;
  });
  expect((await service.submit(scope, input, progress, () => true)).outcome).toMatchObject({
    status: 'partial',
    committedIds: ['item'],
    message: expect.stringContaining('모든 단계는 완료')
  });
  expect([...memory.values()]).toEqual(['다른 원문']);
});
