/** @vitest-environment jsdom */
import React from 'react';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({uid:'uid-one',actor:null as null|((uid:string)=>void),stop:vi.fn(),list:vi.fn(),preview:vi.fn(),apply:vi.fn(),recover:vi.fn(),confirm:vi.fn(),attempts:[] as any[]}));
vi.mock('../../../shared/components/appDialog',()=>({appConfirm:m.confirm}));
vi.mock('../../../shared/services/partnerItemCleanupCommands',()=>({watchPartnerItemCleanupActor:(callback:(uid:string)=>void)=>{m.actor=callback;callback(m.uid);return m.stop;},listPartnerItemCleanupAttempts:m.list,previewPartnerItemCleanup:m.preview,applyPartnerItemCleanup:m.apply,recoverPartnerItemCleanup:m.recover}));
import {PartnerItemCleanupDialog} from './PartnerItemCleanupDialog';
beforeEach(()=>{m.uid='uid-one';m.actor=null;m.attempts=[];m.stop.mockReset();m.list.mockReset().mockImplementation(()=>m.attempts);m.preview.mockReset().mockResolvedValue({state:'active',message:'현재 품목은 삭제하지 않습니다'});m.apply.mockReset();m.recover.mockReset().mockResolvedValue({status:'applied',message:'최초 원문 복구 완료'});m.confirm.mockReset().mockResolvedValue(false);});
const props=()=>({companyId:'taebaek' as const,initialLinkId:'first',onClose:vi.fn(),onChanged:vi.fn()});
const attempt=()=>({key:'saved-key',text:'{"exact":"first-original"}',reference:{linkId:'second',operationId:'old-operation'},request:{version:1},error:''});
it('동적 서비스 준비와 회사/UID scope·auth 구독 해지를 보존한다',async()=>{
 const p=props(),view=render(<PartnerItemCleanupDialog {...p}/>);fireEvent.click(await screen.findByRole('button',{name:'연결 상태 확인'}));
 await screen.findByRole('status');expect(m.preview).toHaveBeenCalledWith({companyId:'taebaek',actorUid:'uid-one'},'first',expect.any(Function));expect(screen.getByRole('button',{name:'확인한 연결 한 건 삭제'})).toBeDisabled();view.unmount();expect(m.stop).toHaveBeenCalledOnce();
});
it('다른 연결 선택 뒤 늦은 미리보기는 새 선택을 덮지 않는다',async()=>{
 let finish!:(value:any)=>void;m.attempts=[attempt()];m.preview.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));render(<PartnerItemCleanupDialog {...props()}/>);
 fireEvent.click(await screen.findByRole('button',{name:'연결 상태 확인'}));fireEvent.click(screen.getByRole('button',{name:'이 연결 선택'}));await screen.findByText(/선택 연결 second/);
 await act(async()=>finish({state:'missing-item',message:'오래된 결과',expectedVersion:'v1',releaseId:'r1'}));expect(screen.queryByText('오래된 결과')).not.toBeInTheDocument();expect(screen.queryByLabelText('연결 정리 사유')).not.toBeInTheDocument();
});
it('계정 key가 바뀌면 이전 응답과 초안을 폐기하고 새 UID scope를 쓴다',async()=>{
 let finish!:(value:any)=>void;m.preview.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));render(<PartnerItemCleanupDialog {...props()}/>);fireEvent.click(await screen.findByRole('button',{name:'연결 상태 확인'}));
 act(()=>m.actor?.('uid-two'));await act(async()=>finish({state:'active',message:'이전 계정 응답'}));expect(screen.queryByText('이전 계정 응답')).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'연결 상태 확인'}));await waitFor(()=>expect(m.preview).toHaveBeenLastCalledWith({companyId:'taebaek',actorUid:'uid-two'},'first',expect.any(Function)));
});
it('보관 복구는 같은 attempt 객체·최초 원문을 재사용하며 별도 apply를 만들지 않는다',async()=>{
 const saved=attempt();m.attempts=[saved];const p={...props(),initialLinkId:'second'};render(<PartnerItemCleanupDialog {...p}/>);
 fireEvent.click(await screen.findByRole('button',{name:'같은 내용으로 재시도'}));await waitFor(()=>expect(p.onChanged).toHaveBeenCalledOnce());
 expect(m.recover).toHaveBeenCalledWith({companyId:'taebaek',actorUid:'uid-one'},saved,'apply',expect.any(Function));expect(m.apply).not.toHaveBeenCalled();expect(screen.getByText(saved.text)).toBeInTheDocument();
});
it('사유를 작성한 뒤 닫기 취소는 입력과 원요청을 보존한다',async()=>{
 m.preview.mockResolvedValue({state:'missing-item',message:'합성 부재 확인',expectedVersion:'v1',releaseId:'r1'});const p=props();render(<PartnerItemCleanupDialog {...p}/>);
 fireEvent.click(await screen.findByRole('button',{name:'연결 상태 확인'}));fireEvent.change(await screen.findByLabelText('연결 정리 사유'),{target:{value:'합성 정리 사유'}});
 fireEvent.click(screen.getByRole('button',{name:'품목 연결 확인·정리 닫기'}));await waitFor(()=>expect(m.confirm).toHaveBeenCalledOnce());expect(p.onClose).not.toHaveBeenCalled();expect(screen.getByLabelText('연결 정리 사유')).toHaveValue('합성 정리 사유');expect(m.apply).not.toHaveBeenCalled();
});

it.each([
 ['missing-item', '품목을 더 이상 쓰지 않는 연결이 맞으면'],
 ['active', '품목이 남아 있습니다.'],
 ['archived', '보관된 품목의 연결입니다.'],
 ['missing-link', '연결이 이미 없습니다.'],
 ['unconfirmed', '확인되지 않아 삭제할 수 없습니다.'],
])('서버 %s 결과에 맞는 다음 행동을 안내한다', async (state, advice) => {
 m.preview.mockResolvedValue({ state, message: '확인 결과', expectedVersion: 'v', releaseId: 'r' });
 render(<PartnerItemCleanupDialog {...props()} />);
 fireEvent.click(await screen.findByRole('button', { name: '연결 상태 확인' }));
 expect(await screen.findByText(text => text.startsWith(advice))).toBeInTheDocument();
 expect(screen.getByRole('button', { name: '확인한 연결 한 건 삭제' }).hasAttribute('disabled')).toBe(state !== 'missing-item');
 expect(m.apply).not.toHaveBeenCalled();
});
