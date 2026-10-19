/** @vitest-environment jsdom */
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import ActualNoticeBoard from './NoticeBoard';
import React, {useMemo, useRef} from 'react';
import type {Post} from '../types';
import type {NoticeBindings,NoticeEntry,NoticeContext,NoticeRecoveryReference,NoticeOutcome,NoticeReference} from '../src/features/notices/infrastructure/noticeWrites';
import {noticeOpening} from '../src/shared/noticeCommand';
import {appConfirm} from '../src/shared/components/appDialog';
import {uploadNoticeImage,deleteNoticeImages} from '../src/shared/noticeImage';
const testAuth=vi.hoisted(()=>({currentUser:{uid:'admin-uid'},listeners:new Set<(user:{uid:string})=>void>()}));
vi.mock('../src/shared/firebase',()=>({auth:testAuth,functions:{}}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_auth:unknown,callback:(user:typeof testAuth.currentUser)=>void)=>{testAuth.listeners.add(callback);callback(testAuth.currentUser);return ()=>testAuth.listeners.delete(callback);}}));
vi.mock('firebase/functions',()=>({httpsCallable:vi.fn()}));
beforeEach(()=>{sessionStorage.clear();localStorage.clear();sessions.clear();testAuth.listeners.clear();vi.clearAllMocks();testAuth.currentUser.uid='admin-uid';vi.mocked(uploadNoticeImage).mockReset().mockResolvedValue({type:'image',url:'https://example.com/photo.png',path:'companies/taebaek/notices/a/photo',caption:''});vi.mocked(deleteNoticeImages).mockReset().mockResolvedValue(undefined);});
vi.mock('../src/shared/noticeImage', () => ({
  uploadNoticeImage: vi.fn(async () => ({type:'image',url:'https://example.com/photo.png',path:'companies/taebaek/notices/a/photo',caption:''})),
  deleteNoticeImages: vi.fn(async () => {}),
  prepareNoticePhoto: async (companyId:string,postId:string,file:File) => ({fileName:file.name,request:{version:1,reference:{companyId,postId,uploadId:crypto.randomUUID()},sha256:'a'.repeat(64),size:file.size,contentType:file.type}}),
  resumeNoticePhoto: async (plan:{request:{reference:{companyId:string;postId:string}}},file:File,context:NoticeContext,ports:NoticeBindings) => {
    const {uploadNoticeImage}=await import('../src/shared/noticeImage');
    return uploadNoticeImage(plan.request.reference.companyId as 'taebaek',plan.request.reference.postId,file,context,ports);
  },
}));
vi.mock('../src/shared/components/appDialog', () => ({ appConfirm: vi.fn(async () => true), appNotice: vi.fn() }));
type LegacyProps={posts:Post[];companyId?:'taebaek'|'punghoe';onAddPost?:(post:Post)=>unknown;onUpdatePost?:(id:string,patch:Partial<Post>)=>unknown;onDeletePost?:(id:string)=>unknown};
type Stored={entry:NoticeEntry;input:{action:string;patch?:Partial<Post>};post:Post;result?:NoticeOutcome};
const sessions=new Map<string,Map<string,Stored>>();
function NoticeBoard(props:LegacyProps) {
  const latest=useRef(props);latest.current=props;
  const scope=props.companyId||'taebaek';
  const ports=useMemo(()=>{
    const key=scope+':'+testAuth.currentUser.uid;
    const rows=sessions.get(key)||new Map<string,Stored>();sessions.set(key,rows);
    const refKey=(ref:NoticeRecoveryReference)=>'planId'in ref?ref.planId:ref.uploadId;
    const outcome=(ref:NoticeRecoveryReference,status:'applied'|'cancelled'='applied',cleanupStatus:'not-required'|'pending'='not-required'):NoticeOutcome=>{
      const common={version:1 as const,actorUid:testAuth.currentUser.uid,employeeId:'admin-employee',requestHash:'a'.repeat(64),cleanupStatus,message:status==='applied'?'공지 처리가 확인됐습니다.':'적용 전 중단을 확인했습니다.'};
      if('uploadId' in ref)return {status:'cancelled',message:common.message,requestFinalized:true,serverResult:{...common,reference:ref,status:'cancelled',uploadStatus:'absent',path:'companies/'+ref.companyId+'/notices/'+ref.postId+'/'+ref.uploadId}};
      return {status:status==='applied'?'saved':'cancelled',message:common.message,requestFinalized:true,serverResult:{...common,reference:ref,status}};
    };
    const execute=async(row:Stored,ctx:NoticeContext):Promise<NoticeOutcome>=>{
      try {
        if(row.input.action==='create')await latest.current.onAddPost?.(row.post);
        else if(row.input.action==='delete')await latest.current.onDeletePost?.(row.post.id);
        else await latest.current.onUpdatePost?.(row.post.id,row.input.action==='pin'?row.input.patch!:row.post);
        if(!ctx.isCurrent())return {status:'unknown',message:'계정이 바뀌었습니다.',nextAction:'같은 요청의 처리 결과를 확인해 주세요.'};
        const cleanup=row.input.action==='delete'&&row.post.blocks?.some(block=>block.type==='image')?'pending':'not-required';
        row.result=outcome(row.entry.reference!,'applied',cleanup);if(cleanup==='pending'&&row.result.serverResult)row.result.serverResult.message='공지는 삭제됐지만 사진 정리가 남아 있습니다.';
        if(cleanup==='not-required')rows.delete(refKey(row.entry.reference!));
        return row.result;
      }catch{return {status:'unknown',message:'응답 유실로 결과를 확인하지 못했습니다.',nextAction:'보관 요청의 실제 처리 결과를 확인해 주세요.'};}
    };
    const bindings:NoticeBindings={
      open:async(post,ctx)=>({reference:{companyId:ctx.companyId,postId:ctx.postId,planId:ctx.planId},actorUid:ctx.actorUid,employeeId:ctx.employeeId,opening:noticeOpening(post),expectedVersion:'1:000000001'}),
      read:async()=>[...rows.values()].map(row=>row.entry),
      save:async(input,ctx)=>{
        const ref={companyId:ctx.companyId,postId:ctx.postId,planId:ctx.planId};
        const original=latest.current.posts.find(post=>post.id===ctx.postId);
        const post={...original,...input.patch,id:ctx.postId} as Post;
        const entry:NoticeEntry={key:ctx.planId,kind:'post',reference:ref,status:'valid',description:post.title||'공지 저장 요청',observedLocalText:JSON.stringify({input,ref}),observedReferenceText:JSON.stringify(ref),request:{version:1,reference:ref,action:input.action,expectedVersion:ctx.opening?.expectedVersion??null,patch:input.patch}};
        const row={entry,input,post};rows.set(ctx.planId,row);return execute(row,ctx);
      },
      inspect:async(ref)=>rows.get(refKey(ref))?.result||{status:'unknown',message:'처리 기록을 아직 확인하지 못했습니다.',nextAction:'같은 요청의 처리 결과를 확인해 주세요.'},
      retry:async(ref,ctx)=>{const row=rows.get(refKey(ref));return row?execute(row,ctx):{status:'unknown',message:'보관 원문이 없습니다.',nextAction:'같은 요청의 처리 결과를 확인해 주세요.'};},
      cancel:async(ref)=>{const row=rows.get(refKey(ref));if(row?.result)return row.result;rows.delete(refKey(ref));return outcome(ref,'cancelled');},
      cleanup:async(ref,ctx)=>{const row=rows.get(refKey(ref));try{if(row?.post.blocks?.some(block=>block.type==='image'))await deleteNoticeImages(row.post.blocks,scope,ref.postId,ctx);rows.delete(refKey(ref));return outcome(ref);}catch{const result=outcome(ref,'applied','pending');if(result.serverResult)result.serverResult.message='공지는 삭제됐지만 사진 정리는 완료되지 않았습니다.';return result;}},
      discard:async(ref,raw,referenceRaw)=>{const row=rows.get(refKey(ref));if(row&&(row.entry.observedLocalText!==raw||row.entry.observedReferenceText!==referenceRaw))return {status:'rejected',message:'사본이 바뀌었습니다.'};rows.delete(refKey(ref));return {status:'saved'};},
      history:async(ctx)=>({version:1,companyId:ctx.companyId,actorUid:ctx.actorUid,employeeId:ctx.employeeId,entries:[],nextCursor:null}),
      observeLegacy:async(ref,ctx)=>({reference:ref,actorUid:ctx.actorUid,employeeId:ctx.employeeId,observeOnly:true,exists:false,snapshot:null,expectedVersion:null}),
      reservePhoto:async(request,ctx)=>({version:1,reference:request.reference,actorUid:ctx.actorUid,employeeId:ctx.employeeId,status:'reserved',uploadStatus:'verified',downloadUrl:'https://example.com/photo.png',generation:'1',requestHash:'a'.repeat(64),cleanupStatus:'not-required',path:'companies/'+scope+'/notices/'+request.reference.postId+'/'+request.reference.uploadId,message:'확인됨'}),
    };
    return bindings;
  },[scope,testAuth.currentUser.uid]);
  return <ActualNoticeBoard posts={props.posts} companyId={scope} employeeId="admin-employee" canWrite={!!(props.onAddPost||props.onUpdatePost||props.onDeletePost)} noticeBindings={ports}/>;
}
async function openCreate(){await waitFor(()=>expect(screen.getByRole('button',{name:'공지 추가'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'공지 추가'}));}
const posts = [{ id: 'old', title: '고정 공지', content: '본문', author: '관리자', tag: '공지' as const, date: '2026-09-01', pinned: true }, { id: 'new', title: '최근 공지', content: '본문', author: '관리자', tag: '공지' as const, date: '2026-10-06' }];
describe('공지 관리', () => {
  it('고정 공지를 먼저 보여 주고 관리자가 고정 해제·삭제할 수 있다', async () => {
    const update = vi.fn(async () => {}), remove = vi.fn(async () => {});
    render(<NoticeBoard posts={posts} companyId="taebaek" onUpdatePost={update} onDeletePost={remove} />);
    expect(screen.getAllByRole('heading', { level: 3, name: /고정 공지|최근 공지/ })[0]).toHaveTextContent('고정 공지');
    fireEvent.click(screen.getByText('고정 공지'));
    fireEvent.click(screen.getByRole('button', { name: '상단 고정 해제' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith('old', { pinned: false }));
    await waitFor(() => expect(screen.getByRole('button', { name: '상단 고정' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: '공지 삭제' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('old'));
  });
  it('사진과 글 단락을 포함해 저장하고 실패하면 작성창을 유지한다', async () => {
    const add = vi.fn().mockRejectedValueOnce(new Error('저장 실패')).mockResolvedValueOnce(undefined);
    render(<NoticeBoard posts={[]} companyId="taebaek" onAddPost={add} />);
    await openCreate();
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: '사진 공지' } });
    fireEvent.change(screen.getByLabelText('사진 첨부'), { target: { files: [new File(['photo'], 'a.png', { type: 'image/png' })] } });
    await screen.findByAltText('첨부 사진');
    await waitFor(() => expect(screen.getByRole('button', { name: '등록' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: '글 단락 추가' }));
    fireEvent.change(screen.getByLabelText('글 단락 3'), { target: { value: '사진 아래 설명' } });
    fireEvent.click(screen.getByRole('button', { name: '등록' }));
    await waitFor(() => expect(add).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole('button', { name: '같은 요청 재개' })).not.toBeDisabled());
    expect(screen.getByPlaceholderText('제목')).toHaveValue('사진 공지');
    fireEvent.click(screen.getByRole('button', { name: '같은 요청 재개' }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(2));
    expect(add.mock.calls[1][0].blocks).toEqual([expect.objectContaining({ type: 'image' }), { type: 'text', text: '사진 아래 설명' }]);
  });
});

function recoveryPorts(overrides:Partial<NoticeBindings>={}):NoticeBindings {
  return {
    open:vi.fn<NoticeBindings['open']>(async(post,ctx)=>({reference:{companyId:ctx.companyId,postId:ctx.postId,planId:ctx.planId},actorUid:ctx.actorUid,employeeId:ctx.employeeId,opening:noticeOpening(post),expectedVersion:'1:000000001'})),
    save:vi.fn<NoticeBindings['save']>(async()=>({status:'unknown',message:'응답을 확인하지 못했습니다.',nextAction:'같은 요청의 처리 결과를 확인해 주세요.'})),
    read:vi.fn<NoticeBindings['read']>(async()=>[]),
    inspect:vi.fn<NoticeBindings['inspect']>(async()=>({status:'unknown',message:'처리 기록을 아직 확인하지 못했습니다.',nextAction:'같은 요청의 처리 결과를 확인해 주세요.'})),
    retry:vi.fn<NoticeBindings['retry']>(async()=>({status:'unknown',message:'같은 요청 결과를 다시 확인해 주세요.',nextAction:'같은 요청의 처리 결과를 확인해 주세요.'})),
    cancel:vi.fn<NoticeBindings['cancel']>(async()=>({status:'cancelled',message:'적용 전 중단을 확인했습니다.',requestFinalized:true})),
    cleanup:vi.fn<NoticeBindings['cleanup']>(async()=>({status:'unknown',message:'사진 정리 결과를 확인하지 못했습니다.',nextAction:'같은 요청의 처리 결과를 확인해 주세요.'})),
    discard:vi.fn<NoticeBindings['discard']>(async()=>({status:'saved'})),
    history:vi.fn<NoticeBindings['history']>(async(ctx)=>({version:1,companyId:ctx.companyId,actorUid:ctx.actorUid,employeeId:ctx.employeeId,entries:[],nextCursor:null})),
    observeLegacy:vi.fn<NoticeBindings['observeLegacy']>(async(ref,ctx)=>({reference:ref,actorUid:ctx.actorUid,employeeId:ctx.employeeId,observeOnly:true,exists:false,snapshot:null,expectedVersion:null})),
    reservePhoto:vi.fn<NoticeBindings['reservePhoto']>(async(request,ctx)=>({version:1,reference:request.reference,actorUid:ctx.actorUid,employeeId:ctx.employeeId,status:'unknown',uploadStatus:'absent',requestHash:null,cleanupStatus:'not-required',path:'companies/'+ctx.companyId+'/notices/'+request.reference.postId+'/'+request.reference.uploadId,message:'사진 상태를 확인하지 못했습니다.'})),
    ...overrides,
  };
}
const oldRef={companyId:'taebaek' as const,postId:'old-post',planId:'old-plan'};
const oldEntry:NoticeEntry={key:'observed-entry',kind:'post',reference:oldRef,status:'corrupt',description:'손상된 이전 원문',observedLocalText:'본문 관측 A',observedReferenceText:'참조 관측 A'};
function renderRecovery(ports:NoticeBindings,posts:Post[]=[]) {
  return render(<ActualNoticeBoard posts={posts} companyId="taebaek" employeeId="admin-employee" canWrite noticeBindings={ports}/>);
}
function bodyApplied(reference:NoticeReference=oldRef,cleanupStatus:'not-required'|'pending'|'manual-blocked'='not-required'):NoticeOutcome {
  return {status:'saved',requestFinalized:true,serverResult:{version:1,reference,actorUid:'admin-uid',employeeId:'admin-employee',status:'applied',requestHash:'a'.repeat(64),cleanupStatus,message:cleanupStatus==='manual-blocked'?'본문은 완료됐지만 구형 사진의 참조가 모호해 자동 정리를 보류했습니다.':'서버에서 본문 처리를 확인했습니다.'}};
}
it('이전 요청의 실제 성공은 새 공지 초안을 완료하거나 닫지 않는다',async()=>{
  const ports=recoveryPorts({read:vi.fn<NoticeBindings['read']>(async()=>[oldEntry]),inspect:vi.fn<NoticeBindings['inspect']>(async()=>bodyApplied())});renderRecovery(ports);
  await screen.findByText('손상된 이전 원문');await openCreate();fireEvent.change(screen.getByPlaceholderText('제목'),{target:{value:'이후 새 초안'}});
  fireEvent.click(screen.getByRole('button',{name:'실제 처리 결과 확인'}));
  await waitFor(()=>expect(ports.inspect).toHaveBeenCalledOnce());
  expect(screen.getByPlaceholderText('제목')).toHaveValue('이후 새 초안');expect(ports.save).not.toHaveBeenCalled();
});
it.each(['pending','manual-blocked'] as const)('본문 완료와 사진 %s는 구분하고 정리만 재시도하며 새 공지를 보존한다',async(cleanupStatus)=>{
  let entry:NoticeEntry|null=null;
  const ports=recoveryPorts({read:vi.fn<NoticeBindings['read']>(async()=>entry?[entry]:[]),save:vi.fn<NoticeBindings['save']>(async(input,ctx)=>{
    const reference={companyId:ctx.companyId,planId:ctx.planId,postId:ctx.postId};
    entry={...oldEntry,reference,status:'valid',description:'사진 포함 본문',request:{version:1,reference,action:input.action,expectedVersion:null,patch:input.patch}};
    return bodyApplied(reference,cleanupStatus);
  })});renderRecovery(ports);await openCreate();
  fireEvent.change(screen.getByPlaceholderText('제목'),{target:{value:'완료 본문'}});fireEvent.change(screen.getByLabelText('글 단락 1'),{target:{value:'내용'}});fireEvent.click(screen.getByRole('button',{name:'등록'}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
  if(cleanupStatus==='manual-blocked')expect(screen.getByText(/구형 사진의 참조가 모호/)).toBeInTheDocument();
  await openCreate();fireEvent.change(screen.getByPlaceholderText('제목'),{target:{value:'다음 공지'}});
  fireEvent.click(screen.getByRole('button',{name:'남은 사진 정리'}));await waitFor(()=>expect(ports.cleanup).toHaveBeenCalledOnce());
  expect(ports.save).toHaveBeenCalledOnce();expect(screen.getByPlaceholderText('제목')).toHaveValue('다음 공지');
});
it('손상 보관행의 사본 정리는 두 관측 원문을 넘기고 새 초안을 닫거나 저장하지 않는다',async()=>{
  const ports=recoveryPorts({read:vi.fn<NoticeBindings['read']>(async()=>[oldEntry])});renderRecovery(ports);
  await screen.findByText('손상된 이전 원문');await openCreate();
  fireEvent.change(screen.getByPlaceholderText('제목'),{target:{value:'현재 새 초안'}});
  fireEvent.click(screen.getByRole('button',{name:'이 기기 사본만 정리'}));
  await waitFor(()=>expect(ports.discard).toHaveBeenCalledWith(oldRef,'본문 관측 A','참조 관측 A',expect.any(Object)));
  expect(screen.getByPlaceholderText('제목')).toHaveValue('현재 새 초안');expect(ports.save).not.toHaveBeenCalled();
});
it('명시 이력의 빈 페이지에 cursor가 있으면 완료로 오인하지 않고 다음 조회를 제공한다',async()=>{
  const history=vi.fn<NoticeBindings['history']>().mockImplementation(async(ctx,cursor)=>({version:1,companyId:ctx.companyId,actorUid:ctx.actorUid,employeeId:ctx.employeeId,entries:[],nextCursor:cursor?null:'a'.repeat(64)}));
  const ports=recoveryPorts({history});renderRecovery(ports);await openCreate();
  expect(history).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'서버 처리 이력 조회'}));
  await screen.findByText('더 확인할 요청이 있습니다.');
  expect(screen.getByText(/이번 조회에서 0건/)).toHaveTextContent(/미처리라고 확정하지 않습니다/);
  fireEvent.click(screen.getByRole('button',{name:'다음 이력 확인'}));
  await waitFor(()=>expect(history).toHaveBeenLastCalledWith(expect.any(Object),'a'.repeat(64)));
});
it('legacy 공지는 현재 존재와 다른 내용을 보여 주되 성공 추정 없이 관측 사본만 정리한다',async()=>{
  const raw=JSON.stringify({post:{...posts[0],blocks:[]},editing:true});sessionStorage.setItem('notice-save-pending:taebaek:admin-uid',raw);
  const ports=recoveryPorts({observeLegacy:vi.fn<NoticeBindings['observeLegacy']>(async(ref,ctx)=>({reference:ref,actorUid:ctx.actorUid,employeeId:ctx.employeeId,observeOnly:true,exists:true,snapshot:noticeOpening({...posts[0],content:'서버에서 바뀐 내용'}),expectedVersion:'2:000000001'}))});renderRecovery(ports);
  const panel=await screen.findByLabelText('이전 방식 보관 요청');await openCreate();
  fireEvent.change(screen.getByPlaceholderText('제목'),{target:{value:'유지할 새 초안'}});
  expect(within(panel).getByRole('button',{name:'이전 기기 사본만 정리'})).toBeDisabled();
  fireEvent.click(within(panel).getByRole('button',{name:'현재 공지와 대조'}));
  await within(panel).findByText('서버에서 바뀐 내용');expect(panel).toHaveTextContent(/저장 성공이 확인된 것은 아닙니다/);
  fireEvent.click(within(panel).getByRole('button',{name:'이전 기기 사본만 정리'}));
  await waitFor(()=>expect(sessionStorage.getItem('notice-save-pending:taebaek:admin-uid')).toBeNull());
  expect(screen.getByPlaceholderText('제목')).toHaveValue('유지할 새 초안');expect(ports.save).not.toHaveBeenCalled();expect(ports.cancel).not.toHaveBeenCalled();
});
it('legacy 현재 부재는 실패로 단정하지 않고 교체된 관측 원문은 정리하지 않는다',async()=>{
  const raw=JSON.stringify({post:{...posts[0],blocks:[]},editing:false});sessionStorage.setItem('notice-save-pending:taebaek:admin-uid',raw);
  const ports=recoveryPorts();renderRecovery(ports);
  const panel=await screen.findByLabelText('이전 방식 보관 요청');fireEvent.click(within(panel).getByRole('button',{name:'현재 공지와 대조'}));
  await within(panel).findByText(/이전 요청 실패를 뜻하지 않습니다/);
  sessionStorage.setItem('notice-save-pending:taebaek:admin-uid','교체 사본 B');
  fireEvent.click(within(panel).getByRole('button',{name:'이전 기기 사본만 정리'}));
  await screen.findByText(/이전 기기 사본이 바뀌었습니다/);
  expect(sessionStorage.getItem('notice-save-pending:taebaek:admin-uid')).toBe('교체 사본 B');expect(ports.save).not.toHaveBeenCalled();
});
it('식별 불가 legacy는 원문 복사와 명시 사본 정리만 제공하며 새 초안을 보존한다',async()=>{
  const key='notice-save-pending:taebaek:admin-uid',raw='식별 불가 원문 A';sessionStorage.setItem(key,raw);sessionStorage.setItem(key+':reference','참조 A');
  const copy=vi.fn(async()=>{});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:copy}});
  const ports=recoveryPorts();renderRecovery(ports);const panel=await screen.findByLabelText('이전 방식 보관 요청');
  expect(within(panel).queryByRole('button',{name:'현재 공지와 대조'})).toBeNull();expect(panel).toHaveTextContent(/서버 처리 여부나 요청 중단은 확인하지 못했습니다/);
  fireEvent.click(within(panel).getByRole('button',{name:'보관 원문 복사'}));await waitFor(()=>expect(copy).toHaveBeenCalledWith(raw));
  await openCreate();fireEvent.change(screen.getByPlaceholderText('제목'),{target:{value:'별도의 새 초안'}});
  fireEvent.click(within(panel).getByRole('button',{name:'이 기기의 식별 불가 사본 정리'}));
  await waitFor(()=>expect(sessionStorage.getItem(key)).toBeNull());expect(sessionStorage.getItem(key+':reference')).toBeNull();
  expect(screen.getByPlaceholderText('제목')).toHaveValue('별도의 새 초안');expect(ports.save).not.toHaveBeenCalled();expect(ports.observeLegacy).not.toHaveBeenCalled();expect(ports.cancel).not.toHaveBeenCalled();
});
it('식별 불가 legacy의 화면 관측 참조가 바뀌면 새 참조와 본문을 모두 보존한다',async()=>{
  const key='notice-save-pending:taebaek:admin-uid';sessionStorage.setItem(key,'원문 A');sessionStorage.setItem(key+':reference','참조 A');
  renderRecovery(recoveryPorts());const panel=await screen.findByLabelText('이전 방식 보관 요청');
  sessionStorage.setItem(key+':reference','새 참조 B');fireEvent.click(within(panel).getByRole('button',{name:'이 기기의 식별 불가 사본 정리'}));
  await screen.findByText(/이전 기기 사본이 바뀌었습니다/);expect(sessionStorage.getItem(key)).toBe('원문 A');expect(sessionStorage.getItem(key+':reference')).toBe('새 참조 B');
});
it('삭제된 수정 대상의 열기 실패는 작성창에 이유를 남기며 새 저장으로 우회하지 않는다',async()=>{
  const ports=recoveryPorts({open:vi.fn<NoticeBindings['open']>(async()=>{throw Error('수정할 공지가 없습니다.');})});renderRecovery(ports,posts);
  fireEvent.click(screen.getByText('고정 공지'));fireEvent.click(screen.getByRole('button',{name:'공지 수정'}));
  await screen.findByText(/수정할 공지가 없습니다/);expect(screen.getByRole('dialog',{name:'공지 수정'})).toBeInTheDocument();expect(screen.getByPlaceholderText('제목')).toBeDisabled();expect(ports.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'보기 닫기'}));await openCreate();expect(screen.getByPlaceholderText('제목')).toHaveValue('');
});
it('부모 재렌더 없이 UID 구독이 바뀌면 확인 대기 상세와 송신 권한을 분리한다',async()=>{
  const gate=actionGate<boolean>();vi.mocked(appConfirm).mockReturnValueOnce(gate.promise);
  const ports=recoveryPorts();renderRecovery(ports,posts);fireEvent.click(screen.getByText('고정 공지'));fireEvent.click(screen.getByRole('button',{name:'공지 삭제'}));
  act(()=>{testAuth.currentUser={uid:'other-uid'};testAuth.listeners.forEach(callback=>callback(testAuth.currentUser));});
  await act(async()=>gate.resolve(true));expect(ports.save).not.toHaveBeenCalled();expect(screen.queryByRole('dialog')).toBeNull();
});
it('일반 직원은 공지를 읽되 관리자 복구 조회와 작성 버튼을 요청하지 않는다',async()=>{
  const ports=recoveryPorts({read:vi.fn<NoticeBindings['read']>(async()=>{throw Error('관리자 권한 필요');})});
  render(<ActualNoticeBoard posts={posts} companyId="taebaek" employeeId="employee-reader" canWrite={false} noticeBindings={ports}/>);
  await act(async()=>{await Promise.resolve();});
  expect(ports.read).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'공지 추가'})).toBeNull();expect(screen.queryByText(/관리자 권한 필요/)).toBeNull();
  fireEvent.click(screen.getByText('고정 공지'));expect(screen.getByRole('dialog')).toHaveTextContent('본문');expect(screen.queryByRole('button',{name:'공지 수정'})).toBeNull();
});

it('서식과 안전한 링크는 미리보기와 저장된 상세에서 동일하게 렌더한다',async()=>{
 const add=vi.fn().mockResolvedValue(undefined);
 const {rerender}=render(<NoticeBoard posts={[]} companyId="taebaek" onAddPost={add}/>);
 await openCreate();
 fireEvent.change(screen.getByPlaceholderText('제목'),{target:{value:'새 안내'}});
 fireEvent.change(screen.getByLabelText('글 단락 1'),{target:{value:'중요 안내'}});
 fireEvent.change(screen.getByLabelText('단락 1 형식'),{target:{value:'heading'}});
 fireEvent.click(screen.getByLabelText('굵게'));
 fireEvent.change(screen.getByLabelText('단락 1 링크'),{target:{value:'https://example.com/help'}});
 fireEvent.click(screen.getByRole('button',{name:'미리보기'}));
 expect(screen.getByRole('heading',{name:'중요 안내'}).querySelector('strong a')).toHaveAttribute('href','https://example.com/help');
 fireEvent.click(screen.getByRole('button',{name:'등록'}));
 await waitFor(()=>expect(add).toHaveBeenCalledOnce());
 const post=add.mock.calls[0][0];
 rerender(<NoticeBoard posts={[post]} companyId="taebaek" onAddPost={add}/>);
 fireEvent.click(screen.getByText('새 안내'));
 expect(screen.getByRole('heading',{name:'중요 안내'}).querySelector('strong a')).toHaveAttribute('href','https://example.com/help');
});
it('기존 공지 편집 취소는 게시된 사진을 지우지 않는다',async()=>{
 const post={...posts[0],blocks:[{type:'image' as const,path:'companies/taebaek/notices/old/photo',url:'https://example.com/photo.png',caption:'기존 사진'}]};
 render(<NoticeBoard posts={[post]} companyId="taebaek" onUpdatePost={vi.fn()}/>);
 fireEvent.click(screen.getByText('고정 공지'));fireEvent.click(screen.getByRole('button',{name:'공지 수정'}));await waitFor(()=>expect(screen.getByPlaceholderText('제목')).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'삭제'}));
 await waitFor(()=>expect(screen.queryByAltText('기존 사진')).toBeNull());
 fireEvent.click(screen.getByRole('button',{name:'취소'}));
 await waitFor(()=>expect(screen.queryByRole('heading',{name:'공지 수정'})).toBeNull());
 expect(vi.mocked(deleteNoticeImages).mock.calls.flatMap(call=>call[0]||[])).toEqual([]);
});
it('기존 공지 수정 실패 뒤 동일 id 날짜 작성자와 사진 원문으로 다시 저장한다',async()=>{
 const update=vi.fn().mockRejectedValueOnce(new Error('응답 유실')).mockResolvedValueOnce(undefined);
 const post={...posts[0],blocks:[{type:'text' as const,text:'원문'}]};
 render(<NoticeBoard posts={[post]} companyId="taebaek" onUpdatePost={update}/>);
 fireEvent.click(screen.getByText('고정 공지'));fireEvent.click(screen.getByRole('button',{name:'공지 수정'}));await waitFor(()=>expect(screen.getByPlaceholderText('제목')).toBeEnabled());
 fireEvent.change(screen.getByLabelText('글 단락 1'),{target:{value:'수정 내용'}});
 fireEvent.click(screen.getByRole('button',{name:'수정 저장'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'같은 요청 재개'})).toBeEnabled());
 expect(screen.getByLabelText('글 단락 1')).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'같은 요청 재개'}));
 await waitFor(()=>expect(update).toHaveBeenCalledTimes(2));
 expect(update.mock.calls[1]).toEqual(update.mock.calls[0]);
 expect(update.mock.calls[0][1]).toMatchObject({id:'old',date:'2026-09-01',author:'관리자'});
});
it('저장 결과 미확인 뒤 회사 전환과 재진입은 같은 원문 id로 재개한다',async()=>{
 const add=vi.fn().mockRejectedValueOnce(new Error('응답 유실')).mockResolvedValueOnce(undefined);
 const {rerender}=render(<NoticeBoard posts={[]} companyId="taebaek" onAddPost={add}/>);
 await openCreate();
 fireEvent.change(screen.getByPlaceholderText('제목'),{target:{value:'초안'}});
 fireEvent.change(screen.getByLabelText('글 단락 1'),{target:{value:'보존 원문'}});
 fireEvent.click(screen.getByRole('button',{name:'등록'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'같은 요청 재개'})).toBeEnabled());
 const original=add.mock.calls[0][0];
 rerender(<NoticeBoard posts={[]} companyId="punghoe" onAddPost={add}/>);
 expect(screen.queryByRole('heading',{name:'공지 작성'})).toBeNull();
 rerender(<NoticeBoard posts={[]} companyId="taebaek" onAddPost={add}/>);
 expect(screen.queryByPlaceholderText('제목')).toBeNull();await screen.findByRole('button',{name:'같은 요청 재개'});expect(screen.getByRole('region',{name:'공지 요청 복구'})).toHaveTextContent('초안');
 fireEvent.click(screen.getByRole('button',{name:'같은 요청 재개'}));
 await waitFor(()=>expect(add).toHaveBeenCalledTimes(2));expect(add.mock.calls[1][0]).toEqual(original);
 expect(sessionStorage.getItem('notice-save-pending:taebaek:admin-uid')).toBeNull();
});
it('회사 전환 뒤 도착한 사진은 새 회사 초안에 넣지 않고 다른 회사 파일을 직접 지우지 않는다',async()=>{
 let finish!:(value:Awaited<ReturnType<typeof uploadNoticeImage>>)=>void;
 vi.mocked(uploadNoticeImage).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const {rerender}=render(<NoticeBoard posts={[]} companyId="taebaek" onAddPost={vi.fn()}/>);
 await openCreate();
 fireEvent.change(screen.getByLabelText('사진 첨부'),{target:{files:[new File(['a'],'a.png',{type:'image/png'})]}});
 await waitFor(()=>expect(uploadNoticeImage).toHaveBeenCalledOnce());
 rerender(<NoticeBoard posts={[]} companyId="punghoe" onAddPost={vi.fn()}/>);
 const image={type:'image' as const,path:'companies/taebaek/notices/a/photo',url:'https://example.com/photo.png',caption:''};finish(image);
 await act(async()=>{await Promise.resolve();});expect(deleteNoticeImages).not.toHaveBeenCalled();
 expect(screen.queryByAltText('첨부 사진')).toBeNull();
});
it('위험한 링크와 HTML 문자는 실행하거나 저장하지 않는다',async()=>{
 const add=vi.fn();render(<NoticeBoard posts={[]} companyId="taebaek" onAddPost={add}/>);
 await openCreate();
 fireEvent.change(screen.getByPlaceholderText('제목'),{target:{value:'안전'}});
 fireEvent.change(screen.getByLabelText('글 단락 1'),{target:{value:'<script>alert(1)</script>'}});
 fireEvent.change(screen.getByLabelText('단락 1 링크'),{target:{value:'javascript:alert(1)'}});
 fireEvent.click(screen.getByRole('button',{name:'미리보기'}));
 expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();expect(document.querySelector('script')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'등록'}));await Promise.resolve();expect(add).not.toHaveBeenCalled();
});

it.each(['paste','drop','file'] as const)('본문 커서 %s 사진은 앞뒤 글과 기존 블록 순서를 보존한다',async(mode)=>{
 const add=vi.fn().mockResolvedValue(undefined);
 render(<NoticeBoard posts={[]} companyId="taebaek" onAddPost={add}/>);
 await openCreate();
 fireEvent.change(screen.getByPlaceholderText('제목'),{target:{value:'커서 사진'}});
 const text=screen.getByLabelText('글 단락 1') as HTMLTextAreaElement;
 fireEvent.change(text,{target:{value:'앞문장뒤문장'}});
 text.setSelectionRange(3,3);fireEvent.select(text);
 fireEvent.click(screen.getByRole('button',{name:'글 단락 추가'}));
 fireEvent.change(screen.getByLabelText('글 단락 2'),{target:{value:'다음 단락'}});
 const file=new File(['image'],'photo.png',{type:'image/png'});
 if(mode==='paste')fireEvent.paste(text,{clipboardData:{files:[file]}});
 else if(mode==='drop')fireEvent.drop(text,{dataTransfer:{files:[file]}});
 else fireEvent.change(screen.getByLabelText('단락 1 사진 넣기'),{target:{files:[file]}});
 await waitFor(()=>expect(screen.getByAltText('첨부 사진')).toBeInTheDocument());
 fireEvent.click(screen.getByRole('button',{name:'등록'}));
 await waitFor(()=>expect(add).toHaveBeenCalledOnce());
 expect(add.mock.calls[0][0].blocks).toEqual([{type:'text',text:'앞문장'},expect.objectContaining({type:'image'}),{type:'text',text:'뒤문장'},{type:'text',text:'다음 단락'}]);
 expect(uploadNoticeImage).toHaveBeenCalledWith('taebaek',expect.any(String),file,expect.objectContaining({companyId:'taebaek'}),expect.any(Object));
 expect(screen.queryByRole('heading',{name:'공지 작성'})).toBeNull();
});
it('일반 텍스트 붙여넣기는 사진 업로드하지 않는다',async()=>{
 render(<NoticeBoard posts={[]} companyId="taebaek" onAddPost={vi.fn()}/>);
 await openCreate();
 fireEvent.paste(screen.getByLabelText('글 단락 1'),{clipboardData:{files:[]}});
 expect(uploadNoticeImage).not.toHaveBeenCalled();
 expect(screen.getByRole('button',{name:'등록'}).closest('footer')).not.toBeNull();
 expect(screen.getByRole('button',{name:'취소'}).closest('footer')).not.toBeNull();
});

it('공지 작성은 검색 앞 행동 줄이며 검색은 권한 없이도 유지하고 관리자 진입만 노출한다',async()=>{
 const add=vi.fn(),view=render(<NoticeBoard posts={posts} onAddPost={add}/>),title=screen.getByRole('heading',{name:'공지사항'}),create=screen.getByRole('button',{name:'공지 추가'}),search=screen.getByRole('textbox',{name:'공지 검색'});
 expect(title.compareDocumentPosition(create)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(create.compareDocumentPosition(search)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(create.closest('[data-page-header-slot="actions"]')).not.toBeNull();fireEvent.change(search,{target:{value:'최근'}});expect(screen.queryByText('고정 공지')).not.toBeInTheDocument();expect(screen.getByText('최근 공지')).toBeInTheDocument();await waitFor(()=>expect(create).toBeEnabled());fireEvent.click(create);expect(screen.getByRole('dialog',{name:'공지 작성'})).toBeInTheDocument();expect(add).not.toHaveBeenCalled();view.unmount();render(<NoticeBoard posts={posts}/>);expect(screen.queryByRole('button',{name:'공지 추가'})).not.toBeInTheDocument();expect(screen.getByRole('textbox',{name:'공지 검색'})).toBeInTheDocument();
});

function actionGate<T>() { let resolve!:(value:T)=>void; const promise=new Promise<T>(done=>{resolve=done;}); return {promise,resolve}; }
it('고정 응답이 늦어도 닫힌 상세를 다시 열거나 다른 선택을 덮지 않는다',async()=>{
 const gate=actionGate<void>(),update=vi.fn(()=>gate.promise);render(<NoticeBoard posts={posts} companyId="taebaek" onUpdatePost={update}/>);
 fireEvent.click(screen.getByText('고정 공지'));fireEvent.click(screen.getByRole('button',{name:'상단 고정 해제'}));
 fireEvent.click(screen.getByRole('button',{name:'확인 완료'}));fireEvent.click(screen.getByText('최근 공지'));
 await act(async()=>gate.resolve());expect(screen.getByRole('dialog')).toHaveAccessibleName('최근 공지 · 공지 공지사항');
 expect(screen.getByRole('button',{name:'상단 고정'})).toBeEnabled();
});
it('본문 삭제 미확인에서는 사진을 지우지 않고 원인과 확인 행동을 보여 준다',async()=>{
 const remove=vi.fn().mockRejectedValue(new Error('응답 유실'));render(<NoticeBoard posts={posts} companyId="taebaek" onDeletePost={remove}/>);
 fireEvent.click(screen.getByText('고정 공지'));fireEvent.click(screen.getByRole('button',{name:'공지 삭제'}));
 await waitFor(()=>expect(within(screen.getByRole('dialog')).getByRole('status')).toHaveTextContent(/확인/));expect(screen.getByRole('dialog')).toBeInTheDocument();expect(deleteNoticeImages).not.toHaveBeenCalled();expect(screen.queryByRole('region',{name:'공지 사진 정리'})).toBeNull();
});
it('본문 ACK 뒤 사진 실패는 조건부 사진 재시도만 노출하고 본문을 다시 삭제하지 않는다',async()=>{
 const post={...posts[0],blocks:[{type:'image' as const,path:'companies/taebaek/notices/old/photo',url:'https://example.com/photo',caption:'사진'}]},remove=vi.fn().mockResolvedValue(undefined);
 vi.mocked(deleteNoticeImages).mockRejectedValueOnce(new Error('사진 연결 실패'));
 render(<NoticeBoard posts={[post]} companyId="taebaek" onDeletePost={remove}/>);expect(screen.queryByRole('region',{name:'공지 사진 정리'})).toBeNull();
 fireEvent.click(screen.getByText('고정 공지'));fireEvent.click(screen.getByRole('button',{name:'공지 삭제'}));
 const panel=await screen.findByRole('region',{name:'공지 사진 정리'});expect(panel).toHaveTextContent('공지는 삭제됐지만');expect(screen.queryByRole('dialog')).toBeNull();
 fireEvent.click(within(panel).getByRole('button',{name:'고정 공지 · old · 사진 정리 다시 시도'}));await waitFor(()=>expect(screen.queryByRole('region',{name:'공지 사진 정리'})).toBeNull());expect(remove).toHaveBeenCalledOnce();expect(deleteNoticeImages).toHaveBeenCalledTimes(2);
});
it('상세 고정의 finally는 별도로 진행 중인 작성 busy를 풀지 않는다',async()=>{
 const pin=actionGate<void>(),save=actionGate<void>();render(<NoticeBoard posts={posts} companyId="taebaek" onUpdatePost={()=>pin.promise} onAddPost={()=>save.promise}/>);
 fireEvent.click(screen.getByText('고정 공지'));fireEvent.click(screen.getByRole('button',{name:'상단 고정 해제'}));fireEvent.click(screen.getByRole('button',{name:'확인 완료'}));
 await openCreate();fireEvent.change(screen.getByPlaceholderText('제목'),{target:{value:'새 작성'}});fireEvent.change(screen.getByLabelText('글 단락 1'),{target:{value:'내용'}});fireEvent.click(screen.getByRole('button',{name:'등록'}));
 await act(async()=>pin.resolve());expect(screen.getByRole('button',{name:'처리 중…'})).toBeDisabled();expect(screen.getByPlaceholderText('제목')).toBeDisabled();await act(async()=>save.resolve());
});
it('삭제 확인 대기 중 같은 회사 UID가 바뀌면 삭제를 송신하지 않는다',async()=>{
 const confirm=actionGate<boolean>(),remove=vi.fn();vi.mocked(appConfirm).mockReturnValueOnce(confirm.promise);
 const view=render(<NoticeBoard posts={posts} companyId="taebaek" onDeletePost={remove}/>);fireEvent.click(screen.getByText('고정 공지'));fireEvent.click(screen.getByRole('button',{name:'공지 삭제'}));
 testAuth.currentUser.uid='other-uid';act(()=>testAuth.listeners.forEach(callback=>callback(testAuth.currentUser)));view.rerender(<NoticeBoard posts={posts} companyId="taebaek" onDeletePost={remove}/>);await act(async()=>confirm.resolve(true));expect(remove).not.toHaveBeenCalled();expect(screen.queryByRole('dialog')).toBeNull();
});

it('사진 정리 두 작업은 원제목과 공지 번호로 구분하고 각각 사진만 다시 시도한다',async()=>{
 const first={...posts[0],title:'첫 안내',blocks:[{type:'image' as const,path:'companies/taebaek/notices/old/photo',url:'https://example.com/one',caption:''}]};
 const second={...posts[1],title:'둘째 안내',blocks:[{type:'image' as const,path:'companies/taebaek/notices/new/photo',url:'https://example.com/two',caption:''}]};
 const remove=vi.fn().mockResolvedValue(undefined);vi.mocked(deleteNoticeImages).mockRejectedValueOnce(new Error('첫 사진 실패')).mockRejectedValueOnce(new Error('둘째 사진 실패'));
 render(<NoticeBoard posts={[first,second]} companyId="taebaek" onDeletePost={remove}/>);
 fireEvent.click(screen.getByText('첫 안내'));fireEvent.click(screen.getByRole('button',{name:'공지 삭제'}));await screen.findByRole('button',{name:'첫 안내 · old · 사진 정리 다시 시도'});
 fireEvent.click(screen.getByText('둘째 안내'));fireEvent.click(screen.getByRole('button',{name:'공지 삭제'}));const retry=await screen.findByRole('button',{name:'둘째 안내 · new · 사진 정리 다시 시도'});
 const panel=screen.getByRole('region',{name:'공지 사진 정리'});expect(panel).toHaveTextContent('첫 안내 · 사진 정리 미완료');expect(panel).toHaveTextContent('둘째 안내 · 사진 정리 미완료');expect(panel).toHaveTextContent('공지 번호: old');expect(panel).toHaveTextContent('공지 번호: new');
 fireEvent.click(retry);await waitFor(()=>expect(screen.queryByRole('button',{name:'둘째 안내 · new · 사진 정리 다시 시도'})).toBeNull());expect(screen.getByRole('button',{name:'첫 안내 · old · 사진 정리 다시 시도'})).toBeEnabled();expect(remove).toHaveBeenCalledTimes(2);expect(vi.mocked(deleteNoticeImages).mock.calls[2]).toEqual([second.blocks,'taebaek','new',expect.objectContaining({companyId:'taebaek'})]);
});
