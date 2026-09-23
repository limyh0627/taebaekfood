// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PeriodPicker from './PeriodPicker';

describe('PeriodPicker', () => {
  it('손익 화면에서는 빠른 기간을 골라도 날짜 두 개를 항상 표시한다', () => {
    const setPeriod = vi.fn();
    render(<PeriodPicker
      period="1Y" setPeriod={setPeriod}
      years={[2026]} selectedYear={2026} setSelectedYear={vi.fn()}
      selectedQuarter={3} setSelectedQuarter={vi.fn()}
      selectedHalf={2} setSelectedHalf={vi.fn()}
      customStart="2026-01-01" setCustomStart={vi.fn()}
      customEnd="2026-09-24" setCustomEnd={vi.fn()}
      quarterAvailable={() => true} halfAvailable={() => true}
      alwaysShowDates
    />);

    expect(screen.getByLabelText('조회 시작일')).toHaveValue('2026-01-01');
    expect(screen.getByLabelText('조회 종료일')).toHaveValue('2026-09-24');
    fireEvent.change(screen.getByLabelText('조회 시작일'), { target: { value: '2026-08-01' } });
    expect(setPeriod).toHaveBeenCalledWith('custom');
  });
});
