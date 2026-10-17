import React from 'react';
import { Menu, Bell } from 'lucide-react';
import type { Employee, ViewType } from '../../../shared/types';
import { accountProfileImageUrl } from '../../../../components/AccountMenu';
interface AppTopBarProps {
 currentView: ViewType; currentUser: Employee; hasUnreadNotifications: boolean; helpAvailable: boolean;
 onOpenMenu: () => void; onOpenHelp: () => void; onOpenNotifications: (event: React.MouseEvent<HTMLButtonElement>) => void;
}
export function AppTopBar({ currentView, currentUser, hasUnreadNotifications, helpAvailable, onOpenMenu, onOpenHelp, onOpenNotifications }: AppTopBarProps) {
 return (
        <header className="shrink-0 bg-white border-b border-slate-200 px-3 flex items-center gap-2" style={{ paddingTop: `max(0.75rem, env(safe-area-inset-top))`, paddingBottom: '0.75rem' }}>
          <button
            onClick={onOpenMenu}
            aria-label="메뉴 열기"
            className="xl:hidden p-2 rounded-lg hover:bg-slate-100 text-slate-600 shrink-0"
          >
            <Menu size={22} />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-black text-slate-800 truncate">
              {(({
                'dashboard': '비즈니스 현황', 'data-integrity': '데이터 점검', 'ai-consultant': 'AI 인사이트',
                'orders': '주문·배송', 'shipping': '주문·배송', 'inventory': '재고 관리', 'lot-management': '생산 관리',
                'pallets': '파렛트 관리', 'hr': '인사 관리', 'partners': '거래처 관리',
                'notice': '공지사항', 'documents': '서류 관리', 'trade-statement': '거래명세서', 'tax-statement': '세금계산서',
                'profit-analysis': '손익 / 비용 분석', 'cost-management': '비용 관리', 'partner-stats': '거래처통계', 'cash-flow': '현금흐름 분석', 'financial-reports': '재무제표 (복식부기)', 'loan-management': '대출 관리',
                'ledger-cash': '장부',
                'production': '생산 실적', 'admin-checklist': '확인사항',
                'leave-portal': '연차 신청', 'confirmation-items': '확인사항',
                'item-management': '품목 관리', 'item-price-management': '품목 관리', 'item-ledger': '제품별원장',
                'partner-portal': '거래처 포털',
                'officetalk': '오피스톡', 'smartstore-analytics': '스마트스토어 분석', 'mypage': '마이페이지',
                'haccp-checklist': 'HACCP 체크리스트', 'return-management': '반품 관리',
                'inbound-returns': '입고 / 반품', 'sanitation-checklist': '작업장 위생점검표',
              } as Record<string, string>)[currentView]) ?? ''}
            </p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <button type="button" aria-label="챗봇 열기" aria-keyshortcuts="Alt+/" title={helpAvailable?'챗봇 · Alt+/':'로그인 계정을 확인한 뒤 챗봇을 열 수 있습니다.'} disabled={!helpAvailable} onClick={onOpenHelp} className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50">챗봇</button>
            <button type="button" aria-label="알림" onClick={onOpenNotifications} className="relative flex h-11 w-11 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100">
              <Bell size={20} aria-hidden="true" />
              {hasUnreadNotifications && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-rose-500" />}
            </button>
            <div className="flex h-11 w-11 items-center justify-center" title={currentUser.name}>
              <img
                src={accountProfileImageUrl(currentUser.id)}
                alt={`${currentUser.name} 프로필`}
                className="h-8 w-8 rounded-full bg-slate-100 object-cover shadow-sm"
              />
            </div>
          </div>
        </header>
 );
}
