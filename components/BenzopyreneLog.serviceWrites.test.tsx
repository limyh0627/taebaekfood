// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import BenzopyreneLog from './BenzopyreneLog';
import * as services from '../src/shared/services/firebaseService';
import {appNotice} from '../src/shared/components/appDialog';

const state = vi.hoisted(() => ({ actor:'synthetic-user', authListeners:new Set<(user:{uid:string})=>void>(), update: vi.fn(), remove: vi.fn(), subscriptions: [] as any[], rows: [] as any[],preview:vi.fn(),dispose:vi.fn(),capture:vi.fn(),pending:null as null|Promise<any> }));
vi.mock('../src/shared/rasterPdfOutput',()=>({previewRasterPdf:state.preview,snapshotOutputElement:(element:HTMLElement)=>({element:element.cloneNode(true),dispose:state.dispose})}));
vi.mock('html2canvas',()=>({default:state.capture}));
vi.mock('../src/shared/firebase',()=>({db:{},authReady:Promise.resolve(),auth:{get currentUser(){return{uid:state.actor,getIdTokenResult:async()=>({claims:{companyId:'taebaek'}})};},onAuthStateChanged:(callback:(user:{uid:string})=>void)=>{state.authListeners.add(callback);queueMicrotask(()=>{if(state.authListeners.has(callback))callback({uid:state.actor});});return()=>state.authListeners.delete(callback);}}}));
vi.mock('../src/shared/components/appDialog', () => ({ appConfirm: vi.fn().mockResolvedValue(true),appNotice:vi.fn() }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => ({ collection, id }),
  collection: (_db: unknown, collection: string) => ({ collection }),
  query: (ref: any, ...constraints: any[]) => ({ ...ref, constraints }),
  where: (field: string, op: string, value: string) => ({ field, op, value }),
  onSnapshot: (ref: any, callback: any) => {
    const unsubscribe = vi.fn();
    state.subscriptions.push({ ref, callback, unsubscribe });
    const rows = ref.constraints[0].value === 'taebaek' ? state.rows : [];
    callback({ docs: rows.map(row => ({ id: row.id, data: () => row })) });
    return unsubscribe;
  },
  updateDoc: state.update, deleteDoc: state.remove, addDoc: vi.fn(), setDoc: vi.fn(),
  getDocs: vi.fn(), getDoc: vi.fn(), writeBatch: vi.fn(), runTransaction: vi.fn(), documentId: vi.fn(), arrayUnion: vi.fn(),
}));
beforeEach(() => {
  state.actor='synthetic-user';state.authListeners.clear();
  vi.mocked(appNotice).mockClear();
  state.preview.mockReset().mockResolvedValue(undefined);state.dispose.mockReset();state.pending=null;state.capture.mockReset().mockImplementation(()=>state.pending??Promise.resolve({width:1123,height:1000,toDataURL:()=> 'data:image/png;base64,AA=='}));
  state.update.mockReset().mockResolvedValue(undefined);
  state.remove.mockReset().mockResolvedValue(undefined);
  state.subscriptions = [];
  state.rows = [{ id: 'synthetic-test', companyId: 'taebaek', productName: '합성 검사 제품', receivedDate: '2026-10-01',
    completedDate: '2026-10-02', testItem: '벤조피렌', criteria: '합성 기준', result: '0.1', judgment: '적합', createdAt: '2026-10-02' }];
  vi.spyOn(services, 'updateItem');
  vi.spyOn(services, 'deleteItem');
});
it('벤조피렌은 원래 가로 A4 배치와 높이 제한을 미리보기로만 보내고 업무 저장을 호출하지 않는다',async()=>{
 render(<BenzopyreneLog companyId="taebaek" />);fireEvent.click(screen.getByRole('button',{name:'PDF 다운로드'}));
 await waitFor(()=>expect(state.preview).toHaveBeenCalledOnce());
 expect(state.preview.mock.calls[0][0]).toMatchObject({pages:[{width:297,height:210,draws:[{x:0,y:0,width:297,height:210}]}],fileName:expect.stringContaining('벤조피렌_검사성적서_')});
 expect(state.update).not.toHaveBeenCalled();expect(state.remove).not.toHaveBeenCalled();expect(state.dispose).toHaveBeenCalledOnce();
});
it('캡처 대기 중 회사 전환은 이전 문서의 늦은 미리보기를 취소한다',async()=>{
 let done!:(v:any)=>void;state.pending=new Promise(r=>{done=r;});const view=render(<BenzopyreneLog companyId="taebaek" />);
 fireEvent.click(screen.getByRole('button',{name:'PDF 다운로드'}));await waitFor(()=>expect(state.capture).toHaveBeenCalledOnce());
 view.rerender(<BenzopyreneLog companyId="punghoe" />);await act(async()=>{done({width:1123,height:794,toDataURL:()=> 'data:image/png;base64,AA=='});});
 expect(state.preview).not.toHaveBeenCalled();expect(state.dispose).toHaveBeenCalledOnce();
});
it('캡처 실패를 안내하고 임시 문서를 정리한 뒤 다시 준비할 수 있다',async()=>{
 state.capture.mockRejectedValueOnce(Error('capture'));render(<BenzopyreneLog companyId="taebaek"/>);
 const click=()=>fireEvent.click(screen.getByRole('button',{name:'PDF 다운로드'}));click();await waitFor(()=>expect(appNotice).toHaveBeenCalledOnce());
 expect(state.dispose).toHaveBeenCalledOnce();expect(state.preview).not.toHaveBeenCalled();click();await waitFor(()=>expect(state.preview).toHaveBeenCalledOnce());expect(state.dispose).toHaveBeenCalledTimes(2);
});

it('검사 수정은 공용 서비스를 통해 회사 claim을 포함하며 실패하면 편집 내용을 유지한다', async () => {
  state.update.mockRejectedValueOnce(new Error('synthetic failure'));
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  render(<BenzopyreneLog companyId="taebaek" isAdmin currentUserName="합성 담당" />);
  fireEvent.click(screen.getByRole('button', { name: '수정' }));
  fireEvent.change(screen.getByDisplayValue('0.1'), { target: { value: '0.2' } });
  fireEvent.click(screen.getByRole('button', { name: '수정 저장' }));
  await waitFor(() => expect(window.alert).toHaveBeenCalled());
  expect(screen.getByDisplayValue('0.2')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '수정 저장' }));
  await waitFor(() => expect(state.update).toHaveBeenCalledTimes(2));
  expect(services.updateItem).toHaveBeenCalledWith('benzopyreneTests', 'synthetic-test', expect.objectContaining({ result: '0.2' }));
  expect(state.update).toHaveBeenLastCalledWith({ collection: 'benzopyreneTests', id: 'synthetic-test' }, expect.objectContaining({ result: '0.2', companyId: 'taebaek' }));
});

it('확인된 검사 기록만 정확한 ID로 공용 삭제 서비스에 전달한다', async () => {
  render(<BenzopyreneLog companyId="taebaek" isAdmin />);
  fireEvent.click(screen.getByRole('button', { name: '검사 기록 삭제' }));
  await waitFor(() => expect(state.remove).toHaveBeenCalledTimes(1));
  expect(services.deleteItem).toHaveBeenCalledWith('benzopyreneTests', 'synthetic-test');
});

it('회사 질의와 회사 전환 때 초안·기록 초기화로 이전 회사 결과가 섞이지 않는다', () => {
  const view = render(<BenzopyreneLog companyId="taebaek" isAdmin />);
  expect(state.subscriptions[0].ref.constraints).toEqual([{ field: 'companyId', op: '==', value: 'taebaek' }]);
  fireEvent.click(screen.getByRole('button', { name: '수정' }));
  fireEvent.change(screen.getByDisplayValue('0.1'), { target: { value: '옛 회사 초안' } });
  const old = state.subscriptions[0];
  view.rerender(<BenzopyreneLog companyId="punghoe" isAdmin />);
  act(() => old.callback({ docs: state.rows.map(row => ({ id: row.id, data: () => row })) }));
  expect(old.unsubscribe).toHaveBeenCalledTimes(1);
  expect(state.subscriptions.at(-1).ref.constraints).toEqual([{ field: 'companyId', op: '==', value: 'punghoe' }]);
  expect(screen.queryByText('합성 검사 제품')).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('옛 회사 초안')).not.toBeInTheDocument();
});

it('수정 저장 대기중 취소와 원입력은 잠겨 새초안으로 넘어가지 않는다',async()=>{let finish!:()=>void;state.update.mockReturnValue(new Promise<void>(r=>finish=r));render(<BenzopyreneLog companyId="taebaek" isAdmin/>);fireEvent.click(screen.getByRole('button',{name:'수정'}));fireEvent.click(screen.getByRole('button',{name:'수정 저장'}));await waitFor(()=>expect(state.update).toHaveBeenCalledOnce());expect(screen.getByRole('button',{name:'수정 취소'})).toBeDisabled();expect(screen.getByDisplayValue('0.1')).toBeDisabled();await act(async()=>finish());});
it('신규 저장 대기중 작성 입력을 잠그고 거절 후 원입력을 유지한다',async()=>{let fail!:(e:Error)=>void;vi.spyOn(window,'alert').mockImplementation(()=>{});vi.spyOn(console,'error').mockImplementation(()=>{});const add=vi.spyOn(services,'addItem').mockImplementation(()=>new Promise((_r,reject)=>fail=reject));render(<BenzopyreneLog companyId="taebaek" isAdmin/>);fireEvent.change(screen.getByPlaceholderText('제품명 입력'),{target:{value:'현재 제품'}});fireEvent.click(screen.getByRole('button',{name:'검사 기록 추가'}));expect(screen.getByPlaceholderText('제품명 입력')).toBeDisabled();await act(async()=>fail(Error('실패')));expect(screen.getByPlaceholderText('제품명 입력')).toHaveValue('현재 제품');add.mockRestore();});
it('삭제 확인 뒤 실제 계정이 바뀌면 원기록 삭제를 송신하지 않는다',async()=>{const {appConfirm}=await import('../src/shared/components/appDialog');let approve!:(value:boolean)=>void;vi.mocked(appConfirm).mockImplementationOnce(()=>new Promise(r=>approve=r));render(<BenzopyreneLog companyId="taebaek" isAdmin/>);fireEvent.click(screen.getByRole('button',{name:'검사 기록 삭제'}));state.actor='other';await act(async()=>approve(true));expect(state.remove).not.toHaveBeenCalled();});
