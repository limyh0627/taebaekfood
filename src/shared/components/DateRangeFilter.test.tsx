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
