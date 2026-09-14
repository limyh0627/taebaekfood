/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import StatementHistoryActions from './StatementHistoryActions';

describe('전표 조회 결과 작업', () => {
  it('발행 메뉴와 각 작업을 부모 콜백으로 전달한다', () => {
    const onCreateSale = vi.fn();
    const onCreatePurchase = vi.fn();
    const onCreateCash = vi.fn();
    const onOpenRecurring = vi.fn();
    const onOpenCompany = vi.fn();
    render(<StatementHistoryActions resultCount={7} fetching={false}
      onCreateSale={onCreateSale} onCreatePurchase={onCreatePurchase} onCreateCash={onCreateCash}
      onOpenRecurring={onOpenRecurring} onOpenCompany={onOpenCompany}/>);

    expect(screen.getByText('7건')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /거래명세서/ }));
    fireEvent.click(screen.getByRole('button', { name: '매출전표' }));
    fireEvent.click(screen.getByRole('button', { name: '일반전표' }));
    fireEvent.click(screen.getByRole('button', { name: '템플릿' }));
    fireEvent.click(screen.getByRole('button', { name: '회사정보' }));

    expect(onCreateSale).toHaveBeenCalledTimes(1);
    expect(onCreatePurchase).not.toHaveBeenCalled();
    expect(onCreateCash).toHaveBeenCalledTimes(1);
    expect(onOpenRecurring).toHaveBeenCalledTimes(1);
    expect(onOpenCompany).toHaveBeenCalledTimes(1);
  });

  it('바깥을 누르면 열린 발행 메뉴를 닫는다', () => {
    render(<StatementHistoryActions resultCount={0} fetching={false}
      onCreateSale={vi.fn()} onCreatePurchase={vi.fn()} onCreateCash={vi.fn()} onOpenCompany={vi.fn()}/>);

    fireEvent.click(screen.getByRole('button', { name: /거래명세서/ }));
    expect(screen.getByRole('button', { name: '매입전표' })).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('button', { name: '매입전표' })).not.toBeInTheDocument();
  });
});
