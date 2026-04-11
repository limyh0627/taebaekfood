
import React, { useState } from 'react';
import { 
  Lock, 
  User, 
  Phone,
  Calendar,
  ArrowLeft,
  ShieldCheck, 
  AlertCircle,
  Package,
  Eye,
  EyeOff,
  UserPlus,
  Search,
  KeyRound
} from 'lucide-react';
import { Employee } from '../types';

interface AuthPageProps {
  onLogin: (_user: Employee) => void;
  registeredEmployees: Employee[];
  onRegister: (_newEmployee: Employee) => void;
}

type AuthView = 'login' | 'register' | 'find';
type RegisterStep = 'verify' | 'create';

const AuthPage: React.FC<AuthPageProps> = ({ onLogin, registeredEmployees, onRegister }) => {
  const [view, setView] = useState<AuthView>('login');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [foundInfo, setFoundInfo] = useState<{username: string, password: string} | null>(null);

  // Login form state
  const [loginData, setLoginData] = useState({ username: '', password: '' });

  // Register state
  const [registerStep, setRegisterStep] = useState<RegisterStep>('verify');
  const [matchedEmployee, setMatchedEmployee] = useState<Employee | null>(null);
  const [verifyData, setVerifyData] = useState({ name: '', birthDate: '', phone: '' });
  const [registerData, setRegisterData] = useState({ username: '', password: '' });

  // Find info state
  const [findData, setFindData] = useState({ name: '', phone: '' });

  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 11);
    if (digits.length <= 3) return digits;
    if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    const user = registeredEmployees.find(
      emp => emp.username === loginData.username && emp.password === loginData.password
    );

    if (user) {
      onLogin(user);
    } else {
      setError('아이디 또는 비밀번호가 일치하지 않습니다.');
    }
  };

  const handleQuickLogin = () => {
    // Default to the first employee (admin) for quick development access
    if (registeredEmployees.length > 0) {
      onLogin(registeredEmployees[0]);
    }
  };

  const handleVerify = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const found = registeredEmployees.find(
      emp =>
        emp.name === verifyData.name &&
        emp.birthDate === verifyData.birthDate &&
        emp.phone === verifyData.phone
    );

    if (!found) {
      setError('등록된 직원 정보와 일치하지 않습니다. 이름, 생년월일, 전화번호를 확인해주세요.');
      return;
    }

    if (found.username) {
      setError('이미 계정이 생성된 직원입니다. 로그인 페이지에서 로그인해주세요.');
      return;
    }

    setMatchedEmployee(found);
    setRegisterStep('create');
  };

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!matchedEmployee) return;

    if (registeredEmployees.some(emp => emp.username === registerData.username)) {
      setError('이미 사용 중인 아이디입니다.');
      return;
    }

    onRegister({ ...matchedEmployee, username: registerData.username, password: registerData.password });
    setView('login');
    setLoginData({ username: registerData.username, password: registerData.password });
    alert('회원가입이 완료되었습니다! 생성한 계정으로 로그인해주세요.');
  };

  const handleFindInfo = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setFoundInfo(null);

    const user = registeredEmployees.find(
      emp => emp.name === findData.name && emp.phone === findData.phone
    );

    if (user && user.username && user.password) {
      setFoundInfo({ username: user.username, password: user.password });
    } else {
      setError('입력하신 정보와 일치하는 계정을 찾을 수 없습니다.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-indigo-100 via-slate-50 to-white">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-10">
          <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-2xl shadow-indigo-200 mb-4 animate-bounce">
            <Package size={32} />
          </div>
          <h1 className="text-3xl font-black bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-violet-600 uppercase">스마트오더</h1>
          <p className="text-slate-400 font-bold text-[10px] mt-2 uppercase tracking-[0.3em]">물류 주문 관리 시스템</p>
        </div>

        <div className="bg-white rounded-[40px] shadow-2xl shadow-slate-200/60 border border-slate-100 p-10 relative overflow-hidden transition-all duration-500">
          {/* Decorative Elements */}
          <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-50 rounded-full -translate-y-16 translate-x-16 blur-3xl opacity-50" />
          <div className="absolute bottom-0 left-0 w-24 h-24 bg-violet-50 rounded-full translate-y-12 -translate-x-12 blur-2xl opacity-50" />
          
          <div className="relative">
            <div className="flex justify-between items-center mb-8">
              <div>
                <h2 className="text-2xl font-black text-slate-900">
                  {view === 'login' && '환영합니다'}
                  {view === 'register' && registerStep === 'verify' && '본인 확인'}
                  {view === 'register' && registerStep === 'create' && '계정 설정'}
                  {view === 'find' && '계정 정보 찾기'}
                </h2>
                <p className="text-xs text-slate-400 font-medium mt-1">
                  {view === 'login' && '아이디와 비밀번호를 입력하세요'}
                  {view === 'register' && registerStep === 'verify' && '등록된 직원 정보로 본인 확인을 해주세요'}
                  {view === 'register' && registerStep === 'create' && '사용할 아이디와 비밀번호를 설정하세요'}
                  {view === 'find' && '가입 시 등록한 정보를 입력하세요'}
                </p>
              </div>
              {view !== 'login' && (
                <button
                  onClick={() => {
                    setView('login');
                    setError('');
                    setFoundInfo(null);
                    setRegisterStep('verify');
                    setMatchedEmployee(null);
                    setVerifyData({ name: '', birthDate: '', phone: '' });
                    setRegisterData({ username: '', password: '' });
                  }}
                  className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-all"
                >
                  <ArrowLeft size={20} />
                </button>
              )}
            </div>

            {error && (
              <div className="bg-rose-50 border border-rose-100 text-rose-600 p-4 rounded-2xl flex items-center space-x-3 mb-6 animate-in slide-in-from-top-2">
                <AlertCircle size={18} />
                <span className="text-xs font-bold">{error}</span>
              </div>
            )}

            {view === 'login' && (
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">아이디 (ID)</label>
                  <div className="relative">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
                    <input 
                      required
                      type="text"
                      value={loginData.username}
                      onChange={(e) => setLoginData({...loginData, username: e.target.value})}
                      placeholder="아이디를 입력하세요"
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-12 pr-4 py-4 text-sm font-bold outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between items-center ml-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">비밀번호 (PW)</label>
                    <button 
                      type="button" 
                      onClick={() => { setView('find'); setError(''); }}
                      className="text-[10px] font-black text-indigo-500 hover:underline uppercase"
                    >
                      비밀번호를 잊으셨나요?
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
                    <input 
                      required
                      type={showPassword ? "text" : "password"}
                      value={loginData.password}
                      onChange={(e) => setLoginData({...loginData, password: e.target.value})}
                      placeholder="••••••••"
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-12 pr-12 py-4 text-sm font-bold outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all"
                    />
                    <button 
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500 transition-colors"
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>
                
                <div className="pt-2 space-y-3">
                  <button 
                    type="submit"
                    className="w-full bg-indigo-600 text-white py-5 rounded-3xl font-black shadow-xl shadow-indigo-100 hover:bg-indigo-700 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center space-x-3"
                  >
                    <ShieldCheck size={20} />
                    <span>시스템 접속하기</span>
                  </button>

                </div>

                <div className="pt-6 text-center border-t border-slate-50 flex flex-col space-y-3">
                  <p className="text-xs text-slate-400 font-bold">
                    신규 사용자이신가요?{' '}
                    <button 
                      type="button"
                      onClick={() => { setView('register'); setError(''); }}
                      className="text-indigo-600 hover:underline ml-1"
                    >
                      회원가입하기
                    </button>
                  </p>
                </div>
              </form>
            )}

            {view === 'register' && registerStep === 'verify' && (
              <form onSubmit={handleVerify} className="space-y-4">
                <div className="bg-indigo-50 border border-indigo-100 rounded-2xl px-5 py-3.5 text-xs font-bold text-indigo-600 flex items-start space-x-2">
                  <ShieldCheck size={16} className="mt-0.5 shrink-0" />
                  <span>인사팀에 등록된 이름, 생년월일, 전화번호를 입력하여 본인 확인 후 계정을 만들 수 있습니다.</span>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">이름</label>
                  <div className="relative">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
                    <input required type="text" value={verifyData.name} onChange={(e) => setVerifyData({...verifyData, name: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-11 pr-4 py-3.5 text-sm font-bold outline-none focus:border-indigo-500" placeholder="홍길동" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">생년월일</label>
                  <div className="relative">
                    <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
                    <input required type="date" value={verifyData.birthDate} onChange={(e) => setVerifyData({...verifyData, birthDate: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-11 pr-4 py-3.5 text-sm font-bold outline-none focus:border-indigo-500" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">핸드폰 번호</label>
                  <div className="relative">
                    <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
                    <input required type="text" inputMode="numeric" value={verifyData.phone} onChange={(e) => setVerifyData({...verifyData, phone: formatPhone(e.target.value)})} className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-11 pr-4 py-3.5 text-sm font-bold outline-none focus:border-indigo-500" placeholder="01012345678" />
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full bg-indigo-600 text-white py-4 mt-2 rounded-3xl font-black shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-all flex items-center justify-center space-x-2"
                >
                  <Search size={20} />
                  <span>본인 확인하기</span>
                </button>
              </form>
            )}

            {view === 'register' && registerStep === 'create' && matchedEmployee && (
              <form onSubmit={handleRegister} className="space-y-4">
                <div className="bg-emerald-50 border border-emerald-100 rounded-2xl px-5 py-4 flex items-center space-x-4">
                  <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center font-black text-lg shrink-0">
                    {matchedEmployee.name[0]}
                  </div>
                  <div>
                    <p className="text-xs font-black text-emerald-400 uppercase tracking-widest">본인 확인 완료</p>
                    <p className="font-black text-slate-800">{matchedEmployee.name} <span className="text-slate-400 font-bold text-sm">· {matchedEmployee.department} {matchedEmployee.position}</span></p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">사용할 아이디</label>
                  <div className="relative">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
                    <input required type="text" value={registerData.username} onChange={(e) => setRegisterData({...registerData, username: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-11 pr-4 py-3.5 text-sm font-bold outline-none focus:border-indigo-500" placeholder="영문/숫자 조합" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">사용할 비밀번호</label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
                    <input required type="password" value={registerData.password} onChange={(e) => setRegisterData({...registerData, password: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-11 pr-4 py-3.5 text-sm font-bold outline-none focus:border-indigo-500" placeholder="••••••••" />
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full bg-slate-900 text-white py-4 mt-2 rounded-3xl font-black shadow-xl hover:bg-black transition-all flex items-center justify-center space-x-2"
                >
                  <UserPlus size={20} />
                  <span>계정 생성 완료</span>
                </button>
              </form>
            )}

            {view === 'find' && (
              <div className="space-y-6 animate-in slide-in-from-right-4">
                {foundInfo ? (
                  <div className="bg-indigo-50 border border-indigo-100 p-8 rounded-[32px] space-y-6 text-center">
                    <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center text-indigo-600 mx-auto shadow-sm">
                      <KeyRound size={32} />
                    </div>
                    <div>
                      <p className="text-xs font-black text-indigo-400 uppercase tracking-widest mb-1">찾으시는 계정 정보입니다</p>
                      <h3 className="text-2xl font-black text-slate-900">검색 완료</h3>
                    </div>
                    <div className="space-y-3 pt-4 border-t border-indigo-100">
                      <div className="flex justify-between items-center bg-white px-5 py-3.5 rounded-2xl border border-indigo-100">
                        <span className="text-[10px] font-black text-slate-400 uppercase">아이디</span>
                        <span className="text-sm font-black text-indigo-600">{foundInfo.username}</span>
                      </div>
                      <div className="flex justify-between items-center bg-white px-5 py-3.5 rounded-2xl border border-indigo-100">
                        <span className="text-[10px] font-black text-slate-400 uppercase">비밀번호</span>
                        <span className="text-sm font-black text-indigo-600">{foundInfo.password}</span>
                      </div>
                    </div>
                    <button 
                      onClick={() => { setView('login'); setFoundInfo(null); }}
                      className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-black shadow-lg hover:bg-indigo-700 transition-all"
                    >
                      로그인 하러가기
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleFindInfo} className="space-y-5">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">성함</label>
                      <div className="relative">
                        <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
                        <input 
                          required
                          type="text"
                          value={findData.name}
                          onChange={(e) => setFindData({...findData, name: e.target.value})}
                          placeholder="가입 시 등록한 이름"
                          className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-12 pr-4 py-4 text-sm font-bold outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">핸드폰 번호</label>
                      <div className="relative">
                        <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
                        <input 
                          required
                          type="text"
                          value={findData.phone}
                          onChange={(e) => setFindData({...findData, phone: formatPhone(e.target.value)})}
                          placeholder="01012345678"
                          inputMode="numeric"
                          className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-12 pr-4 py-4 text-sm font-bold outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all"
                        />
                      </div>
                    </div>
                    
                    <button 
                      type="submit"
                      className="w-full bg-slate-900 text-white py-5 rounded-3xl font-black shadow-xl hover:bg-black transition-all flex items-center justify-center space-x-3"
                    >
                      <Search size={20} />
                      <span>정보 찾기</span>
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        </div>
        
        <p className="text-center text-[10px] font-black text-slate-300 uppercase tracking-[0.4em] mt-8">
          © 2024 Taebaek Food Logistics Corp.
        </p>
      </div>
    </div>
  );
};

export default AuthPage;
