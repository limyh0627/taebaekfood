/** @vitest-environment jsdom */
import React from 'react';
import {render,screen,fireEvent} from '@testing-library/react';
import {it,expect,vi} from 'vitest';
import RawLedgerList from './RawLedgerList';
import type {RawMaterialEntry} from '../types';
it('입고 취소 정정은 이력을 표시하고 일반 삭제로 다시 원복하지 않는다',()=>{
 const row:RawMaterialEntry={id:'correction',companyId:'taebaek',rawItemId:'raw',material:'참깨',date:'2026-10-09',createdAt:'2026-10-09T01:00:00Z',received:0,used:680.588,note:'중복 입고 취소',type:'correction',kind:'reverse',reversalOf:'receive'};
 const remove=vi.fn();render(<RawLedgerList entries={[row]} isAdmin onDelete={remove}/>);
 expect(screen.getByText('취소 정정')).toBeInTheDocument();expect(screen.queryByRole('button',{name:'삭제'})).toBeNull();
 fireEvent.click(screen.getByText('취소 정정'));expect(screen.queryByRole('button',{name:'삭제'})).toBeNull();expect(remove).not.toHaveBeenCalled();
});
