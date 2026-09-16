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

/**
 * **거래처명 밑에 지금 걸린 돈**(2026-09-16 사장님: "거래처명 밑에 현재 거래처에 미수금이나
 * 미지급금 나오게 할 수 있나"). 전표를 끊기 전에 제일 먼저 궁금한 것인데, 보려면 창을 닫고
 * 거래처 원장으로 갔다 와야 했다.
 */
describe('거래처 잔액', () => {
  const 그리기 = (balance?: { receivable: number; payable: number }) =>
    render(<StatementComposerHeader mode="매출" twoSided={false} editMode={false}
      partnerName="해피유통" tradeDate="2026-09-16" balance={balance}
      onTradeDate={() => {}} onNew={() => {}} onClose={() => {}}/>);

  it('받을 것과 줄 것을 갈라 적는다', () => {
    그리기({ receivable: 1_230_000, payable: 450_000 });
    expect(screen.getByText('미수 1,230,000')).toBeInTheDocument();
    expect(screen.getByText('미지급 450,000')).toBeInTheDocument();
  });

  it('**0 원은 안 적는다** — 굳이 자리를 내어 쓰면 있는 쪽이 안 띈다', () => {
    그리기({ receivable: 1_230_000, payable: 0 });
    expect(screen.getByText('미수 1,230,000')).toBeInTheDocument();
    expect(screen.queryByText(/미지급/)).not.toBeInTheDocument();
  });

  it('둘 다 없으면 "거래 없음" — 빈칸이면 못 읽어 온 건지 진짜 없는 건지 모른다', () => {
    그리기({ receivable: 0, payable: 0 });
    expect(screen.getByText('거래 없음')).toBeInTheDocument();
  });

  it('잔액을 안 넘겨도 안 죽는다', () => {
    그리기();
    expect(screen.getByText('거래 없음')).toBeInTheDocument();
  });

  it('1원 미만 찌꺼기는 없는 것으로 본다', () => {
    그리기({ receivable: 0.4, payable: -0.2 });
    expect(screen.getByText('거래 없음')).toBeInTheDocument();
  });
});
