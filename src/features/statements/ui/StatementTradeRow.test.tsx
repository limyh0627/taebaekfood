/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StatementTradeMobileRow, StatementTradeTableRow } from './StatementTradeRow';
import type { IssuedStatement } from '../../../shared/types';
import type { StatementHistoryRowView } from '../domain/statementHistoryRowView';

const statement = { id: 's1', type: '매출', partnerName: '해피유통', totalAmount: 110_000 } as IssuedStatement;
const view: StatementHistoryRowView = {
  key: 's1', kind: 'stmt', label: '매출', date: '2026-09-15', owner: '관리자', partner: '해피유통',
  detail: '참기름 10병', note: '', amount: 110_000, cumulative: 60_000, isReturn: false,
};

describe('매출·매입 전표 행', () => {
  it('표 행에서 수금과 증빙 변경을 각각 전달한다', () => {
    const onOpen = vi.fn(), onSettle = vi.fn(), onEvidence = vi.fn();
    render(<table><tbody><StatementTradeTableRow statement={statement} view={view} shownAmount={110_000} partial={false}
      settle={{ state: 'partial', label: '부분수금' }} canSettle evidenceChoices={['미발행', '세금계산서']} evidence="미발행"
      dateCell={<span>날짜</span>} journalToggle={<span>분개</span>} onOpen={onOpen} onSettle={onSettle} onEvidence={onEvidence}/></tbody></table>);
    expect(screen.getByText('부분수금')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '수금처리' }));
    fireEvent.change(screen.getByLabelText('해피유통 증빙'), { target: { value: '세금계산서' } });
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(onEvidence).toHaveBeenCalledWith('세금계산서');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('모바일 행은 반품과 잔액을 같은 표시값으로 보여준다', () => {
    render(<StatementTradeMobileRow statement={statement} view={{ ...view, isReturn: true }} dateLabel="2026-09-15 10:30"
      canSettle={false} journalToggle={<span>분개</span>} onOpen={vi.fn()} onSettle={vi.fn()}/>);
    expect(screen.getByText('반품')).toBeInTheDocument();
    expect(screen.getByText('잔액 60,000')).toBeInTheDocument();
    expect(screen.getByText('2026-09-15 10:30')).toBeInTheDocument();
  });

  it('일반전표의 채무 대변은 지불처리로 표시한다', () => {
    const payable = { ...statement, type: '비용', items: [{ accountCode: '251', side: '대변' }] } as IssuedStatement;
    render(<table><tbody><StatementTradeTableRow statement={payable} view={view} shownAmount={110_000} partial={false}
      settle={{ state: 'open', label: '미지급' }} canSettle evidenceChoices={[]} evidence="미발행"
      dateCell={<span>날짜</span>} journalToggle={<span>분개</span>} onOpen={vi.fn()} onSettle={vi.fn()}/></tbody></table>);
    expect(screen.getByRole('button', { name: '지불처리' })).toBeInTheDocument();
  });
});

it('증빙 저장을 기다리고 실패 이유를 행에 표시하며 선택 원값을 유지한다', async () => {
  let reject!: (error: Error) => void;
  const pending = new Promise<void>((_resolve, fail) => { reject = fail; });
  const onEvidence = vi.fn(() => pending);
  render(<table><tbody><StatementTradeTableRow statement={statement} view={view} shownAmount={110_000} partial={false} settle={{ state: 'open', label: '미수' }} canSettle={false} evidenceChoices={['미발행', '세금계산서']} evidence="미발행" dateCell={null} journalToggle={null} onOpen={vi.fn()} onSettle={vi.fn()} onEvidence={onEvidence}/></tbody></table>);
  const select = screen.getByLabelText('해피유통 증빙');
  fireEvent.change(select, { target: { value: '세금계산서' } });
  expect(select).toBeDisabled(); expect(screen.getByRole('status')).toHaveTextContent('저장 중');
  fireEvent.change(select, { target: { value: '세금계산서' } }); expect(onEvidence).toHaveBeenCalledTimes(1);
  await act(async () => { reject(Error('증빙 저장 실패')); await pending.catch(() => {}); });
  expect(screen.getByRole('alert')).toHaveTextContent('증빙 저장 실패'); expect(select).toHaveValue('미발행'); expect(select).toBeEnabled();
});
it('같은 전표의 UID 교체는 새 증빙 입력을 열고 옛 실패가 새 busy를 건드리지 않는다', async () => {
  let rejectOld!: (error: Error) => void, resolveNew!: () => void;
  const old = new Promise<void>((_done, reject) => { rejectOld = reject; });
  const fresh = new Promise<void>(resolve => { resolveNew = resolve; });
  const props = { statement, view, shownAmount: 110_000, partial: false, settle: { state: 'open' as const, label: '미수' }, canSettle: false, evidenceChoices: ['미발행', '세금계산서'], evidence: '미발행', dateCell: null, journalToggle: null, onOpen: vi.fn(), onSettle: vi.fn() };
  const row = (scope: string, save: () => Promise<void>) => <table><tbody><StatementTradeTableRow {...props} editScopeKey={scope} onEvidence={save}/></tbody></table>;
  const rendered = render(row('actor-A', () => old));
  fireEvent.change(screen.getByLabelText('해피유통 증빙'), { target: { value: '세금계산서' } });
  rendered.rerender(row('actor-B', () => fresh)); expect(screen.getByLabelText('해피유통 증빙')).toBeEnabled();
  fireEvent.change(screen.getByLabelText('해피유통 증빙'), { target: { value: '세금계산서' } });
  await act(async () => { rejectOld(Error('옛 계정 실패')); await old.catch(() => {}); });
  expect(screen.queryByText('옛 계정 실패')).not.toBeInTheDocument(); expect(screen.getByLabelText('해피유통 증빙')).toBeDisabled();
  await act(async () => { resolveNew(); await fresh; }); expect(screen.getByLabelText('해피유통 증빙')).toBeEnabled();
});

it('반품도 흰 행과 본문 크기를 쓰고 모든 잔액 부호가 12px이다', () => {
  for(const cumulative of [0,60_000,-60_000]){
    const result=render(<StatementTradeMobileRow statement={statement} view={{...view,cumulative,isReturn:true}} dateLabel="날짜" canSettle journalToggle={null} onOpen={vi.fn()} onSettle={vi.fn()}/>);
    expect(result.container.firstElementChild).toHaveClass('bg-white','text-[12px]');
    expect(screen.getByText('반품')).toHaveClass('text-[12px]');
    expect(screen.getByText('반품').className).not.toMatch(/bg-/);
    expect(screen.getByText(cumulative===0?'0':cumulative>0?'잔액 60,000':'−60,000')).toHaveClass('text-[12px]');
    expect(screen.getByRole('button',{name:'수금처리'})).toHaveClass('text-[11px]');
    result.unmount();
  }
});
