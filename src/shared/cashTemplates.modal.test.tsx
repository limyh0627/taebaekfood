/** @vitest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CashTemplateModal, type CashTemplate } from './cashTemplates';
const templates: CashTemplate[] = [{ id: 'one', label: '현재 양식', dir: '줄돈', mode: '일반', favorite: true }];
it.each([false, true])('방향 탭 숨김 %s에서도 전체·즐겨찾기와 양식 선택을 유지한다', hideDirectionTabs => {
  const pick = vi.fn();
  render(<CashTemplateModal templates={templates} accountCodes={[]} activeId={null} onPick={pick} onDirect={vi.fn()} onClose={vi.fn()} hideDirectionTabs={hideDirectionTabs} />);
  expect(!!screen.queryByRole('button', { name: /^출금$/ })).toBe(!hideDirectionTabs);
  fireEvent.click(screen.getByRole('button', { name: /^★$/ }));
  fireEvent.click(screen.getByRole('button', { name: /현재 양식/ }));
  expect(pick).toHaveBeenCalledWith(templates[0]);
  expect(screen.getByText('줄돈')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^전체$/ })).toBeInTheDocument();
});
it('갈래 표시명을 지정하면 내부 줄돈 방향을 바꾸지 않고 매입 배지를 보여준다', () => {
  const pick = vi.fn();
  render(<CashTemplateModal templates={templates} accountCodes={[]} activeId={null} onPick={pick} onDirect={vi.fn()} onClose={vi.fn()} hideDirectionTabs directionLabel="매입" />);
  expect(screen.getByText('매입')).toBeInTheDocument(); expect(screen.queryByText('줄돈')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /현재 양식/ }));
  expect(pick).toHaveBeenCalledWith(expect.objectContaining({ dir: '줄돈' }));
});
