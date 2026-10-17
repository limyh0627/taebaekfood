/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({pdf:vi.fn()}));
vi.mock('../infrastructure/downloadAsPDF',()=>({downloadAsPDF:m.pdf}));
import { DailyForm } from './DailyForm';
beforeEach(()=>m.pdf.mockClear());
it('주기 순서와 원래 항목 개수를 유지하고 결과·개선 비고는 해당 행만 바꾼다',()=>{
 render(<DailyForm/>);expect(['일일','주간','월간','반기','연간'].map(c=>screen.getByText(`[${c} 점검]`).textContent)).toEqual(['[일일 점검]','[주간 점검]','[월간 점검]','[반기 점검]','[연간 점검]']);const tables=screen.getAllByRole('table');expect(tables.map(t=>t.querySelectorAll('tbody tr').length)).toEqual([11,5,5,3,3]);const rows=tables[0].querySelectorAll('tbody tr'),first=within(rows[0] as HTMLElement),second=within(rows[1] as HTMLElement);const check=first.getAllByRole('checkbox');fireEvent.click(check[0]);expect(check[0]).toBeChecked();fireEvent.click(check[1]);expect(check[0]).not.toBeChecked();expect(check[1]).toBeChecked();expect(second.getAllByRole('checkbox').every(e=>!(e as HTMLInputElement).checked)).toBe(true);fireEvent.change(first.getByRole('textbox'),{target:{value:'개선조치원문'}});expect(second.getByRole('textbox')).toHaveValue('');fireEvent.click(check[1]);expect(check[1]).not.toBeChecked();
});
it('점검월 변경은 입력을 보존하고 PDF에 월과 원래 인쇄 영역을 전달한다',()=>{
 render(<DailyForm/>);const note=within(screen.getAllByRole('table')[0]).getAllByRole('textbox')[0];fireEvent.change(note,{target:{value:'보존원문'}});fireEvent.change(screen.getByLabelText(/점검월/),{target:{value:'2026-09'}});expect(note).toHaveValue('보존원문');fireEvent.click(screen.getByRole('button',{name:'PDF 저장'}));const [element,file]=m.pdf.mock.calls[0];expect(file).toBe('HACCP_일반위생관리점검표_2026-09.pdf');expect(element).toContainElement(screen.getByText('일반위생관리 및 공정점검표'));expect(element).not.toContainElement(screen.getByRole('button',{name:'PDF 저장'}));expect(element.textContent).toContain('2026-09 기준');
});
