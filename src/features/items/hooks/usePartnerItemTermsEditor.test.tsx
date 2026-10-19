/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { usePartnerItemTermsEditor } from './usePartnerItemTermsEditor';
import type { PartnerItemTermsInput, PartnerItemTermsOutcome, PartnerItemTermsTarget } from '../infrastructure/partnerItemTermsWrites';
const target: PartnerItemTermsTarget = {
  itemId: 'item',
  partnerId: 'partner',
  direction: 'out',
  existingLinkId: 'actual-link',
  opening: {
    id: 'actual-link',
    itemId: 'item',
    partnerId: 'partner',
    Direction: 'out',
    price: 100,
    taxType: '면세'
  }
};
it('보드와 목록은 같은 대상 초안·최초 원행을 공유하고 ACK 전 초안을 삭제하지 않는다', async () => {
  let finish!: (value: PartnerItemTermsOutcome) => void;
  const save = vi.fn((_input: PartnerItemTermsInput) => new Promise<PartnerItemTermsOutcome>(resolve => {
    finish = resolve;
  }));
  const view = renderHook(() => usePartnerItemTermsEditor({
    scopeKey: 'A',
    onSave: save
  }));
  let key!: string;
  act(() => {
    key = view.result.current.open(target);
  });
  act(() => view.result.current.change(key, 'price', '0'));
  const liveTarget: PartnerItemTermsTarget = {
    ...target,
    existingLinkId: 'new-live-id'
  };
  expect(view.result.current.keyFor(liveTarget)).toBe(key);
  let task!: Promise<PartnerItemTermsOutcome>;
  act(() => {
    task = view.result.current.submit(key);
  });
  expect(view.result.current.draftFor(key)?.price).toBe('0');
  expect(view.result.current.busy).toBe(true);
  act(() => {
    view.result.current.change(key, 'price', '200');
  });
  expect(view.result.current.draftFor(key)?.price).toBe('0');
  expect(save).toHaveBeenCalledWith({
    target,
    terms: {
      price: 0,
      taxType: '면세'
    }
  });
  await act(async () => {
    finish({
      status: 'saved'
    });
    await task;
  });
  expect(view.result.current.draftFor(key)).toBeNull();
});
it('용역 단가·과세·계정 필수 검증은 송신 전에 하고 실제 초안은 hook이 소유한다', async () => {
  const save = vi.fn(async (_input: PartnerItemTermsInput): Promise<PartnerItemTermsOutcome> => ({
    status: 'saved'
  }));
  const view = renderHook(() => usePartnerItemTermsEditor({
    scopeKey: 'A',
    onSave: save
  }));
  let key!: string;
  act(() => {
    key = view.result.current.open(target, undefined, 'service', ['401']);
  });
  await act(async () => {
    expect((await view.result.current.submit(key)).status).toBe('rejected');
  });
  expect(save).not.toHaveBeenCalled();
  act(() => {
    view.result.current.change(key, 'price', '150');
    view.result.current.change(key, 'Account_Code', '401');
  });
  await act(async () => {
    expect((await view.result.current.submit(key)).status).toBe('saved');
  });
  expect(save).toHaveBeenCalledWith({
    target,
    terms: {
      price: 150,
      taxType: '면세',
      Account_Code: '401'
    }
  });
});
it('unknown 원문은 보존하고 terminal 거절 뒤에만 명시 최신 열기로 초안을 교체한다', async () => {
  const save = vi.fn(async (_input: PartnerItemTermsInput): Promise<PartnerItemTermsOutcome> => ({
    status: 'unknown',
    message: '응답 유실',
    nextAction: '결과 확인'
  }));
  const view = renderHook(() => usePartnerItemTermsEditor({
    scopeKey: 'A',
    onSave: save
  }));
  let key!: string;
  act(() => {
    key = view.result.current.open(target);
  });
  await act(async () => {
    await view.result.current.submit(key);
  });
  expect(view.result.current.canCancelEdit(key)).toBe(false);
  act(() => view.result.current.reopen({
    ...target,
    opening: {
      ...target.opening!,
      price: 999
    }
  }));
  expect(view.result.current.draftFor(key)?.price).toBe('100');
});
it('회사 UID 전환 직후 초안을 숨기고 늦은 ACK로 새 세션을 닫지 않는다', async () => {
  let finish!: (value: PartnerItemTermsOutcome) => void;
  const save = (_input: PartnerItemTermsInput) => new Promise<PartnerItemTermsOutcome>(resolve => {
    finish = resolve;
  });
  const view = renderHook(({
    scopeKey
  }) => usePartnerItemTermsEditor({
    scopeKey,
    onSave: save
  }), {
    initialProps: {
      scopeKey: 'A'
    }
  });
  let key!: string, task!: Promise<PartnerItemTermsOutcome>;
  act(() => {
    key = view.result.current.open(target);
  });
  act(() => {
    task = view.result.current.submit(key);
  });
  view.rerender({
    scopeKey: 'B'
  });
  expect(view.result.current.draftFor(key)).toBeNull();
  await act(async () => {
    finish({
      status: 'saved'
    });
    expect((await task).status).toBe('cancelled');
  });
  expect(view.result.current.message).toBe('');
});
it('복수 대상 일부 ACK 뒤 같은 원문을 다시 처리해도 완료 대상은 재전송하지 않는다', async () => {
  const save = vi.fn(async (input: PartnerItemTermsInput): Promise<PartnerItemTermsOutcome> => input.target.itemId === 'item' ? {
    status: 'saved'
  } : {
    status: 'rejected',
    message: '대상 충돌',
    requiresReopen: true
  });
  const view = renderHook(() => usePartnerItemTermsEditor({
    scopeKey: 'A',
    onSave: save
  }));
  const first = {
      target,
      terms: {
        price: 150
      }
    },
    second = {
      target: {
        ...target,
        itemId: 'second'
      },
      terms: {
        price: 200
      }
    };
  await act(async () => {
    expect((await view.result.current.saveRow(first)).status).toBe('saved');
    expect((await view.result.current.saveRow(second)).status).toBe('rejected');
  });
  await act(async () => {
    expect((await view.result.current.saveRow(first)).status).toBe('saved');
  });
  expect(save).toHaveBeenCalledTimes(2);
});
it('저장소 조회 실패와 미연결 포트는 요청0·원인 안내로 끝내고 void는 성공으로 보지 않는다', async () => {
  const save = vi.fn(async (_input: PartnerItemTermsInput): Promise<PartnerItemTermsOutcome> => ({
    status: 'saved'
  }));
  const view = renderHook(() => usePartnerItemTermsEditor({
    scopeKey: 'A',
    onSave: save,
    readPending: () => {
      throw Error('저장소');
    }
  }));
  await act(async () => {
    expect((await view.result.current.saveRow({
      target,
      terms: {}
    })).status).toBe('rejected');
  });
  expect(save).not.toHaveBeenCalled();
  expect(view.result.current.message).toContain('읽지 못해');
});
it('정리 실패 partial ACK는 정확한 plan 조회가 저장을 확인한 뒤에만 saved cache로 전환된다', async () => {
  const reference = {
    companyId: 'taebaek' as const,
    targetId: 'actual-link',
    itemId: 'item',
    partnerId: 'partner',
    direction: 'out' as const,
    planId: 'exact-plan'
  };
  let references: import('../infrastructure/partnerItemTermsWrites').PartnerItemTermsStoredReference[] = [];
  const save = vi.fn(async (_input: PartnerItemTermsInput): Promise<PartnerItemTermsOutcome> => {
    references = [{
      key: 'retained',
      reference,
      readable: true
    }];
    return {
      status: 'partial',
      reason: 'followup-unconfirmed',
      committedIds: ['actual-link'],
      unconfirmedIds: [],
      message: '기기 정리 실패',
      nextAction: '결과 확인'
    };
  });
  const inspect = vi.fn(async (): Promise<PartnerItemTermsOutcome> => {
    references = [];
    return {
      status: 'saved'
    };
  });
  const view = renderHook(() => usePartnerItemTermsEditor({
    scopeKey: 'A',
    onSave: save,
    readReferences: () => references,
    inspect
  }));
  const original = {
    target,
    terms: {
      price: 150
    }
  };
  await act(async () => {
    expect((await view.result.current.saveRow(original)).status).toBe('partial');
  });
  await act(async () => {
    await view.result.current.inspect({
      ...reference,
      planId: 'other-plan'
    });
  });
  await act(async () => {
    expect((await view.result.current.saveRow(original)).status).toBe('partial');
  });
  await act(async () => {
    await view.result.current.inspect(reference);
  });
  await act(async () => {
    expect((await view.result.current.saveRow(original)).status).toBe('saved');
  });
  expect(save).toHaveBeenCalledOnce();
});
it('서버 종결 거절 뒤 명시 reopen만 최신 원행을 잡고 runtime void는 초안을 닫지 않는다', async () => {
  const save = vi.fn(async (_input: PartnerItemTermsInput): Promise<PartnerItemTermsOutcome> => ({
    status: 'rejected',
    requiresReopen: true,
    message: '현재 자료 변경'
  }));
  const view = renderHook(() => usePartnerItemTermsEditor({
    scopeKey: 'A',
    onSave: save
  }));
  let key!: string;
  act(() => {
    key = view.result.current.open(target);
  });
  await act(async () => {
    await view.result.current.submit(key);
  });
  expect(view.result.current.locked(key)).toBe(true);
  act(() => view.result.current.reopen({
    ...target,
    opening: {
      ...target.opening!,
      price: 999
    }
  }));
  expect(view.result.current.draftFor(key)?.price).toBe('999');
  save.mockResolvedValueOnce(undefined as unknown as PartnerItemTermsOutcome);
  await act(async () => {
    expect((await view.result.current.submit(key)).status).toBe('unknown');
  });
  expect(view.result.current.draftFor(key)).not.toBeNull();
});
it('미확정 결과를 조회해 저장을 확인해도 옛 초안을 자동으로 닫거나 다시 편집하지 않는다', async () => {
  const save = vi.fn(async (_input: PartnerItemTermsInput): Promise<PartnerItemTermsOutcome> => ({
    status: 'unknown',
    message: '응답 유실',
    nextAction: '결과 확인'
  }));
  const reference = {
    companyId: 'taebaek' as const,
    targetId: 'actual-link',
    itemId: 'item',
    partnerId: 'partner',
    direction: 'out' as const,
    planId: 'original-plan'
  };
  const view = renderHook(() => usePartnerItemTermsEditor({
    scopeKey: 'A',
    onSave: save,
    inspect: async () => ({
      status: 'saved'
    })
  }));
  let key!: string;
  act(() => {
    key = view.result.current.open(target);
  });
  act(() => view.result.current.change(key, 'price', '150'));
  await act(async () => {
    await view.result.current.submit(key);
  });
  await act(async () => {
    expect((await view.result.current.inspect(reference)).status).toBe('saved');
  });
  expect(view.result.current.draftFor(key)?.price).toBe('150');
  expect(view.result.current.outcomes[key].requiresReopen).toBe(true);
  expect(view.result.current.locked(key)).toBe(true);
  act(() => view.result.current.reopen({
    ...target,
    opening: {
      ...target.opening!,
      price: 150
    }
  }));
  expect(view.result.current.locked(key)).toBe(false);
});
it('단가 편집은 열림 원행의 과세·계정을 함께 넘기고 과세만 바꿔도 원래 단가를 유지한다', async () => {
  const save = vi.fn(async (_input: PartnerItemTermsInput): Promise<PartnerItemTermsOutcome> => ({
    status: 'saved'
  }));
  const view = renderHook(() => usePartnerItemTermsEditor({
    scopeKey: 'A',
    onSave: save
  }));
  const original: PartnerItemTermsTarget = {
    ...target,
    opening: {
      ...target.opening!,
      price: 1200,
      taxType: '면세',
      Account_Code: '404'
    }
  };
  let key!: string;
  act(() => {
    key = view.result.current.open(original);
  });
  act(() => view.result.current.change(key, 'price', '2400'));
  await act(async () => {
    await view.result.current.submit(key);
  });
  expect(save.mock.calls[0][0].terms).toEqual({
    price: 2400,
    taxType: '면세',
    Account_Code: '404'
  });
  act(() => {
    view.result.current.reopen(original, {
      taxType: '과세'
    }, 'terms');
  });
  await act(async () => {
    await view.result.current.submit(key);
  });
  expect(save.mock.calls[1][0].terms).toEqual({
    price: 1200,
    taxType: '과세',
    Account_Code: '404'
  });
});

it('사본 정리는 현재초안을 닫거나 업무저장하지 않고 원문그대로 정리 후 명시재열기만 허용한다',async()=>{
 const reference={companyId:'taebaek' as const,planId:'copy-plan',targetId:'actual-link',itemId:'item',partnerId:'partner',direction:'out' as const};let refs:{key:string;reference:typeof reference;readable:boolean;observedLocalText:string}[]=[];const save=vi.fn(async():Promise<PartnerItemTermsOutcome>=>({status:'unknown',message:'미확인',nextAction:'결과확인'})),discard=vi.fn(async()=>{refs=[];return {status:'cleared' as const,message:'이 기기 사본만 정리했습니다.'};});const hook=renderHook(()=>usePartnerItemTermsEditor({scopeKey:'A',onSave:save,readReferences:()=>refs,discard}));let key='';act(()=>{key=hook.result.current.open(target);hook.result.current.change(key,'price','999');});act(()=>{refs=[{key:'copy',reference,readable:true,observedLocalText:'observed-raw'}];hook.result.current.refresh();});await act(async()=>{await hook.result.current.discard(reference,'observed-raw');});expect(discard).toHaveBeenCalledWith(reference,'observed-raw');expect(hook.result.current.draftFor(key)?.price).toBe('999');expect(save).not.toHaveBeenCalled();expect(hook.result.current.message).toContain('사본만');act(()=>hook.result.current.reopen({...target,opening:{...target.opening!,price:222}}));expect(hook.result.current.draftFor(key)?.price).toBe('222');
});
it('실unknown 후 같은사본정리완료는 잠금영구유지없이 현재값을 명시재열게 한다',async()=>{
 const reference={companyId:'taebaek' as const,planId:'same-plan',targetId:'actual-link',itemId:'item',partnerId:'partner',direction:'out' as const};let refs:{key:string;reference:typeof reference;readable:boolean;observedLocalText:string}[]=[];const save=vi.fn(async():Promise<PartnerItemTermsOutcome>=>{refs=[{key:'same',reference,readable:true,observedLocalText:'same-raw'}];return {status:'unknown',message:'미확인',nextAction:'조회'};});const hook=renderHook(()=>usePartnerItemTermsEditor({scopeKey:'A',onSave:save,readReferences:()=>refs,discard:async()=>{refs=[];return {status:'cleared',message:'기기사본정리'};}}));let key='';act(()=>{key=hook.result.current.open(target);hook.result.current.change(key,'price','777');});await act(async()=>{await hook.result.current.submit(key);});expect(hook.result.current.canCancelEdit(key)).toBe(false);await act(async()=>{await hook.result.current.discard(reference,'same-raw');});expect(hook.result.current.draftFor(key)?.price).toBe('777');expect(hook.result.current.canCancelEdit(key)).toBe(true);act(()=>hook.result.current.reopen({...target,opening:{...target.opening!,price:333}}));expect(hook.result.current.draftFor(key)?.price).toBe('333');expect(save).toHaveBeenCalledOnce();
});
