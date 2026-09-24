/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AppDialogHost from './AppDialogHost';
import { appConfirm, appNotice, appPrompt } from './appDialog';

describe('AppDialogHost', () => {
  it('브라우저 confirm 대신 공통 확인 모달에서 결과를 돌려준다', async () => {
    render(<AppDialogHost />);
    const result = appConfirm('삭제할까요?');
    expect(await screen.findByRole('dialog')).toHaveTextContent('삭제할까요?');
    fireEvent.click(screen.getByRole('button', { name: '확인' }));
    await expect(result).resolves.toBe(true);
  });

  it('여러 줄 경고를 보존하고 취소하면 작업을 진행하지 않는다', async () => {
    render(<AppDialogHost />);
    const result = appConfirm({ title: '전표 확인', message: '기존 전표가 있습니다.\n다시 발행할까요?' });
    const message = await screen.findByText(/기존 전표가 있습니다/);
    expect(message).toHaveClass('whitespace-pre-line');
    expect(message).toHaveTextContent('다시 발행할까요?');
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    await expect(result).resolves.toBe(false);
  });

  it('확인이 필요한 알림은 확인 버튼을 누를 때까지 다음 작업을 기다린다', async () => {
    render(<AppDialogHost />);
    let continued = false;
    const operation = appNotice('원료 사용은 기록됐습니다.\n압착 입고를 확인해 주세요.').then(() => { continued = true; });
    const message = await screen.findByText(/원료 사용은 기록됐습니다/);
    expect(message).toHaveClass('whitespace-pre-line');
    expect(continued).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '확인' }));
    await operation;
    expect(continued).toBe(true);
  });

  it('확인을 연속으로 눌러도 다음 대기 창은 건너뛰지 않는다', async () => {
    render(<AppDialogHost />);
    const first = appConfirm('첫 번째 작업');
    const second = appConfirm('두 번째 작업');
    const button = await screen.findByRole('button', { name: '확인' });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    await expect(first).resolves.toBe(true);
    await screen.findByText('두 번째 작업');
    expect(screen.getByRole('dialog')).toHaveTextContent('두 번째 작업');
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    await expect(second).resolves.toBe(false);
  });

  it('문자 입력을 제목 있는 일반 모달로 받고 취소는 null을 돌려준다', async () => {
    render(<AppDialogHost />);
    const accepted = appPrompt({ title: '그룹 이름', defaultValue: '기름' });
    const input = await screen.findByRole('textbox');
    fireEvent.change(input, { target: { value: '깨' } });
    fireEvent.click(screen.getByRole('button', { name: '확인' }));
    await expect(accepted).resolves.toBe('깨');

    const cancelled = appPrompt('메모', '기존');
    await screen.findByDisplayValue('기존');
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    await expect(cancelled).resolves.toBeNull();
  });
});
