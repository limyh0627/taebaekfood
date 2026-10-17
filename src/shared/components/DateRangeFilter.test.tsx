/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import DateRangeFilter from './DateRangeFilter';

afterEach(() => vi.useRealTimers());

it('당월 조회는 이번 달 1일부터 오늘까지만 선택한다', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 7, 12));
  const onChange = vi.fn();
  render(<DateRangeFilter from="" to="" onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: '당월' }));
  expect(onChange).toHaveBeenCalledWith('2026-10-01', '2026-10-07', '당월');
  fireEvent.click(screen.getByRole('button', { name: '금주' }));
  expect(onChange).toHaveBeenCalledWith('2026-10-05', '2026-10-07', '금주');
});

it('당일과 전체를 한 번씩 전달하고 연도 경계 금주는 월요일부터 오늘까지만 조회한다', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2027, 0, 3, 12));
  const onChange = vi.fn();
  render(<DateRangeFilter from="2026-12-01" to="2026-12-31" quick="전체" onChange={onChange} />);
  expect(screen.getByRole('button', { name: '전체' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: '당일' }));
  fireEvent.click(screen.getByRole('button', { name: '금주' }));
  fireEvent.click(screen.getByRole('button', { name: '전체' }));
  expect(onChange.mock.calls).toEqual([
    ['2027-01-03', '2027-01-03', '당일'],
    ['2026-12-28', '2027-01-03', '금주'],
    ['', '', '전체'],
  ]);
});

it('수동 입력과 비우기는 반대 경계·라벨을 보존하고 빠른 선택을 해제한다', () => {
  const onChange = vi.fn();
  const view = render(<DateRangeFilter from="2026-10-01" to="2026-10-17" quick="당월" label="주문 조회" onChange={onChange} />);
  const from = screen.getByLabelText('주문 조회 시작일');
  const to = screen.getByLabelText('주문 조회 종료일');
  expect(from).toHaveAttribute('max', '2026-10-17'); expect(to).toHaveAttribute('min', '2026-10-01');
  fireEvent.change(from, { target: { value: '2026-10-05' } });
  fireEvent.change(to, { target: { value: '' } });
  expect(onChange.mock.calls).toEqual([['2026-10-05', '2026-10-17', ''], ['2026-10-01', '', '']]);
  view.rerender(<DateRangeFilter from="" to="" onChange={onChange} />);
  expect(screen.getByLabelText('조회 시작일')).not.toHaveAttribute('max');
  expect(screen.getByLabelText('조회 종료일')).not.toHaveAttribute('min');
  expect(screen.getAllByRole('button').every(button => button.getAttribute('aria-pressed') === 'false')).toBe(true);
});

it('필터 버튼은 바깥 저장 폼을 제출하지 않는다', () => {
  const onSubmit = vi.fn(event => event.preventDefault());
  render(<form onSubmit={onSubmit}><DateRangeFilter from="" to="" onChange={vi.fn()} /></form>);
  fireEvent.click(screen.getByRole('button', { name: '전체' }));
  expect(onSubmit).not.toHaveBeenCalled();
});

it('공용 두 입력에도 원래 좁은폭·높이·포커스 클래스와 구분선 숨김을 유지한다',()=>{
 render(<DateRangeFilter from="2026-10-01" to="2026-10-17" onChange={vi.fn()}/>);
 for(const label of ['조회 시작일','조회 종료일']){const input=screen.getByLabelText(label);expect(input).toHaveClass('min-h-11','!min-w-0','text-xs','focus:ring-blue-300');}
 expect(screen.getByText('~')).toHaveClass('hidden','min-[360px]:block');
 expect(screen.getByLabelText('조회 시작일').parentElement).toHaveClass('grid-cols-1','min-[360px]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]');
});