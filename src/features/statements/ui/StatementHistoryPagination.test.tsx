/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import StatementHistoryPagination from './StatementHistoryPagination';

describe('전표 조회 페이지 이동', () => {
  it('현재 범위를 보여주고 지정한 페이지를 전달한다', () => {
    const onPage = vi.fn();
    render(<StatementHistoryPagination page={2} totalPages={3} totalCount={45} pageSize={20} onPage={onPage}/>);

    expect(screen.getByText('21–40 / 45건')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '‹ 이전' }));
    fireEvent.click(screen.getByRole('button', { name: '다음 ›' }));
    fireEvent.click(screen.getByRole('button', { name: '« 최신' }));
    fireEvent.click(screen.getByRole('button', { name: '과거 »' }));
    expect(onPage.mock.calls.map(call => call[0])).toEqual([1, 3, 1, 3]);
  });

  it('한 페이지면 이동 도구를 만들지 않는다', () => {
    const { container } = render(<StatementHistoryPagination page={1} totalPages={1} totalCount={20} pageSize={20} onPage={vi.fn()}/>);
    expect(container).toBeEmptyDOMElement();
  });
});
