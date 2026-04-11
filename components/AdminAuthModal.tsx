
import React, { useState } from 'react';
import { Lock, ShieldCheck, AlertCircle } from 'lucide-react';

interface AdminAuthModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

const AdminAuthModal: React.FC<AdminAuthModalProps> = ({ onClose, onSuccess }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === '0000') {
      onSuccess();
    } else {
      setError(true);
      setPassword('');
      setTimeout(() => setError(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-md animate-in fade-in duration-300" onClick={onClose} />
      
      <div className={`relative bg-white w-full max-w-sm rounded-3xl shadow-2xl p-8 animate-in zoom-in-95 duration-300 border border-slate-100 ${error ? 'animate-shake' : ''}`}>
        <div className="flex flex-col items-center text-center space-y-4 mb-8">
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg transition-colors ${error ? 'bg-rose-100 text-rose-600' : 'bg-indigo-600 text-white shadow-indigo-200'}`}>
            {error ? <AlertCircle size={32} /> : <Lock size={32} />}
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-900">관리자 인증</h3>
            <p className="text-sm text-slate-500 mt-1">이 메뉴에 접근하려면 비밀번호가 필요합니다.</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="relative">
            <input 
              autoFocus
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호 입력 (기본: 0000)"
              className={`w-full bg-slate-50 border rounded-2xl px-6 py-4 text-center text-2xl tracking-[0.5em] font-black outline-none transition-all ${error ? 'border-rose-300 ring-4 ring-rose-50 text-rose-600' : 'border-slate-200 focus:ring-4 focus:ring-indigo-50 focus:border-indigo-500 text-slate-900'}`}
            />
          </div>

          {error && (
            <p className="text-center text-xs font-bold text-rose-500 animate-in fade-in slide-in-from-top-1">비밀번호가 일치하지 않습니다.</p>
          )}

          <div className="flex space-x-3 pt-2">
            <button 
              type="button"
              onClick={onClose} 
              className="flex-1 py-4 rounded-2xl font-bold text-slate-500 bg-slate-50 hover:bg-slate-100 transition-all"
            >
              닫기
            </button>
            <button 
              type="submit"
              className="flex-1 py-4 rounded-2xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-xl shadow-indigo-100 transition-all flex items-center justify-center space-x-2"
            >
              <ShieldCheck size={20} />
              <span>확인</span>
            </button>
          </div>
        </form>

        <p className="mt-8 text-center text-[10px] text-slate-400 font-bold uppercase tracking-widest">
          Secure Administrator Access
        </p>
      </div>
      
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-8px); }
          75% { transform: translateX(8px); }
        }
        .animate-shake {
          animation: shake 0.2s cubic-bezier(.36,.07,.19,.97) both;
        }
      `}</style>
    </div>
  );
};

export default AdminAuthModal;
