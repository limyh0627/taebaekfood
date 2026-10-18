/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import StatementHistoryFilters from './StatementHistoryFilters';

describe('전표 조회 필터', () => {
  it('기간·유형·초기화 동작을 부모의 단일 상태 경계로 전달한다', () => {
    const onFrom = vi.fn(), onMove = vi.fn(), onKind = vi.fn(), onReset = vi.fn();
    render(<StatementHistoryFilters quickRange="당일" from="2026-09-14" to="2026-09-14"
      kind="전체" kindCounts={new Map([['전체', 3], ['매출', 2]])}
      onQuickRange={vi.fn()} onFrom={onFrom} onTo={vi.fn()} onMove={onMove} onKind={onKind} onReset={onReset}>
      <div>거래처 필터</div>
    </StatementHistoryFilters>);

    expect(screen.getByRole('tab', { name: '전체3' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.change(screen.getByLabelText('조회 시작일'), { target: { value: '2026-09-01' } });
    fireEvent.click(screen.getByRole('button', { name: '다음 기간' }));
    fireEvent.click(screen.getByRole('tab', { name: '매출2' }));
    fireEvent.click(screen.getByRole('button', { name: /초기화/ }));

    expect(onFrom).toHaveBeenCalledWith('2026-09-01');
    expect(onMove).toHaveBeenCalledWith(1);
    expect(onKind).toHaveBeenCalledWith('매출');
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('region',{name:'검색조건'})).toHaveClass('!overflow-visible');
    expect(screen.getByRole('button',{name:'초기화'})).toHaveClass('min-h-8','rounded-md');
  });
});

it('시작일과 종료일은 주문형 40px 입력 규격을 사용한다',()=>{
 render(<StatementHistoryFilters quickRange="당일" from="2026-10-18" to="2026-10-18" kind="전체" kindCounts={new Map()} onQuickRange={vi.fn()} onFrom={vi.fn()} onTo={vi.fn()} onMove={vi.fn()} onKind={vi.fn()} onReset={vi.fn()}><span>검색</span></StatementHistoryFilters>);
 for(const name of ['조회 시작일','조회 종료일'])expect(screen.getByLabelText(name)).toHaveClass('h-10','bg-slate-50','border-slate-200');
});

it('날짜 다음 빠른기간과 이동을 두며 올해·전체 표시도 원래 enum만 전달한다',()=>{const quick=vi.fn(),move=vi.fn(),props={quickRange:'ALL' as const,from:'',to:'',kind:'전체' as const,kindCounts:new Map<string,number>(),onQuickRange:quick,onFrom:vi.fn(),onTo:vi.fn(),onMove:move,onKind:vi.fn(),onReset:vi.fn(),children:<span>검색</span>};const view=render(<StatementHistoryFilters {...props}/>);const from=screen.getByLabelText('조회 시작일'),today=screen.getByRole('button',{name:'오늘'}),previous=screen.getByRole('button',{name:'이전 기간'});expect(from.compareDocumentPosition(today)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(today.compareDocumentPosition(previous)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();for(const [name,value]of [['오늘','당일'],['이번 주','금주'],['이번 달','당월'],['올해','당년'],['전체','ALL']]){fireEvent.click(screen.getByRole('button',{name}));expect(quick).toHaveBeenLastCalledWith(value);}expect(previous).toBeDisabled();fireEvent.click(previous);expect(move).not.toHaveBeenCalled();view.rerender(<StatementHistoryFilters {...props} from="2026-01-01" to="2026-12-31"/>);fireEvent.click(previous);expect(move).toHaveBeenCalledExactlyOnceWith(-1);});
