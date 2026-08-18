// ============================================================
// App.tsx — 순수 라우터
// ============================================================

import React, { useEffect, useState } from 'react';
import { Employee, ViewType } from './types';
import { useAppData } from './src/hooks/useAppData';
import { useAdminData } from './src/hooks/useAdminData';
import { addItem, updateItem } from './src/services/firebaseService';
import { DEFAULT_COMPANY_INFO } from './src/config';
import AuthPage from './components/AuthPage';
import PartnerPortal from './components/PartnerPortal';
import AdminApp from './src/features/admin/AdminApp';
import StaffApp from './src/features/staff/StaffApp';
import ReloadPrompt from './components/ReloadPrompt';
import { blockNumberWheel } from './src/shared/blockNumberWheel';

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<Employee | null>(() => {
    const saved = localStorage.getItem('tb_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [currentView, setCurrentView] = useState<ViewType>(() => {
    const saved = localStorage.getItem('tb_user');
    const user = saved ? JSON.parse(saved) : null;
    return user?.id === 'admin' ? 'dashboard' : 'orders';
  });
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [previewAsStaff, setPreviewAsStaff] = useState(false);

  // 숫자 칸에 커서를 둔 채 스크롤하면 값이 바뀌던 것을 막는다(수량·금액 전부)
  useEffect(blockNumberWheel, []);

  const appData = useAppData();
  const isAdmin = currentUser?.id === 'admin' || isAdminAuthenticated;
  const adminData = useAdminData(isAdmin);

  const handleLogin = (user: Employee) => {
    setCurrentUser(user);
    localStorage.setItem('tb_user', JSON.stringify(user));
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('tb_user');
    setIsAdminAuthenticated(false);
  };

  const renderContent = () => {
    if (currentView === 'partner-portal') {
      return (
        <PartnerPortal
          partners={appData.partners}
          items={appData.items}
          onOrderSubmit={(o) => addItem('orders', o)}
          onExit={() => setCurrentView('orders')}
        />
      );
    }

    if (!currentUser) {
      return (
        <AuthPage
          onLogin={handleLogin}
          registeredEmployees={appData.employees}
          onRegister={(e) => updateItem('employees', e.id, { username: e.username, password: e.password })}
        />
      );
    }

    const sharedProps = {
      currentUser,
      isAdminAuthenticated,
      onAdminAuth: setIsAdminAuthenticated,
      currentView,
      setCurrentView,
      onLogout: handleLogout,
      appData: {
        ...appData,
        companyInfo: appData.companyInfo ?? DEFAULT_COMPANY_INFO,
      },
      adminData,
    };

    if (isAdmin && !previewAsStaff) {
      return <AdminApp {...sharedProps} isAdmin={true} onPreviewStaff={() => setPreviewAsStaff(true)} />;
    }

    return <StaffApp {...sharedProps} onExitPreview={previewAsStaff ? () => setPreviewAsStaff(false) : undefined} />;
  };

  return (
    <>
      {renderContent()}
      <ReloadPrompt />
    </>
  );
};

export default App;
