/**
 * @shared-move  shared/types.ts
 * 앱 전체 공통 TypeScript 타입 정의
 * Phase 2 분리 시 shared/ 로 이동하고 양쪽 앱에서 import합니다.
 * 단, 관리자 전용 인터페이스(CompanyInfo, FixedCostEntry 등)는
 * shared/types/admin.ts 로 별도 분리를 권장합니다.
 */

export enum OrderStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SHIPPED = 'SHIPPED',
  DISPATCHED = 'DISPATCHED',
  DELIVERED = 'DELIVERED',
  ON_HOLD = 'ON_HOLD'
}

export interface OrderItem {
  itemId: string;
  name: string;
  quantity: number;
  price: number;
  checked?: boolean;
  checkedBy?: string;    // 체크한 사람 이름
  mfgDate?: string;      // 제조일자 (소비기한은 +1년으로 자동 계산)
  labelType?: '대기' | '날인' | '부착';
  isBoxUnit?: boolean;    // 박스 단위로 주문했는지
  boxQuantity?: number;   // 박스 수 (isBoxUnit이 true일 때)
  unitsPerBox?: number;   // 박스당 낱개 수 (주문 시점 기준)
  boxType?: string;       // 박스 종류 표시명 (예: "2번박스")
  boxSubId?: string;      // 박스 품목 ID (재고 차감 + 표시용)
  displaySize?: string;   // 서류 규격란 표기 (통합 품목용, 예: "1kg", "20kg")
}

export interface OrderPallet {
  type: string;
  quantity: number;
  isExchange?: boolean; // 교환 팔레트 — PalletManager 재고 차감 제외
}

export interface DeliveryBox {
  itemId: string;
  name: string;
  quantity: number;
}

export type PartnerChannel = '스마트스토어' | '택배' | '일반';

export type PartnerType = '매출처' | '매입처' | '매출+매입처';

export interface PurchaseItem {
  id: string;
  name: string;
}

// ── 파트너-품목 매핑 (partner_item 컬렉션) ────────────────────────────────
// Direction: 'in' = 매입(공급), 'out' = 매출(판매)
export interface PartnerItem {
  id: string;
  itemId: string;              // 품목 id (canonical)
  partnerId: string;           // 거래처 id (canonical)
  Direction: 'in' | 'out';     // 'in' = 매입, 'out' = 매출
  price?: number;              // 거래처별 단가
  Account_Code?: string;       // 계정과목
  taxType?: '과세' | '면세';
  isSmartStore?: boolean;      // 스마트스토어 채널 여부
  // @deprecated → shipping_rule 컬렉션으로 이관 예정 (별도 정리)
  boxTypeId?: string;
  qtyPerBox?: number;
  qty_per_box?: number;
  tapeTypeId?: string;
  displaySize?: string;
  packageType?: string;
  containerTypeId?: string;
  labelId?: string;
  weightInKg?: number;
}

// ── 배송 규칙 (shipping_rule 컬렉션) ─────────────────────────────────────
export interface ShippingRule {
  id: string;
  item_id: string;        // 품목 ID (어떤 완제품)
  box_item_id: string;    // items category='shipping' 인 박스 품목 ID
  qty_per_box: number;    // 박스당 수량
  tape_item_id?: string;  // 테이프 품목 ID
  partner_id?: string;    // 거래처별 오버라이드 (없으면 전체 기본값)
}


// ── 파트너 (partners 컬렉션) ──────────────────────────────────────────────
export interface Partner {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  type: PartnerChannel;
  region?: string;
  address?: string;
  addressDetail?: string;
  ownerName?: string;
  bizNo?: string;
  tel?: string;
  mobile?: string;
  fax?: string;
  note?: string;
  partnerType?: PartnerType; // undefined = '매출처' (하위 호환)
  isOemFactory?: boolean;    // 임가공(OEM) 외주공장 — OEM 발주 대상. 켜진 거래처만 외주공장 목록에 뜬다.
  purchaseItems?: PurchaseItem[];
}


export type OrderSource = '스마트스토어' | '택배' | '일반';

export interface Order {
  id: string;
  partnerId?: string;
  partnerName: string;
  items: OrderItem[];
  totalAmount: number;
  status: OrderStatus;
  createdAt: string;
  deliveryDate: string;
  email: string;
  source: OrderSource;
  pallets?: OrderPallet[];
  region?: string;
  deliveryBoxes?: DeliveryBox[];
  invoicePrinted?: boolean;
  deliveredAt?: string; // 주문이력으로 이동한 날짜
  documentDate?: string; // 전표(거래명세서) 일자 — 서류 기준일로는 안 쓴다
  rawLotsDeducted?: boolean; // 원료 로트 선입선출 차감 완료 표시(중복 차감 방지) — 생산처리(작업완료) 시 set
  rawConsumedLots?: { material: string; lotId?: string; lotNo?: string; supplierName: string; receivedDate?: string; kg: number }[]; // 정방향 추적: 이 주문이 소비한 원료 lot 스냅샷
  autoBuilt?: { itemId: string; qty: number }[];  // 구성품이 모자라 생산처리 때 먼저 만든 것 — 되돌리기용
  producedUnits?: { itemId: string; qty: number }[];  // 주문 품목을 실제로 몇 개 생산했나(기존 재고로 충당한 몫은 빠짐) — 되돌리기용.
                                                      // 없으면 옛 주문(주문량 전량 생산) → 되돌리기는 주문량으로 계산한다.
  producedAt?: string;   // 작업완료(생산처리) 완료 시각 — 원료·부자재 차감 + 완제품 재고 +N 반영됨(가드)
  shippedOut?: boolean;  // 출고 완료 — 완제품/상품 재고 −N 반영됨(가드)
}

export interface BoxConfig {
  boxType: string;     // 박스 종류 표시명 (예: "2번박스", "3번박스")
  unitsPerBox: number; // 박스당 낱개 수 (예: 12, 10)
  boxSubId?: string;   // 박스 품목 ID
}

export interface ClientBoxConfig {
  partnerId: string;
  configs: BoxConfig[]; // 거래처당 여러 박스 설정 가능
}

export interface SubmaterialComponent {
  id: string;
  name: string;
  category: InventoryCategory | string;
  stock: number;
  unit: string;
  spec?: string;   // 규격/용량 (완제품 구분용)
  cost?: number;   // 부자재 원가
  boxSize?: number;
  qrCode?: string; // 납품업체 QR/바코드 값
}

// 새 영문 체계
export type InventoryCategory =
  'raw' | 'wip' | 'product' | 'goods' | 'giftset' | 'submaterial' | 'shipping' |
  // @deprecated 마이그레이션 완료 전 하위 호환
  'label' | 'cap' | 'container' | 'box' | 'tape' |
  '완제품' | '향미유' | '고춧가루' | '용기' | '마개' | '테이프' | '박스' | '라벨';

export type ItemSubtype =
  // goods 세부 분류
  '참기름' | '들기름' | '참깨' | '들깨' | '검정깨' | '향미유' | '고춧가루' |
  // submaterial 세부 분류
  '마개' | '용기' | '박스' | '테이프' | '라벨';

export const PRODUCT_LINE = ['raw', 'wip', 'product', 'goods', 'giftset'] as const;
export const SUBMATERIALS  = ['submaterial'] as const;
export const SUBMATERIAL_TYPES = ['마개', '용기', '박스', '테이프', '라벨'] as const;
export const SHIPPING_ITEMS = ['shipping'] as const;
export const isProductLine = (cat: string): boolean => (PRODUCT_LINE as readonly string[]).includes(cat);
export const isSubmaterial = (cat: string): boolean =>
  cat === 'submaterial' || (['label', 'cap', 'container', 'box', 'tape'] as string[]).includes(cat);

// 한국어 → 영문 카테고리 변환 맵 (마이그레이션용)
export const CATEGORY_MIGRATION_MAP: Record<string, string> = {
  '완제품': 'product',
  '향미유': 'goods',
  '고춧가루': 'goods',
  '용기': 'submaterial',
  '마개': 'submaterial',
  '테이프': 'submaterial',
  '박스': 'submaterial',
  '라벨': 'submaterial',
  'container': 'submaterial',
  'cap': 'submaterial',
  'tape': 'submaterial',
  'box': 'submaterial',
  'label': 'submaterial',
};

export type ProductStage = 'WIP' | 'FINISHED';

// ── 품목 (items 컬렉션 — 완제품 + 부자재 통합) ───────────────────────────
export interface Item {
  id: string;
  name: string;
  sku?: string;
  category: InventoryCategory | string;
  // 분류 3단 — 타입 > 서브타입 > 카테고리. DB 필드는 옛 이름을 그대로 쓴다(shared/itemTaxonomy.ts 참고).
  //   category = 타입(product/goods/…) · subtype2 = 서브타입(낱개/배송/선물세트) · subtype = 카테고리(참기름/라벨/…)
  subtype?: ItemSubtype | string;  // 카테고리 — 참기름·들기름·라벨·용기·박스·마개·테이프·향미유…
  subtype2?: string;               // 서브타입 — 낱개·배송·선물세트. 부자재·원료는 비어 있다.
  itemType?: ProductStage;       // @deprecated → category: 'wip'|'product' 사용
  cost?: number;                 // 원가 (제조/매입원가) — **kg당**. 기름도 마찬가지(2026-08-14~)
  price: number;
  /** 재고 — **언제나 kg**(기름 포함). 화면에 L로 보여줄 때만 density로 나눈다. */
  stock: number;
  /**
   * 밀도 kg/L. **이 값이 있으면 화면에 L로 보여준다**(없으면 저장 단위 그대로).
   * 저장(stock·cost·BOM 수량)은 전부 kg이고, L은 표시·입력에서만 쓴다.
   * 참기름류 0.916 / 들기름류 0.924.
   */
  density?: number;
  wipStock?: number;
  finishedStock?: number;
  minStock: number;
  unit: string;
  image: string;
  oil?: string;
  partnerId?: string;   // @deprecated — partnerIds 사용
  partnerIds?: string[];
  freightType?: 's' | 'a' | 'b' | 'c' | 'd' | 'e';
  boxSize?: number;    // @deprecated
  defaultBoxConfig?: BoxConfig;       // @deprecated
  partnerBoxConfigs?: ClientBoxConfig[]; // @deprecated
  품목?: string;
  spec?: string;              // 규격/내용량 (예: "200g", "1kg", "300ml")
  /** @deprecated spec 사용 */
  용량?: string;
  isSmartStore?: boolean;
  smartStorePrice?: number;
  submaterials?: SubmaterialComponent[];
  procureType?: '완사입' | '임가공';  // 완사입=완제품 사옴(원료무관). 임가공(OEM)=우리 원료를 외주가공. 둘 다 판매 시 생산처리 없이 자기재고 −N
  unpackTo?: { itemId: string; count: number }; // 박스 개봉 — 이 품목 1개 개봉 시 대상 품목 재고 +count (예: 10kg박스 → 낱개 +10)
  isRawMaterial?: boolean;    // 원료로도 관리되는 품목 (수불부 자동 연동)
  rawMaterialName?: string;   // 원료 수불부 키 이름 (예: "볶음참깨"). 캔/포대 매입 SKU가 어느 원료(raw)에 귀속되는지 연결
  packageType?: string;       // 입고 포장 단위 ('캔' | '포대' | '자루') — 매입 SKU에만 사용
  packageKg?: number;         // 포장 1개당 kg (예: 캔 16.5, 포대 20, 자루 25). 없으면 spec에서 파싱
  lots?: RawMaterialLot[];    // 원료(raw) 로트 목록 — 배열 순서 = 선입선출 순서(앞=먼저 사용)
  mixEnabled?: boolean;       // 기름 혼합 사용: ON이면 차감 시 상위 2개 로트를 비율대로 배분(OFF=선입선출)
  mixTopPercent?: number;     // 혼합 시 상위 로트 비율(%) — 두 번째 로트는 100-이 값. 기본 50(5:5)
  phantom?: boolean;          // 즉석배합(무재고) 반제품: 재고를 안 들고, 상위 품목 출고 시 item_formula 배합비대로 원료로 전개·차감

  variantStocks?: Record<string, number>; // 규격별 재고 { "1kg||labelId": 50, "20kg||": 100 }
  netContent?: string;         // 내용량 표시 (예: "200g", "300ml", "1.8L") — product만 해당
  weightInKg?: number;         // 실중량 (kg) — product만 해당
  archived?: boolean;         // 통합 마이그레이션으로 대체된 구 품목
}


export interface PalletStock {
  id: string;
  name: string;
  total: number;
  /** @deprecated 회수 대기는 기록(주문+거래)에서 계산 — PalletManager outstandingByPallet. 저장값은 더 이상 사용 안 함 */
  inUse: number;
  damaged: number;
  hidden?: boolean; // 화면·선택 목록에서 숨김(안 쓰는 종류). 과거 이력·잔량 계산은 유지
}

export interface PalletTransaction {
  id: string;
  partnerId: string;
  palletId: string;
  type: 'in' | 'out';
  quantity: number;
  date: string;
  note?: string;
  status?: '교체중' | '교체완료';  // 교체(exchange) 거래용 — 신 파레트 지급(out) 후 헌 파레트 입고 확인 시 교체완료
  exchangeReturnQty?: number;       // 교체완료 시 회수할 헌 파레트 수량
  isTransfer?: boolean;             // 이동전표 — 거래처 잔량 추적 없이 보유 총량만 증감(지급 −, 입고 +), 전체 이력에만 기록
}

// Database related interfaces
export interface Post {
  id: string;
  title: string;
  author: string;
  content: string;
  date: string;
  tag: '공지' | '긴급' | '매뉴얼' | '업무';
}

export interface FileItem {
  id: string;
  name: string;
  type: 'pdf' | 'excel' | 'image' | 'word';
  size: string;
  date: string;
  uploader: string;
}

// 문서함(파일 자료실) — 관리자 전용
// 대분류(카테고리) 탭으로 파일을 올려 보관/다운로드한다.
export interface CabinetCategory {
  id: string;
  name: string;        // 대분류 예: 직원용, 업무용, 거래처용
  order: number;       // 탭 정렬 순서
  createdAt: string;   // ISO
}

export interface CabinetSubCategory {
  id: string;
  category: string;    // 상위 대분류 이름(CabinetCategory.name)
  name: string;        // 중분류 예: 계약, 매뉴얼, 인증
  order: number;       // 정렬 순서
  createdAt: string;   // ISO
}

export interface CabinetDoc {
  id: string;
  category: string;    // 대분류(CabinetCategory.name)
  subCategory: string; // 중분류(CabinetSubCategory.name), 없으면 ''
  fileName: string;    // 원본 파일명
  storagePath: string; // Storage 경로 (삭제용)
  downloadUrl: string; // 다운로드 URL
  size: number;        // bytes
  contentType: string; // MIME
  note?: string;       // 메모
  uploadedBy: string;  // 업로더 이름
  uploadedAt: string;  // ISO
}

// HR related interfaces
export type EmployeeStatus = 'working' | 'leave' | 'out';

export interface AnnualLeave {
  carryOverLeave: number;
  bonusLeave: number;
}

export interface Employee {
  id: string;
  name: string;
  username?: string;
  password?: string;
  position: string;
  department: string;
  joinDate: string;
  status: EmployeeStatus;
  phone: string;
  birthDate?: string;
  annualLeave?: AnnualLeave;
  healthCertDate?: string;  // 보건증 발급일 (YYYY-MM-DD)
}

// ── 급여대장 ────────────────────────────────────────────────────────────────
// 한 달에 문서 하나. 사원별 지급·공제를 담고, [전표 생성]으로 자금기록 한 건을 만든다.
//   (차) 급여 지급계   (대) 예수금 공제계 + 보통예금 실지급계
// 공제를 세목별로 나눠 두는 이유: 납부처와 납부일이 달라서, 나중에 예수금을 털 때 갈라야 한다.
export interface PayrollLine {
  employeeId: string;
  employeeName: string;
  department?: string;
  position?: string;
  base: number;             // 기본급
  overtime?: number;        // 연장·야간·휴일 수당
  allowance?: number;       // 식대 등 기타 수당
  incomeTax?: number;       // 소득세
  localTax?: number;        // 지방소득세
  pension?: number;         // 국민연금
  health?: number;          // 건강보험(장기요양 포함)
  employment?: number;      // 고용보험
  otherDeduct?: number;     // 기타 공제
  note?: string;
}

export interface Payroll {
  id: string;               // 'pay-2026-08'
  yearMonth: string;        // '2026-08'
  payDate: string;          // 실제 지급일 (전표 일자가 된다)
  lines: PayrollLine[];
  cashEntryId?: string;     // 끊은 전표 — 대장과 전표를 묶어 되짚어 갈 수 있게
  note?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** 지급계 — 기본급 + 수당 */
export const payrollGross = (l: PayrollLine): number =>
  (l.base || 0) + (l.overtime || 0) + (l.allowance || 0);
/** 공제계 — 세목 합 */
export const payrollDeduct = (l: PayrollLine): number =>
  (l.incomeTax || 0) + (l.localTax || 0) + (l.pension || 0)
  + (l.health || 0) + (l.employment || 0) + (l.otherDeduct || 0);
/** 실지급 = 지급계 − 공제계 */
export const payrollNet = (l: PayrollLine): number => payrollGross(l) - payrollDeduct(l);
/** 대장 전체 합계 */
export const payrollTotals = (lines: PayrollLine[]) => lines.reduce(
  (a, l) => ({
    gross: a.gross + payrollGross(l),
    deduct: a.deduct + payrollDeduct(l),
    net: a.net + payrollNet(l),
  }),
  { gross: 0, deduct: 0, net: 0 },
);

// Leave related interfaces
// '휴가' = 회사 단체 휴가 — 관리자가 기간을 정해 직원 일괄 부여(연차 차감). 개인 신청 대상 아님.
export type LeaveType = '연차' | '오전반차' | '오후반차' | '병가' | '경조사' | '기타' | '휴가';
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancel_pending' | 'cancelled';

export interface LeaveModifyRequest {
  startDate: string;
  endDate: string;
  reason: string;
  daysUsed: number;
  status: 'pending' | 'approved' | 'rejected';
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  reason: string;
  status: LeaveStatus;
  requestedAt: string;
  daysUsed: number;
  /**
   * 연차 차감 여부. 미지정(undefined)이면 유형 기본값(경조사·기타만 미차감).
   * 회사 단체 휴가처럼 같은 유형이라도 건별로 차감/미차감이 갈릴 때 false로 지정한다.
   * (예: 창립기념일·명절 추가휴무 = 미차감 / 집단 연차소진 = 차감)
   */
  deductsLeave?: boolean;
  modifyRequest?: LeaveModifyRequest;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  senderId: string;
  senderName: string;
  text: string;
  imageUrl?: string;
  createdAt: string;
  mentions?: string[]; // Array of mentioned user IDs
}

export interface ChatRoom {
  id: string;
  name?: string;
  participantIds: string[];
  lastMessage?: string;
  lastUpdatedAt: string;
  isGroup: boolean;
  lastReadBy?: Record<string, string>; // userId → ISO timestamp
}


export type ViewType = 'dashboard' | 'orders' | 'shipping' | 'inventory' | 'partners' | 'partners' | 'ai-consultant' | 'pallets' | 'database' | 'hr' | 'notice' | 'leave-portal' | 'partner-portal' | 'item-management' | 'item-price-management' | 'confirmation-items' | 'officetalk' | 'documents' | 'trade-statement' | 'tax-statement' | 'cost-management' | 'profit-analysis' | 'production' | 'admin-checklist' | 'inbound-scan' | 'smartstore-analytics' | 'haccp-checklist' | 'return-management' | 'inbound-returns' | 'partner-stats' | 'cash-flow' | 'sanitation-checklist' | 'partner-signup' | 'file-cabinet' | 'ledger-cash' | 'financial-reports';

// ── 생산 실적 ──────────────────────────────────────────────────────────────────
export interface ProductionRecord {
  id: string;
  date: string;               // YYYY-MM-DD
  itemId: string;
  itemName: string;
  finishedQty: number;        // FINISHED 생산 수량
  wipUsed?: number;           // WIP 투입 수량 (옵션)
  wipItemId?: string;      // 투입한 WIP 품목 ID (옵션)
  wipItemName?: string;    // 투입한 WIP 품목명 (옵션)
  cost?: number;              // 건당 원가 (자동 계산 또는 수동 입력)
  note?: string;
  createdBy?: string;
  createdAt: string;
}

// ── 비용관리 ──────────────────────────────────────────────────────────────────
export type FixedCostCategory = '임차료' | '보험료' | '감가상각비' | '대출이자' | '공과금' | '인건비' | '기타';

export interface FixedCostEntry {
  id: string;
  yearMonth: string;           // 'YYYY-MM'
  category: FixedCostCategory;
  label: string;               // 세부 항목명 (예: '공장 임대료', '화재보험')
  amount: number;
  accountCode?: string;        // 계정과목 — 비현금(감가상각·퇴직충당금) 판정에 쓰인다
  note?: string;
  createdAt: string;
}

export interface FixedCostTemplate {
  id: string;
  name: string;                // 항목명 (예: 공장 임대료)
  amount: number;
  category: FixedCostCategory;
  active: boolean;             // false면 집계 제외
  note?: string;
  // 정기분개(정기 비용 전표) 설정
  accountCode?: string;        // 이 정기비용이 끊길 계정과목 코드 (판관비/영업외)
  partnerId?: string;          // 거래처 id (임대인·보험사 등) — 필요한 경우만
  partnerName?: string;        // 거래처 표시용 스냅샷
  startYm?: string;            // 'YYYY-MM' 시작월 (이 월부터 생성)
  endYm?: string;              // 'YYYY-MM' 종료월 (선택, 이 월까지)
}

export interface IssuedStatementItem {
  name: string;
  spec: string;
  qty: number;
  price: number;
  supply: number;
  tax: number;
  total: number;
  isTaxExempt: boolean;
  isBoxUnit?: boolean;
  boxSize?: number;
  accountCode?: string;  // 라인별 계정과목 코드
}

export interface IssuedStatement {
  id: string;
  issuedAt: string;       // ISO timestamp (전표일자)
  tradeDate: string;      // YYYY-MM-DD
  type: '매출' | '매입' | '비용';
  partnerId: string;
  partnerName: string;
  orderId: string;
  docNo: string;
  totalSupply: number;
  totalTax: number;
  totalAmount: number;
  items: IssuedStatementItem[];
  taxIssuedAt?: string;   // 세금계산서 발행 일시
  cashDir?: '입금' | '출금'; // 자금 전표(비용) 방향 — 현금흐름표 투자/재무 부호 판정용(자산·부채·자본 계정). 기본 출금.
}

/**
 * 결제 수단 — 자금원장 비고에 남기는 꼬리표일 뿐, 계산에는 안 쓴다.
 *
 * 수금·지불은 **자금원장(cashEntries) 한 곳에만** 적는다. 전에는 전표에 payments[]로도
 * 매달렸는데, 근거가 두 갈래라 같은 거래처가 화면마다 다른 잔액으로 보였다.
 * 2026-08-16에 남은 1건까지 자금원장으로 옮기고 그 경로를 걷어냈다.
 */
export type PaymentMethod = '현금' | '계좌이체' | '어음' | '카드' | '기타';

// ── 발주 (purchaseOrders 컬렉션) ─────────────────────────────────────────────
// 매입 플로우: pending → invoiced → received
// received + linkedStatementId 없음 = 전표 작성 대기
// received + linkedStatementId 있음 = 전표 연결 완료
export interface PurchaseOrderItem {
  itemId: string;
  name: string;
  quantity: number;
  unit: string;
  isBox?: boolean;
}

export interface PurchaseOrder {
  id: string;
  itemId: string;
  itemName: string;
  partnerId?: string;
  partnerName?: string;
  quantity: number;
  unit?: string;
  isBox?: boolean;
  status: 'pending' | 'invoiced' | 'received';
  confirmedByUser?: boolean;
  linkedStatementId?: string;
  linkedStatementAt?: string;   // 전표 발행(연결) 시각 — 선입고 이력 1일 뒤 자동삭제 기준
  createdAt: string;
  invoicedAt?: string;
  receivedAt?: string;
  items?: PurchaseOrderItem[];  // 멀티품목 발주카드(거래처별 묶음) / 선입고·스캔입고
  photoUrl?: string;            // 입고 납품서 사진
  // ── OEM(임가공) 배치 ── poType='oem'이면 발주카드가 아니라 외주가공 배치다.
  //   발주(sent): 내보낸 원료를 oemSent에 기록하며 본재고→외주재고 이동(전표 없음).
  //   가공입고(received): items[]에 돌아온 완제품/벌크, 외주재고 정리, 가공비 매입전표(linkedStatementId).
  poType?: 'oem';
  oemPartnerId?: string;                          // 외주공장 (거래처)
  oemSent?: { material: string; kg: number }[];   // 내보낸 원료 (로스 계산 기준, 다종 대응)
  oemSentAt?: string;                             // 외주 출고 시각
  oemReceivedKg?: number;                         // 받은 볶음참깨 총 kg (로스 = ΣoemSent.kg − 이 값)
  oemFeePerKg?: number;                           // 가공단가(원/kg) — 입고 때 입력, 전표 발행에 사용
}

// 발주카드의 품목 라인 통일 조회: 묶음(items[])이면 그대로, 단일품목 PO면 1줄로 변환
export const poLines = (po: PurchaseOrder): PurchaseOrderItem[] =>
  (po.items && po.items.length > 0)
    ? po.items
    : [{ itemId: po.itemId, name: po.itemName, quantity: po.quantity, unit: po.unit ?? '', isBox: po.isBox }];

export interface CompanyInfo {
  name: string;           // 상호
  ceoName: string;        // 대표자명
  bizNo: string;          // 사업자등록번호 (000-00-00000)
  bizType: string;        // 업태
  bizItem: string;        // 종목
  address: string;        // 사업장 주소
  phone?: string;         // 전화번호
  fax?: string;           // 팩스번호
  email?: string;         // 이메일
  adminPassword?: string; // 관리자 인증 비밀번호 (기본값: '0000')
}

// 자주 쓰는 비용 항목 프리셋 (택배비·상차비·기타 등) — 품목/재고 아님, 전표 직접입력 빠른 추가용
export interface ExpensePreset {
  id: string;
  name: string;                 // 항목명 (예: 택배비)
  price?: number;               // 기본 단가(선택)
  taxType?: '과세' | '면세';     // 기본 과세 여부
  createdAt?: string;
}

export interface AppNotification {
  id: string;
  type: 'new_order' | 'confirmation' | 'mention' | 'leave_request' | 'inventory_shortage';
  title: string;
  body: string;
  readBy: string[];   // 읽은 userId 목록
  createdAt: string;
  linkedId?: string;  // 관련 order/request ID
  senderId?: string;  // 발생시킨 userId
  targetId?: string;  // 수신 대상 userId (없으면 전체)
}

/**
 * 원료 로트(lot) — 입고 단위(거래처/포장)별 잔여 추적.
 * 원료(raw) 품목 문서의 lots 배열에 저장하며, 배열 순서가 곧 선입선출 순서(앞=먼저 사용).
 * 잔여는 항상 kg(canonical)로 보관하고, 기름은 화면에서 L로 환산 표시.
 */
export interface RawMaterialLot {
  id: string;
  supplierId?: string;        // 거래처 ID (이월 로트는 없음)
  supplierName: string;       // 거래처명 (예: '풍회유통') 또는 '이월'
  packageType?: string;       // '캔' | '포대' | '자루'
  packageKg?: number;         // 포장 1개당 kg (16.5 등)
  qtyIn?: number;             // 입고 시 포장 개수 (캔 68)
  kgIn: number;               // 입고 kg (= packageKg × qtyIn, 자동계산)
  kgRemaining: number;        // 잔여 kg (사용 시 차감)
  receivedDate: string;       // 입고일 'YYYY-MM-DD'
  lotNo?: string;             // 로트번호 (미래 확장)
  status: 'active' | 'depleted';
  poId?: string;              // 원본 입고 전표(purchaseOrders) 참조
  createdAt: string;
}

/**
 * **실제 원장** 한 줄 (rawMaterialLedger 컬렉션) — 창고에서 실제로 일어난 원료 입출고.
 *
 * 로트와 한 몸으로 움직이고, 재고관리 > [입출고 기록]에 그대로 뜬다.
 * 관청에 내는 원료수불부는 이게 아니라 **서류용 원장**(RawDocEntry, rawDocEntries)으로 만든다.
 * 둘의 차이는 docOil.ts 머리말 참고 — 날짜 기준도 값도 다르다.
 */
export interface RawMaterialEntry {
  id: string;
  material: string;  // 원료명
  date: string;
  received: number;  // 입고량
  used: number;      // 사용량 (정정은 음수)
  note: string;      // 비고
  createdAt: string;
  addedBy?: string;  // 작성자
  type?: 'auto' | 'manual' | 'correction' | 'stocktake_unit'; // auto: 주문 자동생성, manual: 직접입력, correction: 정정, stocktake_unit: 재고실사 단위현황 스냅샷
  orderId?: string;  // auto 타입일 때 출처 주문 ID
  canSize?: number;     // 단위당 kg/L (입고 시 단위 선택한 경우)
  canSizeTag?: string;  // 단위 추가 레이블 (예: '자루', '톤백')
  canCount?: number;    // 단위 수량 (몇 개)
  unit?: 'kg' | 'L';    // 운영 단위 — 미설정(legacy)이면 RM_UNITS 매핑으로 추정 (constants/formula.ts:unitOf)
                        // 신규 entry는 모두 'kg'로 저장 (canonical). 'L'은 옛 데이터 또는 정정 시 호환용
  originalAmount?: number;   // 사용자가 친 원본 값 (단위 환산 전)
  originalUnit?: 'kg' | 'L'; // 사용자가 친 원본 단위
  targetKg?: number;         // 재고실사정정일 때 실사 목표 절대값(kg) — 수불부 잔량을 이 값으로 리셋(앵커)
}


export interface QrMapping {
  id: string;
  qrValue: string;         // 스캔된 QR/바코드 값
  submaterialId: string;   // 매핑된 품목 ID
  submaterialName: string;
  createdAt: string;
}

// ── 원료 배합비 (item_formula 컬렉션) ────────────────────────────────────
export type ItemType = 'RAW' | 'SUB' | 'WIP' | 'FINISHED';

export interface ItemFormula {
  id: string;
  parent_key: string;   // 완제품 품목명 (key)
  child_name: string;   // 원료명
  ratio: number;        // 배합 비율
  yield_rate: number;   // 수율
}

// ── 품목 구성 BOM (item_bom 컬렉션) ──────────────────────────────────────
export interface ItemBom {
  id: string;
  parent_id: string;   // 상위 품목 ID (items 컬렉션)
  child_id: string;    // 하위 구성품 ID (items 컬렉션)
  quantity: number;    // 필요 수량
}
// ────────────────────────────────────────────────────────────────────────

// ── 반품 관리 ──────────────────────────────────────────────────────────────────
export type ReturnReason = '품질불량' | '오배송' | '과잉재고' | '기타';

export interface ReturnItem {
  itemId: string;
  name: string;
  quantity: number;
  price: number;
  reason: ReturnReason;
  isResellable: boolean;
}

export interface ReturnRequest {
  id: string;
  orderId?: string;
  partnerId: string;
  partnerName: string;
  items: ReturnItem[];
  totalAmount: number;
  status: 'pending' | 'processed';
  returnType?: '매출' | '매입'; // 매출=고객이 우리에게 반품, 매입=우리가 공급사에 반품
  createdAt: string;
  createdBy?: string;
  processedAt?: string;
  processedBy?: string;
  linkedStatementId?: string;
  note?: string;
}

export interface PendingStatementEdit {
  id: string;
  statementId: string;
  statementDocNo: string;
  statementType: '매출' | '매입';
  partnerName: string;
  proposedData: {
    tradeDate: string;
    partnerId: string;
    partnerName: string;
    totalSupply: number;
    totalTax: number;
    totalAmount: number;
    items: IssuedStatementItem[];
  };
  createdAt: string;
  createdBy: string;
  status: 'pending' | 'approved' | 'rejected';
  reason?: string;                                              // 수정 사유
  changes?: { name: string; oldQty: number; newQty: number }[]; // 품목별 수량 변경 내역(표시용)
  sourcePoId?: string;                                          // 입고대기 발주카드에서 요청된 경우 그 PO id
}

// ── 계정과목 ──────────────────────────────────────────────────────────────────
export type AccountType = '자산' | '부채' | '자본' | '수익' | '비용';

export interface AccountCode {
  id: string;          // 계정코드 (예: '500')
  code: string;        // 계정코드 문자열
  name: string;        // 계정명 (예: '원료매입')
  groupId?: string;    // 소속 AccountGroup ID
  // 복식부기 — 자동 분개/보고서의 근거. setup-account-codes.mjs로 세팅.
  type?: AccountType;               // 5분류
  normalBalance?: 'debit' | 'credit'; // 증가가 차변이냐 대변이냐 (자산·비용=debit, 부채·자본·수익=credit, contra는 반대)
  isCash?: boolean;                 // 현금성 계정(현금·보통예금) — 현금흐름표 직접법용
  /**
   * 비현금 비용 — 손익에는 잡히지만 현금이 나가지 않는다 (감가상각비, 퇴직급여충당금).
   * 현금흐름표(간접법)에서 순이익에 다시 가산한다. @deprecated 복식부기 전환 후 상대계정으로 대체.
   */
  noncash?: boolean;
  note?: string;
}

// ── 분개 (복식부기 코어) — 회계의 유일한 진실. 모든 보고서가 여기서 나온다. ──────────
export interface JournalLine {
  accountCode: string;
  debit: number;                 // 차변 (둘 중 하나만 > 0)
  credit: number;                // 대변
  partnerId?: string;            // 거래처별 채권·채무 원장용
  note?: string;
}

export interface JournalEntry {
  id: string;
  date: string;                  // 'YYYY-MM-DD' 회계 발생일
  lines: JournalLine[];          // 불변식: sum(debit) === sum(credit)
  memo?: string;
  sourceType: '매출' | '매입' | '대체' | '자금' | '수동';  // 이 분개를 만든 원본 문서 종류
  sourceId?: string;             // issuedStatements.id / cashEntries.id — 역추적·재생성용
  createdAt: string;
  createdBy?: string;
}

export type AccountGroupPlLine = 'revenue' | 'cogs' | 'sgna' | 'other-income' | 'other-expense';

export type AccountGroupCfSection = 'operating' | 'investing' | 'financing';

export interface AccountGroup {
  id: string;
  name: string;        // 그룹명 (예: '총매출', '총매출원가')
  type: '수익' | '비용' | '자산' | '부채' | '자본';
  plLine?: AccountGroupPlLine; // 손익계산서 위치
  // 현금흐름표 위치. 계정 성격(자산/부채)만으론 못 가른다 — 매입채무는 부채지만 영업,
  // 선급금은 자산이지만 영업. 그래서 그룹마다 명시한다. 미지정이면 기존 추측 로직으로 폴백.
  cfSection?: AccountGroupCfSection;
  note?: string;
}

// ── 자금 원장 (현금출납장) ────────────────────────────────────────────────────
// 전표(issuedStatements)가 '거래 발생'이라면, 여기는 '실제 돈의 이동'이다.
// 통장·카드·현금 각각이 하나의 CashAccount이고, 그 위에 CashEntry가 시간순으로 쌓여
// 잔액을 굴린다. 현금흐름표는 추측이 아니라 이 원장에서 나온다.
export interface CashAccount {
  id: string;
  name: string;                        // '기업은행 1234-56', '법인카드(신한)', '현금시재'
  type: '통장' | '카드' | '현금';
  openingBalance: number;              // 기초 잔액 (openingDate 시점)
  openingDate: string;                 // 'YYYY-MM-DD' — 이 날짜 이전 거래는 잔액에 미반영
  active: boolean;                     // false면 신규 입력 목록에서 숨김
  note?: string;
  createdAt: string;
}

export interface CashEntry {
  id: string;
  date: string;                        // 'YYYY-MM-DD' 실제 돈이 움직인 날
  cashAccountId: string;               // 어느 통장/카드/현금에서
  dir: '입금' | '출금';
  amount: number;                      // 항상 양수. 부호는 dir이 결정.
  partnerId?: string;                  // 거래처 (한국전력공사, 은행 등)
  partnerName?: string;                // 표시용 스냅샷
  accountCode?: string;                // 계정과목 — 이 돈의 성격(비용/자산/부채)을 결정
  /**
   * 한 번 움직인 돈의 성격이 둘 이상일 때 쪼갠 줄 — 대출상환(원금=차입금 + 이자=비용),
   * 급여(총급여 + 원천공제) 같은 것. ERP 출금전표와 같은 모양이다: 통장 쪽(대변)은
   * dir·cashAccountId가 이미 정하므로 반대편만 여러 줄로 적는다.
   * 있으면 amount는 이 줄들의 합이고 accountCode는 쓰지 않는다. 없으면 기존대로 accountCode 한 줄.
   */
  lines?: { accountCode: string; amount: number; note?: string }[];
  note?: string;
  createdAt: string;
  createdBy?: string;
}

// 자금 이동(CashEntry) ↔ 거래 전표(IssuedStatement) 매칭.
// N:M이라 "한 번 이체로 밀린 전표 3건 상계", "한 전표를 나눠서 3번 결제" 둘 다 표현된다.
export interface Settlement {
  id: string;
  cashEntryId: string;
  statementId: string;
  amount: number;                      // 이 매칭으로 상계된 금액
  createdAt: string;
}
// ── 재고액 스냅샷 (월말 기말재고액 기록) ───────────────────────────────────────
export interface InventorySnapshot {
  id: string;
  yearMonth: string;    // 'YYYY-MM'
  value: number;        // 재고총액 (기말재고액, 원)
  recordedAt: string;   // ISO timestamp
  items?: { itemId: string; name: string; category?: string; qty: number; value: number }[]; // 품목별 기말재고 (수량·평가액) — 월별 상세 재고 분석용
}

// 현금흐름표(간접법) 월별 수동 입력 — 자동 계산 안 되는 항목(감가상각·선급금·투자·재무·기초현금)
export interface CashFlowManual {
  id: string;             // = month ('YYYY-MM')
  month: string;          // 'YYYY-MM'
  depreciation?: number;  // 감가상각비 (+, 비현금비용 가산)
  prepaidInc?: number;    // 선급금 증가 (영업 −)
  assetBuy?: number;      // 자산취득 (투자 −)
  assetSell?: number;     // 자산매각 (투자 +)
  financeIn?: number;     // 자본조달·차입 (재무 +)
  debtRepay?: number;     // 부채상환 (재무 −)
  openingCash?: number;   // 기초현금 (기준월에만 입력 → 이후 자동 이월)
  closingCash?: number;   // 월말 실제 현금·예금 잔액 (수동 입력) — 있으면 기말현금·현금흐름을 이 값으로 재기준
}

export interface ProductionSalesLog {
  id: string;
  date: string;         // 서류 날짜
  createdAt: string;    // ISO timestamp
  createdBy: string;    // 작성자
  orderCount: number;   // 처리 주문 수
  /** 좌측 상단 — 기름 템플릿 */
  productionRows: { groupLabel: string; spec: string; 수량: number; 소비기한: string; 비고: string }[];
  /** 좌측 하단 — 깨·가루. 2026-08-14 이전 로그엔 없다(그때는 저장을 안 해서 이력 보기에서 통째로 빠졌었다) */
  seedRows?: { 품목: string; 용량: string; 수량: number; 소비기한: string; 비고: string }[];
  /** 우측 — 그날 판매(상호/품목/용량/수량/소비기한). 없으면 orderSummaries로 폴백 */
  salesRows?: { 상호: string; 품목: string; 용량: string; 수량: number; 소비기한: string }[];
  /** 맨 아래 기타 — 좌측 어느 자리에도 안 붙은 판매분 */
  extraRows?: { 품목: string; 용량: string; 수량: number; 거래처: string }[];
  /** 옛 요약 — salesRows가 없는 지난 로그를 보여주기 위해 남겨 둔다 */
  orderSummaries: { partnerName: string; items: { name: string; qty: number }[] }[];
}
// ─────────────────────────────────────────────────────────────────────────────

export type AdjustmentType = 'quantity_change' | 'cancel_receipt' | 'chat_mention' | 'reorder_alert' | 'oem_fee';
export type AdjustmentStatus = 'pending' | 'processed' | 'rejected';

export interface AdjustmentRequest {
  id: string;
  itemId: string;
  itemName: string;
  originalQuantity: number;
  requestedQuantity?: number;
  type: AdjustmentType;
  reason: string;
  status: AdjustmentStatus;
  requestedAt: string;
  processedAt?: string;
  unit?: string; // 수량 단위 (예: 'B', '개')
  // oem_fee — 가공비 전표 발행 대기. 확인사항에서 발행한다.
  oemPoId?: string;      // 대상 OEM 배치
  oemFeePerKg?: number;  // 가공단가(원/kg)
  oemTotal?: number;     // 가공비 합계(참고 표시용)
}
