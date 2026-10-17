/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({pdf:vi.fn()}));
vi.mock('../infrastructure/downloadAsPDF',()=>({downloadAsPDF:mocks.pdf}));
import CCPHeatForm from './CCPHeatForm';
import { CCP_PRODUCTS } from '../domain/ccpProducts';
beforeEach(()=>mocks.pdf.mockClear());
it('관리월과 PDF 파일명·실제 인쇄 영역을 유지한다',()=>{
 render(<CCPHeatForm/>);fireEvent.change(screen.getByLabelText(/관리월/),{target:{value:'2026-09'}});fireEvent.click(screen.getByRole('button',{name:'PDF 저장'}));
 expect(mocks.pdf).toHaveBeenCalledOnce();const [element,filename]=mocks.pdf.mock.calls[0];expect(filename).toBe('HACCP_CCP가열살균모니터링일지_2026-09.pdf');expect(element).toContainElement(screen.getByText('CCP-B 모니터링일지 [가열·살균공정]'));expect(element).not.toContainElement(screen.getByRole('button',{name:'+ 행 추가'}));expect(element.textContent).toContain('2026-09');
});
it('행 추가와 제품·배치 입력은 선택한 행만 바꾸고 새 행은 원래 기본값으로 연다',()=>{
 render(<CCPHeatForm/>);fireEvent.click(screen.getByRole('button',{name:'+ 행 추가'}));const rows=screen.getByRole('table').querySelectorAll('tbody tr');expect(rows).toHaveLength(2);
 const first=within(rows[0] as HTMLElement),second=within(rows[1] as HTMLElement);const firstProduct=first.getAllByRole('combobox')[0];expect(within(firstProduct).getAllByRole('option').map(e=>e.textContent)).toEqual(CCP_PRODUCTS);
 fireEvent.change(firstProduct,{target:{value:CCP_PRODUCTS[2]}});const firstInputs=rows[0].querySelectorAll('input');const secondInputs=rows[1].querySelectorAll('input');fireEvent.change(firstInputs[1],{target:{value:'BATCH-1'}});
 expect(firstProduct).toHaveValue(CCP_PRODUCTS[2]);expect(second.getAllByRole('combobox')[0]).toHaveValue(CCP_PRODUCTS[0]);expect(firstInputs[1]).toHaveValue('BATCH-1');expect(secondInputs[1]).toHaveValue('');
});
it('가열 적합 O/X의 원래 뜻·색과 독립 선택을 유지한다',()=>{
 render(<CCPHeatForm/>);const selects=screen.getByRole('table').querySelectorAll('tbody select');
 expect(screen.getByText('O: 한계기준 적합 / X: 한계기준 이탈 (개선조치 기재 필수)')).toBeInTheDocument();fireEvent.change(selects[1],{target:{value:'X'}});expect(selects[1]).toHaveClass('text-rose-600');fireEvent.change(selects[1],{target:{value:'O'}});expect(selects[1]).toHaveClass('text-green-600');
});
