// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Post } from '../../../shared/types';
import { useNoticeActions } from './useNoticeActions';
const mocks = vi.hoisted(() => ({ auth: { currentUser: { uid: 'A' } as {uid:string}|null }, cleanup: vi.fn() }));
vi.mock('../../../shared/firebase', () => ({ auth: mocks.auth }));
vi.mock('../../../shared/noticeImage', () => ({ deleteNoticeImages: mocks.cleanup }));
vi.mock('../../../shared/components/appDialog', () => ({ appConfirm: vi.fn(async () => true) }));
const post = (id = 'one'): Post => ({ id, title:id, content:'본문', author:'작성자', date:'2026-10-19', tag:'공지', pinned:false,
  blocks:[{type:'image',path:`companies/taebaek/notices/${id}/photo`,url:'https://example.com/photo',caption:''}] });
function deferred<T>() { let resolve!: (value:T)=>void; let reject!: (reason?:unknown)=>void; const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject}; }
beforeEach(() => { mocks.auth.currentUser={uid:'A'}; mocks.cleanup.mockReset().mockResolvedValue(undefined); });
describe('공지 상세 작업 수명', () => {
  it.each(['close','other'] as const)('고정 ACK는 %s 뒤 선택을 복원하거나 덮지 않는다', async mode => {
    const ack=deferred<void>(); const update=vi.fn(()=>ack.promise);
    const {result}=renderHook(()=>useNoticeActions({companyId:'taebaek',actorUid:'A',onUpdatePost:update}));
    act(()=>result.current.selectPost(post())); let run!:Promise<void>;
    act(()=>{run=result.current.togglePinned();});
    act(()=>mode==='close'?result.current.closeSelected():result.current.selectPost(post('two')));
    await act(async()=>{ack.resolve();await run;});
    expect(result.current.selectedPost?.id).toBe(mode==='close'?undefined:'two');
    expect(result.current.selectedPost?.pinned).toBe(mode==='close'?undefined:false);
  });
  it('확인 대기 중 다른 선택이면 본문과 사진을 보내지 않는다', async()=>{
    const confirm=deferred<boolean>(); const remove=vi.fn();
    const {result}=renderHook(()=>useNoticeActions({companyId:'taebaek',actorUid:'A',onDeletePost:remove,confirm:()=>confirm.promise}));
    act(()=>result.current.selectPost(post())); let run!:Promise<void>;act(()=>{run=result.current.deleteSelected();});
    act(()=>result.current.selectPost(post('two')));
    await act(async()=>{confirm.resolve(true);await run;});
    expect(remove).not.toHaveBeenCalled();expect(mocks.cleanup).not.toHaveBeenCalled();
  });
  it('회사 UID 전환 후 확인 응답은 송신하지 않고 이전 finally는 새 busy를 풀지 않는다', async()=>{
    const confirm=deferred<boolean>(), update=deferred<void>(); const remove=vi.fn();
    const {result,rerender}=renderHook(({uid})=>useNoticeActions({companyId:'taebaek',actorUid:uid,onDeletePost:remove,confirm:()=>confirm.promise,onUpdatePost:()=>update.promise}),{initialProps:{uid:'A'}});
    act(()=>result.current.selectPost(post()));let old!:Promise<void>;act(()=>{old=result.current.deleteSelected();});
    mocks.auth.currentUser={uid:'B'};rerender({uid:'B'});act(()=>result.current.selectPost(post('two')));let fresh!:Promise<void>;act(()=>{fresh=result.current.togglePinned();});
    await act(async()=>{confirm.resolve(true);await old;});expect(remove).not.toHaveBeenCalled();expect(result.current.actionBusy).toBe(true);
    await act(async()=>{update.resolve();await fresh;});expect(result.current.selectedPost?.pinned).toBe(true);
  });
  it('본문 ACK를 못 받으면 사진 삭제를 시작하지 않는다', async()=>{
    const {result}=renderHook(()=>useNoticeActions({companyId:'taebaek',actorUid:'A',onDeletePost:async()=>{throw Error('lost');}}));
    act(()=>result.current.selectPost(post()));await act(()=>result.current.deleteSelected());
    expect(mocks.cleanup).not.toHaveBeenCalled();expect(result.current.selectedPost?.id).toBe('one');expect(result.current.actionMessage).toContain('결과를 확인하지 못');
  });
  it('사진 실패는 고정 원문을 가진 별도 건으로 보존하고 사진만 재시도한다', async()=>{
    mocks.cleanup.mockRejectedValue(Error('storage'));const remove=vi.fn(async()=>undefined);
    const {result}=renderHook(()=>useNoticeActions({companyId:'taebaek',actorUid:'A',onDeletePost:remove}));
    const original={...post(),title:'첫 공지 제목'};act(()=>result.current.selectPost(original)); original.title='나중 변경'; original.blocks![0]={type:'text',text:'바뀜'};
    await act(()=>result.current.deleteSelected());
    expect(result.current.selectedPost).toBeNull();expect(result.current.cleanupJobs).toHaveLength(1);expect(result.current.cleanupJobs[0].message).toContain('공지는 삭제됐지만');
    expect(result.current.cleanupJobs[0].blocks?.[0].type).toBe('image');
    act(()=>result.current.selectPost(post('two')));await act(()=>result.current.deleteSelected());expect(result.current.cleanupJobs).toHaveLength(2);
    expect(result.current.cleanupJobs.map(job=>job.displayTitle)).toEqual(['첫 공지 제목','two']);
    const first=result.current.cleanupJobs[0].jobId;mocks.cleanup.mockResolvedValue(undefined);await act(()=>result.current.retryCleanup(first));
    expect(remove).toHaveBeenCalledTimes(2);expect(result.current.cleanupJobs).toHaveLength(1);expect(result.current.cleanupJobs[0].postId).toBe('two');
  });
  it('ACK 뒤 scope 변경은 사진 시작을 막고 원래 scope 복귀 때 정리 건을 보여준다',async()=>{
    const ack=deferred<void>();const {result,rerender}=renderHook(({uid})=>useNoticeActions({companyId:'taebaek',actorUid:uid,onDeletePost:()=>ack.promise}),{initialProps:{uid:'A'}});
    act(()=>result.current.selectPost(post()));let run!:Promise<void>;act(()=>{run=result.current.deleteSelected();});await act(async()=>{await Promise.resolve();});
    mocks.auth.currentUser={uid:'B'};rerender({uid:'B'});await act(async()=>{ack.resolve();await run;});
    expect(mocks.cleanup).not.toHaveBeenCalled();expect(result.current.cleanupJobs).toHaveLength(0);
    mocks.auth.currentUser={uid:'A'};rerender({uid:'A'});expect(result.current.cleanupJobs).toHaveLength(1);
  });
  it('정리 중 다른 상세 작업을 막지 않고 중복 정리만 차단한다',async()=>{
    mocks.cleanup.mockRejectedValueOnce(Error('storage'));const update=vi.fn(async()=>undefined);
    const {result}=renderHook(()=>useNoticeActions({companyId:'taebaek',actorUid:'A',onDeletePost:async()=>undefined,onUpdatePost:update}));
    act(()=>result.current.selectPost(post()));await act(()=>result.current.deleteSelected());const job=result.current.cleanupJobs[0].jobId;
    const cleanup=deferred<void>();mocks.cleanup.mockImplementation(()=>cleanup.promise);let retry!:Promise<void>;act(()=>{retry=result.current.retryCleanup(job);});
    await act(()=>result.current.retryCleanup(job));act(()=>result.current.selectPost(post('two')));await act(()=>result.current.togglePinned());expect(update).toHaveBeenCalledOnce();
    expect(mocks.cleanup).toHaveBeenCalledTimes(2);await act(async()=>{cleanup.resolve();await retry;});expect(result.current.cleanupJobs).toHaveLength(0);
  });
});

it('최초 사진 정리 중에도 다른 공지를 처리할 수 있다',async()=>{
 const cleanup=deferred<void>();mocks.cleanup.mockImplementation(()=>cleanup.promise);const update=vi.fn(async()=>undefined);
 const {result}=renderHook(()=>useNoticeActions({companyId:'taebaek',actorUid:'A',onDeletePost:async()=>undefined,onUpdatePost:update}));
 act(()=>result.current.selectPost(post()));let run!:Promise<void>;act(()=>{run=result.current.deleteSelected();});await act(async()=>{await Promise.resolve();await Promise.resolve();});
 expect(result.current.actionBusy).toBe(false);act(()=>result.current.selectPost(post('two')));await act(()=>result.current.togglePinned());expect(update).toHaveBeenCalledOnce();
 await act(async()=>{cleanup.resolve();await run;});expect(result.current.selectedPost?.id).toBe('two');
});

it('사진 정리 제목이 공백이면 대상 번호로 구분한다',async()=>{
 mocks.cleanup.mockRejectedValue(Error('storage'));const {result}=renderHook(()=>useNoticeActions({companyId:'taebaek',actorUid:'A',onDeletePost:async()=>undefined}));
 act(()=>result.current.selectPost({...post('fallback'),title:'   '}));await act(()=>result.current.deleteSelected());
 expect(result.current.cleanupJobs[0].displayTitle).toBe('공지 fallback');
});
