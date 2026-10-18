import { describe, expect, it, vi } from 'vitest';
import { baseRawName } from '../../../constants/formula';
import { saveItemEditorRelations as executeRelations, type SaveItemEditorRelationsInput } from './saveItemEditorRelations';
import { createItemEditorProgress } from '../application/itemEditorSave';
import type { PartnerItem } from '../../../shared/types';
const saveItemEditorRelations = (input: SaveItemEditorRelationsInput) => {
  const progress = createItemEditorProgress(input.itemId);
  progress.confirmedStageIds.push('primary');
  return executeRelations({
    onUpsertPartnerItem: async () => {},
    onDeletePartnerItem: async () => {},
    ...input
  }, progress, () => true);
};
const input = (): SaveItemEditorRelationsInput => ({
  formData: {
    type: 'raw',
    name: '합성 원료 20kg',
    품목: '',
    inPartnerIds: ['keep', 'new']
  },
  initialData: {
    type: 'raw',
    name: '이전 원료',
    품목: ''
  },
  formulaRows: [{
    child_name: '원물',
    yield_pct: 82.5
  }, {
    child_name: '',
    yield_pct: 99
  }, {
    child_name: '빈 수율',
    yield_pct: 0
  }],
  itemId: 'item',
  partnerIn: [{
    id: 'kept-doc',
    itemId: 'item',
    partnerId: 'keep',
    Direction: 'in',
    price: 0,
    taxType: null
  }, {
    id: 'removed-doc',
    itemId: 'item',
    partnerId: 'removed',
    Direction: 'in',
    price: 100,
    taxType: '면세'
  }, {
    id: 'other-item',
    itemId: 'other',
    partnerId: 'removed',
    Direction: 'in'
  }, {
    id: 'empty-partner',
    itemId: 'item',
    partnerId: '',
    Direction: 'in'
  }]
});
describe('품목 저장 후 배합·매입 연결', () => {
  it('배합 저장이 끝난 다음 선택 순서대로 연결하고 해제한 동일 품목 연결만 삭제한다', async () => {
    const data = input();
    const original = structuredClone(data);
    let finish!: () => void;
    const events: string[] = [];
    const formula = vi.fn(() => new Promise<void>(resolve => {
      finish = resolve;
    }));
    const upsert = vi.fn(async (row: PartnerItem) => {
      events.push(row.id);
    });
    const remove = vi.fn(async (id: string) => {
      events.push(id);
    });
    const pending = saveItemEditorRelations({
      ...data,
      onSaveItemFormula: formula,
      onUpsertPartnerItem: upsert,
      onDeletePartnerItem: remove
    });
    expect(formula).toHaveBeenCalledWith(baseRawName(data.formData.name), [{
      child_name: '원물',
      yield_rate: .825,
      ratio: 1
    }, {
      child_name: '빈 수율',
      yield_rate: 0,
      ratio: 1
    }], baseRawName('이전 원료'));
    expect(upsert).not.toHaveBeenCalled();
    finish();
    await pending;
    expect(events).toEqual(['kept-doc', 'item_new_in', 'removed-doc']);
    expect(upsert.mock.calls.map(([row]) => row)).toEqual([{
      id: 'kept-doc',
      itemId: 'item',
      partnerId: 'keep',
      Direction: 'in',
      price: 0,
      taxType: null
    }, {
      id: 'item_new_in',
      itemId: 'item',
      partnerId: 'new',
      Direction: 'in',
      price: undefined,
      taxType: undefined
    }]);
    expect(data).toEqual(original);
  });
  it('배합 실패는 연결 변경보다 먼저 전파한다', async () => {
    const upsert = vi.fn();
    const remove = vi.fn();
    const result = await saveItemEditorRelations({
      ...input(),
      onSaveItemFormula: vi.fn().mockRejectedValue(new Error('합성 실패')),
      onUpsertPartnerItem: upsert,
      onDeletePartnerItem: remove
    });
    expect(result.outcome).toMatchObject({
      status: 'partial',
      message: expect.stringContaining('합성 실패')
    });
    expect(result.progress.unknownStageId).toBe('formula');
    expect(upsert).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
  it.each(['raw', 'wip'])('%s 배합의 같은 키는 이전 키를 넘기지 않고 빈 배합도 저장한다', async type => {
    const data = input();
    data.formData.type = type;
    data.initialData = {
      ...data.formData
    };
    data.formulaRows = [];
    const formula = vi.fn().mockResolvedValue(undefined);
    await saveItemEditorRelations({
      ...data,
      onSaveItemFormula: formula
    });
    expect(formula).toHaveBeenCalledWith(baseRawName(data.formData.name), [], undefined);
  });
  it('기존 완제품 품목 키를 이전 키로 전달한다', async () => {
    const data = input();
    data.initialData = {
      type: 'product',
      name: '표시 이름',
      품목: '기존 품목 키'
    };
    const formula = vi.fn().mockResolvedValue(undefined);
    await saveItemEditorRelations({
      ...data,
      onSaveItemFormula: formula
    });
    expect(formula.mock.calls[0][2]).toBe('기존 품목 키');
  });
  it.each(['product', 'submaterial', 'service'])('%s는 배합을 저장하지 않지만 선택한 매입 연결은 처리한다', async type => {
    const data = input();
    data.formData.type = type;
    const formula = vi.fn();
    const upsert = vi.fn(async () => {});
    await saveItemEditorRelations({
      ...data,
      onSaveItemFormula: formula,
      onUpsertPartnerItem: upsert
    });
    expect(formula).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledTimes(2);
  });
  it('upsert가 없으면 삭제 콜백만 있어도 삭제하지 않는다', async () => {
    const remove = vi.fn();
    await saveItemEditorRelations({
      ...input(),
      onUpsertPartnerItem: undefined,
      onDeletePartnerItem: remove
    });
    expect(remove).not.toHaveBeenCalled();
  });
  it('매입 연결 ACK를 받은 뒤 다음 연결과 삭제를 시작한다', async () => {
    let finish!: () => void;
    const upsert = vi.fn((_row: PartnerItem) => new Promise<void>(resolve => {
        finish = resolve;
      })),
      remove = vi.fn(async (_id: string) => {});
    const pending = saveItemEditorRelations({
      ...input(),
      formData: {
        ...input().formData,
        type: 'product'
      },
      onUpsertPartnerItem: upsert,
      onDeletePartnerItem: remove
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(remove).not.toHaveBeenCalled();
    finish();
    expect((await pending).outcome.status).toBe('saved');
    expect(remove).toHaveBeenCalledWith('removed-doc');
  });
});
it('관계 중간 ACK 뒤 실패하면 해당 연결을 미확정으로 보존하고 다음 삭제를 보내지 않는다', async () => {
  const data = input(),
    progress = createItemEditorProgress(data.itemId);
  progress.confirmedStageIds.push('primary');
  const upsert = vi.fn(async (row: PartnerItem) => {
      if (row.partnerId === 'new') throw Error('연결 응답 유실');
    }),
    remove = vi.fn(async (_id: string) => {});
  const call = () => executeRelations({
    ...data,
    formData: {
      ...data.formData,
      type: 'product'
    },
    onUpsertPartnerItem: upsert,
    onDeletePartnerItem: remove
  }, progress, () => true);
  expect((await call()).outcome.status).toBe('partial');
  expect(progress.confirmedStageIds).toEqual(['primary', 'partner-upsert:kept-doc']);
  expect(progress.unknownStageId).toBe('partner-upsert:item_new_in');
  expect(remove).not.toHaveBeenCalled();
  await call();
  expect(upsert).toHaveBeenCalledTimes(2);
  expect(remove).not.toHaveBeenCalled();
});
it('주 저장 ACK가 없으면 관계를 보내지 않는다', async () => {
  const upsert = vi.fn(async (_row: PartnerItem) => {});
  const result = await executeRelations({
    ...input(),
    onUpsertPartnerItem: upsert
  }, createItemEditorProgress('item'), () => true);
  expect(result.outcome.status).toBe('rejected');
  expect(upsert).not.toHaveBeenCalled();
});
it('필요한 연결 포트가 없으면 완료로 꾸미지 않고 미시작 partial로 남긴다', async () => {
  const data = input(),
    progress = createItemEditorProgress(data.itemId);
  progress.confirmedStageIds.push('primary');
  const formula = vi.fn(async () => {});
  expect((await executeRelations({
    ...data,
    onSaveItemFormula: formula
  }, progress, () => true)).outcome.status).toBe('partial');
  expect(formula).not.toHaveBeenCalled();
  expect(progress.unknownStageId).toBeUndefined();
  expect(progress.confirmedStageIds).toEqual(['primary']);
});
