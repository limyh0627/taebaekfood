/** @vitest-environment jsdom */
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import NoticeBoard from './NoticeBoard';
import {appConfirm} from '../src/shared/components/appDialog';
import {uploadNoticeImage,deleteNoticeImages} from '../src/shared/noticeImage';
const testAuth=vi.hoisted(()=>({currentUser:{uid:'admin-uid'}}));
vi.mock('../src/shared/firebase',()=>({auth:testAuth}));
beforeEach(()=>{sessionStorage.clear();vi.clearAllMocks();testAuth.currentUser.uid='admin-uid';});
vi.mock('../src/shared/noticeImage', () => ({ uploadNoticeImage: vi.fn(async () => ({ type: 'image', url: 'https://example.com/photo.png', path: 'companies/taebaek/notices/a/photo', caption: '' })), deleteNoticeImages: vi.fn(async () => {}) }));
vi.mock('../src/shared/components/appDialog', () => ({ appConfirm: vi.fn(async () => true), appNotice: vi.fn() }));
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
    fireEvent.click(screen.getByRole('button', { name: '공지 추가' }));
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: '사진 공지' } });
    fireEvent.change(screen.getByLabelText('사진 첨부'), { target: { files: [new File(['photo'], 'a.png', { type: 'image/png' })] } });
    await screen.findByAltText('첨부 사진');
    await waitFor(() => expect(screen.getByRole('button', { name: '등록' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: '글 단락 추가' }));
    fireEvent.change(screen.getByLabelText('글 단락 3'), { target: { value: '사진 아래 설명' } });
    fireEvent.click(screen.getByRole('button', { name: '등록' }));
    await waitFor(() => expect(add).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole('button', { name: '같은 내용 다시 저장' })).not.toBeDisabled());
    expect(screen.getByPlaceholderText('제목')).toHaveValue('사진 공지');
    fireEvent.click(screen.getByRole('button', { name: '같은 내용 다시 저장' }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(2));
    expect(add.mock.calls[1][0].blocks).toEqual([expect.objectContaining({ type: 'image' }), { type: 'text', text: '사진 아래 설명' }]);
  });
});

it('서식과 안전한 링크는 미리보기와 저장된 상세에서 동일하게 렌더한다',async()=>{
 const add=vi.fn().mockResolvedValue(undefined);
 const {rerender}=render(<NoticeBoard posts={[]} companyId="taebaek" onAddPost={add}/>);
 fireEvent.click(screen.getByRole('button',{name:'공지 추가'}));
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
 fireEvent.click(screen.getByText('고정 공지'));fireEvent.click(screen.getByRole('button',{name:'공지 수정'}));
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
 fireEvent.click(screen.getByText('고정 공지'));fireEvent.click(screen.getByRole('button',{name:'공지 수정'}));
 fireEvent.change(screen.getByLabelText('글 단락 1'),{target:{value:'수정 내용'}});
 fireEvent.click(screen.getByRole('button',{name:'수정 저장'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'같은 내용 다시 저장'})).toBeEnabled());
 expect(screen.getByLabelText('글 단락 1')).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'같은 내용 다시 저장'}));
 await waitFor(()=>expect(update).toHaveBeenCalledTimes(2));
 expect(update.mock.calls[1]).toEqual(update.mock.calls[0]);
 expect(update.mock.calls[0][1]).toMatchObject({id:'old',date:'2026-09-01',author:'관리자'});
});
it('저장 결과 미확인 뒤 회사 전환과 재진입은 같은 원문 id로 재개한다',async()=>{
 const add=vi.fn().mockRejectedValueOnce(new Error('응답 유실')).mockResolvedValueOnce(undefined);
 const {rerender}=render(<NoticeBoard posts={[]} companyId="taebaek" onAddPost={add}/>);
 fireEvent.click(screen.getByRole('button',{name:'공지 추가'}));
 fireEvent.change(screen.getByPlaceholderText('제목'),{target:{value:'초안'}});
 fireEvent.change(screen.getByLabelText('글 단락 1'),{target:{value:'보존 원문'}});
 fireEvent.click(screen.getByRole('button',{name:'등록'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'같은 내용 다시 저장'})).toBeEnabled());
 const original=add.mock.calls[0][0];
 rerender(<NoticeBoard posts={[]} companyId="punghoe" onAddPost={add}/>);
 expect(screen.queryByRole('heading',{name:'공지 작성'})).toBeNull();
 rerender(<NoticeBoard posts={[]} companyId="taebaek" onAddPost={add}/>);
 expect(screen.getByPlaceholderText('제목')).toHaveValue('초안');
 fireEvent.click(screen.getByRole('button',{name:'같은 내용 다시 저장'}));
 await waitFor(()=>expect(add).toHaveBeenCalledTimes(2));expect(add.mock.calls[1][0]).toEqual(original);
 expect(sessionStorage.getItem('notice-save-pending:taebaek:admin-uid')).toBeNull();
});
it('회사 전환 뒤 도착한 사진은 새 회사 초안에 넣지 않고 원래 초안의 파일만 정리한다',async()=>{
 let finish!:(value:Awaited<ReturnType<typeof uploadNoticeImage>>)=>void;
 vi.mocked(uploadNoticeImage).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const {rerender}=render(<NoticeBoard posts={[]} companyId="taebaek" onAddPost={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'공지 추가'}));
 fireEvent.change(screen.getByLabelText('사진 첨부'),{target:{files:[new File(['a'],'a.png',{type:'image/png'})]}});
 rerender(<NoticeBoard posts={[]} companyId="punghoe" onAddPost={vi.fn()}/>);
 const image={type:'image' as const,path:'companies/taebaek/notices/a/photo',url:'https://example.com/photo.png',caption:''};finish(image);
 await waitFor(()=>expect(deleteNoticeImages).toHaveBeenCalledWith([image],'taebaek',expect.any(String)));
 expect(screen.queryByAltText('첨부 사진')).toBeNull();
});
it('위험한 링크와 HTML 문자는 실행하거나 저장하지 않는다',async()=>{
 const add=vi.fn();render(<NoticeBoard posts={[]} companyId="taebaek" onAddPost={add}/>);
 fireEvent.click(screen.getByRole('button',{name:'공지 추가'}));
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
 fireEvent.click(screen.getByRole('button',{name:'공지 추가'}));
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
 expect(uploadNoticeImage).toHaveBeenCalledWith('taebaek',expect.any(String),file);
 expect(screen.queryByRole('heading',{name:'공지 작성'})).toBeNull();
});
it('일반 텍스트 붙여넣기는 사진 업로드하지 않는다',()=>{
 render(<NoticeBoard posts={[]} companyId="taebaek" onAddPost={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'공지 추가'}));
 fireEvent.paste(screen.getByLabelText('글 단락 1'),{clipboardData:{files:[]}});
 expect(uploadNoticeImage).not.toHaveBeenCalled();
 expect(screen.getByRole('button',{name:'등록'}).closest('footer')).not.toBeNull();
 expect(screen.getByRole('button',{name:'취소'}).closest('footer')).not.toBeNull();
});

it('공지 작성은 검색 앞 행동 줄이며 검색은 권한 없이도 유지하고 관리자 진입만 노출한다',()=>{
 const add=vi.fn(),view=render(<NoticeBoard posts={posts} onAddPost={add}/>),title=screen.getByRole('heading',{name:'공지사항'}),create=screen.getByRole('button',{name:'공지 추가'}),search=screen.getByRole('textbox',{name:'공지 검색'});
 expect(title.compareDocumentPosition(create)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(create.compareDocumentPosition(search)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(create.closest('[data-page-header-slot="actions"]')).not.toBeNull();fireEvent.change(search,{target:{value:'최근'}});expect(screen.queryByText('고정 공지')).not.toBeInTheDocument();expect(screen.getByText('최근 공지')).toBeInTheDocument();fireEvent.click(create);expect(screen.getByRole('dialog',{name:'공지 작성'})).toBeInTheDocument();expect(add).not.toHaveBeenCalled();view.unmount();render(<NoticeBoard posts={posts}/>);expect(screen.queryByRole('button',{name:'공지 추가'})).not.toBeInTheDocument();expect(screen.getByRole('textbox',{name:'공지 검색'})).toBeInTheDocument();
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
 fireEvent.click(screen.getByRole('button',{name:'공지 추가'}));fireEvent.change(screen.getByPlaceholderText('제목'),{target:{value:'새 작성'}});fireEvent.change(screen.getByLabelText('글 단락 1'),{target:{value:'내용'}});fireEvent.click(screen.getByRole('button',{name:'등록'}));
 await act(async()=>pin.resolve());expect(screen.getByRole('button',{name:'처리 중…'})).toBeDisabled();expect(screen.getByPlaceholderText('제목')).toBeDisabled();await act(async()=>save.resolve());
});
it('삭제 확인 대기 중 같은 회사 UID가 바뀌면 삭제를 송신하지 않는다',async()=>{
 const confirm=actionGate<boolean>(),remove=vi.fn();vi.mocked(appConfirm).mockReturnValueOnce(confirm.promise);
 const view=render(<NoticeBoard posts={posts} companyId="taebaek" onDeletePost={remove}/>);fireEvent.click(screen.getByText('고정 공지'));fireEvent.click(screen.getByRole('button',{name:'공지 삭제'}));
 testAuth.currentUser.uid='other-uid';view.rerender(<NoticeBoard posts={posts} companyId="taebaek" onDeletePost={remove}/>);await act(async()=>confirm.resolve(true));expect(remove).not.toHaveBeenCalled();expect(screen.queryByRole('dialog')).toBeNull();
});

it('사진 정리 두 작업은 원제목과 공지 번호로 구분하고 각각 사진만 다시 시도한다',async()=>{
 const first={...posts[0],title:'첫 안내',blocks:[{type:'image' as const,path:'companies/taebaek/notices/old/photo',url:'https://example.com/one',caption:''}]};
 const second={...posts[1],title:'둘째 안내',blocks:[{type:'image' as const,path:'companies/taebaek/notices/new/photo',url:'https://example.com/two',caption:''}]};
 const remove=vi.fn().mockResolvedValue(undefined);vi.mocked(deleteNoticeImages).mockRejectedValueOnce(new Error('첫 사진 실패')).mockRejectedValueOnce(new Error('둘째 사진 실패'));
 render(<NoticeBoard posts={[first,second]} companyId="taebaek" onDeletePost={remove}/>);
 fireEvent.click(screen.getByText('첫 안내'));fireEvent.click(screen.getByRole('button',{name:'공지 삭제'}));await screen.findByRole('button',{name:'첫 안내 · old · 사진 정리 다시 시도'});
 fireEvent.click(screen.getByText('둘째 안내'));fireEvent.click(screen.getByRole('button',{name:'공지 삭제'}));const retry=await screen.findByRole('button',{name:'둘째 안내 · new · 사진 정리 다시 시도'});
 const panel=screen.getByRole('region',{name:'공지 사진 정리'});expect(panel).toHaveTextContent('첫 안내 · 사진 정리 미완료');expect(panel).toHaveTextContent('둘째 안내 · 사진 정리 미완료');expect(panel).toHaveTextContent('공지 번호: old');expect(panel).toHaveTextContent('공지 번호: new');
 fireEvent.click(retry);await waitFor(()=>expect(screen.queryByRole('button',{name:'둘째 안내 · new · 사진 정리 다시 시도'})).toBeNull());expect(screen.getByRole('button',{name:'첫 안내 · old · 사진 정리 다시 시도'})).toBeEnabled();expect(remove).toHaveBeenCalledTimes(2);expect(vi.mocked(deleteNoticeImages).mock.calls[2]).toEqual([second.blocks,'taebaek','new']);
});
