/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({pdf:vi.fn()}));
vi.mock('../infrastructure/downloadAsPDF',()=>({downloadAsPDF:m.pdf}));
import { OverviewForm } from './OverviewForm';
beforeEach(()=>m.pdf.mockClear());
const bodyRows=()=>screen.getByRole('table').querySelectorAll('tbody tr');
const summary=()=>screen.getByText('최종판정:',{exact:false}).textContent;
it('초기 20행은 미선택이며 기존 17개·85% 경계로 판정한다',()=>{
 render(<OverviewForm/>);const rows=bodyRows();expect(rows).toHaveLength(20);expect(screen.getAllByRole('checkbox').every(c=>!(c as HTMLInputElement).checked)).toBe(true);for(let i=0;i<16;i++)fireEvent.click(within(rows[i] as HTMLElement).getAllByRole('checkbox')[0]);expect(summary()).toBe('최종판정: 부적합');fireEvent.click(within(rows[16] as HTMLElement).getAllByRole('checkbox')[0]);expect(summary()).toBe('최종판정: 적합');expect(screen.getByText('85%')).toBeInTheDocument();
});
it('높은 적합률이어도 원스트라이크 X는 부적합이며 같은 체크 재선택은 해제된다',()=>{
 render(<OverviewForm/>);const rows=bodyRows();rows.forEach(row=>fireEvent.click(within(row as HTMLElement).getAllByRole('checkbox')[0]));const checks=within(rows[1] as HTMLElement).getAllByRole('checkbox');fireEvent.click(checks[1]);expect(checks[0]).not.toBeChecked();expect(screen.getByText('95%')).toBeInTheDocument();expect(summary()).toBe('최종판정: 부적합(원스트라이크아웃)');fireEvent.click(checks[1]);expect(checks[1]).not.toBeChecked();expect(summary()).toBe('최종판정: 적합');
});
it('개별 비고·평가자·평가일과 PDF 영역·파일명을 유지한다',()=>{
 render(<OverviewForm/>);const notes=screen.getAllByPlaceholderText('비고');fireEvent.change(notes[0],{target:{value:'개별원문'}});expect(notes[1]).toHaveValue('');fireEvent.change(screen.getByLabelText(/평가일/),{target:{value:'2026-09-01'}});fireEvent.change(screen.getByPlaceholderText('이름 입력'),{target:{value:'평가자원문'}});fireEvent.click(screen.getByRole('button',{name:'PDF 저장'}));const [element,file]=m.pdf.mock.calls[0];expect(file).toBe('HACCP_사후평가점검표_2026-09-01.pdf');expect(element).toContainElement(screen.getByText('소규모 HACCP업체 사후평가 점검표'));expect(element).not.toContainElement(screen.getByRole('button',{name:'PDF 저장'}));expect(element.textContent).toContain('평가자원문');
});
