/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StockUseRow } from './stockUseRows';

const notice = vi.hoisted(() => vi.fn(async (_message: string, _title?: string) => {}));
const confirm = vi.hoisted(() => vi.fn(async (_message: string) => true));
vi.mock('../../shared/components/appDialog', () => ({ appNotice: notice, appConfirm: confirm }));

import StockUseModal, { GoodsCommittedContext } from './StockUseModal';

const rows: StockUseRow[] = [{
  idx: 0, itemId: 'box-a', name: '참기름 박스', unitLabel: '박스', ordered: 3, stock: 2,
}];

beforeEach(() => notice.mockClear());

describe('재고 사용 확인창의 저장 실패', () => {
  it('DB에서 뒤늦게 재고 부족이 확인되면 공통 알림으로 이유를 보여 준다', async () => {
    const onConfirm = vi.fn(async () => { throw new Error('참기름 박스 재고가 부족합니다. 현재 1, 차감 2'); });
    render(<StockUseModal partnerName="거래처" rows={rows} onConfirm={onConfirm} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '부족분 생산하고 작업완료' }));

    await waitFor(() => expect(notice).toHaveBeenCalledWith(
      '참기름 박스 재고가 부족합니다. 현재 1, 차감 2', '재고 부족',
    ));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('성공하면 실패 알림을 띄우지 않는다', async () => {
    const onConfirm = vi.fn(async () => {});
    render(<StockUseModal partnerName="거래처" rows={rows} onConfirm={onConfirm} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '부족분 생산하고 작업완료' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    expect(notice).not.toHaveBeenCalled();
  });
});

it('부분 완료와 고객 청구에 포함되지 않는 추가 재고를 서버 단위 그대로 전달한다', async () => {
  const hash = 'a'.repeat(64);
  const unit = { version: 1, measureId: hash, order: { kind: 'box-count', label: '박스', orderedValue: 4 }, sourceLine: { quantity: 48, isBoxUnit: true, boxQuantity: 4, unitsPerBox: 12 }, stock: { itemId: 'a', label: '박스', quantityKind:'count', orderedValue: 4, unitsPerOrderUnit: 1 }, basis: { kind: 'box-stock-bom', orderUnitEvidenceHash: hash, catalogEvidenceHash: hash } };
  const extraUnit = { version: 1, measureId: hash, stock: { itemId: 'b', label: '개', quantityKind:'count' }, basis: { kind: 'item-stock', catalogEvidenceHash: hash } };
  const opening = { version: 1, state: 'open', companyId: 'taebaek', orderId: 'o', opening: { version: 1, token: hash }, rows: [{ lineId: 'l', itemId: 'a', orderedQty: 4, completedQty: 0, unit }], availableStockOnly: [{ itemId: 'b', name: 'B', unit: extraUnit }], allowedActions: ['complete-partial'], warnings: [] };
  const submit = vi.fn().mockResolvedValue(undefined);
  const props = { partnerName: "거래처", rows: [], onConfirm: vi.fn(), onCancel: vi.fn(), partial: { order: {items:[{lineId:'l',itemId:'a',quantity:48,isBoxUnit:true,boxQuantity:4,unitsPerBox:12}]} as any, scopeKey:"taebaek/user/1", opening: opening as any, catalog: [{id:"a",name:"A",type:'product',unit:'박스',stock:0}, {id:"b",name:"B",type:'product',unit:'개',stock:0}] as any, busy:false, requestLocked:false, onSelectionChange:vi.fn(), onSubmit:submit } };
  const view = render(<StockUseModal {...props} />);
  fireEvent.click(screen.getByRole('button',{name:'수량 바꾸기'}));
  fireEvent.change(screen.getByLabelText('있던 재고에서 쓴 수량 (박스)'), {target:{value:'2'}});
  fireEvent.change(screen.getByLabelText('있던 재고에서 쓴 수량 (박스)'), {target:{value:''}});
  expect(screen.getByLabelText('새로 만든 수량 (박스)')).toHaveValue(4);
  fireEvent.change(screen.getByLabelText('새로 만든 수량 (박스)'), {target:{value:'1'}});
  fireEvent.change(screen.getByLabelText('있던 재고에서 쓴 수량 (박스)'), {target:{value:'1'}});
  expect(screen.getByLabelText('새로 만든 수량 (박스)')).toHaveValue(1);
  fireEvent.change(screen.getByLabelText('B 더 만든 수량 (개)'), {target:{value:'3'}});
  const changedOpening = {...opening, rows: [{...opening.rows[0], unit: {...unit, measureId:'b'.repeat(64)}}]};
  view.rerender(<StockUseModal {...props} partial={{...props.partial, opening:changedOpening as any}} />);
  expect(screen.getByRole('button',{name:'완료 내용 확인'})).toBeDisabled();
  expect(screen.getByLabelText('새로 만든 수량 (박스)')).toHaveValue(1);
  view.rerender(<StockUseModal {...props} />);
  fireEvent.click(screen.getByRole('button',{name:'완료 내용 확인'}));
  await waitFor(()=>expect(submit).toHaveBeenCalledOnce());
  expect(submit).toHaveBeenCalledWith([{lineId:'l',complete:{value:2,kind:'box-count',measureId:hash},stockUse:{own:{itemId:'a',value:1,measureId:hash}}}], [{itemId:'b',quantity:{value:3,kind:'item-stock',measureId:hash}}]);
  expect(screen.getByText(/거래처 청구에는 들어가지 않습니다/)).toBeInTheDocument();
  const apply=vi.fn().mockResolvedValue(undefined);const preview={customerRows:[{lineId:'l',itemId:'a',unit,orderedQty:4,completedBefore:0,completeNow:2,completedAfter:2,ownUsed:1,looseUsed:0,producedUnits:[{itemId:'a',qty:1}]}],stockOnlyRows:[{itemId:'b',quantity:3,unit:extraUnit}],splitRows:[],stockChanges:[],warnings:[]};
  view.rerender(<StockUseModal {...props} partial={{...props.partial,result:{state:'reserved',canApply:true,preview} as any,onApply:apply}}/>);
  expect(screen.getByLabelText('새로 만든 수량 (박스)')).toBeDisabled();expect(screen.getByText('있던 재고에서 1 박스')).toBeInTheDocument();expect(screen.getByText('새로 만듦 A 1 박스')).toBeInTheDocument();expect(screen.getByText('더 만들어 재고로 B 3 개 · 거래처 청구 안 됨')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'확인한 내용 적용'}));await waitFor(()=>expect(apply).toHaveBeenCalledOnce());fireEvent.click(screen.getByRole('button',{name:'취소'}));await waitFor(()=>expect(props.onCancel).toHaveBeenCalledOnce());expect(confirm).toHaveBeenCalledWith(expect.stringContaining('요청은 남습니다'));
});

describe('생산 처리 창의 자동 채움과 더 만든 재고', () => {
  const hash = 'a'.repeat(64);
  const unit = { version: 1, measureId: hash, order: { kind: 'item-quantity', label: '개', orderedValue: 10 }, sourceLine: { quantity: 10 }, stock: { itemId: 'a', label: '개', quantityKind: 'count', orderedValue: 10, unitsPerOrderUnit: 1 }, basis: { kind: 'item-unit', orderUnitEvidenceHash: hash, catalogEvidenceHash: hash } };
  const extraUnit = { version: 1, measureId: hash, stock: { itemId: 'b', label: '개', quantityKind: 'count' }, basis: { kind: 'item-stock', catalogEvidenceHash: hash } };
  const goodsUnit = { ...unit, order: { kind: 'box-count', label: '박스', orderedValue: 1 }, sourceLine: { quantity: 12, isBoxUnit: true, boxQuantity: 1, unitsPerBox: 12 }, stock: { itemId: 'g', label: '개', quantityKind: 'count', orderedValue: 12, unitsPerOrderUnit: 12 } };
  const makeOpening = (over: Record<string, unknown> = {}) => ({ version: 1, state: 'open', companyId: 'taebaek', orderId: 'o', opening: { version: 1, token: hash }, rows: [{ lineId: 'l', itemId: 'a', orderedQty: 10, completedQty: 0, unit }], availableStockOnly: [], allowedActions: ['complete-partial'], warnings: [], ...over });
  const catalog = [
    { id: 'a', name: '시골향참기름/특A/다싸다마트/1750ml', type: 'product', category: '참기름', unit: '개', stock: 3 },
    { id: 'b', name: '시골향참기름/특A/1750ml', type: 'product', category: '참기름', unit: '개', stock: 0 },
    { id: 'raw', name: '통깨', type: 'raw', category: '참기름', unit: 'kg', stock: 5 },
  ];
  const baseOrder = { items: [{ lineId: 'l', itemId: 'a', quantity: 10 }] } as any;
  const setup = (over: Record<string, unknown> = {}) => {
    const submit = vi.fn().mockResolvedValue(undefined), select = vi.fn();
    const partial = { order: baseOrder, scopeKey: 'taebaek/user/1', opening: makeOpening() as any, catalog: catalog as any, busy: false, requestLocked: false, onSelectionChange: select, onSubmit: submit, ...over };
    const element = (next: Record<string, unknown> = {}) => <StockUseModal partnerName="거래처" rows={[]} onConfirm={vi.fn()} onCancel={vi.fn()} partial={{ ...partial, ...next } as any} />;
    return { submit, select, element, view: render(element()) };
  };
  const openExtras = () => fireEvent.click(screen.getByRole('button', { name: '더 만든 재고가 있으면 적기' }));
  beforeEach(() => { cleanup(); confirm.mockClear(); });

  it('아무것도 안 건드리면 재고를 먼저 쓰고 모자란 만큼 새로 만들어 주문량을 채워 보낸다', async () => {
    const { submit, select } = setup();
    expect(screen.getByText('10 개 완료 = 있던 재고 3 개 + 새로 만듦 7 개')).toBeInTheDocument();
    expect(screen.queryByLabelText('새로 만든 수량 (개)')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '완료 내용 확인' }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit).toHaveBeenCalledWith([{ lineId: 'l', complete: { value: 10, kind: 'item-quantity', measureId: hash }, stockUse: { own: { itemId: 'a', value: 3, measureId: hash } } }], []);
    expect(select).not.toHaveBeenCalled();
  });

  it('입력하지 않았으면 취소할 때 다시 묻지 않고, 수량을 바꿨으면 묻는다', async () => {
    const onCancel = vi.fn();
    render(<StockUseModal partnerName="거래처" rows={[]} onConfirm={vi.fn()} onCancel={onCancel} partial={{ order: baseOrder, scopeKey: 's', opening: makeOpening() as any, catalog: catalog as any, busy: false, requestLocked: false, onSelectionChange: vi.fn(), onSubmit: vi.fn() } as any} />);
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    await waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '수량 바꾸기' }));
    fireEvent.change(screen.getByLabelText('새로 만든 수량 (개)'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith('입력한 수량을 버리고 닫습니까?'));
  });

  it('일부만 만들면 처리 후 남는 수량을 알려 주고 그 수량만 보낸다', async () => {
    const { submit } = setup({ catalog: [{ ...catalog[0], stock: 0 }, catalog[1]] });
    fireEvent.click(screen.getByRole('button', { name: '수량 바꾸기' }));
    fireEvent.change(screen.getByLabelText('새로 만든 수량 (개)'), { target: { value: '4' } });
    expect(screen.getByText('4 개 완료 = 새로 만듦 4 개')).toBeInTheDocument();
    expect(screen.getByText('처리 후 6 개 남습니다.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '완료 내용 확인' }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit.mock.calls[0][0][0].complete.value).toBe(4);
  });

  it('이미 끝난 줄은 카드도 입력칸도 없이 한 줄로만 보여 준다', () => {
    setup({ opening: makeOpening({ rows: [{ lineId: 'l', itemId: 'a', orderedQty: 10, completedQty: 10, unit }] }) });
    expect(screen.getByText('시골향참기름/특A/다싸다마트/1750ml · 주문 10 개 모두 끝남')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '수량 바꾸기' })).toBeNull();
    expect(screen.queryByLabelText('새로 만든 수량 (개)')).toBeNull();
  });

  const goodsOrder = { items: [{ lineId: 'g', itemId: 'g', quantity: 12, isBoxUnit: true, boxQuantity: 1, unitsPerBox: 12 }] } as any;
  const goodsOpening = makeOpening({ rows: [{ lineId: 'g', itemId: 'g', orderedQty: 1, completedQty: 0, unit: goodsUnit }] });
  const goods = (stock: number) => ({ id: 'g', name: '참향기름', type: 'goods', category: '향미유', unit: '개', stock });

  it('상품은 입력칸 없이 현재고·이번 주문·차감 후만 보이고 재고 사용량은 0으로 보낸다', async () => {
    const { submit } = setup({ order: goodsOrder, opening: goodsOpening, catalog: [goods(48)] });
    expect(screen.getByText('현재고 48 개 · 이번 주문 12 개 · 차감 후 36 개')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '수량 바꾸기' })).toBeNull();
    expect(screen.queryByRole('spinbutton')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '완료 내용 확인' }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit).toHaveBeenCalledWith([{ lineId: 'g', complete: { value: 1, kind: 'box-count', measureId: hash }, stockUse: { own: { itemId: 'g', value: 0, measureId: hash } } }], []);
  });

  it('상품 재고가 부족하면 완료할 수 없다고 알리고 보내지 않는다', async () => {
    notice.mockClear();
    const { submit, select } = setup({ order: goodsOrder, opening: goodsOpening, catalog: [goods(3)] });
    expect(screen.getByText('현재고 3 개 · 이번 주문 12 개')).toBeInTheDocument();
    expect(screen.getByText('재고가 부족해서 완료할 수 없습니다')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '완료 내용 확인' }));
    await waitFor(() => expect(notice).toHaveBeenCalledOnce());
    expect(notice.mock.calls[0][0]).toContain('재고가 부족해서 주문을 완료할 수 없습니다.');
    expect(notice.mock.calls[0][1]).toBe('재고부족');
    expect(submit).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });

  it('다른 주문이 완료해 둔 상품 수량을 빼고 부족을 판단한다', async () => {
    notice.mockClear();
    const committed = new Map([['g', new Map([['other', 40], ['o', 12]])]]);
    const submit = vi.fn();
    render(<GoodsCommittedContext.Provider value={committed}><StockUseModal partnerName="거래처" rows={[]} onConfirm={vi.fn()} onCancel={vi.fn()} partial={{ order: goodsOrder, scopeKey: 's', opening: goodsOpening as any, catalog: [goods(48)] as any, busy: false, requestLocked: false, onSelectionChange: vi.fn(), onSubmit: submit } as any} /></GoodsCommittedContext.Provider>);
    expect(screen.getByText('현재고 48 개 · 다른 주문 완료분 40 개 · 이번 주문 12 개')).toBeInTheDocument();
    expect(screen.getByText('재고가 부족해서 완료할 수 없습니다')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '완료 내용 확인' }));
    await waitFor(() => expect(notice).toHaveBeenCalledOnce());
    expect(notice.mock.calls[0][0]).toContain('다른 주문 완료분 40 개');
    expect(submit).not.toHaveBeenCalled();
  });

  it('고른 품목만 카드로 보이고 다른 품목은 한 줄로 두었다가 같이 처리하면 값이 채워진다', async () => {
    const order = { items: [baseOrder.items[0], goodsOrder.items[0]] } as any;
    const opening = makeOpening({ rows: [{ lineId: 'l', itemId: 'a', orderedQty: 10, completedQty: 0, unit }, { lineId: 'g', itemId: 'g', orderedQty: 1, completedQty: 0, unit: goodsUnit }] });
    const { submit } = setup({ order, opening, catalog: [...catalog, goods(48)], target: { lineId: 'g' } });
    expect(screen.getByText('시골향참기름/특A/다싸다마트/1750ml · 남은 10 개')).toBeInTheDocument();
    expect(screen.queryByText('10 개 완료 = 있던 재고 3 개 + 새로 만듦 7 개')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '시골향참기름/특A/다싸다마트/1750ml 같이 처리' }));
    expect(screen.getByText('10 개 완료 = 있던 재고 3 개 + 새로 만듦 7 개')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '완료 내용 확인' }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit.mock.calls[0][0].map((row: any) => row.lineId)).toEqual(['l', 'g']);
  });

  it('더 만든 재고는 접혀 있고, 없으면 그대로 완료된다', () => {
    setup();
    expect(screen.queryByLabelText('시골향참기름/특A/1750ml 더 만든 수량 (개)')).toBeNull();
    openExtras();
    expect(screen.getByLabelText('시골향참기름/특A/1750ml 더 만든 수량 (개)')).toBeInTheDocument();
  });

  it('후보를 보여 주고, 더 만든 품목은 완료를 누를 때 한 번만 다시 조회한 뒤 이어서 보낸다', async () => {
    const { submit, select, element, view } = setup();
    openExtras();
    expect(screen.getByLabelText('시골향참기름/특A/다싸다마트/1750ml 더 만든 수량 (개)')).toBeInTheDocument();
    expect(screen.queryByLabelText('통깨 더 만든 수량 (kg)')).toBeNull();
    const name = '시골향참기름/특A/1750ml';
    fireEvent.click(screen.getByRole('button', { name: name + ' 1 늘리기' }));
    fireEvent.click(screen.getByRole('button', { name: name + ' 1 늘리기' }));
    expect(screen.getByLabelText(name + ' 더 만든 수량 (개)')).toHaveValue(2);
    expect(select).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '완료 내용 확인' }));
    expect(select).toHaveBeenCalledExactlyOnceWith(['b']);
    expect(submit).not.toHaveBeenCalled();
    view.rerender(element({ busy: true }));
    expect(screen.getByRole('status')).toHaveTextContent('더 만든 품목을 확인하고 있습니다.');
    view.rerender(element({ opening: makeOpening({ opening: { version: 1, token: 'c'.repeat(64) }, availableStockOnly: [{ itemId: 'b', name, unit: extraUnit }] }) }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit.mock.calls[0][1]).toEqual([{ itemId: 'b', quantity: { value: 2, kind: 'item-stock', measureId: hash } }]);
    expect(screen.queryByText(/품목 단위가 바뀌었습니다/)).toBeNull();
    expect(select).toHaveBeenCalledOnce();
  });

  it('후보에 없는 품목은 찾아서 줄에 더하고, 원료 같은 품목은 찾기 목록에도 없다', () => {
    setup({ catalog: [...catalog, { id: 'far', name: '들기름/병/350ml', type: 'product', category: '들기름', unit: '병', stock: 0 }] });
    openExtras();
    expect(screen.queryByLabelText('들기름/병/350ml 더 만든 수량 (병)')).toBeNull();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    fireEvent.click(screen.getByRole('button', { name: '다른 품목 찾기' }));
    expect(screen.queryByRole('option', { name: '통깨' })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: '들기름/병/350ml' }));
    expect(screen.getByLabelText('들기름/병/350ml 더 만든 수량 (병)')).toBeInTheDocument();
  });

  it('다시 조회했더니 줄의 수량이 바뀌었으면 보내지 않고 변경 안내를 띄운다', async () => {
    const { submit, element, view } = setup();
    openExtras();
    fireEvent.click(screen.getByRole('button', { name: '시골향참기름/특A/1750ml 1 늘리기' }));
    fireEvent.click(screen.getByRole('button', { name: '완료 내용 확인' }));
    view.rerender(element({ busy: true }));
    view.rerender(element({ opening: makeOpening({ opening: { version: 1, token: 'c'.repeat(64) }, rows: [{ lineId: 'l', itemId: 'a', orderedQty: 10, completedQty: 4, unit }], availableStockOnly: [{ itemId: 'b', name: 'B', unit: extraUnit }] }) }));
    expect(await screen.findByText(/품목 단위가 바뀌었습니다/)).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '완료 내용 확인' })).toBeDisabled();
  });

  it('다시 조회가 실패하면 보내지 않고 입력을 지킨 채 다시 누를 수 있다', async () => {
    const { submit, select, element, view } = setup();
    const name = '시골향참기름/특A/1750ml';
    openExtras();
    fireEvent.click(screen.getByRole('button', { name: name + ' 1 늘리기' }));
    fireEvent.click(screen.getByRole('button', { name: '완료 내용 확인' }));
    view.rerender(element({ busy: true }));
    view.rerender(element({ error: '서버 확인 실패' }));
    expect(await screen.findByText('서버 확인 실패')).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByLabelText(name + ' 더 만든 수량 (개)')).toHaveValue(1);
    await waitFor(() => expect(screen.getByRole('button', { name: '완료 내용 확인' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '완료 내용 확인' }));
    expect(select).toHaveBeenCalledTimes(2);
  });
});
