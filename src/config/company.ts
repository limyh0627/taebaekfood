/**
 * 회사 전용 초기 데이터 모음
 *
 * ─ 목적 ─
 * 다른 회사에 이 ERP를 납품할 때는 이 파일만 교체하면 됩니다.
 * App.tsx 나 컴포넌트 코드를 건드릴 필요가 없습니다.
 *
 * ─ 사용처 ─
 * App.tsx의 seedDatabase() 함수에서 Firebase 최초 업로드 시 1회만 사용합니다.
 * 이후에는 Firestore DB에 저장된 데이터를 사용하므로 이 파일은 참조되지 않습니다.
 */

import { Post, PalletStock, Employee, Product, Client, FileItem } from '../../types';

// ── 공지사항 초기 데이터 ──────────────────────────────────────────────────────
export const INITIAL_NOTICES: Post[] = [
  {
    id: 'n1',
    title: '2024년 상반기 향미유(참깨/들깨) 수급 안정화 공지',
    author: '구매팀',
    content: '최근 국산 참깨 작황 호조로 인해 매입 단가가 안정화되었습니다. 생산팀에서는 재고 확보에 유의해주시기 바랍니다.',
    date: '2024-03-28',
    tag: '공지',
  },
  {
    id: 'n2',
    title: '[필독] HACCP 정기 심사 대비 위생 점검',
    author: '품질관리',
    content: '다음 주 수요일 생산 라인 전체 위생 점검이 예정되어 있습니다. 복장 및 기록물 관리를 철저히 해주세요.',
    date: '2024-03-27',
    tag: '긴급',
  },
];

// ── 게시판 초기 데이터 ────────────────────────────────────────────────────────
export const INITIAL_BOARD_POSTS: Post[] = [
  {
    id: 'b1',
    title: '참기름 저온 압착 공정 최적화 매뉴얼',
    author: '생산기술',
    content: '벤조피렌 발생 억제를 위한 볶음 온도 200도 미만 유지 및 압착 압력 조절 가이드입니다.',
    date: '2024-03-15',
    tag: '매뉴얼',
  },
  {
    id: 'b2',
    title: '추석 선물세트 물량 예측 데이터 (2024)',
    author: '영업기획',
    content: '작년 대비 15% 성장 목표로 박스 및 쇼핑백 자재 선발주가 필요합니다.',
    date: '2024-03-12',
    tag: '업무',
  },
];

// ── 파일 목록 초기 데이터 ─────────────────────────────────────────────────────
export const INITIAL_FILES: FileItem[] = [
  { id: 'f1', name: '2024_상반기_제품_카탈로그.pdf', type: 'pdf', size: '5.4MB', date: '2024-03-20', uploader: '홍길동' },
  { id: 'f2', name: '자재_단가표_2024_03.xlsx', type: 'excel', size: '0.8MB', date: '2024-03-18', uploader: '김영희' },
];

// ── 파렛트 초기 데이터 ────────────────────────────────────────────────────────
export const INITIAL_PALLETS: PalletStock[] = [
  { id: 'pal1', name: '플라스틱 파렛트 (1100*1100)', total: 850, inUse: 310, damaged: 8 },
  { id: 'pal2', name: '목재 파렛트 (유럽 규격)', total: 300, inUse: 85, damaged: 24 },
];

// ── 직원 초기 데이터 ──────────────────────────────────────────────────────────
// ⚠️  비밀번호는 이곳에 평문으로 저장하지 마세요.
//     아래 데이터는 Firebase 최초 시딩용이며, 실제 비밀번호는 직원이 직접 변경해야 합니다.
export const INITIAL_EMPLOYEES: Employee[] = [
  {
    id: 'e1',
    name: '홍길동',
    username: 'admin',
    password: 'password',
    position: '과장',
    department: '생산관리팀',
    joinDate: '2022-01-10',
    status: 'working',
    phone: '010-1111-2222',
    annualLeave: { carryOverLeave: 2, bonusLeave: 0 },
    manualAdjustment: 0,
  },
  {
    id: 'e2',
    name: '김태백',
    username: 'tb01',
    password: '1234',
    position: '대리',
    department: '물류팀',
    joinDate: '2023-11-01',
    status: 'working',
    phone: '010-3333-4444',
    annualLeave: { carryOverLeave: 0, bonusLeave: 1 },
    manualAdjustment: 0,
  },
];

// ── 제품 초기 데이터 ──────────────────────────────────────────────────────────
export const INITIAL_PRODUCTS: Product[] = [
  {
    id: 'p1',
    name: '태백 저온참기름 (300ml)',
    category: '완제품',
    price: 18500,
    stock: 450,
    minStock: 100,
    unit: '개',
    image: '',
    submaterials: [
      { id: 'p7', name: '골드캡 마개', stock: 1, unit: '개', category: '마개' },
      { id: 'sub-01', name: '300ml 유리용기', stock: 1, unit: '개', category: '용기' },
      { id: 'sub-02', name: '참기름 전용 박스', stock: 1, unit: '개', category: '박스' },
    ],
  },
  {
    id: 'p2',
    name: '태백 전통들기름 (300ml)',
    category: '완제품',
    price: 16500,
    stock: 220,
    minStock: 80,
    unit: '개',
    image: '',
    submaterials: [
      { id: 'p7', name: '골드캡 마개', stock: 1, unit: '개', category: '마개' },
      { id: 'sub-01', name: '300ml 유리용기', stock: 1, unit: '개', category: '용기' },
      { id: 'sub-03', name: '들기름 전용 박스', stock: 1, unit: '개', category: '박스' },
    ],
  },
  { id: 'p3', name: '생들기름 (180ml)', category: '완제품', price: 14000, stock: 15, minStock: 50, unit: '개', image: '' },
  { id: 'p7', name: '골드캡 마개', category: '마개', price: 80, stock: 120, minStock: 1000, unit: '개', image: '' },
  { id: 'p8', name: '태백 로고 테이프', category: '테이프', price: 1200, stock: 45, minStock: 20, unit: '롤', image: '' },
  { id: 'sub-01', name: '300ml 유리용기', category: '용기', price: 450, stock: 1200, minStock: 500, unit: '개', image: '' },
  { id: 'sub-02', name: '참기름 전용 박스', category: '박스', price: 300, stock: 800, minStock: 200, unit: '개', image: '' },
  { id: 'sub-03', name: '들기름 전용 박스', category: '박스', price: 300, stock: 600, minStock: 200, unit: '개', image: '' },
  { id: 'gck-1', name: '고춧가루 1kg', category: '고춧가루', price: 0, stock: 0, minStock: 0, unit: '개', image: '', boxSize: 20 },
  { id: 'gck-5', name: '고춧가루 5kg', category: '고춧가루', price: 0, stock: 0, minStock: 0, unit: '개', image: '', boxSize: 4 },
];

// ── 거래처 초기 데이터 ────────────────────────────────────────────────────────
export const INITIAL_CLIENTS: Client[] = [
  { id: 'c1', name: '태백유통 강원본부', email: 'tb_gw@tb.com', phone: '033-111-2222', type: '일반', region: '강원', partnerType: '매출처' },
  { id: 'sup-1', name: '형제프라콘', email: '', phone: '', type: '일반', partnerType: '매입처' },
  { id: 'sup-2', name: '호계', email: '', phone: '', type: '일반', partnerType: '매입처' },
  { id: 'sup-3', name: '밝은디자인', email: '', phone: '', type: '일반', partnerType: '매입처' },
];

export const INITIAL_SUPPLIERS: Client[] = [];
