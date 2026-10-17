import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * 사이드바 묶음 — 제목을 누르면 접힌다. 접은 상태는 브라우저에 남긴다(다음에 열어도 그대로).
 *
 * 메뉴가 스무 개를 넘어 한 화면에 안 들어온다. 안 쓰는 묶음을 접어 두면
 * 매일 쓰는 것만 남는다. 사이드바 자체가 접혀 있으면(아이콘만) 여기선 아무것도 안 한다.
 */
export const NavGroup: React.FC<{ title: string; storageKey: string; collapsed?: boolean; children: React.ReactNode }> =
  ({ title, storageKey, collapsed, children }) => {
    const [open, setOpen] = useState(() => {
      try { return localStorage.getItem(`nav.${storageKey}`) !== 'closed'; } catch { return true; }
    });
    const toggle = () => {
      setOpen(v => {
        try { localStorage.setItem(`nav.${storageKey}`, v ? 'closed' : 'open'); } catch { /* 사생활 모드 등 — 접힘만 안 남는다 */ }
        return !v;
      });
    };
    if (collapsed) return <div>{children}</div>;
    return (
      <div>
        <button onClick={toggle}
          className="w-full flex items-center justify-between px-4 mb-3 text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-600 transition-colors">
          <span>{title}</span>
          <ChevronDown size={12} className={`transition-transform ${open ? '' : '-rotate-90'}`} />
        </button>
        {open && children}
      </div>
    );
  };

export const NavItem = ({ icon: Icon, label, active, onClick, collapsed, badge, hidden }: { icon: any, label: string, active: boolean, onClick: () => void, collapsed?: boolean, badge?: number, hidden?: boolean }) => (
  hidden ? null : (
  <button
    onClick={onClick}
    title={collapsed ? label : undefined}
    className={`w-full flex items-center ${collapsed ? 'justify-center' : 'space-x-3 px-4'} py-3 rounded-xl transition-all duration-200 ${
      active
        ? 'bg-indigo-600 text-white shadow-lg font-bold'
        : 'text-slate-500 hover:bg-slate-50'
    }`}
  >
    <div className="relative flex-shrink-0">
      <Icon size={18} />
      {badge != null && badge > 0 && (
        <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] bg-rose-500 text-white text-[8px] font-black rounded-full flex items-center justify-center px-0.5 leading-none">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </div>
    <span className={`text-sm whitespace-nowrap overflow-hidden transition-all duration-200 ${collapsed ? 'opacity-0 w-0' : 'opacity-100'}`}>{label}</span>
  </button>
  )
);
