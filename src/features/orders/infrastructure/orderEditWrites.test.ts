import { beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
vi.mock('../../../shared/firebase', () => ({
  auth: {
    currentUser: null
  },
  authReady: Promise.resolve(),
  functions: {}
}));
import { createOrderEditWriter, type OrderEditWritePort } from './orderEditWrites';
import { serializeOrderEditRequest, type OrderEditCommand } from '../../../shared/orderEditCommand';
import { OrderStatus, type Order } from '../../../shared/types';
const scope = {
  companyId: 'taebaek' as const,
  actorUid: 'actor'
};
const opening: Order = {
  id: 'order',
  companyId: 'taebaek',
  partnerName: '거래처',
  items: [{
    itemId: 'oil',
    lineId: 'line',
    name: '기름',
    quantity: 1,
    price: 100
  }],
  totalAmount: 100,
  status: OrderStatus.PENDING,
  createdAt: '2026-10-18',
  deliveryDate: '2026-10-18',
  email: '',
  source: '일반'
};
const edit = {
  kind: 'items' as const,
  items: opening.items
};
let map: Map<string, string>, port: OrderEditWritePort;
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  map = new Map();
  port = {
    storage: {
      get length() {
        return map.size;
      },
      key: i => [...map.keys()][i] ?? null,
      getItem: k => map.get(k) ?? null,
      setItem: (k, v) => {
        map.set(k, v);
      },
      removeItem: k => {
        map.delete(k);
      }
    },
    assertScope: vi.fn(async () => {}),
    exclusive: async (_s, _t, work) => work(),
    id: () => 'plan-1',
    command: vi.fn(async () => {
      throw Error('unknown');
    })
  };
});
async function result(command: OrderEditCommand, status = 'applied') {
  const reference = command.mode === 'apply' ? command.request : command.reference;
  const requestHash = command.mode === 'apply' ? [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serializeOrderEditRequest(command.request))))].map(n => n.toString(16).padStart(2, '0')).join('') : null;
  return {
    companyId: reference.companyId,
    planId: reference.planId,
    targetId: reference.targetId,
    actorUid: 'actor',
    status,
    requestHash,
    message: ''
  };
}
it('최초 opening 원문을 고정하고 ACK는 주문과 감사의 단일 명령만 보낸다', async () => {
  const service = createOrderEditWriter(port),
    source = structuredClone(opening),
    plan = await service.prepare(scope, source, edit, false);
  const before = serializeOrderEditRequest(plan.request);
  source.note = '나중값';
  vi.mocked(port.command).mockImplementation(c => result(c));
  expect(await service.run(scope, {
    companyId: plan.request.companyId,
    planId: plan.request.planId,
    targetId: plan.request.targetId
  }, 'apply')).toEqual({
    status: 'saved'
  });
  expect(port.command).toHaveBeenCalledOnce();
  expect(serializeOrderEditRequest(plan.request)).toBe(before);
  expect(map.size).toBe(0);
});
it('같은 주문 unknown은 새 계획으로 덮지 않고 다른 주문은 허용한다', async () => {
  let n = 0;
  port.id = () => `plan-${++n}`;
  const service = createOrderEditWriter(port),
    plan = await service.prepare(scope, opening, edit, false);
  expect((await service.run(scope, {
    companyId: plan.request.companyId,
    planId: plan.request.planId,
    targetId: plan.request.targetId
  }, 'apply')).status).toBe('unknown');
  await expect(service.prepare(scope, opening, edit, false)).rejects.toThrow('보관 요청');
  await service.prepare(scope, {
    ...opening,
    id: 'other'
  }, edit, false);
  expect(map.size).toBe(2);
});
it('저장소 기록 또는 재읽기 실패는 command 전에 거절한다', async () => {
  port.storage.setItem = () => {
    throw Error('quota');
  };
  const service = createOrderEditWriter(port);
  await expect(service.prepare(scope, opening, edit, false)).rejects.toThrow('quota');
  expect(port.command).not.toHaveBeenCalled();
});
it('다른 target·hash의 응답은 ACK로 삼지 않고 최초 원문을 유지한다', async () => {
  const service = createOrderEditWriter(port),
    plan = await service.prepare(scope, opening, edit, false);
  const original = [...map.values()][0];
  vi.mocked(port.command).mockImplementation(async c => ({
    ...(await result(c)),
    targetId: 'different'
  }));
  expect((await service.run(scope, {
    companyId: plan.request.companyId,
    planId: plan.request.planId,
    targetId: plan.request.targetId
  }, 'apply')).status).toBe('unknown');
  expect([...map.values()][0]).toBe(original);
});
it('손상 JSON은 apply를 막고 같은 키의 참조 조회와 중단을 보낸다', async () => {
  const service = createOrderEditWriter(port),
    plan = await service.prepare(scope, opening, edit, false),
    key = [...map.keys()][0];
  map.set(key, '{broken');
  expect((await service.run(scope, {
    companyId: plan.request.companyId,
    planId: plan.request.planId,
    targetId: plan.request.targetId
  }, 'inspect')).status).toBe('unknown');
  expect(port.command).toHaveBeenCalledWith({mode:'inspect',reference:{companyId:'taebaek',planId:'plan-1',targetId:'order'}});
  vi.mocked(port.command).mockImplementation(c => result(c, 'cancelled'));
  expect((await service.run(scope, {
    companyId: plan.request.companyId,
    planId: plan.request.planId,
    targetId: plan.request.targetId
  }, 'cancel')).status).toBe('rejected');
  expect(port.command).toHaveBeenCalledWith({
    mode: 'cancel',
    reference: {
      companyId: 'taebaek',
      planId: 'plan-1',
      targetId: 'order'
    }
  });
  expect(map.get(key)).toBe('{broken');
  expect(await service.discardCopy(scope, {companyId: 'taebaek', planId: 'plan-1', targetId: 'order'}, '{broken')).toEqual({status: 'saved'});
  expect(map.size).toBe(0);
});
it('키와 본문 계획 번호 불일치는 보존하고 손상 참조로 표시한다', async () => {
  const service = createOrderEditWriter(port),
    plan = await service.prepare(scope, opening, edit, false),
    key = [...map.keys()][0];
  map.set(key.replace('plan-1', 'wrong'), map.get(key)!);
  map.delete(key);
  expect(service.references(scope)).toEqual([{
    reference: {
      companyId: 'taebaek',
      targetId: 'order',
      planId: 'wrong'
    },
    readable: false,
    observedLocalText: map.get(key.replace('plan-1', 'wrong'))
  }]);
  expect(() => service.read(scope, {
    ...plan.request,
    planId: 'wrong'
  })).toThrow('계획');
  expect(map.size).toBe(1);
});
it('ACK 뒤 원문 정리 실패는 업무 확정 partial이며 재전송하지 않는다', async () => {
  const service = createOrderEditWriter(port),
    plan = await service.prepare(scope, opening, edit, false);
  port.storage.removeItem = () => {};
  vi.mocked(port.command).mockImplementation(c => result(c));
  expect(await service.run(scope, {
    companyId: plan.request.companyId,
    planId: plan.request.planId,
    targetId: plan.request.targetId
  }, 'apply')).toMatchObject({
    status: 'partial',
    committedIds: ['order'],
    unconfirmedIds: []
  });
  expect(port.command).toHaveBeenCalledOnce();
  expect(map.size).toBe(1);
});
it('원문 없는 다른 화면도 정확 reference를 inspect하며 새 apply를 만들지 않는다', async () => {
  const service = createOrderEditWriter(port),
    reference = {
      companyId: 'taebaek' as const,
      targetId: 'order',
      planId: 'plan'
    };
  await service.run(scope, reference, 'inspect');
  expect(port.command).toHaveBeenCalledWith({
    mode: 'inspect',
    reference
  });
  expect((await service.run(scope, reference, 'apply')).status).toBe('unknown');
  expect(port.command).toHaveBeenCalledOnce();
});
it('저장소 조회 실패는 원문 변경과 서버 송신 없이 끝난다', async () => {
  const service = createOrderEditWriter(port);
  port.storage.getItem = () => {
    throw Error('storage denied');
  };
  await expect(service.prepare(scope, opening, edit, false)).rejects.toThrow('storage denied');
  expect(port.command).not.toHaveBeenCalled();
  expect(map.size).toBe(0);
});

it('다른 유효 사본은 refonly 조회와 중단으로 서버 원인을 보이고 자동 정리하지 않는다',async()=>{
 const service=createOrderEditWriter(port),plan=await service.prepare(scope,opening,edit,false),reference={companyId:scope.companyId,planId:plan.request.planId,targetId:plan.request.targetId};
 const original=[...map.values()][0];
 vi.mocked(port.command).mockResolvedValue({...reference,actorUid:'actor',status:'applied',requestHash:'f'.repeat(64),message:'서버 최초 주문 완료'});
 for(const mode of ['inspect','cancel'] as const){expect(await service.run(scope,reference,mode)).toMatchObject({status:'rejected',message:expect.stringContaining('서버 최초 주문 완료')});expect(port.command).toHaveBeenLastCalledWith({mode,reference});expect([...map.values()][0]).toBe(original);}
 expect(await service.discardCopy(scope,reference,original)).toEqual({status:'saved'});expect(map.size).toBe(0);expect(port.command).toHaveBeenLastCalledWith({mode:'inspect',reference});
});
it('사본 정리는 unknown과 조회 중 바뀐 사본을 보존하고 다른 계획은 건드리지 않는다',async()=>{
 const service=createOrderEditWriter(port),plan=await service.prepare(scope,opening,edit,false),reference={companyId:scope.companyId,planId:plan.request.planId,targetId:plan.request.targetId},key=[...map.keys()][0],raw=map.get(key)!;
 vi.mocked(port.command).mockImplementation(c=>result(c,'unknown'));
 expect((await service.discardCopy(scope,reference,raw)).status).toBe('unknown');expect(map.get(key)).toBe(raw);
 vi.mocked(port.command).mockImplementation(async()=>{map.set(key,'새 사본');return {...reference,actorUid:'actor',status:'cancelled',requestHash:null,message:'중단'};});
 expect((await service.discardCopy(scope,reference,raw)).status).toBe('unknown');expect(map.get(key)).toBe('새 사본');
});
it('손상 사본은 서버 terminal 조회를 현재 성공으로 오판하지 않고 명시 사본 정리로 끝낸다',async()=>{
 const service=createOrderEditWriter(port),plan=await service.prepare(scope,opening,edit,false),reference={companyId:scope.companyId,planId:plan.request.planId,targetId:plan.request.targetId},key=[...map.keys()][0];map.set(key,'{broken');
 vi.mocked(port.command).mockResolvedValue({...reference,actorUid:'actor',status:'applied',requestHash:'a'.repeat(64),message:'이미 완료'});
 expect(await service.run(scope,reference,'inspect')).toMatchObject({status:'rejected',message:expect.stringContaining('이미 완료')});expect(map.get(key)).toBe('{broken');expect(port.command).toHaveBeenCalledWith({mode:'inspect',reference});
 expect(await service.discardCopy(scope,reference,'{broken')).toEqual({status:'saved'});expect(map.size).toBe(0);
});
