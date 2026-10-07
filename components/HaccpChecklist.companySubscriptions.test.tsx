// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import HaccpChecklist, { StaffChecklistView } from './HaccpChecklist';
import { today } from '../src/shared/day';

const state = vi.hoisted(() => ({ subscriptions: [] as any[], tempRows: [] as any[] }));
vi.mock('../src/shared/firebase', () => ({ db: {} }));
vi.mock('../src/shared/services/firebaseService', () => ({ addItem: vi.fn(), updateItem: vi.fn(), deleteItem: vi.fn(), setDocument: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, collection: string) => ({ collection }),
  doc: (_db: unknown, collection: string, id: string) => ({ collection, id }),
  where: (field: string, op: string, value: string) => ({ field, op, value }),
  query: (ref: any, ...constraints: any[]) => ({ ...ref, constraints }),
  onSnapshot: (ref: any, callback: any) => {
    const unsubscribe = vi.fn();
    state.subscriptions.push({ ref, callback, unsubscribe });
    if (ref.constraints) {
      const rows = ref.collection === 'haccp_temp' && ref.constraints[0].value === 'taebaek' ? state.tempRows : [];
      callback({ docs: rows.map(row => ({ id: row.id, data: () => row })) });
    } else callback({ exists: () => false });
    return unsubscribe;
  },
}));
beforeEach(() => { state.subscriptions = []; state.tempRows = []; });
const user = { id: 'synthetic-user', name: '합성 담당' };

it('회사 질의로 바뀌어도 날짜 없는 기록은 제외하고 과거 기록을 날짜 내림차순으로 보여준다', () => {
  state.tempRows = [
    { id: 'synthetic-missing-date', revisionCount: 0 },
    { id: 'synthetic-older', date: '2020-01-01', revisionCount: 0 },
    { id: 'synthetic-newer', date: '2020-02-01', revisionCount: 0 },
  ];
  render(<HaccpChecklist currentUser={user} isAdmin companyId="taebaek" />);
  fireEvent.click(screen.getByRole('button', { name: '온도관리 일지' }));
  fireEvent.click(screen.getByRole('button', { name: /이전 측정 기록 \(2건\)/ }));
  const newer = screen.getByText('2020-02-01');
  const older = screen.getByText('2020-01-01');
  expect(newer.compareDocumentPosition(older) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it.each([
  ['온도관리 일지', 'haccp_temp'], ['입고검사일지', 'haccp_incoming'],
  ['세척·소독 일지', 'haccp_cleaning'], ['작업장 위생점검표', 'haccp_sanitation'],
  ['개인위생점검표', 'haccp_personal_hygiene'], ['위생점검표(주간/월간)', 'haccp_periodic_sanitation'],
  ['마감 체크리스트', 'haccp_closing_checklist'],
])('%s 기록은 로그인 화면 회사의 질의로 구독하고 회사 전환 때 해제한다', (label, collection) => {
  const view = render(<HaccpChecklist currentUser={user} isAdmin companyId="taebaek" />);
  fireEvent.click(screen.getByRole('button', { name: label }));
  const old = state.subscriptions.find(s => s.ref.collection === collection);
  expect(old.ref.constraints).toEqual([{ field: 'companyId', op: '==', value: 'taebaek' }]);
  view.rerender(<HaccpChecklist currentUser={user} isAdmin companyId="punghoe" />);
  expect(old.unsubscribe).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: label }));
  expect(state.subscriptions.filter(s => s.ref.collection === collection).at(-1).ref.constraints)
    .toEqual([{ field: 'companyId', op: '==', value: 'punghoe' }]);
});

it.each([HaccpChecklist, StaffChecklistView])('회사 전환 후 이전 초안과 지연된 구독 결과를 새 회사에 표시하지 않는다', View => {
  state.tempRows = [{ id: 'synthetic-temp', date: today(), measureTime: '12:30', revisionCount: 2,
    rows: [{ zone: '합성 옛 회사 창고', temp: '5', result: 'O', corrective: '', inspector: '' }] }];
  const view = render(<View currentUser={user} isAdmin companyId="taebaek" />);
  fireEvent.click(screen.getByRole('button', { name: /온도관리 일지/ }));
  fireEvent.click(screen.getByRole('button', { name: /오늘 온도 측정 기록/ }));
  fireEvent.change(screen.getByDisplayValue('5'), { target: { value: '88' } });
  const old = state.subscriptions.find(s => s.ref.collection === 'haccp_temp');
  view.rerender(<View currentUser={user} isAdmin companyId="punghoe" />);
  fireEvent.click(screen.getByRole('button', { name: /온도관리 일지/ }));
  fireEvent.click(screen.getByRole('button', { name: /오늘 온도 측정 기록/ }));
  act(() => old.callback({ docs: state.tempRows.map(row => ({ id: row.id, data: () => row })) }));
  expect(old.unsubscribe).toHaveBeenCalledTimes(1);
  expect(screen.queryByDisplayValue('88')).not.toBeInTheDocument();
  expect(screen.queryByText('합성 옛 회사 창고')).not.toBeInTheDocument();
});
