/** @vitest-environment jsdom */
import React from 'react';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {companyOf} from '../../shared/types';
const source=readFileSync('src/features/admin/AdminApp.tsx','utf8'),start=source.indexOf('  const recoveryDisplayScope='),end=source.indexOf('  // 입고대기 발주카드 수정:',start);
const code=ts.transpileModule(source.slice(start,end)+';return {renderOrderRecovery,orderRecoveryOrphans};',{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
afterEach(cleanup);
const locator={reference:{version:1,companyId:'taebaek',orderId:'missing',requestId:'r'},originalOwnerUid:'other'};
function parent(adminAccess:boolean,scopeOverride?:string){
 const currentUser={id:'employee',adminAccess},scope={companyId:'taebaek',actorUid:'actor',employeeId:'employee',isAdmin:adminAccess},snapshot={scope:scopeOverride??JSON.stringify(scope),copies:[locator],error:''},calls:Record<string,unknown>[]=[];
 const Panel=(props:Record<string,unknown>)=>{calls.push(props);return <button onClick={()=>void (props.onFullRecoverySettled as (value:unknown)=>void)({state:'cancelled'})}>전용 완료</button>;};
 const revision=vi.fn(),legacy=vi.fn(),factory=new Function('React','useRef','companyId','currentUser','cancellationScope','auth','fullRecoverySnapshot','pendingCancellations','processingCancellationIds','pendingRetirementClaims','pendingInventoryRecoveries','OrderInventoryRecoveryPanel','handleDeleteOrder','clearRecoveredOrderCancellation','setCancellationRevision','companyOf','allOrders','orderListRead',code);
 const rendered=factory(React,(value:unknown)=>({current:value}),'taebaek',currentUser,{current:'taebaek:employee'},{currentUser:{uid:'actor'}},snapshot,[],[],[],[],Panel,vi.fn(),legacy,revision,companyOf,[],undefined);
 return{rendered,calls,revision,legacy};
}
it.each([true,false])('직원 UI와 무관하게 검증된 adminAccess=%s를 현재 scope에 쓰고 원소유자 사본 orphan을 연다',adminAccess=>{const p=parent(adminAccess);render(p.rendered.orderRecoveryOrphans);expect(screen.getByText(/원 주문을 찾을 수 없는 처리 기록/)).toBeInTheDocument();expect(p.calls[0].fullRecoveryScope).toEqual({companyId:'taebaek',actorUid:'actor',employeeId:'employee',isAdmin:adminAccess});expect(p.calls[0].fullRecoveryCopies).toEqual([locator]);fireEvent.click(screen.getByRole('button',{name:'전용 완료'}));expect(p.revision).toHaveBeenCalledOnce();expect(p.legacy).not.toHaveBeenCalled();});
it('다른 viewer 범위의 오래된 사본은 목록에 보이지 않는다',()=>{const p=parent(false,'other-scope');expect(p.rendered.orderRecoveryOrphans).toBeNull();expect(p.calls).toHaveLength(0);});

const transport=vi.hoisted(()=>({call:vi.fn(),auth:{currentUser:{uid:'actor'},onAuthStateChanged:()=>()=>{}}}));
vi.mock('../../shared/firebase',()=>({auth:transport.auth,authReady:Promise.resolve(),functions:{},db:{},storage:{}}));
vi.mock('firebase/functions',()=>({httpsCallable:vi.fn(()=>transport.call)}));
vi.mock('../../shared/components/appDialog',async importOriginal=>({...await importOriginal<object>(),appConfirm:vi.fn().mockResolvedValue(true)}));
it('실제 패널과 서비스·사본 저장·세션 수명은 원소유자를 보존하고 terminal에서만 완료를 알린다',async()=>{
 const {default:Panel}=await import('../../../components/OrderInventoryRecoveryPanel');
 const {sessionIdentityLifetime:life,sessionActorKey}=await import('../../shared/sessionIdentityLifetime');
 const service=await import('../../shared/services/orderStockFullService');
 const scope={companyId:'taebaek' as const,actorUid:'actor',employeeId:'employee',isAdmin:true};
 const ref={reference:{version:1 as const,companyId:'taebaek' as const,orderId:'order',requestId:'request'},originalOwnerUid:'other'};
 localStorage.clear();life.dispose();const observation=life.begin('actor');life.resolve(observation,sessionActorKey({uid:'actor',...scope}));
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_k:unknown,_o:unknown,fn:()=>unknown)=>fn()}});
 transport.call.mockReset().mockResolvedValueOnce({data:{version:1,...ref,state:'reserved',canCancel:true,reason:'none',duplicate:false}}).mockResolvedValueOnce({data:{version:1,...ref,state:'cancelled',canCancel:false,reason:'none',duplicate:false}});
 const settled=vi.fn(),copies=vi.fn();
 const row={id:'order',companyId:'taebaek',partnerName:'합성',items:[],status:'PROCESSING',inventoryOperation:{id:'private-stock-full-v1:attempt',state:'processing',startedAt:'2026-10-11',kind:'line',actorUid:'other',fullProtocol:'private-stock-full-v1',fullAttemptId:'attempt',fullReference:ref.reference}};
 render(<Panel companyId="taebaek" actorUid="actor" orders={[row as any]} onRecovered={vi.fn()} fullRecoveryScope={scope} onFullRecoverySettled={settled} onFullRecoveryCopiesChanged={copies}/>);
 fireEvent.click(screen.getByRole('button',{name:'잠금 이유 및 복구'}));
 expect(await screen.findByText('아직 반영되지 않은 요청입니다.')).toBeInTheDocument();expect(settled).not.toHaveBeenCalled();expect(service.readFullRecoveryCopies(scope)).toEqual({kind:'ready',copies:[ref]});
 fireEvent.click(screen.getByRole('button',{name:'미반영 처리 요청 취소'}));
 expect(await screen.findByText(/미반영 처리 요청을 취소했습니다/)).toBeInTheDocument();expect(settled).toHaveBeenCalledOnce();expect(service.readFullRecoveryCopies(scope)).toEqual({kind:'ready',copies:[]});
 expect(transport.call.mock.calls.map(call=>call[0])).toEqual(['inspect','cancel'].map(mode=>({version:1,mode,...ref})));life.dispose();localStorage.clear();
});

vi.mock('../../../components/OrdersList',()=>({default:(props:any)=><div data-testid="orders-stub">{props.orders.map((row:any)=><React.Fragment key={row.id}>{props.renderOrderRecovery(row)}</React.Fragment>)}{props.orderRecoveryOrphans}</div>}));
vi.mock('./hooks/useMenuIdentity',()=>({useMenuIdentity:()=>null}));
vi.mock('./hooks/useMenuPreferencesController',()=>({useMenuPreferencesController:()=>({key:'test',value:{groups:[],items:[]},error:null,change:vi.fn(),reset:vi.fn()})}));
vi.mock('./useProductionSalesHistory',()=>({useProductionSalesHistory:(_:unknown,rows:unknown)=>rows}));
vi.mock('./hooks/useOrderCopyRecovery',()=>({useOrderCopyRecovery:()=>({entries:[],pending:[],recoveries:[],readError:null})}));
it('실제 직원 AdminApp은 권한 scope로 패널을 연결하고 terminal 뒤 목록을 재조회한다',async()=>{
 const {default:AdminApp}=await import('./AdminApp');
 const {sessionIdentityLifetime:life,sessionActorKey}=await import('../../shared/sessionIdentityLifetime');
 const service=await import('../../shared/services/orderStockFullService');
 const scope={companyId:'taebaek' as const,actorUid:'actor',employeeId:'employee',isAdmin:true};
 const ref={reference:{version:1 as const,companyId:'taebaek' as const,orderId:'order',requestId:'request'},originalOwnerUid:'other'};
 localStorage.clear();life.dispose();const observation=life.begin('actor');life.resolve(observation,sessionActorKey({uid:'actor',...scope}));
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_k:unknown,_o:unknown,fn:()=>unknown)=>fn()}});
 transport.call.mockReset().mockResolvedValueOnce({data:{version:1,...ref,state:'reserved',canCancel:true,reason:'none',duplicate:false}}).mockResolvedValueOnce({data:{version:1,...ref,state:'cancelled',canCancel:false,reason:'none',duplicate:false}});
 const row={id:'order',companyId:'taebaek',partnerName:'합성',items:[],status:'PROCESSING',inventoryOperation:{id:'private-stock-full-v1:attempt',state:'processing',startedAt:'2026-10-11',kind:'line',actorUid:'other',fullProtocol:'private-stock-full-v1',fullAttemptId:'attempt',fullReference:ref.reference}};
 const arrays=['orders','historicalOrders','purchaseOrders','items','partnerItems','partners','employees','leaveRequests','pallets','palletTransactions','adjustmentRequests','noticePosts','chatRooms','chatMessages','rawMaterialLedger','sesameInputLedger','appNotifications','workOrderItems','issuedStatements','itemFormulas','itemBoms','returnRequests','itemReceipts','inventorySnapshots','productionSalesLogs','pendingStatementEdits','cashAccounts','cashEntries','fixedCostTemplates','accountCodes','accountGroups','advanceStatements','cashFlowManual','expensePresets','returnAllocationOperations','returnOperations','settlements'];
 const data:any=Object.fromEntries(arrays.map(key=>[key,[]]));data.orders=[row];data.orderUnitInputs={};const retry=vi.fn(()=>{throw Error('조회 실패');});data.orderListRead={retry};
 const read=vi.spyOn(service,'readFullRecoveryCopies');
 render(<AdminApp currentUser={{id:'employee',name:'직원',adminAccess:true} as any} companyId="taebaek" isAdmin={false} isAdminAuthenticated={false} onAdminAuth={vi.fn()} currentView="orders" setCurrentView={vi.fn()} onLogout={vi.fn()} appData={data} adminData={{fixedCosts:[],productionRecords:[]} as any}/>);
 fireEvent.click(await screen.findByRole('button',{name:'잠금 이유 및 복구'}));
 expect(await screen.findByText('아직 반영되지 않은 요청입니다.')).toBeInTheDocument();const before=read.mock.calls.length;expect(retry).not.toHaveBeenCalled();
 const {appConfirm}=await import('../../shared/components/appDialog');vi.mocked(appConfirm).mockResolvedValueOnce(false);
 fireEvent.click(screen.getByRole('button',{name:'미반영 처리 요청 취소'}));await waitFor(()=>expect(screen.getByRole('button',{name:'미반영 처리 요청 취소'})).toBeEnabled());expect(retry).not.toHaveBeenCalled();expect(transport.call).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button',{name:'미반영 처리 요청 취소'}));
 expect(await screen.findByText(/미반영 처리 요청을 취소했습니다/)).toBeInTheDocument();expect(read.mock.calls.length).toBeGreaterThan(before);expect(retry).toHaveBeenCalledOnce();expect(await screen.findByText(/목록을 갱신하지 못했습니다/)).toBeInTheDocument();expect(transport.call.mock.calls.map(call=>call[0])).toEqual(['inspect','cancel'].map(mode=>({version:1,mode,...ref})));life.dispose();localStorage.clear();
},30000);
it.each(['orphan ACK 후 사본 제거','잠금 snapshot 선행 후 ACK','회사 ABA 늦은 ACK'] as const)('열린 실제 Admin 결과창은 %s에서도 terminal을 표시한다',async mode=>{
 const {default:AdminApp}=await import('./AdminApp');
 const {sessionIdentityLifetime:life,sessionActorKey}=await import('../../shared/sessionIdentityLifetime');
 const {writeOwnedCheckpoint}=await import('../../shared/sessionOwnedCheckpointStore');
 const scope={companyId:'taebaek' as const,actorUid:'actor',employeeId:'employee',isAdmin:true};
 const ref={reference:{version:1 as const,companyId:'taebaek' as const,orderId:'order',requestId:'request'},originalOwnerUid:'other'};
 localStorage.clear();life.dispose();const observation=life.begin('actor');life.resolve(observation,sessionActorKey({uid:'actor',...scope}));
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_k:unknown,_o:unknown,fn:()=>unknown)=>fn()}});
 const row={id:'order',companyId:'taebaek',partnerName:'합성',items:[],status:'PROCESSING',inventoryOperation:{id:'private-stock-full-v1:attempt',state:'processing',startedAt:'2026-10-11',kind:'line',actorUid:'other',fullProtocol:'private-stock-full-v1',fullAttemptId:'attempt',fullReference:ref.reference}};
 if(mode==='orphan ACK 후 사본 제거')await writeOwnedCheckpoint({uid:'actor',companyId:'taebaek',employeeId:'employee'},'order-stock-full-recovery-v1',null,[ref],(value):value is typeof ref[]=>Array.isArray(value));
 let release!:(value:unknown)=>void;transport.call.mockReset().mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
 const arrays=['orders','historicalOrders','purchaseOrders','items','partnerItems','partners','employees','leaveRequests','pallets','palletTransactions','adjustmentRequests','noticePosts','chatRooms','chatMessages','rawMaterialLedger','sesameInputLedger','appNotifications','workOrderItems','issuedStatements','itemFormulas','itemBoms','returnRequests','itemReceipts','inventorySnapshots','productionSalesLogs','pendingStatementEdits','cashAccounts','cashEntries','fixedCostTemplates','accountCodes','accountGroups','advanceStatements','cashFlowManual','expensePresets','returnAllocationOperations','returnOperations','settlements'];
 const data:any=Object.fromEntries(arrays.map(key=>[key,[]]));data.orders=mode==='orphan ACK 후 사본 제거'?[]:[row];data.orderUnitInputs={};data.orderListRead={retry:vi.fn()};
 const props:any={currentUser:{id:'employee',name:'직원',adminAccess:true},companyId:'taebaek',isAdmin:false,isAdminAuthenticated:false,onAdminAuth:vi.fn(),currentView:'orders',setCurrentView:vi.fn(),onLogout:vi.fn(),appData:data,adminData:{fixedCosts:[],productionRecords:[]}};
 const view=render(<AdminApp {...props}/>);const launch=await screen.findByRole('button',{name:'잠금 이유 및 복구'});fireEvent.click(launch);fireEvent.click(launch);await waitFor(()=>expect(transport.call).toHaveBeenCalledOnce());
 if(mode==='회사 ABA 늦은 ACK'){view.rerender(<AdminApp {...props} companyId="punghoe"/>);expect(screen.queryByRole('dialog',{name:'주문 재고 작업 확인'})).toBeNull();view.rerender(<AdminApp {...props}/>);await act(async()=>release({data:{version:1,...ref,state:'cancelled',canCancel:false,reason:'none',duplicate:false}}));expect(screen.queryByText(/미반영 처리 요청을 취소했습니다/)).toBeNull();expect(screen.queryByRole('dialog',{name:'주문 재고 작업 확인'})).toBeNull();life.dispose();localStorage.clear();return;}
 if(mode==='잠금 snapshot 선행 후 ACK'){view.rerender(<AdminApp {...props} appData={{...data,orders:[{...row,inventoryOperation:null}]}}/>);expect(screen.getByRole('dialog',{name:'주문 재고 작업 확인'})).toBeInTheDocument();}
 await act(async()=>release({data:{version:1,...ref,state:'cancelled',canCancel:false,reason:'none',duplicate:false}}));
 expect(await screen.findByText(/미반영 처리 요청을 취소했습니다/)).toBeInTheDocument();expect(screen.getByRole('dialog',{name:'주문 재고 작업 확인'})).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'주문으로 돌아가기'}));expect(screen.queryByRole('dialog',{name:'주문 재고 작업 확인'})).toBeNull();expect(transport.call).toHaveBeenCalledOnce();
 life.dispose();localStorage.clear();
},30000);
