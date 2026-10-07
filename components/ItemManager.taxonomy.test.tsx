/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import ItemManager from './ItemManager';
import type { CompanyId } from '../types';
import type { TaxonomyRow } from '../src/shared/taxonomy';
const { fetchCollection } = vi.hoisted(() => ({ fetchCollection: vi.fn() }));
vi.mock('../src/shared/services/firebaseService', () => ({ fetchCollection }));
vi.mock('./CategoryManager', () => ({ default: ({ onClose }: { onClose: () => void }) => <button onClick={onClose}>분류 닫기</button> }));
const rows = (label: string): TaxonomyRow[] => [{ id: 'product', kind: 'type', key: 'product', label }];
const deferred = () => { let resolve!: (rows: TaxonomyRow[]) => void; let reject!: (error: Error) => void; const promise = new Promise<TaxonomyRow[]>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const props = { items: [], partners: [], onEditProduct: vi.fn(), onAddItem: vi.fn(), onDeleteItem: vi.fn(), onLinkItem: vi.fn(), onUnlinkItem: vi.fn() };
const ui = (companyId: CompanyId) => <ItemManager {...props} companyId={companyId} />;
beforeEach(() => { fetchCollection.mockReset(); });
it('새 회사 분류 완료 뒤 늦은 이전 회사 응답을 무시한다', async () => {
  const a=deferred(), b=deferred(); fetchCollection.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const view=render(ui('taebaek')); view.rerender(ui('punghoe'));
  await act(async()=>b.resolve(rows('풍회 분류')));
  expect(screen.getByRole('button',{name:'풍회 분류'})).toBeTruthy();
  await act(async()=>a.resolve(rows('태백 분류')));
  expect(screen.getByRole('button',{name:'풍회 분류'})).toBeTruthy();
  expect(screen.queryByRole('button',{name:'태백 분류'})).toBeNull();
});
it('회사 전환 즉시 이전 회사 분류를 감추고 현재 실패에도 되살리지 않는다', async () => {
  const a=deferred(), b=deferred(); fetchCollection.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const view=render(ui('taebaek')); await act(async()=>a.resolve(rows('태백 분류')));
  expect(screen.getByRole('button',{name:'태백 분류'})).toBeTruthy();
  view.rerender(ui('punghoe'));
  expect(screen.queryByRole('button',{name:'태백 분류'})).toBeNull();
  await act(async()=>b.reject(new Error('조회 실패')));
  expect(screen.queryByRole('button',{name:'태백 분류'})).toBeNull();
});
it('같은 회사 분류 재조회는 최신 응답과 검색 초안을 보존한다', async () => {
  const old=deferred(), next=deferred(); fetchCollection.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  render(ui('taebaek'));
  const search=screen.getByPlaceholderText('품목명 검색');
  fireEvent.change(search,{target:{value:'참기름'}});
  fireEvent.click(screen.getByRole('button',{name:'분류 관리'}));
  await act(async()=>next.resolve(rows('새 분류')));
  await act(async()=>old.resolve(rows('옛 분류')));
  expect(screen.getByRole('button',{name:'새 분류'})).toBeTruthy();
  expect(search).toHaveValue('참기름');
});
