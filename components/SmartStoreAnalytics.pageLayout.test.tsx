/** @vitest-environment jsdom */
import {fireEvent,render,screen} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import SmartStoreAnalytics from './SmartStoreAnalytics';

it('이름이 있는 분석 탭을 요약 카드보다 먼저 두고 기존 분석 보기만 바꾼다',()=>{
 const update=vi.fn();render(<SmartStoreAnalytics orders={[]} partners={[]} items={[]} onUpdateItem={update}/>);
 const title=screen.getByRole('heading',{name:'스마트스토어 분석'}),summary=screen.getByText('전체 매출 (단가 기준)');
 for(const name of ['월별 매출','고객별 현황','신규 / 재주문','단가 관리']){const tab=screen.getByRole('button',{name});expect(title.compareDocumentPosition(tab)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(tab.compareDocumentPosition(summary)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(tab.querySelector('span')).not.toHaveClass('hidden');expect(tab).toHaveClass('h-9');}
 fireEvent.click(screen.getByRole('button',{name:'단가 관리'}));expect(screen.getByText('스마트스토어 전용 품목이 없습니다.')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'월별 매출'}));expect(screen.getByRole('columnheader',{name:'월'})).toBeInTheDocument();expect(update).not.toHaveBeenCalled();
});
