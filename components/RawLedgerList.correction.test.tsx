/** @vitest-environment jsdom */
import React from 'react';
import {render,screen,fireEvent,within} from '@testing-library/react';
import {it,expect,vi} from 'vitest';
import RawLedgerList from './RawLedgerList';
import type {RawMaterialEntry} from '../types';
it('입고 취소 정정은 이력을 표시하고 일반 삭제로 다시 원복하지 않는다',()=>{
 const row:RawMaterialEntry={id:'correction',companyId:'taebaek',rawItemId:'raw',material:'참깨',date:'2026-10-09',createdAt:'2026-10-09T01:00:00Z',received:0,used:680.588,note:'중복 입고 취소',type:'correction',kind:'reverse',reversalOf:'receive'};
 const remove=vi.fn();render(<RawLedgerList entries={[row]} isAdmin onDelete={remove}/>);
 expect(screen.getByText('취소 정정')).toBeInTheDocument();expect(screen.queryByRole('button',{name:'삭제'})).toBeNull();
 fireEvent.click(screen.getByText('취소 정정'));expect(screen.queryByRole('button',{name:'삭제'})).toBeNull();expect(remove).not.toHaveBeenCalled();
});

it('원료 기간 조회는 정정 전후 잔량을 보존하고 날짜 변경 시 상세를 닫고 건수를 맞춘다',()=>{
 const rows=[{id:'before',date:'2026-10-08',received:100,used:0,note:'이전입고'},{id:'one',date:'2026-10-09',received:10,used:0,note:'당일입고'},{id:'after',date:'2026-10-10',received:20,used:0,note:'이후입고'}].map((r)=>({...r,companyId:'taebaek',material:'참깨',type:'manual',createdAt:r.date+'T01:00:00Z'})) as RawMaterialEntry[];
 const view=render(<RawLedgerList entries={rows} allEntries={rows}/>),ui=within(view.container);
 const row=ui.getByText('당일입고').closest('li')!,before=row.textContent;
 fireEvent.click(ui.getByText('당일입고'));expect(ui.getByText('기록자 없음')).toBeTruthy();
 fireEvent.change(ui.getByLabelText('원료 기록일 시작일'),{target:{value:'2026-10-09'}});
 fireEvent.change(ui.getByLabelText('원료 기록일 종료일'),{target:{value:'2026-10-09'}});
 expect(ui.queryByText('이전입고')).toBeNull();expect(ui.queryByText('이후입고')).toBeNull();expect(ui.queryByText('기록자 없음')).toBeNull();expect(ui.getByText('당일입고').closest('li')!.textContent).toBe(before);expect(ui.getByText('1건')).toBeTruthy();
 fireEvent.click(ui.getByRole('button',{name:'초기화'}));expect(ui.getByText('3건')).toBeTruthy();expect(ui.getByText('이전입고')).toBeTruthy();
});
