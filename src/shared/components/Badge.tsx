import React from 'react';

/**
 * 상태 배지 — 의미별 색상은 design-system/taebaekfood-erp/MASTER.md §1.2 를 따른다.
 * success=완료/정상, progress=대기/진행중, danger=위험/부족/반려, info=안내, neutral=취소/비활성
 */
export type BadgeVariant = 'success' | 'progress' | 'danger' | 'info' | 'neutral';

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  success: 'bg-emerald-50 text-emerald-700',
  progress: 'bg-amber-50 text-amber-700',
  danger: 'bg-rose-50 text-rose-700',
  info: 'bg-sky-50 text-sky-700',
  neutral: 'bg-slate-100 text-slate-500',
};

interface BadgeProps {
  variant: BadgeVariant;
  children: React.ReactNode;
  /**
   * 배치용 유틸리티만 추가한다(margin, width, justify-* 등).
   * 크기/모양(px-*, py-*, rounded-*, text-[Npx])을 여기로 덮어쓰지 말 것 —
   * 이미 아래 기본 클래스에 박혀 있어서, 같은 CSS 속성을 두 클래스가 다투게 되면
   * Tailwind가 생성한 스타일시트 순서에 따라 승자가 뒤바뀌는 버그가 난다
   * (design-token-migration 실패 사례와 동일한 원인 — 실패 원인 기록은 MASTER.md 참고).
   */
  className?: string;
}

const Badge: React.FC<BadgeProps> = ({ variant, children, className = '' }) => (
  <span
    className={`inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-black whitespace-nowrap ${VARIANT_CLASSES[variant]} ${className}`}
  >
    {children}
  </span>
);

export default Badge;
