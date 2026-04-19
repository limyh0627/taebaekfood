
import React, { useState } from 'react';
import {
  BellRing,
  Search,
  Calendar,
  User,
  ChevronRight,
  AlertCircle,
  X,
  Plus
} from 'lucide-react';
import { Post } from '../types';

interface NoticeBoardProps {
  posts: Post[];
  onAddPost?: (_post: Post) => void;
}

const NoticeBoard: React.FC<NoticeBoardProps> = ({ posts, onAddPost }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', content: '', author: '', tag: '공지' as '공지' | '긴급' | '매뉴얼' | '업무' });

  const filteredPosts = posts.filter(post => 
    post.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    post.content.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900">공지사항</h2>
          <p className="text-sm text-slate-400 mt-0.5">사내 주요 소식 및 긴급 공지를 확인하세요.</p>
        </div>
        <div className="flex items-center gap-2">
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
        </div>
      </div>

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
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={() => setShowForm(false)} />
          <div className="relative bg-white w-full max-w-lg rounded-3xl shadow-2xl p-8 space-y-5 animate-in zoom-in-95 duration-300">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-black text-slate-900">공지 작성</h3>
              <button onClick={() => setShowForm(false)} className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-full"><X size={20} /></button>
            </div>
            <div className="space-y-4">
              <input
                type="text"
                placeholder="제목"
                value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500"
              />
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
              <button onClick={() => setShowForm(false)} className="flex-1 py-3 rounded-2xl font-bold text-slate-500 bg-white border border-slate-200 hover:bg-slate-50">취소</button>
              <button
                onClick={() => {
                  if (!form.title || !form.content) return;
                  onAddPost({
                    id: `notice-${Date.now()}`,
                    title: form.title,
                    content: form.content,
                    author: form.author || '관리자',
                    date: new Date().toISOString().slice(0, 10),
                    tag: form.tag,
                  });
                  setForm({ title: '', content: '', author: '', tag: '공지' });
                  setShowForm(false);
                }}
                className="flex-1 py-3 rounded-2xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-xl shadow-indigo-100"
              >
                등록
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notice Detail Modal */}
      {selectedPost && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={() => setSelectedPost(null)} />
          <div className="relative bg-white w-full max-w-2xl rounded-[40px] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
            <div className={`p-8 flex items-center justify-between text-white ${selectedPost.tag === '긴급' ? 'bg-rose-600' : 'bg-indigo-600'}`}>
              <div className="flex items-center space-x-4">
                <div className="w-12 h-12 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center">
                  <BellRing size={24} />
                </div>
                <div>
                  <h3 className="text-2xl font-black">{selectedPost.title}</h3>
                  <p className="text-xs opacity-80 font-bold uppercase tracking-widest">{selectedPost.tag} 공지사항</p>
                </div>
              </div>
              <button onClick={() => setSelectedPost(null)} className="p-2 hover:bg-white/10 rounded-full transition-all">
                <X size={24} />
              </button>
            </div>
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
                {selectedPost.content}
              </div>
              <div className="pt-6 border-t border-slate-50 flex justify-end">
                <button 
                  onClick={() => setSelectedPost(null)}
                  className="px-8 py-3 bg-slate-900 text-white rounded-2xl font-black shadow-xl hover:bg-slate-800 transition-all"
                >
                  확인 완료
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NoticeBoard;
