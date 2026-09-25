/** @vitest-environment jsdom */
import React from 'react';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { where } from 'firebase/firestore';
import HRManager from './HRManager';
import { subscribeToCollection } from '../src/shared/services/firebaseService';

vi.mock('../src/shared/services/firebaseService', () => ({
  subscribeToCollection: vi.fn(() => () => undefined),
  setDocument: vi.fn(),
}));
vi.mock('firebase/firestore', async importOriginal => {
  const original = await importOriginal<typeof import('firebase/firestore')>();
  return { ...original, where: vi.fn(original.where) };
});

const props = {
  employees: [], leaveRequests: [],
  onUpdateEmployee: vi.fn(), onAddEmployee: vi.fn(), onDeleteEmployee: vi.fn(),
  onUpdateLeaveStatus: vi.fn(), onUpdateLeave: vi.fn(), onDeleteLeaveRequest: vi.fn(),
};

describe('회사별 급여대장 구독', () => {
  beforeEach(() => vi.clearAllMocks());

  it('현재 회사 조건을 서버 질의에 넣고 회사 전환 시 다른 회사 조건으로 재구독한다', () => {
    const view = render(<HRManager {...props} companyId="taebaek" />);
    expect(where).toHaveBeenCalledWith('companyId', '==', 'taebaek');
    expect(subscribeToCollection).toHaveBeenLastCalledWith('payrolls', expect.any(Function), [vi.mocked(where).mock.results[0].value]);

    view.rerender(<HRManager {...props} companyId="punghoe" />);
    expect(where).toHaveBeenCalledWith('companyId', '==', 'punghoe');
    expect(subscribeToCollection).toHaveBeenLastCalledWith('payrolls', expect.any(Function), [vi.mocked(where).mock.results[1].value]);
  });
});
