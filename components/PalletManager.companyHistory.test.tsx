// JSDOM에는 펼친 목록의 스크롤 API가 없어 브라우저 동작만 대체한다.
/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CompanyId, PalletTransaction } from '../src/shared/types';
HTMLElement.prototype.scrollIntoView = vi.fn();
const registration = vi.hoisted(() => ({entries:[] as unknown[],prepare:vi.fn(),command:vi.fn()}));
const service = vi.hoisted(() => ({ fetchDateRange: vi.fn(), updateItem: vi.fn(), deleteItem: vi.fn() }));
vi.mock('../src/shared/services/firebaseService', () => service);
vi.mock('../src/shared/firebase', () => ({ auth: { currentUser: { uid: 'pallet-test-uid' } } }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, callback: (user: {uid: string}) => void) => { callback({uid:'pallet-test-uid'}); return () => {}; } }));
vi.mock('../src/shared/services/palletTransactionWrites', () => ({ default: { read: async () => registration.entries, prepare: registration.prepare, command: registration.command, findMatching: () => null, projection: (entry: import('../src/shared/services/palletTransactionWrites').PalletTransactionEntry, results: import('../src/shared/palletTransactionCommand').PalletTransactionResult[]) => {const terminal=results.some(row=>JSON.stringify(row.reference)===JSON.stringify(entry.reference));return {currentState:terminal?'처리됨':'결과 확인 필요',cause:entry.lastAttempt?.message??'',nextAction:'처리 결과를 확인해 주세요.',isUnresolved:!terminal,terminal,referenceRows:entry.references.map(row=>({...row,result:undefined,terminal,label:'보관된 요청',currentState:'결과 확인',cause:'',nextAction:'확인해 주세요.',canInspect:true,canCancel:!terminal})),canRetry:!terminal,canCancel:!terminal,canInspect:true,canDiscard:terminal,canUpgradeReference:false};} } }));
vi.mock('../src/shared/components/appDialog', () => ({ appConfirm: async () => true }));
vi.mock('firebase/firestore', () => ({ where: (field: string, op: string, value: string) => ({ field, op, value }) }));
const pending = () => { let resolve!: (rows: PalletTransaction[]) => void; const promise = new Promise<PalletTransaction[]>(done => { resolve = done; }); return { promise, resolve }; };
const row = (companyId: CompanyId, note: string): PalletTransaction[] => [{ id: `${companyId}-tx`, companyId, partnerId: 'partner', palletId: 'pallet', type: 'out', quantity: 3, date: new Date().toISOString().slice(0,10), note } as PalletTransaction];
const props = { pallets: [], orders: [], partners: [], palletTransactions: [], onUpdatePallet: vi.fn(), onAddPalletTransaction: vi.fn() };
beforeEach(() => { vi.resetModules(); service.fetchDateRange.mockReset(); service.updateItem.mockClear(); service.deleteItem.mockClear();registration.entries=[];registration.command.mockReset();registration.prepare.mockReset().mockImplementation(async(_scope,request,_current,own)=>{const entry={key:'ui-entry',bodyRaw:JSON.stringify(request),referenceRaw:JSON.stringify(request.reference),request,reference:request.reference,transaction:request.transaction,references:[{reference:request.reference,source:'both'}],requestHash:'a'.repeat(64),lastAttempt:null,legacy:false,status:'valid',description:'등록 요청'};registration.entries=[entry];own?.(entry);return entry;}); });
const openHistory = () => fireEvent.click(screen.getByRole('button', { name: /^이력$/ }));
it('제목·보기탭·행동·검색을 분리하고 탭 변경으로 지급 입력이나 writer를 실행하지 않는다',async()=>{
 service.fetchDateRange.mockResolvedValue([]);const {default:Manager}=await import('./PalletManager');render(<Manager {...props} companyId="taebaek"/>);
 const title=screen.getByRole('heading',{name:'파렛트 관리'}),tab=screen.getByRole('button',{name:'거래처별'}),action=screen.getByRole('button',{name:'신규 입고'}),search=screen.getByPlaceholderText('거래처 검색...');
 for(const [before,after] of [[title,tab],[tab,action],[action,search]])expect(before.compareDocumentPosition(after)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(action).toHaveClass('h-9');expect(search).toHaveClass('h-10');
 expect(screen.getByRole('region',{name:'검색조건'})).toContainElement(search);expect(screen.getByLabelText('거래처')).toBe(search);
 fireEvent.change(search,{target:{value:'검수'}});fireEvent.click(screen.getByRole('button',{name:'교체'}));expect(screen.getByRole('dialog',{name:'파렛트 교체'})).toBeInTheDocument();expect(screen.getByPlaceholderText('회수 예정')).toHaveValue(0);fireEvent.click(screen.getByRole('button',{name:'취소'}));expect(search).toHaveValue('검수');openHistory();expect(screen.queryByRole('button',{name:'신규 입고'})).toBeNull();expect(screen.getByPlaceholderText('거래처 검색')).toHaveClass('h-10');expect(screen.getByPlaceholderText('거래처 검색').parentElement).toHaveClass('relative');expect(props.onAddPalletTransaction).not.toHaveBeenCalled();expect(service.updateItem).not.toHaveBeenCalled();
});

it('과거 조회는 회사 조건을 서버에 전달한다', async () => {
  service.fetchDateRange.mockResolvedValue([]);
  const { default: Manager } = await import('./PalletManager');
  render(<Manager {...props} companyId="punghoe" />);
  expect(service.fetchDateRange.mock.calls[0]?.[4]).toEqual([{ field: 'companyId', op: '==', value: 'punghoe' }]);
});
it('이전 회사의 늦은 응답이 새 회사 과거 이력을 덮지 않는다', async () => {
  const a = pending(), b = pending(); service.fetchDateRange.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const { default: Manager } = await import('./PalletManager');
  const view = render(<Manager {...props} companyId="taebaek" />);
  view.rerender(<Manager {...props} companyId="punghoe" />); openHistory();
  await act(async () => b.resolve(row('punghoe', '풍회 이력')));
  expect(screen.getByText('풍회 이력')).toBeInTheDocument();
  await act(async () => a.resolve(row('taebaek', '태백 늦은 이력')));
  expect(screen.queryByText('태백 늦은 이력')).not.toBeInTheDocument();
  expect(screen.getByText('풍회 이력')).toBeInTheDocument();
});
it('같은 회사 캐시는 재사용하지만 다른 회사에는 노출하지 않는다', async () => {
  service.fetchDateRange.mockResolvedValueOnce(row('taebaek', '태백 캐시')).mockResolvedValueOnce(row('punghoe', '풍회 캐시'));
  const { default: Manager } = await import('./PalletManager');
  let view = render(<Manager {...props} companyId="taebaek" />); await act(async () => {}); openHistory();
  expect(screen.getByText('태백 캐시')).toBeInTheDocument(); view.unmount();
  view = render(<Manager {...props} companyId="taebaek" />); openHistory();
  expect(screen.getByText('태백 캐시')).toBeInTheDocument(); expect(service.fetchDateRange).toHaveBeenCalledTimes(1); view.unmount();
  render(<Manager {...props} companyId="punghoe" />); openHistory();
  expect(screen.queryByText('태백 캐시')).not.toBeInTheDocument(); await act(async () => {});
  expect(screen.getByText('풍회 캐시')).toBeInTheDocument(); expect(service.fetchDateRange).toHaveBeenCalledTimes(2);
  expect(service.updateItem).not.toHaveBeenCalled(); expect(service.deleteItem).not.toHaveBeenCalled();
});
it('정상 거래 삭제 후 같은 회사 캐시에도 삭제가 반영된다', async () => {
  service.fetchDateRange.mockResolvedValue(row('taebaek', '삭제할 이력'));
  service.deleteItem.mockResolvedValue(undefined);
  const { default: Manager } = await import('./PalletManager');
  const view = render(<Manager {...props} companyId="taebaek" />); await act(async () => {}); openHistory();
  fireEvent.click(screen.getByTitle('거래 삭제(정정)'));
  await waitFor(() => expect(screen.queryByText('삭제할 이력')).not.toBeInTheDocument());
  expect(service.deleteItem).toHaveBeenCalledWith('palletTransactions', 'taebaek-tx');
  view.unmount(); render(<Manager {...props} companyId="taebaek" />); openHistory();
  expect(screen.queryByText('삭제할 이력')).not.toBeInTheDocument();
  expect(service.fetchDateRange).toHaveBeenCalledTimes(1);
});

afterEach(() => vi.useRealTimers());

it.each([
 ['월말', '2026-10-31T23:59:00', '2026-11-01T00:01:00', '2026-10', '2026-11'],
 ['연말', '2026-12-31T23:59:00', '2027-01-01T00:01:00', '2026-12', '2027-01'],
])('%s 같은 props 재렌더는 새달 옵션을 추가하고 빈자료의 이전 선택월을 유지한다', async (_label,before,after,oldMonth,newMonth) => {
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(before));service.fetchDateRange.mockResolvedValue([]);
 const {default:Manager}=await import('./PalletManager');const stableProps={...props,companyId:'taebaek' as const};const view=render(<Manager {...stableProps}/>);await act(async()=>{});openHistory();
 expect(screen.getByRole('button',{name:'기간'})).toHaveTextContent(oldMonth.slice(0,4)+'년 '+oldMonth.slice(5)+'월');
 vi.setSystemTime(new Date(after));view.rerender(<Manager {...stableProps}/>);
 fireEvent.click(screen.getByRole('button',{name:'기간'}));expect(screen.getByRole('option',{name:newMonth.slice(0,4)+'년 '+newMonth.slice(5)+'월'})).toBeInTheDocument();expect(screen.getByRole('button',{name:'기간'})).toHaveTextContent(oldMonth.slice(0,4)+'년 '+oldMonth.slice(5)+'월');
 expect(screen.getByRole('option',{name:oldMonth.slice(0,4)+'년 '+oldMonth.slice(5)+'월'})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('option',{name:newMonth.slice(0,4)+'년 '+newMonth.slice(5)+'월'}));expect(screen.getByRole('button',{name:'기간'})).toHaveTextContent(newMonth.slice(0,4)+'년 '+newMonth.slice(5)+'월');
 expect(service.updateItem).not.toHaveBeenCalled();expect(service.deleteItem).not.toHaveBeenCalled();expect(props.onUpdatePallet).not.toHaveBeenCalled();expect(props.onAddPalletTransaction).not.toHaveBeenCalled();
});
it('전체 기간 선택도 달 전환 재렌더 후 유지하며 새달만 추가한다',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-31T23:59:00'));service.fetchDateRange.mockResolvedValue([]);const {default:Manager}=await import('./PalletManager');const view=render(<Manager {...props} companyId="taebaek"/>);await act(async()=>{});openHistory();fireEvent.click(screen.getByRole('button',{name:'기간'}));fireEvent.click(screen.getByRole('option',{name:'전체 기간'}));vi.setSystemTime(new Date('2026-11-01T00:01:00'));view.rerender(<Manager {...props} companyId="taebaek"/>);expect(screen.getByRole('button',{name:'기간'})).toHaveTextContent('전체 기간');fireEvent.click(screen.getByRole('button',{name:'기간'}));expect(screen.getByRole('option',{name:'2026년 11월'})).toBeInTheDocument();expect(service.updateItem).not.toHaveBeenCalled();expect(service.deleteItem).not.toHaveBeenCalled();
});

const registrationProps={...props,pallets:[{id:'pallet',name:'파렛트',total:100,inUse:0,damaged:0}],partners:[{id:'partner',name:'거래처'}] as React.ComponentProps<typeof import('./PalletManager').default>['partners']};
function submitRegistration(){fireEvent.click(screen.getByRole('button',{name:'신규 입고'}));const form=screen.getByRole('dialog',{name:'파렛트 신규 입고'}).querySelector('form')!;fireEvent.change(form.querySelector('[name="partnerId"]')!,{target:{value:'partner'}});fireEvent.change(form.querySelector('[name="palletId"]')!,{target:{value:'pallet'}});fireEvent.change(screen.getByPlaceholderText('수량 입력'),{target:{value:'7'}});fireEvent.change(screen.getByPlaceholderText('사유 등 입력'),{target:{value:'보존할 입력'}});fireEvent.click(screen.getByRole('button',{name:'입고 완료'}));}
it('실 등록은 원자 서비스 ACK까지 창·입력을 보존하고 generic 두 쓰기를 호출하지 않는다',async()=>{
 service.fetchDateRange.mockResolvedValue([]);let finish!:(value:unknown)=>void;registration.command.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const {default:Manager}=await import('./PalletManager');render(<Manager {...registrationProps} companyId="taebaek"/>);await act(async()=>{});submitRegistration();await waitFor(()=>expect(registration.command).toHaveBeenCalledOnce());expect(screen.getByRole('dialog',{name:'파렛트 신규 입고'})).toBeInTheDocument();expect(screen.getByPlaceholderText('수량 입력')).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'파렛트 신규 입고 닫기'}));expect(screen.getByPlaceholderText('수량 입력')).toHaveValue(7);expect(props.onAddPalletTransaction).not.toHaveBeenCalled();expect(props.onUpdatePallet).not.toHaveBeenCalled();const entry=registration.command.mock.calls[0][1];await act(async()=>finish({entry,result:{version:1,reference:entry.reference,actorUid:'pallet-test-uid',status:'applied',requestHash:'a'.repeat(64),message:'완료'},terminal:true}));expect(screen.queryByRole('dialog',{name:'파렛트 신규 입고'})).not.toBeInTheDocument();
});
it('등록 응답 유실은 원문을 보존하고 모달 안 실패 진입에서만 긴 원인을 표시한다',async()=>{
 service.fetchDateRange.mockResolvedValue([]);registration.command.mockImplementationOnce(async(_scope,entry,_mode,_current,_reference,own)=>{const next={...entry,referenceRaw:'자기 갱신 참조',lastAttempt:{at:'now',outcome:'unconfirmed',message:'등록 응답 유실 상세'}};registration.entries=[next];own(next);throw Error('등록 응답 유실 상세');});const {default:Manager}=await import('./PalletManager');render(<Manager {...registrationProps} companyId="taebaek"/>);await act(async()=>{});submitRegistration();await waitFor(()=>expect(screen.getByRole('button',{name:'실패 1'})).toBeInTheDocument());expect(screen.getByPlaceholderText('사유 등 입력')).toHaveValue('보존할 입력');expect(screen.queryByText('등록 응답 유실 상세')).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'실패 1'}));const recovery=screen.getByRole('dialog',{name:'파렛트 등록 처리 확인'});expect(recovery.parentElement).toHaveStyle({zIndex:1100});expect(screen.getByText('등록 응답 유실 상세')).toBeInTheDocument();
});
