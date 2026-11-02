/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StockUseRow } from './stockUseRows';

const notice = vi.hoisted(() => vi.fn(async (_message: string, _title?: string) => {}));
const confirm = vi.hoisted(() => vi.fn(async (_message: string) => true));
vi.mock('../../shared/components/appDialog', () => ({ appNotice: notice, appConfirm: confirm }));

import StockUseModal from './StockUseModal';

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
  const props = { partnerName: "거래처", rows: [], onConfirm: vi.fn(), onCancel: vi.fn(), partial: { scopeKey:"taebaek/user/1", opening: opening as any, catalog: [{id:"a",name:"A"}, {id:"b",name:"B"}] as any, busy:false, requestLocked:false, onSelectionChange:vi.fn(), onSubmit:submit } };
  const view = render(<StockUseModal {...props} />);
  fireEvent.change(screen.getByLabelText('이번 완료 (박스)'), {target:{value:'2'}});
  fireEvent.change(screen.getByLabelText('기존 재고 사용 (박스)'), {target:{value:'1'}});
  fireEvent.change(screen.getByLabelText('추가 생산 (개)'), {target:{value:'3'}});
  const changedOpening = {...opening, rows: [{...opening.rows[0], unit: {...unit, measureId:'b'.repeat(64)}}]};
  view.rerender(<StockUseModal {...props} partial={{...props.partial, opening:changedOpening as any}} />);
  expect(screen.getByRole('button',{name:'완료 내용 확인'})).toBeDisabled();
  expect(screen.getByLabelText('이번 완료 (박스)')).toHaveValue(2);
  view.rerender(<StockUseModal {...props} />);
  fireEvent.click(screen.getByRole('button',{name:'완료 내용 확인'}));
  await waitFor(()=>expect(submit).toHaveBeenCalledOnce());
  expect(submit).toHaveBeenCalledWith([{lineId:'l',complete:{value:2,kind:'box-count',measureId:hash},stockUse:{own:{itemId:'a',value:1,measureId:hash}}}], [{itemId:'b',quantity:{value:3,kind:'item-stock',measureId:hash}}]);
  expect(screen.getByText(/고객 청구에 포함되지 않습니다/)).toBeInTheDocument();
  const apply=vi.fn().mockResolvedValue(undefined);const preview={customerRows:[{lineId:'l',itemId:'a',unit,orderedQty:4,completedBefore:0,completeNow:2,completedAfter:2,ownUsed:1,looseUsed:0,producedUnits:[{itemId:'a',qty:1}]}],stockOnlyRows:[{itemId:'b',quantity:3,unit:extraUnit}],splitRows:[],stockChanges:[],warnings:[]};
  view.rerender(<StockUseModal {...props} partial={{...props.partial,result:{state:'reserved',canApply:true,preview} as any,onApply:apply}}/>);
  expect(screen.getByLabelText('이번 완료 (박스)')).toBeDisabled();expect(screen.getByText('기존 재고 사용 1 박스')).toBeInTheDocument();expect(screen.getByText('이번 생산 A 1 박스')).toBeInTheDocument();expect(screen.getByText('추가 재고 생산 B 3 개 · 고객 청구 제외')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'확인한 내용 적용'}));await waitFor(()=>expect(apply).toHaveBeenCalledOnce());fireEvent.click(screen.getByRole('button',{name:'취소'}));await waitFor(()=>expect(props.onCancel).toHaveBeenCalledOnce());expect(confirm).toHaveBeenCalledWith(expect.stringContaining('요청은 남습니다'));
});
