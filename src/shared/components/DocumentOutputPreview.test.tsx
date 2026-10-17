/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DocumentOutputPreview, WorkbookSheets } from './DocumentOutputPreview';
afterEach(cleanup);
it('확인 전 저장하지 않고 전체 병합 표와 빈 행을 유지한다',()=>{
 const save=vi.fn();render(<DocumentOutputPreview title="문서 확인" signal={new AbortController().signal} onSave={save} onClose={vi.fn()}><WorkbookSheets sheets={[{name:'전체',widths:[100,80],rows:[{height:30,cells:[{column:1,text:'병합 제목',colSpan:2,rowSpan:1,align:'center',bold:true}]},{height:20,cells:[{column:1,text:'',colSpan:1,rowSpan:1,align:'left',bold:false},{column:2,text:'',colSpan:1,rowSpan:1,align:'left',bold:false}]}]}]}/></DocumentOutputPreview>);
 expect(screen.getAllByRole('row')).toHaveLength(2); expect(screen.getByText('병합 제목')).toHaveAttribute('colspan','2');expect(save).not.toHaveBeenCalled();
});
it('실패에 내용을 유지하고 저장 연속 클릭을 막는다',async()=>{
 let reject!:(error:Error)=>void;const save=vi.fn().mockImplementationOnce(()=>new Promise<void>((_,no)=>{reject=no;})).mockResolvedValue(undefined),close=vi.fn();
 render(<DocumentOutputPreview title="문서 확인" signal={new AbortController().signal} onSave={save} onClose={close}><p>고정 문서</p></DocumentOutputPreview>);
 const button=screen.getByRole('button',{name:'엑셀 저장'});fireEvent.click(button);fireEvent.click(button);expect(save).toHaveBeenCalledOnce();expect(document.activeElement).toBe(screen.getByRole('button',{name:'닫기'}));
 await act(async()=>reject(Error('실패')));expect(screen.getByRole('alert')).toHaveTextContent('같은 내용');expect(screen.getByText('고정 문서')).toBeInTheDocument();await act(async()=>fireEvent.click(button));expect(close).toHaveBeenCalledOnce();
});

it('인쇄소비자는선택적오류문구만바꾸고고정미리보기·닫기를유지한다',async()=>{const save=vi.fn().mockRejectedValue(Error('프린터')),close=vi.fn();render(<DocumentOutputPreview title="인쇄 확인" saveLabel="인쇄창 열기" errorMessage="인쇄 준비를 확인하고 다시 시도하세요." signal={new AbortController().signal} onSave={save} onClose={close}><p>같은 인쇄 원문</p></DocumentOutputPreview>);await act(async()=>fireEvent.click(screen.getByRole('button',{name:'인쇄창 열기'})));expect(screen.getByRole('alert')).toHaveTextContent('인쇄 준비');expect(screen.getByText('같은 인쇄 원문')).toBeInTheDocument();expect(close).not.toHaveBeenCalled();});
