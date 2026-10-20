/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import StatementEditRecoveryPanel from './StatementEditRecoveryPanel';
const entry = { description: '태백 거래처 · 2026-10-21 수정', observedLocalText: 'body A', observedReferenceText: 'reference A' };
function props() { return { failureRows: [{ entry, currentState: '전표 수정 결과 확인 필요', cause: '응답을 받지 못했습니다.', nextAction: '결과를 확인해 주세요.' }], historyRows: [], busy: false, readLoading: false, readError: '', historyLoading: false, historyError: '', historyMore: false, refresh: vi.fn(), loadHistory: vi.fn(), nextHistory: vi.fn(), inspect: vi.fn(), retry: vi.fn(), stop: vi.fn(), discardCopy: vi.fn(), canInspect: () => true, canRetry: () => true, canStop: () => true, canDiscard: () => true, describe: (row: typeof entry) => row.description, onOpenTerms: vi.fn() }; }
afterEach(cleanup);
it('원문·참조 두 관측값이 있는 선택 행을 재조립하지 않고 결과확인·재시도·중단·정리에 전달한다', () => { const p = props(); render(<StatementEditRecoveryPanel {...p}/>); for (const [label, callback] of [['수정 결과 확인', p.inspect], ['보관한 수정 다시 시도', p.retry], ['미처리 수정 중단', p.stop], ['이 기기 수정 사본 정리', p.discardCopy]] as const) {
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(callback).toHaveBeenCalledWith(entry);
} expect(screen.getByText('현재 상태: 전표 수정 결과 확인 필요')).toBeTruthy(); expect(screen.getByText('다음 행동: 결과를 확인해 주세요.')).toBeTruthy(); });
it('정본이 허용하지 않는 쓰기 동작은 숨기고 조회는 유지한다', () => { render(<StatementEditRecoveryPanel {...props()} canRetry={() => false} canStop={() => false} canDiscard={() => false}/>); expect(screen.getByRole('button', { name: '수정 결과 확인' })).toBeEnabled(); expect(screen.queryByRole('button', { name: '보관한 수정 다시 시도' })).toBeNull(); expect(screen.queryByRole('button', { name: '미처리 수정 중단' })).toBeNull(); expect(screen.queryByRole('button', { name: '이 기기 수정 사본 정리' })).toBeNull(); });
it('열기만으로 이력을 조회하지 않고 명시 이력의 빈 페이지에서도 다음 페이지를 제공한다', () => { const p = props(); render(<StatementEditRecoveryPanel {...p} historyMore/>); expect(p.loadHistory).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: '수정 처리 기록' })); expect(p.loadHistory).toHaveBeenCalledOnce(); expect(screen.getByText(/목록에 없다는 이유만으로/)).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: '수정 기록 더 보기' })); expect(p.nextHistory).toHaveBeenCalledOnce(); expect(p.retry).not.toHaveBeenCalled(); });
it('본문 ACK와 가격 후속 안내를 나누고 기존 거래조건 확인으로 명시 이동한다', () => { const p = props(); render(<StatementEditRecoveryPanel {...p}/>); fireEvent.click(screen.getByRole('button', { name: '거래조건 후속 확인 열기' })); expect(p.onOpenTerms).toHaveBeenCalledOnce(); expect(screen.getByText(/전표 본문과 거래조건·원가 후속 처리는 따로/)).toBeTruthy(); expect(screen.getByText(/원가는 해당 품목의 현재 원가/)).toBeTruthy(); });
