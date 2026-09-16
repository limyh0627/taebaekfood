/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StatementCashMobileRow, StatementCashTableRow } from './StatementCashRow';
import type { StatementHistoryRowView } from '../domain/statementHistoryRowView';

const view: StatementHistoryRowView = {
  key: 'cash-1', kind: 'cash', label: '출금', date: '2026-09-15', owner: '관리자', partner: '태백은행',
  detail: '차입금 1,000,000', note: '원금 상환', amount: 1_000_000, cumulative: -50_000, isReturn: false,
};

describe('자금 전표 행', () => {
  it('표 행은 계정 필터 금액과 통장 전액을 함께 밝힌다', () => {
    render(<table><tbody><StatementCashTableRow view={view} direction="출금" shownAmount={100_000}
      partial unallocated={20_000} classifications={['상환']} dateCell={<span>날짜</span>} journalToggle={<span>분개</span>}/></tbody></table>);
    expect(screen.getByText('100,000')).toBeInTheDocument();
    expect(screen.getByText('통장 1,000,000')).toBeInTheDocument();
    expect(screen.getByText('미배분 20,000')).toBeInTheDocument();
    expect(screen.getByText('상환')).toBeInTheDocument();
  });

  it('모바일 삭제는 상세 열기를 일으키지 않는다', () => {
    const onOpen = vi.fn(), onDelete = vi.fn();
    render(<StatementCashMobileRow view={view} direction="출금" journalToggle={<span>분개</span>} onOpen={onOpen} onDelete={onDelete}/>);
    expect(screen.getByText('차입금 1,000,000 · 원금 상환')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('삭제'));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
