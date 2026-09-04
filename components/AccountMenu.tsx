import React, { useState, useEffect, useRef } from 'react';
import { LogOut, Bell, BellOff, ChevronRight, Check } from 'lucide-react';
import { Employee } from '../src/shared/types';
import {
  notify, notifySupported, notifyPermission, askNotifyPermission,
  loadNotifyMode, saveNotifyMode, NotifyMode,
} from '../src/shared/notify';

/**
 * 계정 메뉴 — 사이드바 아래 계정 카드를 누르면 열린다.
 *
 * **알림 권한을 묻는 자리는 앱 전체에서 여기 하나다**(2026-09-03 사장님:
 * "권한 허가를 한군데에서 받아야 하는거 아니야? 굳이 흩어둘 필요가있나").
 * 전에는 오피스톡 설정과 알림 종 패널 두 곳에 흩어져 있었다.
 *
 * 브라우저 권한은 **한 번 허용하면 계속 남는다**(사이트 데이터를 지우거나 직접
 * 차단할 때까지). 전에 들어올 때마다 다시 묻던 건, 화면을 열자마자 자동으로 물어서
 * 팝업을 그냥 닫으면 'default' 로 남았기 때문이다. 이제 이 버튼을 눌러야만 묻는다.
 */
const AccountMenu: React.FC<{
  currentUser: Employee;
  collapsed?: boolean;
  onLogout: () => void;
}> = ({ currentUser, collapsed, onLogout }) => {
  const [open, setOpen] = useState(false);
  const [perm, setPerm] = useState<NotificationPermission>(notifyPermission);
  const [mode, setMode] = useState<NotifyMode>(loadNotifyMode);
  const boxRef = useRef<HTMLDivElement>(null);

  //  다른 탭이나 브라우저 설정에서 권한이 바뀌었을 수 있다 — 메뉴를 열 때 다시 읽는다
  useEffect(() => { if (open) setPerm(notifyPermission()); }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const pickMode = (m: NotifyMode) => { setMode(m); saveNotifyMode(m); };

  const 켜기 = async () => {
    const r = await askNotifyPermission();
    setPerm(r);
    if (r === 'granted') notify({ title: '🔔 알림이 켜졌습니다', body: '새 주문과 오피스톡 메시지를 알려드립니다.', whenFocused: true, mode: 'sound' });
  };

  return (
    <div className="relative mb-6" ref={boxRef}>
      <button
        onClick={() => setOpen(v => !v)}
        title={currentUser.name}
        className={`w-full group ${collapsed ? 'flex justify-center' : ''}`}
      >
        {collapsed ? (
          <div className="w-9 h-9 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold text-xs shadow-sm overflow-hidden group-hover:ring-2 group-hover:ring-indigo-300 transition-all">
            <img src={`https://picsum.photos/seed/${currentUser.id}/36/36`} alt="" />
          </div>
        ) : (
          <div className="flex items-center space-x-3 bg-slate-50 group-hover:bg-slate-100 rounded-2xl px-3 py-2.5 border border-slate-100 transition-all">
            <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold text-xs shadow-sm overflow-hidden shrink-0">
              <img src={`https://picsum.photos/seed/${currentUser.id}/32/32`} alt="" />
            </div>
            <div className="overflow-hidden flex-1 text-left">
              <p className="text-xs font-bold text-slate-700 truncate">{currentUser.name}</p>
              <p className="text-[9px] text-slate-400 font-medium uppercase tracking-tighter truncate">
                {currentUser.department} · {currentUser.position}
              </p>
            </div>
            <ChevronRight size={13} className={`text-slate-300 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
          </div>
        )}
      </button>

      {open && (
        <div className={`absolute z-50 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden ${
          collapsed ? 'left-full ml-2 bottom-0 w-64' : 'left-0 right-0 bottom-full mb-2'
        }`}>
          {/* ── 알림 ── */}
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">알림</p>

            {!notifySupported() ? (
              <p className="text-[10px] font-bold text-slate-400">이 브라우저는 알림을 못 씁니다.</p>
            ) : perm === 'granted' ? (
              <>
                <p className="flex items-center gap-1.5 text-[11px] font-black text-emerald-600 mb-2">
                  <Bell size={12} /> 켜짐 — 새 주문·오피스톡
                </p>
                <div className="flex gap-1">
                  {([
                    { value: 'sound',     label: '🔊 소리' },
                    { value: 'vibration', label: '📳 진동' },
                    { value: 'both',      label: '둘 다' },
                  ] as const).map(({ value, label }) => (
                    <button
                      key={value}
                      onClick={() => pickMode(value)}
                      className={`flex-1 py-1.5 rounded-lg text-[10px] font-black border transition-all ${
                        mode === value
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-300'
                      }`}
                    >
                      {mode === value && <Check size={9} className="inline mr-0.5" />}{label}
                    </button>
                  ))}
                </div>
              </>
            ) : perm === 'denied' ? (
              <p className="flex items-start gap-1.5 text-[10px] font-bold text-amber-700 leading-relaxed">
                <BellOff size={12} className="shrink-0 mt-0.5" />
                차단돼 있습니다. 주소창 왼쪽 자물쇠 → <b>사이트 설정 → 알림</b> 에서 허용해 주세요.
              </p>
            ) : (
              <button
                onClick={켜기}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-[11px] font-black hover:bg-amber-100 transition-all"
              >
                <Bell size={13} /> 폰 알림 켜기
              </button>
            )}
            <p className="text-[9px] font-medium text-slate-300 mt-2 leading-relaxed">
              한 번 켜면 계속 유지됩니다. 앱이 꺼져 있을 때는 알림이 안 갑니다.
            </p>
          </div>

          {/* ── 로그아웃 ── */}
          <button
            onClick={() => { setOpen(false); if (window.confirm(`${currentUser.name}님, 로그아웃 하시겠습니까?`)) onLogout(); }}
            className="w-full flex items-center gap-2 px-4 py-3 text-left text-[11px] font-black text-rose-600 hover:bg-rose-50 transition-all"
          >
            <LogOut size={13} /> 로그아웃
          </button>
        </div>
      )}
    </div>
  );
};

export default AccountMenu;
