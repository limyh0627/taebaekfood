/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import OrderEditModalShell from './OrderEditModalShell';
afterEach(cleanup);
it('거래처와 주문일 옆 헤더에 로그를 하나만 두고 원래 콜백을 유지한다', () => {
  const log = vi.fn(), save = vi.fn();
  render(<OrderEditModalShell title="주문 수정" partnerName="긴 합성 거래처" context="주문일 26.10.18" onClose={vi.fn()} onSave={save} saveDisabled headerAction={<button onClick={log}>로그</button>}><p>편집 본문</p></OrderEditModalShell>);
  const button = screen.getByRole('button', {name:'로그'});
  expect(screen.getAllByRole('button', {name:'로그'})).toHaveLength(1);
  expect(button.closest('header')).toHaveTextContent('긴 합성 거래처 · 주문일 26.10.18');
  fireEvent.click(button); expect(log).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', {name:'변경 저장'})).toBeDisabled();
  expect(save).not.toHaveBeenCalled();
});
