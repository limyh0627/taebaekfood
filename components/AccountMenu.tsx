import React from 'react';
import { ChevronRight } from 'lucide-react';
import { Employee } from '../src/shared/types';

export const accountProfileImageUrl = (userId: string) => `https://picsum.photos/seed/${encodeURIComponent(userId)}/64/64`;

/**
 * 사이드바 계정 카드 — 누르면 **마이페이지로 간다**.
 *
 * 전에는 여기서 작은 창이 열렸다. 계정 줄이 사이드바 맨 위라 창이 화면 밖으로
 * 나갔고, 좁아서 글도 다 못 실었다(2026-09-04 사장님: "그냥 마이페이지 만들어서
 * 거기로 가서 하게 해"). 알림 설정·로그아웃은 전부 [MyPage.tsx](MyPage.tsx) 에 있다.
 */
const AccountMenu: React.FC<{
  currentUser: Employee;
  collapsed?: boolean;
  active?: boolean;
  onOpen: () => void;
}> = ({ currentUser, collapsed, active, onOpen }) => (
  <div className="mb-6">
    <button
      onClick={onOpen}
      title={currentUser.name}
      className={`w-full group ${collapsed ? 'flex justify-center' : ''}`}
    >
      {collapsed ? (
        <div className={`w-9 h-9 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold text-xs shadow-sm overflow-hidden transition-all ${
          active ? 'ring-2 ring-indigo-400' : 'group-hover:ring-2 group-hover:ring-indigo-300'}`}>
          <img src={accountProfileImageUrl(currentUser.id)} alt="" className="h-full w-full object-cover" />
        </div>
      ) : (
        <div className={`flex items-center space-x-3 rounded-2xl px-3 py-2.5 border transition-all ${
          active ? 'bg-indigo-50 border-indigo-200' : 'bg-slate-50 group-hover:bg-slate-100 border-slate-100'}`}>
          <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold text-xs shadow-sm overflow-hidden shrink-0">
            <img src={accountProfileImageUrl(currentUser.id)} alt="" className="h-full w-full object-cover" />
          </div>
          <div className="overflow-hidden flex-1 text-left">
            <p className={`text-xs font-bold truncate ${active ? 'text-indigo-700' : 'text-slate-700'}`}>{currentUser.name}</p>
            <p className="text-[9px] text-slate-400 font-medium uppercase tracking-tighter truncate">
              {currentUser.department} · {currentUser.position}
            </p>
          </div>
          <ChevronRight size={13} className={`shrink-0 ${active ? 'text-indigo-400' : 'text-slate-300'}`} />
        </div>
      )}
    </button>
  </div>
);

export default AccountMenu;
