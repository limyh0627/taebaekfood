/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StatementPaymentMobileRow, StatementPaymentTableRow } from './StatementPaymentRow';
import type { StatementHistoryRowView } from '../domain/statementHistoryRowView';

const view: StatementHistoryRowView = {
  key: 'cash-1__매출', kind: 'pay', label: '수금', date: '2026-09-15', owner: '관리자',
  partner: '해피유통', detail: '계좌이체', note: '9월 수금', amount: 500_000,
  cumulative: -20_000, isReturn: false,
};

describe('수금·지불 행', () => {
  it('표 행은 담당자와 초과수금 잔액을 표시하고 상세를 연다', () => {
    const onOpen = vi.fn();
    render(<table><tbody><StatementPaymentTableRow view={view} statementType="매출"
      dateCell={<span>날짜칸</span>} journalToggle={<span>분개</span>} onOpen={onOpen}/></tbody></table>);
    expect(screen.getByText('관리자')).toBeInTheDocument();
    expect(screen.getByText('선수금')).toBeInTheDocument();
    fireEvent.click(screen.getByText('해피유통'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('모바일 삭제는 상세 열기를 일으키지 않는다', () => {
    const onOpen = vi.fn(), onDelete = vi.fn();
    render(<StatementPaymentMobileRow view={view} statementType="매출" journalToggle={<span>분개</span>}
      onOpen={onOpen} onDelete={onDelete}/>);
    expect(screen.getByText('계좌이체 · 9월 수금')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('삭제'));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
