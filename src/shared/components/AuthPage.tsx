import React, { useState } from 'react';
import { AlertCircle, Eye, EyeOff, Lock, ShieldCheck, User } from 'lucide-react';
import type { Employee } from '../types';
import { loginEmployee } from '../employeeAuth';

interface AuthPageProps { onLogin: (_user: Employee) => void }

const AuthPage: React.FC<AuthPageProps> = ({ onLogin }) => {
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loginData, setLoginData] = useState({ username: '', password: '' });

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const employee = await loginEmployee(loginData.username, loginData.password);
      onLogin(employee);
    } catch (cause: any) {
      setError(String(cause?.code ?? '').includes('resource-exhausted')
        ? '로그인 시도가 너무 많습니다. 15분 뒤 다시 시도해 주세요.'
        : '아이디 또는 비밀번호가 일치하지 않습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-indigo-100 via-slate-50 to-white">
      <div className="w-full max-w-md">
        <header className="mb-10 flex flex-col items-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-cyan-600 text-white shadow-2xl shadow-cyan-200"><ShieldCheck size={32} /></div>
          <h1 className="bg-gradient-to-r from-cyan-600 to-teal-500 bg-clip-text text-3xl font-black uppercase tracking-wide text-transparent">Flow-It</h1>
          <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.3em] text-slate-400">Smart ERP Platform</p>
        </header>

        <section className="rounded-[40px] border border-slate-100 bg-white p-10 shadow-2xl shadow-slate-200/60">
          <h2 className="text-2xl font-black text-slate-900">환영합니다</h2>
          <p className="mt-1 text-xs font-medium text-slate-400">직원 계정으로 로그인하세요</p>
          {error && <div className="mt-6 flex items-center gap-3 rounded-2xl border border-rose-100 bg-rose-50 p-4 text-rose-600"><AlertCircle size={18} /><span className="text-xs font-bold">{error}</span></div>}

          <form onSubmit={handleLogin} className="mt-8 space-y-4">
            <label className="block space-y-2">
              <span className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-400">아이디</span>
              <span className="relative block"><User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
                <input required autoComplete="username" value={loginData.username} onChange={event => setLoginData({ ...loginData, username: event.target.value })}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-4 pl-12 pr-4 text-sm font-bold outline-none transition-all focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10" placeholder="아이디를 입력하세요" />
              </span>
            </label>

            <label className="block space-y-2">
              <span className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-400">비밀번호</span>
              <span className="relative block"><Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
                <input required autoComplete="current-password" type={showPassword ? 'text' : 'password'} value={loginData.password} onChange={event => setLoginData({ ...loginData, password: event.target.value })}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-4 pl-12 pr-12 text-sm font-bold outline-none transition-all focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10" placeholder="••••••••" />
                <button type="button" aria-label="비밀번호 표시 전환" onClick={() => setShowPassword(value => !value)} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>

            <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-3 rounded-3xl bg-indigo-600 py-5 font-black text-white shadow-xl shadow-indigo-100 transition-all hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60">
              <ShieldCheck size={20} /><span>{busy ? '확인 중…' : '시스템 접속하기'}</span>
            </button>
          </form>
          <p className="mt-6 border-t border-slate-100 pt-5 text-center text-xs font-bold leading-5 text-slate-400">아이디·비밀번호 변경은 관리자에게 요청해 주세요.</p>
        </section>
      </div>
    </main>
  );
};

export default AuthPage;
