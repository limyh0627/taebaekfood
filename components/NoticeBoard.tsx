import { useNoticeActions } from '../src/features/notices/hooks/useNoticeActions';
import QueryFilterPanel, { QUERY_FILTER_LABEL_CLASS, QUERY_FILTER_CONTROL_CLASS , QUERY_FILTER_FIELD_CLASS, QUERY_FILTER_SEARCH_CLASS, QUERY_FILTER_DATE_CLASS } from '../src/shared/components/QueryFilterPanel';

import React, { useEffect, useRef, useState } from 'react';
import { auth } from '../src/shared/firebase';
import { today } from '../src/shared/day';
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
import { uploadNoticeImage, deleteNoticeImages } from '../src/shared/noticeImage';
import { appNotice } from '../src/shared/components/appDialog';

interface NoticeBoardProps {
  posts: Post[];
  companyId?: CompanyId;
  onAddPost?: (_post: Post) => unknown | Promise<unknown>;
  onUpdatePost?: (id: string, patch: Partial<Post>) => unknown | Promise<unknown>;
  onDeletePost?: (id: string) => unknown | Promise<unknown>;
}

type NoticeBlocks = NonNullable<Post['blocks']>;
const safeLink = (value?: string) => {
  try { const url = new URL(value || ''); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined; }
  catch { return undefined; }
};
function readPending(value: string, companyId?: CompanyId): {post:Post;editing:boolean} {
 const saved=JSON.parse(value);
 const p=saved?.post;
 if(!p || typeof saved.editing!=='boolean' || typeof p.id!=='string' || !p.id || p.id.includes('/') || !['title','content','author','date'].every(key=>typeof p[key]==='string') || !['공지','긴급','매뉴얼','업무'].includes(p.tag) || typeof p.pinned!=='boolean' || !Array.isArray(p.blocks)) throw new Error('저장 요청 형식이 다릅니다.');
 for(const b of p.blocks) {
   if(b?.type==='text') {
     if(typeof b.text!=='string' || (b.bold!==undefined&&typeof b.bold!=='boolean') || (b.format!==undefined&&!['paragraph','heading','subheading','list'].includes(b.format)) || (b.link!==undefined&&(typeof b.link!=='string'||(b.link.trim()&&!safeLink(b.link))))) throw new Error('글 형식이 다릅니다.');
   } else if(b?.type==='image') {
     if(typeof b.caption!=='string'||typeof b.path!=='string'||!b.path.startsWith(`companies/${companyId}/notices/${p.id}/`)||typeof b.url!=='string'||!safeLink(b.url)) throw new Error('사진 소유 정보가 다릅니다.');
   } else throw new Error('단락 형식이 다릅니다.');
 }
 return saved;
}
function NoticeContent({blocks,content}: {blocks?: Post['blocks'];content:string}) {
 return <div className="space-y-5 whitespace-pre-wrap break-words leading-8 text-slate-700">{blocks?.length ? blocks.map((block,index)=>{
   if(block.type==='image') return <figure key={block.path}><img src={block.url} alt={block.caption || '공지 사진'} className="max-h-[640px] mx-auto rounded-xl"/><figcaption className="mt-2 text-center text-sm text-slate-500">{block.caption}</figcaption></figure>;
   const href=safeLink(block.link);
   const text=href ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline">{block.text}</a> : block.text;
   const body=block.bold ? <strong>{text}</strong> : text;
   return block.format==='heading' ? <h2 key={index} className="text-2xl font-bold">{body}</h2> : block.format==='subheading' ? <h3 key={index} className="text-xl font-bold">{body}</h3> : block.format==='list' ? <ul key={index} className="list-disc pl-6">{block.text.split('\n').filter(Boolean).map((line,i)=><li key={i}>{href ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline">{block.bold ? <strong>{line}</strong> : line}</a> : block.bold ? <strong>{line}</strong> : line}</li>)}</ul> : <p key={index}>{body}</p>;
 }) : content}</div>;
}

const NoticeBoard: React.FC<NoticeBoardProps> = ({ posts, companyId, onAddPost, onUpdatePost, onDeletePost }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', content: '', author: '', tag: '공지' as '공지' | '긴급' | '매뉴얼' | '업무' });
  const [blocks, setBlocks] = useState<NonNullable<Post['blocks']>>([]);
  const [editing, setEditing] = useState<Post | null>(null);
  const [newImages, setNewImages] = useState<NoticeBlocks>([]);
  const [preview, setPreview] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const insertionRef = useRef<{ index: number; offset: number } | undefined>(undefined);
  const userId=auth.currentUser?.uid;
  const actions = useNoticeActions({ companyId, actorUid: userId, onUpdatePost, onDeletePost });
  const { selectedPost, actionBusy, actionMessage, cleanupJobs } = actions;
  const scope = useRef({companyId,userId});
  if(scope.current.companyId!==companyId || scope.current.userId!==userId) scope.current={companyId,userId};
  const pendingKey = `notice-save-pending:${companyId || ''}:${userId || ''}`;
  const [pendingCorrupt,setPendingCorrupt]=useState(false);
  const [pending, setPending] = useState<Post | null>(null);
  const pendingRef = useRef<Post | null>(null);
  const [draftId, setDraftId] = useState(() => `notice-${crypto.randomUUID()}`);
  const resetDraft = () => {
    pendingRef.current=null; setPending(null);
    insertionRef.current = undefined;
    setBlocks([]); setNewImages([]); setEditing(null); setPreview(false); setPinned(false);
    setForm({title:'',content:'',author:'',tag:'공지'}); setDraftId(`notice-${crypto.randomUUID()}`); setShowForm(false);
  };
  useEffect(()=>{
    resetDraft();busyRef.current=false;setBusy(false);setPendingCorrupt(false);
    try {
      const raw=sessionStorage.getItem(pendingKey);
      if(raw){
        const saved=readPending(raw,companyId);const post=saved.post;
        pendingRef.current=post;setPending(post);setEditing(saved.editing?post:null);setDraftId(post.id);
        setForm({title:post.title,content:'',author:post.author,tag:post.tag});setBlocks(post.blocks||[]);setPinned(!!post.pinned);setShowForm(true);
      }
    } catch {setPendingCorrupt(true);void appNotice('저장된 공지 요청을 확인할 수 없습니다. 기존 요청을 확인한 뒤 다시 작성해 주세요.');}
  },[companyId,userId]);
  useEffect(()=>()=>{scope.current={companyId:undefined,userId:undefined};},[]);
  const openEdit = (post: Post) => {
    setEditing(post); setDraftId(post.id); setForm({title:post.title,content:'',author:post.author,tag:post.tag});
    setBlocks(post.blocks?.length ? post.blocks.map(block=>({...block})) : [{type:'text',text:post.content}]); setPinned(!!post.pinned); setNewImages([]); setPreview(false); actions.closeSelected(); setShowForm(true);
  };
  const bodyBlocks: NoticeBlocks = [...(form.content.trim() ? [{type:'text',text:form.content} as const] : []), ...blocks];
  const closeDraft = async () => {
    if (busyRef.current) return;
    if (pendingRef.current) { await appNotice('저장 완료를 확인하지 못했습니다. 작성 내용을 유지한 채 같은 공지를 다시 저장해 주세요.'); return; }
    const token=scope.current; busyRef.current=true;setBusy(true);
    try { await deleteNoticeImages(newImages, companyId, draftId); if(scope.current===token && auth.currentUser?.uid===token.userId) resetDraft(); }
    catch (error) { if(scope.current===token && auth.currentUser?.uid===token.userId) await appNotice(String(error)); }
    finally { if(scope.current===token && auth.currentUser?.uid===token.userId){busyRef.current=false;setBusy(false);} }
  };
  const uploadPhotos = async (files: File[], insertion = insertionRef.current) => {
    if (!companyId || busyRef.current || pendingRef.current) return;
    const token=scope.current;busyRef.current=true;setBusy(true);
    let nextIndex: number | undefined;
    try {
      // Retain each successful upload even if a later image fails, so cancel can clean it up.
      for (const file of files) {
        if((scope.current!==token || auth.currentUser?.uid!==token.userId)) return;
        const image = await uploadNoticeImage(companyId, draftId, file);
        if((scope.current!==token || auth.currentUser?.uid!==token.userId)) { await deleteNoticeImages([image],companyId,draftId); return; }
        const target = nextIndex === undefined ? insertion : undefined;
        const at = nextIndex;
        setBlocks(previous => {
          if (target && previous[target.index]?.type === 'text') {
            const text = previous[target.index] as Extract<NoticeBlocks[number], {type:'text'}>;
            const offset = Math.min(target.offset, text.text.length);
            return [...previous.slice(0, target.index), {...text, text:text.text.slice(0, offset)}, image,
              {...text, text:text.text.slice(offset)}, ...previous.slice(target.index + 1)];
          }
          const index = at ?? previous.length;
          return [...previous.slice(0,index), image, ...previous.slice(index)];
        });
        nextIndex = nextIndex === undefined ? (insertion ? insertion.index + 2 : blocks.length + 1) : nextIndex + 1;
        setNewImages(previous => [...previous, image]);
      }
    } catch (error) { if(scope.current===token && auth.currentUser?.uid===token.userId) await appNotice(error instanceof Error ? error.message : String(error)); }
    finally { if(scope.current===token && auth.currentUser?.uid===token.userId){busyRef.current=false;setBusy(false);} }
  };
  const removeBlock = async (index:number) => {
    if(busyRef.current||pendingRef.current) return;
    const token=scope.current,block=blocks[index];busyRef.current=true;setBusy(true);
    try {
      if(block.type==='image' && newImages.some(image=>image.type==='image'&&image.path===block.path)) {
        await deleteNoticeImages([block],companyId,draftId);
        if(scope.current!==token || auth.currentUser?.uid!==token.userId) return;
        setNewImages(previous=>previous.filter(image=>image.type!=='image'||image.path!==block.path));
      }
      if(scope.current===token && auth.currentUser?.uid===token.userId) setBlocks(previous=>previous.filter((_,i)=>i!==index));
    } catch(error) {if(scope.current===token && auth.currentUser?.uid===token.userId) await appNotice(String(error));}
    finally {if(scope.current===token && auth.currentUser?.uid===token.userId){busyRef.current=false;setBusy(false);}}
  };
  const savePost = async () => {
    if (!(editing ? onUpdatePost : onAddPost) || pendingCorrupt || busyRef.current || !form.title.trim() || !bodyBlocks.some(b=>b.type==='image'||b.text.trim())) return;
    if (blocks.some(b=>b.type==='text' && b.link?.trim() && !safeLink(b.link))) { await appNotice('링크는 http 또는 https 주소로 입력해 주세요.'); return; }
    if(!userId) {await appNotice('로그인 상태를 확인한 뒤 다시 저장해 주세요.');return;}
    const token=scope.current;busyRef.current=true;setBusy(true);
    try {
      const body=bodyBlocks.filter(b=>b.type==='image'||b.text.trim());
      const post:Post=pendingRef.current || {id:draftId,...form,author:form.author||'관리자',date:editing?.date||today(),pinned,content:body.map(b=>b.type==='text'?b.text:b.caption).join('\n'),blocks:body};
      const encoded=JSON.stringify({post,editing:!!editing});
      const existing=sessionStorage.getItem(pendingKey);
      if(existing && existing!==encoded) throw new Error('다른 저장 요청이 남아 있습니다. 기존 공지를 먼저 확인해 주세요.');
      sessionStorage.setItem(pendingKey,encoded);
      pendingRef.current=post;setPending(post);
      if(editing) await onUpdatePost!(editing.id,post); else await onAddPost!(post);
      if((scope.current!==token || auth.currentUser?.uid!==token.userId)) return;
      const retained=new Set(body.filter(b=>b.type==='image').map(b=>b.path));
      const removed=editing?.blocks?.filter(b=>b.type==='image'&&!retained.has(b.path));
      try { if(sessionStorage.getItem(pendingKey)===encoded) sessionStorage.removeItem(pendingKey); }
      catch { await appNotice('공지는 저장됐지만 저장 요청 정리는 완료되지 않았습니다.'); }
      resetDraft();
      try { await deleteNoticeImages(removed,companyId,draftId); } catch { await appNotice('공지는 저장됐지만 사용하지 않는 사진 정리는 완료되지 않았습니다.'); }
    } catch(error) { if(scope.current===token && auth.currentUser?.uid===token.userId) await appNotice(error instanceof Error ? error.message : String(error)); }
    finally { if(scope.current===token && auth.currentUser?.uid===token.userId){busyRef.current=false;setBusy(false);} }
  };

  const filteredPosts = posts.filter(post =>
    post.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    post.content.toLowerCase().includes(searchTerm.toLowerCase())
  ).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.date.localeCompare(a.date));

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      <PageHeader
        title="공지사항"
        subtitle="사내 주요 소식 및 긴급 공지를 확인하세요."
        actions={onAddPost ? <div className="flex items-center gap-2">
            <button
              disabled={busy || pendingCorrupt} onClick={() => {setBlocks([{type:'text',text:''}]);setShowForm(true);}}
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
      {showForm && (editing ? onUpdatePost : onAddPost) && (
        <ModalShell title={editing ? "공지 수정" : "공지 작성"} size="large" className="!max-w-7xl md:!h-[90vh] md:!max-h-[90vh]" onClose={() => { void closeDraft(); }} subtitle="본문 커서 위치에 사진을 붙여넣거나 끌어 놓을 수 있습니다." footer={<div className="flex gap-3 pt-2">
              <button disabled={busy} onClick={() => { void closeDraft(); }} className="flex-1 py-3 rounded-2xl font-bold text-slate-500 bg-white border border-slate-200 hover:bg-slate-50">취소</button>
              <button
                disabled={busy}
                onClick={() => { void savePost(); }}
                className="flex-1 py-3 rounded-2xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-xl shadow-indigo-100"
              >
                {busy ? '처리 중…' : pending ? '같은 내용 다시 저장' : editing ? '수정 저장' : '등록'}
              </button>
            </div>}>
          <div className="space-y-5">
            <fieldset disabled={busy || !!pending || pendingCorrupt} className="space-y-4 min-w-0">
              <input
                type="text"
                placeholder="제목"
                autoFocus
                value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <div className="flex flex-wrap gap-3 items-center">
                <label className="cursor-pointer border rounded-xl px-3 py-2 text-sm">사진 첨부
                  <input aria-label="사진 첨부" className="hidden" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy} onChange={e => { void uploadPhotos(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
                </label>
                <button type="button" disabled={busy} onClick={() => setBlocks([...blocks, { type: 'text', text: '' }])} className="border rounded-xl px-3 py-2 text-sm">글 단락 추가</button>
                <label className="text-sm"><input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} /> 상단 고정</label>
              </div>
              <button type="button" onClick={()=>setPreview(!preview)} className="rounded-lg border px-3 py-2 text-sm font-bold">{preview ? '편집으로 돌아가기' : '미리보기'}</button>
              {preview ? <article aria-label="공지 미리보기" className="mx-auto max-w-3xl bg-white p-6 md:p-10 shadow-sm"><h1 className="mb-8 text-3xl font-bold">{form.title || '제목'}</h1><NoticeContent blocks={bodyBlocks} content=""/></article> : <div className="w-full space-y-4 bg-white p-4 md:p-8 shadow-sm">{blocks.map((block, index) => <div key={block.type === 'image' ? block.path : index} className="space-y-2 border rounded-xl p-3">
                {block.type === 'text' ? <><div className="flex flex-wrap gap-2"><select aria-label={`단락 ${index+1} 형식`} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={block.format||'paragraph'} onChange={e=>setBlocks(blocks.map((b,i)=>i===index?{...block,format:e.target.value as typeof block.format}:b))}><option value="paragraph">본문</option><option value="heading">제목</option><option value="subheading">소제목</option><option value="list">목록</option></select><label><input type="checkbox" checked={!!block.bold} onChange={e=>setBlocks(blocks.map((b,i)=>i===index?{...block,bold:e.target.checked}:b))}/> 굵게</label><input aria-label={`단락 ${index+1} 링크`} className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="링크 주소 (선택)" value={block.link||''} onChange={e=>setBlocks(blocks.map((b,i)=>i===index?{...block,link:e.target.value}:b))}/></div><textarea aria-label={`글 단락 ${index + 1}`} rows={10} value={block.text}
                  onFocus={e=>{insertionRef.current={index,offset:e.currentTarget.selectionStart};}}
                  onSelect={e=>{insertionRef.current={index,offset:e.currentTarget.selectionStart};}}
                  onPaste={e=>{const files=Array.from(e.clipboardData.files).filter(file=>file.type.startsWith('image/'));if(files.length){e.preventDefault();void uploadPhotos(files,{index,offset:e.currentTarget.selectionStart});}}}
                  onDragOver={e=>{if(Array.from(e.dataTransfer.items).some(item=>item.kind==='file'&&item.type.startsWith('image/')))e.preventDefault();}}
                  onDrop={e=>{const files=Array.from(e.dataTransfer.files).filter(file=>file.type.startsWith('image/'));if(files.length){e.preventDefault();void uploadPhotos(files,{index,offset:e.currentTarget.selectionStart});}}} onChange={e => setBlocks(blocks.map((b, i) => i === index ? { ...block, text: e.target.value } : b))} className="w-full min-h-72 resize-y border-0 border-b border-slate-100 p-3 text-base leading-8 outline-none focus:border-indigo-300" /><label className="inline-flex cursor-pointer rounded-lg border px-3 py-2 text-sm">커서 위치에 사진 넣기<input aria-label={`단락 ${index+1} 사진 넣기`} type="file" className="hidden" accept="image/jpeg,image/png,image/webp" multiple onChange={e=>{void uploadPhotos(Array.from(e.target.files??[]), insertionRef.current?.index===index ? insertionRef.current : {index,offset:block.text.length});e.target.value='';}}/></label></> : <>
                  <img src={block.url} alt={block.caption || '첨부 사진'} className="max-h-80 mx-auto rounded-lg" />
                  <input aria-label={`사진 설명 ${index + 1}`} placeholder="사진 설명" value={block.caption} onChange={e => setBlocks(blocks.map((b, i) => i === index ? { ...block, caption: e.target.value } : b))} className="w-full border rounded-lg p-2" />
                </>}
                <div className="flex gap-3 text-sm">
                  <button disabled={busy || index === 0} onClick={() => setBlocks(previous => { const next = [...previous]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })}>위로</button>
                  <button disabled={busy || index === blocks.length - 1} onClick={() => setBlocks(previous => { const next = [...previous]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; return next; })}>아래로</button>
                  <button disabled={busy} className="text-rose-600" onClick={()=>{void removeBlock(index);}}>삭제</button>
                </div>
              </div>)}</div>}
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="작성자"
                  value={form.author}
                  onChange={e => setForm({ ...form, author: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <select
                  value={form.tag}
                  onChange={e => setForm({ ...form, tag: e.target.value as typeof form.tag })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {(['공지', '긴급', '매뉴얼', '업무'] as const).map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

            </fieldset>
            {pending && !busy && <p className="text-sm text-amber-700">저장 완료를 확인하지 못했습니다. 아래 버튼으로 같은 내용의 저장을 다시 확인하세요.</p>}

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
                {onUpdatePost && <button disabled={busy || actionBusy} className="mr-4 text-sm font-bold text-indigo-600" onClick={()=>openEdit(selectedPost)}>공지 수정</button>}
                {onUpdatePost && <button disabled={actionBusy} className="mr-4 text-sm font-bold" onClick={() => void actions.togglePinned()}>{selectedPost.pinned ? '상단 고정 해제' : '상단 고정'}</button>}
                {onDeletePost && <button disabled={actionBusy} className="mr-4 text-sm font-bold text-rose-600" onClick={() => void actions.deleteSelected()}>공지 삭제</button>}
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
