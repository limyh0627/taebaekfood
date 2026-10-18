// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
vi.mock('../../../shared/firebase', () => ({
  auth: {
    currentUser: null
  },
  authReady: Promise.resolve(),
  functions: {},
  db: {}
}));
import { useQuotationEditor, type QuotationEditorPorts } from './useQuotationEditor';
import { quotationSnapshot } from '../../../shared/quotationCommand';
import { quotationFromOpening, type QuotationWriteInput, type QuotationPrepared, type QuotationOutcome, type PendingQuotation } from '../infrastructure/quotationWrites';
import type { Quotation } from '../domain/quotation';
import type { Item, PartnerItem } from '../../../shared/types';
import { buildBomIndex } from '../../../shared/bomIndex';
import { buildPackIndex } from '../../../shared/packIndex';
import { quoteTotals } from '../../../shared/quoteTotals';
const quote: Quotation = {
  id: 'old',
  companyId: 'taebaek',
  quoteNo: 'Q261019-02',
  date: '2026-10-19',
  validUntil: '2026-11-18',
  partnerId: '',
  partnerName: '문의처',
  lines: [{
    name: '기존 품목',
    spec: '병',
    qty: 2,
    price: 110,
    cost: 25,
    isTaxExempt: false
  }],
  totalSupply: 200,
  totalTax: 20,
  totalAmount: 220,
  createdAt: 'old-created',
  createdBy: '원작성자'
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
  let id = 0,
    plan = 0;
  const stored = new Map<string, PendingQuotation>();
  const capture = vi.fn(async (selected: Quotation) => ({
    reference: {
      companyId: 'taebaek' as const,
      targetId: selected.id,
      planId: 'open-' + selected.id
    },
    snapshot: quotationSnapshot(selected),
    expectedVersion: '123:000000007'
  }));
  const prepare = vi.fn(async (input: QuotationWriteInput): Promise<QuotationPrepared> => {
    const reference = input.opening?.reference ?? {
      companyId: 'taebaek' as const,
      targetId: input.targetId,
      planId: 'plan-' + ++plan
    };
    stored.set(reference.planId, {
      reference,
      action: input.action,
      description: '합성 견적'
    });
    return {
      status: 'ready',
      reference
    };
  });
  const apply = vi.fn(async (reference: Parameters<QuotationEditorPorts['apply']>[0]): Promise<QuotationOutcome> => {
    stored.delete(reference.planId);
    return {
      status: 'saved'
    };
  });
  const inspect = vi.fn(async (reference: Parameters<QuotationEditorPorts['inspect']>[0]): Promise<QuotationOutcome> => {
    stored.delete(reference.planId);
    return {
      status: 'saved'
    };
  });
  const cancel = vi.fn(async (reference: Parameters<QuotationEditorPorts['cancel']>[0]): Promise<QuotationOutcome> => {
    stored.delete(reference.planId);
    return {
      status: 'cancelled',
      message: '중단 확인'
    };
  });
  const ports: QuotationEditorPorts = {
    capture,
    prepare,
    apply,
    inspect,
    cancel,
    pending: () => [...stored.values()],
    references: () => [...stored.values()].map(row => ({
      reference: row.reference,
      readable: true,
      key: row.reference.planId
    }))
  };
  const onSaved = vi.fn<(q: Quotation) => void>(),
    onDeleted = vi.fn<(id: string) => void>();
  const options = {
    companyId: 'taebaek' as const,
    actorUid: 'uid-a',
    currentUser: {
      id: 'employee-a',
      name: '작성자'
    },
    quotes: [quote],
    items: [] as Item[],
    ports,
    id: () => `new-${++id}`,
    onSaved,
    onDeleted
  };
  return {
    options,
    ports,
    capture,
    prepare,
    apply,
    inspect,
    cancel,
    stored,
    onSaved,
    onDeleted
  };
}
const fill = (hook: ReturnType<typeof useQuotationEditor>) => {
  hook.patchForm({
    date: '2026-10-19',
    partnerId: '',
    partnerName: ' 새 문의처 ',
    recipientPhone: ' ',
    validUntil: '',
    attention: '',
    deliveryTerms: ' ',
    paymentTerms: '',
    note: ''
  });
  hook.patchLine(0, {
    name: '직접 품목',
    spec: '병',
    qty: 2.5,
    price: 110,
    cost: 20,
    isTaxExempt: false,
    itemId: undefined,
    unit: undefined,
    note: undefined
  });
};
describe('견적 실제 초안과 저장 수명', () => {
  it('신규 고정 ID·번호와 공용 합계를 만들고 undefined 선택필드는 제거하며 ACK 뒤에만 닫는다', async () => {
    const f = fixture(),
      wait = deferred<QuotationOutcome>();
    f.apply.mockImplementation(() => wait.promise);
    const view = renderHook(() => useQuotationEditor(f.options));
    await act(async () => {
      await view.result.current.openNew();
    });
    act(() => fill(view.result.current));
    const id = view.result.current.session!.targetId;
    let saving!: Promise<boolean>;
    act(() => {
      saving = view.result.current.save();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(view.result.current.open).toBe(true);
    expect(view.result.current.busy).toBe(true);
    expect(view.result.current.close()).toBe(false);
    expect(await view.result.current.openNew()).toBe(false);
    const sent = f.prepare.mock.calls[0][0],
      saved = sent.snapshot!;
    expect(saved.id).toBe(id);
    expect(saved.quoteNo).toBe('Q261019-03');
    expect(saved.partnerName).toBe('새 문의처');
    expect(saved).toMatchObject({
      totalSupply: quoteTotals(saved.lines).supply,
      totalTax: quoteTotals(saved.lines).tax,
      totalAmount: quoteTotals(saved.lines).total
    });
    for (const key of ['validUntil', 'recipientPhone', 'attention', 'deliveryTerms', 'paymentTerms', 'note']) expect(saved).not.toHaveProperty(key);
    for (const key of ['itemId', 'unit', 'note']) expect(saved.lines[0]).not.toHaveProperty(key);
    await act(async () => {
      wait.resolve({
        status: 'saved'
      });
      expect(await saving).toBe(true);
    });
    expect(view.result.current.open).toBe(false);
    expect(f.onSaved).toHaveBeenCalledWith(saved);
  });
  it('수정 open은 원래 선택을 한 번 확인하고 구독이 바뀌어도 opening·번호·줄 미지필드를 바꾸지 않는다', async () => {
    const f = fixture(),
      opaque = {
        ...quote,
        lines: [{
          ...quote.lines[0],
          legacy: {
            keep: [1, 2]
          }
        }]
      },
      view = renderHook(({
        quotes
      }) => useQuotationEditor({
        ...f.options,
        quotes
      }), {
        initialProps: {
          quotes: [opaque]
        }
      });
    await act(async () => {
      await view.result.current.openEdit(opaque);
    });
    view.rerender({
      quotes: [{
        ...opaque,
        quoteNo: 'Q-new',
        note: '외부 수정'
      }]
    });
    act(() => view.result.current.patchForm({
      note: '내 수정'
    }));
    await act(async () => {
      expect(await view.result.current.save()).toBe(true);
    });
    expect(f.capture).toHaveBeenCalledTimes(1);
    const input = f.prepare.mock.calls[0][0];
    expect(input.opening?.expectedVersion).toBe('123:000000007');
    expect(input.snapshot).toMatchObject({
      id: quote.id,
      quoteNo: quote.quoteNo,
      createdAt: quote.createdAt,
      note: '내 수정',
      lines: [{
        legacy: {
          keep: [1, 2]
        }
      }]
    });
  });
  it('열기 불일치와 입력 검증 거절은 writer0이며 직접 초안을 수정할 수 있다', async () => {
    const f = fixture();
    f.capture.mockRejectedValueOnce(Error('열기 중 원문 변경'));
    const view = renderHook(() => useQuotationEditor(f.options));
    await act(async () => {
      expect(await view.result.current.openEdit(quote)).toBe(false);
    });
    expect(view.result.current.locked).toBe(true);
    expect(view.result.current.message).toContain('원문 변경');
    expect(f.prepare).not.toHaveBeenCalled();
    await act(async () => {
      await view.result.current.openNew();
      expect(await view.result.current.save()).toBe(false);
    });
    expect(view.result.current.locked).toBe(false);
    act(() => fill(view.result.current));
    await act(async () => {
      expect(await view.result.current.save()).toBe(true);
    });
  });
  it('unknown은 같은 요청을 유지하고 새 저장을 막되 보기닫기 뒤 다른 초안은 옛 inspect가 닫지 않는다', async () => {
    const f = fixture();
    f.apply.mockResolvedValueOnce({
      status: 'unknown',
      message: '응답 유실',
      nextAction: '확인'
    });
    const view = renderHook(() => useQuotationEditor(f.options));
    await act(async () => {
      await view.result.current.openNew();
    });
    act(() => fill(view.result.current));
    await act(async () => {
      expect(await view.result.current.save()).toBe(false);
    });
    const reference = view.result.current.session!.reference!;
    expect(view.result.current.locked).toBe(true);
    expect(await view.result.current.newFromDraft()).toBe(false);
    expect(await view.result.current.save()).toBe(false);
    expect(f.apply).toHaveBeenCalledTimes(1);
    act(() => {
      expect(view.result.current.close()).toBe(true);
    });
    await act(async () => {
      await view.result.current.openNew();
    });
    act(() => view.result.current.patchForm({
      partnerName: '다른 초안'
    }));
    await act(async () => {
      await view.result.current.inspect(reference);
    });
    expect(view.result.current.open).toBe(true);
    expect(view.result.current.form.partnerName).toBe('다른 초안');
    expect(view.result.current.sessionMessage).toBe('');
    expect(f.onSaved).not.toHaveBeenCalled();
  });
  it('같은회사 UID 변경은 첫 렌더부터 옛 초안을 숨기고 늦은 ACK가 새 초안을 닫지 않는다', async () => {
    const f = fixture(),
      wait = deferred<QuotationOutcome>();
    f.apply.mockImplementation(() => wait.promise);
    const view = renderHook(({
      uid
    }) => useQuotationEditor({
      ...f.options,
      actorUid: uid
    }), {
      initialProps: {
        uid: 'uid-a'
      }
    });
    await act(async () => {
      await view.result.current.openNew();
    });
    act(() => fill(view.result.current));
    let saving!: Promise<boolean>;
    act(() => {
      saving = view.result.current.save();
    });
    await act(async () => {
      await Promise.resolve();
    });
    view.rerender({
      uid: 'uid-b'
    });
    expect(view.result.current.open).toBe(false);
    expect(view.result.current.form.partnerName).toBe('');
    await act(async () => {
      await view.result.current.openNew();
    });
    act(() => view.result.current.patchForm({
      partnerName: 'B 초안'
    }));
    await act(async () => {
      wait.resolve({
        status: 'saved'
      });
      expect(await saving).toBe(false);
    });
    expect(view.result.current.open).toBe(true);
    expect(view.result.current.form.partnerName).toBe('B 초안');
    expect(view.result.current.message).not.toContain('확인됐');
    expect(f.onSaved).not.toHaveBeenCalled();
  });
  it('확정 CAS 거절은 작성값·원인을 남기고 현재자료 재열기나 새견적으로 명시 재작성할 수 있다', async () => {
    const f = fixture();
    f.apply.mockImplementationOnce(async reference => {
      f.stored.delete(reference.planId);
      return {
        status: 'rejected',
        requiresReopen: true,
        message: '버전 변경',
        nextAction: '현재 견적 다시 열기'
      };
    });
    const view = renderHook(() => useQuotationEditor(f.options));
    await act(async () => {
      await view.result.current.openEdit(quote);
    });
    act(() => view.result.current.patchForm({
      note: '보존된 작성값'
    }));
    await act(async () => {
      expect(await view.result.current.save()).toBe(false);
    });
    expect(view.result.current.form.note).toBe('보존된 작성값');
    expect(view.result.current.sessionMessage).toContain('버전 변경');
    expect(await view.result.current.save()).toBe(false);
    await act(async () => {
      expect(await view.result.current.newFromDraft()).toBe(true);
    });
    expect(view.result.current.form.note).toBe('보존된 작성값');
    expect(view.result.current.locked).toBe(false);
    expect(view.result.current.editingId).toBe(null);
    await act(async () => {
      expect(await view.result.current.save()).toBe(true);
    });
    await act(async () => {
      expect(await view.result.current.openEdit(quote)).toBe(true);
    });
    expect(view.result.current.form.note).toBe('');
    expect(view.result.current.locked).toBe(false);
  });
  it('삭제 준비만으로 삭제하지 않고 정상취소 fence ACK 뒤에만 닫으며 삭제 ACK 때만 목록을 갱신한다', async () => {
    const f = fixture(),
      wait = deferred<QuotationOutcome>();
    f.cancel.mockImplementation(() => wait.promise);
    const view = renderHook(() => useQuotationEditor(f.options));
    await act(async () => {
      expect(await view.result.current.requestDelete(quote)).toBe(true);
    });
    expect(view.result.current.deleteSession?.ready).toBe(true);
    expect(f.apply).not.toHaveBeenCalled();
    let closing!: Promise<boolean>;
    act(() => {
      closing = view.result.current.closeDelete();
    });
    expect(view.result.current.deleteSession).not.toBe(null);
    await act(async () => {
      wait.resolve({
        status: 'cancelled',
        message: '중단'
      });
      expect(await closing).toBe(true);
    });
    expect(view.result.current.deleteSession).toBe(null);
    expect(f.onDeleted).not.toHaveBeenCalled();
    f.stored.clear();
    await act(async () => {
      await view.result.current.requestDelete(quote);
      expect(await view.result.current.confirmDelete()).toBe(true);
    });
    expect(view.result.current.deleteSession).toBe(null);
    expect(f.onDeleted).toHaveBeenCalledWith(quote.id);
  });
  it('삭제 unknown은 명시 재전송0·보기닫기 보존이고 손상·고아 ref도 복구할 수 있다', async () => {
    const f = fixture();
    f.apply.mockResolvedValueOnce({
      status: 'unknown',
      message: '삭제 유실',
      nextAction: '확인'
    });
    const view = renderHook(() => useQuotationEditor(f.options));
    await act(async () => {
      await view.result.current.requestDelete(quote);
      expect(await view.result.current.confirmDelete()).toBe(false);
    });
    const reference = view.result.current.deleteSession!.reference!;
    expect(view.result.current.deleteSession?.ready).toBe(false);
    expect(await view.result.current.confirmDelete()).toBe(false);
    await act(async () => {
      expect(await view.result.current.closeDelete()).toBe(true);
    });
    expect(f.cancel).not.toHaveBeenCalled();
    await act(async () => {
      await view.result.current.inspect(reference);
    });
    expect(f.inspect).toHaveBeenCalledWith(reference, expect.any(Function));
    expect(f.onDeleted).not.toHaveBeenCalled();
  });
  it('박스단가·원가·과세 선택은 기존 정본을 재사용하고 저장 전에도 훅의 실제 줄을 갱신한다', async () => {
    const f = fixture(),
      items = [{
        id: 'box',
        name: '상자',
        type: 'product',
        unit: '박스'
      }, {
        id: 'loose',
        name: '낱개',
        type: 'product'
      }] as Item[],
      prices = [{
        id: 'p',
        itemId: 'loose',
        partnerId: 'client',
        Direction: 'out',
        price: 1000,
        taxType: '면세'
      }] as PartnerItem[];
    const inputs = {
      bom: buildBomIndex(items, [{
        parent_id: 'box',
        child_id: 'loose',
        quantity: 20
      }]),
      pack: buildPackIndex([])
    };
    const view = renderHook(() => useQuotationEditor({
      ...f.options,
      items,
      partnerItems: prices,
      orderUnitInputs: inputs,
      costOf: () => 123.4
    }));
    await act(async () => {
      await view.result.current.openNew();
    });
    act(() => {
      view.result.current.patchForm({
        partnerId: 'client',
        partnerName: '거래처'
      });
      view.result.current.selectItem(0, items[0]);
    });
    expect(view.result.current.form.lines[0]).toMatchObject({
      itemId: 'box',
      name: '상자',
      price: 20000,
      cost: 123,
      unit: '박스'
    });
    expect(f.prepare).not.toHaveBeenCalled();
  });
  it('저장 필드가 부족한 기존 견적도 삭제 준비를 열고 정상 취소할 수 있다', async () => {
    const f = fixture(),
      legacy = {
        ...quote,
        lines: [{
          name: '옛 품목',
          qty: 1,
          price: 1,
          isTaxExempt: true
        }]
      } as unknown as Quotation;
    delete (legacy as Partial<Quotation>).createdAt;
    const view = renderHook(() => useQuotationEditor(f.options));
    await act(async () => {
      expect(await view.result.current.requestDelete(legacy)).toBe(true);
    });
    expect(view.result.current.deleteSession?.ready).toBe(true);
    const input = f.prepare.mock.calls[0][0];
    expect(input.action).toBe('delete');
    expect(input).not.toHaveProperty('snapshot');
    expect(f.apply).not.toHaveBeenCalled();
    await act(async () => {
      expect(await view.result.current.closeDelete()).toBe(true);
    });
    expect(view.result.current.deleteSession).toBe(null);
  });
  it('삭제 준비 중단의 응답 유실은 창을 보존하며 첫 미전송 거절은 초안 수정을 허용한다', async () => {
    const f = fixture();
    f.cancel.mockResolvedValueOnce({
      status: 'unknown',
      message: '중단 유실',
      nextAction: '확인'
    });
    const view = renderHook(() => useQuotationEditor(f.options));
    await act(async () => {
      await view.result.current.requestDelete(quote);
      expect(await view.result.current.closeDelete()).toBe(false);
    });
    expect(view.result.current.deleteSession).not.toBe(null);
    await act(async () => {
      expect(await view.result.current.closeDelete()).toBe(true);
    });
    f.prepare.mockResolvedValueOnce({
      status: 'rejected',
      outcome: {
        status: 'rejected',
        message: '기기 보관 실패',
        nextAction: '아직 전송하지 않음'
      }
    });
    await act(async () => {
      await view.result.current.openNew();
    });
    act(() => fill(view.result.current));
    await act(async () => {
      expect(await view.result.current.save()).toBe(false);
    });
    expect(view.result.current.locked).toBe(false);
    act(() => view.result.current.patchForm({
      note: '수정 가능'
    }));
    expect(view.result.current.form.note).toBe('수정 가능');
    expect(f.apply).not.toHaveBeenCalled();
  });
});
