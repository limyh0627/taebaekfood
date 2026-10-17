/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({pdf:vi.fn()}));
vi.mock('../infrastructure/downloadAsPDF',()=>({downloadAsPDF:mocks.pdf}));
import CCPMetalForm from './CCPMetalForm';
import { CCP_PRODUCTS } from '../domain/ccpProducts';
beforeEach(()=>mocks.pdf.mockClear());
it('관리월과 PDF 파일명·실제 인쇄 영역을 유지한다',()=>{
 render(<CCPMetalForm/>);fireEvent.change(screen.getByLabelText(/관리월/),{target:{value:'2026-09'}});fireEvent.click(screen.getByRole('button',{name:'PDF 저장'}));
 expect(mocks.pdf).toHaveBeenCalledOnce();const [element,filename]=mocks.pdf.mock.calls[0];expect(filename).toBe('HACCP_CCP금속검출모니터링일지_2026-09.pdf');expect(element).toContainElement(screen.getByText('CCP-P 모니터링일지 [금속검출공정]'));expect(element).not.toContainElement(screen.getByRole('button',{name:'+ 행 추가'}));expect(element.textContent).toContain('2026-09');
});
it('행 추가와 제품·배치 입력은 선택한 행만 바꾸고 새 행은 원래 기본값으로 연다',()=>{
 render(<CCPMetalForm/>);fireEvent.click(screen.getByRole('button',{name:'+ 행 추가'}));const rows=screen.getByRole('table').querySelectorAll('tbody tr');expect(rows).toHaveLength(2);
 const first=within(rows[0] as HTMLElement),second=within(rows[1] as HTMLElement);const firstProduct=first.getAllByRole('combobox')[0];expect(within(firstProduct).getAllByRole('option').map(e=>e.textContent)).toEqual(CCP_PRODUCTS);
 fireEvent.change(firstProduct,{target:{value:CCP_PRODUCTS[2]}});const firstInputs=rows[0].querySelectorAll('input');const secondInputs=rows[1].querySelectorAll('input');fireEvent.change(firstInputs[2],{target:{value:'BATCH-1'}});
 expect(firstProduct).toHaveValue(CCP_PRODUCTS[2]);expect(second.getAllByRole('combobox')[0]).toHaveValue(CCP_PRODUCTS[0]);expect(firstInputs[2]).toHaveValue('BATCH-1');expect(secondInputs[2]).toHaveValue('');
});
it('감도와 제품검사 O/X의 원래 뜻·색과 독립 선택을 유지한다',()=>{
 render(<CCPMetalForm/>);const selects=screen.getByRole('table').querySelectorAll('tbody select');
 expect(screen.getByText('감도확인: O=검출(정상) X=미검출(이상) / 제품검사: O=불검출(정상) X=검출(이상)')).toBeInTheDocument();expect(within(selects[1] as HTMLElement).getByRole('option',{name:'O(검출)'})).toHaveValue('O');expect(within(selects[3] as HTMLElement).getByRole('option',{name:'O(불검출)'})).toHaveValue('O');fireEvent.change(selects[1],{target:{value:'O'}});fireEvent.change(selects[2],{target:{value:'X'}});expect(selects[1]).toHaveClass('text-green-600');expect(selects[2]).toHaveClass('text-rose-600');expect(selects[3]).toHaveValue('');
});
