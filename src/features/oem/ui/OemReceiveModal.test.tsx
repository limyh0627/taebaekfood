/** @vitest-environment jsdom */
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {ReceiveModal} from './OemReceiveModal';
import {buildBomIndex,getBomIndex,setBomIndex} from '../../../shared/bomIndex';
import {buildPackIndex} from '../../../shared/packIndex';
import type {Item,PurchaseOrder} from '../../../shared/types';
const items=['box','loose'].map(id=>({id,companyId:'taebaek',name:id,type:'product',procureType:id==='box'?'임가공':undefined,spec:id==='box'?'1kg * 20':'1kg',unit:'개',stock:0,minStock:0,image:''} as Item));
const original=getBomIndex();
const inputs={bom:buildBomIndex(items,[{parent_id:'box',child_id:'loose',quantity:20}]),pack:buildPackIndex()};
const po={id:'po',companyId:'taebaek',poType:'oem',status:'invoiced',partnerName:'외주',createdAt:'',itemId:'',itemName:'',quantity:0,oemFeePerKg:300,oemSent:[{material:'참깨',rawItemId:'raw',kg:100}]} as PurchaseOrder;
const props={companyId:'taebaek' as const,po,oemItems:[items[0]],bulkItems:[],busy:false,onClose:vi.fn(),onSubmit:vi.fn(),pendingReceipt:null,orderUnitInputs:inputs};
afterEach(()=>{cleanup();setBomIndex(original);vi.useRealTimers();vi.clearAllMocks();});
it('회사 BOM으로 중량을 표시하고 정수 수량·일자·단가를 그대로 전달한다',()=>{
 setBomIndex(buildBomIndex(items,[]));
 const submit=vi.fn();const view=render(<ReceiveModal {...props} onSubmit={submit}/>);
 expect(screen.getByRole('button',{name:'가공입고'})).toBeDisabled();
 fireEvent.change(screen.getByPlaceholderText('수량'),{target:{value:'1개'}});
 fireEvent.change(view.container.querySelector('input[type="date"]')!,{target:{value:'2026-10-11'}});
 expect(screen.getByText('받은 완제품').parentElement?.textContent).toContain('20 kg');
 fireEvent.click(screen.getByRole('button',{name:'가공입고'}));
 expect(submit).toHaveBeenCalledWith({returns:[{itemId:'box',qty:1}],bulk:[],unitPricePerKg:300,date:'2026-10-11'});
});
it('원가 근거의 최초 확인 시각을 재입력해도 유지하고 불완전 근거는 저장하지 않는다',()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-17T00:00:00Z'));
 const submit=vi.fn();render(<ReceiveModal {...props} onSubmit={submit}/>);
 fireEvent.change(screen.getByPlaceholderText('수량'),{target:{value:'2'}});
 fireEvent.click(screen.getByText('원가 근거 기록 (선택)'));
 fireEvent.change(screen.getByLabelText('입고 1행 원료 공급가액'),{target:{value:'10000'}});
 fireEvent.click(screen.getByRole('button',{name:'가공입고'}));
 expect(submit.mock.calls[0][0]).not.toHaveProperty('oemCostEvidence');
 vi.setSystemTime(new Date('2026-10-17T01:00:00Z'));
 fireEvent.change(screen.getByLabelText('입고 부자재 공급가액'),{target:{value:'0'}});
 fireEvent.click(screen.getByLabelText('입고 부자재 공급가액 확인'));
 fireEvent.click(screen.getByRole('button',{name:'가공입고'}));
 expect(submit.mock.calls[1][0].oemCostEvidence).toEqual({version:1,ownerCompanyId:'taebaek',rawMaterials:[{rawItemId:'raw',kg:100,supplyAmount:10000}],packaging:{confirmed:true,supplyAmount:0},capturedAt:'2026-10-17T00:00:00.000Z'});
});
it('대기 요청 안내와 오류 잠금·처리 중 잠금 및 취소를 유지한다',()=>{
 const close=vi.fn();const view=render(<ReceiveModal {...props} pendingError="확인 필요" onClose={close}/>);
 fireEvent.change(screen.getByPlaceholderText('수량'),{target:{value:'1'}});
 expect(screen.getByRole('alert')).toHaveTextContent('확인 필요');
 expect(screen.getByRole('button',{name:'가공입고'})).toBeDisabled();
 view.rerender(<ReceiveModal {...props} busy onClose={close}/>);
 expect(screen.getByRole('button',{name:'처리 중…'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'취소'})).toBeDisabled();
 view.rerender(<ReceiveModal {...props} onClose={close}/>);
 fireEvent.click(screen.getByRole('button',{name:'취소'}));expect(close).toHaveBeenCalledOnce();
});

it('벌크 소수 kg와 선택 원료를 반환하고 빈 완제품 행은 제외한다',()=>{
 const submit=vi.fn();const raw={...items[1],id:'bulk',name:'참깨',type:'raw'} as Item;
 render(<ReceiveModal {...props} bulkItems={[raw]} onSubmit={submit}/>);
 fireEvent.change(screen.getAllByRole('combobox')[1],{target:{value:'참깨'}});
 fireEvent.change(screen.getByPlaceholderText('kg'),{target:{value:'2.5kg'}});
 expect(screen.getByText('받은 완제품').parentElement?.textContent).toContain('2.5 kg');
 fireEvent.click(screen.getByRole('button',{name:'가공입고'}));
 expect(submit.mock.calls[0][0]).toMatchObject({returns:[],bulk:[{material:'참깨',kg:2.5}],unitPricePerKg:300});
});
it('이전 요청은 입력 없는 상태에서도 재개 버튼과 원문 재사용 안내를 유지한다',()=>{
 const pending={po,returns:[{itemId:'box',qty:3}],bulk:[],unitPricePerKg:123,date:'2026-10-10'};
 const submit=vi.fn();const view=render(<ReceiveModal {...props} pendingReceipt={pending} onSubmit={submit}/>);
 expect(screen.getByRole('status')).toHaveTextContent('화면에서 바꾼 입력은 재개 요청에 적용하지 않습니다');
 expect(screen.getByRole('button',{name:'입고 요청 재개'})).toBeEnabled();
 fireEvent.click(screen.getByRole('button',{name:'입고 요청 재개'}));expect(submit).toHaveBeenCalledOnce();
 expect(pending.returns).toEqual([{itemId:'box',qty:3}]);
 view.rerender(<ReceiveModal {...props} pendingReceipt={pending} pendingError="원문 확인 필요"/>);
 expect(screen.getByRole('button',{name:'입고 요청 재개'})).toBeDisabled();
});
it('입고 대기 중에는 수량·일자·행추가와 창닫기를 잠가 최초 입력을 유지한다',()=>{
 const close=vi.fn(),submit=vi.fn();const view=render(<ReceiveModal {...props} onClose={close} onSubmit={submit}/>);
 fireEvent.change(screen.getByPlaceholderText('수량'),{target:{value:'3'}});fireEvent.click(screen.getByRole('button',{name:'가공입고'}));
 view.rerender(<ReceiveModal {...props} busy onClose={close} onSubmit={submit}/>);
 expect(screen.getByPlaceholderText('수량')).toBeDisabled();expect(view.container.querySelector('input[type="date"]')).toBeDisabled();expect(screen.getByRole('button',{name:'품목 추가'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'가공입고 닫기'}));expect(close).not.toHaveBeenCalled();
 view.rerender(<ReceiveModal {...props} pendingError="응답 미확인" onClose={close} onSubmit={submit}/>);expect(screen.getByPlaceholderText('수량')).toHaveValue('3');
});