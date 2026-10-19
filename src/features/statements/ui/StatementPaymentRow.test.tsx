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

it('모바일과 PC 금액·잔액은 모든 부호에서 명시 12px이며 구분 배경은 흰색이다', () => {
  for (const cumulative of [0, 20_000, -20_000]) {
    const mobile = render(<StatementPaymentMobileRow view={{...view,cumulative}} statementType="매출" journalToggle={null} onOpen={vi.fn()} onDelete={vi.fn()}/>);
    expect(mobile.container.firstElementChild).toHaveClass('bg-white','text-[12px]');
    expect(screen.getByText('수금')).toHaveClass('text-[12px]');
    expect(screen.getByText('500,000')).toHaveClass('text-[12px]');
    const balance = cumulative===0?screen.getByText('0'):cumulative>0?screen.getByText('잔액 20,000'):screen.getByText('−20,000');
    expect(balance).toHaveClass('text-[12px]');
    expect(screen.getByText('수금').className).not.toMatch(/bg-/);
    mobile.unmount();
    const desktop=render(<table><tbody><StatementPaymentTableRow view={{...view,cumulative}} statementType="매출" dateCell={null} journalToggle={null} onOpen={vi.fn()}/></tbody></table>);
    expect(screen.getByText(cumulative===0?'0':cumulative>0?'20,000':'−20,000')).toHaveClass('text-[12px]');
    desktop.unmount();
  }
});
