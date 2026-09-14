/**
 * @shared-move  shared/components/ConfirmModal.tsx
 * 직원 앱·관리자 앱 모두 사용하는 공통 확인 다이얼로그 컴포넌트
 *
 * **틀은 `AlertModalShell` 한 벌이다**(2026-09-15 사장님: "알람양식은 저걸로 통일 색만
 * 바꿔쓰고"). 머리에는 `재고부족`·`작업완료`·`출고완료` 같은 **짧은 이름**만 서고,
 * 설명은 내용으로 내려간다.
 */
import React from 'react';
import { AlertTriangle, type LucideIcon } from 'lucide-react';
import AlertModalShell, { alertToneClass, type AlertTone } from './AlertModalShell';

interface ConfirmModalProps {
  /**
   * 머리에 설 짧은 이름. **안 주면 예전 모양**으로 — 머리에 `message` 가 선다.
   * 아직 안 고친 화면이 많아 한꺼번에 못 바꾼다.
   */
  title?: string;
  tone?: AlertTone;
  icon?: LucideIcon;
  message: string;
  subMessage?: string;
  /** 설명 아래에 붙일 것 — 표처럼 줄글로는 못 읽는 내용을 담는다. */
  body?: React.ReactNode;
  /** 누르면 안 되는 상황 — 까닭은 `footerNote` 로 단추 아래에 적는다. */
  confirmDisabled?: boolean;
  /** **단추 아래** 한 줄 — 왜 못 누르는지. 단추 위에 적으면 설명에 묻힌다. */
  footerNote?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  confirmOnly?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({
  title,
  tone = 'rose',
  icon = AlertTriangle,
  message,
  subMessage,
  body,
  confirmDisabled = false,
  footerNote,
  confirmText = '삭제',
  cancelText = '취소',
  confirmOnly = false,
  onConfirm,
  onCancel,
}) => {
  const 색 = alertToneClass(tone);
  return (
    <AlertModalShell title={title ?? message} tone={tone} icon={icon} onClose={onCancel}
      footer={<>
        <div className="flex gap-2">
          {!confirmOnly && (
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 rounded-xl bg-slate-100 py-2.5 text-sm font-bold text-slate-600 transition-all hover:bg-slate-200"
            >
              {cancelText}
            </button>
          )}
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
            className={`flex-1 rounded-xl py-2.5 text-sm font-black text-white transition-all disabled:cursor-not-allowed disabled:bg-slate-300 ${색.단추}`}
          >
            {confirmText}
          </button>
        </div>
        {footerNote}
      </>}
    >
      {/*  제목을 따로 준 창에서는 `message` 가 **설명의 첫 줄**이다 — 머리에 또 쓰지 않는다.
           제목을 안 준 옛 창은 머리에 `message` 가 섰으므로 여기서는 건너뛴다. */}
      {title && <p className="text-sm font-bold leading-snug text-slate-800">{message}</p>}
      {subMessage && (
        <p className={`whitespace-pre-line text-xs font-medium leading-5 text-slate-500 ${title ? 'mt-1.5' : ''}`}>{subMessage}</p>
      )}
      {body}
    </AlertModalShell>
  );
};

export default ConfirmModal;
