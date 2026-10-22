/** @vitest-environment jsdom */
import React from 'react';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import OemManager from './OemManager';
import type {Item,Partner,PurchaseOrder} from '../src/shared/types';
import {beginOemIssueAttempt,listOemIssueAttempts} from '../src/shared/oemIssuePending';
import {readOemReceiptEntry,pinOemReceiptPacket,acknowledgeOemReceiptPacket,listOemReceiptEntries} from '../src/shared/oemReceiptPending';
beforeEach(()=>{localStorage.clear();sessionStorage.clear();vi.spyOn(window,'alert').mockImplementation(()=>{});Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_key:string,_opts:unknown,fn:()=>unknown)=>fn()}});});afterEach(()=>{cleanup();vi.restoreAllMocks();sessionStorage.clear();localStorage.clear();});
const storageFor=(key:string)=>key.startsWith('oem-receipt-draft-v1:')?localStorage:sessionStorage;
const storageGet=(key:string)=>storageFor(key).getItem(key);
const storageSet=(key:string,value:string)=>storageFor(key).setItem(key,value);
async function recoveryAction(name:string){if(!screen.queryByRole('dialog',{name:'OEM 실패 작업 상세'})){if(!screen.queryByRole('dialog',{name:'OEM 실패 작업 목록'}))fireEvent.click(screen.getByRole('button',{name:/^OEM 실패 작업/}));const row=screen.getAllByRole('button').find(button=>button.textContent?.includes('·')&&button.textContent?.includes('미확인'));fireEvent.click(row!);}return screen.findByRole('button',{name});}
function closeRecovery(){const detail=screen.queryByRole('button',{name:'OEM 실패 작업 상세 닫기'});if(detail)fireEvent.click(detail);const list=screen.queryByRole('button',{name:'OEM 실패 작업 목록 닫기'});if(list)fireEvent.click(list);}
const raw={id:'raw',name:'들깨',companyId:'taebaek',type:'raw',subtype:'벌크',unit:'kg',stock:1000,minStock:0,image:'',cost:99999999} as Item;
const partner={id:'oem',name:'외주공장',companyId:'taebaek',isOemFactory:true} as Partner;
const props=()=>({actorUid:'actor',companyId:'taebaek' as const,items:[raw],partners:[partner],rawStockKg:()=>1000,issueDrafts:[],issueOpen:true,receiveTarget:null,feeTarget:null,onClose:vi.fn(),onIssue:vi.fn(async(_input:any)=>{}),onReceive:vi.fn(),onIssueFee:vi.fn()});
function fill(){const selections=screen.getAllByRole('combobox');fireEvent.change(selections[0],{target:{value:'oem'}});fireEvent.change(selections[1],{target:{value:'들깨'}});fireEvent.change(screen.getByPlaceholderText('kg'),{target:{value:'100'}});}
it('일부 원가 입력을 해도 실제 발주 콜백은 근거 없이 진행한다',async()=>{const p=props();render(<OemManager {...p}/>);fill();expect(screen.getByLabelText('1행 원료 공급가액')).toHaveValue('');fireEvent.change(screen.getByLabelText('1행 원료 공급가액'),{target:{value:'220000'}});expect(screen.getByText(/이번 원가 근거는 저장하지 않습니다/)).toBeInTheDocument();fireEvent.click(screen.getByText('발주 (원료 내보내기)'));await waitFor(()=>expect(p.onIssue).toHaveBeenCalledOnce());expect(p.onIssue.mock.calls[0][0].oemCostEvidence).toBeUndefined();});
it('확인한0부자재까지 완성하면 콜백과 재개 원문에 같은 근거가 남는다',async()=>{
 const p=props();let finish!:(v:import('../src/features/admin/oemIssueJob').OemIssueInspection)=>void;
 const inspect=vi.fn<NonNullable<import('../src/features/oem/domain/oemManager').Props['onInspectIssue']>>(()=>new Promise<import('../src/features/admin/oemIssueJob').OemIssueInspection>(resolve=>{finish=resolve;}));
 p.onIssue.mockImplementation(async(input:any)=>{await beginOemIssueAttempt({jobId:input.jobId,companyId:'taebaek',partnerId:input.oemPartnerId,partnerName:input.partnerName,sent:input.sent.map((row:any)=>({...row,rawItemId:'raw'})),date:input.date,...(input.note?{note:input.note}:{}),oemCostEvidence:input.oemCostEvidence},'actor',()=>true);throw Error('응답 없음');});
 const view=render(<OemManager {...p} onInspectIssue={inspect}/>);fill();fireEvent.change(screen.getByLabelText('1행 원료 공급가액'),{target:{value:'220000'}});fireEvent.change(screen.getByLabelText('부자재 공급가액'),{target:{value:'0'}});fireEvent.click(screen.getByLabelText('부자재 공급가액 확인'));fireEvent.click(screen.getByText('발주 (원료 내보내기)'));await waitFor(()=>expect(p.onIssue).toHaveBeenCalledOnce());const original=p.onIssue.mock.calls[0][0];expect(original.oemCostEvidence).toMatchObject({ownerCompanyId:'taebaek',rawMaterials:[{rawItemId:'raw',kg:100,supplyAmount:220000}],packaging:{confirmed:true,supplyAmount:0}});
 view.unmount();render(<OemManager {...p} onInspectIssue={inspect}/>);const resume=await recoveryAction('남은 처리 재개');expect(resume).toBeDisabled();fireEvent.click(resume);expect(p.onIssue).toHaveBeenCalledOnce();
 fireEvent.click(screen.getByRole('button',{name:'실제 처리 결과 확인'}));await waitFor(()=>expect(inspect).toHaveBeenCalledOnce());expect(p.onIssue).toHaveBeenCalledOnce();expect(resume).toBeDisabled();
 const retained=inspect.mock.calls[0][0];expect(inspect.mock.calls[0]).toEqual([retained,'actor']);expect(retained.request.input).toMatchObject({jobId:original.jobId,date:original.date,sent:[{material:'들깨',rawItemId:'raw',kg:100}],oemCostEvidence:original.oemCostEvidence});
 await act(async()=>finish({status:'partial',poId:original.jobId,cardStatus:'pending',verifiedOperationIds:[],missingOperationIds:['remaining'],unknownOperationIds:[],conflictingOperationIds:[],message:'남은 출고 처리 확인',nextAction:'같은 원문으로 남은 처리 재개',canResume:true}));expect(screen.getByRole('button',{name:'남은 처리 재개'})).toBeEnabled();fireEvent.click(screen.getByRole('button',{name:'남은 처리 재개'}));await waitFor(()=>expect(p.onIssue).toHaveBeenCalledTimes(2));
 expect(p.onIssue.mock.calls[1]).toEqual([original,'resume','actor',retained]);expect(retained.key).toBeTruthy();expect(JSON.parse(retained.encoded)).toEqual(retained.request);
});
it('과거 근거 없는 배치는0원가로 확정 표시하지 않는다',()=>{const p=props();render(<OemManager {...p} issueOpen={false} feeTarget={{id:'po',companyId:'taebaek',poType:'oem',status:'received',partnerName:'외주',createdAt:'',itemId:'',itemName:'',quantity:0,oemSent:[{material:'들깨',kg:100}],oemReceivedKg:90} as PurchaseOrder}/>);expect(screen.getByText(/OEM 원가 미확인/)).toBeInTheDocument();expect(screen.queryByText(/확정 원가/)).toBeNull();});


const receivedProduct={id:'product',name:'볶음들깨',companyId:'taebaek',type:'product',procureType:'임가공',spec:'1kg',unit:'개',stock:0,minStock:0,image:''} as Item;
const receivePo=()=>({id:'po',companyId:'taebaek',poType:'oem',status:'invoiced',partnerId:'oem',partnerName:'외주',createdAt:'',itemId:'',itemName:'',quantity:0,oemSent:[{rawItemId:'raw',material:'들깨',kg:100}]} as PurchaseOrder);
function receiveView(po=receivePo()){const p=props();const onReceive=vi.fn(async(_input:any)=>{});render(<OemManager {...p} items={[raw,receivedProduct]} issueOpen={false} receiveTarget={po} onReceive={onReceive}/>);fireEvent.change(screen.getByPlaceholderText('수량'),{target:{value:'90'}});return onReceive;}
it('발주 때 몰랐던 근거는 입고 실제 콜백 최상위에 전달한다',async()=>{const receive=receiveView();fireEvent.change(screen.getByLabelText('입고 1행 원료 공급가액'),{target:{value:'220000'}});fireEvent.change(screen.getByLabelText('입고 부자재 공급가액'),{target:{value:'0'}});fireEvent.click(screen.getByLabelText('입고 부자재 공급가액 확인'));fireEvent.click(screen.getByRole('button',{name:'가공입고'}));await waitFor(()=>expect(receive).toHaveBeenCalledOnce());expect(receive.mock.calls[0][0].oemCostEvidence).toMatchObject({ownerCompanyId:'taebaek',rawMaterials:[{rawItemId:'raw',kg:100,supplyAmount:220000}],packaging:{confirmed:true,supplyAmount:0}});});
it('입고 근거 일부 입력은 안내하고 입고를 막지 않는다',async()=>{const receive=receiveView();fireEvent.change(screen.getByLabelText('입고 1행 원료 공급가액'),{target:{value:'220000'}});expect(screen.getByText(/입고는 진행되지만/)).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'가공입고'}));await waitFor(()=>expect(receive).toHaveBeenCalledOnce());expect(receive.mock.calls[0][0].oemCostEvidence).toBeUndefined();});
it('raw ID가 없는 과거 입고는 품목명 추정 없이 근거 없는 입고를 허용한다',async()=>{const po=receivePo();delete po.oemSent![0].rawItemId;const receive=receiveView(po);expect(screen.queryByLabelText('입고 1행 원료 공급가액')).toBeNull();expect(screen.getByText(/품목명으로 원료를 추정하지 않습니다/)).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'가공입고'}));await waitFor(()=>expect(receive).toHaveBeenCalledOnce());expect(receive.mock.calls[0][0].oemCostEvidence).toBeUndefined();});
it('발주 근거가 있으면 입고 입력으로 덮어쓰지 않는다',async()=>{const po=receivePo();po.oemCostEvidence={version:1,ownerCompanyId:'taebaek',rawMaterials:[{rawItemId:'raw',kg:100,supplyAmount:220000}],packaging:{confirmed:true,supplyAmount:0},capturedAt:'2026-10-11T00:00:00Z'};const receive=receiveView(po);expect(screen.queryByLabelText('입고 1행 원료 공급가액')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'가공입고'}));await waitFor(()=>expect(receive).toHaveBeenCalledOnce());expect(receive.mock.calls[0][0].oemCostEvidence).toBeUndefined();expect(receive.mock.calls[0][0].po.oemCostEvidence).toEqual(po.oemCostEvidence);});
it('응답 미확정 입고는 다시 열어도 최초 수량과 근거 원문으로 재개한다',async()=>{const p=props();const onReceive=vi.fn(async(_input:any)=>{throw Error('응답 없음')});const po=receivePo();const view=render(<OemManager {...p} items={[raw,receivedProduct]} issueOpen={false} receiveTarget={po} onReceive={onReceive}/>);fireEvent.change(screen.getByPlaceholderText('수량'),{target:{value:'90'}});fireEvent.change(screen.getByLabelText('입고 1행 원료 공급가액'),{target:{value:'220000'}});fireEvent.change(screen.getByLabelText('입고 부자재 공급가액'),{target:{value:'0'}});fireEvent.click(screen.getByLabelText('입고 부자재 공급가액 확인'));fireEvent.click(screen.getByRole('button',{name:'가공입고'}));await waitFor(()=>expect(onReceive).toHaveBeenCalledOnce());const original=onReceive.mock.calls[0][0];await recoveryAction('같은 내용 다시 시도');view.unmount();render(<OemManager {...p} items={[raw,receivedProduct]} issueOpen={false} receiveTarget={po} onReceive={onReceive}/>);fireEvent.change(screen.getByPlaceholderText('수량'),{target:{value:'1'}});fireEvent.change(screen.getByLabelText('입고 1행 원료 공급가액'),{target:{value:'1'}});fireEvent.click(await recoveryAction('같은 내용 다시 시도'));await waitFor(()=>expect(onReceive).toHaveBeenCalledTimes(2));expect(onReceive.mock.calls[1][0]).toEqual(original);});

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const receiptStorageKey = (company: string, id = 'po') => 'oem-receipt-draft-v1:'+company+':actor:'+encodeURIComponent(id);
async function startReceipt(quantity = '90') {
  fireEvent.change(screen.getByPlaceholderText('수량'), { target: { value: quantity } });
  fireEvent.click(screen.getByRole('button', { name: '가공입고' }));
  await act(async()=>{for(let i=0;i<6;i++)await Promise.resolve();});
}
async function settle(request: ReturnType<typeof deferred>, failure?: string) {
  await act(async () => {
    if (failure) request.reject(new Error(failure)); else request.resolve();
    await request.promise.catch(() => {});
  });
}

it.each(['receive', 'fee'] as const)('%s 처리 중 취소·머리 닫기·배경 클릭으로 모달을 닫지 않는다', async mode => {
  const p = props(), request = deferred();
  const po = { ...receivePo(), status: mode === 'fee' ? 'received' as const : 'invoiced' as const, oemReceivedKg: 90 };
  const call = vi.fn(() => request.promise);
  render(<OemManager {...p} items={[raw, receivedProduct]} issueOpen={false}
    receiveTarget={mode === 'receive' ? po : null} feeTarget={mode === 'fee' ? po : null}
    onReceive={call} onIssueFee={call} />);
  if (mode === 'receive') await startReceipt();
  else fireEvent.click(screen.getByRole('button', { name: '전표 발행' }));
  await waitFor(()=>expect(call).toHaveBeenCalledOnce());
  expect(screen.getByRole('button', { name: '취소' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '취소' }));
  fireEvent.click(screen.getByRole('button', { name: /닫기$/ }));
  fireEvent.click(screen.getByRole('dialog').parentElement!);
  expect(p.onClose).not.toHaveBeenCalled();
  await settle(request);
  expect(p.onClose).toHaveBeenCalledOnce();
});

it.each(['success', 'error'] as const)('다른 배치로 전환한 뒤 A의 늦은 %s는 B의 입력·처리 잠금·원문을 바꾸지 않는다', async outcome => {
  const p = props(), first = deferred(), second = deferred();
  const onReceive = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const a = receivePo(), b = { ...receivePo(), id: 'po-b', partnerName: '새 배치' };
  const view = render(<OemManager {...p} items={[raw, receivedProduct]} issueOpen={false} receiveTarget={a} onReceive={onReceive} />);
  await startReceipt();
  const aOriginal = storageGet(receiptStorageKey('taebaek'));
  view.rerender(<OemManager {...p} items={[raw, receivedProduct]} issueOpen={false} receiveTarget={b} onReceive={onReceive} />);
  expect(screen.getByPlaceholderText('수량')).toHaveValue('');
  await startReceipt('75');
  await waitFor(()=>expect(onReceive).toHaveBeenCalledTimes(2));
  const bOriginal = storageGet(receiptStorageKey('taebaek', 'po-b'));
  await settle(first, outcome === 'error' ? 'A 응답 유실' : undefined);
  expect(p.onClose).not.toHaveBeenCalled();
  expect(screen.getByText('새 배치')).toBeInTheDocument();
  expect(screen.getByPlaceholderText('수량')).toHaveValue('75');
  expect(screen.getByRole('button', { name: '처리 중…' })).toBeDisabled();
  expect(storageGet(receiptStorageKey('taebaek'))).toBe(aOriginal);
  expect(storageGet(receiptStorageKey('taebaek', 'po-b'))).toBe(bOriginal);
  fireEvent.click(screen.getByRole('button', { name: '처리 중…' }));
  await waitFor(()=>expect(onReceive).toHaveBeenCalledTimes(2));
  await settle(second);
  expect(p.onClose).toHaveBeenCalledOnce();
  expect(storageGet(receiptStorageKey('taebaek', 'po-b'))).toBeNull();
  expect(storageGet(receiptStorageKey('taebaek'))).toBe(aOriginal);
});

it('회사 전환 뒤 같은 PO번호의 새 요청을 이전 회사 응답이 정리하거나 닫지 않는다', async () => {
  const p = props(), first = deferred(), second = deferred();
  const onReceive = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const view = render(<OemManager {...p} items={[raw, receivedProduct]} issueOpen={false} receiveTarget={receivePo()} onReceive={onReceive} />);
  await startReceipt();
  const old = storageGet(receiptStorageKey('taebaek'));
  view.rerender(<OemManager {...p} companyId="punghoe" items={[{ ...raw, companyId: 'punghoe' }, { ...receivedProduct, companyId: 'punghoe' }]}
    issueOpen={false} receiveTarget={{ ...receivePo(), companyId: 'punghoe' }} onReceive={onReceive} />);
  await startReceipt('60');
  const fresh = storageGet(receiptStorageKey('punghoe'));
  await settle(first);
  expect(p.onClose).not.toHaveBeenCalled();
  expect(screen.getByPlaceholderText('수량')).toHaveValue('60');
  expect(screen.getByRole('button', { name: '처리 중…' })).toBeDisabled();
  expect(storageGet(receiptStorageKey('taebaek'))).toBe(old);
  expect(storageGet(receiptStorageKey('punghoe'))).toBe(fresh);
  await settle(second);
  expect(p.onClose).toHaveBeenCalledOnce();
  expect(storageGet(receiptStorageKey('punghoe'))).toBeNull();
});

it('같은 PO를 다시 열어 최초 요청을 재개한 뒤에도 이전 세대의 응답은 정리하지 않는다', async () => {
  const p = props(), first = deferred(), retry = deferred();
  const onReceive = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
  const po = receivePo();
  const view = render(<OemManager {...p} items={[raw, receivedProduct]} issueOpen={false} receiveTarget={po} onReceive={onReceive} />);
  await startReceipt();
  const original = storageGet(receiptStorageKey('taebaek'));
  view.rerender(<OemManager {...p} items={[raw, receivedProduct]} issueOpen={false} receiveTarget={null} onReceive={onReceive} />);
  view.rerender(<OemManager {...p} items={[raw, receivedProduct]} issueOpen={false} receiveTarget={po} onReceive={onReceive} />);
  fireEvent.change(screen.getByPlaceholderText('수량'), { target: { value: '1' } });
  fireEvent.click(await recoveryAction('같은 내용 다시 시도'));
  await waitFor(()=>expect(onReceive).toHaveBeenCalledTimes(2));
  expect(onReceive.mock.calls[1][0]).toEqual(onReceive.mock.calls[0][0]);
  await settle(first);
  expect(p.onClose).not.toHaveBeenCalled();
  expect(screen.getByPlaceholderText('수량')).toHaveValue('1');
  expect(screen.getByRole('button', { name: '같은 내용 다시 시도' })).toBeDisabled();
  expect(storageGet(receiptStorageKey('taebaek'))).toBe(original);
  await settle(retry);
  expect(p.onClose).not.toHaveBeenCalled();
  expect(storageGet(receiptStorageKey('taebaek'))).toBeNull();
});

it('이미 바뀐 입고 보존 원문은 현재 요청의 성공 뒤에도 지우지 않는다', async () => {
  const p = props(), request = deferred();
  render(<OemManager {...p} items={[raw, receivedProduct]} issueOpen={false} receiveTarget={receivePo()} onReceive={() => request.promise} />);
  await startReceipt();
  const key = receiptStorageKey('taebaek');
  const changed = JSON.parse(storageGet(key)!);
  changed.input.returns[0].qty = 77;
  const encoded = JSON.stringify(changed);
  storageSet(key, encoded);
  await settle(request);
  expect(storageGet(key)).toBe(encoded);
  expect(p.onClose).not.toHaveBeenCalled();
  expect(await recoveryAction('같은 내용 다시 시도')).toBeEnabled();
  expect(screen.getByText(/보존된 입고 원문이 변경/)).toBeInTheDocument();
});

it('새 회사 발주를 재개 중인 때 이전 회사의 입력 오류는 어느 보존 원문도 지우지 않는다', async () => {
  const p = props(), first = deferred(), second = deferred();
  const onIssue = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const view = render(<OemManager {...p} onIssue={onIssue} />);
  fill();
  fireEvent.click(screen.getByText('발주 (원료 내보내기)'));
  const taebaek = storageGet('oem-issue-pending:taebaek');
  view.rerender(<OemManager {...p} companyId="punghoe" items={[{ ...raw, companyId: 'punghoe' }]}
    partners={[{ ...partner, companyId: 'punghoe' }]} onIssue={onIssue} />);
  fill();
  fireEvent.click(screen.getByText('발주 (원료 내보내기)'));
  const punghoe = storageGet('oem-issue-pending:punghoe');
  await settle(first, '현재 회사의 원료 홀더를 찾을 수 없습니다');
  expect(p.onClose).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '처리 중…' })).toBeDisabled();
  expect(storageGet('oem-issue-pending:taebaek')).toBe(taebaek);
  expect(storageGet('oem-issue-pending:punghoe')).toBe(punghoe);
  await settle(second);
  expect(p.onClose).toHaveBeenCalledOnce();
  expect(storageGet('oem-issue-pending:punghoe')).toBeNull();
});

it('가공비 배치 전환 뒤 이전 발행 완료는 새 단가·처리 상태를 닫거나 풀지 않는다', async () => {
  const p = props(), first = deferred(), second = deferred();
  const onIssueFee = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const a = { ...receivePo(), status: 'received' as const, oemReceivedKg: 90 };
  const b = { ...a, id: 'fee-b', partnerName: '새 가공비 배치' };
  const view = render(<OemManager {...p} items={[raw, receivedProduct]} issueOpen={false} feeTarget={a} onIssueFee={onIssueFee} />);
  fireEvent.click(screen.getByRole('button', { name: '전표 발행' }));
  view.rerender(<OemManager {...p} items={[raw, receivedProduct]} issueOpen={false} feeTarget={b} onIssueFee={onIssueFee} />);
  const price = screen.getByRole('textbox');
  fireEvent.change(price, { target: { value: '700' } });
  fireEvent.click(screen.getByRole('button', { name: '전표 발행' }));
  expect(onIssueFee).toHaveBeenCalledTimes(2);
  await settle(first);
  expect(p.onClose).not.toHaveBeenCalled();
  expect(price).toHaveValue('700');
  expect(screen.getByRole('button', { name: '발행 중…' })).toBeDisabled();
  await settle(second);
  expect(p.onClose).toHaveBeenCalledOnce();
});

it('화면 종료 뒤 입고 완료가 도착해도 최초 원문을 남겨 다음 진입에서 결과를 확인한다', async () => {
  const p = props(), request = deferred();
  const view = render(<OemManager {...p} items={[raw, receivedProduct]} issueOpen={false} receiveTarget={receivePo()} onReceive={() => request.promise} />);
  await startReceipt();
  const original = storageGet(receiptStorageKey('taebaek'));
  view.unmount();
  await settle(request);
  expect(p.onClose).not.toHaveBeenCalled();
  expect(storageGet(receiptStorageKey('taebaek'))).toBe(original);
});

it.each(['', '{', 'null', '[]', '{}'])('손상 입고 원문 %j는 새 요청으로 바꾸지 않고 그대로 보존한다', async encoded => {
 const p=props();storageSet(receiptStorageKey('taebaek'),encoded);render(<OemManager {...p} items={[raw,receivedProduct]} issueOpen={false} receiveTarget={receivePo()}/>);await startReceipt();await screen.findByRole('dialog',{name:'OEM 실패 작업 목록'});expect(p.onReceive).not.toHaveBeenCalled();expect(storageGet(receiptStorageKey('taebaek'))).toBe(encoded);expect(screen.getByText(/보존된 입고 원문이 변경/)).toBeInTheDocument();
});
it.each(['', '{', 'null', '[]', '{}'])('손상 발주 원문 %j는 새 발주로 덮지 않는다', async encoded => {
  const p = props();
  storageSet('oem-issue-pending:taebaek', encoded);
  render(<OemManager {...p} />);
  fill();
  fireEvent.click(screen.getByRole('button', { name: '발주 (원료 내보내기)' }));
  expect(p.onIssue).not.toHaveBeenCalled();
  await screen.findByRole('dialog',{name:'OEM 실패 작업 상세'});expect(screen.getByText(/최초 계정과 정규화 원문/)).toBeInTheDocument();
  expect(storageGet('oem-issue-pending:taebaek')).toBe(encoded);
});

it.each(['company', 'po'] as const)('보존 입고의 %s가 진입 범위와 다르면 원문을 유지한다', async mismatch => {
  const p = props();
  const payload = { po: { ...receivePo(), ...(mismatch === 'company' ? { companyId: 'punghoe' } : { id: 'other-po' }) },
    returns: [{ itemId: 'product', qty: 90 }], bulk: [], unitPricePerKg: 500, date: '2026-10-12' };
  const encoded = JSON.stringify(payload);
  storageSet(receiptStorageKey('taebaek'), encoded);
  render(<OemManager {...p} items={[raw, receivedProduct]} issueOpen={false} receiveTarget={receivePo()} />);
  fireEvent.change(screen.getByPlaceholderText('수량'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button',{name:'가공입고'}));await screen.findByRole('dialog',{name:'OEM 실패 작업 목록'});
  expect(p.onReceive).not.toHaveBeenCalled();
  expect(storageGet(receiptStorageKey('taebaek'))).toBe(encoded);
});

it.each(['receipt'] as Array<'issue'|'receipt'>)('최초 %s 원문 보존이 실패하면 업무 호출 없이 입력을 남겨 재시도한다', async mode => {
  const p = props();
  // 실제 Storage 경계에서 한 번만 실패시킨다. 후속 같은 화면 재시도는 정상 저장한다.
  vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('저장 공간 부족'); });
  render(<OemManager {...p} items={[raw, receivedProduct]} issueOpen={mode === 'issue'} receiveTarget={mode === 'receipt' ? receivePo() : null} />);
  if (mode === 'issue') { fill(); fireEvent.click(screen.getByRole('button', { name: '발주 (원료 내보내기)' })); }
  else await startReceipt();
  const call = mode === 'issue' ? p.onIssue : p.onReceive;
  expect(call).not.toHaveBeenCalled();
  if(mode==='issue')expect(screen.getByRole('alert')).toHaveTextContent('전송하지 않았습니다');else expect(window.alert).toHaveBeenCalled();
  expect(screen.getByPlaceholderText(mode === 'issue' ? 'kg' : '수량')).toHaveValue(mode === 'issue' ? '100' : '90');
  const submit = screen.getByRole('button', { name: mode === 'issue' ? '발주 (원료 내보내기)' : '가공입고' });
  fireEvent.click(submit);
  await waitFor(() => expect(call).toHaveBeenCalledOnce());
  await waitFor(() => expect(p.onClose).toHaveBeenCalledOnce());
});

it.each(['receipt'] as Array<'issue'|'receipt'>)('%s 성공 뒤 정리 실패는 최초 원문 재개로만 확인하고 정리한다', async mode => {
  const p = props(), call = vi.fn().mockResolvedValue(undefined);
  render(<OemManager {...p} items={[raw, receivedProduct]} issueOpen={mode === 'issue'} receiveTarget={mode === 'receipt' ? receivePo() : null}
    onIssue={call} onReceive={call} />);
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementationOnce(() => { throw new Error('정리 실패'); });
  if (mode === 'issue') { fill(); fireEvent.click(screen.getByRole('button', { name: '발주 (원료 내보내기)' })); }
  else await startReceipt();
  if(mode==='issue')await screen.findByRole('alert');else await screen.findByRole('dialog',{name:'OEM 실패 작업 상세'});
  const key = mode === 'issue' ? 'oem-issue-pending:taebaek' : receiptStorageKey('taebaek');
  const original = storageGet(key);
  expect(original).not.toBeNull();
  expect(p.onClose).not.toHaveBeenCalled();
  if(mode==='issue')expect(screen.getByRole('alert')).toHaveTextContent('같은 요청을 재개');else closeRecovery();
  fireEvent.change(screen.getByPlaceholderText(mode === 'issue' ? 'kg' : '수량'), { target: { value: '1' } });
  fireEvent.click(mode==='issue'?screen.getByRole('button',{name:'재개'}):await recoveryAction('같은 내용 다시 시도'));
  await waitFor(() => expect(call).toHaveBeenCalledTimes(2));
  expect(call.mock.calls[1][0]).toEqual(call.mock.calls[0][0]);
  if(mode==='issue')await waitFor(()=>expect(p.onClose).toHaveBeenCalledOnce());else expect(p.onClose).not.toHaveBeenCalled();
  expect(storageGet(key)).toBeNull();
});

it.each(['issue', 'receipt'] as const)('%s 입력 중 다른 원문이 저장되면 전송·덮기를 하지 않는다', async mode => {
  const p = props();
  render(<OemManager {...p} items={[raw, receivedProduct]} issueOpen={mode === 'issue'} receiveTarget={mode === 'receipt' ? receivePo() : null} />);
  if (mode === 'issue') fill();
  else fireEvent.change(screen.getByPlaceholderText('수량'), { target: { value: '90' } });
  const key = mode === 'issue' ? 'oem-issue-pending:taebaek' : receiptStorageKey('taebaek');
  const changed = '{"다른 원문":"자동 변경하지 않음"}';
  storageSet(key, changed);
  fireEvent.click(screen.getByRole('button', { name: mode === 'issue' ? '발주 (원료 내보내기)' : '가공입고' }));
  expect(p.onIssue).not.toHaveBeenCalled();
  expect(p.onReceive).not.toHaveBeenCalled();
  expect(storageGet(key)).toBe(changed);
  if(mode==='issue')await screen.findByRole('dialog',{name:'OEM 실패 작업 상세'});else await screen.findByRole('dialog',{name:'OEM 실패 작업 목록'});
});

it('응답 유실 packet 재개는 품목 조회가 없어도 최초 입력·계정으로 확인하고 정확 ACK 후 정리한다',async()=>{
 const p=props(),scope={companyId:'taebaek' as const,actorUid:'actor',poId:'po'};
 const onReceive=vi.fn(async(input:any,intent?:string,uid?:string)=>{expect(uid).toBe('actor');if(intent==='new'){await pinOemReceiptPacket(scope,{poId:'po',operationId:'oem-receive:po',date:input.date,returns:input.returns,bulk:[],unitPricePerKg:input.unitPricePerKg,releaseId:'original-release'},()=>true);throw Error('응답 유실');}acknowledgeOemReceiptPacket(readOemReceiptEntry(scope));});
 const view=render(<OemManager {...p} items={[raw,receivedProduct]} issueOpen={false} receiveTarget={receivePo()} onReceive={onReceive}/>);await startReceipt();await recoveryAction('같은 내용 다시 시도');const original=onReceive.mock.calls[0][0];view.unmount();render(<OemManager {...p} items={[]} issueOpen={false} receiveTarget={null} onReceive={onReceive}/>);fireEvent.click(await recoveryAction('같은 내용 다시 시도'));await waitFor(()=>expect(onReceive).toHaveBeenCalledTimes(2));expect(onReceive.mock.calls[1]).toEqual([original,'resume','actor']);await waitFor(()=>expect(listOemReceiptEntries('taebaek','actor')).toHaveLength(0));expect(p.onClose).not.toHaveBeenCalled();
});

it('UID 없는 과거 요청은 그대로 보존하고 자동 재입고하지 않으며 삭제 후 목록에서만 제외한다',async()=>{
 const p=props(),key='oem-receipt-pending:taebaek:po',text=JSON.stringify({po:receivePo(),returns:[{itemId:'product',qty:90}],bulk:[],date:'2026-10-14',unitPricePerKg:500});sessionStorage.setItem(key,text);render(<OemManager {...p} issueOpen={false} receiveTarget={receivePo()} items={[raw,receivedProduct]}/>);fireEvent.click(screen.getByRole('button',{name:'OEM 실패 작업 1'}));fireEvent.click(screen.getByRole('button',{name:/과거 요청 확인 필요/}));expect(screen.getByRole('button',{name:'같은 내용 다시 시도'})).toBeDisabled();expect(p.onReceive).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'실패 요청 삭제'}));await screen.findByText('확인할 실패 작업이 없습니다.');expect(sessionStorage.getItem(key)).toBe(text);expect(screen.getByRole('button',{name:'OEM 실패 작업 0'})).toBeInTheDocument();
});

it('삭제된 A는 같은 PO 새 입고를 막고 무관한 B 입력과 발송을 유지한다',async()=>{
 const p=props(),onReceive=vi.fn().mockRejectedValueOnce(Error('응답 유실')).mockResolvedValue(undefined),a=receivePo(),b={...a,id:'po-b',partnerName:'새 배치'};const view=render(<OemManager {...p} issueOpen={false} receiveTarget={a} items={[raw,receivedProduct]} onReceive={onReceive}/>);await startReceipt();await recoveryAction('같은 내용 다시 시도');const text=storageGet(receiptStorageKey('taebaek'));fireEvent.click(screen.getByRole('button',{name:'실패 요청 삭제'}));await screen.findByText('확인할 실패 작업이 없습니다.');closeRecovery();await startReceipt('1');await screen.findByRole('dialog',{name:'OEM 실패 작업 상세'});expect(onReceive).toHaveBeenCalledOnce();expect(screen.getByRole('button',{name:'같은 내용 다시 시도'})).toBeDisabled();expect(screen.getByText(/최초 송신 기록이 없어 다시 입고하지 않습니다/)).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'같은 내용 다시 시도'}));expect(onReceive).toHaveBeenCalledOnce();expect(storageGet(receiptStorageKey('taebaek'))).toBe(text);view.rerender(<OemManager {...p} issueOpen={false} receiveTarget={b} items={[raw,receivedProduct]} onReceive={onReceive}/>);await startReceipt('75');await waitFor(()=>expect(onReceive).toHaveBeenCalledTimes(2));expect(onReceive.mock.calls[1][0]).toMatchObject({po:{id:'po-b'},returns:[{itemId:receivedProduct.id,qty:75}]});expect(storageGet(receiptStorageKey('taebaek'))).toBe(text);
});

it('입고 대기 중 실제 UID가 바뀌면 성공 응답도 초안 정리나 모달 닫기에 사용하지 않는다',async()=>{
 const p=props(),request=deferred();let current=true;render(<OemManager {...p} issueOpen={false} receiveTarget={receivePo()} items={[raw,receivedProduct]} isCurrentActor={()=>current} onReceive={()=>request.promise}/>);await startReceipt();const text=storageGet(receiptStorageKey('taebaek'));current=false;await settle(request);expect(storageGet(receiptStorageKey('taebaek'))).toBe(text);expect(p.onClose).not.toHaveBeenCalled();
});