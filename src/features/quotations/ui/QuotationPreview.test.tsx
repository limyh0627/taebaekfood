/** @vitest-environment jsdom */
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {QuotationPreview} from './QuotationPreview';
import type {Quotation} from '../domain/quotation';
import type {CompanyInfo} from '../../../shared/types';
const company:CompanyInfo={name:'공급회사',ceoName:'대표',bizNo:'123',bizType:'제조',bizItem:'식품',address:'공장주소',phone:'02-000',fax:'02-111',bankAccount:'은행 123'};
const quote:Quotation={id:'q',quoteNo:'Q-1',date:'2026-10-17',partnerId:'p',partnerName:'거래처',recipientPhone:'010-123',attention:'담당',deliveryTerms:'일주일',paymentTerms:'현금',lines:[{name:'참기름',spec:'1kg',qty:2.5,unit:'kg',price:10000,cost:6000,isTaxExempt:false,note:'안내'}],totalSupply:22727,totalTax:2273,totalAmount:25000,note:'첫줄\n둘째줄',createdAt:''};
const props={viewing:quote,printCompany:company,companyName:'기본회사',onClose:vi.fn(),onPrint:vi.fn()};
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('소수 수량·단위·금액 원문을 최소12행 인쇄 문서에 표시하고 원가는 인쇄에서 숨긴다',()=>{
 const before=JSON.stringify(quote);const view=render(<QuotationPreview {...props}/>);
 const doc=view.container.querySelector('#quotation-print-document')!;
 const tables=within(doc as HTMLElement).getAllByRole('table');const rows=within(tables[1]).getAllByRole('row');
 expect(rows).toHaveLength(14);
 expect(within(rows[1]).getAllByRole('cell').map(c=>c.textContent)).toEqual(['1','참기름','1kg','2.5','kg','10,000','22,727','2,273','안내']);
 expect(within(rows[12]).getAllByRole('cell').map(c=>c.textContent)).toEqual(['12','','','','','','','','']);
 expect(within(doc as HTMLElement).getByText('일금 ₩ 25,000정')).toBeTruthy();
 expect(screen.getByText(/원가 15,000/).classList.contains('print:hidden')).toBe(true);
 expect(doc.querySelector('.whitespace-pre-wrap')?.textContent).toBe('첫줄\n둘째줄');expect(JSON.stringify(quote)).toBe(before);
});
it('12개를 넘는 실제행을 모두 표시하고 면세·단위 스냅샷을 유지한다',()=>{
 const lines=Array.from({length:13},(_,i)=>({...quote.lines[0],name:'품목'+i,qty:0.0001,isTaxExempt:true}));
 const view=render(<QuotationPreview {...props} viewing={{...quote,lines}}/>);
 const table=view.container.querySelectorAll('#quotation-print-document table')[1];const rows=within(table as HTMLElement).getAllByRole('row');
 expect(rows).toHaveLength(15);expect(within(rows[13]).getAllByRole('cell').map(c=>c.textContent)).toEqual(['13','품목12','1kg','0.0001','kg','10,000','1','0','면세']);
});
it('회사명 폴백과 연락처·계좌·유효기간의 기존 빈값 안내를 유지한다',()=>{
 render(<QuotationPreview {...props} printCompany={{...company,name:'',phone:'',fax:'',bankAccount:''}} viewing={{...quote,recipientPhone:'',attention:'',deliveryTerms:'',paymentTerms:'',validUntil:undefined}}/>);
 expect(screen.getByText('기본회사')).toBeTruthy();expect(screen.getByText('별도 안내')).toBeTruthy();
 expect(screen.getAllByText('별도 협의')).toHaveLength(4);expect(screen.getAllByText('—')).toHaveLength(3);
 expect(screen.queryByText(/FAX/)).toBeNull();
});
it('배경과 안쪽 클릭은 현재 견적을 유지하고 인쇄·명시닫기만 원콜백을 호출한다',()=>{
 const close=vi.fn(),print=vi.fn();const view=render(<QuotationPreview {...props} onClose={close} onPrint={print}/>);
 fireEvent.click(screen.getByText('참기름'));expect(close).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'인쇄'}));expect(print).toHaveBeenCalledOnce();expect(close).not.toHaveBeenCalled();
 const area=view.container.querySelector('#quotation-print-area')!;fireEvent.click(area.parentElement!);expect(close).not.toHaveBeenCalled();expect(area.querySelector('.whitespace-pre-wrap')?.textContent).toBe('첫줄\n둘째줄');
 fireEvent.click(within(area as HTMLElement).getAllByRole('button')[1]);expect(close).toHaveBeenCalledOnce();expect(print).toHaveBeenCalledOnce();
});
