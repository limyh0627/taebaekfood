/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import StatementPartnerBar from './StatementPartnerBar';

const base = { partners: [{ id: 'p1', name: '해피유통' }], search: '', sale: true, editing: false, onlyActive: true, manualMode: false,
  onSearch: vi.fn(), onSelect: vi.fn(), onClear: vi.fn(), onOnlyActive: vi.fn(), onManualMode: vi.fn() };

describe('전표 거래처 선택 바', () => {
  it('거래처 검색·선택과 미발행 필터를 전달한다', () => {
    const props = { ...base, onSearch: vi.fn(), onSelect: vi.fn(), onOnlyActive: vi.fn(), selectedPartnerId: '' };
    render(<StatementPartnerBar {...props}/>);
    fireEvent.change(screen.getByPlaceholderText('거래처 검색...'), { target: { value: '해피' } });
    fireEvent.change(screen.getByLabelText('거래처 선택'), { target: { value: 'p1' } });
    fireEvent.click(screen.getByRole('button', { name: '미발행' }));
    expect(props.onSearch).toHaveBeenCalledWith('해피');
    expect(props.onSelect).toHaveBeenCalledWith('p1');
    expect(props.onOnlyActive).toHaveBeenCalledTimes(1);
  });

  it('선택 뒤에는 주문 불러오기와 직접 입력을 바꾼다', () => {
    const props = { ...base, onClear: vi.fn(), onManualMode: vi.fn(), selectedPartnerId: 'p1' };
    render(<StatementPartnerBar {...props}/>);
    fireEvent.click(screen.getByRole('button', { name: '거래처 변경' }));
    fireEvent.click(screen.getByRole('button', { name: '직접 입력' }));
    expect(props.onClear).toHaveBeenCalledTimes(1);
    expect(props.onManualMode).toHaveBeenCalledWith(true);
  });
});
