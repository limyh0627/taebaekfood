/** @vitest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
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
  onLeaveAction: vi.fn().mockResolvedValue({status:"saved"}),
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

const outputState=vi.hoisted(()=>({html:vi.fn().mockResolvedValue(undefined),auth:{currentUser:{uid:'qa'},onAuthStateChanged:vi.fn(()=>()=>{})}}));
vi.mock('../src/shared/firebase',()=>({auth:outputState.auth}));
vi.mock('../src/shared/htmlPrintOutput',()=>({previewHtmlPrint:outputState.html}));
it('한 직원 급여명세서만 출력하고 명세서 닫기와 회사 전환에서 취소한다',()=>{
 const employee:import('../src/shared/types').Employee={id:'e1',name:'합성직원',position:'사원',department:'생산',joinDate:'2020-01-01',status:'working',phone:''};
 const view=render(<HRManager {...props} employees={[employee]}/>);fireEvent.click(screen.getByRole('button',{name:'급여대장'}));fireEvent.click(screen.getByTitle('급여명세서'));fireEvent.click(screen.getByRole('button',{name:'인쇄'}));const input=outputState.html.mock.calls[0][0];expect(input.html).toContain('합성직원');expect(input.html).toContain('실지급액');expect(input.html).not.toContain('급여대장 저장');expect(input.html).not.toContain('<button');expect(input.signal.aborted).toBe(false);fireEvent.click(screen.getByRole('button',{name:'급여명세서 · 합성직원 닫기'}));expect(input.signal.aborted).toBe(true);expect(outputState.html).toHaveBeenCalledOnce();fireEvent.click(screen.getByTitle('급여명세서'));fireEvent.click(screen.getByRole('button',{name:'인쇄'}));const next=outputState.html.mock.calls[1][0];view.rerender(<HRManager {...props} employees={[employee]} companyId="punghoe"/>);expect(next.signal.aborted).toBe(true);expect(screen.queryByRole('button',{name:'인쇄'})).not.toBeInTheDocument();
});
