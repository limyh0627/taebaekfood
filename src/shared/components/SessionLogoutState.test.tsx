/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import SessionLogoutState from './SessionLogoutState';
it('중앙 보관 안내는 등록된 업무만 확인하며 전체 업무 복구를 보장하지 않는다',()=>{render(<SessionLogoutState state="checking" error="" onRetry={vi.fn()}/>);expect(screen.getByRole('status')).toHaveTextContent('등록된 작업 입력');expect(screen.getByRole('status')).toHaveTextContent('아직 로그아웃하지 않았습니다');expect(screen.queryByText(/모든 업무/)).toBeNull();});
it('보관 확인 실패는 아직 로그아웃 전임을 구분하고 재보관과 작업 복귀를 제공한다',()=>{const retry=vi.fn(),back=vi.fn();render(<SessionLogoutState state="checkpoint-failed" error="원료 입력 기기 보관 실패" onRetry={retry} onReturn={back}/>);expect(screen.getByRole('alert')).toHaveTextContent('기기 보관 실패');fireEvent.click(screen.getByRole('button',{name:'다시 보관하고 로그아웃'}));fireEvent.click(screen.getByRole('button',{name:'작업으로 돌아가기'}));expect(retry).toHaveBeenCalledOnce();expect(back).toHaveBeenCalledOnce();});

it('진행 중에는 확인 상태만 표시하고 재시도나 다른 로그인 진입을 제공하지 않는다', () => {
  const onRetry = vi.fn();
  render(<SessionLogoutState state="pending" error="이전 실패 원인" onRetry={onRetry} />);
  expect(screen.getByRole('status')).toHaveTextContent('로그아웃 확인 중');
  expect(screen.queryByText('이전 실패 원인')).not.toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(onRetry).not.toHaveBeenCalled();
});

it('실패 이유를 보존하고 명시적으로 다시 로그아웃할 때만 콜백을 호출한다', () => {
  const onRetry = vi.fn();
  render(<SessionLogoutState state="failed" error="인증 서버 연결이 끊겼습니다." onRetry={onRetry} />);
  expect(screen.getByRole('alert')).toHaveTextContent('인증 서버 연결이 끊겼습니다.');
  expect(screen.queryByText('로그아웃 완료')).not.toBeInTheDocument();
  expect(onRetry).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '다시 로그아웃' }));
  expect(onRetry).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('alert')).toHaveTextContent('인증 서버 연결이 끊겼습니다.');
});

it('재시도 진행 상태에서는 이전 실패와 버튼을 숨기며 완료로 표현하지 않는다', () => {
  const { rerender } = render(<SessionLogoutState state="failed" error="실패 원문" onRetry={vi.fn()} />);
  rerender(<SessionLogoutState state="pending" error="실패 원문" onRetry={vi.fn()} />);
  expect(screen.getByRole('status')).toHaveTextContent('로그아웃 확인 중');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(screen.queryByText('실패 원문')).not.toBeInTheDocument();
});

it('실패 이유가 비어 있어도 불확실 상태를 알리고 재시도만 제공한다', () => {
  render(<SessionLogoutState state="failed" error="" onRetry={vi.fn()} />);
  expect(screen.getByRole('alert')).toHaveTextContent('로그인 상태를 확인하지 못했습니다.');
  expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['다시 로그아웃']);
});

it('전달받은 오류 문자열은 HTML을 실행하지 않고 그대로 읽을 수 있게 표시한다', () => {
  const error = '<img src=x onerror=alert(1)>\n응답을 확인하지 못했습니다.';
  const { container } = render(<SessionLogoutState state="failed" error={error} onRetry={vi.fn()} />);
  expect(screen.getByRole('alert')).toHaveTextContent('<img src=x onerror=alert(1)>');
  expect(container.querySelector('img')).toBeNull();
});
