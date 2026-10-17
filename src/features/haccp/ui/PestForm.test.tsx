/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({pdf:vi.fn()}));
vi.mock('../infrastructure/downloadAsPDF',()=>({downloadAsPDF:m.pdf}));
import { PestForm } from './PestForm';
import { today } from '../../../shared/day';
beforeEach(()=>m.pdf.mockClear());
it('행별 계절·장소·검사는 독립적이고 새 행의 날짜와 기본값을 보존한다',()=>{
 render(<PestForm/>);fireEvent.click(screen.getByRole('button',{name:'+ 행 추가'}));const rows=screen.getByRole('table').querySelectorAll('tbody tr');expect(rows).toHaveLength(2);const first=within(rows[0] as HTMLElement).getAllByRole('combobox'),second=within(rows[1] as HTMLElement).getAllByRole('combobox');
 fireEvent.change(first[0],{target:{value:'동절기'}});fireEvent.change(first[1],{target:{value:'포장실'}});fireEvent.change(first[2],{target:{value:'X'}});fireEvent.change(first[3],{target:{value:'O'}});
 expect(first[0]).toHaveValue('동절기');expect(first[1]).toHaveValue('포장실');expect(first[2]).toHaveClass('text-rose-600');expect(first[3]).toHaveClass('text-green-600');expect(second[0]).toHaveValue('하절기');expect(second[1]).toHaveValue('');expect(second[2]).toHaveValue('');expect(rows[1].querySelector('input[type=date]')).toHaveValue(today());
});
it('점검기준·장소·검사항목 원문을 유지한다',()=>{
 render(<PestForm/>);expect(screen.getByText('O: 이상 없음 / X: 이상 있음 (X 시 개선조치 기재 필수)')).toBeInTheDocument();expect(screen.getByText(/하절기\(4~10월\): 주 1회 이상/)).toBeInTheDocument();const selects=screen.getAllByRole('combobox');expect(within(selects[1]).getAllByRole('option').map(e=>e.textContent)).toEqual(['선택','원료 창고','제조실(향미유)','제조실(고춧가루)','포장실','완제품 창고','탈의실','화장실','외부 주변']);expect(screen.getByRole('columnheader',{name:'이물·쥐똥 흔적 여부'})).toBeInTheDocument();
});
it('PDF는 현재 연도 파일명과 실제 인쇄 영역을 전달한다',()=>{
 render(<PestForm/>);fireEvent.click(screen.getByRole('button',{name:'PDF 저장'}));const [element,file]=m.pdf.mock.calls[0];expect(file).toBe(`HACCP_방충방서점검표_${new Date().getFullYear()}.pdf`);expect(element).toContainElement(screen.getByText('방충·방서 점검표'));expect(element).not.toContainElement(screen.getByRole('button',{name:'+ 행 추가'}));
});
