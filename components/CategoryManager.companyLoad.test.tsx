/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import CategoryManager from './CategoryManager';
import {DEFAULT_CATEGORY_LABELS,CATEGORY_KEYS,type TaxonomyRow} from '../src/shared/taxonomy';
const testAuth=vi.hoisted(()=>({currentUser:{uid:'taxonomy-actor'}}));
vi.mock('../src/shared/firebase',()=>({auth:testAuth,authReady:Promise.resolve(),db:{}}));
const orderWrites=vi.hoisted(()=>({commit:vi.fn(),commitType:vi.fn()}));
vi.mock('../src/features/items/infrastructure/taxonomyOrderWrites',async importOriginal=>{const actual=await importOriginal<typeof import('../src/features/items/infrastructure/taxonomyOrderWrites')>();return {...actual,commitTaxonomyOrder:orderWrites.commit,commitTaxonomyType:orderWrites.commitType};});

const service = vi.hoisted(() => ({ fetchCollection: vi.fn(), addItem: vi.fn(), updateItem: vi.fn(), deleteItem: vi.fn() }));
vi.mock('../src/shared/services/firebaseService', () => service);
const dialog=vi.hoisted(()=>({appConfirm:vi.fn()}));
vi.mock('../src/shared/components/appDialog',()=>dialog);
const deferred = () => {
  let resolve!: (rows: unknown[]) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<unknown[]>((done, fail) => { resolve = done; reject = fail; });
  return { resolve, reject, promise };
};
const row = (companyId: string, label: string) => [{ id: companyId, companyId, kind: 'type', key: 'product', label, order: 0 }];
beforeEach(() => {
  testAuth.currentUser.uid='taxonomy-actor';orderWrites.commit.mockReset().mockImplementation(async plan=>plan.operations.map((op:{kind:string;id:string;order?:number;data?:Record<string,unknown>})=>op.kind==='create'?{...op.data,id:op.id}:{...arranged.find(row=>row.id===op.id),id:op.id,order:op.order}));
  orderWrites.commitType.mockReset().mockImplementation(async change=>({id:'fixed-'+change.companyId+'-'+change.key,kind:'type',key:change.key,label:change.label??DEFAULT_CATEGORY_LABELS[change.key],order:CATEGORY_KEYS.indexOf(change.key),hidden:change.hidden}));
  service.fetchCollection.mockReset();
  dialog.appConfirm.mockReset();
  service.addItem.mockClear(); service.updateItem.mockClear(); service.deleteItem.mockClear();
});

it('이전 회사 분류의 늦은 응답이 현재 회사 편집 목록을 덮지 않는다', async () => {
  const previous = deferred(); const current = deferred();
  service.fetchCollection.mockReset().mockReturnValueOnce(previous.promise).mockReturnValueOnce(current.promise);
  const props = { onClose: vi.fn() };
  const view = render(<CategoryManager {...props} companyId="taebaek" />);
  view.rerender(<CategoryManager {...props} companyId="punghoe" />);
  await act(async () => current.resolve(row('punghoe', '풍회 현재 분류')));
  expect(screen.getByDisplayValue('풍회 현재 분류')).toBeInTheDocument();
  await act(async () => previous.resolve(row('taebaek', '태백 이전 분류')));
  expect(screen.getByDisplayValue('풍회 현재 분류')).toBeInTheDocument();
  expect(screen.queryByDisplayValue('태백 이전 분류')).not.toBeInTheDocument();
  expect(service.addItem).not.toHaveBeenCalled();
  expect(service.updateItem).not.toHaveBeenCalled();
});

it('회사 전환은 이전 분류와 입력 초안을 비우고 현재 회사 자료만 닫기 결과로 넘긴다', async () => {
  const previous = deferred(); const current = deferred();
  service.fetchCollection.mockReturnValueOnce(previous.promise).mockReturnValueOnce(current.promise);
  const onSaved = vi.fn(); const onClose = vi.fn();
  const view = render(<CategoryManager onClose={onClose} onSaved={onSaved} companyId="taebaek" />);
  await act(async () => previous.resolve(row('taebaek', '태백 이전 분류')));
  fireEvent.change(screen.getAllByPlaceholderText('추가')[0], { target: { value: '이전 회사 초안' } });
  view.rerender(<CategoryManager onClose={onClose} onSaved={onSaved} companyId="punghoe" />);
  expect(screen.queryByDisplayValue('태백 이전 분류')).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('이전 회사 초안')).not.toBeInTheDocument();
  expect(screen.getByText('불러오는 중…')).toBeInTheDocument();
  await act(async () => current.resolve(row('punghoe', '풍회 현재 분류')));
  expect(screen.getAllByPlaceholderText('추가').every(input => (input as HTMLInputElement).value === '')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: /^닫기$/ }));
  expect(onSaved).toHaveBeenCalledExactlyOnceWith(row('punghoe', '풍회 현재 분류'));
  expect(service.addItem).not.toHaveBeenCalled();
  expect(service.updateItem).not.toHaveBeenCalled();
});

it('이전 회사 조회의 늦은 오류와 finally가 현재 회사 로딩을 끝내거나 실패로 바꾸지 않는다', async () => {
  const previous = deferred(); const current = deferred();
  service.fetchCollection.mockReturnValueOnce(previous.promise).mockReturnValueOnce(current.promise);
  const view = render(<CategoryManager onClose={vi.fn()} companyId="taebaek" />);
  view.rerender(<CategoryManager onClose={vi.fn()} companyId="punghoe" />);
  await act(async () => previous.reject(new Error('옛 조회 실패')));
  expect(screen.getByText('불러오는 중…')).toBeInTheDocument();
  expect(screen.queryByText('분류를 불러오지 못했습니다. 다시 시도해 주세요.')).not.toBeInTheDocument();
  await act(async () => current.resolve(row('punghoe', '풍회 현재 분류')));
  expect(screen.getByDisplayValue('풍회 현재 분류')).toBeInTheDocument();
  expect(service.addItem).not.toHaveBeenCalled();
});

it('현재 조회 실패 후 재시도는 그대로 유지하며 비어 있지 않은 회사 자료를 읽는다', async () => {
  const failed = deferred(); const retried = deferred();
  service.fetchCollection.mockReturnValueOnce(failed.promise).mockReturnValueOnce(retried.promise);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  render(<CategoryManager onClose={vi.fn()} companyId="taebaek" />);
  await act(async () => failed.reject(new Error('조회 실패')));
  fireEvent.click(screen.getByRole('button', { name: /다시/ }));
  await act(async () => retried.resolve(row('taebaek', '태백 현재 분류')));
  expect(screen.getByDisplayValue('태백 현재 분류')).toBeInTheDocument();
  expect(service.addItem).not.toHaveBeenCalled();
});

const confirmDeferred=()=>{let resolve!:(yes:boolean)=>void;const promise=new Promise<boolean>(done=>{resolve=done;});return {resolve,promise};};
async function openConfirm(action:'숨김'|'삭제') {
 service.fetchCollection.mockImplementation(async()=>[...row('taebaek','태백 타입'),{id:'sub-A',companyId:'taebaek',kind:'subtype',parent:'product',label:'태백 하위분류',order:0}]);
 const view=render(<CategoryManager onClose={vi.fn()} companyId="taebaek" usage={{'type:product':1}} />);
 const input=await screen.findByDisplayValue('태백 하위분류');
 if(action==='숨김')fireEvent.click(screen.getAllByTitle('안 씀 (숨김)')[0]);else fireEvent.click(input.closest('div')!.querySelectorAll('button')[2]);
 expect(dialog.appConfirm).toHaveBeenCalledOnce();return view;
}
it.each(['숨김','삭제'] as const)('분류 %s 확인 중 회사 전환은 이전 회사 저장을 시작하지 않는다',async action=>{
 const confirm=confirmDeferred();dialog.appConfirm.mockReturnValue(confirm.promise);const view=await openConfirm(action);
 view.rerender(<CategoryManager onClose={vi.fn()} companyId="punghoe" />);await act(async()=>confirm.resolve(true));
 expect(service.updateItem).not.toHaveBeenCalled();expect(service.deleteItem).not.toHaveBeenCalled();expect(service.addItem).not.toHaveBeenCalled();
});
it.each(['숨김','삭제'] as const)('현재 회사 분류 %s 승인은 정상 저장하고 취소는 쓰지 않는다',async action=>{
 const confirm=confirmDeferred();dialog.appConfirm.mockReturnValue(confirm.promise);await openConfirm(action);await act(async()=>confirm.resolve(true));
 if(action==='숨김'){expect(service.updateItem).toHaveBeenCalledWith('itemTaxonomy','taebaek',{hidden:true});expect(screen.getByTitle('다시 쓰기')).toBeInTheDocument();}else{expect(service.deleteItem).toHaveBeenCalledWith('itemTaxonomy','sub-A');expect(screen.queryByDisplayValue('태백 하위분류')).not.toBeInTheDocument();}
});
it.each(['숨김','삭제'] as const)('현재 회사 분류 %s 확인 취소는 저장하지 않는다',async action=>{
 const confirm=confirmDeferred();dialog.appConfirm.mockReturnValue(confirm.promise);await openConfirm(action);await act(async()=>confirm.resolve(false));expect(service.updateItem).not.toHaveBeenCalled();expect(service.deleteItem).not.toHaveBeenCalled();expect(screen.getByDisplayValue('태백 하위분류')).toBeInTheDocument();
});
it.each(['숨김','삭제'] as const)('분류 %s 저장의 늦은 성공은 현재 회사 편집 자료를 유지한다',async action=>{
 const save=deferred();service.updateItem.mockImplementation(()=>save.promise);service.deleteItem.mockImplementation(()=>save.promise);dialog.appConfirm.mockResolvedValue(true);const view=await openConfirm(action);await waitFor(()=>expect(action==='숨김'?service.updateItem:service.deleteItem).toHaveBeenCalledOnce());
 service.fetchCollection.mockResolvedValue(row('punghoe','풍회 유지'));view.rerender(<CategoryManager onClose={vi.fn()} companyId="punghoe" />);await screen.findByDisplayValue('풍회 유지');await act(async()=>save.resolve([]));expect(screen.getByDisplayValue('풍회 유지')).toBeInTheDocument();expect(screen.queryByDisplayValue('태백 타입')).not.toBeInTheDocument();
});

const arranged:(TaxonomyRow & {companyId:'taebaek'})[]=[{id:'type-product',companyId:'taebaek',kind:'type',key:'product',label:'제품',order:0},{id:'sub-first',companyId:'taebaek',kind:'subtype',parent:'product',label:'첫 분류',order:0},{id:'sub-second',companyId:'taebaek',kind:'subtype',parent:'product',label:'둘째 분류',order:1}];
function writeGate(){let resolve!:(rows:TaxonomyRow[])=>void;const promise=new Promise<TaxonomyRow[]>(done=>{resolve=done;});return {promise,resolve};}
async function mountOrdered(onSaved=vi.fn()){
 service.fetchCollection.mockResolvedValue(arranged.map(row=>({...row})));const close=vi.fn(),view=render(<CategoryManager companyId="taebaek" onClose={close} onSaved={onSaved}/>);await screen.findByDisplayValue('첫 분류');return {view,close,onSaved};
}
it('순서 ACK 대기 중 모든 변경을 잠그고 같은 클릭을 중복 송신하지 않는다',async()=>{
 const gate=writeGate();orderWrites.commit.mockReturnValue(gate.promise);const {onSaved}=await mountOrdered();const down=screen.getByRole('button',{name:'첫 분류 순서 아래로'});fireEvent.click(down);fireEvent.click(down);expect(orderWrites.commit).toHaveBeenCalledOnce();expect(screen.getByRole('status')).toHaveTextContent('분류를 저장하고 있습니다. 완료 응답을 기다려 주세요.');expect(screen.getByDisplayValue('첫 분류')).toBeDisabled();expect(screen.getAllByPlaceholderText('추가').every(input=>(input as HTMLInputElement).disabled)).toBe(true);expect(screen.getAllByTitle('안 씀 (숨김)').every(button=>(button as HTMLButtonElement).disabled)).toBe(true);
 await act(async()=>gate.resolve(arranged.map(row=>row.id==='sub-first'?{...row,order:1}:row.id==='sub-second'?{...row,order:0}:{...row})));fireEvent.click(screen.getByRole('button',{name:/^닫기$/}));expect(onSaved.mock.calls[0][0]).toEqual(expect.arrayContaining([expect.objectContaining({id:'sub-first',order:1}),expect.objectContaining({id:'sub-second',order:0})]));expect(service.updateItem).not.toHaveBeenCalled();
});
it('저장 전 이름 초안은 닫기 결과에 섞지 않고 마지막 확인 사본만 전달한다',async()=>{
 const {onSaved}=await mountOrdered();fireEvent.change(screen.getByDisplayValue('제품'),{target:{value:'미저장 새 이름'}});fireEvent.click(screen.getByRole('button',{name:/^닫기$/}));expect(onSaved).toHaveBeenCalledWith(arranged);expect(service.updateItem).not.toHaveBeenCalled();
});
it('순서 미확인은 자동 재송신하지 않고 최신 목록 조회 뒤 별도 명시 이동을 허용한다',async()=>{
 orderWrites.commit.mockRejectedValueOnce(new Error('응답 유실'));await mountOrdered();fireEvent.click(screen.getByRole('button',{name:'첫 분류 순서 아래로'}));const reload=await screen.findByRole('button',{name:'최신 목록 다시 읽기'});expect(screen.getByRole('status')).toHaveTextContent(/확인/);expect(screen.getByRole('button',{name:'첫 분류 순서 아래로'})).toBeDisabled();expect(orderWrites.commit).toHaveBeenCalledOnce();
 service.fetchCollection.mockResolvedValue(arranged.map(row=>row.id==='sub-first'?{...row,order:1}:row.id==='sub-second'?{...row,order:0}:{...row}));fireEvent.click(reload);const up=await screen.findByRole('button',{name:'첫 분류 순서 위로'});await waitFor(()=>expect(up).toBeEnabled());fireEvent.click(up);await waitFor(()=>expect(orderWrites.commit).toHaveBeenCalledTimes(2));
});
it('동일 회사 UID 전환은 이전 조회와 seed 후속을 폐기한다',async()=>{
 const previous=deferred(),current=deferred();service.fetchCollection.mockReturnValueOnce(previous.promise).mockReturnValueOnce(current.promise);const view=render(<CategoryManager companyId="taebaek" onClose={vi.fn()}/>);testAuth.currentUser.uid='taxonomy-other';view.rerender(<CategoryManager companyId="taebaek" onClose={vi.fn()}/>);await act(async()=>current.resolve(row('taebaek','새 계정 분류')));await act(async()=>previous.resolve([]));expect(screen.getByDisplayValue('새 계정 분류')).toBeInTheDocument();expect(service.addItem).not.toHaveBeenCalled();
});
it('숨김 확인 대기는 공용 잠금을 잡고 UID 교체 후 이전 저장을 시작하지 않는다',async()=>{
 const confirm=confirmDeferred();dialog.appConfirm.mockReturnValue(confirm.promise);service.fetchCollection.mockResolvedValue(arranged);const view=render(<CategoryManager companyId="taebaek" usage={{'type:product':1}} onClose={vi.fn()}/>);await screen.findByDisplayValue('첫 분류');fireEvent.click(screen.getAllByTitle('안 씀 (숨김)')[0]);expect(screen.getByRole('button',{name:'첫 분류 순서 아래로'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'첫 분류 순서 아래로'}));expect(orderWrites.commit).not.toHaveBeenCalled();testAuth.currentUser.uid='taxonomy-other';view.rerender(<CategoryManager companyId="taebaek" onClose={vi.fn()}/>);await act(async()=>confirm.resolve(true));expect(service.updateItem).not.toHaveBeenCalled();
});
it('대기 중 명시 닫기는 확인 사본만 반환하고 늦은 순서 ACK로 닫기 결과를 바꾸지 않는다',async()=>{
 const gate=writeGate();orderWrites.commit.mockReturnValue(gate.promise);const {onSaved,close}=await mountOrdered();fireEvent.click(screen.getByRole('button',{name:'첫 분류 순서 아래로'}));fireEvent.click(screen.getByRole('button',{name:/^닫기$/}));expect(onSaved).toHaveBeenCalledExactlyOnceWith(arranged);expect(close).toHaveBeenCalledOnce();await act(async()=>gate.resolve(arranged));expect(onSaved).toHaveBeenCalledExactlyOnceWith(arranged);
});

it('순서 ACK로 생성된 타입은 임시 초안을 치환하고 실제 생성 사본만 닫기에 전달한다',async()=>{
 const {onSaved}=await mountOrdered();fireEvent.change(screen.getByDisplayValue('원료'),{target:{value:'실제 저장될 원료 이름'}});fireEvent.click(screen.getByRole('button',{name:'제품 타입 아래로'}));await waitFor(()=>expect(orderWrites.commit).toHaveBeenCalledOnce());await waitFor(()=>expect(screen.getByDisplayValue('실제 저장될 원료 이름')).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:/^닫기$/}));const saved:TaxonomyRow[]=onSaved.mock.calls[0][0];expect(saved.some(row=>row.id.startsWith('tmp-'))).toBe(false);expect(saved.filter(row=>row.key==='raw')).toEqual([expect.objectContaining({label:'실제 저장될 원료 이름',kind:'type'})]);
});

it('빈 목록 seed 타입은 같은 공용 helper로 읽은 실제 ACK를 사용한다',async()=>{
 service.fetchCollection.mockResolvedValue([]);service.addItem.mockResolvedValue('seed-child');orderWrites.commitType.mockImplementation(async change=>({id:'fixed-'+change.key,kind:'type',key:change.key,label:change.key==='raw'?'이미 있던 원료':DEFAULT_CATEGORY_LABELS[change.key],order:CATEGORY_KEYS.indexOf(change.key),hidden:change.key==='raw'}));const saved=vi.fn();render(<CategoryManager companyId="taebaek" onClose={vi.fn()} onSaved={saved}/>);await screen.findByDisplayValue('이미 있던 원료');expect(orderWrites.commitType).toHaveBeenCalledTimes(6);expect(orderWrites.commitType.mock.calls.every(call=>call[0].mode==='seed')).toBe(true);expect(service.addItem.mock.calls.some(call=>call[1].kind==='type')).toBe(false);fireEvent.click(screen.getByRole('button',{name:/^닫기$/}));expect(saved.mock.calls[0][0]).toEqual(expect.arrayContaining([expect.objectContaining({id:'fixed-raw',label:'이미 있던 원료',hidden:true})]));
});
it('누락 타입 이름 저장은 결정 ID helper의 실제 snapshot을 확인 사본에 반영한다',async()=>{
 const {onSaved}=await mountOrdered();orderWrites.commitType.mockResolvedValue({id:'fixed-raw',kind:'type',key:'raw',label:'새 원료명',order:8,hidden:true});const input=screen.getByDisplayValue('원료');fireEvent.change(input,{target:{value:'새 원료명'}});fireEvent.blur(input);await waitFor(()=>expect(orderWrites.commitType).toHaveBeenCalledOnce());expect(orderWrites.commitType.mock.calls[0][0]).toEqual({companyId:'taebaek',key:'raw',mode:'rename',label:'새 원료명'});expect(service.addItem).not.toHaveBeenCalled();await screen.findByDisplayValue('새 원료명');fireEvent.click(screen.getByRole('button',{name:/^닫기$/}));expect(onSaved.mock.calls[0][0]).toEqual(expect.arrayContaining([expect.objectContaining({id:'fixed-raw',order:8,hidden:true})]));
});
it('누락 타입 숨김은 기본 이름을 덮지 않고 helper ACK를 표시한다',async()=>{
 await mountOrdered();orderWrites.commitType.mockResolvedValue({id:'fixed-raw',kind:'type',key:'raw',label:'서버 원료명',order:7,hidden:true});const input=screen.getByDisplayValue('원료');fireEvent.click(input.closest('div')!.querySelector('button[title="안 씀 (숨김)"]')!);await waitFor(()=>expect(orderWrites.commitType).toHaveBeenCalledOnce());expect(orderWrites.commitType.mock.calls[0][0]).toEqual({companyId:'taebaek',key:'raw',mode:'hide',hidden:true});expect(await screen.findByDisplayValue('서버 원료명')).toBeInTheDocument();expect(service.addItem).not.toHaveBeenCalled();
});
it('순서 실제 snapshot ACK의 서버 값은 확인 사본에 반영하되 미저장 이름 초안은 유지한다',async()=>{
 const {onSaved}=await mountOrdered();const snapshot={id:'type-product',kind:'type' as const,key:'product',label:'서버 확인 제품명',order:1,hidden:true};orderWrites.commit.mockResolvedValue([snapshot]);fireEvent.change(screen.getByDisplayValue('제품'),{target:{value:'미저장 초안명'}});fireEvent.click(screen.getByRole('button',{name:'미저장 초안명 타입 아래로'}));await waitFor(()=>expect(orderWrites.commit).toHaveBeenCalledOnce());await waitFor(()=>expect(screen.getByDisplayValue('미저장 초안명')).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:/^닫기$/}));expect(onSaved.mock.calls[0][0]).toEqual(expect.arrayContaining([snapshot]));expect(onSaved.mock.calls[0][0].some((row:TaxonomyRow)=>row.label==='미저장 초안명')).toBe(false);
});

it('첫 조회 대기 중 닫기는 확인되지 않은 빈 목록을 전달하지 않는다',async()=>{
 const query=deferred(),saved=vi.fn(),close=vi.fn();service.fetchCollection.mockReturnValue(query.promise);render(<CategoryManager companyId="taebaek" onClose={close} onSaved={saved}/>);fireEvent.click(screen.getByRole('button',{name:/^닫기$/}));expect(close).toHaveBeenCalledOnce();expect(saved).not.toHaveBeenCalled();await act(async()=>query.resolve(arranged));expect(saved).not.toHaveBeenCalled();
});
it('첫 조회 실패 뒤 닫기도 확인 사본이 없으면 onSaved를 호출하지 않는다',async()=>{
 service.fetchCollection.mockRejectedValue(new Error('첫 조회 실패'));vi.spyOn(console,'error').mockImplementation(()=>{});const saved=vi.fn(),close=vi.fn();render(<CategoryManager companyId="taebaek" onClose={close} onSaved={saved}/>);await screen.findByText('분류를 불러오지 못했습니다. 다시 시도해 주세요.');fireEvent.click(screen.getByRole('button',{name:/^닫기$/}));expect(close).toHaveBeenCalledOnce();expect(saved).not.toHaveBeenCalled();
});
