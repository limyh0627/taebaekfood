/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import CategoryManager from './CategoryManager';

const service = vi.hoisted(() => ({ fetchCollection: vi.fn(), addItem: vi.fn(), updateItem: vi.fn(), deleteItem: vi.fn() }));
vi.mock('../src/shared/services/firebaseService', () => service);
const deferred = () => {
  let resolve!: (rows: unknown[]) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<unknown[]>((done, fail) => { resolve = done; reject = fail; });
  return { resolve, reject, promise };
};
const row = (companyId: string, label: string) => [{ id: companyId, companyId, kind: 'type', key: 'product', label, order: 0 }];
beforeEach(() => {
  service.fetchCollection.mockReset();
  service.addItem.mockClear(); service.updateItem.mockClear(); service.deleteItem.mockClear();
});

it('이전 회사 분류의 늦은 응답이 현재 회사 편집 목록을 덮지 않는다', async () => {
  const previous = deferred(); const current = deferred();
  service.fetchCollection.mockReset().mockReturnValueOnce(previous.promise).mockReturnValueOnce(current.promise);
  const props = { onClose: vi.fn() };
  const view = render(<CategoryManager {...props} companyId="taebaek" />);
  view.rerender(<CategoryManager {...props} companyId="punghoe" />);
  await act(async () => current.resolve(row('punghoe', '풍회 현재 분류')));
  expect(screen.getByDisplayValue('풍회 현재 분류')).toBeInTheDocument();
  await act(async () => previous.resolve(row('taebaek', '태백 이전 분류')));
  expect(screen.getByDisplayValue('풍회 현재 분류')).toBeInTheDocument();
  expect(screen.queryByDisplayValue('태백 이전 분류')).not.toBeInTheDocument();
  expect(service.addItem).not.toHaveBeenCalled();
  expect(service.updateItem).not.toHaveBeenCalled();
});

it('회사 전환은 이전 분류와 입력 초안을 비우고 현재 회사 자료만 닫기 결과로 넘긴다', async () => {
  const previous = deferred(); const current = deferred();
  service.fetchCollection.mockReturnValueOnce(previous.promise).mockReturnValueOnce(current.promise);
  const onSaved = vi.fn(); const onClose = vi.fn();
  const view = render(<CategoryManager onClose={onClose} onSaved={onSaved} companyId="taebaek" />);
  await act(async () => previous.resolve(row('taebaek', '태백 이전 분류')));
  fireEvent.change(screen.getAllByPlaceholderText('추가')[0], { target: { value: '이전 회사 초안' } });
  view.rerender(<CategoryManager onClose={onClose} onSaved={onSaved} companyId="punghoe" />);
  expect(screen.queryByDisplayValue('태백 이전 분류')).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('이전 회사 초안')).not.toBeInTheDocument();
  expect(screen.getByText('불러오는 중…')).toBeInTheDocument();
  await act(async () => current.resolve(row('punghoe', '풍회 현재 분류')));
  expect(screen.getAllByPlaceholderText('추가').every(input => (input as HTMLInputElement).value === '')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: /^닫기$/ }));
  expect(onSaved).toHaveBeenCalledExactlyOnceWith(row('punghoe', '풍회 현재 분류'));
  expect(service.addItem).not.toHaveBeenCalled();
  expect(service.updateItem).not.toHaveBeenCalled();
});

it('이전 회사 조회의 늦은 오류와 finally가 현재 회사 로딩을 끝내거나 실패로 바꾸지 않는다', async () => {
  const previous = deferred(); const current = deferred();
  service.fetchCollection.mockReturnValueOnce(previous.promise).mockReturnValueOnce(current.promise);
  const view = render(<CategoryManager onClose={vi.fn()} companyId="taebaek" />);
  view.rerender(<CategoryManager onClose={vi.fn()} companyId="punghoe" />);
  await act(async () => previous.reject(new Error('옛 조회 실패')));
  expect(screen.getByText('불러오는 중…')).toBeInTheDocument();
  expect(screen.queryByText('분류를 불러오지 못했습니다. 다시 시도해 주세요.')).not.toBeInTheDocument();
  await act(async () => current.resolve(row('punghoe', '풍회 현재 분류')));
  expect(screen.getByDisplayValue('풍회 현재 분류')).toBeInTheDocument();
  expect(service.addItem).not.toHaveBeenCalled();
});

it('현재 조회 실패 후 재시도는 그대로 유지하며 비어 있지 않은 회사 자료를 읽는다', async () => {
  const failed = deferred(); const retried = deferred();
  service.fetchCollection.mockReturnValueOnce(failed.promise).mockReturnValueOnce(retried.promise);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  render(<CategoryManager onClose={vi.fn()} companyId="taebaek" />);
  await act(async () => failed.reject(new Error('조회 실패')));
  fireEvent.click(screen.getByRole('button', { name: /다시/ }));
  await act(async () => retried.resolve(row('taebaek', '태백 현재 분류')));
  expect(screen.getByDisplayValue('태백 현재 분류')).toBeInTheDocument();
  expect(service.addItem).not.toHaveBeenCalled();
});
