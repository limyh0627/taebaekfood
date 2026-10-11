/** @vitest-environment jsdom */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import OemManager from './OemManager';
import type { Item, PurchaseOrder } from '../src/shared/types';
import { buildOemBatchCostPreview, finalizeOemBatchCost, type OemBatchCost } from '../src/shared/oemBatchCost';

const item = { id: 'product', companyId: 'taebaek', name: '볶음참깨', type: 'product', spec: '1kg', unit: '개' } as Item;
const po = (patch: Partial<PurchaseOrder> = {}) => ({ id: 'po', companyId: 'taebaek', poType: 'oem', status: 'received',
  partnerName: '외주공장', createdAt: '', itemId: '', itemName: '', quantity: 0,
  oemSent: [{ material: '참깨', kg: 100 }], ...patch }) as PurchaseOrder;
function view(order: PurchaseOrder, products = [item], companyId: 'taebaek' | 'punghoe' = 'taebaek') {
  const onIssueFee = vi.fn().mockResolvedValue(undefined);
  render(<OemManager companyId={companyId} items={products} partners={[]} rawStockKg={() => 0} issueDrafts={[]}
    issueOpen={false} receiveTarget={null} feeTarget={order} onClose={vi.fn()} onIssue={vi.fn()}
    onReceive={vi.fn()} onIssueFee={onIssueFee} />);
  return onIssueFee;
}
it('구형 총회수 누락은 0kg·확정 로스로 표시하지 않는다', () => {
  view(po());
  expect(screen.getByText('총회수 중량 (저장값)').parentElement?.textContent).toContain('자료 없음');
  expect(screen.getByText('산술 차이 · 손실 미확정').parentElement?.textContent).toContain('미확정');
  expect(screen.queryByText('로스')).toBeNull();
});
it('입고 입력 미리보기는 확정 손실 대신 추정 송출·입고 차이로 안내한다', () => {
  const receive = vi.fn();
  render(<OemManager companyId="taebaek" items={[item]} partners={[]} rawStockKg={() => 0} issueDrafts={[]}
    issueOpen={false} receiveTarget={po({ status: 'invoiced' })} feeTarget={null} onClose={vi.fn()}
    onIssue={vi.fn()} onReceive={receive} onIssueFee={vi.fn()} />);
  expect(screen.getByText('송출·입고 차이 (추정, 손실 미확정)')).toBeTruthy();
  expect(screen.queryByText('로스 (수율손실)')).toBeNull();
  expect(receive).not.toHaveBeenCalled();
});
it('구형 벌크 미상은 0으로 닫거나 저장 총회수와 불일치를 단정하지 않는다', () => {
  view(po({ oemReceivedKg: 90, items: [{ itemId: 'product', name: '볶음참깨', quantity: 70, unit: '개' }] }));
  expect(screen.getByText('참깨 벌크 회수').parentElement?.textContent).toContain('자료 없음');
  expect(screen.getByText('산술 차이 · 손실 미확정').parentElement?.textContent).toContain('미확정');
  expect(screen.queryByText('저장된 회수 중량과 제품·벌크 단위 불일치')).toBeNull();
});
it('새 입고의 확인된 무벌크와 현재 품목 환산 차이를 안내한다', () => {
  view(po({ oemReceivedKg: 90, oemReceiptOperationId: 'receipt-po',
    items: [{ itemId: 'product', name: '볶음참깨', quantity: 70, unit: '개' }] }));
  expect(screen.getByText('참깨 벌크 회수').parentElement?.textContent).toContain('0 kg');
  expect(screen.getByText('제품 중량 (현재 품목 기준 환산)').parentElement?.textContent).toContain('70 kg');
  expect(screen.getByText('저장된 회수 중량과 제품·벌크 단위 불일치')).toBeTruthy();
});
it('다종 원료는 제품 중량을 귀속시키거나 확정 손실로 표시하지 않는다', () => {
  view(po({ oemReceivedKg: 90, oemReceiptOperationId: 'receipt-po',
    oemSent: [{ material: '참깨', kg: 80 }, { material: '들깨', kg: 20 }],
    items: [{ itemId: 'product', name: '볶음참깨', quantity: 90, unit: '개' }] }));
  expect(screen.getByText('산술 차이 · 손실 미확정').parentElement?.textContent).toContain('미확정');
  expect(screen.getByText('다중 원료 제품 귀속 불명')).toBeTruthy();
});
it('현재 품목 규격 환산은 저장된 총회수·가공비와 발행 입력을 바꾸지 않는다', async () => {
  const order = po({ oemReceivedKg: 90, oemFeePerKg: 1000, oemReceiptOperationId: 'receipt-po',
    items: [{ itemId: 'product', name: '볶음참깨', quantity: 70, unit: '개' }] });
  const issue = view(order, [{ ...item, spec: '2kg' }]);
  expect(screen.getByText('제품 중량 (현재 품목 기준 환산)').parentElement?.textContent).toContain('140 kg');
  expect(screen.getByText('총회수 중량 (저장값)').parentElement?.textContent).toContain('90 kg');
  expect(screen.getByText('90,000원')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '전표 발행' }));
  await act(async () => {});
  expect(issue).toHaveBeenCalledExactlyOnceWith({ po: order, unitPricePerKg: 1000, date: expect.any(String) });
});
it('타회사 품목으로 현재 제품 중량을 환산하지 않는다', () => {
  view(po({ oemReceivedKg: 90, oemReceiptOperationId: 'receipt-po',
    items: [{ itemId: 'product', name: '', quantity: 90, unit: '개' }] }), [{ ...item, companyId: 'punghoe' }]);
  expect(screen.getByText('제품 중량 (현재 품목 기준 환산)').parentElement?.textContent).toContain('자료 없음');
  expect(screen.getByText('제품 단위 환산 불명: product (product)')).toBeTruthy();
});

it('외주 발주가 현재 진행 중이면 이전 미완료 안내와 구분한다', async () => {
 sessionStorage.setItem('oem-issue-pending:taebaek',JSON.stringify({jobId:'pending',oemPartnerId:'fumi',partnerName:'푸미푸드',date:'2026-10-08',sent:[{material:'참깨',kg:100}]}));
 let finish!: () => void;
 const onIssue=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
 render(<OemManager companyId="taebaek" items={[]} partners={[]} rawStockKg={()=>100} issueDrafts={[]}
 issueOpen receiveTarget={null} feeTarget={null} onClose={vi.fn()} onIssue={onIssue} onReceive={vi.fn()} onIssueFee={vi.fn()} />);
 fireEvent.click(screen.getByRole('button',{name:'재개'}));
 expect(screen.getByText('외주 발주 처리 중입니다. 완료될 때까지 기다려 주세요.')).toBeInTheDocument();
 expect(screen.queryByText('완료되지 않은 외주 발주가 있습니다. 새로 발주하기 전에 기존 작업을 재개하세요.')).toBeNull();
 await act(async()=>{finish();});
 expect(sessionStorage.getItem('oem-issue-pending:taebaek')).toBeNull();
});
const savedEvidence={version:1 as const,ownerCompanyId:'taebaek',rawMaterials:[{rawItemId:'raw',kg:100,supplyAmount:100000}],packaging:{confirmed:true as const,supplyAmount:0},capturedAt:'2026-10-12T00:00:00Z'};
function savedBatch(){return po({oemCostEvidence:savedEvidence,oemBatchCost:{version:1,status:'pending-fee',evidenceSnapshot:savedEvidence,ownerCompanyId:'taebaek',sentKg:100,receivedKg:20,lossKg:80,rawSupplyAmount:100000,packagingSupplyAmount:0,rows:[{itemId:'product',kg:20}]},oemReceivedKg:20,oemReceiptOperationId:'receipt',items:[{itemId:'product',name:'입고 당시 제품',quantity:2,unit:'개'}]});}
it('현재 규격이 바뀌어도 조회는 저장 원입고 중량으로 표시한다',()=>{
 view(savedBatch(),[{...item,spec:'25kg'}]);expect(screen.getByText('제품 중량 (저장된 원입고 기준)').parentElement?.textContent).toContain('20 kg');expect(screen.queryByText('제품 중량 (현재 품목 기준 환산)')).toBeNull();expect(screen.queryByText('저장된 회수 중량과 제품·벌크 단위 불일치')).toBeNull();
});
it.each(['missing','foreign'])('저장 중량 %s 근거는 화면을 중단하거나 현재 규격으로 추정하지 않는다',kind=>{
 const batch=savedBatch();if(kind==='missing')batch.oemBatchCost=undefined;else batch.oemCostEvidence={...savedEvidence,ownerCompanyId:'punghoe'};
 view(batch,[{...item,spec:'25kg'}]);expect(screen.getByText('제품 중량 (입고 근거 미확인)').parentElement?.textContent).toContain('자료 없음');expect(screen.getByText('저장된 원입고 중량 근거 미확인')).toBeInTheDocument();expect(screen.getByText('산술 차이 · 손실 미확정').parentElement?.textContent).toContain('미확정');
});
function confirmedBatch(){
 const sent=[{rawItemId:'raw',material:'참깨',kg:100}];
 const preview=buildOemBatchCostPreview(savedEvidence,{companyId:'taebaek',sent},[{itemId:'product',kg:20}]);
 if(preview.status!=='pending-fee')throw new Error('invalid fixture');
 return po({oemSent:sent,oemCostEvidence:savedEvidence,oemBatchCost:finalizeOemBatchCost(preview,{statementId:'fee-po',feeSupplyAmount:2000}),linkedStatementId:'fee-po',oemReceivedKg:20,oemReceiptOperationId:'receipt',oemFeePerKg:100,items:[{itemId:'product',name:'제품',quantity:2,unit:'개'}]});
}
it('정상 확정 근거는 현재 규격과 독립적으로 기존 원가를 표시한다',()=>{
 const issue=view(confirmedBatch(),[{...item,spec:'25kg'}]);
 expect(screen.getByText('OEM 원가 확정')).toBeInTheDocument();
 expect(screen.getByText('확정 원가 5,100원/kg')).toBeInTheDocument();
 expect(issue).not.toHaveBeenCalled();
});
it.each(['company','owner','snapshot','status','received','link','fee','total','allocation','loss','nan','rows'])('실제 모달은 %s 불일치의 확정 숫자를 숨긴다',kind=>{
 const batch=confirmedBatch();const cost=batch.oemBatchCost as OemBatchCost;
 if(kind==='company')batch.companyId='punghoe';
 if(kind==='owner')cost.ownerCompanyId='punghoe';
 if(kind==='snapshot')cost.evidenceSnapshot={...cost.evidenceSnapshot,ownerCompanyId:'punghoe'};
 if(kind==='status')batch.status='invoiced';
 if(kind==='received')batch.oemReceivedKg=21;
 if(kind==='link')batch.linkedStatementId=undefined;
 if(kind==='fee')cost.feeStatementId='other';
 if(kind==='total')cost.totalSupplyAmount++;
 if(kind==='allocation')cost.allocations[0].supplyAmount++;
 if(kind==='loss')cost.lossKg++;
 if(kind==='nan')cost.costPerKg=NaN;
 if(kind==='rows')cost.rows[0].kg++;
 view(batch);
 expect(screen.queryByText('OEM 원가 확정')).toBeNull();
 expect(screen.queryByText(/^확정 원가 /)).toBeNull();
 expect(screen.getByText(/^OEM 원가 미확인/)).toBeInTheDocument();
});
it('blocked 이전 확정 객체는 숫자 표시로 되살리지 않는다',()=>{
 const batch=confirmedBatch();batch.oemBatchCost={version:1,status:'blocked',reason:'fee-deleted',previousConfirmed:batch.oemBatchCost as OemBatchCost};
 view(batch);expect(screen.getByText(/가공비 전표 삭제로 재확인이 필요/)).toBeInTheDocument();expect(screen.queryByText(/^확정 원가 /)).toBeNull();
});
it('객체 키 순서만 바뀐 저장 근거는 정상 확정 표시를 유지한다',()=>{
 const reverse=(v:any):any=>Array.isArray(v)?v.map(reverse):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).reverse().map(([k,x])=>[k,reverse(x)])):v;
 const batch=confirmedBatch();batch.oemBatchCost=reverse(batch.oemBatchCost);view(batch);expect(screen.getByText('OEM 원가 확정')).toBeInTheDocument();
});
it('조회 불일치는 새 발행 계산이나 사용자 콜백을 차단하지 않는다',async()=>{
 const batch=confirmedBatch();(batch.oemBatchCost as OemBatchCost).totalSupplyAmount++;
 const issue=view(batch);fireEvent.click(screen.getByRole('button',{name:'전표 발행'}));await act(async()=>{});
 expect(issue).toHaveBeenCalledExactlyOnceWith({po:batch,unitPricePerKg:100,date:expect.any(String)});
});
