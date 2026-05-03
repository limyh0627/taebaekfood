import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Employee, ViewType } from '../../src/shared/types';
import { useAppData } from '../../src/shared/hooks/useAppData';
import { useAdminData } from '../../src/hooks/useAdminData';
import { updateItem } from '../../src/shared/services/firebaseService';
import { DEFAULT_COMPANY_INFO } from '../../src/config';
import AuthPage from '../../src/shared/components/AuthPage';
import AdminApp from '../../src/features/admin/AdminApp';
import '../../src/index.css';

const AdminRoot: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<Employee | null>(() => {
    const saved = localStorage.getItem('tb_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [currentView, setCurrentView] = useState<ViewType>('dashboard');
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);

  const appData = useAppData();
  const adminData = useAdminData(true);

  const handleLogin = (user: Employee) => {
    setCurrentUser(user);
    localStorage.setItem('tb_user', JSON.stringify(user));
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('tb_user');
    setIsAdminAuthenticated(false);
    setCurrentView('dashboard');
  };

  if (!currentUser) {
    return (
      <AuthPage
        onLogin={handleLogin}
        registeredEmployees={appData.employees}
        onRegister={(e) => updateItem('employees', e.id, { username: e.username, password: e.password })}
      />
    );
  }

  // 관리자가 아닌 계정으로 접근 시 차단
  if (currentUser.id !== 'admin' && !isAdminAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-3xl shadow-xl border border-slate-100 p-10 max-w-sm w-full text-center space-y-4">
          <div className="w-14 h-14 bg-rose-100 rounded-2xl flex items-center justify-center mx-auto">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#e11d48" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
          <h2 className="text-lg font-black text-slate-800">관리자 전용 페이지</h2>
          <p className="text-sm text-slate-500">이 페이지는 관리자 계정만 접근할 수 있습니다.<br/>현장 직원은 현장 앱을 이용해 주세요.</p>
          <button
            onClick={handleLogout}
            className="w-full py-3 rounded-2xl bg-rose-500 text-white font-bold hover:bg-rose-600 transition-all"
          >
            로그아웃
          </button>
        </div>
      </div>
    );
  }

  return (
    <AdminApp
      currentUser={currentUser}
      isAdmin={true}
      isAdminAuthenticated={isAdminAuthenticated}
      onAdminAuth={setIsAdminAuthenticated}
      currentView={currentView}
      setCurrentView={setCurrentView}
      onLogout={handleLogout}
      appData={{ ...appData, companyInfo: appData.companyInfo ?? DEFAULT_COMPANY_INFO }}
      adminData={adminData}
    />
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AdminRoot />
  </React.StrictMode>
);
