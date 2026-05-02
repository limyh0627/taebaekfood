// ============================================================
// [STAFF APP 경계 — 미래 분리 안내]
//
// 이 컴포넌트는 일반 직원 전용 ERP 앱을 렌더링합니다.
// 추후 독립 앱으로 물리 분리 시 다음 단계를 따르세요:
//
//   1. AdminApp.tsx 를 새 프로젝트의 App.tsx 로 복사하되
//      isAdmin 을 항상 false 로 고정
//   2. src/shared/ 폴더 전체를 함께 복사
//   3. Firebase 설정(.env)과 src/shared/firebase.ts 교체
//   4. src/features/staff/ 파일만 유지, admin/ 제거
//   5. 빌드 후 별도 Firebase 프로젝트에 배포 (읽기 전용 규칙 권장)
//
// 현재: AdminApp 에 isAdmin=false 를 주입하여 관리자 메뉴·뷰를 숨깁니다.
// ============================================================

import React from 'react';
import AdminApp from '../admin/AdminApp';
import type { AppData } from '../../shared/hooks/useAppData';
import type { AdminData } from '../../hooks/useAdminData';
import type { Employee, ViewType } from '../../shared/types';

interface StaffAppProps {
  currentUser: Employee;
  isAdminAuthenticated: boolean;
  onAdminAuth: (v: boolean) => void;
  currentView: ViewType;
  setCurrentView: (view: ViewType) => void;
  onLogout: () => void;
  appData: AppData;
  adminData: AdminData;
}

const StaffApp: React.FC<StaffAppProps> = (props) => (
  <AdminApp
    {...props}
    isAdmin={false}
  />
);

export default StaffApp;
