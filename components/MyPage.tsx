import React, { useState, useEffect } from 'react';
import { LogOut, Bell, BellOff, Check, User, Shield, Smartphone } from 'lucide-react';
import { Employee } from '../src/shared/types';
import {
  notify, notifySupported, notifyPermission, askNotifyPermission, notifyDiagnose,
  loadNotifyMode, saveNotifyMode, NotifyMode,
} from '../src/shared/notify';
import { canEnterAdmin } from '../src/shared/adminAccess';

/**
 * 마이페이지 — 내 계정과 알림 설정.
 *
 * 전에는 사이드바 계정 카드를 누르면 뜨는 작은 창이었다. 계정 줄이 사이드바 맨 위라
 * 창이 화면 밖으로 나갔고, 좁아서 글도 다 못 실었다(2026-09-04 사장님:
 * "그냥 마이페이지 만들어서 거기로 가서 하게 해").
 *
 * **알림 권한을 묻는 자리는 앱 전체에서 여기 하나다.** 전에 오피스톡 설정과
 * 알림 종 패널 두 곳에 흩어져 있던 걸 모은 것이고, 그 규칙은 그대로다.
 *
 * 브라우저 권한은 **한 번 허용하면 계속 남는다**(사이트 데이터를 지우거나 직접
 * 차단할 때까지). 그러니 열자마자 자동으로 묻지 않는다 — 팝업을 그냥 닫으면
 * 'default' 로 남아 들어올 때마다 다시 뜬다.
 */
const MyPage: React.FC<{
  currentUser: Employee;
  onLogout: () => void;
}> = ({ currentUser, onLogout }) => {
  const [perm, setPerm] = useState<NotificationPermission>(notifyPermission);
  const [시험, set시험] = useState<{ ok: boolean; msg: string } | null>(null);
  const [mode, setMode] = useState<NotifyMode>(loadNotifyMode);

  //  다른 탭이나 브라우저 설정에서 권한이 바뀌었을 수 있다 — 돌아올 때 다시 읽는다
  useEffect(() => {
    const 다시읽기 = () => setPerm(notifyPermission());
    window.addEventListener('focus', 다시읽기);
    return () => window.removeEventListener('focus', 다시읽기);
  }, []);

  const pickMode = (m: NotifyMode) => { setMode(m); saveNotifyMode(m); };

  const 켜기 = async () => {
    const r = await askNotifyPermission();
    setPerm(r);
    set시험(null);
    if (r === 'granted') {
      notify({ title: '🔔 알림이 켜졌습니다', body: '새 주문과 오피스톡 메시지를 알려드립니다.', whenFocused: true, mode: 'sound' });
    }
  };

  const 관리자 = canEnterAdmin(currentUser);

  return (
    <div className="max-w-2xl mx-auto space-y-4">

      {/* ── 나 ── */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-indigo-600 overflow-hidden shrink-0">
            <img src={`https://picsum.photos/seed/${currentUser.id}/64/64`} alt="" className="w-full h-full object-cover" />
          </div>
          <div className="min-w-0">
            <p className="text-lg font-black text-slate-900 truncate">{currentUser.name}</p>
            <p className="text-xs font-bold text-slate-400 truncate">
              {currentUser.department} · {currentUser.position}
            </p>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-slate-100 space-y-2">
          <div className="flex items-center gap-2 text-[11px] font-bold text-slate-500">
            <User size={13} className="text-slate-300 shrink-0" />
            <span className="text-slate-400 w-16 shrink-0">계정</span>
            <span className="text-slate-700 truncate">{(currentUser as any).username || '—'}</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-bold text-slate-500">
            <Shield size={13} className="text-slate-300 shrink-0" />
            <span className="text-slate-400 w-16 shrink-0">권한</span>
            <span className={관리자 ? 'text-indigo-600' : 'text-slate-700'}>
              {관리자 ? '관리자 앱 사용' : '직원'}
            </span>
          </div>
        </div>
      </div>

      {/* ── 알림 ── */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">알림</p>

        {!notifySupported() ? (
          <p className="text-xs font-bold text-slate-400">이 브라우저는 알림을 못 씁니다.</p>
        ) : perm === 'granted' ? (
          <>
            <p className="flex items-center gap-1.5 text-xs font-black text-emerald-600 mb-3">
              <Bell size={14} /> 켜짐 — 새 주문 · 오피스톡 메시지
            </p>

            <p className="text-[10px] font-black text-slate-400 mb-1.5">울리는 방법</p>
            <div className="flex gap-1.5">
              {([
                { value: 'sound',     label: '🔊 소리' },
                { value: 'vibration', label: '📳 진동' },
                { value: 'both',      label: '둘 다' },
              ] as const).map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => pickMode(value)}
                  className={`flex-1 py-2.5 rounded-xl text-xs font-black border transition-all ${
                    mode === value
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-300'
                  }`}
                >
                  {mode === value && <Check size={11} className="inline mr-0.5" />}{label}
                </button>
              ))}
            </div>

            <button
              onClick={async () => set시험(await notifyDiagnose())}
              className="mt-3 w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-200 text-slate-500 text-xs font-black hover:bg-slate-50 transition-all"
            >
              <Bell size={13} /> 알림 시험해 보기
            </button>
          </>
        ) : perm === 'denied' ? (
          <p className="flex items-start gap-2 text-xs font-bold text-amber-700 leading-relaxed bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
            <BellOff size={14} className="shrink-0 mt-0.5" />
            <span>차단돼 있습니다. 주소창 왼쪽 자물쇠 → <b>사이트 설정 → 알림</b> 에서 허용해 주세요.</span>
          </p>
        ) : (
          <button
            onClick={켜기}
            className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-xs font-black hover:bg-amber-100 transition-all"
          >
            <Bell size={14} /> 폰 알림 켜기
          </button>
        )}

        {시험 && (
          <p className={`text-xs font-bold mt-3 leading-relaxed ${시험.ok ? 'text-emerald-600' : 'text-rose-600'}`}>
            {시험.ok ? '✅ ' : '⚠ '}{시험.msg}
          </p>
        )}

        {/*  언제 오고 언제 안 오는지 — 안 온다는 신고의 절반이 여기서 갈린다 */}
        <div className="mt-4 pt-4 border-t border-slate-100 space-y-1.5">
          <p className="flex items-start gap-2 text-[10px] font-bold text-slate-400 leading-relaxed">
            <Smartphone size={12} className="shrink-0 mt-0.5 text-slate-300" />
            <span>
              앱을 쓰는 중에도, <b className="text-slate-500">화면을 꺼도, 다른 앱을 봐도</b> 옵니다.
              <b className="text-slate-500"> 앱을 완전히 닫으면</b>(최근앱에서 밀어서 닫기) 안 옵니다.
            </span>
          </p>
          <p className="text-[10px] font-medium text-slate-300 leading-relaxed pl-5">
            새 주문 알림은 <b>내가 넣은 주문에는 안 옵니다</b> — 내가 넣고 내가 알림받을 일은 없으니까요.
            시험은 위 <b>알림 시험해 보기</b>로 하세요.
          </p>
          <p className="text-[10px] font-medium text-slate-300 leading-relaxed pl-5">
            폰이 배터리를 아끼려고 뒤에 있는 앱을 정리하면 끊깁니다 —
            <b> 설정 → 배터리 → 절전 예외</b>에 넣어 두면 덜합니다.
          </p>
        </div>
      </div>

      {/* ── 로그아웃 ── */}
      <button
        onClick={() => { if (window.confirm(`${currentUser.name}님, 로그아웃 하시겠습니까?`)) onLogout(); }}
        className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-2xl bg-white border border-rose-200 text-rose-600 text-xs font-black hover:bg-rose-50 transition-all"
      >
        <LogOut size={14} /> 로그아웃
      </button>
    </div>
  );
};

export default MyPage;
