// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AppAlertHost from './AppAlertHost';

describe('공통 앱 알림', () => {
  afterEach(() => vi.restoreAllMocks());

  it('브라우저 alert를 페이지 위 기본창 대신 제목이 있는 앱 알림으로 보여준다', () => {
    render(<AppAlertHost />);
    act(() => window.alert('저장에 실패했습니다.'));

    expect(screen.getByRole('dialog', { name: '확인 필요' })).toBeInTheDocument();
    expect(screen.getByText('저장에 실패했습니다.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '확인' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('여러 알림은 덮어쓰지 않고 들어온 순서대로 보여준다', () => {
    render(<AppAlertHost />);
    act(() => {
      window.alert('첫 번째 알림');
      window.alert('처리가 완료되었습니다.');
    });

    expect(screen.getByText('첫 번째 알림')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '확인' }));
    expect(screen.getByText('처리가 완료되었습니다.')).toBeInTheDocument();
  });
});
