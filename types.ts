
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
  boxSubId?: string;      // 부자재 박스 ID (재고 차감 대상)
}

export interface OrderPallet {
  type: string;
  quantity: number;
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

export interface ProductClient {
  id: string;       // `${productId}_${clientId}`
  productId: string;
  clientId: string;
  sku?: string;            // 거래처별 SKU (포장 단위 기준)
  price?: number;
  taxType?: '과세' | '면세';
  // SHIPPING (박스단위) BOM — 거래처별 포장 설정
  shippingStock?: number;  // SHIPPING 재고수량
  boxTypeId?: string;      // 박스 부자재 ID
  qtyPerBox?: number;      // 박스당 낱개 수
  tapeTypeId?: string;     // 테이프 부자재 ID
}

export interface Client {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  type: ClientType;
  region?: string;
  partnerType?: PartnerType; // undefined = '매출처' (하위 호환)
  purchaseItems?: PurchaseItem[];
}

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
  boxSubId?: string;   // 부자재 박스 ID (재고 차감 대상)
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
  boxSize?: number; // 박스 카테고리: 한 박스에 들어가는 낱개 수
}

export type InventoryCategory = '완제품' | '향미유' | '고춧가루' | '용기' | '마개' | '테이프' | '박스' | '라벨';

export type ProductStage = 'WIP' | 'FINISHED';

export interface Product {
  id: string;
  name: string;
  sku?: string;                  // SKU 코드
  category: InventoryCategory | string;
  itemType?: ProductStage;       // WIP(반제품) | FINISHED(완제품) — 없으면 부자재/원료
  price: number;
  stock: number;                 // 부자재/원료 재고 (또는 미분류)
  wipStock?: number;             // WIP 반제품 재고수량
  finishedStock?: number;        // FINISHED 완제품 재고수량
  manufacturingCost?: number;    // 제조원가 (WIP/FINISHED 공통)
  minStock: number;
  unit: string;
  image: string;
  oil?: string;
  clientId?: string; // @deprecated — clientIds 사용
  clientIds?: string[];
  supplierId?: string;
  freightType?: 's' | 'a' | 'b' | 'c' | 'd' | 'e';
  boxSize?: number; // @deprecated — defaultBoxConfig.unitsPerBox 사용
  defaultBoxConfig?: BoxConfig;       // @deprecated — ProductClient.boxTypeId/qtyPerBox 사용
  clientBoxConfigs?: ClientBoxConfig[]; // @deprecated — ProductClient 사용
  품목?: string;
  용량?: string;
  isSmartStore?: boolean;
  submaterials?: SubmaterialComponent[];
}

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
}

// Leave related interfaces
export type LeaveType = '연차' | '오전반차' | '오후반차' | '병가' | '경조사' | '기타';
export type LeaveStatus = 'pending' | 'approved' | 'rejected';

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


export type ViewType = 'dashboard' | 'orders' | 'shipping' | 'inventory' | 'clients' | 'ai-consultant' | 'pallets' | 'database' | 'hr' | 'notice' | 'leave-portal' | 'client-portal' | 'item-management' | 'confirmation-items' | 'officetalk' | 'documents' | 'trade-statement';

export interface IssuedStatementItem {
  name: string;
  spec: string;
  qty: number;
  price: number;
  supply: number;
  tax: number;
  total: number;
  isTaxExempt: boolean;
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
}

export interface AppNotification {
  id: string;
  type: 'new_order' | 'confirmation' | 'mention';
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
  type?: 'auto' | 'manual' | 'correction'; // auto: 주문 자동생성, manual: 직접입력, correction: 정정
  orderId?: string;  // auto 타입일 때 출처 주문 ID
}

// ── 품목 구조 (item / item_bom / item_customer) ──────────────────────────
export type ItemType = 'RAW' | 'SUB' | 'WIP' | 'FINISHED';

export interface ItemBom {
  id: string;
  parent_key: string;   // prod.품목 또는 prod.name
  child_name: string;   // 원료명 (RAW_MATERIALS 기준)
  ratio: number;        // 배합 비율
  yield_rate: number;   // 수율 (기본 1.0)
}

export interface ItemCustomer {
  id: string;
  item_id: string;      // FINISHED 품목의 Firestore product ID
  customer_id: string;
  box_type_id: string;  // 박스 종류
  qty_per_box: number;  // 박스당 입수
}
// ────────────────────────────────────────────────────────────────────────

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
