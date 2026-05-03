import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Employee, ViewType } from '../../src/shared/types';
import { useAppData } from '../../src/shared/hooks/useAppData';
import { useAdminData } from '../../src/hooks/useAdminData';
import { addItem, updateItem } from '../../src/shared/services/firebaseService';
import { DEFAULT_COMPANY_INFO } from '../../src/config';
import AuthPage from '../../src/shared/components/AuthPage';
import ClientPortal from '../../components/ClientPortal';
import StaffApp from '../../src/features/staff/StaffApp';
import '../../src/index.css';

const StaffRoot: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<Employee | null>(() => {
    const saved = localStorage.getItem('tb_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [currentView, setCurrentView] = useState<ViewType>('orders');
  const [isAdminAuthenticated] = useState(false);

  const appData = useAppData();
  const adminData = useAdminData(false);

  const handleLogin = (user: Employee) => {
    setCurrentUser(user);
    localStorage.setItem('tb_user', JSON.stringify(user));
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('tb_user');
    setCurrentView('orders');
  };

  if (currentView === 'client-portal') {
    return (
      <ClientPortal
        clients={appData.clients}
        products={[...appData.products, ...appData.submaterials]}
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

  return (
    <StaffApp
      currentUser={currentUser}
      isAdminAuthenticated={isAdminAuthenticated}
      onAdminAuth={() => {}}
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
    <StaffRoot />
  </React.StrictMode>
);
