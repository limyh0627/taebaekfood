/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ListExcelPreview } from './ListExcelPreview';
afterEach(cleanup);
const snapshot = { title: '목록', subtitle: '현재 검색 결과', fileName: '목록', columns: [{ header: '이름', width: 20 }, { header: '금액', width: 15, number: true }], rows: [['=원문', 12], ['두 번째', 25]] };
it('전체 표와 원문을 표시하고 확인 전에는 저장하지 않는다', () => {
  const save = vi.fn(), close = vi.fn(); render(<ListExcelPreview snapshot={snapshot} signal={new AbortController().signal} onSave={save} onClose={close} />);
  expect(screen.getAllByRole('row')).toHaveLength(3); expect(screen.getByText('=원문')).toBeInTheDocument(); expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '닫기' })); expect(close).toHaveBeenCalledOnce(); expect(save).not.toHaveBeenCalled();
});
it('저장 중 연속 클릭을 막고 실패에는 표를 유지해 같은 내용으로 재시도한다', async () => {
  let reject!: (error: Error) => void;
  const save = vi.fn().mockImplementationOnce(() => new Promise<void>((_, no) => { reject = no; })).mockResolvedValueOnce(undefined), close = vi.fn();
  render(<ListExcelPreview snapshot={snapshot} signal={new AbortController().signal} onSave={save} onClose={close} />);
  const button = screen.getByRole('button', { name: '엑셀 저장' }); fireEvent.click(button); fireEvent.click(button); expect(save).toHaveBeenCalledOnce();
  await act(async () => reject(Error('파일 오류'))); expect(screen.getByRole('alert')).toHaveTextContent('다시 저장'); expect(screen.getByText('두 번째')).toBeInTheDocument(); expect(close).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '엑셀 저장' }))); expect(save).toHaveBeenCalledTimes(2); expect(close).toHaveBeenCalledOnce();
});
