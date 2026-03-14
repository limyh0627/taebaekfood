
export enum OrderStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SHIPPED = 'SHIPPED',
  DISPATCHED = 'DISPATCHED',
  DELIVERED = 'DELIVERED'
}

export interface OrderItem {
  productId: string;
  name: string;
  quantity: number;
  price: number;
  checked?: boolean;
  expirationDate?: string;
  labelType?: '대기' | '날인' | '부착';
  isBoxUnit?: boolean;   // 박스 단위로 주문했는지
  boxQuantity?: number;  // 박스 수량 (isBoxUnit이 true일 때)
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

export interface Product {
  id: string;
  name: string;
  category: InventoryCategory | string;
  price: number;
  stock: number;
  minStock: number;
  unit: string;
  image: string;
  oil?: string; // 완제품에 포함되는 원유 정보 추가
  clientId?: string; // 소속 거래처 ID
  supplierId?: string; // 매입 거래처 ID
  freightType?: 's' | 'a' | 'b' | 'c' | 'd' | 'e'; // 박스 운임타입
  boxSize?: number; // 1박스당 개수 (완제품, 향미유 등)
  품목?: string; // 서류용 품목명 (예: 시골향참기름1)
  용량?: string; // 서류용 용량 (예: 1800ml, 1kg)
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
}


export type ViewType = 'dashboard' | 'orders' | 'shipping' | 'inventory' | 'clients' | 'ai-consultant' | 'pallets' | 'database' | 'hr' | 'notice' | 'leave-portal' | 'client-portal' | 'item-management' | 'confirmation-items' | 'officetalk' | 'documents';

export interface RawMaterialEntry {
  id: string;
  material: string;  // 원료명
  date: string;
  received: number;  // 입고량
  used: number;      // 사용량
  note: string;      // 비고
  createdAt: string;
}

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
