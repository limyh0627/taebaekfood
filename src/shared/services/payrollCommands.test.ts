import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  claims: {
    companyId: 'taebaek',
    isAdmin: true
  },
  row: {} as Record<string, unknown>,
  call: vi.fn(),
  user: {} as any
}));
vi.mock('../firebase', () => ({
  auth: {
    get currentUser() {
      return state.user;
    }
  },
  authReady: Promise.resolve(),
  db: {},
  functions: {}
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => ({
    collection,
    id
  }),
  getDoc: vi.fn(async (ref: any) => ({
    data: () => ref.collection === 'appMeta' ? {
      status: 'active',
      releaseId: 'test-release'
    } : state.row
  }))
}));
vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(() => state.call)
}));
import { issuePayrollVoucher, savePayrollDraft } from './payrollCommands';
const input = {
  yearMonth: '2026-10',
  payDate: '2026-10-25',
  expectedRevision: 3,
  lines: [{
    employeeId: 'e1',
    employeeName: '사원',
    base: 100
  }]
};
beforeEach(() => {
  vi.clearAllMocks();
  state.claims = {
    companyId: 'taebaek',
    isAdmin: true
  };
  state.row = {
    companyId: 'taebaek',
    revision: 7
  };
  state.user = {
    uid: 'admin',
    getIdTokenResult: async () => ({
      claims: state.claims
    })
  };
  state.call.mockResolvedValue({
    data: {
      revision: 4,
      id: 'fixed',
      docNo: '급여261025-001',
      kind: 'cashEntries'
    }
  });
});
describe('급여 원본 버전·응답 유실 경계 후보', () => {
  it('현재 조회 revision이 높아도 저장은 UI 원본 revision을 전송한다', async () => {
    await savePayrollDraft('taebaek', input);
    expect(state.call).toHaveBeenCalledWith(expect.objectContaining({
      expectedRevision: 3
    }));
  });
  it('응답 유실 재시도는 발행 당시 버전과 지급 계좌를 유지한다', async () => {
    state.row = {
      companyId: 'taebaek',
      revision: 4,
      issueOperationId: 'payroll-taebaek-2026-10-base',
      issueExpectedRevision: 3,
      issueCashAccountId: 'main'
    };
    await issuePayrollVoucher('taebaek', {
      ...input,
      expectedRevision: 4
    }, 'cash', 'changed');
    expect(state.call).toHaveBeenCalledWith(expect.objectContaining({
      expectedRevision: 3,
      cashAccountId: 'main'
    }));
  });
  it('기존 무계좌 요청의 재시도 hash 형식을 보존한다', async () => {
    state.row = {
      companyId: 'taebaek',
      revision: 4,
      issueOperationId: 'payroll-taebaek-2026-10-base',
      issueExpectedRevision: 3
    };
    await issuePayrollVoucher('taebaek', input, 'cash', 'new-main');
    expect(state.call.mock.calls[0][0]).not.toHaveProperty('cashAccountId');
  });
  it('회사 권한이 다르면 명령을 호출하지 않는다', async () => {
    state.claims.companyId = 'punghoe';
    await expect(savePayrollDraft('taebaek', input)).rejects.toThrow('회사 권한');
    expect(state.call).not.toHaveBeenCalled();
  });
});
it('대장 조회 대기 중 같은 회사 계정이 A에서 B로 바뀌면 RPC는 0회다', async () => {
  const {
    getDoc
  } = await import('firebase/firestore');
  let finish!: () => void;
  const originalRead = vi.mocked(getDoc).getMockImplementation()!;
  vi.mocked(getDoc).mockImplementationOnce(async reference => {
    await new Promise<void>(resolve => {
      finish = resolve;
    });
    return originalRead(reference);
  });
  const task = savePayrollDraft('taebaek', input);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  state.user = {
    uid: 'other',
    getIdTokenResult: async () => ({
      claims: state.claims
    })
  };
  finish();
  await expect(task).rejects.toThrow('계정');
  expect(state.call).not.toHaveBeenCalled();
});
it('RPC 응답 대기 중 UID가 바뀌면 늦은 ACK를 새 계정 성공으로 반환하지 않는다', async () => {
  let finish!: (value: {
    data: {
      revision: number;
    };
  }) => void;
  state.call.mockImplementation(() => new Promise(resolve => {
    finish = resolve;
  }));
  const task = savePayrollDraft('taebaek', input);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  state.user = {
    uid: 'other',
    getIdTokenResult: async () => ({
      claims: state.claims
    })
  };
  finish({
    data: {
      revision: 4
    }
  });
  await expect(task).rejects.toThrow('계정');
});
it('화면 소유 UID와 실제 로그인 UID가 이미 다르면 첫 조회와 RPC를 보내지 않는다', async () => {
  const {
    getDoc
  } = await import('firebase/firestore');
  await expect(savePayrollDraft('taebaek', input, 'previous-actor')).rejects.toThrow('계정');
  expect(getDoc).not.toHaveBeenCalled();
  expect(state.call).not.toHaveBeenCalled();
});
