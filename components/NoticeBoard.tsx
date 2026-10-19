import { useNoticeEditor } from '../src/features/notices/hooks/useNoticeEditor';
import type { NoticeBindings } from '../src/features/notices/infrastructure/noticeWrites';
import { onAuthStateChanged } from 'firebase/auth';
import { useNoticeActions } from '../src/features/notices/hooks/useNoticeActions';
import QueryFilterPanel, { QUERY_FILTER_LABEL_CLASS, QUERY_FILTER_CONTROL_CLASS , QUERY_FILTER_FIELD_CLASS, QUERY_FILTER_SEARCH_CLASS, QUERY_FILTER_DATE_CLASS } from '../src/shared/components/QueryFilterPanel';

import React, { useEffect, useRef, useState } from 'react';
import { auth } from '../src/shared/firebase';
import {
  BellRing,
  Search,
  Calendar,
  User,
  ChevronRight,
  AlertCircle,
  Plus
} from 'lucide-react';
import { Post } from '../types';
import PageHeader from './PageHeader';
import ModalShell from '../src/shared/components/ModalShell';
import type { CompanyId } from '../src/shared/types';

export interface NoticeBoardProps {
  posts: Post[];
  companyId?: CompanyId;
  employeeId?: string;
  canWrite?: boolean;
  noticeBindings?: NoticeBindings;
}

const safeLink = (value?: string) => {
  try { const url = new URL(value || ''); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined; }
  catch { return undefined; }
};
function NoticeContent({blocks,content}: {blocks?: Post['blocks'];content:string}) {
 return <div className="space-y-5 whitespace-pre-wrap break-words leading-8 text-slate-700">{blocks?.length ? blocks.map((block,index)=>{
   if(block.type==='image') return <figure key={block.path}><img src={block.url} alt={block.caption || '공지 사진'} className="max-h-[640px] mx-auto rounded-xl"/><figcaption className="mt-2 text-center text-sm text-slate-500">{block.caption}</figcaption></figure>;
   const href=safeLink(block.link);
   const text=href ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline">{block.text}</a> : block.text;
   const body=block.bold ? <strong>{text}</strong> : text;
   return block.format==='heading' ? <h2 key={index} className="text-2xl font-bold">{body}</h2> : block.format==='subheading' ? <h3 key={index} className="text-xl font-bold">{body}</h3> : block.format==='list' ? <ul key={index} className="list-disc pl-6">{block.text.split('\n').filter(Boolean).map((line,i)=><li key={i}>{href ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline">{block.bold ? <strong>{line}</strong> : line}</a> : block.bold ? <strong>{line}</strong> : line}</li>)}</ul> : <p key={index}>{body}</p>;
 }) : content}</div>;
}

const NoticeBoard: React.FC<NoticeBoardProps> = ({ posts, companyId, employeeId, canWrite, noticeBindings }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const [actorUid, setActorUid] = useState(auth.currentUser?.uid);
  useEffect(() => onAuthStateChanged(auth, user => setActorUid(user?.uid)), []);
  const copyScope = useRef({companyId, actorUid, employeeId});
  if(copyScope.current.companyId !== companyId || copyScope.current.actorUid !== actorUid || copyScope.current.employeeId !== employeeId) copyScope.current = {companyId, actorUid, employeeId};
  useEffect(() => setCopyMessage(''), [companyId, actorUid, employeeId]);
  const copyLegacy = async (raw: string) => {
    const scope = copyScope.current;
    try {
      if(!navigator.clipboard) throw Error('원문 상자에서 직접 선택해 복사해 주세요.');
      await navigator.clipboard.writeText(raw);
      if(copyScope.current === scope && auth.currentUser?.uid === scope.actorUid) setCopyMessage('보관 원문을 복사했습니다. 서버 요청은 보내지 않았습니다.');
    } catch(error) {
      if(copyScope.current === scope && auth.currentUser?.uid === scope.actorUid) setCopyMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const editor = useNoticeEditor({companyId, actorUid, employeeId, ports: noticeBindings, canWrite});
  const actions = useNoticeActions({companyId, actorUid, employeeId, ports: noticeBindings, canWrite, onChanged: editor.refresh});
  const { form, blocks, editing, showForm, preview, pinned, busy, locked, bodyBlocks } = editor;
  const { selectedPost, actionBusy, actionMessage, cleanupJobs } = actions;
  const insertionRef = useRef<{ index: number; offset: number } | undefined>(undefined);
  const openEdit = (post: Post) => {
    insertionRef.current = undefined;
    actions.closeSelected();
    void editor.openEdit(post);
  };
  const closeDraft = () => editor.closeDraft();
  const uploadPhotos = (files: File[], insertion = insertionRef.current) => editor.uploadPhotos(files, insertion);
  const removeBlock = (index: number) => editor.removeBlock(index);
  const savePost = () => editor.save();

  const recoveryEntries = editor.operations.filter(entry => !cleanupJobs.some(job =>
    entry.kind === 'post' && entry.reference && 'planId' in entry.reference
    && entry.reference.planId === job.reference.planId && entry.reference.postId === job.postId));
  const messageInRecovery = recoveryEntries.some(entry => entry.reference && editor.resultFor(entry.reference)?.serverResult?.message === editor.message);
  const showRecovery = recoveryEntries.length > 0 || editor.photos.length > 0 || !!editor.legacy;

  const filteredPosts = posts.filter(post =>
    post.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    post.content.toLowerCase().includes(searchTerm.toLowerCase())
  ).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.date.localeCompare(a.date));

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      <PageHeader
        title="공지사항"
        subtitle="사내 주요 소식 및 긴급 공지를 확인하세요."
        actions={editor.canWrite ? <div className="flex items-center gap-2">
            <button
              disabled={!editor.canCreateNew || editor.readLoading} onClick={() => { insertionRef.current = undefined; editor.openCreate(); }}
              className="flex h-9 items-center gap-1.5 px-4 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 whitespace-nowrap"
            >
              <Plus size={15} /> 공지 추가
            </button>
        </div> : undefined}
      />
      <QueryFilterPanel onReset={() => setSearchTerm('')} searchRow={<>
<label className={QUERY_FILTER_SEARCH_CLASS}><span>전체 검색</span>
<div className="relative w-full min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={13} />
            <input
              type="text"
              placeholder="공지 검색..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              aria-label="공지 검색" className={(QUERY_FILTER_CONTROL_CLASS + ' w-full' + ' pl-9 pr-3') + ' w-full min-w-0 max-w-full'}
            />
          </div>
</label>
</>} />


      {editor.readLoading && <p role="status" className="text-sm text-slate-600">보관된 공지 요청을 확인하고 있습니다.</p>}
      {editor.readError && <div className="space-y-2"><p role="status" className="text-sm text-slate-600">{editor.readError}</p><button type="button" onClick={() => void editor.refresh()} disabled={busy} className="rounded border border-slate-200 px-3 py-2 text-xs">보관 요청 다시 읽기</button></div>}
      {!showForm && !messageInRecovery && editor.message && <p role="status" className="whitespace-pre-line text-sm text-slate-600">{editor.message}</p>}
      {showRecovery && <section aria-label="공지 요청 복구" className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
        <h3 className="text-sm font-bold text-slate-700">보관된 공지 요청</h3>
        {recoveryEntries.map(entry => {
          const outcome = entry.reference ? editor.resultFor(entry.reference) : undefined;
          const nextAction = outcome && 'nextAction' in outcome ? outcome.nextAction : undefined;
          return <div key={entry.key} className="space-y-2 border-t border-slate-200 pt-3">
          <p className="text-sm font-semibold">{entry.description}</p>
          <p className="text-xs text-slate-500">{entry.reference ? '공지 번호: '+entry.reference.postId : '요청 번호를 읽을 수 없습니다. 원문을 보존했습니다.'} · {entry.kind === 'photo' ? '사진 요청' : '본문 요청'}</p>
          {entry.reference && editor.resultFor(entry.reference)?.serverResult && <p className="whitespace-pre-line text-sm text-slate-600">{editor.resultFor(entry.reference)?.serverResult?.message}</p>}
          {nextAction && <p className="text-sm text-slate-600">{nextAction}</p>}
          {entry.status !== 'valid' && <p className="text-sm text-slate-600">보관 원문을 확인하지 못했습니다. 같은 원문 재전송은 하지 않습니다.</p>}
          {entry.reference && <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void editor.inspect(entry.reference!)} className="rounded border border-slate-200 px-3 py-2 text-xs">실제 처리 결과 확인</button>
            {editor.canRetry(entry) && <button type="button" disabled={busy} onClick={() => void editor.retry(entry.reference!)} className="rounded border border-slate-200 px-3 py-2 text-xs">같은 요청 재개</button>}
            {editor.canCancel(entry) && <button type="button" disabled={busy} onClick={() => void editor.cancel(entry.reference!)} className="rounded border border-slate-200 px-3 py-2 text-xs">미처리 요청 중단</button>}
            {editor.canCleanup(entry) && <button type="button" disabled={busy} onClick={() => void editor.cleanup(entry.reference!)} className="rounded border border-slate-200 px-3 py-2 text-xs">남은 사진 정리</button>}
            {editor.requiresFile(entry) && 'uploadId' in entry.reference && <label className="inline-flex cursor-pointer rounded border border-slate-200 px-3 py-2 text-xs">같은 사진 다시 선택<input aria-label={entry.description+' 같은 사진 다시 선택'} className="hidden" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => {const file=event.target.files?.[0]; if(file && entry.reference && 'uploadId' in entry.reference) void editor.resumePhoto(entry.reference.uploadId,file); event.target.value='';}}/></label>}
            {editor.canDiscard(entry) && <button type="button" disabled={busy} onClick={() => void editor.discardCopy(entry.reference!, entry.observedLocalText, entry.observedReferenceText)} className="rounded border border-slate-200 px-3 py-2 text-xs">이 기기 사본만 정리</button>}
          </div>}
        </div>;})}
        {editor.photos.filter(photo => !photo.block).map(photo => <div key={photo.id} className="space-y-2 border-t border-slate-200 pt-3">
          <p className="text-sm font-semibold">사진 전송 · {photo.plan.request.reference.postId}</p>
          {photo.message && <p className="text-sm text-slate-600">{photo.message}</p>}
          <button type="button" disabled={busy || photo.busy} onClick={() => void editor.resumePhoto(photo.id)} className="rounded border border-slate-200 px-3 py-2 text-xs">같은 사진 전송 재개</button>
          <label className="inline-flex cursor-pointer rounded border border-slate-200 px-3 py-2 text-xs">같은 사진 다시 선택
            <input aria-label={photo.id+' 같은 사진 다시 선택'} className="hidden" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => {const file=event.target.files?.[0]; if(file) void editor.resumePhoto(photo.id,file); event.target.value='';}} />
          </label>
        </div>)}
        {editor.legacy && <div className="space-y-2 border-t border-slate-200 pt-3" aria-label="이전 방식 보관 요청">
          <p className="text-sm font-semibold">이전 방식 보관 요청 · {editor.legacy.post?.title || '원문 확인 필요'}</p>
          <p className="whitespace-pre-line text-sm text-slate-600">{editor.legacy.message}</p>
          {editor.legacy.post && <details className="text-sm"><summary>보관된 원문 보기</summary><p>{editor.legacy.post.title}</p><NoticeContent blocks={editor.legacy.post.blocks} content={editor.legacy.post.content}/></details>}
          {!editor.legacy.postId && <div className="space-y-2 text-sm text-slate-600">
            <p>공지 번호를 확인할 수 없어 서버 처리 여부나 요청 중단은 확인하지 못했습니다. 보관 원문과 현재 공지 목록을 비교한 뒤 이 기기 사본만 정리할 수 있습니다.</p>
            <textarea aria-label="식별 불가 보관 원문" readOnly value={editor.legacy.observedLocalText} className="w-full rounded border border-slate-200 p-2"/>
            <button type="button" onClick={() => void copyLegacy(editor.legacy!.observedLocalText)} className="rounded border border-slate-200 px-3 py-2 text-xs">보관 원문 복사</button>
            {copyMessage && <p role="status">{copyMessage}</p>}
          </div>}
          {editor.legacy.observation && <div className="space-y-2 text-sm">
            <p>{editor.legacy.observation.exists ? '현재 서버에 공지가 있습니다. 보관 요청의 저장 성공이 확인된 것은 아닙니다.' : '현재 서버에 이 공지가 없습니다. 이전 요청 실패를 뜻하지 않습니다.'}</p>
            {editor.legacy.observedPost && <details><summary>현재 서버 내용 보기</summary><p>{String(editor.legacy.observedPost.title ?? '')}</p><p className="whitespace-pre-line">{String(editor.legacy.observedPost.content ?? '')}</p></details>}
          </div>}
          <div className="flex flex-wrap gap-2">
            {editor.legacy.postId && <button type="button" disabled={busy} onClick={() => void editor.legacyInspect()} className="rounded border border-slate-200 px-3 py-2 text-xs">현재 공지와 대조</button>}
            <button type="button" disabled={busy || !editor.canDiscardLegacy} onClick={() => void editor.legacyDiscard(editor.legacy!.observedLocalText, editor.legacy!.observedReferenceText)} className="rounded border border-slate-200 px-3 py-2 text-xs">{editor.legacy.postId ? '이전 기기 사본만 정리' : '이 기기의 식별 불가 사본 정리'}</button>
          </div>
        </div>}
      </section>}
      {editor.canWrite && <section aria-label="공지 처리 이력" className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
        <button type="button" disabled={editor.historyLoading} onClick={() => void editor.loadHistory()} className="rounded border border-slate-200 px-3 py-2 text-xs">서버 처리 이력 조회</button>
        {editor.historyLoading && <p role="status" className="text-sm text-slate-600">서버 처리 이력을 조회하고 있습니다.</p>}
        {editor.historyError && <p role="status" className="text-sm text-slate-600">{editor.historyError}</p>}
        {editor.history.map((entry,index) => <div key={entry.kind+':'+index} className="space-y-1 border-t border-slate-200 pt-2 text-sm">
          <p className="font-semibold">{entry.label || entry.result.reference.postId} · {entry.kind === 'photo' ? '사진 요청' : '본문 요청'}</p>
          <p className="text-xs text-slate-500">{entry.createdAt}</p><p>{entry.result.message}</p>
          <button type="button" disabled={busy} onClick={() => void editor.inspect(entry.result.reference)} className="rounded border border-slate-200 px-3 py-2 text-xs">이 요청 결과 확인</button>
          {['pending','manual-blocked'].includes(entry.result.cleanupStatus) && <button type="button" disabled={busy} onClick={() => void editor.cleanup(entry.result.reference)} className="rounded border border-slate-200 px-3 py-2 text-xs">이 요청 남은 사진 정리</button>}
          {['unknown','reserved'].includes(entry.result.status) && <button type="button" disabled={busy} onClick={() => void editor.cancel(entry.result.reference)} className="rounded border border-slate-200 px-3 py-2 text-xs">이 요청 미처리 중단</button>}
        </div>)}
        {editor.historyMore && <><p className="text-sm text-slate-600">더 확인할 요청이 있습니다.</p><button type="button" disabled={editor.historyLoading} onClick={() => void editor.nextHistory()} className="rounded border border-slate-200 px-3 py-2 text-xs">다음 이력 확인</button></>}
      </section>}

      {!selectedPost && actionMessage && <p role="status" className="whitespace-pre-line text-sm text-slate-600">{actionMessage}</p>}
      {cleanupJobs.length > 0 && <section aria-label="공지 사진 정리" className="space-y-2 rounded-lg border border-slate-200 p-3">
        <h3 className="text-sm font-bold text-slate-700">공지 사진 정리</h3>
        {cleanupJobs.map(job => <div key={job.jobId} className="flex flex-wrap items-center gap-2 text-sm">
          <div className="min-w-0">
            <p className="font-bold text-slate-700">{job.displayTitle} · 사진 정리 미완료</p>
            <p className="text-xs text-slate-500">공지 번호: {job.postId}</p>
            <p className="whitespace-pre-line text-slate-600">{job.message}</p>
          </div>
          <button type="button" aria-label={`${job.displayTitle} · ${job.postId} · 사진 정리 다시 시도`} disabled={job.status === 'running'} onClick={() => void actions.retryCleanup(job.jobId)} className="rounded border border-slate-200 px-3 py-2 text-xs">
            {job.status === 'running' ? '사진 정리 중…' : '사진 정리 다시 시도'}
          </button>
        </div>)}
      </section>}

      <div className="grid grid-cols-1 gap-4">
        {filteredPosts.map((post) => (
          <div
            key={post.id}
            onClick={() => actions.selectPost(post)}
            className={`group bg-white p-6 rounded-3xl border transition-all cursor-pointer hover:shadow-xl hover:border-indigo-100 flex items-center justify-between ${post.tag === '긴급' ? 'border-rose-100 ring-1 ring-rose-50' : 'border-slate-100'}`}
          >
            <div className="flex items-center space-x-6">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-110 ${post.tag === '긴급' ? 'bg-rose-100 text-rose-600' : 'bg-indigo-50 text-indigo-600'}`}>
                {post.tag === '긴급' ? <AlertCircle size={28} /> : <BellRing size={28} />}
              </div>
              <div>
                <div className="flex items-center space-x-3 mb-1">
                  <span className={`px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-widest ${post.tag === '긴급' ? 'bg-rose-500 text-white shadow-lg shadow-rose-100' : 'bg-slate-100 text-slate-500'}`}>
                    {post.tag}
                  </span>
                  <h3 className="font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">{post.title}</h3>
                  {post.pinned && <span className="text-xs font-bold text-rose-600">상단 고정</span>}
                </div>
                <div className="flex items-center space-x-4 text-xs text-slate-400 font-medium">
                  <span className="flex items-center"><User size={12} className="mr-1.5" />{post.author}</span>
                  <span className="flex items-center"><Calendar size={12} className="mr-1.5" />{post.date}</span>
                </div>
              </div>
            </div>
            <ChevronRight className="text-slate-300 group-hover:text-indigo-500 group-hover:translate-x-1 transition-all" size={20} />
          </div>
        ))}
      </div>

      {/* 공지 작성 모달 */}
      {showForm && editor.canWrite && (
        <ModalShell title={editing ? "공지 수정" : "공지 작성"} size="large" className="!max-w-7xl md:!h-[90vh] md:!max-h-[90vh]" onClose={() => { void closeDraft(); }} subtitle="본문 커서 위치에 사진을 붙여넣거나 끌어 놓을 수 있습니다." footer={<div className="flex gap-3 pt-2">
              <button disabled={busy} onClick={() => { void closeDraft(); }} className="flex-1 py-3 rounded-2xl font-bold text-slate-500 bg-white border border-slate-200 hover:bg-slate-50">{locked ? '보기 닫기' : '취소'}</button>
              <button
                disabled={!editor.canSave}
                onClick={() => { void savePost(); }}
                className="flex-1 py-3 rounded-2xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-xl shadow-indigo-100"
              >
                {busy ? '처리 중…' : editing ? '수정 저장' : '등록'}
              </button>
            </div>}>
          <div className="space-y-5">
            <fieldset disabled={busy || locked} className="space-y-4 min-w-0">
              <input
                type="text"
                placeholder="제목"
                autoFocus
                value={form.title}
                onChange={e => editor.changeField('title', e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <div className="flex flex-wrap gap-3 items-center">
                <label className="cursor-pointer border rounded-xl px-3 py-2 text-sm">사진 첨부
                  <input aria-label="사진 첨부" className="hidden" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy} onChange={e => { void uploadPhotos(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
                </label>
                <button type="button" disabled={busy} onClick={() => editor.addText()} className="border rounded-xl px-3 py-2 text-sm">글 단락 추가</button>
                <label className="text-sm"><input type="checkbox" checked={pinned} onChange={e => editor.setPinned(e.target.checked)} /> 상단 고정</label>
              </div>
              <button type="button" onClick={()=>editor.setPreview(!preview)} className="rounded-lg border px-3 py-2 text-sm font-bold">{preview ? '편집으로 돌아가기' : '미리보기'}</button>
              {preview ? <article aria-label="공지 미리보기" className="mx-auto max-w-3xl bg-white p-6 md:p-10 shadow-sm"><h1 className="mb-8 text-3xl font-bold">{form.title || '제목'}</h1><NoticeContent blocks={bodyBlocks} content=""/></article> : <div className="w-full space-y-4 bg-white p-4 md:p-8 shadow-sm">{blocks.map((block, index) => <div key={block.type === 'image' ? block.path : index} className="space-y-2 border rounded-xl p-3">
                {block.type === 'text' ? <><div className="flex flex-wrap gap-2"><select aria-label={`단락 ${index+1} 형식`} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={block.format||'paragraph'} onChange={e=>editor.changeBlock(index, {format:e.target.value as typeof block.format})}><option value="paragraph">본문</option><option value="heading">제목</option><option value="subheading">소제목</option><option value="list">목록</option></select><label><input type="checkbox" checked={!!block.bold} onChange={e=>editor.changeBlock(index, {bold:e.target.checked})}/> 굵게</label><input aria-label={`단락 ${index+1} 링크`} className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="링크 주소 (선택)" value={block.link||''} onChange={e=>editor.changeBlock(index, {link:e.target.value})}/></div><textarea aria-label={`글 단락 ${index + 1}`} rows={10} value={block.text}
                  onFocus={e=>{insertionRef.current={index,offset:e.currentTarget.selectionStart};}}
                  onSelect={e=>{insertionRef.current={index,offset:e.currentTarget.selectionStart};}}
                  onPaste={e=>{const files=Array.from(e.clipboardData.files).filter(file=>file.type.startsWith('image/'));if(files.length){e.preventDefault();void uploadPhotos(files,{index,offset:e.currentTarget.selectionStart});}}}
                  onDragOver={e=>{if(Array.from(e.dataTransfer.items).some(item=>item.kind==='file'&&item.type.startsWith('image/')))e.preventDefault();}}
                  onDrop={e=>{const files=Array.from(e.dataTransfer.files).filter(file=>file.type.startsWith('image/'));if(files.length){e.preventDefault();void uploadPhotos(files,{index,offset:e.currentTarget.selectionStart});}}} onChange={e => editor.changeBlock(index, {text:e.target.value})} className="w-full min-h-72 resize-y border-0 border-b border-slate-100 p-3 text-base leading-8 outline-none focus:border-indigo-300" /><label className="inline-flex cursor-pointer rounded-lg border px-3 py-2 text-sm">커서 위치에 사진 넣기<input aria-label={`단락 ${index+1} 사진 넣기`} type="file" className="hidden" accept="image/jpeg,image/png,image/webp" multiple onChange={e=>{void uploadPhotos(Array.from(e.target.files??[]), insertionRef.current?.index===index ? insertionRef.current : {index,offset:block.text.length});e.target.value='';}}/></label></> : <>
                  <img src={block.url} alt={block.caption || '첨부 사진'} className="max-h-80 mx-auto rounded-lg" />
                  <input aria-label={`사진 설명 ${index + 1}`} placeholder="사진 설명" value={block.caption} onChange={e => editor.changeBlock(index, {caption:e.target.value})} className="w-full border rounded-lg p-2" />
                </>}
                <div className="flex gap-3 text-sm">
                  <button disabled={busy || index === 0} onClick={() => editor.moveBlock(index, -1)}>위로</button>
                  <button disabled={busy || index === blocks.length - 1} onClick={() => editor.moveBlock(index, 1)}>아래로</button>
                  <button disabled={busy} className="text-rose-600" onClick={()=>{void removeBlock(index);}}>삭제</button>
                </div>
              </div>)}</div>}
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="작성자"
                  value={form.author}
                  onChange={e => editor.changeField('author', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <select
                  value={form.tag}
                  onChange={e => editor.changeField('tag', e.target.value as typeof form.tag)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {(['공지', '긴급', '매뉴얼', '업무'] as const).map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

            </fieldset>
            {editor.message && <p role="status" className="whitespace-pre-line text-sm text-slate-600">{editor.message}</p>}

          </div>
        </ModalShell>
      )}

      {/* Notice Detail Modal */}
      {selectedPost && (
        <ModalShell title={`${selectedPost.title} · ${selectedPost.tag} 공지사항`} onClose={() => actions.closeSelected()} bodyClassName="!p-0">
            <div className="p-10 space-y-8">
              <div className="flex items-center justify-between border-b border-slate-100 pb-6">
                <div className="flex items-center space-x-6">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black text-slate-400 uppercase">작성자</span>
                    <span className="text-sm font-bold text-slate-700">{selectedPost.author}</span>
                  </div>
                  <div className="w-px h-8 bg-slate-100" />
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black text-slate-400 uppercase">게시일</span>
                    <span className="text-sm font-bold text-slate-700">{selectedPost.date}</span>
                  </div>
                </div>
              </div>
              <div className="text-slate-600 leading-relaxed whitespace-pre-wrap font-medium min-h-[200px]">
                <NoticeContent blocks={selectedPost.blocks} content={selectedPost.content}/>
                {actionMessage && <p role="status" className="mt-3 whitespace-pre-line text-sm text-slate-600">{actionMessage}</p>}
              </div>
              <div className="pt-6 border-t border-slate-50 flex justify-end">
                {editor.canWrite && <button disabled={busy || actionBusy} className="mr-4 text-sm font-bold text-indigo-600" onClick={()=>openEdit(selectedPost)}>공지 수정</button>}
                {editor.canWrite && <button disabled={actionBusy} className="mr-4 text-sm font-bold" onClick={() => void actions.togglePinned()}>{selectedPost.pinned ? '상단 고정 해제' : '상단 고정'}</button>}
                {editor.canWrite && <button disabled={actionBusy} className="mr-4 text-sm font-bold text-rose-600" onClick={() => void actions.deleteSelected()}>공지 삭제</button>}
                <button
                  onClick={() => actions.closeSelected()}
                  className="px-8 py-3 bg-slate-900 text-white rounded-2xl font-black shadow-xl hover:bg-slate-800 transition-all"
                >
                  확인 완료
                </button>
              </div>
            </div>
        </ModalShell>
      )}
    </div>
  );
};

export default NoticeBoard;
