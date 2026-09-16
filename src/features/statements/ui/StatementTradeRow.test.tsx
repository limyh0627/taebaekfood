/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StatementTradeMobileRow, StatementTradeTableRow } from './StatementTradeRow';
import type { IssuedStatement } from '../../../shared/types';
import type { StatementHistoryRowView } from '../domain/statementHistoryRowView';

const statement = { id: 's1', type: '매출', partnerName: '해피유통', totalAmount: 110_000 } as IssuedStatement;
const view: StatementHistoryRowView = {
  key: 's1', kind: 'stmt', label: '매출', date: '2026-09-15', owner: '관리자', partner: '해피유통',
  detail: '참기름 10병', note: '', amount: 110_000, cumulative: 60_000, isReturn: false,
};

describe('매출·매입 전표 행', () => {
  it('표 행에서 수금과 증빙 변경을 각각 전달한다', () => {
    const onOpen = vi.fn(), onSettle = vi.fn(), onEvidence = vi.fn();
    render(<table><tbody><StatementTradeTableRow statement={statement} view={view} shownAmount={110_000} partial={false}
      settle={{ state: 'partial', label: '부분수금' }} canSettle evidenceChoices={['미발행', '세금계산서']} evidence="미발행"
      dateCell={<span>날짜</span>} journalToggle={<span>분개</span>} onOpen={onOpen} onSettle={onSettle} onEvidence={onEvidence}/></tbody></table>);
    expect(screen.getByText('부분수금')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '수금처리' }));
    fireEvent.change(screen.getByLabelText('해피유통 증빙'), { target: { value: '세금계산서' } });
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(onEvidence).toHaveBeenCalledWith('세금계산서');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('모바일 행은 반품과 잔액을 같은 표시값으로 보여준다', () => {
    render(<StatementTradeMobileRow statement={statement} view={{ ...view, isReturn: true }} dateLabel="2026-09-15 10:30"
      canSettle={false} journalToggle={<span>분개</span>} onOpen={vi.fn()} onSettle={vi.fn()}/>);
    expect(screen.getByText('반품')).toBeInTheDocument();
    expect(screen.getByText('잔액 60,000')).toBeInTheDocument();
    expect(screen.getByText('2026-09-15 10:30')).toBeInTheDocument();
  });
});
