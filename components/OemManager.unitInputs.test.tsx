/** @vitest-environment jsdom */
import {afterEach,expect,it,vi} from 'vitest';
import {fireEvent,render,screen} from '@testing-library/react';
import OemManager from './OemManager';
import {buildBomIndex,getBomIndex,setBomIndex} from '../src/shared/bomIndex';
import {buildPackIndex} from '../src/shared/packIndex';
import type {Item,PurchaseOrder} from '../src/shared/types';
const items=['box','loose'].map(id=>({id,companyId:'taebaek',name:id,type:'product',procureType:id==='box'?'임가공':undefined,spec:id==='box'?'1kg * 20':'1kg',unit:'개',stock:0,minStock:0,image:''} as Item));
const inputs={bom:buildBomIndex(items,[{parent_id:'box',child_id:'loose',quantity:20}]),pack:buildPackIndex()};
const other=buildBomIndex(items,[]),original=getBomIndex();
afterEach(()=>setBomIndex(original));
const order={id:'po',companyId:'taebaek',poType:'oem',status:'received',partnerName:'외주',createdAt:'',itemId:'',itemName:'',quantity:0,
 oemSent:[{material:'참깨',kg:100}],items:[{itemId:'box',name:'box',quantity:1,unit:'개'}],oemReceiptOperationId:'receipt',oemReceivedKg:20} as PurchaseOrder;
const props={companyId:'taebaek' as const,items,partners:[],rawStockKg:()=>0,issueDrafts:[],issueOpen:false,onClose:vi.fn(),onIssue:vi.fn(),onReceive:vi.fn(),onIssueFee:vi.fn(),orderUnitInputs:inputs};
it('다른 전역 BOM에서도 회사 입력으로 회수 미리보기 1박스20kg를 표시한다',()=>{
 setBomIndex(other);
 render(<OemManager {...props} receiveTarget={{...order,status:'invoiced'}} feeTarget={null}/>);
 fireEvent.change(screen.getByPlaceholderText('수량'),{target:{value:'1'}});
 expect(screen.getByText('받은 완제품').parentElement?.textContent).toContain('20 kg');
 expect(getBomIndex()).toBe(other);
});
it('같은 입력으로 조회 대조20kg를 표시하고 정상 저장 중량과 불일치를 만들지 않는다',()=>{
 setBomIndex(other);
 render(<OemManager {...props} receiveTarget={null} feeTarget={order}/>);
 expect(screen.getByText('제품 중량 (현재 품목 기준 환산)').parentElement?.textContent).toContain('20 kg');
 expect(screen.queryByText('저장된 회수 중량과 제품·벌크 단위 불일치')).toBeNull();
 expect(getBomIndex()).toBe(other);
});
it('두 회사 화면이 동시에 각 입력으로 회수 미리보기를 계산한다',()=>{
 setBomIndex(other);
 const view=render(<OemManager {...props} receiveTarget={{...order,status:'invoiced'}} feeTarget={null}/>);
 fireEvent.change(screen.getByPlaceholderText('수량'),{target:{value:'1'}});
 render(<OemManager {...props} companyId="punghoe" items={items.map(item=>({...item,companyId:'punghoe'}))}
  orderUnitInputs={{bom:other,pack:inputs.pack}} receiveTarget={{...order,companyId:'punghoe',status:'invoiced'}} feeTarget={null}/>);
 fireEvent.change(screen.getAllByPlaceholderText('수량')[1],{target:{value:'1'}});
 const totals=screen.getAllByText('받은 완제품').map(label=>label.parentElement?.textContent);
 expect(totals).toEqual(['받은 완제품20 kg','받은 완제품1 kg']);
 view.rerender(<OemManager {...props} receiveTarget={{...order,status:'invoiced'}} feeTarget={null}/>);
 expect(screen.getAllByText('받은 완제품')[0].parentElement?.textContent).toContain('20 kg');
 expect(getBomIndex()).toBe(other);
});
