/** @vitest-environment jsdom */
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {FeeModal} from './OemFeeModal';
import {buildBomIndex,getBomIndex,setBomIndex} from '../../../shared/bomIndex';
import {buildPackIndex} from '../../../shared/packIndex';
import type {Item,PurchaseOrder} from '../../../shared/types';
const items=['box','loose'].map(id=>({id,companyId:'taebaek',name:id,type:'product',procureType:id==='box'?'임가공':undefined,spec:id==='box'?'1kg * 20':'1kg',unit:'개',stock:0,minStock:0,image:''} as Item));
const original=getBomIndex();
const inputs={bom:buildBomIndex(items,[{parent_id:'box',child_id:'loose',quantity:20}]),pack:buildPackIndex()};
const po={id:'po',companyId:'taebaek',poType:'oem',status:'received',partnerName:'외주',createdAt:'',itemId:'',itemName:'',quantity:0,oemSent:[{material:'참깨',kg:100}],items:[{itemId:'box',name:'box',quantity:1,unit:'개'}],oemReceiptOperationId:'receipt',oemReceivedKg:20,oemFeePerKg:300} as PurchaseOrder;
const props={po,items,companyId:'taebaek' as const,busy:false,onClose:vi.fn(),onSubmit:vi.fn(),orderUnitInputs:inputs};
afterEach(()=>{cleanup();setBomIndex(original);vi.clearAllMocks();});
it('저장 중량과 회사 BOM 환산을 구분하며 단가·날짜만 전달한다',()=>{
 setBomIndex(buildBomIndex(items,[]));const submit=vi.fn();const view=render(<FeeModal {...props} onSubmit={submit}/>);
 expect(screen.getByText('총회수 중량 (저장값)').parentElement?.textContent).toContain('20 kg');
 expect(screen.getByText('제품 중량 (현재 품목 기준 환산)').parentElement?.textContent).toContain('20 kg');
 expect(screen.getByText('6,000원')).toBeTruthy();
 fireEvent.change(view.container.querySelector('input[inputmode="numeric"]')!,{target:{value:'400원'}});
 fireEvent.change(view.container.querySelector('input[type="date"]')!,{target:{value:'2026-10-12'}});
 expect(screen.getByText('8,000원')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'전표 발행'}));
 expect(submit).toHaveBeenCalledWith({unitPricePerKg:400,date:'2026-10-12'});
});
it('회수 저장값이 없으면 현재 품목으로 추정 발행하지 않고 원가 미확인을 표시한다',()=>{
 render(<FeeModal {...props} po={{...po,oemReceivedKg:undefined}}/>);
 expect(screen.getByText('총회수 중량 (저장값)').parentElement?.textContent).toContain('자료 없음');
 expect(screen.getByText(/OEM 원가 미확인/)).toBeTruthy();
 expect(screen.getByRole('button',{name:'전표 발행'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'전표 발행'}));expect(props.onSubmit).not.toHaveBeenCalled();
});
it('처리 중 중복 발행과 취소를 막고 평상시 취소 콜백을 유지한다',()=>{
 const close=vi.fn();const view=render(<FeeModal {...props} busy onClose={close}/>);
 expect(screen.getByRole('button',{name:'발행 중…'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'취소'})).toBeDisabled();
 view.rerender(<FeeModal {...props} onClose={close}/>);
 fireEvent.click(screen.getByRole('button',{name:'취소'}));expect(close).toHaveBeenCalledOnce();
});
it('발행 대기에는 단가와 전표일자를 잠가 최초 입력을 보존한다',()=>{const view=render(<FeeModal {...props}/>);fireEvent.change(view.container.querySelector('input[inputmode="numeric"]')!,{target:{value:'450'}});view.rerender(<FeeModal {...props} busy/>);expect(view.container.querySelector('input[inputmode="numeric"]')).toBeDisabled();expect(view.container.querySelector('input[type="date"]')).toBeDisabled();});