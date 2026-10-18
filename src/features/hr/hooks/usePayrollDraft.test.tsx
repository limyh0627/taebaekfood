/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Employee, Payroll } from '../../../shared/types';
const ports = vi.hoisted(() => ({
  save: vi.fn(),
  issue: vi.fn()
}));
vi.mock('../../../shared/services/payrollCommands', () => ({
  savePayrollDraft: ports.save,
  issuePayrollVoucher: ports.issue
}));
import { usePayrollDraft, type PayrollDraftOptions } from './usePayrollDraft';
const employee: Employee = {
  id: 'e1',
  companyId: 'taebaek',
  name: '직원',
  status: 'working',
  joinDate: '',
  position: '사원',
  department: '생산',
  phone: ''
};
const payroll = (yearMonth = '2026-10', revision = 3, base = 100): Payroll & {
  revision: number;
} => ({
  id: 'pay-' + yearMonth,
  companyId: 'taebaek',
  yearMonth,
  payDate: yearMonth + '-25',
  lines: [{
    employeeId: 'e1',
    employeeName: '직원',
    base
  }],
  revision
});
const options = (): PayrollDraftOptions => ({
  companyId: 'taebaek',
  actorUid: 'A',
  yearMonth: '2026-10',
  employees: [employee],
  payrolls: [payroll()]
});
beforeEach(() => {
  ports.save.mockReset();
  ports.issue.mockReset();
  ports.save.mockResolvedValue({
    revision: 4
  });
  ports.issue.mockResolvedValue({
    id: 'fixed',
    docNo: '급여1',
    kind: 'cashEntries'
  });
});
it('다른 월 문서·직원 구독 변경이 dirty 초안을 덮지 않고 같은 월 revision은 충돌만 안내한다', () => {
  const view = renderHook(props => usePayrollDraft(props), {
    initialProps: options()
  });
  act(() => view.result.current.setCell(0, 'base', '222'));
  view.rerender({
    ...options(),
    employees: [{
      ...employee,
      name: '구독 이름'
    }],
    payrolls: [payroll(), payroll('2026-09')]
  });
  expect(view.result.current.lines[0].base).toBe(222);
  view.rerender({
    ...options(),
    payrolls: [payroll('2026-10', 8, 333)]
  });
  expect(view.result.current.sourceRevision).toBe(3);
  expect(view.result.current.lines[0].base).toBe(222);
  expect(view.result.current.conflict).toBe(true);
  act(() => view.result.current.reload());
  expect(view.result.current.lines[0].base).toBe(333);
  expect(view.result.current.sourceRevision).toBe(8);
});
it('같은 UID 월별 초안은 보존하지만 다른 UID·회사는 이전 초안을 노출하지 않는다', () => {
  const view = renderHook(props => usePayrollDraft(props), {
    initialProps: options()
  });
  act(() => view.result.current.setCell(0, 'base', '222'));
  view.rerender({
    ...options(),
    yearMonth: '2026-09'
  });
  view.rerender(options());
  expect(view.result.current.lines[0].base).toBe(222);
  view.rerender({
    ...options(),
    actorUid: 'B'
  });
  expect(view.result.current.lines[0].base).toBe(100);
  view.rerender({
    ...options(),
    actorUid: 'B',
    companyId: 'punghoe'
  });
  expect(view.result.current.lines).toEqual([]);
});
it('저장 중 금액·날짜·지난달 복사는 변경하지 않고 최초 버전과 입력으로 한 번만 전송한다', async () => {
  let finish!: (value: {
    revision: number;
  }) => void;
  ports.save.mockImplementation(() => new Promise(resolve => {
    finish = resolve;
  }));
  const view = renderHook(() => usePayrollDraft({
    ...options(),
    payrolls: [payroll(), payroll('2026-09', 1, 999)]
  }));
  act(() => view.result.current.setCell(0, 'base', '222'));
  let task!: Promise<boolean>;
  act(() => {
    task = view.result.current.run();
  });
  act(() => {
    view.result.current.setCell(0, 'base', '333');
    view.result.current.setPayDate('2026-10-30');
    view.result.current.copyPreviousMonth();
  });
  expect(view.result.current.lines[0].base).toBe(222);
  expect(view.result.current.payDate).toBe('2026-10-25');
  await act(async () => {
    expect(await view.result.current.run()).toBe(false);
    finish({
      revision: 4
    });
    await task;
  });
  expect(ports.save).toHaveBeenCalledOnce();
  expect(ports.save.mock.calls[0][1]).toMatchObject({
    expectedRevision: 3,
    lines: [{
      base: 222
    }]
  });
});
it('응답 유실은 dirty 초안을 유지하고 특정 요청 저장 여부를 조회값으로 추정하지 않는다', async () => {
  ports.save.mockRejectedValue(Error('응답 유실'));
  const view = renderHook(() => usePayrollDraft(options()));
  act(() => view.result.current.setCell(0, 'base', '222'));
  await act(async () => {
    expect(await view.result.current.run()).toBe(false);
  });
  expect(view.result.current.dirty).toBe(true);
  expect(view.result.current.lines[0].base).toBe(222);
  expect(view.result.current.message).toContain('저장 여부를 확정하지 않습니다');
});
it('같은 회사 UID 전환 후 늦은 ACK는 새 화면 안내와 버전에 반영하지 않는다', async () => {
  let finish!: (value: {
    revision: number;
  }) => void;
  ports.save.mockImplementation(() => new Promise(resolve => {
    finish = resolve;
  }));
  const view = renderHook(props => usePayrollDraft(props), {
    initialProps: options()
  });
  let task!: Promise<boolean>;
  act(() => {
    task = view.result.current.run();
  });
  view.rerender({
    ...options(),
    actorUid: 'B'
  });
  await act(async () => {
    finish({
      revision: 4
    });
    expect(await task).toBe(false);
  });
  expect(view.result.current.message).toBe('');
  expect(view.result.current.sourceRevision).toBe(3);
});
it('지난달 금액 복사는 현재 직원 신원을 보존하고 기존 발행 포트에 mode와 계좌를 전달한다', async () => {
  const previous = payroll('2026-09', 1, 999);
  previous.lines[0].employeeName = '지난 이름';
  const view = renderHook(() => usePayrollDraft({
    ...options(),
    payrolls: [payroll(), previous]
  }));
  act(() => view.result.current.copyPreviousMonth());
  expect(view.result.current.lines[0]).toMatchObject({
    base: 999,
    employeeName: '직원'
  });
  await act(async () => {
    expect(await view.result.current.run('cash', 'bank')).toBe(true);
  });
  expect(ports.issue).toHaveBeenCalledWith('taebaek', expect.objectContaining({
    expectedRevision: 3
  }), 'cash', 'bank', 'A');
});
