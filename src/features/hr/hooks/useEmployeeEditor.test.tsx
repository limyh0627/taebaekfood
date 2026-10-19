/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useEmployeeEditor } from './useEmployeeEditor';
import type { EmployeeEditInput } from '../infrastructure/employeeEditWrites';
import type { SaveOutcome } from '../../../shared/saveOutcome';
const input: EmployeeEditInput = {
  targetId: 'e1',
  kind: 'balance',
  opening: {
    id: 'e1',
    companyId: 'taebaek',
    name: '직원',
    department: '',
    position: '',
    status: 'working',
    joinDate: '',
    phone: ''
  },
  balance: {
    carryOverLeave: 3,
    bonusLeave: 4
  }
};
it('실 ACK까지 busy와 닫기 보류를 유지하고 두 scalar를 한 인수로 보낸다', async () => {
  let finish!: (value: SaveOutcome) => void;
  const save = vi.fn((_input: EmployeeEditInput) => new Promise<SaveOutcome>(resolve => {
    finish = resolve;
  }));
  const view = renderHook(() => useEmployeeEditor({
    scopeKey: 'a',
    onSave: save
  }));
  let pending!: Promise<boolean>;
  act(() => {
    pending = view.result.current.submit(input);
  });
  expect(view.result.current.busy).toBe(true);
  act(() => {
    expect(view.result.current.close()).toBe(false);
  });
  expect(save).toHaveBeenCalledWith(input);
  await act(async () => {
    finish({
      status: 'saved'
    });
    expect(await pending).toBe(true);
  });
  expect(view.result.current.busy).toBe(false);
});
it('거절·unknown·runtime void는 저장 완료로 닫지 않는다', async () => {
  for (const value of [{
    status: 'rejected',
    message: '충돌'
  }, undefined, {
    status: 'unknown',
    message: '확인',
    nextAction: '조회'
  }] as const) {
    const save = vi.fn(async () => value as SaveOutcome);
    const view = renderHook(() => useEmployeeEditor({
      scopeKey: 'a',
      onSave: save
    }));
    await act(async () => {
      expect(await view.result.current.submit(input)).toBe(false);
    });
    expect(view.result.current.message).not.toBe('');
    view.unmount();
  }
});
it('UID 전환 뒤 늦은 ACK는 새 화면 결과와 닫힘으로 반영하지 않는다', async () => {
  let finish!: (value: SaveOutcome) => void;
  const save = () => new Promise<SaveOutcome>(resolve => {
    finish = resolve;
  });
  const view = renderHook(({
    scopeKey
  }) => useEmployeeEditor({
    scopeKey,
    onSave: save
  }), {
    initialProps: {
      scopeKey: 'A'
    }
  });
  let task!: Promise<boolean>;
  act(() => {
    task = view.result.current.submit(input);
  });
  view.rerender({
    scopeKey: 'B'
  });
  await act(async () => {
    finish({
      status: 'saved'
    });
    expect(await task).toBe(false);
  });
  expect(view.result.current.message).toBe('');
});
it('보관 목록 읽기 실패와 저장 포트 누락은 새 요청0과 원인 안내를 남긴다', async () => {
  const save = vi.fn(async (): Promise<SaveOutcome> => ({
    status: 'saved'
  }));
  const view = renderHook(() => useEmployeeEditor({
    scopeKey: 'A',
    onSave: save,
    readPending: () => {
      throw Error('저장소 거절');
    }
  }));
  await act(async () => {
    expect(await view.result.current.submit(input)).toBe(false);
  });
  expect(save).not.toHaveBeenCalled();
  expect(view.result.current.message).toContain('읽지 못해');
  view.unmount();
  const missing = renderHook(() => useEmployeeEditor({
    scopeKey: 'A'
  }));
  await act(async () => {
    expect(await missing.result.current.submit(input)).toBe(false);
  });
  expect(missing.result.current.message).toContain('연결되지');
});
it('서버 종결 거절은 새로 열기 태그를 노출하고 다른 대상 입력에 복제하지 않는다', async () => {
  const view = renderHook(() => useEmployeeEditor({
    scopeKey: 'A',
    onSave: async () => ({
      status: 'rejected',
      message: '원본 변경',
      requiresReopen: true
    })
  }));
  await act(async () => {
    expect(await view.result.current.submit(input)).toBe(false);
  });
  expect(view.result.current.terminalRequiresReopen).toBe(true);
  expect(view.result.current.messageTargetId).toBe('e1');
  act(() => view.result.current.clearMessage());
  expect(view.result.current.terminalRequiresReopen).toBe(false);
});
it('신규 초안의 번호와 기본값은 열 때 한 번 고정되고 사전 거절 뒤 같은 번호로 수정한다', async () => {
  const save = vi.fn(async (_input: EmployeeEditInput): Promise<SaveOutcome> => ({
    status: 'rejected',
    message: '전송 전 확인'
  }));
  const view = renderHook(() => useEmployeeEditor({
    scopeKey: 'A',
    onSave: save
  }));
  act(() => {
    view.result.current.openCreate();
  });
  const id = view.result.current.profileSession!.targetId;
  expect(view.result.current.formData).toMatchObject({
    position: '사원',
    department: '생산팀',
    phone: '010-0000-0000',
    annualLeave: {
      carryOverLeave: 0,
      bonusLeave: 0
    }
  });
  act(() => view.result.current.changeProfile({
    name: '신규 직원'
  }));
  await act(async () => {
    expect(await view.result.current.submitProfile()).toBe(false);
  });
  expect(view.result.current.profileLocked).toBe(false);
  act(() => view.result.current.changeProfileBalance('bonusLeave', '2.5'));
  await act(async () => {
    await view.result.current.submitProfile();
  });
  expect(save.mock.calls[1][0]).toMatchObject({
    targetId: id,
    kind: 'create',
    opening: null,
    profile: {
      name: '신규 직원',
      annualLeave: {
        bonusLeave: 2.5
      }
    }
  });
});
it('프로필 열림 원문은 폼 기본값과 섞지 않으며 UID 전환 첫 렌더부터 초안을 비운다', async () => {
  const save = vi.fn(async (_input: EmployeeEditInput): Promise<SaveOutcome> => ({
    status: 'saved'
  }));
  const row = input.opening!;
  const view = renderHook(({
    key
  }) => useEmployeeEditor({
    scopeKey: key,
    onSave: save
  }), {
    initialProps: {
      key: 'A'
    }
  });
  act(() => view.result.current.openProfile(row));
  expect(Object.hasOwn(view.result.current.profileSession!.opening!, 'annualLeave')).toBe(false);
  act(() => view.result.current.changeProfile({
    name: '작성 중 이름'
  }));
  await act(async () => {
    expect(await view.result.current.submitProfile()).toBe(true);
  });
  expect(save.mock.calls[0][0]).toMatchObject({
    kind: 'profile',
    opening: {
      name: '직원'
    },
    profile: {
      name: '작성 중 이름'
    }
  });
  view.rerender({
    key: 'B'
  });
  expect(view.result.current.profileSession).toBeNull();
  expect(view.result.current.balanceDrafts).toEqual({});
});
it('연차 두 값의 빠른 변경은 한 초안·원본으로 함께 전송하고 ACK된 그 초안만 정리한다', async () => {
  const save = vi.fn(async (_input: EmployeeEditInput): Promise<SaveOutcome> => ({
    status: 'saved'
  }));
  const view = renderHook(() => useEmployeeEditor({
    scopeKey: 'A',
    onSave: save
  }));
  const row = {
    ...input.opening!,
    annualLeave: {
      carryOverLeave: 1,
      bonusLeave: 2,
      usedLeave: 7
    }
  };
  act(() => {
    view.result.current.changeBalance(row, 'carryOverLeave', '3');
    view.result.current.changeBalance({
      ...row,
      annualLeave: {
        ...row.annualLeave,
        carryOverLeave: 99
      }
    }, 'bonusLeave', '4');
  });
  expect(view.result.current.balanceFor(row)).toEqual({
    carryOverLeave: 3,
    bonusLeave: 4
  });
  await act(async () => {
    expect(await view.result.current.submitBalance(row.id)).toBe(true);
  });
  expect(save.mock.calls[0][0]).toMatchObject({
    kind: 'balance',
    opening: {
      annualLeave: {
        carryOverLeave: 1,
        bonusLeave: 2,
        usedLeave: 7
      }
    },
    balance: {
      carryOverLeave: 3,
      bonusLeave: 4
    }
  });
  expect(view.result.current.hasBalanceDraft(row.id)).toBe(false);
});
it('실제 프로필 저장 동안 변경과 닫기는 막고 서버 종결 거절 뒤에는 새로 열어야 한다', async () => {
  let finish!: (value: import('../infrastructure/employeeEditWrites').EmployeeEditSaveOutcome) => void;
  const save = vi.fn((_input: EmployeeEditInput) => new Promise<import('../infrastructure/employeeEditWrites').EmployeeEditSaveOutcome>(resolve => {
    finish = resolve;
  }));
  const view = renderHook(() => useEmployeeEditor({
    scopeKey: 'A',
    onSave: save
  }));
  act(() => view.result.current.openProfile(input.opening!));
  let task!: Promise<boolean>;
  act(() => {
    task = view.result.current.submitProfile();
  });
  act(() => {
    view.result.current.changeProfile({
      name: '덮지 말 것'
    });
    expect(view.result.current.closeProfile()).toBe(false);
  });
  expect(view.result.current.formData.name).toBe('직원');
  await act(async () => {
    finish({
      status: 'rejected',
      message: '원본 변경',
      requiresReopen: true
    });
    expect(await task).toBe(false);
  });
  expect(view.result.current.profileLocked).toBe(true);
  act(() => view.result.current.openProfile({
    ...input.opening!,
    name: '새 원본'
  }));
  expect(view.result.current.profileLocked).toBe(false);
  expect(view.result.current.formData.name).toBe('새 원본');
});
it('연차 CAS 거절 뒤 되돌리기는 종결 상태만 해제하고 다음 입력은 현재 행 원본을 잡는다', async () => {
  let calls = 0;
  const save = vi.fn(async (_input: EmployeeEditInput): Promise<import('../infrastructure/employeeEditWrites').EmployeeEditSaveOutcome> => ++calls === 1 ? {
    status: 'rejected',
    message: '다른 화면 변경',
    requiresReopen: true
  } : {
    status: 'saved'
  });
  const view = renderHook(() => useEmployeeEditor({
    scopeKey: 'A',
    onSave: save
  }));
  const row = {
    ...input.opening!,
    annualLeave: {
      carryOverLeave: 1,
      bonusLeave: 2
    }
  };
  act(() => view.result.current.changeBalance(row, 'carryOverLeave', '3'));
  await act(async () => {
    await view.result.current.submitBalance(row.id);
  });
  expect(view.result.current.balanceLocked(row.id)).toBe(true);
  expect(view.result.current.canResetBalance(row.id)).toBe(true);
  act(() => {
    expect(view.result.current.resetBalance(row.id)).toBe(true);
  });
  expect(view.result.current.balanceLocked(row.id)).toBe(false);
  const current = {
    ...row,
    annualLeave: {
      carryOverLeave: 8,
      bonusLeave: 9
    }
  };
  act(() => view.result.current.changeBalance(current, 'bonusLeave', '10'));
  await act(async () => {
    await view.result.current.submitBalance(row.id);
  });
  expect(save.mock.calls[1][0]).toMatchObject({
    opening: {
      annualLeave: {
        carryOverLeave: 8,
        bonusLeave: 9
      }
    },
    balance: {
      carryOverLeave: 8,
      bonusLeave: 10
    }
  });
});
it('연차 미확정 원문이 있으면 되돌리기로 초안과 잠금을 없애지 않는다', async () => {
  const view = renderHook(() => useEmployeeEditor({
    scopeKey: 'A',
    onSave: async () => ({
      status: 'unknown',
      message: '응답 유실',
      nextAction: '같은 요청 확인'
    })
  }));
  act(() => view.result.current.changeBalance(input.opening!, 'bonusLeave', '4'));
  await act(async () => {
    await view.result.current.submitBalance('e1');
  });
  expect(view.result.current.canResetBalance('e1')).toBe(false);
  act(() => {
    expect(view.result.current.resetBalance('e1')).toBe(false);
  });
  expect(view.result.current.balanceFor(input.opening!).bonusLeave).toBe(4);
});

it('다른 사본의 서버 완료와 사본 정리는 현재 직원·연차 초안을 성공으로 초기화하지 않는다',async()=>{
 const ref={companyId:'taebaek' as const,targetId:'e1',planId:'retained'};
 const inspect=vi.fn(async()=>({status:'rejected' as const,message:'서버 원요청 완료·다른 사본',copyMismatch:true as const,requiresReopen:true}));
 const discard=vi.fn(async()=>({status:'cleared' as const,message:'이 기기 사본만 정리'}));
 const save=vi.fn();const view=renderHook(()=>useEmployeeEditor({scopeKey:'A',onSave:save,inspect,discardCopy:discard}));
 act(()=>{view.result.current.openProfile(input.opening!);view.result.current.changeProfile({name:'새 초안'});view.result.current.changeBalance(input.opening!,'bonusLeave',7);});
 await act(async()=>expect(await view.result.current.inspect(ref)).toBe(false));
 await act(async()=>expect(await view.result.current.discardCopy(ref,'관측 원문')).toBe(true));
 expect(discard).toHaveBeenCalledWith(ref,'관측 원문');expect(view.result.current.formData.name).toBe('새 초안');expect(view.result.current.balanceFor(input.opening!).bonusLeave).toBe(7);expect(save).not.toHaveBeenCalled();
 expect(view.result.current.lastOutcome?.status).toBe('rejected');
});
it('늦은 사본 정리 결과는 새 범위 초안과 잠금을 변경하지 않는다',async()=>{
 let finish!:(v:{status:'cleared';message:string})=>void;const discard=vi.fn(()=>new Promise<{status:'cleared';message:string}>(resolve=>finish=resolve));
 const view=renderHook(({scopeKey})=>useEmployeeEditor({scopeKey,discardCopy:discard}),{initialProps:{scopeKey:'A'}});
 let pending!:Promise<boolean>;act(()=>{pending=view.result.current.discardCopy({companyId:'taebaek',targetId:'e1',planId:'old'},'old');});
 view.rerender({scopeKey:'B'});act(()=>{view.result.current.openProfile(input.opening!);view.result.current.changeProfile({name:'B초안'});});
 await act(async()=>{finish({status:'cleared',message:'A사본 정리'});expect(await pending).toBe(false);});
 expect(view.result.current.formData.name).toBe('B초안');expect(view.result.current.message).not.toContain('A사본');expect(view.result.current.busy).toBe(false);
});

it('미확정 연차와 같은 plan의 사본 정리 뒤에만 명시 되돌리기로 현재 값을 다시 연다',async()=>{
 const reference={companyId:'taebaek' as const,targetId:'e1',planId:'same-plan'};
 let refs:Array<{key:string;reference:typeof reference;readable:boolean;observedLocalText:string}>=[];
 const save=vi.fn(async()=>{refs=[{key:'same',reference,readable:true,observedLocalText:'same-raw'}];return {status:'unknown' as const,message:'미확정',nextAction:'확인'};});
 const discard=vi.fn(async(ref:import('../../../shared/employeeEditCommand').EmployeeEditReference)=>{refs=[];return {status:'cleared' as const,message:'사본 정리'};});
 const view=renderHook(()=>useEmployeeEditor({scopeKey:'A',onSave:save,readReferences:()=>refs,discardCopy:discard}));
 act(()=>view.result.current.changeBalance(input.opening!,'bonusLeave',7));await act(async()=>{await view.result.current.submitBalance('e1');});
 expect(view.result.current.canResetBalance('e1')).toBe(false);
 await act(async()=>{await view.result.current.discardCopy({...reference,planId:'other-plan'},'other');});
 expect(view.result.current.canResetBalance('e1')).toBe(false);
 await act(async()=>{await view.result.current.discardCopy(reference,'same-raw');});
 expect(view.result.current.balanceFor(input.opening!).bonusLeave).toBe(7);expect(view.result.current.lastOutcome?.status).toBe('unknown');
 expect(view.result.current.canResetBalance('e1')).toBe(true);
 act(()=>expect(view.result.current.resetBalance('e1')).toBe(true));
 const fresh={...input.opening!,annualLeave:{carryOverLeave:8,bonusLeave:9}};
 act(()=>view.result.current.changeBalance(fresh,'bonusLeave',10));expect(view.result.current.balanceFor(fresh)).toEqual({carryOverLeave:8,bonusLeave:10});
});

it('직원 partial 업무 ACK는 보존하지만 프로필·연차 초안을 자동 종결하지 않는다',async()=>{
 const partial={status:'partial' as const,reason:'followup-unconfirmed' as const,committedIds:['e1'],unconfirmedIds:[],message:'직원 저장 확인·기기 정리 미확인',nextAction:'같은 요청 조회'};
 const save=vi.fn(async()=>partial);const view=renderHook(()=>useEmployeeEditor({scopeKey:'A',onSave:save,inspect:async()=>partial}));
 act(()=>{view.result.current.openProfile(input.opening!);view.result.current.changeProfile({name:'partial 초안'});});
 await act(async()=>expect(await view.result.current.submitProfile()).toBe(false));
 expect(view.result.current.profileSession?.draft.name).toBe('partial 초안');expect(view.result.current.lastOutcome).toMatchObject(partial);expect(view.result.current.profileLocked).toBe(true);
 await act(async()=>expect(await view.result.current.inspect({companyId:'taebaek',targetId:'e1',planId:'partial-plan'})).toBe(false));
 expect(view.result.current.message).toContain('기기 정리 미확인');expect(view.result.current.message).toContain('같은 요청 조회');expect(view.result.current.message).not.toContain('창을 닫고');
 act(()=>view.result.current.changeBalance(input.opening!,'bonusLeave',8));
 // 다른 인수는 별도 훅에서 확인해 앞 partial의 대상 잠금과 섞지 않는다.
 const balances=renderHook(()=>useEmployeeEditor({scopeKey:'B',onSave:save}));
 act(()=>balances.result.current.changeBalance(input.opening!,'bonusLeave',8));
 await act(async()=>expect(await balances.result.current.submitBalance('e1')).toBe(false));
 expect(balances.result.current.hasBalanceDraft('e1')).toBe(true);expect(balances.result.current.balanceFor(input.opening!).bonusLeave).toBe(8);
});
