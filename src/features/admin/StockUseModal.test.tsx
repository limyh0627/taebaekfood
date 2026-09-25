/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StockUseRow } from './stockUseRows';

const notice = vi.hoisted(() => vi.fn(async (_message: string, _title?: string) => {}));
vi.mock('../../shared/components/appDialog', () => ({ appNotice: notice }));

import StockUseModal from './StockUseModal';

const rows: StockUseRow[] = [{
  idx: 0, itemId: 'box-a', name: '참기름 박스', unitLabel: '박스', ordered: 3, stock: 2,
}];

beforeEach(() => notice.mockClear());

describe('재고 사용 확인창의 저장 실패', () => {
  it('DB에서 뒤늦게 재고 부족이 확인되면 공통 알림으로 이유를 보여 준다', async () => {
    const onConfirm = vi.fn(async () => { throw new Error('참기름 박스 재고가 부족합니다. 현재 1, 차감 2'); });
    render(<StockUseModal partnerName="거래처" rows={rows} onConfirm={onConfirm} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '재고 사용하고 작업완료' }));

    await waitFor(() => expect(notice).toHaveBeenCalledWith(
      '참기름 박스 재고가 부족합니다. 현재 1, 차감 2', '재고 부족',
    ));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('성공하면 실패 알림을 띄우지 않는다', async () => {
    const onConfirm = vi.fn(async () => {});
    render(<StockUseModal partnerName="거래처" rows={rows} onConfirm={onConfirm} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '재고 사용하고 작업완료' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    expect(notice).not.toHaveBeenCalled();
  });
});
