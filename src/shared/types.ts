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
  Partner_ID: string;
  Item_ID: string;
  Direction: 'in' | 'out';
  price?: number;              // 거래처별 단가 (canonical)
  Account_Code?: string;
  taxType?: '과세' | '면세';
  isSmartStore?: boolean;      // 스마트스토어 채널 여부
  // @deprecated → shipping_rule 컬렉션으로 이관 예정
  boxTypeId?: string;
  qtyPerBox?: number;
  qty_per_box?: number;
  tapeTypeId?: string;
  displaySize?: string;
  packageType?: string;
  // @deprecated → item_bom 컬렉션으로 이관 예정
  containerTypeId?: string;
  labelId?: string;
  // @deprecated → items 컬렉션으로 이관 예정
  weightInKg?: number;
  // @deprecated backward compat — useAppData에서 자동 주입
  itemId?: string;
  partnerId?: string;
  Standard_Price?: number;     // @deprecated → price 사용
  item_id?: string;
  customer_id?: string;
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
  documentDate?: string; // 서류 날짜 (원료수불부 기준일)
  rawLotsDeducted?: boolean; // 원료 로트 선입선출 차감 완료 표시(중복 차감 방지) — 생산처리(작업완료) 시 set
  rawConsumedLots?: { material: string; lotId?: string; lotNo?: string; supplierName: string; receivedDate?: string; kg: number }[]; // 정방향 추적: 이 주문이 소비한 원료 lot 스냅샷
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
  subtype?: ItemSubtype | string; // category 내 세부분류
  itemType?: ProductStage;       // @deprecated → category: 'wip'|'product' 사용
  cost?: number;                 // 원가 (제조/매입원가)
  price: number;
  stock: number;
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
  manualAdjustment?: number;
  healthCertDate?: string;  // 보건증 발급일 (YYYY-MM-DD)
}

// Leave related interfaces
export type LeaveType = '연차' | '오전반차' | '오후반차' | '병가' | '경조사' | '기타';
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


export type ViewType = 'dashboard' | 'orders' | 'shipping' | 'inventory' | 'partners' | 'partners' | 'ai-consultant' | 'pallets' | 'database' | 'hr' | 'notice' | 'leave-portal' | 'partner-portal' | 'item-management' | 'item-price-management' | 'confirmation-items' | 'officetalk' | 'documents' | 'trade-statement' | 'tax-statement' | 'cost-management' | 'profit-analysis' | 'production' | 'admin-checklist' | 'inbound-scan' | 'smartstore-analytics' | 'haccp-checklist' | 'return-management' | 'inbound-returns' | 'partner-stats' | 'cash-flow' | 'sanitation-checklist' | 'partner-signup' | 'file-cabinet' | 'ledger-cash';

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
  partnerName?: string;        // 거래처(임대인 등) 표시용
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
  // 수금/결제 추적
  payments?: PaymentRecord[];
  cashDir?: '입금' | '출금'; // 자금 전표(비용) 방향 — 현금흐름표 투자/재무 부호 판정용(자산·부채·자본 계정). 기본 출금.
}

export interface PaymentRecord {
  id: string;
  amount: number;
  date: string;       // YYYY-MM-DD
  createdAt?: string; // ISO timestamp
  method?: '현금' | '계좌이체' | '어음' | '카드' | '기타';
  note?: string;
}

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
export interface AccountCode {
  id: string;          // 계정코드 (예: '500')
  code: string;        // 계정코드 문자열
  name: string;        // 계정명 (예: '원료매입')
  groupId?: string;    // 소속 AccountGroup ID
  /**
   * 비현금 비용 — 손익에는 잡히지만 현금이 나가지 않는다 (감가상각비, 퇴직급여충당금).
   * 현금흐름표(간접법)에서 순이익에 다시 가산한다.
   */
  noncash?: boolean;
  note?: string;
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
}

export interface ProductionSalesLog {
  id: string;
  date: string;         // 서류 날짜
  createdAt: string;    // ISO timestamp
  createdBy: string;    // 작성자
  orderCount: number;   // 처리 주문 수
  productionRows: { groupLabel: string; spec: string; 수량: number; 소비기한: string; 비고: string }[];
  orderSummaries: { partnerName: string; items: { name: string; qty: number }[] }[];
}
// ─────────────────────────────────────────────────────────────────────────────

export type AdjustmentType = 'quantity_change' | 'cancel_receipt' | 'chat_mention' | 'reorder_alert';
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
}
