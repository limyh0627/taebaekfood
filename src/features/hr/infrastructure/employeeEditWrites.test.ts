import { beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
vi.mock('../../../shared/firebase', () => ({
  auth: {},
  authReady: Promise.resolve(),
  functions: {}
}));
import { createEmployeeEditWriter, type EmployeeEditInput, type EmployeeEditScope, type EmployeeEditWritePort } from './employeeEditWrites';
import type { EmployeeEditCommand } from '../../../shared/employeeEditCommand';
Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
  configurable: true
});
const scope: EmployeeEditScope = {
  companyId: 'taebaek',
  actorUid: 'actor'
};
const profile = {
  name: '합성 직원',
  position: '사원',
  department: '생산',
  joinDate: '2020-01-01',
  birthDate: '',
  phone: '',
  status: 'working',
  healthCertDate: '',
  annualLeave: {
    carryOverLeave: 1,
    bonusLeave: 2
  }
};
const input: EmployeeEditInput = {
  kind: 'create',
  targetId: 'fixed-employee',
  opening: null,
  profile
};
function fixture() {
  const data = new Map<string, string>();
  const storage = {
    get length() {
      return data.size;
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    }
  };
  const command = vi.fn<(command: EmployeeEditCommand) => Promise<unknown>>();
  const port: EmployeeEditWritePort = {
    storage,
    command,
    assertScope: vi.fn(async () => {}),
    exclusive: async (_scope, _target, work) => work(),
    id: () => 'fixed-plan'
  };
  return {
    data,
    storage,
    command,
    port,
    service: createEmployeeEditWriter(port)
  };
}
beforeEach(() => vi.clearAllMocks());
it('원문 readback 뒤 같은 계획으로 송신하고 응답 유실에는 원문을 보존한다', async () => {
  const f = fixture();
  f.command.mockRejectedValue(new Error('응답 유실'));
  expect((await f.service.submit(scope, input)).status).toBe('unknown');
  expect(f.command).toHaveBeenCalledOnce();
  const plan = f.service.pending(scope)[0];
  expect(plan.id).toBe('fixed-employee');
  f.command.mockImplementation(async command => ({
    ...plan.reference,
    actorUid: scope.actorUid,
    requestHash: f.service.read(scope, plan.reference).requestHash,
    status: command.mode === 'inspect' ? 'duplicate' : 'applied',
    message: '확인'
  }));
  expect((await f.service.run(scope, plan.reference, 'inspect')).status).toBe('saved');
  expect(f.data.size).toBe(0);
});
it('저장소 쓰기·재읽기 실패는 서버 전송0이고 수정 가능한 사전 거절이다', async () => {
  const f = fixture();
  f.port.storage.setItem = () => {
    throw Error('저장소 거절');
  };
  expect((await f.service.submit(scope, input)).status).toBe('rejected');
  expect(f.command).not.toHaveBeenCalled();
});
it('손상 key/body는 원문을 보존하고 명시 중단만 정확 reference로 보낸다', async () => {
  const f = fixture(),
    plan = await f.service.prepare(scope, input),
    reference = {
      companyId: scope.companyId,
      targetId: plan.request.targetId,
      planId: plan.request.planId
    };
  const [key, text] = [...f.data][0];
  f.data.set(key, text.replace('fixed-employee', 'other-employee'));
  expect(f.service.references(scope)[0].readable).toBe(false);
  expect(() => f.service.read(scope, reference)).toThrow('저장 위치');
  expect((await f.service.run(scope, reference, 'apply')).status).toBe('unknown');
  expect(f.command).not.toHaveBeenCalled();
  f.command.mockResolvedValue({
    ...reference,
    actorUid: scope.actorUid,
    status: 'cancelled',
    requestHash: null,
    message: '중단'
  });
  expect((await f.service.run(scope, reference, 'cancel')).status).toBe('cancelled');
  expect(f.command).toHaveBeenCalledWith({
    mode: 'cancel',
    reference
  });
});
it('다른 직원 손상 한 건은 정상 직원의 새 저장을 막지 않는다', async () => {
  const f = fixture();
  f.data.set('tb_employee_edit_v1:taebaek:actor:broken:plan', '{');
  await expect(f.service.prepare(scope, input)).resolves.toMatchObject({
    request: {
      targetId: 'fixed-employee'
    }
  });
});
it('응답 회사·UID·해시 불일치는 성공으로 보지 않고 원문을 남긴다', async () => {
  for (const patch of [{
    actorUid: 'other'
  }, {
    companyId: 'punghoe'
  }, {
    requestHash: 'f'.repeat(64)
  }]) {
    const f = fixture(),
      plan = await f.service.prepare(scope, input),
      reference = {
        companyId: scope.companyId,
        targetId: plan.request.targetId,
        planId: plan.request.planId
      };
    f.command.mockResolvedValue({
      ...reference,
      actorUid: scope.actorUid,
      requestHash: plan.requestHash,
      status: 'applied',
      message: '',
      ...patch
    });
    expect((await f.service.run(scope, reference, 'apply')).status).toBe('unknown');
    expect(f.data.size).toBe(1);
  }
});
it('완료 ACK 후 원문 정리 실패도 저장을 재송신하라고 안내하지 않는다', async () => {
  const f = fixture(),
    plan = await f.service.prepare(scope, input),
    reference = {
      companyId: scope.companyId,
      targetId: plan.request.targetId,
      planId: plan.request.planId
    };
  f.port.storage.removeItem = () => {
    throw Error('정리 거절');
  };
  f.command.mockResolvedValue({
    ...reference,
    actorUid: scope.actorUid,
    requestHash: plan.requestHash,
    status: 'duplicate',
    message: ''
  });
  expect(await f.service.run(scope, reference, 'inspect')).toMatchObject({
    status: 'partial',
    committedIds: ['fixed-employee'],
    unconfirmedIds: []
  });
  expect(f.data.size).toBe(1);
});
it('구문이 정상이어도 hash가 바뀐 원문은 apply하지 않고 reference 중단은 허용한다', async () => {
  const f = fixture(),
    plan = await f.service.prepare(scope, input),
    reference = {
      companyId: scope.companyId,
      targetId: plan.request.targetId,
      planId: plan.request.planId
    };
  const [key, text] = [...f.data][0];
  f.data.set(key, text.replace('합성 직원', '변경된 직원'));
  expect((await f.service.run(scope, reference, 'inspect')).status).toBe('unknown');
  expect(f.command).not.toHaveBeenCalled();
  f.command.mockResolvedValue({
    ...reference,
    actorUid: scope.actorUid,
    status: 'cancelled',
    requestHash: null,
    message: '중단'
  });
  expect(await f.service.run(scope, reference, 'cancel')).toMatchObject({
    status: 'cancelled',
    requiresReopen: true
  });
});
it('서버 CAS 거절과 전송 전 검증 거절은 새 원본 필요 태그로 구분한다', async () => {
  const f = fixture(),
    plan = await f.service.prepare(scope, input),
    reference = {
      companyId: scope.companyId,
      targetId: plan.request.targetId,
      planId: plan.request.planId
    };
  f.command.mockResolvedValue({
    ...reference,
    actorUid: scope.actorUid,
    status: 'rejected',
    requestHash: plan.requestHash,
    message: '다른 화면이 변경했습니다'
  });
  expect(await f.service.run(scope, reference, 'apply')).toMatchObject({
    status: 'rejected',
    requiresReopen: true,
    message: '다른 화면이 변경했습니다'
  });
  const invalid = await fixture().service.submit(scope, {
    ...input,
    profile: {
      ...profile,
      name: 10
    }
  } as unknown as EmployeeEditInput);
  expect(invalid.status).toBe('rejected');
  expect('requiresReopen' in invalid && invalid.requiresReopen).not.toBe(true);
});
it('원문 없는 정확 reference는 기존 서버 영수증 조회로 복구한다', async () => {
  const f = fixture(),
    reference = {
      companyId: scope.companyId,
      targetId: input.targetId,
      planId: 'missing-plan'
    };
  f.command.mockResolvedValue({
    ...reference,
    actorUid: scope.actorUid,
    status: 'duplicate',
    requestHash: 'a'.repeat(64),
    message: '이미 저장됨'
  });
  expect((await f.service.run(scope, reference, 'inspect')).status).toBe('saved');
  expect(f.command).toHaveBeenCalledWith({
    mode: 'inspect',
    reference
  });
});
