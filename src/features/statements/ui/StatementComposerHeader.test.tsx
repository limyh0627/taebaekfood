/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import StatementComposerHeader from './StatementComposerHeader';

describe('전표 작성 헤더', () => {
  it('새 전표에서는 날짜 변경과 창 동작을 전달한다', () => {
    const onTradeDate = vi.fn(), onNew = vi.fn(), onClose = vi.fn();
    render(<StatementComposerHeader mode="매출" twoSided={false} editMode={false}
      partnerName="해피유통" partnerPhone="010-0000-0000" tradeDate="2026-09-15"
      onTradeDate={onTradeDate} onNew={onNew} onClose={onClose}/>);

    expect(screen.getByText('매출전표')).toBeInTheDocument();
    expect(screen.getByText('해피유통')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('전표일자'), { target: { value: '2026-09-16' } });
    fireEvent.click(screen.getByRole('button', { name: '새 전표' }));
    fireEvent.click(screen.getByRole('button', { name: '전표 작성 닫기' }));
    expect(onTradeDate).toHaveBeenCalledWith('2026-09-16');
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('확정된 기존 전표는 날짜를 읽기 전용으로 보여준다', () => {
    render(<StatementComposerHeader mode="매입" twoSided={false} editingDocNo="P-001" editMode={false}
      tradeDate="2026-09-01" onTradeDate={vi.fn()} onNew={vi.fn()} onClose={vi.fn()}/>);
    expect(screen.getByText('[수정중] P-001')).toBeInTheDocument();
    expect(screen.queryByLabelText('전표일자')).not.toBeInTheDocument();
    expect(screen.getByText('2026-09-01')).toBeInTheDocument();
  });
});
