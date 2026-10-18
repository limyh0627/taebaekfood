import { beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
const runtime = vi.hoisted(() => ({
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
  auth: runtime.auth,
  authReady: Promise.resolve(),
  db: {},
  functions: {}
}));
vi.mock('firebase/functions', () => ({
  httpsCallable: () => runtime.call
}));
import { createLeaveRequestWriter, submitLeaveRequests, inspectLeaveAction, cancelLeaveAction, inspectLeaveRequest, listLeaveReferences, type LeaveWritePort } from './leaveRequestWrites';
import { serializeLeaveBatchRequest, leaveRequestBusinessIds, type LeaveBatchRequest } from '../../../shared/leaveRequestCommand';
import type { LeaveRequest, Employee } from '../../../shared/types';
const scope = {
  companyId: 'taebaek' as const,
  actorUid: 'actor'
};
const req = (id = 'leave-1'): LeaveRequest => ({
  id,
  employeeId: 'emp',
  employeeName: '직원',
  type: '연차',
  startDate: '2026-10-20',
  endDate: '2026-10-20',
  reason: '원문',
  status: 'pending',
  requestedAt: '2026-10-18',
  daysUsed: 1
});
const employees = [{
  id: 'emp',
  companyId: 'taebaek',
  name: '직원'
}, {
  id: 'admin',
  companyId: 'taebaek',
  name: '관리자'
}] as Employee[];
const hash = async (request: LeaveBatchRequest) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serializeLeaveBatchRequest(request)))), n => n.toString(16).padStart(2, '0')).join('');
let memory: Map<string, string>, port: LeaveWritePort, stored: LeaveBatchRequest | null;
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  memory = new Map();
  stored = null;
  port = {
    storage: {
      get length() {
        return memory.size;
      },
      key: i => [...memory.keys()][i] ?? null,
      getItem: k => memory.get(k) ?? null,
      setItem: (k, v) => {
        memory.set(k, v);
      },
      removeItem: k => {
        memory.delete(k);
      }
    },
    assertScope: vi.fn(async () => {}),
    now: () => '2026-10-18T00:00:00Z',
    id: () => 'plan-1',
    command: vi.fn(async (s, command) => {
      if (command.mode === 'apply') stored = command.request;
      return stored ? {
        status: 'applied',
        companyId: s.companyId,
        actorUid: s.actorUid,
        planId: stored.planId,
        requestHash: await hash(stored),
        requestIds: leaveRequestBusinessIds(stored),
        message: ''
      } : {
        status: command.mode === 'cancel' ? 'cancelled' : 'unknown',
        ...command.reference,
        actorUid: s.actorUid,
        requestHash: null,
        requestIds: [],
        message: '원문 확인 중'
      };
    }),
    notify: vi.fn(async () => {})
  };
});
it('최초 원문 보관 뒤 서버 단일 명령 ACK를 확인하고 회사 관리자 알림을 보낸다', async () => {
  const service = createLeaveRequestWriter(port),
    plan = await service.prepare(scope, [req()], employees, true);
  expect(memory.size).toBe(1);
  const result = await service.execute(scope, plan.planId, employees);
  expect(result.outcome.status).toBe('saved');
  expect(memory.size).toBe(0);
  expect(port.command).toHaveBeenCalledWith(scope, {
    mode: 'apply',
    request: plan.request
  });
  expect(port.notify).toHaveBeenCalledWith(scope, 'leave-notice-leave-1', expect.objectContaining({
    targetId: 'admin'
  }));
});
it('알림 실패는 신청 ACK와 분리하며 보관본을 지워 중복 신청 함정을 남기지 않는다', async () => {
  vi.mocked(port.notify).mockRejectedValue(Error('알림실패'));
  const service = createLeaveRequestWriter(port),
    plan = await service.prepare(scope, [req()], employees, true);
  expect((await service.execute(scope, plan.planId, employees)).outcome).toMatchObject({
    status: 'partial',
    reason: 'followup-unconfirmed',
    committedIds: ['leave-1'],
    unconfirmedIds: []
  });
  expect(service.list(scope)).toHaveLength(0);
  expect(port.command).toHaveBeenCalledOnce();
});
it('풍회에 태백 관리자만 있으면 타회사 또는 전체 알림을 보내지 않는다', async () => {
  const s = {
      companyId: 'punghoe' as const,
      actorUid: 'p'
    },
    service = createLeaveRequestWriter(port),
    plan = await service.prepare(s, [req()], employees.map(e => e.id === 'emp' ? {
      ...e,
      companyId: 'punghoe'
    } : e), true);
  expect((await service.execute(s, plan.planId, employees)).outcome.status).toBe('partial');
  expect(port.notify).not.toHaveBeenCalled();
});
it('unknown은 재로드 뒤 동일 plan을 조회하고 부재이면 보관하며 취소 fence ACK만 원문을 정리한다', async () => {
  vi.mocked(port.command).mockRejectedValueOnce(Error('응답유실'));
  const service = createLeaveRequestWriter(port),
    plan = await service.prepare(scope, [req()], employees);
  expect((await service.execute(scope, plan.planId)).outcome.status).toBe('unknown');
  const restored = createLeaveRequestWriter(port);
  expect(restored.list(scope)).toHaveLength(1);
  expect((await restored.inspect(scope, plan.planId)).outcome.status).toBe('unknown');
  expect(memory.size).toBe(1);
  expect((await restored.cancel(scope, plan.planId)).outcome.status).toBe('cancelled');
  expect(memory.size).toBe(0);
  expect(vi.mocked(port.command).mock.calls.map(call => call[1].mode)).toEqual(['apply', 'inspect', 'cancel']);
});
it('해시가 같아도 원문 ID가 다르면 ACK로 처리하거나 원문을 지우지 않는다', async () => {
  const service = createLeaveRequestWriter(port),
    plan = await service.prepare(scope, [req()], employees);
  vi.mocked(port.command).mockResolvedValue({
    status: 'applied',
    companyId: scope.companyId,
    actorUid: scope.actorUid,
    planId: plan.planId,
    requestHash: plan.requestHash,
    requestIds: ['other'],
    message: ''
  });
  expect((await service.execute(scope, plan.planId)).outcome.status).toBe('unknown');
  expect(memory.size).toBe(1);
  expect(port.notify).not.toHaveBeenCalled();
});
it('계정 변경은 다음 전송과 알림을 멈추고 늦은 응답으로 원문을 지우지 않는다', async () => {
  const service = createLeaveRequestWriter(port),
    plan = await service.prepare(scope, [req()], employees, true);
  vi.mocked(port.command).mockImplementation(async () => {
    vi.mocked(port.assertScope).mockRejectedValue(Error('다른계정'));
    return {
      status: 'applied',
      ...scope,
      actorUid: 'actor',
      planId: plan.planId,
      requestHash: plan.requestHash,
      requestIds: ['leave-1'],
      message: ''
    };
  });
  expect((await service.execute(scope, plan.planId, employees)).outcome.status).toBe('unknown');
  expect(port.notify).not.toHaveBeenCalled();
  expect(memory.size).toBe(1);
});
it('손상 원문은 그대로 두고 유효 reference의 명시 중단으로만 정리한다', async () => {
  const service = createLeaveRequestWriter(port),
    plan = await service.prepare(scope, [req()], employees);
  const key = [...memory.keys()][0];
  memory.set(key, '{broken');
  expect(() => service.read(scope, plan.planId)).toThrow('손상');
  expect(memory.get(key)).toBe('{broken');
  expect((await service.cancelReference(scope, plan.planId)).status).toBe('cancelled');
  expect(memory.size).toBe(0);
});
it('저장소 쓰기 확인 실패면 서버 전송을 시작하지 않는다', async () => {
  port.storage.setItem = () => {};
  const service = createLeaveRequestWriter(port);
  await expect(service.prepare(scope, [req()], employees)).rejects.toThrow('보관하지 못해');
  expect(port.command).not.toHaveBeenCalled();
});
it('단체는 10명 청크 없이 하나의 같은 원문 명령으로 보낸다', async () => {
  const people = Array.from({
      length: 25
    }, (_, i) => ({
      ...employees[0],
      id: 'emp-' + i
    })),
    requests = people.map((e, i) => ({
      ...req('leave-' + i),
      employeeId: e.id,
      type: '휴가' as const,
      status: 'approved' as const,
      deductsLeave: false
    }));
  const service = createLeaveRequestWriter(port),
    plan = await service.prepare(scope, requests, people);
  expect((await service.execute(scope, plan.planId)).outcome.status).toBe('saved');
  expect(port.command).toHaveBeenCalledOnce();
  expect(vi.mocked(port.command).mock.calls[0][1]).toMatchObject({
    mode: 'apply',
    request: {
      rows: expect.any(Array)
    }
  });
});
it('공개 adapter의 저장소·DTO 사전실패는 명시 거절이며 서버 호출이 없다', async () => {
  vi.stubGlobal('localStorage', port.storage);
  runtime.call.mockClear();
  const bad = {
    ...req(),
    startDate: '2026-02-30'
  };
  expect((await submitLeaveRequests(scope, [bad], employees)).outcome.status).toBe('rejected');
  expect(runtime.call).not.toHaveBeenCalled();
  port.storage.setItem = () => {};
  expect((await submitLeaveRequests(scope, [req()], employees)).outcome.status).toBe('rejected');
  expect(runtime.call).not.toHaveBeenCalled();
});
it('문법 정상인 해시 불일치 원문도 명시 중단은 reference만 보내고 fence ACK 후 정리한다', async () => {
  const service = createLeaveRequestWriter(port),
    plan = await service.prepare(scope, [req()], employees);
  const key = [...memory.keys()][0],
    changed = JSON.parse(memory.get(key)!);
  changed.request.rows[0].reason = '달라진 본문';
  memory.set(key, JSON.stringify(changed));
  await expect(service.execute(scope, plan.planId)).rejects.toThrow('해시');
  await expect(service.inspect(scope, plan.planId)).rejects.toThrow('해시');
  expect(port.command).not.toHaveBeenCalled();
  expect(memory.size).toBe(1);
  expect((await service.cancel(scope, plan.planId)).outcome.status).toBe('cancelled');
  expect(port.command).toHaveBeenCalledExactlyOnceWith(scope, {
    mode: 'cancel',
    reference: {
      companyId: scope.companyId,
      planId: plan.planId
    }
  });
  expect(memory.size).toBe(0);
});
it('해시 불일치 중단에서 서버가 이미 적용한 요청은 재발행하지 않고 기존 휴가를 보존한다', async () => {
  const service = createLeaveRequestWriter(port),
    plan = await service.prepare(scope, [req()], employees);
  stored = plan.request;
  const original = JSON.stringify(stored),
    key = [...memory.keys()][0],
    changed = JSON.parse(memory.get(key)!);
  changed.request.rows[0].reason = '손상된 본문';
  memory.set(key, JSON.stringify(changed));
  expect((await service.cancel(scope, plan.planId)).outcome.status).toBe('saved');
  expect(JSON.stringify(stored)).toBe(original);
  expect(port.command).toHaveBeenCalledOnce();
  expect(vi.mocked(port.command).mock.calls[0][1].mode).toBe('cancel');
  expect(memory.size).toBe(0);
});
it('생성 보관본과 같은 휴가의 변경 계획을 분리하고 최초 행 스냅샷을 고정한다', async () => {
  let sequence = 0;
  port.id = () => `plan-${++sequence}`;
  const service = createLeaveRequestWriter(port);
  const create = await service.prepare(scope, [req()], employees);
  const row = {
    ...req(),
    companyId: 'taebaek' as const,
    daysUsed: 0,
    deductsLeave: false
  };
  const mutation = await service.prepareAction(scope, row, {
    action: 'approve'
  });
  row.reason = '나중 수정';
  expect(mutation.request.version).toBe(2);
  if (mutation.request.version !== 2) throw Error('mutation');
  expect(mutation.request.expected).toMatchObject({
    reason: '원문',
    daysUsed: 0,
    deductsLeave: false
  });
  expect(mutation.request.expected).not.toHaveProperty('cancelReason');
  expect(create.request.version).toBe(1);
  await expect(service.prepareAction(scope, row, {
    action: 'reject'
  })).rejects.toThrow('보관 요청');
  expect(port.command).not.toHaveBeenCalled();
  vi.mocked(port.command).mockImplementation(async (s, command) => ({
    status: 'unknown',
    companyId: s.companyId,
    actorUid: s.actorUid,
    planId: command.mode === 'apply' ? command.request.planId : command.reference.planId,
    requestHash: null,
    requestIds: [],
    message: '미확인'
  }));
  await service.inspect(scope, mutation.planId);
  expect(port.command).toHaveBeenLastCalledWith(scope, {
    mode: 'inspect',
    reference: {
      companyId: 'taebaek',
      planId: mutation.planId
    },
    requestHash: mutation.requestHash
  });
  await service.cancel(scope, mutation.planId);
  expect(port.command).toHaveBeenLastCalledWith(scope, {
    mode: 'cancel',
    reference: {
      companyId: 'taebaek',
      planId: mutation.planId
    },
    requestHash: mutation.requestHash
  });
  expect(service.list(scope).map(p => p.planId)).toEqual([create.planId, mutation.planId]);
});
it('변경 ACK는 대상 ID를 검증하고 다른 ID 응답은 원문을 보존한다', async () => {
  const service = createLeaveRequestWriter(port),
    plan = await service.prepareAction(scope, req(), {
      action: 'reject'
    });
  vi.mocked(port.command).mockResolvedValue({
    status: 'applied',
    companyId: 'taebaek',
    actorUid: 'actor',
    planId: plan.planId,
    requestHash: plan.requestHash,
    requestIds: ['다른 휴가'],
    message: ''
  });
  expect((await service.execute(scope, plan.planId)).outcome.status).toBe('unknown');
  expect(service.read(scope, plan.planId)?.request).toEqual(plan.request);
});
it('생성과 변경이 같은 휴가를 가리켜도 복구는 각 원문 계획만 조회한다', async () => {
  vi.stubGlobal('localStorage', port.storage);
  let n = 0;
  port.id = () => `plan-${++n}`;
  const service = createLeaveRequestWriter(port),
    create = await service.prepare(scope, [req()], employees),
    change = await service.prepareAction(scope, req(), {
      action: 'approve'
    });
  runtime.call.mockImplementation(async command => ({
    data: {
      status: 'unknown',
      ...command.reference,
      actorUid: 'actor',
      requestHash: null,
      requestIds: [],
      message: '미확인'
    }
  }));
  await inspectLeaveAction(scope, change.planId);
  expect(runtime.call).toHaveBeenLastCalledWith(expect.objectContaining({
    reference: {
      companyId: 'taebaek',
      planId: change.planId
    }
  }));
  await inspectLeaveRequest(scope, req().id);
  expect(runtime.call).toHaveBeenLastCalledWith(expect.objectContaining({
    reference: {
      companyId: 'taebaek',
      planId: create.planId
    }
  }));
  await cancelLeaveAction(scope, change.planId);
  expect(runtime.call).toHaveBeenLastCalledWith(expect.objectContaining({
    mode: 'cancel',
    reference: {
      companyId: 'taebaek',
      planId: change.planId
    }
  }));
  // 다른 화면이 원문을 정리했을 때도 새 생성 없이 동일 서버 영수증을 확인한다.
  memory.clear();
  await inspectLeaveAction(scope, change.planId);
  expect(runtime.call).toHaveBeenLastCalledWith({
    mode: 'inspect',
    reference: {
      companyId: 'taebaek',
      planId: change.planId
    }
  });
});
it('손상된 변경 원문은 inspect 전송하지 않고 명시 중단만 참조로 보낸다', async () => {
  vi.stubGlobal('localStorage', port.storage);
  const service = createLeaveRequestWriter(port),
    plan = await service.prepareAction(scope, req(), {
      action: 'approve'
    });
  const key = [...memory.keys()][0];
  memory.set(key, '{손상');
  runtime.call.mockClear();
  expect((await inspectLeaveAction(scope, plan.planId)).status).toBe('unknown');
  expect(runtime.call).not.toHaveBeenCalled();
  runtime.call.mockResolvedValue({
    data: {
      status: 'cancelled',
      companyId: 'taebaek',
      actorUid: 'actor',
      planId: plan.planId,
      requestHash: null,
      requestIds: [],
      message: '중단'
    }
  });
  expect((await cancelLeaveAction(scope, plan.planId)).status).toBe('cancelled');
  expect(runtime.call).toHaveBeenCalledWith({
    mode: 'cancel',
    reference: {
      companyId: 'taebaek',
      planId: plan.planId
    }
  });
});
it('저장 키와 본문 계획 번호가 다르면 원문을 보존하고 실행을 차단한다', async () => {
  const service = createLeaveRequestWriter(port),
    plan = await service.prepareAction(scope, req(), {
      action: 'approve'
    });
  const original = [...memory.keys()][0],
    wrong = original.replace(plan.planId, 'wrong-plan');
  memory.set(wrong, memory.get(original)!);
  memory.delete(original);
  expect(() => service.read(scope, 'wrong-plan')).toThrow('저장 위치');
  expect(service.list(scope)).toEqual([]);
  expect(memory.has(wrong)).toBe(true);
  await expect(service.execute(scope, 'wrong-plan')).rejects.toThrow('저장 위치');
  expect(port.command).not.toHaveBeenCalled();
  vi.stubGlobal('localStorage', port.storage);
  expect(listLeaveReferences(scope)).toEqual([{
    planId: 'wrong-plan',
    readable: false
  }]);
  runtime.call.mockResolvedValue({
    data: {
      status: 'cancelled',
      companyId: 'taebaek',
      actorUid: 'actor',
      planId: 'wrong-plan',
      requestHash: null,
      requestIds: [],
      message: '중단'
    }
  });
  expect((await cancelLeaveAction(scope, 'wrong-plan')).status).toBe('cancelled');
  expect(runtime.call).toHaveBeenLastCalledWith({
    mode: 'cancel',
    reference: {
      companyId: 'taebaek',
      planId: 'wrong-plan'
    }
  });
});
it('변경 거절은 서버 원인을 유지하고 새 등록 대신 현재 휴가를 다시 열도록 안내한다',async()=>{
 const service=createLeaveRequestWriter(port),plan=await service.prepareAction(scope,req(),{action:'approve'});
 vi.mocked(port.command).mockResolvedValue({status:'rejected',companyId:'taebaek',actorUid:'actor',planId:plan.planId,requestHash:plan.requestHash,requestIds:['leave-1'],message:'다른 관리자가 먼저 변경했습니다.'});
 const result=await service.execute(scope,plan.planId);
 expect(result.outcome).toMatchObject({status:'rejected',message:'다른 관리자가 먼저 변경했습니다.',nextAction:'창을 닫고 해당 휴가를 다시 열어 현재 내용을 확인한 뒤 필요한 작업을 선택해 주세요.'});
 expect(port.command).toHaveBeenCalledOnce();
});
