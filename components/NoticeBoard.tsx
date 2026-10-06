
import React, { useState } from 'react';
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
import { appConfirm, appNotice } from '../src/shared/components/appDialog';

interface NoticeBoardProps {
  posts: Post[];
  companyId?: CompanyId;
  onAddPost?: (_post: Post) => unknown | Promise<unknown>;
  onUpdatePost?: (id: string, patch: Partial<Post>) => unknown | Promise<unknown>;
  onDeletePost?: (id: string) => unknown | Promise<unknown>;
}

const NoticeBoard: React.FC<NoticeBoardProps> = ({ posts, companyId, onAddPost, onUpdatePost, onDeletePost }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', content: '', author: '', tag: '공지' as '공지' | '긴급' | '매뉴얼' | '업무' });
  const [blocks, setBlocks] = useState<NonNullable<Post['blocks']>>([]);
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draftId, setDraftId] = useState(() => `notice-${crypto.randomUUID()}`);
  const closeDraft = async () => {
    if (busy) return;
    try { await deleteNoticeImages(blocks); setBlocks([]); setShowForm(false); }
    catch (error) { await appNotice(String(error)); }
  };
  const uploadPhotos = async (files: File[]) => {
    if (!companyId || busy) return;
    setBusy(true);
    try {
      // Retain each successful upload even if a later image fails, so cancel can clean it up.
      for (const file of files) {
        const image = await uploadNoticeImage(companyId, draftId, file);
        setBlocks(previous => [...previous, image]);
      }
    } catch (error) { await appNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const savePost = async () => {
    if (!onAddPost || busy || !form.title.trim() || (!form.content.trim() && blocks.length === 0)) return;
    setBusy(true);
    try {
      const body: NonNullable<Post['blocks']> = [...(form.content.trim() ? [{ type: 'text' as const, text: form.content }] : []), ...blocks];
      await onAddPost({ id: draftId, ...form, author: form.author || '관리자', date: today(), pinned,
        content: body.map(b => b.type === 'text' ? b.text : b.caption).join('\n'), blocks: body });
      setBlocks([]); setPinned(false); setDraftId(`notice-${crypto.randomUUID()}`);
      setForm({ title: '', content: '', author: '', tag: '공지' }); setShowForm(false);
    } catch (error) { await appNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
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
        right={<div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={14} />
            <input
              type="text"
              placeholder="공지 검색..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-white border border-slate-200 rounded-xl pl-8 pr-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-300 shadow-sm transition-all w-40 md:w-56"
            />
          </div>
          {onAddPost && (
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-black hover:bg-indigo-700 transition-all shadow-sm whitespace-nowrap"
            >
              <Plus size={15} /> 공지 추가
            </button>
          )}
        </div>}
      />

      <div className="grid grid-cols-1 gap-4">
        {filteredPosts.map((post) => (
          <div 
            key={post.id}
            onClick={() => setSelectedPost(post)}
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
      {showForm && onAddPost && (
        <ModalShell title="공지 작성" onClose={() => { void closeDraft(); }}>
          <div className="space-y-5">
            <div className="space-y-4">
              <input
                type="text"
                placeholder="제목"
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
              {blocks.map((block, index) => <div key={block.type === 'image' ? block.path : index} className="space-y-2 border rounded-xl p-3">
                {block.type === 'text' ? <textarea aria-label={`글 단락 ${index + 1}`} rows={4} value={block.text} onChange={e => setBlocks(blocks.map((b, i) => i === index ? { ...block, text: e.target.value } : b))} className="w-full border rounded-lg p-3" /> : <>
                  <img src={block.url} alt={block.caption || '첨부 사진'} className="max-h-80 mx-auto rounded-lg" />
                  <input aria-label={`사진 설명 ${index + 1}`} placeholder="사진 설명" value={block.caption} onChange={e => setBlocks(blocks.map((b, i) => i === index ? { ...block, caption: e.target.value } : b))} className="w-full border rounded-lg p-2" />
                </>}
                <div className="flex gap-3 text-sm">
                  <button disabled={busy || index === 0} onClick={() => setBlocks(previous => { const next = [...previous]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })}>위로</button>
                  <button disabled={busy || index === blocks.length - 1} onClick={() => setBlocks(previous => { const next = [...previous]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; return next; })}>아래로</button>
                  <button disabled={busy} className="text-rose-600" onClick={async () => { setBusy(true); try { await deleteNoticeImages([block]); setBlocks(previous => previous.filter((_, i) => i !== index)); } catch (error) { await appNotice(String(error)); } finally { setBusy(false); } }}>삭제</button>
                </div>
              </div>)}
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
              <textarea
                placeholder="내용"
                rows={6}
                value={form.content}
                onChange={e => setForm({ ...form, content: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button disabled={busy} onClick={() => { void closeDraft(); }} className="flex-1 py-3 rounded-2xl font-bold text-slate-500 bg-white border border-slate-200 hover:bg-slate-50">취소</button>
              <button
                disabled={busy}
                onClick={() => { void savePost(); }}
                className="flex-1 py-3 rounded-2xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-xl shadow-indigo-100"
              >
                {busy ? '처리 중…' : '등록'}
              </button>
            </div>
          </div>
        </ModalShell>
      )}

      {/* Notice Detail Modal */}
      {selectedPost && (
        <ModalShell title={`${selectedPost.title} · ${selectedPost.tag} 공지사항`} onClose={() => setSelectedPost(null)} bodyClassName="!p-0">
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
                {selectedPost.blocks?.length ? selectedPost.blocks.map((block, i) => block.type === 'text'
                  ? <p key={i} className="mb-5">{block.text}</p>
                  : <figure key={block.path} className="my-5"><img src={block.url} alt={block.caption || '공지 사진'} className="w-full rounded-xl" /><figcaption className="text-center text-sm mt-2">{block.caption}</figcaption></figure>) : selectedPost.content}
              </div>
              <div className="pt-6 border-t border-slate-50 flex justify-end">
                {onUpdatePost && <button disabled={busy} className="mr-4 text-sm font-bold" onClick={async () => {
                  setBusy(true); try { await onUpdatePost(selectedPost.id, { pinned: !selectedPost.pinned }); setSelectedPost({ ...selectedPost, pinned: !selectedPost.pinned }); }
                  catch (error) { await appNotice(String(error)); } finally { setBusy(false); }
                }}>{selectedPost.pinned ? '상단 고정 해제' : '상단 고정'}</button>}
                {onDeletePost && <button disabled={busy} className="mr-4 text-sm font-bold text-rose-600" onClick={async () => {
                  if (!await appConfirm('이 공지를 삭제할까요?')) return;
                  setBusy(true); try { await onDeletePost(selectedPost.id); setSelectedPost(null); await deleteNoticeImages(selectedPost.blocks); }
                  catch (error) { await appNotice(String(error)); } finally { setBusy(false); }
                }}>공지 삭제</button>}
                <button 
                  onClick={() => setSelectedPost(null)}
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
