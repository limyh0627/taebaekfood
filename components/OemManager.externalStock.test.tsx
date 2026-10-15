/** @vitest-environment jsdom */
import { render,screen,fireEvent,act } from '@testing-library/react';
import { beforeEach,expect,it,vi } from 'vitest';
import OemManager from './OemManager';
import ItemList from './ItemList';
import type { PurchaseOrder } from '../src/shared/types';
const api=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('../src/shared/services/oemExternalStockEvidence',()=>({readOemExternalStockEvidence:api.read}));
vi.mock('../src/shared/firebase',()=>({db:{},storage:{},functions:{},auth:{},authReady:Promise.resolve()}));
vi.mock('../src/shared/services/firebaseService',()=>({fetchCollection:vi.fn().mockResolvedValue([]),subscribeToCollection:vi.fn(()=>()=>{}),addItem:vi.fn()}));
beforeEach(()=>api.read.mockReset());
const po={id:'po',companyId:'taebaek',poType:'oem',partnerName:'외주',status:'pending',itemId:'',itemName:'',quantity:0,createdAt:'',oemSent:[{rawItemId:'raw',material:'참깨',kg:100}]} as PurchaseOrder;
function props(companyId:'taebaek'|'punghoe'='taebaek'){return {companyId,items:[],partners:[],rawStockKg:()=>100,issueDrafts:[],purchaseOrders:[po],issueOpen:true,receiveTarget:null,feeTarget:null,onClose:vi.fn(),onIssue:vi.fn(),onReceive:vi.fn(),onIssueFee:vi.fn()};}
it('실제 발주 모달에서 조회만 호출하고 장부송출·당시 재고반영·미확인을 구분한다',async()=>{
 api.read.mockResolvedValueOnce([{poId:'po',partnerName:'외주',state:'partial',rows:[{rawItemId:'raw',material:'참깨',requestedKg:100,reportedKg:100,appliedKg:0},{rawItemId:'b',material:'들깨',requestedKg:50,reason:'영수증 미확인'}]}]);const p=props();render(<OemManager {...p}/>);
 expect(api.read).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'송출 근거 조회'}));await act(async()=>{});
 expect(api.read).toHaveBeenCalledWith('taebaek',[po]);expect(screen.getByText(/장부 송출 100kg · 당시 재고 반영 0kg/)).toBeInTheDocument();expect(screen.getByText(/들깨.*송출 미확인/)).toBeInTheDocument();expect(screen.getByText(/물리 창고의 실측량이나 소유재고/)).toBeInTheDocument();expect(p.onIssue).not.toHaveBeenCalled();
});
it('이전 회사의 늦은 결과는 새 모달에 표시하거나 조회 busy를 풀지 않는다',async()=>{
 let finish!:(v:any)=>void;api.read.mockReturnValueOnce(new Promise(resolve=>finish=resolve));api.read.mockResolvedValueOnce([]);const p=props();const view=render(<OemManager {...p}/>);fireEvent.click(screen.getByRole('button',{name:'송출 근거 조회'}));
 view.rerender(<OemManager {...props('punghoe')}/>);await act(async()=>finish([{poId:'old',partnerName:'오래된회사',state:'confirmed',rows:[]}]));expect(screen.queryByText(/오래된회사/)).toBeNull();expect(screen.getByRole('button',{name:'송출 근거 조회'})).toBeEnabled();
});
it('조회 중 중복 클릭은 요청 하나이며 실패는 미확인으로 유지한다',async()=>{
 let fail!:(v:any)=>void;api.read.mockReturnValueOnce(new Promise((_,reject)=>fail=reject));render(<OemManager {...props()}/>);const button=screen.getByRole('button',{name:'송출 근거 조회'});fireEvent.click(button);fireEvent.click(button);expect(api.read).toHaveBeenCalledTimes(1);await act(async()=>fail(new Error('조회 실패')));expect(screen.getByRole('alert')).toHaveTextContent('근거 미확인');
});
it('같은 배치 원문이 갱신되면 늦은 이전 조회를 확정하지 않는다',async()=>{
 let finish!:(v:any)=>void;api.read.mockReturnValueOnce(new Promise(resolve=>finish=resolve));const p=props(),view=render(<OemManager {...p}/>);fireEvent.click(screen.getByRole('button',{name:'송출 근거 조회'}));
 view.rerender(<OemManager {...p} purchaseOrders={[{...po,oemSent:[{rawItemId:'raw',material:'참깨',kg:200}]}]}/>);await act(async()=>finish([{poId:'po',partnerName:'이전원문결과',state:'confirmed',rows:[]}]));expect(screen.queryByText(/이전원문결과/)).toBeNull();
});
it('재고 화면의 외주 발주 실제 진입은 기존 예정·완료 PO를 현재 회사만 전달한다',async()=>{
 api.read.mockResolvedValueOnce([]);
 const noop=vi.fn();const p:React.ComponentProps<typeof ItemList>={companyId:'taebaek',items:[],partners:[],orderRequests:[po],confirmedOrders:[],receivedOrders:[{...po,id:'received',status:'received'},{...po,id:'foreign',companyId:'punghoe'}],inboundPartners:[],rawMaterialLedger:[],onUpdateItem:noop,onAddItem:noop,onAddOrderRequest:noop,onRemoveOrderRequest:noop,onUpdateOrderRequestQty:noop,onToggleConfirmRequestQty:noop,onConfirmRequest:noop,onConfirmRequests:noop,onBulkAddConfirmedOrders:noop,onConfirmAllRequests:noop,onFinishConfirmedOrder:noop,onUpdateConfirmedQty:noop,onRemoveConfirmedOrder:noop,onEditProduct:noop,onDeleteItem:noop,onAddAdjustmentRequest:noop,onAddRawMaterialEntry:noop,onDeleteRawMaterialEntry:noop,oemEnabled:true,rawStockKg:()=>0,onOemIssue:noop,onOemReceive:noop,onOemIssueFee:noop,isAdmin:true};
 render(<ItemList {...p} mode="lots"/>);fireEvent.click(screen.getByRole('button',{name:'외주 발주'}));fireEvent.click(screen.getByRole('button',{name:'송출 근거 조회'}));await act(async()=>{});
 expect(api.read).toHaveBeenCalledWith('taebaek',[po,expect.objectContaining({id:'received'})]);expect(noop).not.toHaveBeenCalled();
});

it.each([
 ['candidate','issue-raw-cost-candidate',125000,'송출 당시 확인 원물 금액: 125,000원'],
 ['unconfirmed','receipt-cost-only',undefined,'입고 때 확인 원가'],
 ['unconfirmed','cost-evidence-missing',undefined,'원가 근거 미확인'],
 ['excluded','received-po-out-of-open-scope',undefined,'현재 미입고 대상 밖'],
] as const)('원가 진단 %s/%s는 금액 근거의 의미를 구분한다',async(classification,reason,amount,label)=>{
 api.read.mockResolvedValueOnce([{poId:'po',partnerName:'외주',state:'confirmed',rows:[],costDiagnostic:{poId:'po',classification,reason,sourceState:'confirmed',currentOnly:true,assetValuationConfirmed:false,...(amount===undefined?{}:{rawSupplyAmountCandidate:amount})}}]);render(<OemManager {...props()}/>);fireEvent.click(screen.getByRole('button',{name:'송출 근거 조회'}));await act(async()=>{});expect(screen.getByText(new RegExp(label))).toBeInTheDocument();expect(screen.queryByText(/undefined원|NaN원/)).toBeNull();expect(screen.getByText(/확정 재고자산·합계·월말 평가가 아닙니다/)).toBeInTheDocument();
});
it('비용 필드만 바뀐 전체 발주 원문도 늦은 후보 금액을 표시하지 않는다',async()=>{let finish!:(v:any)=>void;api.read.mockReturnValueOnce(new Promise(resolve=>finish=resolve));const p=props(),view=render(<OemManager {...p}/>);fireEvent.click(screen.getByRole('button',{name:'송출 근거 조회'}));view.rerender(<OemManager {...p} purchaseOrders={[{...po,oemCostEvidenceSource:'receipt'}]}/>);await act(async()=>finish([{poId:'po',partnerName:'외주',state:'confirmed',rows:[],costDiagnostic:{classification:'candidate',rawSupplyAmountCandidate:1234567}}]));expect(screen.queryByText(/1,234,567원/)).toBeNull();});
