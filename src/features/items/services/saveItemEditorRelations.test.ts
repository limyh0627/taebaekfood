import { describe, expect, it, vi } from 'vitest';
import { baseRawName } from '../../../constants/formula';
import { saveItemEditorRelations, type SaveItemEditorRelationsInput } from './saveItemEditorRelations';

const input = (): SaveItemEditorRelationsInput => ({
  formData: { type: 'raw', name: '합성 원료 20kg', 품목: '', inPartnerIds: ['keep', 'new'] },
  initialData: { type: 'raw', name: '이전 원료', 품목: '' },
  formulaRows: [{ child_name: '원물', yield_pct: 82.5 }, { child_name: '', yield_pct: 99 }, { child_name: '빈 수율', yield_pct: 0 }],
  itemId: 'item',
  partnerIn: [
    { id: 'kept-doc', itemId: 'item', partnerId: 'keep', Direction: 'in', price: 0, taxType: null },
    { id: 'removed-doc', itemId: 'item', partnerId: 'removed', Direction: 'in', price: 100, taxType: '면세' },
    { id: 'other-item', itemId: 'other', partnerId: 'removed', Direction: 'in' },
    { id: 'empty-partner', itemId: 'item', partnerId: '', Direction: 'in' },
  ],
});

describe('품목 저장 후 배합·매입 연결', () => {
  it('배합 저장이 끝난 다음 선택 순서대로 연결하고 해제한 동일 품목 연결만 삭제한다', async () => {
    const data = input();
    const original = structuredClone(data);
    let finish!: () => void;
    const events: string[] = [];
    const formula = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const upsert = vi.fn((row) => { events.push(row.id); });
    const remove = vi.fn((id) => { events.push(id); });
    const pending = saveItemEditorRelations({ ...data, onSaveItemFormula: formula, onUpsertPartnerItem: upsert, onDeletePartnerItem: remove });
    expect(formula).toHaveBeenCalledWith(baseRawName(data.formData.name), [
      { child_name: '원물', yield_rate: .825, ratio: 1 },
      { child_name: '빈 수율', yield_rate: 0, ratio: 1 },
    ], baseRawName('이전 원료'));
    expect(upsert).not.toHaveBeenCalled();
    finish();
    await pending;
    expect(events).toEqual(['kept-doc', 'item_new_in', 'removed-doc']);
    expect(upsert.mock.calls.map(([row]) => row)).toEqual([
      { id: 'kept-doc', itemId: 'item', partnerId: 'keep', Direction: 'in', price: 0, taxType: null },
      { id: 'item_new_in', itemId: 'item', partnerId: 'new', Direction: 'in', price: undefined, taxType: undefined },
    ]);
    expect(data).toEqual(original);
  });

  it('배합 실패는 연결 변경보다 먼저 전파한다', async () => {
    const upsert = vi.fn(); const remove = vi.fn();
    await expect(saveItemEditorRelations({ ...input(), onSaveItemFormula: vi.fn().mockRejectedValue(new Error('합성 실패')), onUpsertPartnerItem: upsert, onDeletePartnerItem: remove })).rejects.toThrow('합성 실패');
    expect(upsert).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  });

  it.each(['raw', 'wip'])('%s 배합의 같은 키는 이전 키를 넘기지 않고 빈 배합도 저장한다', async type => {
    const data = input(); data.formData.type = type; data.initialData = { ...data.formData }; data.formulaRows = [];
    const formula = vi.fn().mockResolvedValue(undefined);
    await saveItemEditorRelations({ ...data, onSaveItemFormula: formula });
    expect(formula).toHaveBeenCalledWith(baseRawName(data.formData.name), [], undefined);
  });

  it('기존 완제품 품목 키를 이전 키로 전달한다', async () => {
    const data = input(); data.initialData = { type: 'product', name: '표시 이름', 품목: '기존 품목 키' };
    const formula = vi.fn().mockResolvedValue(undefined);
    await saveItemEditorRelations({ ...data, onSaveItemFormula: formula });
    expect(formula.mock.calls[0][2]).toBe('기존 품목 키');
  });

  it.each(['product', 'submaterial', 'service'])('%s는 배합을 저장하지 않지만 선택한 매입 연결은 처리한다', async type => {
    const data = input(); data.formData.type = type;
    const formula = vi.fn(); const upsert = vi.fn();
    await saveItemEditorRelations({ ...data, onSaveItemFormula: formula, onUpsertPartnerItem: upsert });
    expect(formula).not.toHaveBeenCalled(); expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('upsert가 없으면 삭제 콜백만 있어도 삭제하지 않는다', async () => {
    const remove = vi.fn();
    await saveItemEditorRelations({ ...input(), onDeletePartnerItem: remove });
    expect(remove).not.toHaveBeenCalled();
  });

  it('void 연결 콜백의 반환 Promise를 기다리도록 바꾸지 않는다', async () => {
    const upsert = vi.fn(() => new Promise<void>(() => {}));
    const remove = vi.fn(() => new Promise<void>(() => {}));
    await saveItemEditorRelations({ ...input(), onUpsertPartnerItem: upsert, onDeletePartnerItem: remove });
    expect(upsert).toHaveBeenCalledTimes(2); expect(remove).toHaveBeenCalledWith('removed-doc');
  });
});
