import { useEmployeeAuthSession } from '../../src/shared/hooks/useEmployeeAuthSession';
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
import { CompanyId, Employee, ViewType } from '../../src/shared/types';
import { useAppData } from '../../src/shared/hooks/useAppData';
import { useAdminData } from '../../src/hooks/useAdminData';
import { addItem } from '../../src/shared/services/firebaseService';
import { DEFAULT_COMPANY_INFO } from '../../src/config';
import AuthPage from '../../src/shared/components/AuthPage';
import PartnerPortal from '../../components/PartnerPortal';
import StaffApp from '../../src/features/staff/StaffApp';
import '../../src/index.css';
import { loadStartView, saveView } from '../../src/shared/startView';
import { 새버전확인붙이기 } from '../../src/shared/swUpdate';
import { blockNumberWheel } from '../../src/shared/blockNumberWheel';
import LocalTestBanner from '../../src/shared/components/LocalTestBanner';
import AppAlertHost from '../../src/shared/components/AppAlertHost';
import AppDialogHost from '../../src/shared/components/AppDialogHost';
import SessionLogoutState from '../../src/shared/components/SessionLogoutState';
import { employeeRuntime } from '../../src/shared/employeeSession';

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

const StaffSessionRoot: React.FC<{currentUser:Employee;onSessionLogout:()=>Promise<void>}> = ({currentUser,onSessionLogout}) => {
  //  숫자 칸 위에서 휠을 굴리면 값이 조용히 바뀐다 — 브라우저 기본 동작이다.
  //  수량·금액 칸이 51개인데 막은 데가 한 곳도 없었다(2026-09-07). 여기 한 번만 건다.
  useEffect(blockNumberWheel, []);

  //  회사는 로그인 직원의 소속(`companyId`)으로 잠근다 — 화면에서 갈아탈 수 없다.
  const companyId: CompanyId = currentUser?.companyId ?? 'taebaek';
  const [currentView, setCurrentView] = useState<ViewType>(() =>
    loadStartView<ViewType>('tb_staff_view', 'orders'));
  useEffect(() => { saveView('tb_staff_view', currentView); }, [currentView]);
  const [isAdminAuthenticated] = useState(false);

  //  배포한 게 폰에 안 오던 것 — 앱이 앞으로 나올 때 새 버전을 물어본다.
  useEffect(새버전확인붙이기, []);

  //  **직원 앱은 관리자 구독을 아예 안 건다**(2026-09-16 코덱스 검수 6번) —
  //  전표·자금·재무·문서함은 규칙이 관리자 전용으로 잠근다. `useAdminData(false, …)` 와 같은 태도다.
  const appData = useAppData(currentUser !== null, companyId, false);
  const adminData = useAdminData(false, companyId);



  if (currentUser && currentView === 'partner-portal') {
    return (
      <PartnerPortal
        partners={appData.partners}
        items={appData.items}
        partnerItems={appData.partnerItems}
        onOrderSubmit={(o) => addItem('orders', o)}
        onExit={() => setCurrentView('orders')}
      />
    );
  }

  const runtimeUser = employeeRuntime(appData.employees.find(employee => employee.id === currentUser.id) ?? currentUser);

  return (
    <StaffApp
      currentUser={runtimeUser}
      companyId={companyId}
      isAdminAuthenticated={isAdminAuthenticated}
      onAdminAuth={() => {}}
      currentView={currentView}
      setCurrentView={setCurrentView}
      onLogout={onSessionLogout}
      appData={{ ...appData, companyInfo: appData.companyInfo ?? DEFAULT_COMPANY_INFO }}
      adminData={adminData}
    />
  );
};

const StaffRoot: React.FC = () => {
 const session=useEmployeeAuthSession();
 if(session.logoutState!=='idle')return <SessionLogoutState state={session.logoutState} error={session.logoutError} onRetry={session.retryLogout}/>;
 if(!session.authChecked)return <div className="min-h-screen bg-slate-50"/>;
 if(!session.currentUser)return <AuthPage app="staff" onLogin={session.onLogin}/>;
 return <StaffSessionRoot key={session.sessionKey} currentUser={session.currentUser} onSessionLogout={session.logout}/>;
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <StaffRoot />
    </ErrorBoundary>
    <AppAlertHost />
    <AppDialogHost />
    <LocalTestBanner />
  </React.StrictMode>
);
