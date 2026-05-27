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
  productId: string;
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
  productId: string;
  name: string;
  quantity: number;
}

export type ClientType = '스마트스토어' | '택배' | '일반';

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
  productId?: string;
  clientId?: string;
  supplierId?: string;
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

// @deprecated — PartnerItem 사용
export type ProductClient = PartnerItem;
// @deprecated — PartnerItem 사용
export type ProductSupplier = PartnerItem;

// ── 파트너 (partners 컬렉션) ──────────────────────────────────────────────
export interface Partner {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  type: ClientType;
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

// @deprecated — Partner 사용
export type Client = Partner;

export type OrderSource = '스마트스토어' | '택배' | '일반';

export interface Order {
  id: string;
  clientId?: string;
  customerName: string;
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
}

export interface BoxConfig {
  boxType: string;     // 박스 종류 표시명 (예: "2번박스", "3번박스")
  unitsPerBox: number; // 박스당 낱개 수 (예: 12, 10)
  boxSubId?: string;   // 박스 품목 ID
}

export interface ClientBoxConfig {
  clientId: string;
  configs: BoxConfig[]; // 거래처당 여러 박스 설정 가능
}

export interface SubmaterialComponent {
  id: string;
  name: string;
  category: InventoryCategory | string;
  stock: number;
  unit: string;
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
  clientId?: string;   // @deprecated — clientIds 사용
  clientIds?: string[];
  freightType?: 's' | 'a' | 'b' | 'c' | 'd' | 'e';
  boxSize?: number;    // @deprecated
  defaultBoxConfig?: BoxConfig;       // @deprecated
  clientBoxConfigs?: ClientBoxConfig[]; // @deprecated
  품목?: string;
  spec?: string;              // 규격/내용량 (예: "200g", "1kg", "300ml")
  /** @deprecated spec 사용 */
  용량?: string;
  isSmartStore?: boolean;
  smartStorePrice?: number;
  submaterials?: SubmaterialComponent[];
  isRawMaterial?: boolean;    // 원료로도 관리되는 품목 (수불부 자동 연동)
  rawMaterialName?: string;   // 원료 수불부 키 이름 (예: "볶음참깨")
  variantStocks?: Record<string, number>; // 규격별 재고 { "1kg||labelId": 50, "20kg||": 100 }
  netContent?: string;         // 내용량 표시 (예: "200g", "300ml", "1.8L") — product만 해당
  weightInKg?: number;         // 실중량 (kg) — product만 해당
  archived?: boolean;         // 통합 마이그레이션으로 대체된 구 품목
  supplierId?: string;        // @deprecated — productSuppliers 사용
}

// @deprecated — Item 사용
export type Product = Item;

export interface PalletStock {
  id: string;
  name: string;
  total: number;
  inUse: number;
  damaged: number;
}

export interface PalletTransaction {
  id: string;
  clientId: string;
  palletId: string;
  type: 'in' | 'out';
  quantity: number;
  date: string;
  note?: string;
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


export type ViewType = 'dashboard' | 'orders' | 'shipping' | 'inventory' | 'clients' | 'partners' | 'ai-consultant' | 'pallets' | 'database' | 'hr' | 'notice' | 'leave-portal' | 'client-portal' | 'item-management' | 'item-price-management' | 'confirmation-items' | 'officetalk' | 'documents' | 'trade-statement' | 'tax-statement' | 'cost-management' | 'profit-analysis' | 'production' | 'admin-checklist' | 'inbound-scan' | 'smartstore-analytics' | 'haccp-checklist' | 'return-management' | 'inbound-returns' | 'client-stats' | 'cash-flow' | 'sanitation-checklist';

// ── 생산 실적 ──────────────────────────────────────────────────────────────────
export interface ProductionRecord {
  id: string;
  date: string;               // YYYY-MM-DD
  productId: string;
  productName: string;
  finishedQty: number;        // FINISHED 생산 수량
  wipUsed?: number;           // WIP 투입 수량 (옵션)
  wipProductId?: string;      // 투입한 WIP 품목 ID (옵션)
  wipProductName?: string;    // 투입한 WIP 품목명 (옵션)
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
  type: '매출' | '매입';
  clientId: string;
  clientName: string;
  orderId: string;
  docNo: string;
  totalSupply: number;
  totalTax: number;
  totalAmount: number;
  items: IssuedStatementItem[];
  receivedAt?: string;    // 입고 확인 일시 (매입 전표)
  taxIssuedAt?: string;   // 세금계산서 발행 일시
  // 수금/결제 추적
  payments?: PaymentRecord[];
}

export interface PaymentRecord {
  id: string;
  amount: number;
  date: string;       // YYYY-MM-DD
  method?: '현금' | '계좌이체' | '어음' | '카드' | '기타';
  note?: string;
}

// ── 발주 (purchaseOrders 컬렉션) ─────────────────────────────────────────────
// 매입 플로우: pending → invoiced → received
// 매출 issuedStatements.orderId 와 대칭: issuedStatements.purchaseOrderId
export interface PurchaseOrder {
  id: string;
  productId: string;
  productName: string;
  supplierId?: string;
  supplierName?: string;
  quantity: number;
  unit?: string;
  isBox?: boolean;
  price?: number;
  status: 'pending' | 'invoiced' | 'received';
  confirmedByUser?: boolean;
  linkedStatementId?: string;  // 연결된 issuedStatement ID
  createdAt: string;
  invoicedAt?: string;
  receivedAt?: string;
}

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

export interface AppNotification {
  id: string;
  type: 'new_order' | 'confirmation' | 'mention' | 'leave_request';
  title: string;
  body: string;
  readBy: string[];   // 읽은 userId 목록
  createdAt: string;
  linkedId?: string;  // 관련 order/request ID
  senderId?: string;  // 발생시킨 userId
  targetId?: string;  // 수신 대상 userId (없으면 전체)
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
}

// ── 입고 관리 ────────────────────────────────────────────────────────────

export interface PendingReceiptItem {
  submaterialId: string;
  name: string;
  quantity: number;
  unit: string;
  unitPrice?: number;
}

export interface PendingReceipt {
  id: string;
  supplierId?: string;      // 거래처 ID (partner)
  supplierName: string;
  items: PendingReceiptItem[];
  totalAmount?: number;
  photoUrl?: string;       // Firebase Storage URL
  registeredBy: string;    // 등록자 이름
  registeredAt: string;    // ISO timestamp
  status: 'pending_voucher' | 'voucher_linked';
  linkedStatementId?: string; // 연결된 전표 ID
  note?: string;
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
  productId: string;
  name: string;
  quantity: number;
  price: number;
  reason: ReturnReason;
  isResellable: boolean;
}

export interface ReturnRequest {
  id: string;
  orderId?: string;
  clientId: string;
  clientName: string;
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
  clientName: string;
  proposedData: {
    tradeDate: string;
    clientId: string;
    clientName: string;
    totalSupply: number;
    totalTax: number;
    totalAmount: number;
    items: IssuedStatementItem[];
  };
  createdAt: string;
  createdBy: string;
  status: 'pending' | 'approved' | 'rejected';
}

// ── 계정과목 ──────────────────────────────────────────────────────────────────
export interface AccountCode {
  id: string;          // 계정코드 (예: '500')
  code: string;        // 계정코드 문자열
  name: string;        // 계정명 (예: '원료매입')
  groupId?: string;    // 소속 AccountGroup ID
  note?: string;
}

export type AccountGroupPlLine = 'revenue' | 'cogs' | 'sgna' | 'other-income' | 'other-expense';

export interface AccountGroup {
  id: string;
  name: string;        // 그룹명 (예: '총매출', '총매출원가')
  type: '수익' | '비용' | '자산' | '부채' | '자본';
  plLine?: AccountGroupPlLine; // 손익계산서 위치
  note?: string;
}
// ── 재고액 스냅샷 (월말 기말재고액 기록) ───────────────────────────────────────
export interface InventorySnapshot {
  id: string;
  yearMonth: string;    // 'YYYY-MM'
  value: number;        // 재고총액 (기말재고액, 원)
  recordedAt: string;   // ISO timestamp
}

export interface ProductionSalesLog {
  id: string;
  date: string;         // 서류 날짜
  createdAt: string;    // ISO timestamp
  createdBy: string;    // 작성자
  orderCount: number;   // 처리 주문 수
  productionRows: { groupLabel: string; spec: string; 수량: number; 소비기한: string; 비고: string }[];
  orderSummaries: { customerName: string; items: { name: string; qty: number }[] }[];
}
// ─────────────────────────────────────────────────────────────────────────────

export type AdjustmentType = 'quantity_change' | 'cancel_receipt' | 'chat_mention' | 'reorder_alert';
export type AdjustmentStatus = 'pending' | 'processed' | 'rejected';

export interface AdjustmentRequest {
  id: string;
  productId: string;
  productName: string;
  originalQuantity: number;
  requestedQuantity?: number;
  type: AdjustmentType;
  reason: string;
  status: AdjustmentStatus;
  requestedAt: string;
  processedAt?: string;
  unit?: string; // 수량 단위 (예: 'B', '개')
}
