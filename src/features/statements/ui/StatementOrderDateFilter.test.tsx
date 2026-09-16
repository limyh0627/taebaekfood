/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import StatementOrderDateFilter from './StatementOrderDateFilter';

describe('전표 주문 날짜 필터', () => {
  it('전체와 직접 입력을 하나의 변경 경계로 전달한다', () => {
    const onChange = vi.fn();
    render(<StatementOrderDateFilter quick="금주" from="2026-09-14" to="2026-09-20" onChange={onChange}/>);

    fireEvent.click(screen.getByRole('button', { name: '전체' }));
    fireEvent.change(screen.getByLabelText('주문 조회 시작일'), { target: { value: '2026-09-15' } });
    fireEvent.change(screen.getByLabelText('주문 조회 종료일'), { target: { value: '2026-09-21' } });

    expect(onChange.mock.calls).toEqual([
      ['', '', '전체'],
      ['2026-09-15', '2026-09-20', ''],
      ['2026-09-14', '2026-09-21', ''],
    ]);
  });
});
