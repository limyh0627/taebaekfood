import React, { useState, useEffect, Component, ErrorInfo, ReactNode } from 'react';

// 청크 로드 실패(배포 후 구버전 캐시) 시 자동 새로고침
window.addEventListener('vite:preloadError', () => { window.location.reload(); });
window.__chunkErrorHandled = false;
window.addEventListener('unhandledrejection', (e) => {
  if (!window.__chunkErrorHandled && e.reason?.message?.includes('dynamically imported module')) {
    window.__chunkErrorHandled = true;
    window.location.reload();
  }
});
import ReactDOM from 'react-dom/client';
import { Employee, ViewType } from '../../src/shared/types';
import { useAppData } from '../../src/shared/hooks/useAppData';
import { useAdminData } from '../../src/hooks/useAdminData';
import { updateItem } from '../../src/shared/services/firebaseService';
import { DEFAULT_COMPANY_INFO } from '../../src/config';
import AuthPage from '../../src/shared/components/AuthPage';
import AdminApp from '../../src/features/admin/AdminApp';
import { takeShareFromUrl } from '../../src/shared/shareTarget';
import { canEnterAdmin, freshAccess } from '../../src/shared/adminAccess';
import '../../src/index.css';
import { loadStartView, saveView } from '../../src/shared/startView';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('App crashed:', error, info); }
  render() {
    if (this.state.error) {
      const msg = (this.state.error as Error).message;
      return (
        <div style={{ padding: 32, fontFamily: 'monospace', background: '#fff1f2', minHeight: '100vh' }}>
          <h2 style={{ color: '#e11d48' }}>앱 오류</h2>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#374151', fontSize: 13 }}>{msg}</pre>
          <p style={{ color: '#6b7280', fontSize: 12 }}>위 오류 내용을 캡처해서 전달해주세요.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

const AdminRoot: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<Employee | null>(() => {
    const saved = localStorage.getItem('tb_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [currentView, setCurrentView] = useState<ViewType>(() => {
    //  카톡·문자에서 공유해 들어왔으면 오피스톡부터 연다(2026-09-03 사장님).
    //  주소는 여기서 바로 비운다 — 새로고침에 같은 글이 또 뜨면 안 된다.
    if (takeShareFromUrl()) return 'officetalk';
    return loadStartView<ViewType>('tb_admin_view', 'dashboard');
  });
  useEffect(() => { saveView('tb_admin_view', currentView); }, [currentView]);
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [previewAsStaff, setPreviewAsStaff] = useState(false);

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

  //  들어갈 수 있는지는 직원 기록의 `adminAccess` 칸이 정한다(canEnterAdmin).
  //  localStorage 에 박힌 사본은 낡으니, 지금 목록의 권한으로 덮어 본다.
  const 접근가능 = canEnterAdmin(freshAccess(currentUser, appData.employees));

  if (!접근가능 && !isAdminAuthenticated) {
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
          <button onClick={handleLogout} className="w-full py-3 rounded-2xl bg-rose-500 text-white font-bold hover:bg-rose-600 transition-all">
            로그아웃
          </button>
        </div>
      </div>
    );
  }

  return (
    <AdminApp
      currentUser={currentUser}
      isAdmin={!previewAsStaff}
      isAdminAuthenticated={isAdminAuthenticated}
      onAdminAuth={setIsAdminAuthenticated}
      currentView={currentView}
      setCurrentView={setCurrentView}
      onLogout={handleLogout}
      appData={{ ...appData, companyInfo: appData.companyInfo ?? DEFAULT_COMPANY_INFO }}
      adminData={adminData}
      onPreviewStaff={!previewAsStaff ? () => setPreviewAsStaff(true) : undefined}
      onExitPreview={previewAsStaff ? () => setPreviewAsStaff(false) : undefined}
    />
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AdminRoot />
    </ErrorBoundary>
  </React.StrictMode>
);
