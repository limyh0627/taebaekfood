/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import CategoryManager from './CategoryManager';

const service = vi.hoisted(() => ({ fetchCollection: vi.fn(), addItem: vi.fn(), updateItem: vi.fn(), deleteItem: vi.fn() }));
vi.mock('../src/shared/services/firebaseService', () => service);
const dialog=vi.hoisted(()=>({appConfirm:vi.fn()}));
vi.mock('../src/shared/components/appDialog',()=>dialog);
const deferred = () => {
  let resolve!: (rows: unknown[]) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<unknown[]>((done, fail) => { resolve = done; reject = fail; });
  return { resolve, reject, promise };
};
const row = (companyId: string, label: string) => [{ id: companyId, companyId, kind: 'type', key: 'product', label, order: 0 }];
beforeEach(() => {
  service.fetchCollection.mockReset();
  dialog.appConfirm.mockReset();
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

const confirmDeferred=()=>{let resolve!:(yes:boolean)=>void;const promise=new Promise<boolean>(done=>{resolve=done;});return {resolve,promise};};
async function openConfirm(action:'숨김'|'삭제') {
 service.fetchCollection.mockImplementation(async()=>[...row('taebaek','태백 타입'),{id:'sub-A',companyId:'taebaek',kind:'subtype',parent:'product',label:'태백 하위분류',order:0}]);
 const view=render(<CategoryManager onClose={vi.fn()} companyId="taebaek" usage={{'type:product':1}} />);
 const input=await screen.findByDisplayValue('태백 하위분류');
 if(action==='숨김')fireEvent.click(screen.getAllByTitle('안 씀 (숨김)')[0]);else fireEvent.click(input.closest('div')!.querySelectorAll('button')[2]);
 expect(dialog.appConfirm).toHaveBeenCalledOnce();return view;
}
it.each(['숨김','삭제'] as const)('분류 %s 확인 중 회사 전환은 이전 회사 저장을 시작하지 않는다',async action=>{
 const confirm=confirmDeferred();dialog.appConfirm.mockReturnValue(confirm.promise);const view=await openConfirm(action);
 view.rerender(<CategoryManager onClose={vi.fn()} companyId="punghoe" />);await act(async()=>confirm.resolve(true));
 expect(service.updateItem).not.toHaveBeenCalled();expect(service.deleteItem).not.toHaveBeenCalled();expect(service.addItem).not.toHaveBeenCalled();
});
it.each(['숨김','삭제'] as const)('현재 회사 분류 %s 승인은 정상 저장하고 취소는 쓰지 않는다',async action=>{
 const confirm=confirmDeferred();dialog.appConfirm.mockReturnValue(confirm.promise);await openConfirm(action);await act(async()=>confirm.resolve(true));
 if(action==='숨김'){expect(service.updateItem).toHaveBeenCalledWith('itemTaxonomy','taebaek',{hidden:true});expect(screen.getByTitle('다시 쓰기')).toBeInTheDocument();}else{expect(service.deleteItem).toHaveBeenCalledWith('itemTaxonomy','sub-A');expect(screen.queryByDisplayValue('태백 하위분류')).not.toBeInTheDocument();}
});
it.each(['숨김','삭제'] as const)('현재 회사 분류 %s 확인 취소는 저장하지 않는다',async action=>{
 const confirm=confirmDeferred();dialog.appConfirm.mockReturnValue(confirm.promise);await openConfirm(action);await act(async()=>confirm.resolve(false));expect(service.updateItem).not.toHaveBeenCalled();expect(service.deleteItem).not.toHaveBeenCalled();expect(screen.getByDisplayValue('태백 하위분류')).toBeInTheDocument();
});
it.each(['숨김','삭제'] as const)('분류 %s 저장의 늦은 성공은 현재 회사 편집 자료를 유지한다',async action=>{
 const save=deferred();service.updateItem.mockImplementation(()=>save.promise);service.deleteItem.mockImplementation(()=>save.promise);dialog.appConfirm.mockResolvedValue(true);const view=await openConfirm(action);await waitFor(()=>expect(action==='숨김'?service.updateItem:service.deleteItem).toHaveBeenCalledOnce());
 service.fetchCollection.mockResolvedValue(row('punghoe','풍회 유지'));view.rerender(<CategoryManager onClose={vi.fn()} companyId="punghoe" />);await screen.findByDisplayValue('풍회 유지');await act(async()=>save.resolve([]));expect(screen.getByDisplayValue('풍회 유지')).toBeInTheDocument();expect(screen.queryByDisplayValue('태백 타입')).not.toBeInTheDocument();
});
