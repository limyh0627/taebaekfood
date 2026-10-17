export interface HelpFeature {
  id: string;
  title: string;
  steps: string[];
  note?: string;
  recovery?: string;
}
export interface HelpMenuGuide { menuTitle: string; features: HelpFeature[] }
type Mode = 'admin' | 'staff';
const feature = (id: string, title: string, steps: string[], note?: string, recovery?: string): HelpFeature =>
  ({ id, title, steps, ...(note ? { note } : {}), ...(recovery ? { recovery } : {}) });
const guide = (menuTitle: string, ...features: HelpFeature[]): HelpMenuGuide => ({ menuTitle, features });

// AdminApp의 menuEntries/화면 분기와 OrdersList, AddOrderModal, PasteOrderModal의 실제 진입을 대조했다.
const orders = guide('주문·배송',
  feature('order-find', '주문 찾기', ['주문·배송에서 보고 싶은 목록·보드·달력 화면을 고릅니다.', '검색과 표시 조건으로 거래처·품목을 좁힙니다.', '해당 주문을 열어 품목·수량·배송 정보를 확인합니다.']),
  feature('order-create', '주문 직접 작성', ['목록 또는 보드에서 주문 생성을 누릅니다.', '주문 생성 방법에서 직접 선택을 누릅니다.', '거래처와 품목·수량·배송 정보를 확인한 뒤 저장합니다.'], '재고 만들기는 판매 주문 없이 추가 생산할 때 선택하는 별도 작성 방식입니다.'),
  feature('order-paste', '주문 내역 붙여넣기', ['주문 생성에서 주문 내역 붙여넣기를 누릅니다.', '받은 주문 내용을 붙여넣고 판독된 거래처·품목·수량을 확인합니다.', '틀리거나 확인되지 않은 항목을 보완한 뒤 저장합니다.'], 'AI 판독값이 실제 주문 내용을 대신 확정하지 않습니다.', '결과가 불분명하면 복사주문 실패 작업에서 해당 요청을 확인합니다. 같은 내용을 새 주문으로 다시 만들기 전에 기존 결과를 확인합니다.'),
  feature('order-edit', '주문 내용 확인·수정', ['목록의 수정 또는 해당 주문 상세를 엽니다.', '바꿀 항목과 기존 처리 상태를 확인합니다.', '화면이 허용하는 변경만 저장하고 완료 안내를 확인합니다.'], '이미 처리된 재고·원료 상태에 따라 수정이 제한될 수 있습니다.'),
);
// ItemList의 inventory/lots mode, ItemManager의 품목/거래처 연결 화면. 직원에게 관리자 재고조정 절차는 안내하지 않는다.
const inventory = guide('재고 관리',
  feature('inventory-find', '품목별 현재고 확인', ['재고 관리에서 품목명·거래처로 검색합니다.', '필요한 분류와 품목을 선택합니다.', '현재고와 화면의 단위·확인 안내를 함께 읽습니다.'], '표시된 수량만으로 실물 수량이나 과거 재고를 확정하지 않습니다.'),
  feature('inventory-history', '로트 이력 확인', ['로트 이력을 선택합니다.', '품목과 기간 등 표시 조건을 고릅니다.', '입고·출고·취소 근거를 확인합니다.']),
);
const lots = guide('생산 관리',
  feature('lots-find', '생산·로트 현황 확인', ['생산 관리에서 품목명·거래처를 검색합니다.', '확인할 품목과 로트 정보를 펼칩니다.', '현재 수량과 처리 상태를 확인합니다.'], '실제 생산·사용 근거가 없는 수량을 도움말에서 추정하지 않습니다.'),
);
const items = guide('품목 관리',
  feature('item-find', '거래처별 품목·단가 확인', ['거래처를 선택하거나 전체 품목을 조회합니다.', '매출 품목 또는 매입 품목을 선택합니다.', '품목명·규격과 연결된 단가를 확인합니다.']),
);
// NoticeBoard는 AdminApp에서 관리자에게만 작성/수정/삭제 callback을 제공한다.
const notice = guide('공지사항', feature('notice-read', '공지 읽기', ['공지 검색으로 필요한 글을 찾습니다.', '글을 선택해 본문과 첨부 내용을 확인합니다.']));
// OfficeTalk: 채팅방 선택/메시지 입력/공유 연결. 관리자의 타인 메시지 조작은 공통 기능으로 안내하지 않는다.
const talk = guide('오피스톡',
  feature('talk-message', '대화방에서 메시지 보내기', ['대화방을 선택합니다.', '메시지를 입력하고 전송합니다.', '해당 대화방에 전송된 내용을 확인합니다.']),
  feature('talk-share', '공유 받은 내용 연결', ['연결할 대화방을 먼저 선택합니다.', '공유 내용 연결 또는 공유 파일 연결을 누릅니다.', '표시된 내용과 전송 결과를 확인합니다.'], '공유 자료는 선택한 대화방과 현재 계정을 확인한 뒤 직접 연결합니다.', '실패 요청 삭제는 실패 목록 정리이며 실제 대화 내용을 삭제하는 기능이 아닙니다. 미확인 원문은 보존합니다.'),
);
// MyPage/메뉴 설정의 실제 버튼. 브라우저 저장과 권한을 구분한다.
const mypage = guide('마이페이지',
  feature('menu-preferences', '내 메뉴 숨김·순서·그룹 변경', ['이 브라우저의 내 메뉴에서 메뉴 설정 열기를 누릅니다.', '표시 체크로 숨김을 바꾸고 위로·아래로 또는 그룹 선택으로 위치를 바꿉니다.', '기본 상태로 돌아가려면 내 메뉴 초기화를 누릅니다.'], '회사·사용자·관리자/직원 화면별로 이 브라우저에만 저장됩니다. 메뉴 숨김은 권한 변경이 아닙니다.'),
  feature('notification-settings', '알림 설정과 로그아웃', ['알림 권한과 알림 방식을 확인합니다.', '필요한 설정을 직접 선택합니다.', '계정을 종료하려면 로그아웃을 누르고 확인합니다.'], '브라우저가 알림을 지원하지 않거나 권한을 차단했다면 안내를 확인합니다.'),
);
const shared: Record<string, HelpMenuGuide> = { orders, inventory, 'lot-management': lots, 'item-management': items, notice, officetalk: talk, mypage };

// 관리자 화면: AdminApp/각 컴포넌트의 실제 조회·작성 버튼을 근거로 삼는다.
const admin: Record<string, HelpMenuGuide> = {
  // Dashboard/AIConsultant: 조회와 내부 탭만 안내한다.
  dashboard: guide('대시보드', feature('dashboard-read', '경영 현황 보기', ['상단 비즈니스 현황을 선택합니다.', '대시보드의 요약 수치와 표시된 기준 날짜를 확인합니다.', '필요하면 AI 인사이트 탭을 선택합니다.'], '요약·분석은 실물 재고나 회계 확정 판단을 대신하지 않습니다.')),
  // DataIntegrityMonitor
  'data-integrity': guide('데이터 점검', feature('integrity-read', '저장 근거 대조 결과 확인', ['점검 시작일과 점검 종료일을 고릅니다.', '확인할 영역과 오류·확인 필요 목록을 선택합니다.', '주문번호·전표번호·내용 검색으로 항목을 찾습니다.'], '이 화면은 데이터를 변경하지 않습니다. 오류 수가 곧 실제 누락 금액을 뜻하지 않습니다.')),
  // AdminChecklist의 선입고/발주예정 callback은 실제 PO·명시 거래처를 전표 화면으로 전달한다.
  'admin-checklist': guide('확인사항',
    feature('checklist-purchase', '선입고·발주에서 매입전표 작성', ['선입고 또는 발주예정 목록에서 대상을 확인합니다.', '선입고의 매입전표 발행 또는 발주예정의 매입전표 작성을 누릅니다.', '열린 전표 화면에서 거래처·품목·수량·단가를 확인한 뒤 발행합니다.'], '목록의 작성 버튼만 눌렀다고 발행이 완료된 것은 아닙니다.'),
    feature('checklist-review', '확인할 업무 찾기', ['확인사항의 업무별 목록과 상태를 확인합니다.', '대상 행의 원래 요청 내용을 읽습니다.', '필요한 근거를 확인한 뒤 화면에서 허용하는 처리를 선택합니다.']),
  ),
  // TradeStatement/VoucherComposer: 실패 복구는 저장 결과와 후속 결제를 분리하고 원문을 보존한다.
  'trade-statement': guide('전표',
    feature('voucher-create', '일반전표 종류 선택·작성', ['일반전표 작성창을 엽니다.', '매입·매출·대체·입금·출금·회사이체 중 목적에 맞는 갈래를 선택합니다.', '호환 양식 또는 직접 입력으로 거래처·계정·금액을 확인하고 저장합니다.'], '거래처나 양식을 선택해도 고른 종류를 유지합니다. 대체의 양변 내용을 다른 갈래로 바꿀 때는 확인창을 읽습니다.'),
    feature('statement-read', '발행 전표 확인', ['전표 목록의 날짜·거래처 조건을 확인합니다.', '해당 전표를 열어 품목·수량·금액과 발행 상태를 확인합니다.']),
    feature('statement-recovery', '전표 결과 미확인 확인·재시도', ['실패 작업 버튼을 누르고 해당 작업 상세를 엽니다.', '처리결과 확인을 눌러 서버 결과와 첫 저장 시도 내용을 확인합니다.', '화면이 허용하면 같은 첫 요청을 재시도하거나 확인된 결과를 정리합니다.'], '일반전표 작성창의 결과 미확인은 이전 전표 재시도로 같은 요청을 확인합니다. 정상 저장 중에는 기다립니다.', '발행 완료 뒤 사본 정리나 수금·지불 오류는 발행 실패와 다릅니다. 사본을 임의로 모두 지우거나 새 전표로 중복 발행하지 않습니다.'),
  ),
  // TaxStatement
  'tax-statement': guide('세금계산서',
    feature('tax-create', '세금계산서 작성·발행', ['작성 화면에서 거래처와 작성일을 확인합니다.', '품목·수량·단가와 과세·면세 구분을 확인합니다.', '선택한 전자·수기 방식과 발행 내용을 확인한 뒤 진행합니다.'], '세무상 발행 여부와 과세 판단은 실제 근거로 확인해야 합니다.'),
    feature('tax-history', '발행내역과 이전 발행 결과 확인', ['발행내역에서 대상 계산서를 확인합니다.', '이전 발행 결과 확인 안내가 있으면 해당 버튼으로 같은 시도의 결과를 확인합니다.'], undefined, '결과를 모르는 상태에서 새 계산서로 다시 발행하지 않습니다.'),
  ),
  // QuotationManager
  quotation: guide('견적서', feature('quote-create', '견적 작성·보기·인쇄', ['거래처와 품목·수량·단가를 입력합니다.', '내용을 확인하고 저장 또는 수정 저장을 누릅니다.', '목록의 보기 · 인쇄에서 저장된 견적을 확인합니다.'])),
  // PartnerManager는 현재 직원 menuEntries에 없다.
  partners: guide('거래처 관리',
    feature('partner-find', '거래처 조회·수정', ['거래처 구분과 검색으로 대상을 찾습니다.', '거래처 수정을 열어 정보를 확인합니다.', '바꿀 항목을 확인하고 저장합니다.']),
    feature('partner-shipping', '기본 배송방식 설정', ['거래처 수정을 엽니다.', '기본 배송방식에서 배송·화물·수령·택배를 선택합니다.', '내용을 확인하고 저장합니다.'], '개별 주문의 배송지 변경은 거래처의 기본 배송방식 변경과 별개입니다.'),
  ),
  // HRManager/RetirementBenefitPanel: 금액·법정 판단의 추정은 안내하지 않는다.
  hr: guide('인사 관리',
    feature('hr-find', '직원 정보·연차 확인', ['직원 목록에서 대상을 찾습니다.', '직원 정보와 연차 신청·사용 내역을 확인합니다.']),
    feature('hr-retirement', '직원별 퇴직금 장부 열기', ['대상 직원 행의 퇴직금을 누릅니다.', '기초 확인 여부와 설정·적립·정산 상태를 확인합니다.'], '법정액·세액·회계 귀속은 자료 없이 확정하지 않습니다. 결과 미확인 상태에서는 기존 요청 결과를 먼저 확인합니다.'),
  ),
  // DocumentManager
  'file-cabinet': guide('문서함', feature('document-find', '분류별 문서 찾기', ['분류와 하위 분류를 선택합니다.', '파일명·메모 검색으로 문서를 찾습니다.', '필요한 파일이나 연결된 서류 화면을 엽니다.'])),
  // AdminApp의 ledgerTab은 currentView에 포함되지 않으므로 둘 중 하나로 단정하지 않는다.
  'ledger-cash': guide('현금출납장·거래처원장',
    feature('cash-ledger-read', '현금출납장 조회', ['사이드바의 현금출납장을 선택합니다.', '기간과 계좌 등 화면 조건을 확인합니다.', '입출금 내역과 잔액을 확인합니다.']),
    feature('partner-ledger-read', '거래처원장·전표 상세 조회', ['사이드바의 거래처원장을 선택합니다.', '거래처와 기간·계정 조건을 고릅니다.', '전표번호를 눌러 품목별 수량과 금액을 확인합니다.'], '현금출납장과 거래처원장의 사용 방법을 함께 안내합니다.'),
  ),
  // ItemLedger
  'item-ledger': guide('제품별원장', feature('item-ledger-read', '품목별 입출고 근거 조회', ['품목 분류와 검색으로 대상을 찾습니다.', '품목을 선택합니다.', '입고·생산·사용·출고·실사 행과 잔량을 확인합니다.'], '기초(역산) 표시는 과거 기록이 완전하다는 뜻이 아닙니다.')),
  // FinancialReports
  'financial-reports': guide('재무제표', feature('financial-read', '기간별 보고서 확인', ['월 또는 전체를 선택합니다.', '보고서의 계정별 금액과 기준을 확인합니다.', '내역이 펼쳐지는 항목은 원래 기록을 함께 확인합니다.'], '기초 금액 입력과 회계 판단은 실제 자료를 확인한 뒤 진행합니다.')),
  // LoanManager
  'loan-management': guide('대출 관리',
    feature('loan-read', '대출별 내역 보기', ['대출 목록에서 대상을 선택합니다.', '시작일·기초 원금·차입·상환 내역을 확인합니다.']),
    feature('loan-record', '차입·상환 기록', ['대출 상세에서 차입 기록 또는 원금·이자 상환을 선택합니다.', '실제 날짜·지급 계좌·원금·이자를 확인합니다.', '입력 내용을 확인하고 저장합니다.'], '잔액이나 원금·이자를 임의로 추정하지 않습니다.'),
  ),
  // ProfitAnalysis: 이 세 화면은 같은 컴포넌트의 initialTab이 다르다.
  'profit-analysis': guide('손익 / 비용 분석', feature('profit-read', '기간별 손익·비용 확인', ['시작일과 종료일 또는 빠른 기간을 선택합니다.', '선택 기간의 매출·비용·집계 기준을 확인합니다.', '세부 항목을 펼쳐 연결 내역을 확인합니다.'], '재고 스냅샷이 없는 기간을 실제 재고로 추정하지 않습니다.')),
  'cash-flow': guide('현금흐름 분석', feature('cashflow-read', '기간별 현금흐름 확인', ['현금흐름 분석에서 기간을 선택합니다.', '들어온 돈·나간 돈과 연결 내역을 확인합니다.'], '현금흐름과 비용의 회계 귀속은 같다고 단정하지 않습니다.')),
  'partner-stats': guide('거래처통계', feature('partner-stats-read', '거래처별 분석 확인', ['기간과 거래처 조건을 선택합니다.', '거래처별 집계와 상세 내역을 확인합니다.'])),
  // ProductionManager
  production: guide('생산 실적', feature('production-read', '생산·출고 실적과 원료 추적', ['기간을 선택하고 품목명/메모 검색으로 대상을 찾습니다.', '실적 행의 생산·출고 수량과 원료 로트 근거를 확인합니다.'], '현재 BOM이나 판매량으로 과거 생산량을 대신 계산하지 않습니다.')),
  // SmartStoreAnalytics
  'smartstore-analytics': guide('스마트스토어 분석', feature('smartstore-read', '주문 기반 분석 확인', ['월별 매출·고객별 현황·신규 / 재주문 중 확인할 탭을 고릅니다.', '해당 주문 기반 집계와 상품·거래처 내역을 확인합니다.'], '현재 화면의 분석을 외부 API 동기화 완료나 실재고 증명으로 해석하지 않습니다.')),
  // HaccpChecklist
  'haccp-checklist': guide('HACCP 체크리스트', feature('haccp-record', '점검표 작성·확인', ['작성할 점검표와 날짜 또는 주기를 고릅니다.', '실제 점검한 내용을 입력합니다.', '저장된 결과를 확인하고 필요한 경우 인쇄합니다.'], undefined, '같은 기간의 저장된 기록이 확인되면 저장된 기록 열기로 확인합니다. 중복 작성으로 덮어쓰지 않습니다.')),
  // PartnerSignupApproval
  'partner-signup': guide('거래처 가입승인', feature('signup-review', '가입 요청 확인', ['가입 요청 목록에서 대상을 선택합니다.', '신청 정보와 연결할 거래처를 확인합니다.', '화면의 승인 또는 거절 절차를 확인한 뒤 진행합니다.'])),
};

// 직원 전용: PalletManager/LeaveManager/ConfirmationItems/StaffChecklistView와 AdminApp 서류 분기를 대조했다.
const staff: Record<string, HelpMenuGuide> = {
  pallets: guide('파렛트 관리', feature('pallet-read', '거래처별 파렛트 확인', ['거래처 검색으로 대상을 찾습니다.', '파렛트 수량과 입출고 거래 내역을 확인합니다.']), feature('pallet-receive', '파렛트 신규 입고', ['신규 입고를 누릅니다.', '실제 거래처·날짜·수량을 입력합니다.', '내용을 확인하고 저장합니다.'])),
  'leave-portal': guide('연차 신청', feature('leave-request', '연차 신청·내역 확인', ['연차 신청 및 확인 화면에서 본인의 사용 내역을 확인합니다.', '신규 신청에서 휴가 종류·기간을 입력합니다.', '신청 후 목록의 승인 상태를 확인합니다.'], '신청이 승인 완료를 뜻하지 않습니다.')),
  'confirmation-items': guide('확인사항', feature('confirmation-read', '요청 상태 확인', ['확인사항에서 요청 목록과 상태를 확인합니다.', '해당 요청의 원래 내용과 처리 결과를 읽습니다.'], '직원에게 관리자 승인·회계 처리를 안내하지 않습니다.')),
  'sanitation-checklist': guide('작업장 위생점검', feature('sanitation-record', '위생점검 작성', ['점검 날짜와 점검표를 선택합니다.', '실제 확인한 내용을 입력합니다.', '저장 후 같은 날짜의 기록을 확인합니다.'], undefined, '기존 기록 안내가 나오면 저장된 기록 열기로 확인합니다. 미저장 내용을 보관한 뒤 전환합니다.')),
  documents: guide('서류 관리',
    feature('production-document', '생산작업일지 작성·저장', ['생산작업일지와 작성일을 선택합니다.', '실제 근거 불러오기를 누르고 빠진 내용만 직접 보완합니다.', '작성·검토·승인 이름과 특이사항을 확인한 뒤 저장합니다.'], '이름은 전자결재가 아닙니다. 판매량·현재 BOM으로 빈 생산량을 추정하지 않습니다.', '다른 직원이 먼저 저장했다면 입력 내용을 보관하고 최신 문서를 다시 확인합니다.'),
    feature('production-document-print', '생산작업일지 인쇄', ['인쇄 미리보기를 엽니다.', '미확인 표시와 내용을 확인합니다.', '인쇄 / PDF 저장을 누릅니다.'], '저장 전 미리보기도 가능하므로 인쇄가 저장 완료를 뜻하지 않습니다.'),
  ),
};

// AdminApp/NoticeBoard의 관리자 callback, ItemList 입고 선택창, ItemManager 수정·연결 버튼 근거.
const adminExtras: Record<string, HelpFeature[]> = {
  notice: [feature('notice-write', '공지 작성·수정', ['공지 추가를 누르거나 해당 글의 공지 수정을 누릅니다.', '제목·본문을 입력하고 미리보기로 확인합니다.', '등록 또는 수정 저장 후 게시된 내용을 확인합니다.'])],
  inventory: [feature('inventory-receive', '입고대기 발주 입고 처리', ['입고 처리를 누르고 매입 거래처를 선택합니다.', '품목명·규격으로 입고대기 발주를 찾습니다.', '선택한 발주의 전체 품목과 수량을 확인한 뒤 입고확정을 진행합니다.'], '전표가 연결된 입고대기 발주를 선택하는 경로입니다. 실제 입고하지 않은 수량을 입력하지 않습니다.')],
  'item-management': [
    feature('item-edit', '품목 정보 수정', ['전체 품목이나 거래처 품목 목록에서 대상을 찾습니다.', '대상 품목의 수정을 누릅니다.', '품목명·규격 등 바꿀 항목을 확인하고 저장합니다.']),
    feature('item-link', '거래처와 품목 연결', ['거래처를 선택하고 품목 연결을 엽니다.', '연결할 품목을 품목명·규격으로 찾습니다.', '매출·매입 구분과 연결 내용을 확인하고 진행합니다.']),
    feature('purchase-unit', '원료 매입단위 확인', ['대상 원료 품목의 매입단위를 누릅니다.', '단위별 kg 환산과 거래처 연결 정보를 확인합니다.'], '단위 환산값은 실제 포장·매입 근거를 확인하며 현재 원가로 과거 금액을 만들지 않습니다.'),
  ],
};

/** 별칭은 실제 연결 화면으로만 합친다. QR/외부 포털은 view가 없는 동작이어서 폴백으로 남긴다. */
export function getHelpMenuGuide(view: string | undefined, mode: Mode): HelpMenuGuide {
  const aliases: Record<string, string> = { shipping: 'orders', 'item-price-management': 'item-management', 'ai-consultant': 'dashboard', 'cost-management': 'profit-analysis' };
  const own = (table: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(table, key);
  const key = view ? own(aliases, view) ? aliases[view] : view : '';
  const scoped = mode === 'admin' ? admin : staff;
  const found = own(shared, key) ? shared[key] : own(scoped, key) ? scoped[key] : undefined;
  if (!found) return { menuTitle: '현재 화면의 기능 안내는 준비 중입니다', features: [] };
  const extra = mode === 'admin' && own(adminExtras, key) ? adminExtras[key] : [];
  return { menuTitle: found.menuTitle, features: [...found.features, ...extra].map(row => ({ ...row, steps: [...row.steps] })) };
}
