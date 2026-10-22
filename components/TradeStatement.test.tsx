import {companyInfoOpening} from '../src/shared/companyInfoCommand';


import type {CompanyInfoOutcome,CompanyInfoOperationContext} from '../src/features/statements/infrastructure/companyInfoWrites';
import type {PartnerItemTermsInput} from '../src/features/items/infrastructure/partnerItemTermsWrites';
const ownerExcel = vi.hoisted(() => ({ download: vi.fn(), document: vi.fn(), actor: null as null | ((user: {uid:string} | null) => void) }));
vi.mock('../src/shared/listExcel', () => ({ downloadListExcel: ownerExcel.download }));
vi.mock('../src/features/statements/infrastructure/statementExcel', () => ({ downloadStatementExcel: ownerExcel.document }));
import { today as ownerToday } from '../src/shared/day';
/** @vitest-environment jsdom */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {createHash} from 'node:crypto';
import { lineAmount } from '../src/shared/lineAmount';
import {archiveTradePending,listTradePendings,verifyTradeServerRejection} from '../src/features/statements/infrastructure/tradeStatementPending';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import TradeStatement, { VoucherDateChip } from './TradeStatement';
import type { CompanyInfo, IssuedStatement, Item, Partner, PartnerItem, Settlement } from '../src/shared/types';
import { appConfirm } from '../src/shared/components/appDialog';
import { OrderStatus, type Order } from '../src/shared/types';
import {auth} from '../src/shared/firebase';

async function recoveryAction(name:string){
 if(!screen.queryByRole('dialog',{name:'실패 작업 상세'})){
  if(!screen.queryByRole('dialog',{name:'실패 작업 목록'}))fireEvent.click(screen.getByRole('button',{name:/^실패 \d+$/}));
  const list=await screen.findByRole('dialog',{name:'실패 작업 목록'});
  const rows=within(list).getAllByRole('button').filter(button=>button.textContent?.includes('원')||button.textContent?.includes('원문 확인이 필요한 요청')||button.textContent?.includes('수금·지불 확인'));
  fireEvent.click(rows[0]);
 }
 return screen.findByRole('button',{name});
}
async function archiveCurrentRequest(){
 await recoveryAction('같은 내용 다시 시도');const entry=listTradePendings('taebaek','test-uid')[0];await act(async()=>archiveTradePending(entry.key,entry.text,'taebaek','test-uid'));fireEvent(window,new StorageEvent('storage'));fireEvent.click(screen.getByRole('button',{name:'실패 작업 상세 닫기'}));
}
function returnToComposer(){
 const detail=screen.queryByRole('button',{name:'실패 작업 상세 닫기'});if(detail)fireEvent.click(detail);
 const list=screen.queryByRole('button',{name:'실패 작업 목록 닫기'});if(list)fireEvent.click(list);
}
const pendingKey=()=>listTradePendings('taebaek','test-uid')[0]?.key??'trade-statement-issue:taebaek:test-uid';
const lowerKey='trade-statement-request-v2:taebaek:test-uid:lower-only%3AISSUE';
function lowerOnlyFixture(){
 const statement={id:'lower-only',companyId:'taebaek',partnerId:partner.id,partnerName:partner.name,type:'매입',tradeDate:'2026-10-15',docNo:'261015-001',totalAmount:6600,totalSupply:6000,totalTax:600,items:[{name:item.name,spec:'300ml',qty:1,price:6000,total:6000,accountCode:'500'}]};
 const request={operationId:'lower-only:ISSUE',statement,orderIds:['original-order'],poIds:['original-po'],costUpdates:[],releaseId:'fixture-release'};
 localStorage.setItem(lowerKey,JSON.stringify(request));return request;
}

it('첫 송신 내용만 남은 요청도 목록·상세·처리결과 조회가 가능하고 다른 작성 입력을 보존한다',async()=>{
 const request=lowerOnlyFixture();
 recoveryMocks.inspect.mockResolvedValueOnce({status:'applied',reason:'전표 저장 확인',currentStatement:'present',statement:request.statement,payment:{status:'unknown',reason:'수금 응답 확인 필요'}});
 setup(undefined,undefined,{composerOnly:true});
 fireEvent.change(screen.getByLabelText('1행 거래 수량'),{target:{value:'3'}});
 fireEvent.click(await recoveryAction('처리결과 확인'));
 await screen.findByText('전표 저장이 확인됐습니다. 수금·지불은 아래 결과를 따로 확인해 주세요.');
 expect(screen.getByText(/수금·지불 결과: 아직 확인되지 않음/)).toBeInTheDocument();
 expect(recoveryMocks.clear).not.toHaveBeenCalled();
 expect(localStorage.getItem(lowerKey)).toBe(JSON.stringify(request));
 returnToComposer();expect(screen.getByLabelText('1행 거래 수량')).toHaveValue('3');
});

it('손상된 지난 요청은 백업·새로읽기 동선을 제공하고 독립 전표 입력을 막지 않는다',async()=>{
 const key='trade-statement-issue:taebaek:test-uid',text='읽을 수 없는 최초 내용';localStorage.setItem(key,text);
 setup(undefined,undefined,{composerOnly:true});
 expect(screen.getByLabelText('1행 거래 수량')).not.toBeDisabled();
 fireEvent.click(await recoveryAction('원문 백업 다운로드'));await waitFor(()=>expect(recoveryMocks.backup).toHaveBeenCalled());
 expect(screen.getByRole('button',{name:'새로 읽기'})).toBeEnabled();
 expect(screen.queryByRole('button',{name:'같은 내용 다시 시도'})).not.toBeInTheDocument();
 expect(localStorage.getItem(key)).toBe(text);
});

it('비활성 원래 계좌의 수금·지불도 조회하고 원래 요청 재개만 제공한다',async()=>{
 const request=lowerOnlyFixture(),payment={operationId:'payment-first',releaseId:'fixture-release',expectedRevision:0,partnerId:partner.id,direction:'출금',pin:true,amount:3300,tradeDate:'2026-10-14',cashAccountId:'old-bank',allocations:[{statementId:request.statement.id,amount:3300}],note:'진단 거래처 지불'};
 localStorage.setItem('partner-payment-pending:taebaek:partner:test-uid',JSON.stringify({version:2,request:payment}));
 recoveryMocks.inspect.mockResolvedValueOnce({status:'applied',reason:'전표 저장 확인',currentStatement:'present',payment:{status:'unknown',reason:'원래 지불 상태 확인 필요'}});
 setup(undefined,undefined,{composerOnly:true,cashAccounts:[{id:'old-bank',companyId:'taebaek',name:'기존 은행',type:'통장',active:false,openingBalance:0,openingDate:'2026-01-01',createdAt:''}]});
 fireEvent.click(await recoveryAction('처리결과 확인'));
 expect(await screen.findByText(/3,300원 · 2026-10-14 · 원래 계좌 기존 은행 \(비활성\)/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'원래 수금·지불 요청 다시 확인'}));
 await waitFor(()=>expect(recoveryMocks.resumePayment).toHaveBeenCalledOnce());
 expect(JSON.parse(recoveryMocks.resumePayment.mock.calls[0][0].paymentRequestText)).toEqual(payment);
 expect(issueMocks.payment).not.toHaveBeenCalled();
});

it.each([true,false])('수금·지불 미반영 확정은 원금액·날짜를 유지해 기존 전표에서 수정한다: 원계좌활성 %s',async active=>{
 const request=lowerOnlyFixture(),apply=vi.fn();
 localStorage.setItem('partner-payment-pending:taebaek:partner:test-uid',JSON.stringify({version:2,request:{operationId:'payment-first',releaseId:'fixture-release',expectedRevision:0,partnerId:partner.id,direction:'출금',pin:true,amount:100,tradeDate:'2026-10-14',cashAccountId:'old-bank',allocations:[{statementId:request.statement.id,amount:100}]}}));
 recoveryMocks.inspect.mockResolvedValueOnce({status:'applied',reason:'전표 저장 확인',currentStatement:'present',statement:request.statement,payment:{status:'rejected',reason:'원래 지불 미반영 확정'}});
 recoveryMocks.clear.mockImplementationOnce(async()=>{localStorage.removeItem(lowerKey);return true;});
 setup(undefined,undefined,{composerOnly:true,onApplyStatement:apply,issuedStatements:[request.statement as IssuedStatement],cashAccounts:[{id:'main-bank',companyId:'taebaek',name:'다른 메인',type:'통장',active:true,openingBalance:0,openingDate:'2026-01-01',createdAt:''},{id:'old-bank',companyId:'taebaek',name:'원래 계좌',type:'통장',active,openingBalance:0,openingDate:'2026-01-01',createdAt:''}]});
 fireEvent.click(await recoveryAction('처리결과 확인'));fireEvent.click(await screen.findByRole('button',{name:'수금·지불 미반영 확인 · 기존 전표에서 다시 작성'}));
 const dialog=await screen.findByRole('dialog',{name:'지불 처리'});expect(recoveryMocks.clear).toHaveBeenCalledOnce();
 expect(dialog.querySelector('input[inputmode="numeric"]')).toHaveValue('100');expect(dialog.querySelector('input[type="date"]')).toHaveValue('2026-10-14');
 expect(within(dialog).getByRole('combobox')).toHaveValue(active?'old-bank':'');if(!active)expect(within(dialog).getByRole('option',{name:'계좌를 선택해 주세요'})).toBeInTheDocument();
 expect(apply).not.toHaveBeenCalled();expect(issueMocks.payment).not.toHaveBeenCalled();
});

it('같은 작성창의 결제 미반영 복구는 부모 종료로 컴포넌트를 내리지 않고 결제 수정창을 유지한다',async()=>{
 const apply=vi.fn().mockRejectedValue(Error('응답 유실')),close=vi.fn();
 function Parent(){const [open,setOpen]=React.useState(true);return open?<TradeStatement {...companyReadyFixture} orders={[]} allItems={[item]} partners={[partner]} partnerItems={[price]} issuedStatements={[]} pendingInvoice={pendingInvoice} composerOnly onApplyStatement={apply} onComposerClose={()=>{close();setOpen(false);}}/>:<p>부모가 작성창을 종료함</p>;}
 render(<Parent/>);fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(apply).toHaveBeenCalledOnce());
 const entry=listTradePendings('taebaek','test-uid')[0],p=entry.pending!;
 p.payment={amount:100,date:'2026-10-14',cashAccountId:'old-bank'};localStorage.setItem(entry.key,JSON.stringify(p));fireEvent(window,new StorageEvent('storage'));
 recoveryMocks.inspect.mockResolvedValueOnce({status:'applied',reason:'전표 저장 확인',currentStatement:'present',statement:p.input.statement,payment:{status:'rejected',reason:'원래 지불 미반영 확정'}});
 recoveryMocks.clear.mockImplementationOnce(async()=>{localStorage.removeItem(entry.key);return true;});
 fireEvent.click(await recoveryAction('처리결과 확인'));fireEvent.click(await screen.findByRole('button',{name:'수금·지불 미반영 확인 · 기존 전표에서 다시 작성'}));
 expect(await screen.findByRole('dialog',{name:'지불 처리'})).toBeInTheDocument();expect(close).not.toHaveBeenCalled();
 const paymentDialog=screen.getByRole('dialog',{name:'지불 처리'});expect(paymentDialog.querySelector('input[inputmode="numeric"]')).toHaveValue('100');expect(paymentDialog.querySelector('input[type="date"]')).toHaveValue('2026-10-14');
 expect(screen.queryByText('부모가 작성창을 종료함')).not.toBeInTheDocument();expect(apply).toHaveBeenCalledOnce();expect(issueMocks.payment).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'지불 처리 닫기'}));
 expect(screen.queryByRole('dialog',{name:'지불 처리'})).not.toBeInTheDocument();
 expect(screen.queryByRole('dialog',{name:'매입 전표 작성'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'저장'})).not.toBeInTheDocument();expect(close).not.toHaveBeenCalled();
});

it('삭제된 발행 전표는 수금·지불 원요청 재개나 새 결제 입력 버튼을 제공하지 않는다',async()=>{
 const request=lowerOnlyFixture();
 localStorage.setItem('partner-payment-pending:taebaek:partner:test-uid',JSON.stringify({version:2,request:{operationId:'payment-first',releaseId:'fixture-release',expectedRevision:0,partnerId:partner.id,direction:'출금',pin:true,amount:3300,tradeDate:'2026-10-14',cashAccountId:'old-bank',allocations:[{statementId:request.statement.id,amount:3300}]}}));
 recoveryMocks.inspect.mockResolvedValueOnce({status:'applied',reason:'발행 후 삭제 확인',currentStatement:'deleted',payment:{status:'unknown',reason:'지불 확인 필요'}});
 setup(undefined,undefined,{composerOnly:true});fireEvent.click(await recoveryAction('처리결과 확인'));
 await screen.findByText(/이 요청으로 발행됐던 전표는 현재 삭제된 것으로 확인/);
 expect(screen.queryByRole('button',{name:'원래 수금·지불 요청 다시 확인'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'수금·지불 미반영 확인 · 기존 전표에서 다시 작성'})).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'같은 내용 다시 시도'})).toBeDisabled();
});

it('전표일자 입력 오류는 저장 시도와 실패목록을 만들지 않고 수정 후 같은 입력으로 저장된다',async()=>{
 const {onApplyStatement}=setup(undefined,undefined,{composerOnly:true});
 const date=screen.getByLabelText('전표일자');fireEvent.change(date,{target:{value:''}});
 fireEvent.click(screen.getByRole('button',{name:'저장'}));
 await waitFor(()=>expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('전표일자를 확인해 주세요')));
 expect(onApplyStatement).not.toHaveBeenCalled();expect(listTradePendings('taebaek','test-uid')).toHaveLength(0);
 expect(screen.queryByRole('button',{name:'실패 0'})).toBeNull();
 expect(window.alert).not.toHaveBeenCalledWith(expect.stringContaining('전표 저장에 실패'));
 fireEvent.change(date,{target:{value:'2026-10-15'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));
 await waitFor(()=>expect(onApplyStatement).toHaveBeenCalledOnce());
});

it('브라우저 송신 내용이 없는 요청도 서버 첫 내용을 조회해 비교하고 백업한다',async()=>{
 const apply=vi.fn().mockRejectedValue(Error('응답 유실'));setup(undefined,undefined,{composerOnly:true,onApplyStatement:apply});
 fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(apply).toHaveBeenCalledOnce());
 const p=listTradePendings('taebaek','test-uid')[0].pending!;
 const response={status:'unknown',reason:'첫 요청 확인',currentStatement:'unverified',serverRequestText:JSON.stringify({operationId:p.input.command.operationId,statement:p.input.statement,orderIds:[],poIds:[],costUpdates:[],releaseId:'fixture-release'})};
 recoveryMocks.inspect.mockResolvedValueOnce(response);fireEvent.click(await recoveryAction('처리결과 확인'));
 await screen.findByText('서버에 남은 첫 저장 시도 내용');expect(apply).toHaveBeenCalledOnce();
 fireEvent.click(screen.getByRole('button',{name:'원문 백업 다운로드'}));
 await waitFor(()=>expect(recoveryMocks.backup).toHaveBeenCalled());expect(recoveryMocks.backup.mock.calls[0][2]).toBe(response);
});

it('서버 첫 내용으로 재시도한 뒤 정확한 재조회·정리 완료시에만 같은 작성 창을 닫는다',async()=>{
 const apply=vi.fn().mockRejectedValue(Error('응답 유실')),close=vi.fn();setup(undefined,undefined,{composerOnly:true,onApplyStatement:apply,onComposerClose:close});
 fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(apply).toHaveBeenCalledOnce());
 const entry=listTradePendings('taebaek','test-uid')[0],p=entry.pending!;
 const request={operationId:p.input.command.operationId,statement:p.input.statement,orderIds:p.input.command.orderIds,poIds:p.input.poIds,costUpdates:p.input.costUpdates.map(c=>({...c,beforeCost:c.beforeCost??0,sourceLineIndex:c.sourceLineIndex??-1})),...(p.input.newPoItems.length?{newPo:{items:p.input.newPoItems}}:{}),releaseId:'fixture-release'};
 const response={status:'unknown',reason:'첫 요청 확인',currentStatement:'unverified',serverRequestText:JSON.stringify(request)};
 recoveryMocks.inspect.mockResolvedValueOnce(response).mockResolvedValueOnce({...response,status:'applied'});
 recoveryMocks.retry.mockResolvedValueOnce({status:'duplicate',id:p.input.statement.id,docNo:p.input.statement.docNo});
 recoveryMocks.clear.mockImplementationOnce(async()=>{localStorage.removeItem(entry.key);return true;});
 fireEvent.click(await recoveryAction('처리결과 확인'));fireEvent.click(await screen.findByRole('button',{name:'서버에 남은 첫 내용으로 다시 시도'}));
 await waitFor(()=>expect(close).toHaveBeenCalledOnce());expect(recoveryMocks.retry.mock.calls[0][2]).toBe(response);
 expect(recoveryMocks.inspect).toHaveBeenCalledTimes(2);expect(recoveryMocks.clear).toHaveBeenCalledOnce();expect(apply).toHaveBeenCalledOnce();
});

it('처리결과 확인 중 사용자가 바뀌었다 돌아와 같은 항목을 열어도 늦은 결과를 표시하지 않는다',async()=>{
 lowerOnlyFixture();let resolve!:(value:unknown)=>void;recoveryMocks.inspect.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
 const props={orders:[],allItems:[item],partners:[partner],partnerItems:[price],issuedStatements:[],pendingInvoice,composerOnly:true};
 const view=render(<TradeStatement {...companyReadyFixture} {...props}/>);fireEvent.click(await recoveryAction('처리결과 확인'));
 await waitFor(()=>expect(recoveryMocks.inspect).toHaveBeenCalledOnce());
 (auth.currentUser as {uid:string}).uid='another-user';view.rerender(<TradeStatement {...companyReadyFixture} {...props}/>);
 (auth.currentUser as {uid:string}).uid='test-uid';view.rerender(<TradeStatement {...companyReadyFixture} {...props}/>);
 await recoveryAction('처리결과 확인');
 await act(async()=>resolve({status:'applied',reason:'다른 사용자에게 보이면 안 되는 이전 결과',currentStatement:'present'}));
 expect(screen.queryByText('다른 사용자에게 보이면 안 되는 이전 결과')).not.toBeInTheDocument();
 expect(localStorage.getItem(lowerKey)).not.toBeNull();
});
const issueMocks=vi.hoisted(()=>({payment:vi.fn(),print:vi.fn(),complete:vi.fn(),build:vi.fn()}));
const recoveryMocks=vi.hoisted(()=>({inspect:vi.fn(),backup:vi.fn(),clear:vi.fn(),resumePayment:vi.fn(),retry:vi.fn(),delete:vi.fn()}));
vi.mock('../src/features/statements/infrastructure/tradeStatementRecoveryService',async(importOriginal)=>({...await importOriginal<typeof import('../src/features/statements/infrastructure/tradeStatementRecoveryService')>(),inspectTradeStatementRecovery:recoveryMocks.inspect,exportTradeStatementRecovery:recoveryMocks.backup,clearVerifiedTradeStatementRecovery:recoveryMocks.clear,resumeTradeStatementRecoveryPayment:recoveryMocks.resumePayment,retryTradeStatementRecovery:recoveryMocks.retry,deleteTradeStatementRecovery:recoveryMocks.delete}));
vi.mock('../src/features/statements/infrastructure/statementPrint',async(importOriginal)=>{const actual=await importOriginal<typeof import('../src/features/statements/infrastructure/statementPrint')>();return {...actual,buildStatementPrintHtml:(...args:Parameters<typeof actual.buildStatementPrintHtml>)=>{issueMocks.build();return actual.buildStatementPrintHtml(...args);},printStatementViaIframe:issueMocks.print};});
vi.mock('../src/features/statements/infrastructure/issueTradeStatementCommand',async(importOriginal)=>({...await importOriginal<typeof import('../src/features/statements/infrastructure/issueTradeStatementCommand')>(),recordPartnerPayment:issueMocks.payment,completeTradeStatementRequest:issueMocks.complete}));
vi.mock('../src/shared/firebase',()=>({auth:{currentUser:{uid:'test-uid'},onAuthStateChanged:(callback:(user:{uid:string}|null)=>void)=>{const previous=ownerExcel.actor;const combined=(user:{uid:string}|null)=>{previous?.(user);callback(user);};ownerExcel.actor=combined;return()=>{if(ownerExcel.actor===combined)ownerExcel.actor=previous;};}},db:{}}));
// 저장 콜백 시험의 빈 Firebase 핸들은 조회에도 쓰지 않는다. 신규 단위 동작은 별도 시험한다.
vi.mock('../src/shared/services/itemPurchaseUnitService',()=>({subscribeItemPurchaseUnits:vi.fn((_companyId,onData)=>{onData([]);return vi.fn();})}));

// 운영 DB에 닿지 않고 저장 콜백의 완료·실패에 따른 화면 동작을 검증한다.
vi.mock('../src/shared/services/firebaseService', async () => {
 const [{readFileSync},ts,firestore]=await Promise.all([import('node:fs'),import('typescript'),import('firebase/firestore')]);
 const source=readFileSync('src/shared/services/firebaseService.ts','utf8'),tree=ts.createSourceFile('service.ts',source,ts.ScriptTarget.Latest,true);let expression='';
 function visit(n:import('typescript').Node){if(ts.isVariableDeclaration(n)&&n.name.getText(tree)==='stripUndefined'&&n.initializer)expression=n.initializer.getText(tree);ts.forEachChild(n,visit);}visit(tree);
 const code=ts.transpileModule('const stripUndefined='+expression+';return stripUndefined;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const names=['Timestamp','DocumentReference','GeoPoint','Bytes','FieldValue','VectorValue'];
 const stripUndefined=Function(...names,code)(...names.map(name=>firestore[name as keyof typeof firestore]));
 return {fetchCollection:vi.fn(async()=>[]),activeReleaseId:async()=> 'fixture-release',stripUndefined};
});
vi.mock('../src/features/admin/useVoucherLedger', () => ({
  useVoucherLedger: ({ issuedStatements }: { issuedStatements: IssuedStatement[] }) => ({
    mergedStatements: issuedStatements, journalBySource: new Map(), partnerBalances: new Map(), partnerJournals: [],
    getBalance: (statement:IssuedStatement) => statement.totalAmount, canSettle: () => false, isVouchered: () => false,
    isFetchingHistory: false, forgetStatement: vi.fn(),
  }),
}));
vi.mock('./CashLedger', () => ({ AccountModal: () => null }));
vi.mock('./voucher/VoucherComposer', () => ({ default: () => null }));
vi.mock('../src/shared/components/appDialog', () => ({
  appConfirm: vi.fn(async () => true),
  appPrompt: vi.fn(async () => null),
  appNotice: vi.fn(async () => {}),
}));

const item = { id: 'loose', name: '같은 이름', spec: '300ml', type: 'product' } as Item;
const partner = { id: 'partner', name: '진단 거래처', role: '매입' } as unknown as Partner;
const price = { id: 'pi', itemId: item.id, partnerId: partner.id, Direction: 'in', price: 6000,
  taxType: '과세', Account_Code: '500' } as PartnerItem;
const pendingInvoice = { partnerId: partner.id, partnerName: partner.name,
  items: [{ itemId: item.id, name: item.name, spec: item.spec!, qty: 1, price: 6000 }] };

it.each([
  [0.0001, '0.0001'], [1.2345, '1.2345'], [2.5, '2.5'], [20, '20'],
  [NaN, '반품 연결 확인 중'], [Infinity, '반품 연결 확인 중'],
] as const)('발행 상세 수량 %s의 원문 소수와 기존 미확인 안내를 보존한다', async (qty, shown) => {
  const amount = lineAmount(Number.isFinite(qty) ? qty : 1, 10000, true);
  const stmt = { id: 'quantity-detail', companyId: 'taebaek', docNo: '261016-099',
    partnerId: partner.id, partnerName: partner.name, tradeDate: '2026-10-16', issuedAt: '2026-10-16T00:00:00Z',
    type: '매입', orderId: '', totalSupply: amount.supply, totalTax: amount.tax, totalAmount: amount.gross,
    noncashApplication: { kind: 'advance-application' },
    items: [{ itemId: item.id, name: '상세 수량 검증', spec: 'kg', qty, price: 10000,
      supply: amount.supply, tax: amount.tax, total: amount.gross, isTaxExempt: true }],
  } as IssuedStatement;
  const original = structuredClone(stmt), update = vi.fn();
  const writes = setup(undefined, undefined, { pendingInvoice: null, issuedStatements: [stmt], onUpdateIssuedStatement: update });
  fireEvent.click(screen.getByRole('button', { name: /^전체$/ }));
  fireEvent.click((await screen.findAllByText(partner.name)).find(el => el.closest('tr'))!);
  const dialog = await screen.findByRole('dialog', { name: `발행 전표 상세 — ${partner.name}` });
  const cells = within(within(dialog).getByText('상세 수량 검증').closest('tr')!).getAllByRole('cell');
  expect(cells[2]).toHaveTextContent('kg'); expect(cells[3].textContent).toBe(shown);
  expect(cells[4].textContent).toBe('10,000');
  expect(cells[5].textContent).toBe(amount.supply.toLocaleString('ko-KR'));
  expect(cells[6].textContent).toBe('면세'); expect(cells[7].textContent).toBe(amount.gross.toLocaleString('ko-KR'));
  expect(stmt).toEqual(original); expect(update).not.toHaveBeenCalled();
  expect(writes.onApplyStatement).not.toHaveBeenCalled(); expect(writes.onAddIssuedStatement).not.toHaveBeenCalled();
});

describe('주문 전표 제외 기록', () => {
  const order = { id: 'excluded-order', partnerId: partner.id, partnerName: partner.name,
    status: OrderStatus.PENDING, createdAt: new Date().toISOString(),
    items: [{ itemId: item.id, name: item.name, quantity: 1, price: 1000 }] } as Order;
  function openSale(extra: Partial<React.ComponentProps<typeof TradeStatement>>) {
    setup(undefined, undefined, { pendingInvoice: null, orders: [order], ...extra });
    fireEvent.click(screen.getByRole('button', { name: '거래명세서' }));
    fireEvent.click(screen.getByRole('button', { name: '매출전표' }));
  }
  it('신규 제외는 필수 사유와 현재 사용자 ID를 함께 저장한다', async () => {
    const update = vi.fn(async () => {});
    openSale({ onUpdateOrder: update, currentUserId: 'employee-17' });
    fireEvent.click(screen.getByRole('button', { name: '전표 제외' }));
    const save = screen.getByRole('button', { name: '제외 저장' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('예: 샘플 제공, 무상 출고, 전표 발행하지 않기로 협의'), { target: { value: '   ' } });
    expect(save).toBeDisabled();
    expect(update).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText('예: 샘플 제공, 무상 출고, 전표 발행하지 않기로 협의'), { target: { value: '  샘플 제공  ' } });
    fireEvent.click(save);
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update.mock.calls[0]).toEqual([order.id, {
      accountingExcluded: true, accountingExclusionReason: '샘플 제공',
      accountingExcludedAt: expect.any(String), accountingExcludedBy: 'employee-17',
    }]);
  });
  it('복구는 제외 플래그와 사유·시각·작성자를 모두 비운다', async () => {
    const update = vi.fn(async () => {});
    openSale({ onUpdateOrder: update, orders: [{ ...order, accountingExcluded: true,
      accountingExclusionReason: '샘플 제공', accountingExcludedAt: '2026-10-01T00:00:00Z', accountingExcludedBy: 'old-user' }] });
    fireEvent.click(screen.getByRole('button', { name: '복구' }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update.mock.calls[0]).toEqual([order.id, { accountingExcluded: false,
      accountingExclusionReason: '', accountingExcludedAt: '', accountingExcludedBy: '' }]);
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

function setup(onAddIssuedStatement = vi.fn(async (_s: IssuedStatement) => {}),
  onSavePartnerItemTerms: NonNullable<React.ComponentProps<typeof TradeStatement>['onSavePartnerItemTerms']> = vi.fn(async (_p: PartnerItemTermsInput) => ({status:'saved' as const})),
  extra: Partial<React.ComponentProps<typeof TradeStatement>> = {}) {
  /*  발행은 이제 **명령 하나**로 나간다(설계 §2, 3단계). 시험은 옛 통로를 그 위에 태워
      `onAddIssuedStatement` 에 대한 검사 뜻을 그대로 지킨다 — 전표가 저장됐나, 실패하면
      어떻게 되나. 저장이 엎어지는 상황도 그대로 만들어진다(아래 throw 가 그대로 올라온다). */
  const onApplyStatement = vi.fn(async ({ statement }: { statement: IssuedStatement }) => {
    await onAddIssuedStatement(statement);
    return 'applied' as const;
  });
  render(<TradeStatement {...companyReadyFixture} orders={[]} allItems={[{ ...item, id: 'box' }, item]}
    partners={[partner]} partnerItems={[price]} issuedStatements={[]}
    pendingInvoice={pendingInvoice} onAddIssuedStatement={onAddIssuedStatement}
    onApplyStatement={onApplyStatement}
    onSavePartnerItemTerms={onSavePartnerItemTerms} {...extra} />);
  return { onAddIssuedStatement, onSavePartnerItemTerms, onApplyStatement };
}

beforeEach(() => {
  (auth.currentUser as {uid:string}).uid='test-uid';
  issueMocks.payment.mockResolvedValue(undefined);
  localStorage.clear();
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async (_name:string,_options:unknown,callback:()=>Promise<unknown>)=>callback()}});
  vi.clearAllMocks();
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  vi.mocked(appConfirm).mockResolvedValue(true);
});

it('수량 0은 원문 저장과 서버 요청 전에 행·품목을 안내하고 수정 후 저장된다', async () => {
  const { onApplyStatement } = setup(undefined, undefined, {
    composerOnly: true, pendingInvoice: { ...pendingInvoice, items: [{ ...pendingInvoice.items[0], qty: 0 }] },
  });
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
  expect(window.alert).toHaveBeenCalledWith(expect.stringContaining(`1행 · ${item.name}`));
  expect(onApplyStatement).not.toHaveBeenCalled();
  expect(localStorage.getItem(pendingKey())).toBeNull();
  fireEvent.change(screen.getByLabelText('1행 거래 수량'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
  await waitFor(() => expect(onApplyStatement).toHaveBeenCalledOnce());
});

it('정상 송신 중인 사본은 실패로 세지 않고 복구 전환을 막은 뒤 완료 시 창을 닫는다',async()=>{
 const gate=deferred(),close=vi.fn(),apply=vi.fn(async()=>{await gate.promise;return 'applied' as const;});
 setup(undefined,undefined,{composerOnly:true,onApplyStatement:apply,onComposerClose:close});
 fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(apply).toHaveBeenCalledOnce());
 expect(listTradePendings('taebaek','test-uid')).toHaveLength(1);
 const recovery=screen.getByRole('button',{name:'처리 기록'});expect(recovery).toBeDisabled();fireEvent.click(recovery);
 expect(screen.queryByRole('dialog',{name:'실패 작업 목록'})).not.toBeInTheDocument();
 await act(async()=>{gate.resolve();await gate.promise;});await waitFor(()=>expect(close).toHaveBeenCalledOnce());
 expect(listTradePendings('taebaek','test-uid')).toHaveLength(0);expect(screen.queryByRole('dialog',{name:'실패 작업 목록'})).not.toBeInTheDocument();
});
it('발행 확인 뒤 사본 정리 오류는 전표 실패가 아니라 후속 확인으로 안내하고 보존한다',async()=>{
 issueMocks.complete.mockRejectedValueOnce(Error('정리 잠금 오류'));const close=vi.fn();
 setup(undefined,undefined,{composerOnly:true,onApplyStatement:vi.fn().mockResolvedValue('applied'),onComposerClose:close});
 fireEvent.click(screen.getByRole('button',{name:'저장'}));
 await waitFor(()=>expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('발행은 완료됐습니다. 전표 요청 사본 정리')));
 expect(close).not.toHaveBeenCalled();expect(listTradePendings('taebaek','test-uid')).toHaveLength(1);
 expect(screen.getByRole('dialog',{name:'실패 작업 목록'})).toBeInTheDocument();
});
it('발행 확인 후 하위 사본이 남으면 상위 원문도 삭제하지 않는다',async()=>{
 const close=vi.fn(),apply=vi.fn(async(input)=>{localStorage.setItem('trade-statement-request-v2:taebaek:test-uid:'+encodeURIComponent(input.command.operationId),JSON.stringify({operationId:input.command.operationId,statement:input.statement,orderIds:[],poIds:[],costUpdates:[],releaseId:'fixture-release'}));return 'applied' as const;});
 setup(undefined,undefined,{composerOnly:true,onApplyStatement:apply,onComposerClose:close});fireEvent.click(screen.getByRole('button',{name:'저장'}));
 await waitFor(()=>expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('발행은 완료됐습니다. 전표 요청 사본 정리')));
 expect(close).not.toHaveBeenCalled();expect(listTradePendings('taebaek','test-uid')).toHaveLength(1);
});

it('작성창에는 실패 목록이 없고 메뉴 목록에서 상세 재시도 후 원문과 입력을 유지한다', async()=>{
 const apply=vi.fn().mockRejectedValue(new Error('응답 유실'));setup(undefined,undefined,{composerOnly:true,onApplyStatement:apply});
 fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(apply).toHaveBeenCalledOnce());
 returnToComposer();expect(within(screen.getByRole('dialog',{name:'매입 전표 작성'})).queryByRole('button',{name:'같은 내용 다시 시도'})).not.toBeInTheDocument();
 expect(screen.queryByRole('status')).not.toBeInTheDocument();
 const retry=await recoveryAction('같은 내용 다시 시도');fireEvent.click(retry);await waitFor(()=>expect(apply).toHaveBeenCalledTimes(2));expect(apply.mock.calls[1][0]).toEqual(apply.mock.calls[0][0]);
 returnToComposer();expect(screen.getByRole('dialog',{name:'매입 전표 작성'})).toBeInTheDocument();expect(localStorage.getItem(pendingKey())).not.toBeNull();
});
it.each(['applied','duplicate'] as const)('실패 목록의 %s 재시도 완료는 해당 작성 창도 닫는다',async status=>{
 const close=vi.fn(),gate=deferred();
 const apply=vi.fn().mockRejectedValueOnce(new Error('응답 유실')).mockImplementationOnce(async()=>{await gate.promise;return status;});
 setup(undefined,undefined,{composerOnly:true,onApplyStatement:apply,onComposerClose:close});
 fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(apply).toHaveBeenCalledOnce());
 const original=apply.mock.calls[0][0],key=pendingKey();
 fireEvent.click(await recoveryAction('같은 내용 다시 시도'));await waitFor(()=>expect(apply).toHaveBeenCalledTimes(2));
 expect(close).not.toHaveBeenCalled();expect(localStorage.getItem(key)).not.toBeNull();
 await act(async()=>{gate.resolve();await gate.promise;});
 await waitFor(()=>expect(close).toHaveBeenCalledOnce());
 expect(screen.queryByRole('dialog',{name:'매입 전표 작성'})).not.toBeInTheDocument();
 expect(screen.queryByRole('dialog',{name:'실패 작업 목록'})).not.toBeInTheDocument();
 expect(localStorage.getItem(key)).toBeNull();expect(apply.mock.calls[1][0]).toEqual(original);
});
it('재시도 전표 저장 뒤 지불이 실패하면 작성 창을 유지하고 지불 완료 후 닫는다',async()=>{
 const close=vi.fn(),apply=vi.fn().mockRejectedValueOnce(new Error('응답 유실')).mockResolvedValue('duplicate');
 const accounts=[{id:'bank',companyId:'taebaek' as const,name:'은행',type:'통장' as const,active:true,openingBalance:0,openingDate:'2026-01-01',createdAt:''}];
 setup(undefined,undefined,{composerOnly:true,onApplyStatement:apply,onComposerClose:close,cashAccounts:accounts});
 fireEvent.click(screen.getByLabelText('지불도 함께'));fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(apply).toHaveBeenCalledOnce());
 const key=pendingKey(),original=localStorage.getItem(key);
 issueMocks.payment.mockRejectedValueOnce(new Error('지불 실패'));
 fireEvent.click(await recoveryAction('같은 내용 다시 시도'));
 await waitFor(()=>expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('지불 실패')));
 expect(close).not.toHaveBeenCalled();expect(localStorage.getItem(key)).toBe(original);
 returnToComposer();expect(screen.getByRole('dialog',{name:'매입 전표 작성'})).toBeInTheDocument();
 fireEvent.click(await recoveryAction('같은 내용 다시 시도'));
 await waitFor(()=>expect(close).toHaveBeenCalledOnce());
 expect(issueMocks.payment).toHaveBeenCalledTimes(2);expect(issueMocks.payment.mock.calls[1]).toEqual(issueMocks.payment.mock.calls[0]);
 expect(screen.queryByRole('dialog',{name:'매입 전표 작성'})).not.toBeInTheDocument();expect(localStorage.getItem(key)).toBeNull();
});
describe('전표 목록 화면 구성', () => {
  it('입고 화면에서는 목록을 펼치지 않고 같은 발행 모달만 열어 저장 후 닫는다', async () => {
    const close = vi.fn();
    const { onApplyStatement } = setup(undefined, undefined, { composerOnly: true, onComposerClose: close, pendingInvoice: { ...pendingInvoice, poIds: ['po-existing'] } });
    expect(screen.queryByRole('heading', { name: '검색조건' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '매입 전표 작성' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(onApplyStatement).toHaveBeenCalledOnce());
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
  });
  it('주문 목록과 같은 검색조건·거래유형·조회 결과 순서로 구성한다', () => {
    setup(undefined, undefined, { pendingInvoice: null });

    expect(screen.getByRole('heading', { name: '검색조건' })).toBeInTheDocument();
    const kindTabs = screen.getByRole('tablist', { name: '전표 거래유형 선택' });
    expect(within(kindTabs).getAllByRole('tab')).toHaveLength(6);
    expect(screen.getByText(/조회 결과/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /초기화/ })).toBeInTheDocument();
  });
});

describe('전표와 거래처 단가의 저장 완료', () => {
  it('과거 전표의 미연결 품목은 현재 단가를 덮지 않고 이번 전표에만 저장한다', async () => {
    const old = { id: 'historical', docNo: '260908-98', partnerId: partner.id, partnerName: partner.name,
      tradeDate: '2026-09-08', issuedAt: '2026-09-08T00:00:00Z', type: '매입', orderId: '',
      totalSupply: 5455, totalTax: 545, totalAmount: 6000,
      items: [{ itemId: item.id, name: item.name, spec: item.spec, qty: 1, price: 6000,
        supply: 5455, tax: 545, total: 6000, isTaxExempt: false, accountCode: '500' }],
    } as IssuedStatement;
    const newer = { ...old, id: 'newer', docNo: '260924-01', tradeDate: '2026-09-24' };
    const update = vi.fn(async (_id: string, _data: Partial<IssuedStatement>) => {});
    const { onSavePartnerItemTerms } = setup(undefined, undefined, {
      pendingInvoice: null, partnerItems: [], issuedStatements: [old, newer], focusDocNo: old.docNo,
      onUpdateIssuedStatement: update,
    });
    fireEvent.click((await screen.findAllByText(old.partnerName)).find(el => el.closest('tr'))!);
    await waitFor(() => expect(document.querySelector('fieldset')).not.toBeNull());
    const modal = within(document.querySelector('fieldset')!);
    fireEvent.click(modal.getByRole('button', { name: '수정' }));
    fireEvent.click(modal.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(appConfirm).toHaveBeenCalledWith(expect.stringContaining('과거 전표를 수정 중입니다'));
    expect(onSavePartnerItemTerms).not.toHaveBeenCalled();
    expect(update.mock.calls[0][1].items?.[0]).toMatchObject({ itemId: item.id, price: 6000 });
  });

  it('매입전표 발행 때 거절하면 전표만 저장하고 입고대기는 만들지 않는다', async () => {
    vi.mocked(appConfirm).mockResolvedValue(false);
    const { onAddIssuedStatement, onApplyStatement } = setup();

    fireEvent.click(await screen.findByRole('button', { name: '저장' }));

    await waitFor(() => expect(onAddIssuedStatement).toHaveBeenCalledTimes(1));
    expect(onApplyStatement).toHaveBeenCalledWith(expect.objectContaining({ poIds: [], newPoItems: [] }));
    expect(appConfirm).toHaveBeenCalledWith(expect.stringContaining('입고대기에 등록할까요?'));
  });

  it('기존 입고대기에서 발행하면 추가 질문 없이 기존 발주만 연결한다', async () => {
    const { onApplyStatement } = setup(undefined, undefined, {
      pendingInvoice: { ...pendingInvoice, poIds: ['existing-inbound-po'] },
    });
    fireEvent.click(await screen.findByRole('button', { name: '저장' }));
    await waitFor(() => expect(onApplyStatement).toHaveBeenCalledTimes(1));
    expect(appConfirm).not.toHaveBeenCalled();
    expect(onApplyStatement).toHaveBeenCalledWith(expect.objectContaining({
      poIds: ['existing-inbound-po'], newPoItems: [],
    }));
  });

  it('비용성 매입만 있으면 입고대기를 묻지 않는다', async () => {
    const 비용품목 = { ...item, type: 'service' } as Item;
    const { onApplyStatement } = setup(undefined, undefined, { allItems: [비용품목] });

    fireEvent.click(await screen.findByRole('button', { name: '저장' }));

    await waitFor(() => expect(onApplyStatement).toHaveBeenCalledTimes(1));
    expect(appConfirm).not.toHaveBeenCalled();
    expect(onApplyStatement).toHaveBeenCalledWith(expect.objectContaining({ poIds: [], newPoItems: [] }));
  });

  it('기존 전표 수정도 ID와 과세 변경을 보존하고 단가 저장 완료까지 기다린다', async () => {
    const gate = deferred();
    const upsert = vi.fn((_p:PartnerItemTermsInput)=>gate.promise.then(()=>({status:'saved' as const})));
    const update = vi.fn(async (_id: string, _data: Partial<IssuedStatement>) => {});
    const stmt = { id: 'existing', docNo: '260908-99', partnerId: partner.id, partnerName: partner.name,
      tradeDate: '2026-09-08', issuedAt: '2026-09-08T00:00:00Z', type: '매입', orderId: '',
      totalSupply: 5455, totalTax: 545, totalAmount: 6000,
      items: [{ itemId: item.id, name: item.name, spec: item.spec, qty: 1, price: 6000,
        supply: 5455, tax: 545, total: 6000, isTaxExempt: false, accountCode: '500' }],
    } as IssuedStatement;
    setup(undefined, upsert, { pendingInvoice: null, issuedStatements: [stmt], focusDocNo: stmt.docNo,
      onUpdateIssuedStatement: update, onUpdateItemCost:vi.fn(async()=>{}) });
    fireEvent.click((await screen.findAllByText(stmt.partnerName)).find(el => el.closest('tr'))!);
    await waitFor(() => expect(document.querySelector('fieldset')).not.toBeNull());
    const modal = within(document.querySelector('fieldset')!);
    fireEvent.click(modal.getByRole('button', { name: '수정' }));
    fireEvent.click(modal.getByRole('button', { name: '545' }));
    fireEvent.click(modal.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][1].items?.[0]).toMatchObject({ itemId: 'loose', isTaxExempt: true });
    expect(upsert.mock.calls[0][0]).toMatchObject({ target:{itemId:'loose'},terms:{taxType:'면세'} });
    expect(modal.getByRole('button', { name: '저장 중…' })).toBeDisabled();
    await act(async () => { gate.resolve(); await gate.promise; });
    await waitFor(() => expect(document.querySelector('fieldset')).toBeNull());
  });

  it('단가 저장이 끝날 때까지 창과 입력을 잠그고, 선택한 ID를 보존한다', async () => {
    const gate = deferred();
    const upsert = vi.fn((_p:PartnerItemTermsInput)=>gate.promise.then(()=>({status:'saved' as const})));
    const { onAddIssuedStatement } = setup(undefined, upsert);
    fireEvent.click(await screen.findByRole('button', { name: '저장' }));
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    expect(onAddIssuedStatement.mock.calls[0][0].items[0].itemId).toBe('loose');
    expect(upsert.mock.calls[0][0]).toMatchObject({ target:{itemId:'loose'},terms:{price:6000,taxType:'과세'} });
    expect(screen.getByRole('button', { name: '저장 중…' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '저장 중…' }));
    expect(onAddIssuedStatement).toHaveBeenCalledTimes(1);
    await act(async () => { gate.resolve(); await gate.promise; });
    await waitFor(() => expect(screen.queryByRole('button', { name: '새 전표' })).not.toBeInTheDocument());
  });

  it('전표 발행 뒤 단가 저장이 실패하면 발행 완료를 알리고 재발행을 유도하지 않는다', async () => {
    const upsert = vi.fn(async (_p:PartnerItemTermsInput)=>({status:'saved' as const}));
    upsert.mockRejectedValueOnce(new Error('단가 저장 실패'));
    const { onAddIssuedStatement } = setup(undefined, upsert);
    fireEvent.click(await screen.findByRole('button', { name: '저장' }));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('발행은 완료됐지만 거래조건 후속 처리를 확인하지 못했습니다')));
    expect(onAddIssuedStatement).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('button', { name: '새 전표' })).not.toBeInTheDocument());
  });

  it('권한 거부를 로그인 만료로 오진하거나 새로고침을 안내하지 않는다', async () => {
    const save = vi.fn(async (_s: IssuedStatement) => {
      throw { code: 'permission-denied', message: 'Missing or insufficient permissions.' };
    });
    setup(save);
    fireEvent.click(await screen.findByRole('button', { name: '저장' }));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('전표 저장 권한이 거부됐습니다')));
    expect(window.alert).not.toHaveBeenCalledWith(expect.stringContaining('로그인이 풀려서'));
    returnToComposer();expect(screen.getByRole('button', { name: '새 전표' })).toBeInTheDocument();
  });

  it('전표 저장이 실패하면 단가를 쓰지 않고 입력창을 유지한다', async () => {
    const save = vi.fn(async (_s: IssuedStatement) => { throw new Error('전표 저장 실패'); });
    const { onSavePartnerItemTerms } = setup(save);
    fireEvent.click(await screen.findByRole('button', { name: '저장' }));
    await waitFor(() => expect(window.alert).toHaveBeenCalled());
    expect(onSavePartnerItemTerms).not.toHaveBeenCalled();
    returnToComposer();expect(screen.getByRole('button', { name: '새 전표' })).toBeInTheDocument();
  });
});

describe('자금 전표 수정 저장 순서', () => {
  const cash = {
    id: 'cash-edit-test', companyId: 'taebaek', date: '2026-09-24', createdAt: '2026-09-24T09:00:00+09:00',
    dir: '입금', amount: 5000, cashAccountId: 'bank', accountCode: '811',
    partnerId: partner.id, partnerName: partner.name, note: '수정 시험 자금',
  } as const;
  it('편집 성공 후 승인된 FIFO 매칭을 한 번의 원자 배분 콜백으로 전달한다', async () => {
    const source = cash;
    const save = vi.fn(async () => {}), match = vi.fn(async () => {}), oldAdd = vi.fn();
    const stmt = { id: 'fifo-statement', companyId: 'taebaek', partnerId: partner.id, partnerName: partner.name,
      docNo: '260924-01', type: '매출', tradeDate: '2026-09-24', totalAmount: 10000,
      items:[{name:'매출',qty:1,price:10000,supply:10000,tax:0,total:10000,isTaxExempt:true,accountCode:'108'}] } as IssuedStatement;
    setup(undefined, undefined, { pendingInvoice: null, cashEntries: [source], issuedStatements: [stmt],
      onUpdateCashEntry: save, onMatchCashAllocations: match, onAddSettlement: oldAdd,
      accountCodes: [{ id: 'ar', code: '108', name: '외상매출금' }] as React.ComponentProps<typeof TradeStatement>['accountCodes'] });
    fireEvent.click(screen.getByRole('button', { name: '전체' }));
    fireEvent.click(await screen.findByText('수정 시험 자금', { selector: 'td' }));
    const dialog = screen.getByRole('dialog', { name: '자금 전표 수정' });
    fireEvent.change(within(dialog).getAllByRole('combobox').find(input => input.tagName === 'SELECT')!, { target: { value: '108' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(match).toHaveBeenCalledTimes(1));
    expect(match).toHaveBeenCalledWith(expect.objectContaining({ id: source.id, amount: 5000 }), [{ statementId: stmt.id, amount: 5000 }]);
    expect(oldAdd).not.toHaveBeenCalled();
  });

  it('DB 저장 완료 전에는 수정창을 닫지 않고, 실패해도 열린 채로 남는다', async () => {
    const gate = deferred();
    const save = vi.fn(async () => gate.promise);
    setup(undefined, undefined, { pendingInvoice: null, cashEntries: [cash], onUpdateCashEntry: save });
    // 기본 조회 기간은 실행 당일이라 고정된 9/24 시험 전표를 보려면 전체 기간으로 바꾼다.
    fireEvent.click(screen.getByRole('button', { name: '전체' }));
    fireEvent.click(await screen.findByText('진단 거래처', { selector: 'td' }));
    const dialog = screen.getByRole('dialog', { name: '자금 전표 수정' });
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    expect(save).toHaveBeenCalledTimes(1);
    expect(dialog).toBeInTheDocument();
    await act(async () => { gate.resolve(); await gate.promise; });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '자금 전표 수정' })).not.toBeInTheDocument());
  });

  it('DB 저장이 실패하면 오류를 알리고 수정창을 유지한다', async () => {
    const save = vi.fn(async () => { throw new Error('시험 실패'); });
    setup(undefined, undefined, { pendingInvoice: null, cashEntries: [cash], onUpdateCashEntry: save });
    fireEvent.click(screen.getByRole('button', { name: '전체' }));
    fireEvent.click(await screen.findByText('진단 거래처', { selector: 'td' }));
    const dialog = screen.getByRole('dialog', { name: '자금 전표 수정' });
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('시험 실패')));
    expect(dialog).toBeInTheDocument();
  });

  it('원자 현금 저장이 실패하면 별도 정산 쓰기 없이 원문과 수정창을 보존한다', async () => {
    const updateCash = vi.fn(async () => { throw new Error('자금 쓰기 실패'); });
    const updateSettlement = vi.fn(async (_id: string, _patch: Partial<Settlement>) => {});
    const settlement = { id: 'linked', cashEntryId: cash.id, statementId: 'stmt-linked', amount: 5000, createdAt: '' };
    const stmt = { id: 'stmt-linked', partnerId: partner.id, partnerName: partner.name,
      docNo: '260924-01', type: '매출', tradeDate: '2026-09-24', totalAmount: 10000 } as IssuedStatement;
    setup(undefined, undefined, { pendingInvoice: null, cashEntries: [cash], settlements: [settlement],
      issuedStatements: [stmt], onUpdateCashEntry: updateCash, onUpdateSettlement: updateSettlement });
    fireEvent.click(screen.getByRole('button', { name: '전체' }));
    fireEvent.click(await screen.findByText('수정 시험 자금', { selector: 'td' }));
    const dialog = screen.getByRole('dialog', { name: '자금 전표 수정' });
    fireEvent.change(within(dialog).getAllByRole('textbox')[0], { target: { value: '6000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(updateCash).toHaveBeenCalledTimes(1));
    expect(updateSettlement).not.toHaveBeenCalled();
    expect(updateCash).toHaveBeenCalledWith(cash.id, expect.objectContaining({ amount: 6000 }), cash, undefined, undefined);
    expect(updateCash).toHaveBeenCalledTimes(1);
    expect(dialog).toBeInTheDocument();
  });
});


describe('전표 날짜 명시 확정', () => {
  it('달력 월 탐색 change와 blur는 확인이나 저장을 하지 않는다', () => {
    const apply = vi.fn(); render(<VoucherDateChip value="2026-10-06" onApply={apply} />);
    const input = screen.getByLabelText('전표일자');
    fireEvent.change(input, {target:{value:'2026-09-06'}}); fireEvent.blur(input);
    expect(apply).not.toHaveBeenCalled(); expect(appConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'취소'}));
    expect(input).toHaveValue('2026-10-06'); expect(apply).not.toHaveBeenCalled();
  });
  it('적용을 눌러야 확정 경로를 호출하고 완료 전 중복 적용을 막는다', async () => {
    const pending = deferred(), apply = vi.fn(() => pending.promise);
    render(<VoucherDateChip value="2026-10-06" onApply={apply} />);
    fireEvent.change(screen.getByLabelText('전표일자'),{target:{value:'2026-09-15'}});
    fireEvent.click(screen.getByRole('button',{name:'날짜 적용'}));
    expect(apply).toHaveBeenCalledExactlyOnceWith('2026-09-15');
    expect(screen.getByRole('button',{name:'날짜 적용'})).toBeDisabled();
    await act(async()=>pending.resolve());
    expect(screen.queryByRole('button',{name:'날짜 적용'})).not.toBeInTheDocument();
  });
});

it('실제 전표 날짜셀은 월 탐색을 저장하지 않고 적용 뒤 기존 월변경 확인과 writer를 실행한다', async () => {
  const update = vi.fn(async (_id: string, _patch: Partial<IssuedStatement>) => {});
  const stmt = {id:'date-statement',docNo:'261006-01',partnerId:partner.id,partnerName:partner.name,
    tradeDate:'2026-10-06',issuedAt:'2026-10-06T00:00:00Z',type:'매입',totalSupply:100,totalTax:0,totalAmount:100,
    items:[{itemId:item.id,name:item.name,qty:1,price:100,supply:100,tax:0,total:100,isTaxExempt:true,accountCode:'500'}]} as IssuedStatement;
  setup(undefined,undefined,{pendingInvoice:null,issuedStatements:[stmt],onUpdateIssuedStatement:update});
  fireEvent.click(screen.getByRole('button',{name:'전체'}));
  const input = (await screen.findAllByLabelText('전표일자'))[0];
  fireEvent.change(input,{target:{value:'2026-09-06'}});fireEvent.blur(input);
  expect(appConfirm).not.toHaveBeenCalled();expect(update).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'날짜 적용'}));
  await waitFor(()=>expect(update).toHaveBeenCalled());
  expect(appConfirm).toHaveBeenCalledWith(expect.stringContaining('부가세 신고 달과 월 마감'));
  expect(update.mock.calls[0][0]).toBe(stmt.id);
});

it('날짜 저장 실패는 초안을 보존하고 외부 날짜 갱신은 초안을 초기화한다', async () => {
  const apply = vi.fn(async () => {throw new Error('저장 실패');});
  const view=render(<VoucherDateChip value="2026-10-06" onApply={apply} />);
  const input=screen.getByLabelText('전표일자');
  fireEvent.change(input,{target:{value:'2026-09-06'}});
  fireEvent.click(screen.getByRole('button',{name:'날짜 적용'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'날짜 적용'})).not.toBeDisabled());
  expect(input).toHaveValue('2026-09-06');expect(apply).toHaveBeenCalledOnce();
  view.rerender(<VoucherDateChip value="2026-10-10" onApply={apply} />);
  expect(input).toHaveValue('2026-10-10');
  expect(screen.queryByRole('button',{name:'날짜 적용'})).not.toBeInTheDocument();
});

it('저장 대기 중 갱신된 외부 날짜를 늦은 완료가 이전 날짜로 되돌리지 않는다', async () => {
  const pending=deferred(),apply=vi.fn(()=>pending.promise);
  const view=render(<VoucherDateChip value="2026-10-06" onApply={apply} />);
  fireEvent.change(screen.getByLabelText('전표일자'),{target:{value:'2026-09-06'}});
  fireEvent.click(screen.getByRole('button',{name:'날짜 적용'}));
  view.rerender(<VoucherDateChip value="2026-09-06" onApply={apply} />);
  await act(async()=>pending.resolve());
  expect(screen.getByLabelText('전표일자')).toHaveValue('2026-09-06');
  expect(screen.queryByRole('button',{name:'날짜 적용'})).not.toBeInTheDocument();
  expect(apply).toHaveBeenCalledOnce();
});


it('실패 요청 삭제 후 같은 작업의 입력을 유지하고 새 요청으로 저장한다',async()=>{
 const apply=vi.fn().mockRejectedValueOnce(Error('응답 유실')).mockResolvedValue('applied');setup(undefined,undefined,{composerOnly:true,onApplyStatement:apply,pendingInvoice:{...pendingInvoice,poIds:['deleted-po']}});
 fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(apply).toHaveBeenCalledOnce());const key=pendingKey(),oldId=apply.mock.calls[0][0].statement.id;
 recoveryMocks.delete.mockImplementationOnce(async()=>{localStorage.removeItem(key);return {outcome:'rewrite',reason:'미발행 요청 취소와 사본 삭제 완료'};});
 fireEvent.click(await recoveryAction('실패 요청 삭제'));await waitFor(()=>expect(recoveryMocks.delete).toHaveBeenCalledOnce());
 expect(localStorage.getItem(key)).toBeNull();expect(screen.getByLabelText('1행 거래 수량')).toHaveValue('1');expect(screen.getByLabelText('1행 거래 수량')).not.toBeDisabled();
 expect(screen.queryByRole('button',{name:/휴지통|복원/})).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(apply).toHaveBeenCalledTimes(2));expect(apply.mock.calls[1][0].statement.id).not.toBe(oldId);expect(apply.mock.calls[1][0].poIds).toEqual(['deleted-po']);
});
it('손상 사본 삭제 확인을 취소하면 서버 요청 없이 원문을 보존한다',async()=>{
 const key='trade-statement-issue:taebaek:test-uid';localStorage.setItem(key,'손상 원문');setup(undefined,undefined,{composerOnly:true});vi.mocked(appConfirm).mockResolvedValueOnce(false);
 fireEvent.click(await recoveryAction('실패 요청 삭제'));await waitFor(()=>expect(appConfirm).toHaveBeenCalled());expect(recoveryMocks.delete).not.toHaveBeenCalled();expect(localStorage.getItem(key)).toBe('손상 원문');
});
it('손상 사본도 사용자 확인 후 삭제하고 현재 입력을 유지한다',async()=>{
 const key='trade-statement-issue:taebaek:test-uid';localStorage.setItem(key,'손상 원문');setup(undefined,undefined,{composerOnly:true});fireEvent.change(screen.getByLabelText('1행 거래 수량'),{target:{value:'3'}});
 recoveryMocks.delete.mockImplementationOnce(async()=>{localStorage.removeItem(key);return {outcome:'rewrite',reason:'식별 불가 사본 삭제'};});fireEvent.click(await recoveryAction('실패 요청 삭제'));await waitFor(()=>expect(localStorage.getItem(key)).toBeNull());expect(screen.getByLabelText('1행 거래 수량')).toHaveValue('3');expect(screen.getByLabelText('1행 거래 수량')).not.toBeDisabled();
});
it('이미 발행된 요청을 삭제하면 새 발행 없이 기존 전표를 보여준다',async()=>{
 const request=lowerOnlyFixture();recoveryMocks.delete.mockImplementationOnce(async()=>{localStorage.removeItem(lowerKey);return {outcome:'applied',statement:request.statement,reason:'기존 발행 확인'};});const apply=vi.fn();setup(undefined,undefined,{composerOnly:true,onApplyStatement:apply});fireEvent.click(await recoveryAction('실패 요청 삭제'));await waitFor(()=>expect(screen.queryByRole('dialog',{name:'실패 작업 상세'})).not.toBeInTheDocument());expect(apply).not.toHaveBeenCalled();expect(screen.queryByRole('dialog',{name:'실패 작업 상세'})).not.toBeInTheDocument();
});
it('삭제 중 사용자가 바뀌면 늦은 결과로 입력을 닫거나 변경하지 않는다',async()=>{
 lowerOnlyFixture();let resolve!:(value:unknown)=>void;recoveryMocks.delete.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));const props={orders:[],allItems:[item],partners:[partner],partnerItems:[price],issuedStatements:[],pendingInvoice,composerOnly:true};const view=render(<TradeStatement {...companyReadyFixture} {...props}/>);fireEvent.click(await recoveryAction('실패 요청 삭제'));await waitFor(()=>expect(recoveryMocks.delete).toHaveBeenCalled());(auth.currentUser as {uid:string}).uid='other-uid';view.rerender(<TradeStatement {...companyReadyFixture} {...props}/>);await act(async()=>resolve({outcome:'rewrite',reason:'늦은 삭제'}));expect(screen.getByRole('dialog',{name:'매입 전표 작성'})).toBeInTheDocument();expect(screen.queryByText('늦은 삭제')).not.toBeInTheDocument();
});
it('사본 삭제 뒤 별도로 남은 결제 항목은 전표 재발행과 재삭제 대신 결제 확인만 제공한다',async()=>{
 const request=lowerOnlyFixture(),paymentKey='partner-payment-pending:taebaek:partner:test-uid',paymentText=JSON.stringify({version:2,request:{operationId:'pay-only',amount:10,cashAccountId:'old-bank',tradeDate:'2026-10-15'}});localStorage.setItem(paymentKey,paymentText);
 const service=await import('../src/features/statements/infrastructure/tradeStatementRecoveryService');const entry=service.listTradeStatementRecoveryEntries({companyId:'taebaek',actorUid:'test-uid'})[0];localStorage.removeItem(lowerKey);
 localStorage.setItem('trade-statement-payment-recovery:taebaek:test-uid:pay-only',JSON.stringify({...entry,pending:null,paymentCopy:{key:paymentKey,text:paymentText},paymentRequestText:JSON.stringify({operationId:'pay-only',amount:10,cashAccountId:'old-bank',tradeDate:'2026-10-15'}),paymentRequired:true,paymentOnly:true}));
 setup(undefined,undefined,{composerOnly:true});fireEvent.click(screen.getByRole('button',{name:'실패 1'}));const paymentList=await screen.findByRole('dialog',{name:'실패 작업 목록'});expect(within(paymentList).getByText('수금·지불 확인 · 진단 거래처 · 2026-10-15 · 10원')).toBeInTheDocument();expect(within(paymentList).queryByText(/6,600원/)).not.toBeInTheDocument();await recoveryAction('처리결과 확인');expect(screen.queryByText(/원래 결제 요청을 재개해 주세요/)).not.toBeInTheDocument();expect(screen.getByText(/전표 실패 사본은 삭제됐습니다/)).toBeInTheDocument();expect(screen.queryByRole('button',{name:'같은 내용 다시 시도'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'실패 요청 삭제'})).not.toBeInTheDocument();expect(localStorage.getItem(paymentKey)).toBe(paymentText);
});
it('작성창이 없을 때 삭제가 확정되면 검증된 원작성 품목으로 새 작성창을 연다',async()=>{
 const first=render(<TradeStatement {...companyReadyFixture} orders={[]} allItems={[item]} partners={[partner]} partnerItems={[price]} issuedStatements={[]} pendingInvoice={pendingInvoice} composerOnly onApplyStatement={vi.fn().mockRejectedValue(Error('응답 유실'))}/>);fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(listTradePendings('taebaek','test-uid')).toHaveLength(1));const entry=listTradePendings('taebaek','test-uid')[0];first.unmount();
 recoveryMocks.delete.mockImplementationOnce(async()=>{localStorage.removeItem(entry.key);return {outcome:'rewrite',pending:entry.pending,reason:'취소 후 삭제'};});setup(undefined,undefined,{pendingInvoice:null});fireEvent.click(await recoveryAction('실패 요청 삭제'));await screen.findByRole('dialog',{name:'매입 전표 작성'});expect(screen.getByLabelText('1행 거래 수량')).toHaveValue('1');expect(screen.getByLabelText('전표일자')).toHaveValue(entry.pending!.input.statement.tradeDate);
});
it('최초 송신 사본만 있어도 삭제 확정 후 읽을 수 있는 원품목으로 새 작성한다',async()=>{
 const request=lowerOnlyFixture();recoveryMocks.delete.mockImplementationOnce(async()=>{localStorage.removeItem(lowerKey);return {outcome:'rewrite',reason:'취소 후 삭제'};});setup(undefined,undefined,{pendingInvoice:null});fireEvent.click(await recoveryAction('실패 요청 삭제'));await screen.findByRole('dialog',{name:'매입 전표 작성'});expect(screen.getByLabelText('1행 거래 수량')).toHaveValue('1');expect(screen.getByLabelText('전표일자')).toHaveValue(request.statement.tradeDate);
});
it('취소된 전표의 결제 결과가 확정되면 결제 요청 정리 이름을 제공한다',async()=>{
 const request=lowerOnlyFixture(),paymentKey='partner-payment-pending:taebaek:partner:test-uid',paymentText=JSON.stringify({version:2,request:{operationId:'pay-only',amount:10,cashAccountId:'old-bank',tradeDate:'2026-10-15'}});localStorage.setItem(paymentKey,paymentText);
 const service=await import('../src/features/statements/infrastructure/tradeStatementRecoveryService'),entry=service.listTradeStatementRecoveryEntries({companyId:'taebaek',actorUid:'test-uid'})[0];localStorage.removeItem(lowerKey);localStorage.setItem('trade-statement-payment-recovery:taebaek:test-uid:pay-only',JSON.stringify({...entry,pending:null,paymentCopy:{key:paymentKey,text:paymentText},paymentRequestText:'{}',paymentOnly:true}));
 recoveryMocks.inspect.mockResolvedValueOnce({status:'cancelled',reason:'전표 취소 완료',currentStatement:'unverified',payment:{status:'rejected',reason:'결제 미반영 확인'}});setup(undefined,undefined,{composerOnly:true});fireEvent.click(await recoveryAction('처리결과 확인'));expect(await screen.findByRole('button',{name:'확인된 결제 요청 정리'})).toBeEnabled();
});
it('전표 취소와 별개로 결제 미확인 상태는 정리나 새 발행을 안내하지 않는다',async()=>{
 const request=lowerOnlyFixture(),paymentKey='partner-payment-pending:taebaek:partner:test-uid',paymentText=JSON.stringify({version:2,request:{operationId:'pay-only',amount:10,cashAccountId:'old-bank',tradeDate:'2026-10-15'}});localStorage.setItem(paymentKey,paymentText);
 const service=await import('../src/features/statements/infrastructure/tradeStatementRecoveryService'),entry=service.listTradeStatementRecoveryEntries({companyId:'taebaek',actorUid:'test-uid'})[0];localStorage.removeItem(lowerKey);localStorage.setItem('trade-statement-payment-recovery:taebaek:test-uid:pay-only',JSON.stringify({...entry,pending:null,paymentCopy:{key:paymentKey,text:paymentText},paymentRequestText:'{}',paymentOnly:true}));
 recoveryMocks.inspect.mockResolvedValueOnce({status:'cancelled',reason:'전표 취소 완료',currentStatement:'unverified',serverRequestText:JSON.stringify(request),payment:{status:'unknown',reason:'결제 확인 필요'}});setup(undefined,undefined,{composerOnly:true});fireEvent.click(await recoveryAction('처리결과 확인'));await screen.findByText(/결제 결과는 아직 확인되지 않았습니다/);expect(screen.queryByRole('button',{name:'확인된 결제 요청 정리'})).not.toBeInTheDocument();expect(screen.queryByText(/작성 중인 입력을 수정해 저장/)).not.toBeInTheDocument();expect(screen.queryByText('서버에 남은 첫 저장 시도 내용')).not.toBeInTheDocument();expect(recoveryMocks.clear).not.toHaveBeenCalled();expect(localStorage.getItem(paymentKey)).toBe(paymentText);
});
it.each(['company','uid'])('복구에서 연 발행 상세는 %s 변경 시 닫힌다',async scope=>{
 const apply=vi.fn().mockRejectedValue(new Error('응답 유실'));const first=render(<TradeStatement {...companyReadyFixture} orders={[]} allItems={[item]} partners={[partner]} partnerItems={[price]} issuedStatements={[]} pendingInvoice={pendingInvoice} onApplyStatement={apply} composerOnly/>);fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(apply).toHaveBeenCalledOnce());const p=JSON.parse(localStorage.getItem(pendingKey())!);p.input.command.orderIds=['order-A'];localStorage.setItem(pendingKey(),JSON.stringify(p));first.unmount();
 const props={orders:[],allItems:[item],partners:[partner],partnerItems:[price],issuedStatements:[{...p.input.statement,id:'actual-other',orderId:'order-A',docNo:'261013-001'}],onApplyStatement:apply};const view=render(<TradeStatement {...companyReadyFixture} {...props}/>);await recoveryAction('같은 내용 다시 시도');fireEvent.click(screen.getByRole('button',{name:'발행된 전표 보기 · 261013-001'}));expect(screen.getAllByText('261013-001').length).toBeGreaterThan(0);
 if(scope==='uid')(auth.currentUser as {uid:string}).uid='other-uid';view.rerender(<TradeStatement {...companyReadyFixture} {...props} companyId={scope==='company'?'punghoe':'taebaek'}/>);expect(screen.queryByRole('button',{name:'✕'})).not.toBeInTheDocument();expect(screen.queryByRole('dialog',{name:'실패 작업 상세'})).not.toBeInTheDocument();
});

it('외부 상세 ID의 최초 열기는 회사 초기화 뒤에도 유지한다',async()=>{
 const stmt={id:'external',companyId:'taebaek',partnerId:partner.id,partnerName:partner.name,type:'매입',tradeDate:'2026-10-13',docNo:'261013-001',items:[{name:item.name,spec:item.spec,qty:1,price:6000,supply:6000,tax:600,total:6600,isTaxExempt:false}],totalAmount:6600} as IssuedStatement;setup(undefined,undefined,{pendingInvoice:null,issuedStatements:[stmt],detailStatementId:stmt.id});expect(await screen.findByRole('dialog',{name:'매입 전표 수정'})).toBeInTheDocument();
});

it('실패 작업이 없어도 메뉴에서 빈 목록을 확인한다',async()=>{
 setup(undefined,undefined,{pendingInvoice:null});fireEvent.click(screen.getByRole('button',{name:'처리 기록'}));expect(await screen.findByText('확인할 전표 발행·수금·지불 요청이 없습니다.')).toBeInTheDocument();
});
it('실패 진입은 전표내역과 별도 보조줄에 두고 짧은 명칭으로 개수를 표시한다',()=>{
 setup(undefined,undefined,{pendingInvoice:null});
 const recovery=screen.getByRole('button',{name:'처리 기록'});
 expect(recovery.parentElement).toHaveClass('w-full','border-t');
 expect(recovery.parentElement).not.toBe(screen.getByRole('button',{name:'전표내역'}).parentElement);
 expect(screen.queryByRole('button',{name:'실패 작업 0'})).not.toBeInTheDocument();
});

it('보관 요청 상세 탐색과 완료 재시도는 새 작성 수량을 보존한다',async()=>{
 const apply=vi.fn().mockRejectedValueOnce(new Error('응답 유실')).mockResolvedValue('duplicate');setup(undefined,undefined,{composerOnly:true,onApplyStatement:apply});fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(apply).toHaveBeenCalledOnce());const original=apply.mock.calls[0][0];
 await archiveCurrentRequest();await screen.findByRole('dialog',{name:'실패 작업 목록'});returnToComposer();fireEvent.change(screen.getByLabelText('1행 거래 수량'),{target:{value:'2'}});
 fireEvent.click(await recoveryAction('같은 내용 다시 시도'));await waitFor(()=>expect(apply).toHaveBeenCalledTimes(2));await screen.findByRole('dialog',{name:'실패 작업 목록'});returnToComposer();expect(screen.getByLabelText('1행 거래 수량')).toHaveValue('2');expect(apply.mock.calls[1][0]).toEqual(original);expect(screen.getByRole('dialog',{name:'매입 전표 작성'})).toBeInTheDocument();
});

it('상세 선택 원문이 다른 창에서 바뀌면 재시도 없이 원문 확인을 안내한다',async()=>{
 const apply=vi.fn().mockRejectedValue(new Error('응답 유실'));setup(undefined,undefined,{composerOnly:true,onApplyStatement:apply});fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(apply).toHaveBeenCalledOnce());await recoveryAction('같은 내용 다시 시도');const key=pendingKey();localStorage.setItem(key,'다른 창 원문');fireEvent(window,new StorageEvent('storage',{key,newValue:'다른 창 원문'}));
 expect(screen.queryByRole('button',{name:'같은 내용 다시 시도'})).not.toBeInTheDocument();expect(screen.getByText(/다른 창에서 요청이 변경되었거나/)).toBeInTheDocument();expect(localStorage.getItem(key)).toBe('다른 창 원문');expect(apply).toHaveBeenCalledOnce();
});

it('보관한 미확인 A와 무관한 B는 새로 저장하며 A 원문도 다시 확인할 수 있다',async()=>{
 const apply=vi.fn().mockRejectedValueOnce(new Error('응답 유실')).mockResolvedValue('duplicate');
 const first=render(<TradeStatement {...companyReadyFixture} orders={[]} allItems={[item]} partners={[partner]} partnerItems={[price]} issuedStatements={[]} pendingInvoice={{...pendingInvoice,poIds:['po-A']}} onApplyStatement={apply} composerOnly/>);
 fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(apply).toHaveBeenCalledOnce());
 const original=apply.mock.calls[0][0],key=pendingKey(),text=localStorage.getItem(key);
 await archiveCurrentRequest();await waitFor(()=>expect(screen.getByRole('dialog',{name:'실패 작업 목록'})).toBeInTheDocument());returnToComposer();expect(screen.getByLabelText('1행 거래 수량')).not.toBeDisabled();
 expect(localStorage.getItem(key)).toBe(text);first.unmount();
 setup(undefined,undefined,{composerOnly:true,pendingInvoice:{...pendingInvoice,poIds:['po-B']},onApplyStatement:apply});
 expect(screen.getByLabelText('1행 거래 수량')).not.toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'저장'}));
 await waitFor(()=>expect(apply).toHaveBeenCalledTimes(2));expect(apply.mock.calls[1][0].command.statementId).not.toBe(original.command.statementId);expect(apply.mock.calls[1][0].poIds).toEqual(['po-B']);expect(localStorage.getItem(key)).toBe(text);
 expect(screen.queryByText('처리 결과를 아직 확인하지 못한 요청입니다. 이전 내용을 보관하고 다른 전표를 작성할 수 있습니다.')).not.toBeInTheDocument();
 fireEvent.click(await recoveryAction('같은 내용 다시 시도'));await waitFor(()=>expect(apply).toHaveBeenCalledTimes(3));expect(apply.mock.calls[2][0]).toEqual(original);
});

it('보관한 A와 같은 발주 B는 원문과 저장 횟수를 유지하고 어떤 요청인지 안내한다',async()=>{
 const apply=vi.fn().mockRejectedValue(new Error('응답 유실'));
 const first=render(<TradeStatement {...companyReadyFixture} orders={[]} allItems={[item]} partners={[partner]} partnerItems={[price]} issuedStatements={[]} pendingInvoice={{...pendingInvoice,poIds:['po-A']}} onApplyStatement={apply} composerOnly/>);
 fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(apply).toHaveBeenCalledOnce());const key=pendingKey(),text=localStorage.getItem(key);
 await archiveCurrentRequest();await waitFor(()=>expect(screen.getByRole('dialog',{name:'실패 작업 목록'})).toBeInTheDocument());returnToComposer();expect(screen.getByLabelText('1행 거래 수량')).not.toBeDisabled();first.unmount();
 setup(undefined,undefined,{composerOnly:true,pendingInvoice:{...pendingInvoice,poIds:['po-A']},onApplyStatement:apply});fireEvent.click(screen.getByRole('button',{name:'저장'}));
 await waitFor(()=>expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('같은 주문·발주의 미확인 전표')));expect(apply).toHaveBeenCalledOnce();expect(localStorage.getItem(key)).toBe(text);expect(screen.getByRole('button',{name:'같은 내용 다시 시도'})).toBeEnabled();
});

it('동일 주문의 다른 발행 전표는 보기만 안내하고 미확인 원문을 완료로 삭제하지 않는다',async()=>{
 const apply=vi.fn().mockRejectedValue(new Error('응답 유실'));
 const first=render(<TradeStatement {...companyReadyFixture} orders={[]} allItems={[item]} partners={[partner]} partnerItems={[price]} issuedStatements={[]} pendingInvoice={pendingInvoice} onApplyStatement={apply} composerOnly/>);
 fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(apply).toHaveBeenCalledOnce());const key=pendingKey(),p=JSON.parse(localStorage.getItem(key)!);p.input.command.orderIds=['order-A'];const text=JSON.stringify(p);localStorage.setItem(key,text);first.unmount();
 setup(undefined,undefined,{pendingInvoice:null,issuedStatements:[{...p.input.statement,id:'actual-other',orderId:'order-A',docNo:'261013-001'}],onApplyStatement:apply});
 await recoveryAction('같은 내용 다시 시도');expect(screen.getByText(/관련 주문은 이미 다른 전표로 발행되어 있습니다/)).toBeInTheDocument();expect(screen.getByRole('button',{name:'발행된 전표 보기 · 261013-001'})).toBeEnabled();expect(localStorage.getItem(key)).toBe(text);expect(apply).toHaveBeenCalledOnce();
});

it('서버 취소가 불가능하면 원문과 작성 화면을 유지하고 구체적인 복구 이유를 보인다',async()=>{
 const apply=vi.fn().mockRejectedValue(new Error('응답 유실'));setup(undefined,undefined,{composerOnly:true,onApplyStatement:apply});fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(apply).toHaveBeenCalledOnce());const key=pendingKey(),text=localStorage.getItem(key);
 recoveryMocks.delete.mockRejectedValueOnce(Error('서버의 이전 저장 경로 확인이 끝나지 않아 취소하지 못했습니다. 처리결과 확인을 다시 눌러 주세요.'));
 fireEvent.click(await recoveryAction('실패 요청 삭제'));await screen.findByText(/서버의 이전 저장 경로 확인이 끝나지 않아/);returnToComposer();expect(screen.getByRole('dialog',{name:'매입 전표 작성'})).toBeInTheDocument();expect(localStorage.getItem(key)).toBe(text);expect(screen.getByLabelText('1행 거래 수량')).toBeDisabled();
});

it('응답 유실 뒤 다시 열면 이전 주요 발행 원문을 재시도한다', async () => {
  const apply=vi.fn().mockRejectedValueOnce(new Error('응답 유실')).mockResolvedValue('duplicate');
  const first=render(<TradeStatement {...companyReadyFixture} orders={[]} allItems={[item]} partners={[partner]} partnerItems={[price]} issuedStatements={[]} pendingInvoice={{...pendingInvoice,poIds:['po-original']}} onApplyStatement={apply} composerOnly/>);
  fireEvent.click(screen.getByRole('button',{name:'저장'}));
  await waitFor(()=>expect(apply).toHaveBeenCalledOnce());
  const original=apply.mock.calls[0][0];
  returnToComposer();const close=screen.getByRole('button',{name:'매입 전표 작성 닫기'});await waitFor(()=>expect(close).not.toBeDisabled());fireEvent.click(close);
  expect(screen.queryByRole('dialog',{name:'매입 전표 작성'})).not.toBeInTheDocument();
  first.unmount();
  setup(undefined,undefined,{pendingInvoice:null,composerOnly:true,onApplyStatement:apply});
  fireEvent.click(await recoveryAction('같은 내용 다시 시도'));
  await waitFor(()=>expect(apply).toHaveBeenCalledTimes(2));
  expect(apply.mock.calls[1][0]).toEqual(original);
});


it('전표 발행 뒤 지급 응답 유실도 재열기에서 같은 전표와 지급 원문으로 재시도한다',async()=>{
 const apply=vi.fn().mockResolvedValue('duplicate');issueMocks.payment.mockRejectedValueOnce(new Error('지급 응답 유실')).mockResolvedValue(undefined);
 const accounts=[{id:'bank',companyId:'taebaek' as const,name:'은행',type:'통장' as const,active:true,openingBalance:0,openingDate:'2026-01-01',createdAt:''}];
 const view=render(<TradeStatement {...companyReadyFixture} orders={[]} allItems={[item]} partners={[partner]} partnerItems={[price]} issuedStatements={[]} pendingInvoice={pendingInvoice} onApplyStatement={apply} composerOnly cashAccounts={accounts}/>);
 fireEvent.click(screen.getByLabelText('지불도 함께'));fireEvent.click(screen.getByRole('button',{name:'저장'}));
 await waitFor(()=>expect(issueMocks.payment).toHaveBeenCalledOnce());const original=issueMocks.payment.mock.calls[0];const body=apply.mock.calls[0][0];view.unmount();
 setup(undefined,undefined,{pendingInvoice:null,composerOnly:true,onApplyStatement:apply,cashAccounts:accounts});
 fireEvent.click(await recoveryAction('같은 내용 다시 시도'));await waitFor(()=>expect(issueMocks.payment).toHaveBeenCalledTimes(2));
 expect(apply.mock.calls[1][0]).toEqual(body);expect(issueMocks.payment.mock.calls[1]).toEqual(original);
 await waitFor(()=>expect(screen.queryByRole('button',{name:'같은 내용 다시 시도'})).not.toBeInTheDocument());
});


it('최초 발행 늦은 완료는 다른 창의 저장 원문을 지우지 않는다',async()=>{
 const gate=deferred();const apply=vi.fn(async()=>{await gate.promise;return 'applied' as const;});
 setup(undefined,undefined,{composerOnly:true,onApplyStatement:apply,pendingInvoice:{...pendingInvoice,poIds:['po-original']}});
 fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(apply).toHaveBeenCalledOnce());
 const key=pendingKey(),first=JSON.parse(localStorage.getItem(key)!);
 const other={...first,input:{...first.input,command:{...first.input.command,operationId:'other-operation',statementId:'other-statement'},statement:{...first.input.statement,id:'other-statement'}}};
 const encoded=JSON.stringify(other);localStorage.setItem(key,encoded);
 await act(async()=>{gate.resolve();await gate.promise;});await waitFor(()=>expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('발행은 완료됐습니다. 전표 요청 사본 정리')));
 expect(screen.getByRole('dialog',{name:'매입 전표 작성'})).toBeInTheDocument();
 expect(localStorage.getItem(key)).toBe(encoded);
});


it('최초 명확한 송신 전 거절만 원문 대기를 해제해 입력 수정을 허용한다',async()=>{
 const apply=vi.fn(async(input:{command:{operationId:string}})=>{throw Object.assign(new Error('송신 전 회사 확인 실패'),{details:{operationStatus:'rejected',version:1,financialWrites:false,companyId:'taebaek',operationId:input.command.operationId}});});
 setup(undefined,undefined,{composerOnly:true,onApplyStatement:apply});fireEvent.click(screen.getByRole('button',{name:'저장'}));
 await waitFor(()=>expect(apply).toHaveBeenCalledOnce());await waitFor(()=>expect(screen.queryByRole('button',{name:'같은 내용 다시 시도'})).not.toBeInTheDocument());
 expect(localStorage.getItem(pendingKey())).toBeNull();returnToComposer();expect(screen.getByRole('button',{name:'저장'})).not.toBeDisabled();
});

it.each(['exact','v1','other','changed-tab'])('응답 유실 재시도 %s 거절은 검증된 원문만 입력 수정 가능하다',async kind=>{
 const apply=vi.fn().mockRejectedValueOnce(new Error('응답 유실'));
 setup(undefined,undefined,{composerOnly:true,onApplyStatement:apply});fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(apply).toHaveBeenCalledOnce());
 const key=pendingKey(),first=localStorage.getItem(key)!;
 apply.mockImplementationOnce(async draft=>{
  const request={operationId:draft.command.operationId,statement:{...draft.statement,createdBy:'관리자'},orderIds:draft.command.orderIds,poIds:draft.poIds,
   costUpdates:draft.costUpdates.map((c:{beforeCost?:number;sourceLineIndex?:number})=>({...c,beforeCost:c.beforeCost??0,sourceLineIndex:c.sourceLineIndex??-1})),
   ...(draft.newPoItems.length?{newPo:{items:draft.newPoItems}}:{})};
  const requestText=JSON.stringify(request),error=Object.assign(new Error('확정 업무거절'),{details:{version:kind==='v1'?1:2,operationStatus:'rejected',financialWrites:false,companyId:'taebaek',actorId:'test-uid',operationId:request.operationId,statementId:request.statement.id,requestText,requestHash:createHash('sha256').update(requestText).digest('hex'),receiptRevision:1}});
  if(kind==='other')request.statement={...request.statement,totalAmount:request.statement.totalAmount+1};
  if(kind!=='v1')await verifyTradeServerRejection(error,request,requestText,'taebaek','test-uid');
  if(kind==='changed-tab')localStorage.setItem(key,'다른 창 원문');throw error;
 });
 fireEvent.click(await recoveryAction('같은 내용 다시 시도'));await waitFor(()=>expect(apply).toHaveBeenCalledTimes(2));
 if(kind==='exact'){await waitFor(()=>expect(screen.queryByRole('button',{name:'같은 내용 다시 시도'})).not.toBeInTheDocument());expect(localStorage.getItem(key)).toBeNull();returnToComposer();expect(screen.getByRole('button',{name:'저장'})).not.toBeDisabled();}
 else{if(kind==='changed-tab')await screen.findByText(/다른 창에서 요청이 변경되었거나 원문을 읽을 수 없습니다/);else await waitFor(()=>expect(screen.getByRole('button',{name:'같은 내용 다시 시도'})).not.toBeDisabled());expect(localStorage.getItem(key)).toBe(kind==='changed-tab'?'다른 창 원문':first);}
});

it('신규 원료 매입은20kg직접입력/수량2로 입고40kg·과세원가2000을 저장하고 unknown 재열기에도 원문을 보존한다', async () => {
 const raw: Item = {...item,id:'raw-20kg',name:'원료 20kg포',spec:'20kg',type:'raw',subtype:'벌크',unit:'포',cost:80};
 const rawPrice: PartnerItem = {...price,id:'raw-price',itemId:raw.id,price:44000};
 const callback = vi.fn<NonNullable<React.ComponentProps<typeof TradeStatement>['onApplyStatement']>>()
   .mockRejectedValueOnce(new Error('응답 유실')).mockResolvedValueOnce('duplicate');
 const props={orders:[],allItems:[raw],partners:[partner],partnerItems:[rawPrice],issuedStatements:[],composerOnly:true,
 pendingInvoice:{partnerId:partner.id,partnerName:partner.name,items:[{itemId:raw.id,name:raw.name,spec:raw.spec!,qty:2,price:44000}]},onApplyStatement:callback};
 const view=render(<TradeStatement {...companyReadyFixture} {...props}/>);
 fireEvent.change(await screen.findByLabelText('1행 매입단위 숫자'),{target:{value:'20'}});
 expect(screen.queryByText(/^거래 수량 \(/)).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(callback).toHaveBeenCalledOnce());
 const sent=structuredClone(callback.mock.calls[0][0]);
 expect(sent.statement.items[0]).toMatchObject({qty:2,price:44000,supply:80000,total:88000,purchaseUnitId:'manual-kg',purchaseUnit:'20kg',purchaseQty:2,unitKg:20,inventoryQty:40});
 expect(sent.costUpdates).toEqual([{itemId:raw.id,price:2000,beforeCost:80,sourceLineIndex:0}]);
 expect(sent.newPoItems[0]).toMatchObject({quantity:2,unit:'20kg',purchaseUnitId:'manual-kg',unitKg:20,inventoryQty:40});
 view.unmount();render(<TradeStatement {...companyReadyFixture} {...props}/>);
 fireEvent.click(await recoveryAction('같은 내용 다시 시도'));await waitFor(()=>expect(callback).toHaveBeenCalledTimes(2));
 expect(callback.mock.calls[1][0]).toEqual(sent);
});


it('신규 벌크 매입의 기본kg는 snapshot을 저장하고 면세단가44000을kg원가로 사용한다', async () => {
 const raw: Item = {...item,id:'raw-unknown-kg',name:'원료 20kg포',spec:'20kg',type:'raw',subtype:'벌크',unit:'포',cost:80};
 const rawPrice:PartnerItem={...price,itemId:raw.id,price:44000,taxType:'면세'};
 const apply=vi.fn<NonNullable<React.ComponentProps<typeof TradeStatement>['onApplyStatement']>>().mockResolvedValue('applied');
 const updateCost=vi.fn(),upsertPrice=vi.fn().mockResolvedValue({status:'saved'});
 render(<TradeStatement {...companyReadyFixture} orders={[]} allItems={[raw]} partners={[partner]} partnerItems={[rawPrice]} issuedStatements={[]}
   pendingInvoice={{partnerId:partner.id,partnerName:partner.name,items:[{itemId:raw.id,name:raw.name,spec:raw.spec!,qty:2,price:44000}]}} onApplyStatement={apply} onUpdateItemCost={updateCost} onSavePartnerItemTerms={upsertPrice} composerOnly/>);
 expect(await screen.findByLabelText('1행 매입단위 숫자')).toHaveValue('1');expect(screen.queryByLabelText('1행 원가 기준 수량 kg')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'저장'}));
 await waitFor(()=>expect(apply).toHaveBeenCalledOnce());
 const sent=apply.mock.calls[0][0];
 expect(sent.costUpdates).toEqual([{itemId:raw.id,price:44000,beforeCost:80,sourceLineIndex:0}]);
 expect(sent.statement.items[0]).toMatchObject({qty:2,price:44000,supply:88000,total:88000,purchaseUnitId:'manual-kg',purchaseUnit:'kg',unitKg:1,inventoryQty:2});
 expect(sent.statement.items[0].purchaseQuantityKg).toBeUndefined();
 expect(sent.newPoItems[0]).toMatchObject({quantity:2,unit:'kg',purchaseUnitId:'manual-kg',unitKg:1,inventoryQty:2});
 await waitFor(()=>expect(upsertPrice).toHaveBeenCalled());expect(upsertPrice.mock.calls[0][0].terms.price).toBe(44000);
 expect(updateCost).toHaveBeenCalledWith(raw.id,44000);
});

it('실제매입20kg·수량2·면세44000 단가는 입고40kg와kg원가2200을 같은전표에 보존한다',async()=>{
 const raw={...item,id:'manual-raw',name:'들깨',type:'raw',subtype:'벌크',unit:'포',cost:80} as Item,apply=vi.fn().mockResolvedValue('applied');
 render(<TradeStatement {...companyReadyFixture} orders={[]} allItems={[raw]} partners={[partner]} partnerItems={[{...price,itemId:raw.id,price:44000,taxType:'면세'}]} issuedStatements={[]} composerOnly onApplyStatement={apply}
  pendingInvoice={{partnerId:partner.id,partnerName:partner.name,items:[{itemId:raw.id,name:raw.name,spec:'',qty:2,price:44000}]}}/>);
 fireEvent.change(await screen.findByLabelText('1행 매입단위 숫자'),{target:{value:'20'}});expect(screen.queryByText(/단위당/)).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(apply).toHaveBeenCalledOnce());
 const sent=apply.mock.calls[0][0];expect(sent.statement.items[0]).toMatchObject({qty:2,price:44000,supply:88000,tax:0,inventoryQty:40,purchaseUnit:'20kg'});expect(sent.statement.items[0].purchaseQuantityKg).toBeUndefined();expect(sent.costUpdates).toEqual([{itemId:raw.id,price:2200,beforeCost:80,sourceLineIndex:0}]);
});
it('실제숫자20에서단위만g로바꾸면숫자는20이며20g·수량2스냅샷.04kg를발행한다',async()=>{
 const raw={...item,id:'grams-raw',name:'소량들깨',type:'raw',subtype:'벌크',unit:'kg'} as Item,apply=vi.fn().mockResolvedValue('applied'),upsert=vi.fn().mockResolvedValue({status:'saved'});render(<TradeStatement {...companyReadyFixture} orders={[]} allItems={[raw]} partners={[partner]} partnerItems={[{...price,itemId:raw.id,price:44,taxType:'면세'}]} issuedStatements={[]} composerOnly onApplyStatement={apply} onSavePartnerItemTerms={upsert}
  pendingInvoice={{partnerId:partner.id,partnerName:partner.name,items:[{itemId:raw.id,name:raw.name,spec:'',qty:2,price:44}]}}/>);
 const amount=await screen.findByLabelText('1행 매입단위 숫자'),measure=screen.getByLabelText('1행 매입단위 단위');expect(amount).toHaveValue('1');expect(measure).toHaveValue('kg');fireEvent.change(amount,{target:{value:'20'}});fireEvent.change(measure,{target:{value:'g'}});expect(amount).toHaveValue('20');expect(measure).toHaveValue('g');for(const text of ['원료 매입 설정','단위당','금액은 거래 수량'])expect(screen.queryByText(text,{exact:false})).not.toBeInTheDocument();expect(screen.queryByText(/^거래 수량 \(/)).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(apply).toHaveBeenCalledOnce());expect(apply.mock.calls[0][0].statement.items[0]).toMatchObject({qty:2,price:44,purchaseUnit:'20g',unitKg:.02,inventoryQty:.04,total:88});expect(apply.mock.calls[0][0].costUpdates).toEqual([{itemId:raw.id,price:2200,beforeCost:0,sourceLineIndex:0}]);await waitFor(()=>expect(upsert).toHaveBeenCalledOnce());expect(upsert.mock.calls[0][0].terms.price).toBe(2200);
});
it('숫자빈값뒤단위g/거래수량3을바꿔도자동1로살아나지않고폼보존·저장거절',async()=>{
 const raw={...item,id:'blank-grams',name:'소량참깨',type:'raw',subtype:'벌크',unit:'kg'} as Item,apply=vi.fn();render(<TradeStatement {...companyReadyFixture} orders={[]} allItems={[raw]} partners={[partner]} partnerItems={[{...price,itemId:raw.id}]} issuedStatements={[]} composerOnly onApplyStatement={apply}
  pendingInvoice={{partnerId:partner.id,partnerName:partner.name,items:[{itemId:raw.id,name:raw.name,spec:'',qty:2,price:44}]}}/>);const amount=await screen.findByLabelText('1행 매입단위 숫자');fireEvent.change(amount,{target:{value:''}});fireEvent.change(screen.getByLabelText('1행 매입단위 단위'),{target:{value:'g'}});fireEvent.change(screen.getByLabelText('1행 거래 수량'),{target:{value:'3'}});expect(amount).toHaveValue('');expect(screen.getByLabelText('1행 매입단위 단위')).toHaveValue('g');fireEvent.click(screen.getByRole('button',{name:'저장'}));expect(apply).not.toHaveBeenCalled();expect(amount).toHaveValue('');
});
it.each(['','0','.'])('잘못된단위 %s는 실제저장콜백0·입력보존',async value=>{
 const raw={...item,id:'invalid-raw',name:'참깨',type:'raw',subtype:'벌크',unit:'kg'} as Item,apply=vi.fn();render(<TradeStatement {...companyReadyFixture} orders={[]} allItems={[raw]} partners={[partner]} partnerItems={[{...price,itemId:raw.id}]} issuedStatements={[]} composerOnly onApplyStatement={apply}
  pendingInvoice={{partnerId:partner.id,partnerName:partner.name,items:[{itemId:raw.id,name:raw.name,spec:'',qty:2,price:44000}]}}/>);
 const input=await screen.findByLabelText('1행 매입단위 숫자');fireEvent.change(input,{target:{value}});fireEvent.click(screen.getByRole('button',{name:'저장'}));expect(apply).not.toHaveBeenCalled();expect(input).toHaveValue(value);
});
it.each([['unit','0.0001'],['qty','0.0001'],['unit','9'.repeat(308)],['qty','9'.repeat(308)],['qty','Infinity']])('작은중량·overflow 실제 %s 입력은 순차편집중 폼을보존하고 저장만거절',async(field,value)=>{
 const raw={...item,id:'tiny-raw',name:'참깨',type:'raw',subtype:'벌크',unit:'kg'} as Item,apply=vi.fn();render(<TradeStatement {...companyReadyFixture} orders={[]} allItems={[raw]} partners={[partner]} partnerItems={[{...price,itemId:raw.id}]} issuedStatements={[]} composerOnly onApplyStatement={apply}
  pendingInvoice={{partnerId:partner.id,partnerName:partner.name,items:[{itemId:raw.id,name:raw.name,spec:'',qty:2,price:44000}]}}/>);
 const unit=await screen.findByLabelText('1행 매입단위 숫자'),qty=screen.getByLabelText('1행 거래 수량');if(field==='unit')fireEvent.change(qty,{target:{value:'1'}});else if(value.length>100)fireEvent.change(unit,{target:{value:'2'}});
 const input=field==='unit'?unit:qty;for(const partial of ['',value.slice(0,1),value.slice(0,3),value])expect(()=>fireEvent.change(input,{target:{value:partial}})).not.toThrow();expect(input).toHaveValue(value);expect(screen.getByRole('button',{name:'저장'})).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'저장'}));expect(apply).not.toHaveBeenCalled();expect(input).toHaveValue(value);
});

it('계정만 변경하면 직접입력 단위snapshot·거래수량을 유지한다',async()=>{
 const raw={...item,id:'account-raw',name:'들깨',type:'raw',subtype:'벌크',unit:'kg'} as Item,apply=vi.fn().mockResolvedValue('applied');
 render(<TradeStatement {...companyReadyFixture} orders={[]} allItems={[raw]} partners={[partner]} partnerItems={[{...price,itemId:raw.id,taxType:'면세',price:44000}]} accountCodes={[{id:'500',code:'500',name:'원재료비'},{id:'505',code:'505',name:'부재료비'}] as any} issuedStatements={[]} composerOnly onApplyStatement={apply}
  pendingInvoice={{partnerId:partner.id,partnerName:partner.name,items:[{itemId:raw.id,name:raw.name,spec:'',qty:2,price:44000}]}}/>);
 fireEvent.change(await screen.findByLabelText('1행 매입단위 숫자'),{target:{value:'20'}});const quantity=screen.getByLabelText('1행 거래 수량'),select=quantity.closest('tr')!.querySelector('select')!;fireEvent.change(select,{target:{value:'505'}});expect(screen.getByLabelText('1행 매입단위 숫자')).toHaveValue('20');expect(screen.queryByText(/단위당/)).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(apply).toHaveBeenCalledOnce());expect(apply.mock.calls[0][0].statement.items[0]).toMatchObject({qty:2,purchaseUnitId:'manual-kg',purchaseUnit:'20kg',purchaseQty:2,unitKg:20,inventoryQty:40,accountCode:'505'});
});

it('실제20kg발행은 거래처kg단가2200을 저장하고 다음 신규kg품목선택에2200을 넣는다',async()=>{
 const raw={...item,id:'next-raw',name:'다음들깨',type:'raw',subtype:'벌크',unit:'포',cost:80} as Item,apply=vi.fn().mockResolvedValue('applied'),upsert=vi.fn().mockResolvedValue({status:'saved'});
 const base={orders:[],allItems:[raw],partners:[partner],issuedStatements:[],composerOnly:true,onApplyStatement:apply,onSavePartnerItemTerms:upsert};
 const view=render(<TradeStatement {...companyReadyFixture} {...base} partnerItems={[{...price,itemId:raw.id,price:44000,taxType:'면세'}]}
  pendingInvoice={{partnerId:partner.id,partnerName:partner.name,items:[{itemId:raw.id,name:raw.name,spec:'',qty:2,price:44000}]}}/>);
 fireEvent.change(await screen.findByLabelText('1행 매입단위 숫자'),{target:{value:'20'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(upsert).toHaveBeenCalledOnce());const savedInput=upsert.mock.calls[0][0];expect(savedInput).toMatchObject({target:{itemId:raw.id},terms:{price:2200,taxType:'면세'}});const savedPartnerPrice={...price,itemId:raw.id,...savedInput.terms};expect(apply.mock.calls[0][0].statement.items[0]).toMatchObject({qty:2,price:44000,inventoryQty:40});view.unmount();
 render(<TradeStatement {...companyReadyFixture} {...base} partnerItems={[savedPartnerPrice]} pendingInvoice={{partnerId:partner.id,partnerName:partner.name,items:[{itemId:'',name:'',spec:'',qty:1,price:0}]}}/>);
 const search=await screen.findByPlaceholderText('제품명...');fireEvent.focus(search);fireEvent.change(search,{target:{value:raw.name}});fireEvent.mouseDown(await screen.findByText(raw.name));
 expect(screen.getByLabelText('1행 매입단위 숫자')).toHaveValue('1');const quantity=screen.getByLabelText('1행 거래 수량');expect(quantity).toHaveValue('1');expect(quantity.closest('tr')!.querySelector('td:nth-child(5) input')).toHaveValue('2200');fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(apply).toHaveBeenCalledTimes(2));expect(apply.mock.calls[1][0].statement.items[0]).toMatchObject({qty:1,price:2200,purchaseUnit:'kg',unitKg:1,inventoryQty:1});
});
it('실제같은원료 kg/20kg 혼합발행은거래처단가upsert0이며 원가합산만보존한다',async()=>{
 const raw={...item,id:'mixed-raw',name:'혼합들깨',type:'raw',subtype:'벌크',unit:'kg'} as Item,apply=vi.fn().mockResolvedValue('applied'),upsert=vi.fn().mockResolvedValue({status:'saved'});
 render(<TradeStatement {...companyReadyFixture} orders={[]} allItems={[raw]} partners={[partner]} partnerItems={[{...price,itemId:raw.id,price:44000,taxType:'면세'}]} issuedStatements={[]} composerOnly onApplyStatement={apply} onSavePartnerItemTerms={upsert}
  pendingInvoice={{partnerId:partner.id,partnerName:partner.name,items:[{itemId:raw.id,name:raw.name,spec:'',qty:2,price:44000},{itemId:raw.id,name:raw.name,spec:'',qty:2,price:44000}]}}/>);
 await screen.findByLabelText('1행 매입단위 숫자');fireEvent.change(screen.getByLabelText('2행 매입단위 숫자'),{target:{value:'20'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(apply).toHaveBeenCalledOnce());const sent=apply.mock.calls[0][0];expect(sent.statement.items.map((row:any)=>row.price)).toEqual([44000,44000]);expect(sent.statement.items.map((row:any)=>row.inventoryQty)).toEqual([2,40]);expect(sent.costUpdates).toEqual([{itemId:raw.id,price:4190,beforeCost:0,sourceLineIndex:0,sourceLineIndices:[0,1]}]);expect(upsert).not.toHaveBeenCalled();
});


it('입고 전표 상세 진입은 기존 매입 수정 모달을 보기로 열고 구형 규격은 표시만 보정한다', async () => {
 const statement: IssuedStatement = {id:'inbound-view',companyId:'taebaek',type:'매입',partnerId:partner.id,partnerName:'은하산업',tradeDate:'2026-10-10',issuedAt:'2026-10-10',docNo:'261010-001',orderId:'',totalSupply:40000,totalTax:4000,totalAmount:44000,
 items:[{itemId:item.id,name:'생들기름-캔',spec:'16.5kgml',qty:2,price:22000,supply:40000,tax:4000,total:44000,isTaxExempt:false,accountCode:'500'}]};
 const close=vi.fn(),composerClose=vi.fn();
 render(<TradeStatement {...companyReadyFixture} orders={[]} allItems={[item]} partners={[partner]} partnerItems={[price]} issuedStatements={[statement]} detailStatementId={statement.id} onDetailClose={close} onComposerClose={composerClose} composerOnly/>);
 const dialog=await screen.findByRole('dialog',{name:'매입 전표 수정'});
 expect(screen.queryByRole('dialog',{name:/발행 전표 상세/})).not.toBeInTheDocument();
 expect(within(dialog).getByText('16.5kg')).toBeInTheDocument();expect(statement.items[0].spec).toBe('16.5kgml');
 fireEvent.click(within(dialog).getByRole('button',{name:'수정'}));
 expect(within(dialog).getByDisplayValue('16.5kgml')).toHaveAttribute('placeholder','규격');
 fireEvent.click(within(dialog).getByRole('button',{name:'매입 전표 수정 닫기'}));
 expect(close).toHaveBeenCalledOnce();expect(composerClose).toHaveBeenCalledOnce();
});


it('외부 상세 선택 변경은 기존 composer에서 다른 전표로 바뀌고 닫힌 선택은 갱신 때 다시 열리지 않는다', async () => {
 const first: IssuedStatement={id:'detail-a',companyId:'taebaek',type:'매입',partnerId:partner.id,partnerName:partner.name,tradeDate:'2026-10-10',issuedAt:'2026-10-10',docNo:'A',orderId:'',items:[{name:'첫 품목',spec:'350ml',qty:1,price:100,supply:100,tax:0,total:100,isTaxExempt:true}],totalSupply:100,totalTax:0,totalAmount:100};
 const second={...first,id:'detail-b',docNo:'B',items:[{...first.items[0],name:'둘째 품목'}]};
 const close=vi.fn();const props={orders:[],allItems:[item],partners:[partner],partnerItems:[price],issuedStatements:[first,second],onDetailClose:close,composerOnly:true};
 const view=render(<TradeStatement {...companyReadyFixture} {...props} detailStatementId={first.id}/>);
 expect(await screen.findByText('첫 품목')).toBeInTheDocument();
 view.rerender(<TradeStatement {...companyReadyFixture} {...props} detailStatementId={second.id}/>);
 await waitFor(()=>expect(screen.getByText('둘째 품목')).toBeInTheDocument());
 fireEvent.click(screen.getByRole('button',{name:'매입 전표 수정 닫기'}));
 view.rerender(<TradeStatement {...companyReadyFixture} {...props} issuedStatements={[{...first}, {...second}]} detailStatementId={second.id}/>);
 expect(screen.queryByRole('dialog',{name:'매입 전표 수정'})).not.toBeInTheDocument();expect(close).toHaveBeenCalledOnce();
 view.rerender(<TradeStatement {...companyReadyFixture} {...props} companyId="punghoe" detailStatementId={first.id}/>);
 expect(screen.queryByRole('dialog',{name:'매입 전표 수정'})).not.toBeInTheDocument();
});
it('외부 noncash 적용 전표 상세는 일반 composer 수정으로 확대하지 않고 기존 적용 취소를 유지한다',async()=>{
 const statement: IssuedStatement={id:'noncash-view',companyId:'taebaek',type:'비용',partnerId:partner.id,partnerName:partner.name,tradeDate:'2026-10-10',issuedAt:'2026-10-10',docNo:'N',orderId:'',items:[],totalSupply:100,totalTax:0,totalAmount:100,
 noncashApplication:{kind:'advance-application',version:1,companyId:'taebaek',partnerId:partner.id,operationId:'apply',purpose:'합성',requestFingerprint:'hash',sourceFingerprints:{},targetFingerprints:{},allocations:[]}};
 const close=vi.fn();render(<TradeStatement {...companyReadyFixture} orders={[]} allItems={[]} partners={[partner]} partnerItems={[]} issuedStatements={[statement]} detailStatementId={statement.id} onDetailClose={close} composerOnly/>);
 expect(await screen.findByRole('dialog',{name:`발행 전표 상세 — ${partner.name}`})).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'적용 취소'})).toBeInTheDocument();expect(screen.queryByRole('button',{name:'수정'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:`발행 전표 상세 — ${partner.name} 닫기`}));expect(close).toHaveBeenCalledOnce();
});


it('저장 원문 금액이 수량×단가와 달라도 보기·인쇄는 그대로이고 수정 진입 뒤에만 계산한다',async()=>{
 const statement: IssuedStatement={id:'original-rounding',companyId:'taebaek',type:'매입',partnerId:partner.id,partnerName:partner.name,tradeDate:'2026-10-10',issuedAt:'2026-10-10',docNo:'261010-123',orderId:'',totalSupply:271,totalTax:28,totalAmount:299,
 items:[{name:'원문 품목',spec:'350ml',qty:3,price:100,supply:271,tax:28,total:299,isTaxExempt:false,accountCode:'500'}]};
 render(<TradeStatement {...companyReadyFixture} orders={[]} allItems={[]} partners={[partner]} partnerItems={[]} issuedStatements={[statement]} detailStatementId={statement.id} composerOnly/>);
 const dialog=await screen.findByRole('dialog',{name:'매입 전표 수정'});
 const row=within(dialog).getByText('원문 품목').closest('tr')!;
 expect(within(row).getByText('271')).toBeInTheDocument();expect(within(row).getByText('28')).toBeInTheDocument();expect(within(row).getByText('299')).toBeInTheDocument();
 const totals=dialog.querySelector<HTMLTableRowElement>('tbody > tr:last-child')!;
 expect(within(totals).getByText('271')).toBeInTheDocument();expect(within(totals).getByText('28')).toBeInTheDocument();expect(within(totals).getByText('299')).toBeInTheDocument();
 fireEvent.click(within(dialog).getByRole('button',{name:'거래명세서'}));
 const html=issueMocks.print.mock.calls.at(-1)?.[0];expect(html).toContain('261010-123');expect(html).toContain('299');expect(html).toContain('271');
 fireEvent.click(within(dialog).getByRole('button',{name:'수정'}));
 expect(within(row).queryByText('299')).not.toBeInTheDocument();expect(within(row).getByText('300')).toBeInTheDocument();expect(statement.totalAmount).toBe(299);
});
it('외부 일반 전표에서 적용 전표로 선택을 바꾸면 일반 composer는 남지 않는다',async()=>{
 const first: IssuedStatement={id:'normal-before',companyId:'taebaek',type:'매출',partnerId:partner.id,partnerName:partner.name,tradeDate:'2026-10-10',issuedAt:'2026-10-10',docNo:'A',orderId:'',items:[],totalSupply:100,totalTax:0,totalAmount:100};
 const special: IssuedStatement={...first,id:'special-after',noncashApplication:{kind:'advance-application',version:1,companyId:'taebaek',partnerId:partner.id,operationId:'apply',purpose:'합성',requestFingerprint:'hash',sourceFingerprints:{},targetFingerprints:{},allocations:[]}};
 const props={orders:[],allItems:[],partners:[partner],partnerItems:[],issuedStatements:[first,special],composerOnly:true};
 const view=render(<TradeStatement {...companyReadyFixture} {...props} detailStatementId={first.id}/>);expect(await screen.findByRole('dialog',{name:'매출 전표 수정'})).toBeInTheDocument();
 view.rerender(<TradeStatement {...companyReadyFixture} {...props} detailStatementId={special.id}/>);
 expect(await screen.findByRole('dialog',{name:`발행 전표 상세 — ${partner.name}`})).toBeInTheDocument();expect(screen.getAllByRole('dialog')).toHaveLength(1);
 expect(screen.queryByRole('dialog',{name:'매출 전표 수정'})).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'적용 취소'})).toBeInTheDocument();
});

it('구조가 손상된 요청의 없는 ID가 무관한 새 작성 입력과 저장을 막지 않는다',async()=>{
 const key='trade-statement-issue:taebaek:test-uid',text=JSON.stringify({version:1,companyId:'taebaek',userId:'test-uid',input:{statement:{id:'zero-A',companyId:'taebaek',totalAmount:0}}});localStorage.setItem(key,text);const apply=vi.fn().mockResolvedValue('applied');setup(undefined,undefined,{composerOnly:true,onApplyStatement:apply});expect(listTradePendings('taebaek','test-uid')[0].pending).toBeNull();const qty=screen.getByLabelText('1행 거래 수량');expect(qty).not.toBeDisabled();fireEvent.change(qty,{target:{value:'2'}});expect(qty).toHaveValue('2');fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(apply).toHaveBeenCalledOnce());expect(apply.mock.calls[0][0].statement.items[0].qty).toBe(2);expect(localStorage.getItem(key)).toBe(text);
});
it('실제 같은 ID의 유효한 미확인 요청은 작성 입력을 계속 잠근다',async()=>{
 const apply=vi.fn().mockRejectedValue(Error('응답 유실'));setup(undefined,undefined,{composerOnly:true,onApplyStatement:apply});fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(apply).toHaveBeenCalledOnce());const entry=listTradePendings('taebaek','test-uid')[0];expect(entry.pending?.input.statement.id).toBeTruthy();returnToComposer();expect(screen.getByLabelText('1행 거래 수량')).toBeDisabled();expect(localStorage.getItem(entry.key)).toBe(entry.text);expect(apply).toHaveBeenCalledOnce();
});

it.each([false,true])('과거 구조 정상 0원 A는 재시도 없이 삭제 가능하고 무관 B를 저장한다: 삭제 %s',async deleted=>{
 const firstApply=vi.fn().mockRejectedValue(Error('응답 유실'));const view=render(<TradeStatement {...companyReadyFixture} orders={[]} allItems={[item]} partners={[partner]} partnerItems={[price]} issuedStatements={[]} pendingInvoice={{...pendingInvoice,poIds:['po-A']}} composerOnly onApplyStatement={firstApply}/>);fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(firstApply).toHaveBeenCalledOnce());const entry=listTradePendings('taebaek','test-uid')[0],p=JSON.parse(entry.text);view.unmount();p.input.statement.totalAmount=0;p.input.statement.totalSupply=0;p.input.statement.items[0].total=0;p.input.statement.items[0].price=0;const text=JSON.stringify(p);localStorage.setItem(entry.key,text);const apply=vi.fn().mockResolvedValue('applied');setup(undefined,undefined,{composerOnly:true,pendingInvoice:{...pendingInvoice,poIds:['po-B']},onApplyStatement:apply});const qty=screen.getByLabelText('1행 거래 수량');expect(qty).not.toBeDisabled();fireEvent.change(qty,{target:{value:'2'}});const retry=await recoveryAction('같은 내용 다시 시도');expect(retry).toBeDisabled();fireEvent.click(retry);expect(apply).not.toHaveBeenCalled();expect(screen.getByText(/이전 요청의 합계가 0원/)).toBeInTheDocument();if(deleted){recoveryMocks.delete.mockImplementationOnce(async()=>{localStorage.removeItem(entry.key);return {outcome:'rewrite',reason:'미발행 확인 후 삭제'};});fireEvent.click(screen.getByRole('button',{name:'실패 요청 삭제'}));await waitFor(()=>expect(localStorage.getItem(entry.key)).toBeNull());}returnToComposer();expect(screen.getByLabelText('1행 거래 수량')).toHaveValue('2');fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(apply).toHaveBeenCalledOnce());expect(apply.mock.calls[0][0].poIds).toEqual(['po-B']);expect(localStorage.getItem(entry.key)).toBe(deleted?null:text);
});

it('담당자 Auth UID를 현재 직원 이름으로 표시하고 이름순 정렬하며 원전표 ID는 보존한다', () => {
 const stamp = ownerToday();
 const statement = (id: string, createdBy: string, docNo: string): IssuedStatement => ({ id, companyId: 'taebaek', type: '매출', tradeDate: stamp, issuedAt: stamp, partnerId: partner.id, partnerName: partner.name, orderId: '', docNo, totalSupply: 100, totalTax: 0, totalAmount: 100, items: [{ name: '합성품목', spec: '', qty: 1, price: 100, supply: 100, tax: 0, total: 100, accountCode: '800', isTaxExempt: true }], createdBy });
 const statements = [statement('owner-z', 'emp_aaa', 'OWNER-Z'), statement('owner-a', 'emp_zzz', 'OWNER-A')];
 setup(undefined, undefined, { pendingInvoice: null, issuedStatements: statements, employees: [{ id: 'e-z', authUid: 'emp_aaa', name: '하직원', companyId: 'taebaek' }, { id: 'e-a', authUid: 'emp_zzz', name: '가직원', companyId: 'taebaek' }] });
 const table = screen.getByRole('table'); expect(within(table).getByText('하직원')).toBeInTheDocument(); expect(within(table).getByText('가직원')).toBeInTheDocument(); expect(screen.queryByText('emp_aaa')).not.toBeInTheDocument();
 fireEvent.click(within(table).getByText('담당자')); const rows = within(table).getAllByRole('row').slice(1); expect(rows[0]).toHaveTextContent('가직원'); expect(rows[1]).toHaveTextContent('하직원'); expect(statements.map(row => row.createdBy)).toEqual(['emp_aaa', 'emp_zzz']);
 fireEvent.click(screen.getByRole('button', { name: '엑셀' })); expect(ownerExcel.download.mock.calls[0][0].rows.map((row: unknown[]) => row[1])).toEqual(['가직원', '하직원']);
});

it('목록 엑셀 미리보기 수명은 회사·인증 UID 변경과 화면 해제 때 중단된다', () => {
 const statement: IssuedStatement = { id:'excel-scope',companyId:'taebaek',type:'매출',tradeDate:ownerToday(),issuedAt:ownerToday(),partnerId:partner.id,partnerName:partner.name,orderId:'',docNo:'EXCEL',totalSupply:100,totalTax:0,totalAmount:100,items:[] };
 const props = { orders: [], allItems: [item], partners: [partner], partnerItems: [price], issuedStatements: [statement], companyId: 'taebaek' as const };
 const view = render(<TradeStatement {...companyReadyFixture} {...props} />);
 const open = () => { fireEvent.click(screen.getByRole('button', { name: '엑셀' })); return ownerExcel.download.mock.calls.at(-1)![0].signal as AbortSignal; };
 const first = open(); expect(first.aborted).toBe(false);
 view.rerender(<TradeStatement {...companyReadyFixture} {...props} companyId="punghoe" />); expect(first.aborted).toBe(true);
 const second = open(); act(() => ownerExcel.actor?.({ uid: 'other-uid' })); expect(second.aborted).toBe(true);
 view.rerender(<TradeStatement {...companyReadyFixture} {...props} />); const third = open(); view.unmount(); expect(third.aborted).toBe(true);
});

it('캐시 전표가 있어도 최초 인증 UID가 없으면 목록 엑셀을 열지 않는다', () => {
 const user = auth.currentUser; (auth as unknown as {currentUser:null}).currentUser = null;
 try {
  const statement: IssuedStatement = { id:'excel-no-user',companyId:'taebaek',type:'매출',tradeDate:ownerToday(),issuedAt:ownerToday(),partnerId:partner.id,partnerName:partner.name,orderId:'',docNo:'NO-USER',totalSupply:100,totalTax:0,totalAmount:100,items:[] };
  render(<TradeStatement {...companyReadyFixture} orders={[]} allItems={[item]} partners={[partner]} partnerItems={[price]} issuedStatements={[statement]} companyId="taebaek" />);
  fireEvent.click(screen.getByRole('button', { name:'엑셀' })); expect(ownerExcel.download).not.toHaveBeenCalled();
 } finally { (auth as unknown as {currentUser:typeof user}).currentUser = user; }
});

it('발행 문서 엑셀도 인증된 화면 수명과 원품목을 미리보기 서비스에 전달한다', async () => {
 const statement: IssuedStatement = { id:'document-preview',companyId:'taebaek',type:'매입',tradeDate:ownerToday(),issuedAt:ownerToday(),partnerId:partner.id,partnerName:partner.name,orderId:'',docNo:'DOCUMENT',totalSupply:250,totalTax:0,totalAmount:250,items:[{itemId:item.id,name:'문서 원품목',spec:'kg',qty:2.5,price:100,supply:250,tax:0,total:250,isTaxExempt:true,accountCode:'500'}] };
 const view=render(<TradeStatement {...companyReadyFixture} orders={[]} allItems={[item]} partners={[partner]} partnerItems={[price]} issuedStatements={[statement]} companyId="taebaek" detailStatementId={statement.id}/>);
 const dialog=await screen.findByRole('dialog',{name:'매입 전표 수정'});fireEvent.click(within(dialog).getByRole('button',{name:'엑셀'}));
 expect(ownerExcel.document).toHaveBeenCalledOnce();const request=ownerExcel.document.mock.calls[0][0];expect(request.items[0]).toMatchObject({qty:2.5,price:100});expect(request.signal.aborted).toBe(false);view.unmount();expect(request.signal.aborted).toBe(true);
});

it('전표인쇄는회사UID출력signal을전달하고계정변경후재인쇄를차단한다',async()=>{const statement:IssuedStatement={id:'html-print-scope',companyId:'taebaek',type:'매입',partnerId:partner.id,partnerName:partner.name,tradeDate:'2026-10-10',issuedAt:'2026-10-10',docNo:'HTML-SCOPE',orderId:'',totalSupply:100,totalTax:0,totalAmount:100,items:[{name:'인쇄원문',spec:'kg',qty:1,price:100,supply:100,tax:0,total:100,isTaxExempt:true,accountCode:'500'}]};const view=render(<TradeStatement {...companyReadyFixture} orders={[]} allItems={[]} partners={[partner]} partnerItems={[]} issuedStatements={[statement]} detailStatementId={statement.id} composerOnly/>);const dialog=await screen.findByRole('dialog',{name:'매입 전표 수정'});fireEvent.click(within(dialog).getByRole('button',{name:'거래명세서'}));const signal=issueMocks.print.mock.calls.at(-1)![2] as AbortSignal;expect(signal.aborted).toBe(false);const count=issueMocks.print.mock.calls.length;act(()=>ownerExcel.actor?.({uid:'different-user'}));expect(signal.aborted).toBe(true);fireEvent.click(within(dialog).getByRole('button',{name:'거래명세서'}));expect(issueMocks.print).toHaveBeenCalledTimes(count);view.unmount();expect(signal.aborted).toBe(true);});

it('전표 실제 배치는 내역탭 행동 복구 검색 뒤에 결과 건수를 표시한다',()=>{
 setup(undefined,undefined,{pendingInvoice:undefined});
 const tabs=screen.getByRole('button',{name:'전표내역'}).closest('[data-page-header-slot="tabs"]')!;
 const actions=screen.getByRole('group',{name:'거래명세서 작업'}),recovery=screen.getByRole('button',{name:'처리 기록'}),search=screen.getByRole('region',{name:'검색조건'}),summary=screen.getByRole('heading',{name:/조회 결과/});
 expect(tabs).not.toBeNull();for(const [a,b]of [[tabs,actions],[actions,recovery],[recovery,search],[search,summary]])expect(a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(screen.getAllByRole('heading',{name:/조회 결과/})).toHaveLength(1);expect(within(actions).getByRole('button',{name:'일반전표'})).toBeInTheDocument();
 fireEvent.click(within(actions).getByRole('button',{name:/거래명세서/}));fireEvent.change(screen.getByPlaceholderText('업체명 · 문서번호 · 계정과목 검색'),{target:{value:'없는거래처'}});
 expect(within(actions).getByRole('button',{name:'매입전표'})).toBeInTheDocument();
});
it('composerOnly에서는 조회 탭 행동과 검색조건을 새로 노출하지 않는다',()=>{
 setup(undefined,undefined,{composerOnly:true});expect(screen.queryByRole('group',{name:'거래명세서 작업'})).toBeNull();expect(screen.queryByRole('button',{name:'전표내역'})).toBeNull();expect(screen.queryByRole('region',{name:'검색조건'})).toBeNull();expect(screen.getByLabelText('1행 거래 수량')).toBeInTheDocument();
});

it('품목 단가의 void 응답은 완료표시가 아니며 피커를 닫아도 실제 요청 결과 확인에 접근한다',async()=>{
 const reference={companyId:'taebaek' as const,planId:'terms-plan',targetId:price.id,itemId:item.id,partnerId:partner.id,direction:'in' as const};
 let pending:{reference:typeof reference;description:string}[]=[];
 const save=vi.fn().mockImplementation(async()=>{pending=[{reference,description:'진단 단가 결과 확인'}];return undefined;});
 const inspect=vi.fn(async()=>{pending=[];return {status:'saved' as const};});
 setup(undefined,save,{composerOnly:true,onReadPendingPartnerItemTerms:()=>pending,onInspectPartnerItemTerms:inspect});
 fireEvent.click(await screen.findByRole('button',{name:'품목 선택'}));
 const search=screen.getByPlaceholderText('품목명 검색...'),picker=search.closest('.absolute')!;
 const row=within(picker as HTMLElement).getByText(item.name).closest('tr')!;
 fireEvent.change(within(row).getByPlaceholderText('미설정'),{target:{value:'7000'}});
 fireEvent.click(within(row).getByTitle('단가 저장'));
 await screen.findByText(/거래조건 저장 결과를 확인하지 못했습니다/);
 expect(within(row).getByTitle('단가 저장')).not.toHaveTextContent('✓');
 fireEvent.click(within(picker as HTMLElement).getByRole('button',{name:'취소'}));
 const recovery=screen.getByRole('region',{name:'처리 결과 확인이 필요한 거래조건'});
 fireEvent.click(within(recovery).getByRole('button',{name:'결과 확인'}));await waitFor(()=>expect(inspect).toHaveBeenCalledExactlyOnceWith(reference));
 expect(save).toHaveBeenCalledOnce();
});
it('복수 연결은 첫 ACK만 보존하고 다음 미확인 품목과 복구 행동을 구분하며 완료 행을 재송신하지 않는다',async()=>{
 const first={...item,id:'first',name:'첫 품목'},second={...item,id:'second',name:'다음 품목'};
 const save=vi.fn<(input:PartnerItemTermsInput)=>Promise<import('../src/features/items/infrastructure/partnerItemTermsWrites').PartnerItemTermsOutcome>>()
 .mockResolvedValueOnce({status:'saved'}).mockResolvedValue({status:'unknown',message:'다음 품목 응답 미확인',nextAction:'결과 확인 또는 요청 중단'});
 setup(undefined,save,{composerOnly:true,allItems:[first,second],partnerItems:[]});
 fireEvent.click(await screen.findByRole('button',{name:'품목 선택'}));
 const picker=screen.getByPlaceholderText('품목명 검색...').closest('.absolute')! as HTMLElement;
 fireEvent.change(screen.getByPlaceholderText('품목명 검색...'),{target:{value:'품목'}});
 for(const name of [first.name,second.name])fireEvent.change(within(within(picker).getByText(name).closest('tr')!).getByPlaceholderText('수량'),{target:{value:'1'}});
 fireEvent.click(within(picker).getByRole('button',{name:'추가'}));
 await waitFor(()=>expect(save).toHaveBeenCalledTimes(2));
 expect(await screen.findByText(/연결 저장 확인: first/)).toHaveTextContent('저장 확인이 필요한 품목: second');
 fireEvent.click(within(picker).getByRole('button',{name:'추가'}));await waitFor(()=>expect(appConfirm).toHaveBeenCalledTimes(2));
 expect(save.mock.calls.filter(([input])=>input.target.itemId==='first')).toHaveLength(1);
});
it('전표 ACK 뒤 원가 후속 실패는 단가 저장완료를 보존하고 구체 원가 확인을 안내한다',async()=>{
 const save=vi.fn(async(_input:PartnerItemTermsInput)=>({status:'saved' as const}));
 const cost=vi.fn(async()=>{throw Error('원가 응답 유실');});
 const {onAddIssuedStatement}=setup(undefined,save,{onUpdateItemCost:cost});
 fireEvent.click(await screen.findByRole('button',{name:'저장'}));await waitFor(()=>expect(cost).toHaveBeenCalledOnce());
 expect(save).toHaveBeenCalledOnce();expect(onAddIssuedStatement).toHaveBeenCalledOnce();
 expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('거래조건은 저장됐지만 품목 loose 원가 반영을 확인하지 못했습니다'));
});

const companyPorts={onOpenCompanyInfo:async(initial:CompanyInfo|null|undefined,context:CompanyInfoOperationContext)=>({reference:{companyId:context.companyId,planId:context.planId},actorUid:context.actorUid,opening:companyInfoOpening(initial),expectedVersion:'1:000000001'})};
it('회사 정보 설정은 async ACK 전 유지하고 표시 변경 항목만 저장한다',async()=>{
 let finish!:(value:CompanyInfoOutcome)=>void;const gate=new Promise<CompanyInfoOutcome>(resolve=>{finish=resolve;}),save=vi.fn(()=>gate);
 setup(undefined,undefined,{pendingInvoice:null,companyInfoRecovery:companyPorts,onSaveCompanyInfo:save,companyInfo:{name:'회사',ceoName:'대표',bizNo:'1',bizType:'제조',bizItem:'식품',address:'옛 주소',adminPassword:'비표시'}});
 fireEvent.click(screen.getByTitle('회사 정보 설정'));await act(async()=>{await Promise.resolve();});fireEvent.change(screen.getByLabelText('사업장 주소'),{target:{value:'새 주소'}});const modal=screen.getByRole('dialog',{name:'회사 정보 설정'});fireEvent.click(within(modal).getByRole('button',{name:'저장'}));
 expect(save).toHaveBeenCalledWith({address:'새 주소'},expect.objectContaining({opening:expect.any(Object),planId:expect.any(String)}));expect(modal).toBeInTheDocument();expect(within(modal).getByRole('button',{name:'저장 중…'})).toBeDisabled();await act(async()=>finish({status:'saved',requestFinalized:true}));expect(screen.queryByRole('dialog',{name:'회사 정보 설정'})).toBeNull();
});
it('회사 정보 설정은 같은 회사 UID 교체 때 닫히고 옛 ACK로 새 창 초안을 닫지 않는다',async()=>{
 let finish!:(value:CompanyInfoOutcome)=>void;const gate=new Promise<CompanyInfoOutcome>(resolve=>{finish=resolve;}),save=vi.fn(()=>gate),base={orders:[],allItems:[item],partners:[partner],partnerItems:[price],issuedStatements:[],companyId:'taebaek' as const,companyInfo:{name:'회사',ceoName:'대표',bizNo:'1',bizType:'제조',bizItem:'식품',address:'옛 주소'},onSaveCompanyInfo:save,companyInfoRecovery:companyPorts};
 const view=render(<TradeStatement {...companyReadyFixture} {...base}/>);fireEvent.click(screen.getByTitle('회사 정보 설정'));await act(async()=>{await Promise.resolve();});fireEvent.change(screen.getByLabelText('사업장 주소'),{target:{value:'옛 계정 수정'}});fireEvent.click(within(screen.getByRole('dialog',{name:'회사 정보 설정'})).getByRole('button',{name:'저장'}));
 (auth.currentUser as {uid:string}).uid='new-company-actor';view.rerender(<TradeStatement {...companyReadyFixture} {...base}/>);expect(screen.queryByRole('dialog',{name:'회사 정보 설정'})).toBeNull();fireEvent.click(screen.getByTitle('회사 정보 설정'));await act(async()=>{await Promise.resolve();});fireEvent.change(screen.getByLabelText('사업장 주소'),{target:{value:'새 계정 초안'}});await act(async()=>finish({status:'saved',requestFinalized:true}));expect(screen.getByRole('dialog',{name:'회사 정보 설정'})).toBeInTheDocument();expect(screen.getByLabelText('사업장 주소')).toHaveValue('새 계정 초안');
});

it('전표의 거래조건 사본 정리는 picker와 무관하게 정확 관측원문만 전달한다',async()=>{
 const reference={companyId:'taebaek' as const,planId:'trade-copy',targetId:price.id,itemId:item.id,partnerId:partner.id,direction:'in' as const};let stored=true;const discard=vi.fn(async()=>{stored=false;return {status:'cleared' as const,message:'이 기기 사본만 정리'};}),save=vi.fn();setup(undefined,save,{composerOnly:true,onReadPendingPartnerItemTerms:()=>stored?[{reference,description:'전표 거래조건 확인'}]:[],onReadPartnerItemTermsReferences:()=>stored?[{key:'trade-copy',reference,readable:true,observedLocalText:'trade-observed'}]:[],onDiscardPartnerItemTermsCopy:discard});const region=screen.getByRole('region',{name:'처리 결과 확인이 필요한 거래조건'});fireEvent.click(within(region).getByRole('button',{name:'이 기기 사본 정리'}));await waitFor(()=>expect(discard).toHaveBeenCalledExactlyOnceWith(reference,'trade-observed'));expect(save).not.toHaveBeenCalled();expect(screen.queryByRole('region',{name:'처리 결과 확인이 필요한 거래조건'})).toBeNull();expect(screen.getByRole('status')).toHaveTextContent('사본만');
});

const lifecycleStatement=():IssuedStatement=>({id:'lifecycle-edit',companyId:'taebaek',mutationRevision:0,docNo:'261021-01',partnerId:partner.id,partnerName:partner.name,tradeDate:ownerToday(),issuedAt:ownerToday()+'T09:00:00Z',type:'매출',orderId:'',totalSupply:100,totalTax:10,totalAmount:110,items:[{name:'고정 원문 품목',spec:'개',qty:1,price:110,supply:100,tax:10,total:110,isTaxExempt:false}]});
async function openLifecycleEditor(save:NonNullable<React.ComponentProps<typeof TradeStatement>['onUpdateIssuedStatement']>){const original=lifecycleStatement();setup(undefined,undefined,{pendingInvoice:null,issuedStatements:[original],detailStatementId:original.id,onUpdateIssuedStatement:save});const dialog=await screen.findByRole('dialog',{name:'매출 전표 수정'});fireEvent.click(within(dialog).getByRole('button',{name:'수정'}));return {original,dialog};}
it('전체 수정은 ACK 전 X와 중복 저장을 막고 처음 선택한 r0·UID를 전달한 뒤 종료한다',async()=>{const gate=deferred(),save=vi.fn<NonNullable<React.ComponentProps<typeof TradeStatement>['onUpdateIssuedStatement']>>(async()=>gate.promise),{original,dialog}=await openLifecycleEditor(save);fireEvent.click(within(dialog).getByRole('button',{name:'저장'}));await waitFor(()=>expect(save).toHaveBeenCalledOnce());expect(save.mock.calls[0]).toEqual([original.id,expect.any(Object),expect.objectContaining({mutationRevision:0}), 'test-uid',expect.any(Function)]);fireEvent.click(within(dialog).getByRole('button',{name:'매출 전표 수정 닫기'}));expect(dialog).toBeInTheDocument();expect(within(dialog).getByRole('button',{name:'저장 중…'})).toBeDisabled();await act(async()=>gate.resolve());await waitFor(()=>expect(screen.queryByRole('dialog',{name:'매출 전표 수정'})).toBeNull());});
it('수정 응답 유실은 원문과 입력을 보존하고 같은 수정의 자동 재송신 없이 이유를 모달에 표시한다',async()=>{const save=vi.fn<NonNullable<React.ComponentProps<typeof TradeStatement>['onUpdateIssuedStatement']>>(async()=>{throw Error('응답 유실');}),{dialog}=await openLifecycleEditor(save);fireEvent.click(within(dialog).getByRole('button',{name:'저장'}));await waitFor(()=>expect(within(dialog).getByRole('alert')).toHaveTextContent('응답 유실'));expect(dialog).toBeInTheDocument();expect(within(dialog).getByRole('button',{name:'저장'})).toBeDisabled();expect(save).toHaveBeenCalledOnce();});
it('날짜 적용은 확인 대기 중 중복 송신하지 않고 회사UID 교체 뒤에는 저장하지 않는다',async()=>{let finish!:(value:boolean)=>void;vi.mocked(appConfirm).mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));const save=vi.fn<NonNullable<React.ComponentProps<typeof TradeStatement>['onUpdateIssuedStatement']>>(async()=>{}),original=lifecycleStatement();setup(undefined,undefined,{pendingInvoice:null,issuedStatements:[original],focusDocNo:original.docNo,onUpdateIssuedStatement:save});const row=(await screen.findAllByText(original.partnerName)).find(el=>el.closest('tr'))!.closest('tr')!;fireEvent.change(within(row).getByLabelText('전표일자'),{target:{value:'2026-11-01'}});fireEvent.click(within(row).getByRole('button',{name:'날짜 적용'}));expect(save).not.toHaveBeenCalled();expect(within(row).getByRole('button',{name:'날짜 적용'})).toBeDisabled();act(()=>{(auth.currentUser as {uid:string}).uid='new-user';ownerExcel.actor?.({uid:'new-user'});});await act(async()=>finish(true));expect(save).not.toHaveBeenCalled();});
it('증빙 저장은 선택 r0와 UID를 전달하고 응답 거절을 끝까지 표시한다',async()=>{const save=vi.fn<NonNullable<React.ComponentProps<typeof TradeStatement>['onUpdateIssuedStatement']>>(async()=>{throw Error('증빙 권한 거절');}),original=lifecycleStatement();setup(undefined,undefined,{pendingInvoice:null,issuedStatements:[original],focusDocNo:original.docNo,onUpdateIssuedStatement:save});const select=await screen.findByLabelText(original.partnerName+' 증빙');const value=(select as HTMLSelectElement).options[1].value;fireEvent.change(select,{target:{value}});await waitFor(()=>expect(save).toHaveBeenCalledOnce());expect(save.mock.calls[0]).toEqual([original.id,expect.objectContaining({evidence:value}),expect.objectContaining({mutationRevision:0}),'test-uid',expect.any(Function)]);expect(await screen.findAllByText(/증빙 권한 거절/)).not.toHaveLength(0);});
it('같은 컴포넌트에서 회사UID를 바꾼 뒤 늦은 저장 ACK는 새 편집창과 입력을 닫지 않는다',async()=>{const gate=deferred(),save=vi.fn<NonNullable<React.ComponentProps<typeof TradeStatement>['onUpdateIssuedStatement']>>(async()=>gate.promise),old=lifecycleStatement();const props={orders:[],allItems:[],partners:[partner],partnerItems:[],onUpdateIssuedStatement:save,onSavePartnerItemTerms:vi.fn(async()=>({status:'saved' as const}))};const view=render(<TradeStatement {...companyReadyFixture} {...props} companyId="taebaek" issuedStatements={[old]} detailStatementId={old.id}/>);let dialog=await screen.findByRole('dialog',{name:'매출 전표 수정'});fireEvent.click(within(dialog).getByRole('button',{name:'수정'}));fireEvent.click(within(dialog).getByRole('button',{name:'저장'}));await waitFor(()=>expect(save).toHaveBeenCalledOnce());const next={...old,id:'new-scope',companyId:'punghoe' as const,memo:'새 회사 입력'};act(()=>{(auth.currentUser as {uid:string}).uid='new-user';ownerExcel.actor?.({uid:'new-user'});});view.rerender(<TradeStatement {...companyReadyFixture} {...props} companyId="punghoe" issuedStatements={[next]} detailStatementId={next.id}/>);dialog=await screen.findByRole('dialog',{name:'매출 전표 수정'});fireEvent.click(within(dialog).getByRole('button',{name:'수정'}));const memo=within(dialog).getByDisplayValue('새 회사 입력');fireEvent.change(memo,{target:{value:'새 계정이 작성한 비고'}});await act(async()=>gate.resolve());expect(dialog).toBeInTheDocument();expect(memo).toHaveValue('새 계정이 작성한 비고');expect(save).toHaveBeenCalledOnce();expect(within(dialog).getByRole('button',{name:'저장'})).toBeEnabled();});

// 실제 영속 writer와 controller를 함께 사용하고 서버 명령 경계만 합성한다.
import {createStatementEditWrites,type StatementEditBindings,type StatementEditWire} from '../src/shared/services/statementEditWrites';
function persistentEditFixture(lose=false){let writes=0,inspects=0;const receipts=new Map<string,Record<string,unknown>>();const call=vi.fn(async(input:any)=>{if(input.mode==='listHistory')return {version:1,companyId:input.companyId,actorUid:'test-uid',entries:[...receipts.values()].map(result=>({result,createdAt:'2026-10-21T00:00:00.000Z'})),nextCursor:null};if(input.mode){if(input.mode==='inspect')inspects++;return receipts.get(input.reference.operationId)??{version:1,reference:input.reference,actorUid:'test-uid',status:input.mode==='cancel'?'cancelled':'unknown',requestHash:null,message:input.mode==='cancel'?'미처리 수정 중단 확인':'아직 처리 기록을 찾지 못했습니다.'};}const wire=input as StatementEditWire;writes++;const result={version:1,reference:{companyId:'taebaek',operationId:wire.operationId,statementId:wire.statementId},actorUid:'test-uid',status:'applied',revision:wire.expectedRevision+1,requestHash:createHash('sha256').update(JSON.stringify({statementId:wire.statementId,expectedRevision:wire.expectedRevision,patch:wire.patch})).digest('hex'),message:'이 요청의 전표 수정이 처리되었습니다.'};receipts.set(wire.operationId,result);if(lose)throw Error('수정 ACK 유실');return result;});const bindings=createStatementEditWrites({storage:localStorage,check:async(scope,current)=>{if(!current()||auth.currentUser?.uid!==scope.actorUid)throw Error('편집 범위 변경');},exclusive:async(_scope,work)=>work(),call,release:async()=> 'fixture-release',id:()=>crypto.randomUUID(),now:()=>new Date().toISOString()});return {bindings,call,counts:()=>({writes,inspects})};}
it('actual 영속 수정의 ACK 유실 뒤 편집창 안 실패로 진입해 조회하고 현재 입력과 본문 쓰기1회를 보존한다',async()=>{const h=persistentEditFixture(true),original=lifecycleStatement();setup(undefined,undefined,{pendingInvoice:null,issuedStatements:[original],detailStatementId:original.id,statementEditBindings:h.bindings});let dialog=await screen.findByRole('dialog',{name:'매출 전표 수정'});fireEvent.click(within(dialog).getByRole('button',{name:'수정'}));fireEvent.click(within(dialog).getByRole('button',{name:'저장'}));await waitFor(()=>expect(within(dialog).getByRole('alert')).toHaveTextContent('수정 ACK 유실'));expect(h.counts().writes).toBe(1);const retained=await h.bindings.readPending({companyId:'taebaek',actorUid:'test-uid'},()=>true);expect(retained).toHaveLength(1);expect(retained[0].retained?.wire.expectedRevision).toBe(0);fireEvent.click(within(dialog).getByRole('button',{name:'실패 1'}));const recovery=await screen.findByRole('dialog',{name:'실패 작업 목록'});expect(screen.queryByRole('dialog',{name:'매출 전표 수정'})).toBeNull();fireEvent.click(within(recovery).getByRole('button',{name:'수정 결과 확인'}));await waitFor(()=>expect(h.counts().inspects).toBe(1));expect(h.counts().writes).toBe(1);expect(within(recovery).queryByRole('button',{name:'보관한 수정 다시 시도'})).toBeNull();fireEvent.click(within(recovery).getByRole('button',{name:'실패 작업 목록 닫기'}));dialog=await screen.findByRole('dialog',{name:'매출 전표 수정'});expect(within(dialog).getByRole('button',{name:'저장'})).toBeDisabled();expect(h.counts().writes).toBe(1);});
it('본문 ACK 뒤 후속 running 기록이 실패하면 가격 쓰기를 시작하지 않고 부분 완료와 원문을 모달에서 확인한다',async()=>{const h=persistentEditFixture(),terms=vi.fn(async()=>({status:'saved' as const})),cost=vi.fn(async()=>{});const marker=vi.fn<StatementEditBindings['markFollowup']>(async(scope,entry,progress,current)=>{if(progress!=='body-ack')throw Error('후속 시작 기록 실패');return h.bindings.markFollowup(scope,entry,progress,current);});const original={...lifecycleStatement(),type:'매입' as const,totalSupply:5455,totalTax:545,totalAmount:6000,items:[{itemId:item.id,name:item.name,spec:'300ml',qty:1,price:6000,supply:5455,tax:545,total:6000,isTaxExempt:false,accountCode:'500'}]};setup(undefined,terms,{pendingInvoice:null,issuedStatements:[original],detailStatementId:original.id,statementEditBindings:{...h.bindings,markFollowup:marker},onUpdateItemCost:cost});const dialog=await screen.findByRole('dialog',{name:'매입 전표 수정'});fireEvent.click(within(dialog).getByRole('button',{name:'수정'}));fireEvent.click(within(dialog).getByRole('button',{name:'545'}));fireEvent.click(within(dialog).getByRole('button',{name:'저장'}));await waitFor(()=>expect(within(dialog).getByRole('alert')).toHaveTextContent('후속 시작 기록 실패'));expect(h.counts().writes).toBe(1);expect(terms).not.toHaveBeenCalled();expect(cost).not.toHaveBeenCalled();const rows=await h.bindings.readPending({companyId:'taebaek',actorUid:'test-uid'},()=>true);expect(rows[0].retained?.bodyAcknowledged).toBe(true);expect(rows[0].retained?.followupPlan?.upserts.length).toBeGreaterThan(0);expect(rows[0].retained?.progress).toEqual([]);fireEvent.click(within(dialog).getByRole('button',{name:'실패 1'}));const recovery=await screen.findByRole('dialog',{name:'실패 작업 목록'});expect(within(recovery).getByText(/거래조건과 원가 후속 처리를 확인/)).toBeTruthy();expect(within(recovery).queryByRole('button',{name:'보관한 수정 다시 시도'})).toBeNull();fireEvent.click(within(recovery).getByRole('button',{name:'거래조건 후속 확인 열기'}));expect(within(recovery).getByRole('region',{name:'거래조건 후속 확인'})).toBeTruthy();});
it.each(['date','evidence'] as const)('actual typed bundle의 %s 경로는 legacy callback 없이 최초 revision과 원문 dirty patch를 영속·송신한다',async mode=>{const h=persistentEditFixture(),original=lifecycleStatement(),legacy=vi.fn(async()=>{});setup(undefined,undefined,{pendingInvoice:null,issuedStatements:[original],focusDocNo:original.docNo,statementEditBindings:h.bindings,onUpdateIssuedStatement:legacy});if(mode==='date'){const row=(await screen.findAllByText(original.partnerName)).find(e=>e.closest('tr'))!.closest('tr')!;fireEvent.change(within(row).getByLabelText('전표일자'),{target:{value:'2026-11-01'}});fireEvent.click(within(row).getByRole('button',{name:'날짜 적용'}));}else{const select=await screen.findByLabelText(original.partnerName+' 증빙');fireEvent.change(select,{target:{value:(select as HTMLSelectElement).options[1].value}});}await waitFor(()=>expect(h.counts().writes).toBe(1));const wire=h.call.mock.calls.map(row=>row[0]).find(input=>!input.mode) as StatementEditWire;expect(wire.expectedRevision).toBe(0);expect(wire.statementId).toBe(original.id);if(mode==='date')expect(wire.patch.tradeDate).toBe('2026-11-01');else expect(wire.patch.evidence).toBeTruthy();expect(legacy).not.toHaveBeenCalled();await waitFor(()=>expect(h.counts().inspects).toBe(1));});
it('손상된 수정 원문과 참조는 가짜 조회·중단 없이 명시 기기 정리와 기록 조회로 연결된다',async()=>{const h=persistentEditFixture(),key='statement-edit-v1:taebaek:test-uid:unreadable';localStorage.setItem(key,'손상 본문');localStorage.setItem(key+':reference','손상 참조');setup(undefined,undefined,{pendingInvoice:null,statementEditBindings:h.bindings});const failure=await screen.findByRole('button',{name:'실패 1'});fireEvent.click(failure);const dialog=await screen.findByRole('dialog',{name:'실패 작업 목록'});expect(within(dialog).queryByRole('button',{name:'수정 결과 확인'})).toBeNull();expect(within(dialog).queryByRole('button',{name:'미처리 수정 중단'})).toBeNull();fireEvent.click(within(dialog).getByRole('button',{name:'이 기기의 손상된 복구 정보만 정리'}));await waitFor(()=>expect(localStorage.getItem(key)).toBeNull());expect(localStorage.getItem(key+':reference')).toBeNull();expect(h.call).not.toHaveBeenCalled();expect(within(dialog).getByRole('button',{name:'수정 처리 기록'})).toBeEnabled();expect(within(dialog).getByText(/서버.*취소|처리 여부/)).toBeTruthy();});
it('기기 사본 없는 과거 applied 이력 조회는 현재 새 작성 수량을 닫거나 본문·후속을 다시 실행하지 않는다',async()=>{const h=persistentEditFixture(),scope={companyId:'taebaek' as const,actorUid:'test-uid'},old=lifecycleStatement();const entry=await h.bindings.prepare(scope,old,{memo:'과거 처리'},null,()=>true);const applied=await h.bindings.apply(scope,entry,()=>true);await h.bindings.discardObserved(scope,applied.entry,()=>true);expect(await h.bindings.readPending(scope,()=>true)).toEqual([]);const close=vi.fn(),terms=vi.fn(async()=>({status:'saved' as const}));setup(undefined,terms,{composerOnly:true,statementEditBindings:h.bindings,onComposerClose:close});fireEvent.change(screen.getByLabelText('1행 거래 수량'),{target:{value:'3'}});fireEvent.click(screen.getByRole('button',{name:'처리 기록'}));const dialog=await screen.findByRole('dialog',{name:'실패 작업 목록'});const inspect=await within(dialog).findByRole('button',{name:'수정 결과 확인'});fireEvent.click(inspect);await waitFor(()=>expect(h.counts().inspects).toBe(2));expect(h.counts().writes).toBe(1);expect(terms).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();expect(within(dialog).queryByRole('button',{name:'보관한 수정 다시 시도'})).toBeNull();fireEvent.click(within(dialog).getByRole('button',{name:'실패 작업 목록 닫기'}));expect(screen.getByLabelText('1행 거래 수량')).toHaveValue('3');expect(screen.getByRole('button',{name:'저장'})).toBeEnabled();expect(screen.queryByRole('button',{name:'실패 0'})).toBeNull();});

it('새 controller가 보관 요청을 재발견해도 본문을 자동 재송신하지 않고 조회 뒤 새 작성 수량을 유지한다',async()=>{const h=persistentEditFixture(true),scope={companyId:'taebaek' as const,actorUid:'test-uid'},entry=await h.bindings.prepare(scope,lifecycleStatement(),{memo:'재로드 전 원문'},null,()=>true);await expect(h.bindings.apply(scope,entry,()=>true)).rejects.toThrow('수정 ACK 유실');expect(h.counts().writes).toBe(1);setup(undefined,undefined,{composerOnly:true,statementEditBindings:h.bindings});const failure=await screen.findByRole('button',{name:'실패 1'});expect(h.counts().writes).toBe(1);fireEvent.change(screen.getByLabelText('1행 거래 수량'),{target:{value:'3'}});fireEvent.click(failure);const modal=await screen.findByRole('dialog',{name:'실패 작업 목록'});fireEvent.click(within(modal).getByRole('button',{name:'수정 결과 확인'}));await waitFor(()=>expect(h.counts().inspects).toBe(1));expect(h.counts().writes).toBe(1);fireEvent.click(within(modal).getByRole('button',{name:'실패 작업 목록 닫기'}));expect(screen.getByLabelText('1행 거래 수량')).toHaveValue('3');expect(screen.getByRole('button',{name:'저장'})).toBeEnabled();});
it('거래조건 ACK 뒤 진행 기록 실패는 다음 원가 쓰기를 멈추고 전체 성공으로 닫지 않는다',async()=>{const h=persistentEditFixture(),terms=vi.fn(async()=>({status:'saved' as const})),cost=vi.fn(async()=>{}),mark=vi.fn<StatementEditBindings['markFollowup']>(async(scope,entry,progress,current)=>{if(progress!=='body-ack'&&!('error' in progress)&&progress.stage==='terms'&&progress.status==='acknowledged')throw Error('거래조건 ACK 기록 실패');return h.bindings.markFollowup(scope,entry,progress,current);});const original={...lifecycleStatement(),type:'매입' as const,totalSupply:5455,totalTax:545,totalAmount:6000,items:[{itemId:item.id,name:item.name,spec:'300ml',qty:1,price:6000,supply:5455,tax:545,total:6000,isTaxExempt:false,accountCode:'500'}]};setup(undefined,terms,{pendingInvoice:null,issuedStatements:[original],detailStatementId:original.id,statementEditBindings:{...h.bindings,markFollowup:mark},onUpdateItemCost:cost});const dialog=await screen.findByRole('dialog',{name:'매입 전표 수정'});fireEvent.click(within(dialog).getByRole('button',{name:'수정'}));fireEvent.click(within(dialog).getByRole('button',{name:'545'}));fireEvent.click(within(dialog).getByRole('button',{name:'저장'}));await waitFor(()=>expect(within(dialog).getByRole('alert')).toHaveTextContent('거래조건 ACK 기록 실패'));expect(terms).toHaveBeenCalledOnce();expect(cost).not.toHaveBeenCalled();expect(dialog).toBeInTheDocument();const entries=await h.bindings.readPending({companyId:'taebaek',actorUid:'test-uid'},()=>true);expect(entries[0].retained?.bodyAcknowledged).toBe(true);expect(entries[0].retained?.progress).toEqual([{stage:'terms',index:0,status:'running'}]);expect(h.counts().writes).toBe(1);});
it('수정 실패가 있고 발행 요청이 없는 모달은 각 영역을 구분하고 전체 실패 없음으로 안내하지 않는다',async()=>{
 const h=persistentEditFixture(),scope={companyId:'taebaek' as const,actorUid:'test-uid'};
 await h.bindings.prepare(scope,lifecycleStatement(),{memo:'확인할 수정 요청'},null,()=>true);
 setup(undefined,undefined,{pendingInvoice:null,statementEditBindings:h.bindings});
 fireEvent.click(await screen.findByRole('button',{name:'실패 1'}));
 const dialog=await screen.findByRole('dialog',{name:'실패 작업 목록'});
 expect(within(dialog).getByRole('heading',{name:'전표 수정 처리 확인'})).toBeInTheDocument();
 expect(within(dialog).getByRole('heading',{name:'전표 발행·수금·지불 처리 확인'})).toBeInTheDocument();
 expect(within(dialog).getByText('확인할 전표 발행·수금·지불 요청이 없습니다.')).toBeInTheDocument();
 expect(within(dialog).queryByText('확인할 실패 작업이 없습니다.')).not.toBeInTheDocument();
 expect(within(dialog).getByRole('button',{name:'수정 결과 확인'})).toBeEnabled();
 expect(h.counts().writes).toBe(0);
});

const fixtureCompany={name:'합성 현재회사',ceoName:'',bizNo:'',bizType:'',bizItem:'',address:''};
const fixtureCompanyToken={};
const companyReadyFixture={companyInfo:fixtureCompany,companyInfoRead:{companyId:'taebaek' as const,value:fixtureCompany,status:'ready' as const,error:'',retry:()=>{},observationToken:fixtureCompanyToken,isCurrent:(token:object)=>token===fixtureCompanyToken}};
it.each(['loading','missing','error'] as const)('회사설정 %s이면 실제 작성 저장을 보내지 않고 입력과 설정 접근을 유지한다',status=>{
 const read={...companyReadyFixture.companyInfoRead,status},apply=vi.fn();
 setup(undefined,undefined,{composerOnly:true,onApplyStatement:apply,companyInfoRead:read});
 fireEvent.change(screen.getByLabelText('1행 거래 수량'),{target:{value:'3'}});
 fireEvent.click(screen.getByRole('button',{name:'저장'}));
 expect(apply).not.toHaveBeenCalled();expect(appConfirm).not.toHaveBeenCalled();expect(screen.getByLabelText('1행 거래 수량')).toHaveValue('3');
 expect(screen.getByRole('button',{name:'회사 설정 확인'})).toBeEnabled();
});
it('값만 전달하고 read가 없는 production 인쇄는 builder 호출 전에 막는다',async()=>{
 const original=lifecycleStatement();setup(undefined,undefined,{pendingInvoice:null,issuedStatements:[original],detailStatementId:original.id,companyInfoRead:undefined});
 const dialog=await screen.findByRole('dialog',{name:'매출 전표 수정'});
 fireEvent.click(within(dialog).getByRole('button',{name:'거래명세서'}));
 expect(issueMocks.print).not.toHaveBeenCalled();expect(issueMocks.build).not.toHaveBeenCalled();expect(dialog).toBeInTheDocument();
});
it('다른회사 read는 ready여도 발행하지 않는다',()=>{
 const apply=vi.fn();setup(undefined,undefined,{composerOnly:true,onApplyStatement:apply,companyInfoRead:{...companyReadyFixture.companyInfoRead,companyId:'punghoe'}});
 fireEvent.click(screen.getByRole('button',{name:'저장'}));expect(apply).not.toHaveBeenCalled();expect(appConfirm).not.toHaveBeenCalled();
});
it('미확인 설정의 작성창에서 회사설정 모달을 열고 닫아도 초안을 유지한다',async()=>{
 setup(undefined,undefined,{composerOnly:true,companyInfoRead:undefined});fireEvent.change(screen.getByLabelText('1행 거래 수량'),{target:{value:'3'}});
 const composer=screen.getByRole('dialog');fireEvent.click(within(composer).getByRole('button',{name:'회사 설정 확인'}));
 expect(composer).not.toBeInTheDocument();const settings=await screen.findByRole('dialog',{name:/회사/});fireEvent.click(within(settings).getByRole('button',{name:/닫기/}));
 expect(screen.getByLabelText('1행 거래 수량')).toHaveValue('3');
});
it('실제 발행 확인 대기에서 회사정보 관측이 바뀌면 최초 원문을 송신하지 않는다',async()=>{
 const valid=vi.fn(()=>true),apply=vi.fn(),read={...companyReadyFixture.companyInfoRead,isCurrent:valid};
 const duplicate={...lifecycleStatement(),id:'duplicate-company-lease',type:'매입' as const,totalSupply:6000,totalTax:600,totalAmount:6600};
 vi.mocked(appConfirm).mockImplementationOnce(async()=>{valid.mockReturnValue(false);return true;});
 setup(undefined,undefined,{composerOnly:true,issuedStatements:[duplicate],companyInfoRead:read,onApplyStatement:apply});
 fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(appConfirm).toHaveBeenCalledOnce());
 await waitFor(()=>expect(screen.getByText(/회사 정보가 바뀌었습니다/)).toBeInTheDocument());expect(apply).not.toHaveBeenCalled();expect(listTradePendings('taebaek','test-uid')).toHaveLength(0);expect(screen.getByLabelText('1행 거래 수량')).toHaveValue('1');
});
