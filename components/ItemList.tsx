
import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Package,
  Edit,
  Box,
  ChevronRight,
  Grape,
  Cylinder,
  Disc,
  StickyNote,
  Inbox,
  X,
  ShoppingCart,
  ClipboardCheck,
  Trash2,
  Search,
  LayoutGrid,
  ListPlus,
  AlertCircle,
  Tag,
  Building2,
  RotateCcw,
  History,
  FileText,
  FileDown,
  Save,
  Share2,
  Factory,
  Plus,
  Layers,
} from 'lucide-react';
import { Item, InventoryCategory, AdjustmentRequest, AdjustmentType, RawMaterialEntry, IssuedStatement, PartnerItem } from '../types';
import { PurchaseOrder, poLines } from '../src/shared/types';
import { unpackComponent } from '../src/shared/orderUnits';
import AddItemModal from './AddItemModal';
import ConfirmModal from './ConfirmModal';
import PageHeader from './PageHeader';
import RawMaterialEntryModal from './RawMaterialEntryModal';
import RawMaterialLotPanel from './RawMaterialLotPanel';
import RawLedgerList from './RawLedgerList';
import OemManager from './OemManager';
import CategoryManager from './CategoryManager';
import { buildTaxonomy, TaxonomyRow } from '../src/shared/taxonomy';
import { RM_LIST, unitOf, baseRawName, lotStockInUnit, unitToKg, lotKgRemaining, parsePackageKg } from '../src/constants/formula';
import { isSubmaterial } from '../src/shared/types';
import { matchesSearch } from '../src/shared/hangul';
import { mutateRawMaterialLots, addItem, subscribeToCollection, fetchCollection } from '../src/shared/services/firebaseService';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../src/shared/firebase';
import { withCarryOverLot, buildReceiveLot, nextLotNo, deductFromLots, settleCarryOver } from '../src/shared/lotUtils';

const normCat = (cat: string): string =>
  ({ product: '완제품', goods: '상품', container: '용기', cap: '마개', tape: '테이프', box: '박스', label: '라벨' } as Record<string, string>)[cat] ?? cat;

// 품목명 뒤에 용량(spec) 표시 — 이름에 이미 용량 표기(예: "300ML-소주병", "고춧가루 1kg")가 있으면 중복 표시하지 않음
const hasVolumeInName = (name: string) => /\d+(\.\d+)?\s*(ml|kg|l|g)(?![a-z])/i.test(name);
const withSpec = (p: { name: string; spec?: string }): string => {
  const spec = (p.spec ?? '').trim();
  return spec && !hasVolumeInName(p.name) ? `${p.name}/${spec}` : p.name;
};

// 품목 추가 목록용 — 긴 슬래시 이름을 대표이름 + 구분요소(등급·용량·개입·거래처)로 분해해 배지로 보여준다.
const MAKE_GRADE_WORDS = ['특골드', '골드A', '특A', '골드', '원액', '특', '분', 'A'];
const parseMakeLabel = (p: { name: string; spec?: string }): { base: string; grade: string; size: string; pack: string; brand: string; container: string } => {
  let nm = p.name;
  const packM = nm.match(/\((\d+)\s*개입\)/);
  const pack = packM ? `${packM[1]}개입` : '';
  nm = nm.replace(/\(\s*\d+\s*개입\s*\)/g, '').trim();
  const sizeM = String(p.spec ?? '').match(/\d+(?:\.\d+)?\s*(?:ml|kg|l)\b/i) || nm.match(/\d+(?:\.\d+)?\s*(?:ml|kg|l)\b/i);
  const size = sizeM ? sizeM[0].replace(/\s+/g, '') : '';
  const toks = nm.split('/').map(s => s.trim()).filter(Boolean);
  const base = toks[0] ?? nm;
  let grade = '', brand = '';
  for (const raw of toks.slice(1)) {
    const t = raw.replace(/\(.*?\)/g, '').trim();                 // "(스마트)" 같은 부기 제거
    if (!t || t === '병') continue;
    if (/\d+(?:\.\d+)?\s*(?:ml|kg|l)\b/i.test(t)) continue;       // 용량 토큰은 size로 이미 뽑음
    if (!grade && (MAKE_GRADE_WORDS.includes(t) || /골드|원액/.test(t))) grade = t;
    else if (!brand) brand = t;
  }
  // 용기 타입 — 180/300/350ml=병, 1500/1750/1800ml=페트, 16.5kg(캔) 등은 표시 안 함
  const sizeNum = parseFloat(size);
  const container = (/kg/i.test(size) || !sizeNum) ? '' : sizeNum <= 350 ? '병' : sizeNum >= 1500 ? '페트' : '';
  return { base, grade, size, pack, brand, container };
};

// 낱개 밑에 박스 품목을 붙여 정렬 — 박스(unpackComponent)의 낱개가 목록에 있으면 그 아래로.
// 낱개가 목록에 없는 박스(orphan)는 단독으로 둔다.
const groupLooseBoxRows = (arr: Item[]): { p: Item; isChild: boolean }[] => {
  const inList = new Set(arr.map(p => p.id));
  const boxByParent = new Map<string, Item[]>();
  const looseOrOrphan: Item[] = [];
  for (const p of arr) {
    const uc = unpackComponent(p);
    if (uc && inList.has(uc.itemId)) {
      if (!boxByParent.has(uc.itemId)) boxByParent.set(uc.itemId, []);
      boxByParent.get(uc.itemId)!.push(p);
    } else {
      looseOrOrphan.push(p);
    }
  }
  const out: { p: Item; isChild: boolean }[] = [];
  for (const p of looseOrOrphan) {
    out.push({ p, isChild: false });
    for (const b of (boxByParent.get(p.id) ?? [])) out.push({ p: b, isChild: true });
  }
  return out;
};

// 검색어 → 토큰들. '+'로 AND, 각 키워드는 한글↔영숫자 경계에서 쪼갠다(예: "참A" → ["참","A"]).
// 초성열(ㄱ~ㅎ)은 통째로 남겨 초성 검색을 유지. 각 토큰은 모두 매칭돼야 한다(AND).
const parseSearchTokens = (kw: string): string[] =>
  (kw ?? '').split('+').flatMap(seg => seg.match(/[가-힣ㄱ-ㅎ]+|[a-zA-Z0-9]+/g) ?? []);

// 재고 마감(재고 현황판) — 완제품 실물 카운트 스냅샷
interface StockClosingRow { itemId: string; name: string; spec?: string; boxSize: number; boxes: number; loose: number; total: number; }
interface StockClosing { id: string; date: string; closedBy: string; createdAt: string; items: StockClosingRow[]; totalStock: number; }

const inferSubtype = (item: { subtype?: string; name: string; category: string }): string => {
  if (item.subtype) return item.subtype;
  const n = item.name;
  if (n.includes('들기름')) return '들기름';
  if (n.includes('참기름')) return '참기름';
  if (n.includes('검정깨') || n.includes('검정참깨')) return '검정깨';
  if (n.includes('들깨')) return '들깨';
  if (n.includes('참깨')) return '참깨';
  if (n.includes('고춧가루')) return '고춧가루';
  if (n.includes('향미유')) return '향미유';
  return normCat(item.category);
};

interface ItemListProps {
  items: Item[];
  orderRequests: PurchaseOrder[];
  confirmedOrders: PurchaseOrder[];
  // 작업완료(생산됨·미출고) 주문분 — 품목별 수량. 재고 현황 모달의 '작업완료 vs 재고' 쪼개기용.
  dispatchedQtyByItem?: Record<string, number>;
  onUpdateItem: (product: Item) => void;
  onAddItem: (product: Item) => void;
  onAddOrderRequest: (id: string, qty: number, isBox?: boolean) => void;
  onRemoveOrderRequest: (id: string) => void;
  onUpdateOrderRequestQty: (id: string, qty: number) => void;
  onUpdatePoItemQty?: (poId: string, index: number, qty: number) => void;
  onRemovePoItem?: (poId: string, index: number) => void;
  // 입고대기 수정 → 연결된 매입전표 수정 요청 (관리자 확인사항으로)
  onRequestPoEdit?: (poId: string, newLines: { itemId: string; quantity: number }[], reason: string) => void;
  onUpdateOrderRequestIsBox?: (id: string, isBox: boolean) => void;
  onToggleConfirmRequestQty: (id: string) => void;
  onConfirmRequest: (id: string) => void;
  onConfirmRequests: (ids: string[]) => void;
  onBulkAddConfirmedOrders: (items: { id: string, quantity: number, isBox?: boolean }[]) => void;
  onConfirmAllRequests: () => Promise<void>;
  onFinishConfirmedOrder: (id: string) => void;
  onFinishConfirmedOrders: (ids: string[]) => void;
  onFinishAllConfirmedOrders: () => void;
  onUpdateConfirmedQty: (id: string, qty: number) => void;
  onRemoveConfirmedOrder: (id: string) => void;
  onClearAllConfirmedOrders: () => void;
  onEditProduct: (product: Item) => void;
  onDeleteItem: (id: string) => void;
  onAddAdjustmentRequest: (req: AdjustmentRequest) => void;
  inboundPartners: { id: string; name: string }[];
  partners?: { id: string; name: string; partnerType?: string }[];
  partnerItems?: PartnerItem[];
  rawMaterialLedger: RawMaterialEntry[];
  onRequestPurchaseInvoice?: (partnerId: string, partnerName: string, items: Array<{ name: string; spec: string; qty: number; price: number; isBox?: boolean }>) => void;
  issuedStatements?: IssuedStatement[];
  autoUsageEntries?: Array<{ material: string; date: string; used: number; note: string }>;
  onAddRawMaterialEntry: (entry: RawMaterialEntry) => void;
  onDeleteRawMaterialEntry: (id: string) => void;
  onLedgerChanged?: () => void;   // 원장 쓰기 후 상위(AdminApp) 재조회 트리거
  currentUser?: { name: string; id: string } | null;
  isAdmin?: boolean;
  onUpdateSubmaterial?: (id: string, data: Partial<Item>) => void;
  receivedOrders?: PurchaseOrder[];
  inboundContent?: React.ReactNode;
  inboundBadge?: number;
  returnContent?: React.ReactNode;
  returnBadge?: number;
  // 임가공(OEM) — 발주는 입고대기에, 이력은 입고이력에 함께 표시된다(별도 목록 없음)
  oemEnabled?: boolean;
  rawStockKg?: (material: string) => number;
  onOemIssue?: (input: { oemPartnerId: string; partnerName: string; sent: { material: string; kg: number }[]; date: string; note?: string }) => Promise<void>;
  onOemReceive?: (input: { po: PurchaseOrder; returns: { itemId: string; qty: number }[]; unitPricePerKg: number; date: string }) => Promise<void>;
  onOemIssueFee?: (input: { po: PurchaseOrder; unitPricePerKg: number; date: string }) => Promise<void>;
}


const CLIENT_BADGE_COLORS = [
  'bg-violet-50 text-violet-600',
  'bg-emerald-50 text-emerald-600',
  'bg-sky-50 text-sky-600',
  'bg-amber-50 text-amber-600',
  'bg-rose-50 text-rose-500',
  'bg-teal-50 text-teal-600',
  'bg-orange-50 text-orange-500',
  'bg-indigo-50 text-indigo-500',
];
type MainTab = 'requests' | 'history' | 'master' | 'inbound' | 'lots';
type InboundSubTab = '입고' | '반품';
type TopTab = 'finished' | 'goods' | 'submaterial' | 'rawmaterial' | 'wip';

// 원료 로트 홀더 판별 — raw, 또는 wip 벌크 반제품(볶음참깨·볶음들깨·볶음검정참깨·들깨가루(고운)).
//   단 wip이라도 unit이 '개'인 캔/포장 SKU(예: 깨분참기름/16.5kg)는 홀더가 아님.
const isRawHolder = (p: any): boolean => p?.category === 'raw' || (p?.category === 'wip' && p?.unit !== '개');

// #2 원료 단일 소스: 표시용 재고 — 원료 홀더이고 로트가 있으면 로트 합계(운영단위=기름 L),
//   그 외(로트 없는 원료 예: 깻묵, 또는 완제품/상품/부자재)는 stock 필드 사용.
const displayStockOf = (p: any): number =>
  (isRawHolder(p) && (p?.lots ?? []).length > 0)
    ? lotStockInUnit(p.lots, baseRawName(p.name))
    : (p?.stock ?? 0);

const ItemList: React.FC<ItemListProps> = ({
  items,
  orderRequests,
  confirmedOrders,
  dispatchedQtyByItem = {},
  onAddItem,
  onUpdateItem,
  onAddOrderRequest,
  onRemoveOrderRequest,
  onUpdateOrderRequestQty,
  onUpdatePoItemQty,
  onRemovePoItem,
  onRequestPoEdit,
  onUpdateOrderRequestIsBox,
  onBulkAddConfirmedOrders,
  onConfirmAllRequests,
  onFinishConfirmedOrder,
  onUpdateConfirmedQty,
  onRemoveConfirmedOrder,
  onClearAllConfirmedOrders,
  onEditProduct,
  onDeleteItem,
  onAddAdjustmentRequest,
  inboundPartners,
  partners = [],
  rawMaterialLedger,
  onRequestPurchaseInvoice,
  issuedStatements = [],
  autoUsageEntries = [],
  onAddRawMaterialEntry,
  onLedgerChanged,
  onDeleteRawMaterialEntry,
  currentUser,
  isAdmin = false,
  onUpdateSubmaterial,
  receivedOrders = [],
  partnerItems = [],
  inboundContent,
  inboundBadge = 0,
  returnContent,
  returnBadge = 0,
  oemEnabled = false,
  rawStockKg,
  onOemIssue,
  onOemReceive,
  onOemIssueFee,
}) => {
  const psMap = useMemo(() => new Map(partnerItems.filter(pi => pi.Direction === 'in').map(pi => [pi.itemId, pi.partnerId])), [partnerItems]);
  // 품목 → 매출처 이름들(공백연결). 재고 현황 거래처 검색용. Direction='out' + 품목의 partnerIds 둘 다.
  const salesPartnerNames = useMemo(() => {
    const nameById = new Map(partners.map(c => [c.id, c.name]));
    const m = new Map<string, string>();
    const add = (itemId: string, cid?: string) => {
      const nm = cid ? nameById.get(cid) : undefined;
      if (!itemId || !nm) return;
      m.set(itemId, m.has(itemId) ? `${m.get(itemId)} ${nm}` : nm);
    };
    for (const pi of partnerItems) if (pi.Direction === 'out') add(pi.itemId, pi.partnerId);
    for (const p of items) for (const cid of (p.partnerIds ?? [])) add(p.id, cid);
    return m;
  }, [partnerItems, partners, items]);
  const fmtHamiyou = (stock: number) => {
    const boxes = Math.floor(stock / 12);
    const rem = stock % 12;
    if (rem === 0) return `${boxes}B(${stock}개)`;
    return `${boxes}B+${rem}개(${stock}개)`;
  };

  const [showClosingModal, setShowClosingModal] = useState(false);
  const closingRef = useRef<HTMLDivElement>(null);
  // 재고 현황 — 재고 마감·만들기를 하나로 합친 편집 화면(showClosingModal)

  // ── 재고 마감(완제품 실물 카운트) ──
  const [closingCounts, setClosingCounts] = useState<Record<string, { boxes: string; loose: string }>>({});
  const [showAllClosing, setShowAllClosing] = useState(false); // 재고 0 완제품도 보기(만들기용)
  const [editClosingId, setEditClosingId] = useState<string | null>(null); // 실사 수정 중인 품목
  const [editClosingQty, setEditClosingQty] = useState('');
  const [closingDate, setClosingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [closingSaving, setClosingSaving] = useState(false);
  const [closingSavedAt, setClosingSavedAt] = useState('');
  const [pastClosings, setPastClosings] = useState<StockClosing[]>([]);
  const [showClosingHistory, setShowClosingHistory] = useState(false);
  const [viewingClosing, setViewingClosing] = useState<StockClosing | null>(null);
  const [closingSearch, setClosingSearch] = useState('');
  const [closingPage, setClosingPage] = useState(0);
  // 재고 현황 모달 필터 — 구분(전체/작업완료/재고) + 분류(전체/참기름/들기름/가루)
  // 기본값 '재고' — 작업완료(주문에 물린 분)를 뺀 실제 가용 재고가 평소 보고 세는 숫자라서.
  const [closingView, setClosingView] = useState<'all' | 'dispatched' | 'stock'>('stock');
  const [closingCat, setClosingCat] = useState<'all' | '참기름' | '들기름' | '기타'>('all');
  const CLOSING_PAGE_SIZE = 8;

  const boxSizeOf = (p: Item) => (p as any).defaultBoxConfig?.unitsPerBox || (p as any).boxSize || 12;
  // 전체 완제품(검색 대상)
  const allClosingItems = useMemo(
    () => items.filter(p => !p.archived && normCat(p.category) === '완제품'),
    [items],
  );
  // 저장/표시 대상: 재고 있는 것 + 사용자가 수량을 입력한 것 (재고 0은 기본 숨김, 검색으로 찾아 입력 가능)
  const closingItems = useMemo(
    () => allClosingItems.filter(p => (p.stock || 0) > 0 || !!(closingCounts[p.id]?.boxes || closingCounts[p.id]?.loose)),
    [allClosingItems, closingCounts],
  );

  useEffect(() => subscribeToCollection<StockClosing>('stockClosings', setPastClosings), []);

  // 마감 모달 열 때: 초기화 + 앱 계산 재고로 미리 채움(직원은 실물과 다른 것만 수정)
  useEffect(() => {
    if (!showClosingModal) return;
    setViewingClosing(null);
    setClosingSavedAt('');
    setClosingSearch('');
    setClosingPage(0);
    setShowAllClosing(false);
    setClosingView('all');
    setClosingCat('all');
    setEditClosingId(null);
    setEditClosingQty('');
    setClosingCounts({});
  }, [showClosingModal]); // eslint-disable-line react-hooks/exhaustive-deps

  const setCount = (id: string, field: 'boxes' | 'loose', v: string) => {
    const val = v.replace(/[^\d]/g, '');
    setClosingCounts(prev => ({ ...prev, [id]: { boxes: prev[id]?.boxes ?? '', loose: prev[id]?.loose ?? '', [field]: val } }));
  };
  const closingTotalOf = (id: string) => {
    const p = allClosingItems.find(x => x.id === id);
    if (!p) return 0;
    const bsz = boxSizeOf(p);
    return (parseInt(closingCounts[id]?.boxes || '0') || 0) * bsz + (parseInt(closingCounts[id]?.loose || '0') || 0);
  };

  // 숨김 보드(closingRef)를 PNG blob으로 캡처 — 공유·문서함 업로드 공용
  const captureClosingBlob = async (): Promise<Blob | null> => {
    if (!closingRef.current) return null;
    const { default: html2canvas } = await import('html2canvas') as any;
    const canvas = await html2canvas(closingRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    return await new Promise<Blob | null>(res => canvas.toBlob((b: Blob | null) => res(b), 'image/png'));
  };

  // 문서함 대분류/중분류 보장 (없으면 생성)
  const ensureCabinetPath = async (cat: string, sub: string) => {
    const cats = await fetchCollection<{ id: string; name: string }>('fileCabinetCategories');
    if (!cats.some(c => c.name === cat)) await addItem('fileCabinetCategories', { name: cat, order: cats.length, createdAt: new Date().toISOString() });
    const subs = await fetchCollection<{ id: string; category: string; name: string }>('fileCabinetSubCategories');
    if (!subs.some(s => s.category === cat && s.name === sub)) {
      await addItem('fileCabinetSubCategories', { category: cat, name: sub, order: subs.filter(s => s.category === cat).length, createdAt: new Date().toISOString() });
    }
  };

  // 입력한(값 넣은) 품목만 대상 — 안 건드린 품목은 그대로 둔다
  const touchedClosingItems = () => closingItems.filter(p => (closingCounts[p.id]?.boxes || closingCounts[p.id]?.loose));
  const enteredQtyOf = (p: Item) => {
    const bsz = boxSizeOf(p);
    const boxes = parseInt(closingCounts[p.id]?.boxes || '0') || 0;
    const loose = parseInt(closingCounts[p.id]?.loose || '0') || 0;
    return boxes * bsz + loose;
  };
  // 실사 반영 — 입력값을 재고로 SET(맞춤)
  const saveClosing = async () => {
    const targets = touchedClosingItems();
    if (!targets.length) { alert('수량을 입력한 품목이 없습니다.'); return; }
    if (!window.confirm(`입력한 수량으로 재고를 맞출까요? (실사 조정 · ${targets.length}개 품목)`)) return;
    setClosingSaving(true);
    try {
      await Promise.all(targets.map(p => onUpdateItem({ ...p, stock: enteredQtyOf(p) })));
      setShowClosingModal(false);
    } catch (e) {
      alert('재고 반영 실패: ' + ((e as any)?.message ?? ''));
    } finally {
      setClosingSaving(false);
    }
  };
  // 만들기 — 입력값만큼 재고에 ADD(생산분 추가)
  const makeStock = async () => {
    const targets = touchedClosingItems();
    if (!targets.length) { alert('수량을 입력한 품목이 없습니다.'); return; }
    if (!window.confirm(`입력한 수량만큼 재고를 추가할까요? (만들기 · ${targets.length}개 품목)`)) return;
    setClosingSaving(true);
    try {
      await Promise.all(targets.map(p => onUpdateItem({ ...p, stock: (p.stock ?? 0) + enteredQtyOf(p) })));
      setShowClosingModal(false);
    } catch (e) {
      alert('재고 추가 실패: ' + ((e as any)?.message ?? ''));
    } finally {
      setClosingSaving(false);
    }
  };
  // 실사 수정 — 선택 품목의 재고를 입력값으로 SET(맞춤)
  const applyEditClosing = async () => {
    if (!editClosingId) return;
    const p = items.find(x => x.id === editClosingId);
    if (!p) return;
    const q = parseInt(editClosingQty || '', 10);
    if (isNaN(q) || q < 0) { alert('수량을 입력하세요.'); return; }
    setClosingSaving(true);
    try {
      await onUpdateItem({ ...p, stock: q });
      setEditClosingId(null); setEditClosingQty('');
    } catch (e) {
      alert('반영 실패: ' + ((e as any)?.message ?? ''));
    } finally { setClosingSaving(false); }
  };
  // 품목 추가하기 — 만들기 모달(검색·수량·확정으로 재고 ADD) 열기
  const openMakeModal = () => { setMakeQty({}); setMakeSearch(''); setMakeCat('참기름'); setMakeVessel(''); setMakeGrade(''); setIsAddModalOpen(true); };

  const shareClosingImage = async () => {
    try {
      const blob = await captureClosingBlob();
      if (!blob) return;
      const file = new File([blob], `재고현황_${viewingClosing?.date || closingDate}.png`, { type: 'image/png' });
      const nav = navigator as any;
      if (nav.canShare && nav.canShare({ files: [file] })) {
        try { await nav.share({ files: [file], title: `재고 현황 ${viewingClosing?.date || closingDate}` }); return; } catch { /* 취소 시 다운로드로 폴백 */ }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = file.name; a.click();
      URL.revokeObjectURL(url);
    } catch { /* noop */ }
  };

  const [topTab, setTopTab] = useState<TopTab>('finished');
  const [activeTab, setActiveTab] = useState<MainTab>('master');
  const [inboundSubTab, setInboundSubTab] = useState<InboundSubTab>('입고');
  const [showInboundOverlay, setShowInboundOverlay] = useState(false);
  const [showReturnOverlay, setShowReturnOverlay] = useState(false);
  // 임가공(OEM) 모달 — 목록은 입고대기·입고이력에 녹아 있고 여기선 모달만 연다
  const [oemIssueOpen, setOemIssueOpen] = useState(false);
  const [oemReceiveTarget, setOemReceiveTarget] = useState<PurchaseOrder | null>(null);
  const [oemFeeTarget, setOemFeeTarget] = useState<PurchaseOrder | null>(null);
  const closeOem = () => { setOemIssueOpen(false); setOemReceiveTarget(null); setOemFeeTarget(null); };
  // 원료재고 입고/사용 기록 모달
  const [rawEntryModal, setRawEntryModal] = useState<{ mode: 'inbound' | 'usage' } | null>(null);
  // 저장 완료 토스트 (원료 입출고 기록 등)
  const [toast, setToast] = useState<{ message: string } | null>(null);
  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);
  const [historyMonth, setHistoryMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [historyPage, setHistoryPage] = useState(1); // 입고이력 페이지네이션
  const [ledgerMaterialFilter, setLedgerMaterialFilter] = useState<string>('전체'); // 원료 입출고 기록 필터
  const [ledgerPeriod, setLedgerPeriod] = useState<string>('1m'); // 입출고 기록 기간: '1m'(최근 1개월)|'all'(전체)|'YYYY-MM'(월별)
  const [activeCategory, setActiveCategory] = useState<string>('전체');
  const [activeSupplierId, setActiveSupplierId] = useState<string>('전체');
  const [showCategoryFilter, setShowCategoryFilter] = useState(false);
  const [showSupplierFilter, setShowSupplierFilter] = useState(false);

  // 볶음참깨 규격별 재고 편집 상태: { [itemId]: { [variantKey]: number } }
  const [editingVariantStocks, setEditingVariantStocks] = useState<Record<string, Record<string, number>>>({});

  const [searchTerm, setSearchTerm] = useState('');
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [draftOrders, setDraftOrders] = useState<{ id: string, quantity: number }[]>([]);
  const [editingStockId, setEditingStockId] = useState<string | null>(null);
  const [editingStockVal, setEditingStockVal] = useState<string>('');
  // 재고 현황 모달 전용 편집 상태 — 마스터 목록(editingStockId)과 공유하면 안 된다.
  //   같은 품목이 모달 뒤 목록에도 렌더되면 autoFocus 입력이 둘 생기고, 포커스를 뺏긴 쪽 onBlur가
  //   즉시 편집을 닫아버려서 "눌러도 아무 반응 없음"이 된다(뒤 목록에 걸린 품목만 증상).
  const [editingClosingId, setEditingClosingId] = useState<string | null>(null);
  const [editingClosingVal, setEditingClosingVal] = useState<string>('');
  const [rowEditProduct, setRowEditProduct] = useState<Item | null>(null);
  const [rowEditForm, setRowEditForm] = useState<Partial<Item>>({});

  React.useEffect(() => {
    if (!rowEditProduct) return;
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setRowEditProduct(null); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [rowEditProduct]);
  
  const [expandedReqId, setExpandedReqId] = useState<string | null>(null);
  const [reqEditQty, setReqEditQty] = useState<number>(0);
  // 발주예정 수량 인라인 편집: key = `${poId}-${lineIdx}`
  const [editingReqLine, setEditingReqLine] = useState<string | null>(null);
  const [editingReqVal, setEditingReqVal] = useState<string>('');
  // 입고대기 수정(전표수정 요청) 모달
  const [poEditModal, setPoEditModal] = useState<{ po: PurchaseOrder; rows: { itemId: string; name: string; qty: string }[]; reason: string } | null>(null);
  const [reqNote, setReqNote] = useState<string>('');
  const [inlineCartId, setInlineCartId] = useState<string | null>(null);
  const [inlineCartQty, setInlineCartQty] = useState<number>(0);
  const [inlineCartIsBox, setInlineCartIsBox] = useState<boolean>(false);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set()); // 낱개 밑 박스 접기
  // 로트 탭 — 원료 홀더별 로트/수불부 확인 전용
  const [lotSearch, setLotSearch] = useState('');
  const [lotExpandedId, setLotExpandedId] = useState<string | null>(null);
  // 재고관리는 직원 메뉴 단일뷰 — 품목 메타(이름·분류·단위) 편집은 품목관리에서만. 여기선 실사조정만.
  const productEditable = false;
  const [expandedClientRowId, setExpandedClientRowId] = useState<string | null>(null);
  const [activeSubtype, setActiveSubtype] = useState<string>('전체');   // 낱개/배송/선물세트
  const [stockOnly, setStockOnly] = useState(false);
  const [zeroStockOnly, setZeroStockOnly] = useState(false);
  const [priorityClientId] = useState<string | null>(null);
  // cart는 로컬 상태 (Firebase 쓰기는 확정 버튼 시에만)
  const [cart, setCart] = useState<{ id: string; qty: number; isBox: boolean }[]>([]);
  const [showCartPanel, setShowCartPanel] = useState(false);
  const [showCartModal, setShowCartModal] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmedChecked, setConfirmedChecked] = useState<Set<string>>(new Set());
  const [showConfirmedModal, setShowConfirmedModal] = useState(false);

  // partner_item Direction='in' 매핑 있는 품목만 발주 가능
  const purchasableIds = useMemo(() =>
    new Set(partnerItems.filter(pi => pi.Direction === 'in').map(pi => pi.itemId).filter(Boolean)),
    [partnerItems]
  );

  const stockEditCancelled = useRef(false); // 재고 편집 취소(ESC) 여부 — blur 중복 커밋 방지
  const closingEditCancelled = useRef(false); // 재고 현황 모달 편집 취소(ESC) 여부
  const addToCart = (itemId: string, defaultQty: number, isBox?: boolean) => {
    if (!cart.some(c => c.id === itemId)) {
      setCart(prev => [...prev, { id: itemId, qty: defaultQty, isBox: isBox ?? false }]);
    }
  };
  const removeFromCart = (id: string) => setCart(prev => prev.filter(c => c.id !== id));
  const updateCartQty = (id: string, qty: number) => setCart(prev => prev.map(c => c.id === id ? { ...c, qty: Math.max(1, qty) } : c));
  const updateCartIsBox = (id: string, isBox: boolean) => setCart(prev => prev.map(c => c.id === id ? { ...c, isBox } : c));
  const submitCart = async () => {
    await onBulkAddConfirmedOrders(cart.map(c => ({ id: c.id, quantity: c.qty, isBox: c.isBox })));
    setCart([]);
    setShowCartPanel(false);
    setActiveTab('inbound');
  };

  // 재고 수정 커밋. 원료(raw)는 직접 덮어쓰지 않고 '실사조정'으로 로트를 목표값에 맞춤(+수불부 기록).
  // (원료 stock은 로트 합계가 기준이라 직접 덮어쓰면 다음 로트연산에 사라지므로 반드시 로트로 조정)
  // addStockUnits: val을 재고단위로 환산한 뒤 더할 수량. 재고 현황 '재고' 뷰에서 작업완료분을 뺀 값을
  //   실사 입력받을 때, 저장되는 stock은 (입력값 + 작업완료분)이어야 전체 뷰 숫자와 맞아서 쓴다.
  const commitStockEdit = async (product: Item, val: number, addStockUnits = 0) => {
    if (isNaN(val) || val < 0) return;
    if (isRawHolder(product)) {
      const material = baseRawName(product.name);
      const unitLabel = product.unit ?? (unitOf(material) === 'L' ? 'L' : 'kg');
      if (!confirm(`${product.name} 재고를 ${val}${unitLabel}로 맞출까요?\n현재 로트 합계와의 차이가 '실사조정'으로 로트·수불부에 기록됩니다.`)) return;
      const targetKg = unitToKg(val, material);
      let adjustKg = 0;
      await mutateRawMaterialLots(
        product.id,
        (lots, stock) => {
          const withCarry = withCarryOverLot(lots, stock, material);
          adjustKg = Math.round((targetKg - lotKgRemaining(withCarry)) * 1000) / 1000;
          if (adjustKg > 0.001) {
            const lot = buildReceiveLot({ material, supplierName: '실사조정', qtyIn: 0, kgIn: adjustKg, receivedDate: new Date().toISOString().slice(0, 10) });
            return settleCarryOver([...withCarry, { ...lot, lotNo: nextLotNo(withCarry, lot.receivedDate) }]);
          }
          if (adjustKg < -0.001) return deductFromLots(withCarry, -adjustKg).lots;
          return withCarry;
        },
        (lots) => lotStockInUnit(lots, material),
      );
      if (Math.abs(adjustKg) > 0.001) {
        // type:'correction'이면 AdminApp 수율 자동입고/파생행에서 제외됨 (실사조정이 다른 품목 수율을 트리거하지 않음)
        onAddRawMaterialEntry({
          id: `rm-stocktake-${Date.now()}`,
          material, date: new Date().toISOString().slice(0, 10),
          received: adjustKg > 0 ? adjustKg : 0,
          used: adjustKg < 0 ? -adjustKg : 0,
          note: '재고실사정정',
          createdAt: new Date().toISOString(),
          type: 'correction', unit: 'kg',
          targetKg, // 실사 절대값(kg) — 수불부 잔량이 이 값으로 리셋(과거 장부 오차와 무관하게 실물 기준)
        } as RawMaterialEntry);
        setToast({ message: `${product.name} 실사조정 ${adjustKg > 0 ? '+' : ''}${Math.round(adjustKg * 10) / 10}kg 반영` });
      }
    } else {
      const units = product.subtype === '향미유' ? val * 12 : val;
      onUpdateItem({ ...product, stock: Math.round((units + addStockUnits) * 1000) / 1000 });
    }
  };

  // 박스 개봉 — 완사입 박스 1개를 까서 낱개 재고로 전환 (예: 볶음참깨 10kg박스 −1 → 낱개 +10)
  const unpackBox = (product: Item) => {
    const map = product.unpackTo;
    if (!map) return;
    const target = items.find(i => i.id === map.itemId);
    if (!target) { alert('개봉 대상 품목을 찾을 수 없습니다.'); return; }
    if ((product.stock ?? 0) < 1) { alert('개봉할 박스 재고가 없습니다.'); return; }
    if (!confirm(`${product.name} 1박스를 개봉해 "${target.name}" ${map.count}개로 전환할까요?\n(${product.name} −1, ${target.name} +${map.count})`)) return;
    onUpdateItem({ ...product, stock: (product.stock ?? 0) - 1 });
    onUpdateItem({ ...target, stock: (target.stock ?? 0) + map.count });
    setToast({ message: `${product.name} −1박스 → ${target.name} +${map.count}개` });
  };

  const [confirmModal, setConfirmModal] = useState<{ message: string; subMessage?: string; onConfirm: () => void } | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // 분류 체계 — 이름·하위 분류는 사용자가 정한다(itemTaxonomy). 저장본이 없으면 기본값.
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [taxonomyRows, setTaxonomyRows] = useState<TaxonomyRow[]>([]);
  useEffect(() => { fetchCollection<TaxonomyRow>('itemTaxonomy').then(setTaxonomyRows).catch(() => {}); }, []);
  const taxo = useMemo(() => buildTaxonomy(taxonomyRows), [taxonomyRows]);
  // 분류를 쓰는 품목 수 — 지울 때 경고에 쓴다
  const taxonomyUsage = useMemo(() => {
    const u: Record<string, number> = {};
    for (const p of items) {
      if (p.archived) continue;
      const t = p.category, sub = (p as any).subtype2, cat = p.subtype;
      u[`type:${t}`] = (u[`type:${t}`] ?? 0) + 1;
      if (sub) u[`sub:${t}:${sub}`] = (u[`sub:${t}:${sub}`] ?? 0) + 1;
      if (cat) u[`cat:${t}:${cat}`] = (u[`cat:${t}:${cat}`] ?? 0) + 1;
    }
    return u;
  }, [items]);
  // 재고 만들기 — 품목을 골라 만든 수량만큼 재고를 더한다(제조·생산분 반영).
  //   원료(raw)는 대상 아님 — 원료는 입고/실사조정으로만 움직인다.
  const [makeQty, setMakeQty] = useState<Record<string, string>>({});
  const [makeSearch, setMakeSearch] = useState('');
  const [makeBusy, setMakeBusy] = useState(false);
  const [makeCat, setMakeCat] = useState<string>('참기름');
  const [makeVessel, setMakeVessel] = useState('');   // 품목추가 용기 필터(180/300/350/1750/1800)
  const [makeGrade, setMakeGrade] = useState('');     // 품목추가 등급 필터(골드/A/분/특A)
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 24;

  const productMap = useMemo(() => new Map(items.map(p => [p.id, p])), [items]);
  const inboundPartnerMap = useMemo(() => new Map(inboundPartners.map(s => [s.id, s])), [inboundPartners]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    cart.forEach(c => {
      const product = items.find(p => p.id === c.id);
      if (product) {
        // 탭이 subtype 기준이라 둘 다 센다
        for (const k of new Set([normCat(product.category), product.subtype].filter(Boolean) as string[])) {
          counts[k] = (counts[k] || 0) + 1;
        }
      }
    });
    return counts;
  }, [cart, items]);

  const [adjustmentModal, setAdjustmentModal] = useState<{
    isOpen: boolean;
    itemId: string;
    itemName: string;
    originalQuantity: number;
    type: AdjustmentType;
  } | null>(null);
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [adjustmentQty, setAdjustmentQty] = useState<number>(0);

  // 품목별 필터 탭 — 분류 관리에서 정한 하위 분류를 그대로 따라간다(추가하면 여기 바로 뜬다)
  const SUB_ICONS: Record<string, any> = {
    용기: Cylinder, 마개: Disc, 테이프: StickyNote, 박스: Inbox, 라벨: Tag, 향미유: Grape,
  };
  // 지금 탭이 어느 타입인가 — 서브타입·카테고리 필터를 여기서 뽑는다
  const tabTypeKey = topTab === 'finished' ? 'product'
    : topTab === 'goods' ? 'goods'
    : topTab === 'wip' ? 'wip'
    : topTab === 'rawmaterial' ? 'raw' : 'submaterial';
  const subCategories = useMemo(
    () => taxo.categoriesOf(tabTypeKey).map(s => ({ id: s, label: s, icon: SUB_ICONS[s] ?? Tag })),
    [taxo, tabTypeKey],
  );
  const subtypeTabs = useMemo(() => taxo.subtypesOf(tabTypeKey), [taxo, tabTypeKey]);

  const filteredProducts = useMemo(() => {
    let result: Item[] = [];
    if (activeTab === 'requests') {
      result = items.filter(p => !p.archived && orderRequests.some(r => (r.itemId ?? r.id) === p.id));
    } else if (activeTab === 'history') {
      result = items.filter(p => !p.archived && confirmedOrders.some(c => (c.itemId ?? c.id) === p.id));
    } else {
      result = items.filter(p => !p.archived);
    }
    // 탭별 분리 — 최소수량 미만 필터 활성화 시 전체 품목 대상
    if (!zeroStockOnly) {
      if (topTab === 'finished') {
        result = result.filter(p => normCat(p.category) === '완제품');
      } else if (topTab === 'goods') {
        result = result.filter(p => normCat(p.category) === '상품' || normCat(p.category) === '향미유' || normCat(p.category) === '고춧가루');
      } else if (topTab === 'wip') {
        result = result.filter(p => p.category === 'wip');
      } else if (topTab === 'submaterial') {
        result = result.filter(p => p.category === 'submaterial' || ['label','cap','container','box','tape','용기','마개','테이프','박스','라벨'].includes(p.category as string));
      } else if (topTab === 'rawmaterial') {
        result = result.filter(p => p.category === 'raw');
      }
      if (activeSubtype !== '전체') {
        result = result.filter(p => (p.subtype2 ?? '') === activeSubtype);
      }
      if (activeCategory !== '전체') {
        // 카테고리(=DB subtype) 우선 — 옛 데이터는 타입 자리에 '박스'/'라벨'이 들어있어 둘 다 본다
        const hit = (p: Item) => (p.subtype ?? '') === activeCategory || normCat(p.category) === activeCategory;
        if (activeCategory === '박스') result = result.filter(p => hit(p) || p.id.startsWith('GS-'));
        else result = result.filter(hit);
      }
      if (activeSupplierId !== '전체') {
        result = result.filter(p => psMap.get(p.id) === activeSupplierId);
      }
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      result = result.filter(p => {
        if (p.name.toLowerCase().includes(q)) return true;
        if ((p.spec ?? '').toLowerCase().includes(q)) return true;
        const inboundPartnerName = inboundPartners.find(s => s.id === psMap.get(p.id))?.name || '';
        if (inboundPartnerName.toLowerCase().includes(q)) return true;
        const hasPartnerMatch = (p.partnerIds ?? []).some(cid => partners.find(c => c.id === cid)?.name.toLowerCase().includes(q));
        return hasPartnerMatch;
      });
    }
    if (stockOnly) {
      result = result.filter(p => displayStockOf(p) > 0);
    }
    if (zeroStockOnly) {
      result = result.filter(p => normCat(p.category) !== '완제품' && displayStockOf(p) < p.minStock);
    }

    const CATEGORY_ORDER = ['완제품', '상품', '향미유', '고춧가루', '용기', '마개', '테이프', '박스', '라벨'];
    return [...result].sort((a, b) => {
      const aCritical = normCat(a.category) !== '완제품' && displayStockOf(a) < a.minStock ? 0 : 1;
      const bCritical = normCat(b.category) !== '완제품' && displayStockOf(b) < b.minStock ? 0 : 1;
      if (aCritical !== bCritical) return aCritical - bCritical;
      const aCatIdx = CATEGORY_ORDER.indexOf(normCat(a.category));
      const bCatIdx = CATEGORY_ORDER.indexOf(normCat(b.category));
      const aIdx = aCatIdx === -1 ? 99 : aCatIdx;
      const bIdx = bCatIdx === -1 ? 99 : bCatIdx;
      return aIdx - bIdx;
    });
  }, [items, activeTab, activeCategory, activeSubtype, activeSupplierId, searchTerm, orderRequests, confirmedOrders, inboundPartners, partners, topTab, stockOnly, zeroStockOnly]);

  // 완제품 탭: 박스 품목을 그 낱개 밑으로 묶는다 (unpackComponent 기준). row = { p, isChild, parentId?, boxCount }
  type GroupRow = { p: Item; isChild: boolean; parentId?: string; boxCount: number };
  const groupedRows = useMemo<GroupRow[]>(() => {
    if (topTab !== 'finished') return filteredProducts.map(p => ({ p, isChild: false, boxCount: 0 }));
    const boxByParent = new Map<string, Item[]>();
    const inList = new Set(filteredProducts.map(p => p.id));
    const looseOrOrphan: Item[] = [];
    for (const p of filteredProducts) {
      const uc = unpackComponent(p);
      if (uc && inList.has(uc.itemId)) {
        if (!boxByParent.has(uc.itemId)) boxByParent.set(uc.itemId, []);
        boxByParent.get(uc.itemId)!.push(p);
      } else {
        looseOrOrphan.push(p);   // 낱개거나, 낱개가 목록에 없는 박스(orphan)는 단독
      }
    }
    const rows: GroupRow[] = [];
    for (const p of looseOrOrphan) {
      const boxes = boxByParent.get(p.id) ?? [];
      rows.push({ p, isChild: false, boxCount: boxes.length });
      for (const b of boxes) rows.push({ p: b, isChild: true, parentId: p.id, boxCount: 0 });
    }
    return rows;
  }, [filteredProducts, topTab]);
  const visibleRows = useMemo(
    () => groupedRows.filter(r => !(r.isChild && r.parentId && collapsedParents.has(r.parentId))),
    [groupedRows, collapsedParents],
  );
  const totalPages = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedRows = visibleRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);



  const updateDraftQty = (id: string, qty: number) => {
    setDraftOrders(prev => prev.map(d => d.id === id ? { ...d, quantity: Math.max(0, qty) } : d));
  };

  const removeFromDraft = (id: string) => {
    setDraftOrders(prev => prev.filter(d => d.id !== id));
    const next = new Set(selectedIds);
    next.delete(id);
    setSelectedIds(next);
  };

  const submitDraftToHistory = () => {
    if (draftOrders.length > 0) {
      onBulkAddConfirmedOrders(draftOrders);
      setDraftOrders([]);
      setSelectedIds(new Set());
      setActiveTab('history');
      alert('발주 확정되어 [발주 내역]으로 이동했습니다.');
    }
  };




  return (
    <div className="space-y-5 animate-in fade-in duration-300 h-full flex flex-col relative">
      <PageHeader
        title="재고 관리"
        subtitle="실시간 재고 현황을 파악하고 부족한 자재를 즉시 발주하세요."
        right={
          <div className="flex bg-slate-100 rounded-xl p-1 gap-1">
            <button
              onClick={() => setActiveTab('master')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-black transition-all ${activeTab === 'master' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
            >
              <Box size={13} /><span>재고 현황</span>
            </button>
            <button
              onClick={() => setActiveTab('inbound')}
              className={`relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-black transition-all ${activeTab === 'inbound' ? 'bg-white text-teal-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
            >
              <Inbox size={13} /><span>입고/반품</span>
              {(inboundBadge + returnBadge) > 0 && <span className="absolute -top-1 -right-1 bg-amber-500 text-white w-4 h-4 flex items-center justify-center rounded-full text-[9px] shadow">{inboundBadge + returnBadge}</span>}
            </button>
            <button
              onClick={() => setActiveTab('lots')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-black transition-all ${activeTab === 'lots' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
            >
              <Layers size={13} /><span>로트</span>
            </button>
          </div>
        }
      />

      {/* 장바구니 FAB (fixed — 위치 무관하므로 헤더 뒤에 두어 space-y 마진 영향 제거) */}
      {activeTab === 'master' && (
        <button
          onClick={() => setShowCartPanel(true)}
          className="fixed bottom-6 right-4 z-30 flex items-center justify-center w-14 h-14 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white rounded-full shadow-xl transition-all"
        >
          <ShoppingCart size={22} />
          {cart.length > 0 && (
            <span className="absolute -top-1 -right-1 bg-amber-400 text-white w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-black shadow">{cart.length}</span>
          )}
        </button>
      )}

      <div className="flex flex-col space-y-4">

        {/* 카테고리 토글 + 검색 행 (입고/반품·로트 탭에서는 숨김) */}
        {!zeroStockOnly && activeTab !== 'inbound' && activeTab !== 'lots' && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="bg-slate-100/50 p-1 rounded-2xl flex items-center self-start border border-slate-200 max-w-full overflow-x-auto no-scrollbar">
              {([
                { id: 'finished', label: '완제품', color: 'text-violet-600', icon: <Package size={13}/>, onClick: () => { setTopTab('finished'); setActiveCategory('전체'); setActiveSubtype('전체'); setActiveSupplierId('전체'); } },
                { id: 'goods', label: '상품', color: 'text-orange-500', icon: <Box size={13}/>, onClick: () => { setTopTab('goods'); setActiveCategory('전체'); setActiveSubtype('전체'); setActiveSupplierId('전체'); setShowCategoryFilter(false); setShowSupplierFilter(false); } },
                { id: 'wip', label: '반제품', color: 'text-sky-600', icon: <Cylinder size={13}/>, onClick: () => { setTopTab('wip'); setActiveCategory('전체'); setActiveSubtype('전체'); setActiveSupplierId('전체'); setShowCategoryFilter(false); setShowSupplierFilter(false); } },
                { id: 'rawmaterial', label: '원료재고', color: 'text-emerald-600', icon: <Grape size={13}/>, onClick: () => { setTopTab('rawmaterial'); setActiveCategory('전체'); setActiveSubtype('전체'); setActiveSupplierId('전체'); setShowCategoryFilter(false); setShowSupplierFilter(false); } },
                { id: 'submaterial', label: '부자재', color: 'text-indigo-600', icon: <Box size={13}/>, onClick: () => { setTopTab('submaterial'); setActiveCategory('전체'); setActiveSubtype('전체'); setActiveSupplierId('전체'); setShowCategoryFilter(false); setShowSupplierFilter(false); } },
              ] as const).map(t => (
                <button key={t.id} onClick={t.onClick}
                  className={`px-3 py-2 rounded-xl flex items-center gap-1 transition-all text-xs font-black whitespace-nowrap ${topTab === t.id ? `bg-white ${t.color} shadow-sm` : 'text-slate-400 hover:text-slate-600'}`}>
                  {t.icon}<span>{t.label}</span>
                </button>
              ))}
            </div>
            {activeTab === 'master' && (
              <div className="relative w-36 md:w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={15} />
                <input
                  type="text"
                  placeholder="품목명 · 거래처 검색..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-2xl pl-9 pr-4 py-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 shadow-sm transition-all"
                />
              </div>
            )}
            {/* 우측 액션: 재고 현황(마감·만들기 통합) + (원료재고 탭) 입고/사용 기록 */}
            <div className="flex items-center gap-2 ml-auto">
              <button
                // 열 때마다 '재고' 뷰로 — 평소 보고 세는 숫자가 작업완료 제외한 가용 재고라서.
                onClick={() => { setClosingView('stock'); setClosingPage(0); setEditingClosingId(null); setShowClosingModal(true); }}
                className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white rounded-xl text-xs font-black hover:bg-indigo-700 transition-colors shadow-sm"
              >
                <Box size={13} /> 재고 현황
              </button>
              {activeTab === 'master' && topTab === 'rawmaterial' && (
                <button
                  type="button"
                  onClick={() => setRawEntryModal({ mode: 'usage' })}
                  className="flex items-center gap-1.5 px-3 py-2 bg-rose-500 hover:bg-rose-600 text-white rounded-xl text-xs font-black transition-all shadow-sm"
                >
                  <FileDown size={13} /><span>사용 기록</span>
                </button>
              )}
              {/* 분류 관리는 품목 관리(관리자)로 이동 */}
            </div>
          </div>
        )}

        {/* 입고처리/반품처리 버튼 행 (입고/반품 탭에서만) */}
        {activeTab === 'inbound' && (inboundContent || returnContent) && (
          <div className="flex items-center justify-end gap-2">
            {inboundContent && (
              <button onClick={() => setShowInboundOverlay(true)} className="flex items-center gap-1.5 px-3 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-black transition-all shadow-sm relative">
                <Inbox size={13} /><span>입고처리</span>
                {inboundBadge > 0 && <span className="absolute -top-1 -right-1 bg-amber-400 text-white w-4 h-4 flex items-center justify-center rounded-full text-[9px] shadow">{inboundBadge}</span>}
              </button>
            )}
            {returnContent && (
              <button onClick={() => setShowReturnOverlay(true)} className="flex items-center gap-1.5 px-3 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-black transition-all shadow-sm relative">
                <RotateCcw size={13} /><span>반품처리</span>
                {returnBadge > 0 && <span className="absolute -top-1 -right-1 bg-rose-400 text-white w-4 h-4 flex items-center justify-center rounded-full text-[9px] shadow">{returnBadge}</span>}
              </button>
            )}
            {oemEnabled && (
              <button onClick={() => setOemIssueOpen(true)} className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-xs font-black transition-all shadow-sm">
                <Factory size={13} /><span>외주 발주</span>
              </button>
            )}
          </div>
        )}

        {/* 입고/반품 서브탭 (필터 행 위치) */}
        {activeTab === 'inbound' && (inboundContent || returnContent) && (
          <div className="flex items-center gap-2">
            {inboundContent && (
              <button
                onClick={() => setInboundSubTab('입고')}
                className={`px-4 py-2 rounded-2xl border text-xs font-black transition-all ${inboundSubTab === '입고' ? 'bg-teal-50 border-teal-200 text-teal-700 ring-2 ring-teal-50' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}
              >
                입고
              </button>
            )}
            {returnContent && (
              <button
                onClick={() => setInboundSubTab('반품')}
                className={`px-4 py-2 rounded-2xl border text-xs font-black transition-all ${inboundSubTab === '반품' ? 'bg-rose-50 border-rose-200 text-rose-700 ring-2 ring-rose-50' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}
              >
                반품
                {returnBadge > 0 && <span className="ml-1.5 bg-rose-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full">{returnBadge}</span>}
              </button>
            )}
          </div>
        )}

        {activeTab !== 'inbound' && activeTab !== 'lots' && (topTab === 'submaterial' || topTab === 'finished' || topTab === 'goods') && <div className="flex flex-col gap-2">
          {/* 서브타입 — 낱개/배송/선물세트 (있는 타입에만) */}
          {!zeroStockOnly && subtypeTabs.length > 0 && <div className="flex items-center gap-2 flex-wrap">
            {['전체', ...subtypeTabs].map(s => {
              const isActive = activeSubtype === s;
              return (
                <button key={s}
                  onClick={() => setActiveSubtype(s)}
                  className={`px-4 py-2 rounded-2xl border text-[11px] font-black transition-all ${isActive ? 'bg-white border-indigo-200 text-indigo-600 shadow-sm ring-2 ring-indigo-50' : 'bg-white border-slate-100 text-slate-400 hover:border-slate-300'}`}
                >{s}</button>
              );
            })}
          </div>}
          {/* 카테고리 — 참기름/들기름/라벨/용기… */}
          {!zeroStockOnly && subCategories.length > 0 && <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setShowCategoryFilter(p => !p)}
              className={`flex items-center space-x-2 px-4 py-2.5 rounded-2xl border text-[11px] font-black transition-all ${showCategoryFilter ? 'bg-indigo-50 border-indigo-200 text-indigo-600 ring-2 ring-indigo-50' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}
            >
              <LayoutGrid size={14} />
              <span>품목별</span>
            </button>
            {showCategoryFilter && subCategories
              .map(sub => {
                const Icon = sub.icon;
                const isActive = activeCategory === sub.id;
                const count = categoryCounts[sub.id] || 0;
                return (
                  <button key={sub.id}
                    onClick={() => setActiveCategory(isActive ? '전체' : sub.id)}
                    className={`flex items-center space-x-2 px-4 py-2.5 rounded-2xl transition-all whitespace-nowrap border text-[11px] font-black uppercase relative ${isActive ? 'bg-white border-indigo-200 text-indigo-600 shadow-sm ring-2 ring-indigo-50' : 'bg-white border-slate-100 text-slate-400 hover:border-slate-300'}`}
                  >
                    <Icon size={14} />
                    <span>{sub.label}</span>
                    {count > 0 && <span className="absolute -top-1 -right-1 bg-rose-500 text-white w-4 h-4 flex items-center justify-center rounded-full text-[9px] shadow-lg border border-white">{count}</span>}
                  </button>
                );
              })}
          </div>}
          {/* 완제품 탭 전용 필터 */}
          {topTab === 'finished' && (
            <div className="flex items-center gap-2 flex-wrap">
              {!zeroStockOnly && (
                <button
                  onClick={() => { setStockOnly(p => !p); setZeroStockOnly(false); }}
                  className={`px-4 py-2 rounded-2xl border text-[11px] font-black transition-all flex items-center gap-1.5 ${stockOnly ? 'bg-emerald-50 border-emerald-200 text-emerald-600 ring-2 ring-emerald-50' : 'bg-white border-slate-100 text-slate-400 hover:border-slate-300'}`}
                >
                  <span className={`w-3 h-3 rounded-full border-2 transition-colors ${stockOnly ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300'}`} />
                  재고있는 것만
                </button>
              )}
              <div className="ml-2 h-5 w-px bg-slate-200" />
              <button
                onClick={() => { setZeroStockOnly(p => !p); setStockOnly(false); }}
                className={`px-4 py-2 rounded-2xl border text-[11px] font-black transition-all flex items-center gap-1.5 ${zeroStockOnly ? 'bg-rose-50 border-rose-200 text-rose-600 ring-2 ring-rose-50' : 'bg-white border-slate-100 text-slate-400 hover:border-slate-300'}`}
              >
                <span className={`w-3 h-3 rounded-full border-2 transition-colors ${zeroStockOnly ? 'bg-rose-500 border-rose-500' : 'border-slate-300'}`} />
                최소수량 미만만 보기
              </button>
              {zeroStockOnly && (
                <span className="text-[11px] font-bold text-rose-500">{filteredProducts.length}개 부족</span>
              )}
            </div>
          )}
          {/* 거래처별 필터 - 완제품 탭 제외 */}
          {!zeroStockOnly && topTab !== 'finished' && <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setShowSupplierFilter(p => !p)}
              className={`flex items-center space-x-2 px-4 py-2.5 rounded-2xl border text-[11px] font-black transition-all ${showSupplierFilter ? 'bg-orange-50 border-orange-200 text-orange-500 ring-2 ring-orange-50' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}
            >
              <Building2 size={14} />
              <span>거래처별</span>
            </button>
            {showSupplierFilter && inboundPartners.map(inboundPartner => {
              const isActive = activeSupplierId === inboundPartner.id;
              return (
                <button key={inboundPartner.id}
                  onClick={() => setActiveSupplierId(isActive ? '전체' : inboundPartner.id)}
                  className={`flex items-center space-x-2 px-4 py-2.5 rounded-2xl transition-all whitespace-nowrap border text-[11px] font-black relative ${isActive ? 'bg-white border-orange-200 text-orange-500 shadow-sm ring-2 ring-orange-50' : 'bg-white border-slate-100 text-slate-400 hover:border-slate-300'}`}
                >
                  <Building2 size={14} />
                  <span>{inboundPartner.name}</span>
                </button>
              );
            })}
          </div>}
        </div>}
      </div>

      {/* 입고처리 오버레이 */}
      {showInboundOverlay && inboundContent && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={e => { if (e.target === e.currentTarget) setShowInboundOverlay(false); }}>
          <div className="bg-slate-50 rounded-t-3xl sm:rounded-3xl w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-2xl">
            <div className="sticky top-0 z-10 bg-slate-50 px-5 pt-5 pb-3 border-b border-slate-200 flex items-center justify-between">
              <span className="font-black text-slate-800 text-base">입고 처리</span>
              <button onClick={() => setShowInboundOverlay(false)} className="p-2 rounded-xl hover:bg-slate-200 transition-colors">
                <X size={18} className="text-slate-500" />
              </button>
            </div>
            <div className="p-4">{inboundContent}</div>
          </div>
        </div>
      )}

      {/* 반품처리 오버레이 */}
      {showReturnOverlay && returnContent && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={e => { if (e.target === e.currentTarget) setShowReturnOverlay(false); }}>
          <div className="bg-slate-50 rounded-t-3xl sm:rounded-3xl w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-2xl">
            <div className="sticky top-0 z-10 bg-slate-50 px-5 pt-5 pb-3 border-b border-slate-200 flex items-center justify-between">
              <span className="font-black text-slate-800 text-base">반품 처리</span>
              <button onClick={() => setShowReturnOverlay(false)} className="p-2 rounded-xl hover:bg-slate-200 transition-colors">
                <X size={18} className="text-slate-500" />
              </button>
            </div>
            <div className="p-4">{returnContent}</div>
          </div>
        </div>
      )}

      {/* 입고/반품 탭 콘텐츠 */}
      {activeTab === 'inbound' && (
        <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-6">
          {inboundSubTab === '입고' && (() => {
            const history = (receivedOrders ?? [])
              .filter(r => (r.receivedAt ?? '').slice(0, 7) === historyMonth)
              .sort((a, b) => (b.receivedAt ?? '').localeCompare(a.receivedAt ?? ''));
            const HISTORY_PAGE_SIZE = 10;
            const historyTotalPages = Math.max(1, Math.ceil(history.length / HISTORY_PAGE_SIZE));
            const historySafePage = Math.min(historyPage, historyTotalPages);
            const pagedHistory = history.slice((historySafePage - 1) * HISTORY_PAGE_SIZE, historySafePage * HISTORY_PAGE_SIZE);
            return (
              <>
                {/* ── 발주 예정 목록 (Firestore pending) ── */}
                {orderRequests.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center text-slate-400 text-sm">
                    <ClipboardCheck size={28} className="mx-auto mb-2 opacity-30" />
                    <p>발주 예정 없음</p>
                    <p className="text-[11px] mt-1">재고현황에서 품목을 담아 확정하세요</p>
                  </div>
                ) : (() => {
                  const groups = new Map<string, { partnerName: string; items: typeof orderRequests }>();
                  orderRequests.forEach(po => {
                    const key = po.partnerName || '거래처 미지정';
                    if (!groups.has(key)) groups.set(key, { partnerName: key, items: [] });
                    groups.get(key)!.items.push(po);
                  });
                  return (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 px-1">
                        <ClipboardCheck size={16} className="text-indigo-500" />
                        <span className="font-black text-sm text-slate-800">발주 예정 목록</span>
                        <span className="text-[10px] font-black bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full">{orderRequests.length}건</span>
                      </div>
                      {Array.from(groups.values()).map(group => (
                        <div key={group.partnerName} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                          <div className="px-4 py-2.5 bg-orange-50 border-b border-orange-100 flex items-center gap-2">
                            <span className="text-xs font-black text-orange-700">{group.partnerName}</span>
                            <span className="text-[10px] text-orange-400">{group.items.length}개 품목</span>
                          </div>
                          <div className="divide-y divide-slate-50">
                            {group.items.flatMap(po => poLines(po).map((line, idx) => {
                              const product = productMap.get(line.itemId);
                              const lineKey = `${po.id}-${idx}`;
                              const isEditing = editingReqLine === lineKey;
                              const setQty = (q: number) => onUpdatePoItemQty ? onUpdatePoItemQty(po.id, idx, q) : onUpdateOrderRequestQty(po.id, q);
                              const removeLine = () => onRemovePoItem ? onRemovePoItem(po.id, idx) : onRemoveOrderRequest(po.id);
                              const saveEdit = () => { const q = Math.max(1, parseInt(editingReqVal) || 1); setQty(q); setEditingReqLine(null); };
                              return (
                                <div key={lineKey} className="px-4 py-3 flex items-center gap-3">
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-bold text-slate-800 truncate">{line.name}</p>
                                    <p className="text-[10px] text-slate-400 mt-0.5">현재 재고 {product ? displayStockOf(product) : '-'} {product?.unit ?? ''}</p>
                                  </div>
                                  {isEditing ? (
                                    <div className="flex items-center gap-1.5 shrink-0">
                                      <input type="number" autoFocus value={editingReqVal}
                                        onChange={e => setEditingReqVal(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingReqLine(null); }}
                                        className="w-16 text-center text-sm font-black border border-teal-300 rounded-lg px-1 py-1 outline-none focus:ring-2 focus:ring-teal-400" />
                                      <span className="text-[11px] text-slate-400">{line.isBox ? 'B' : (product?.unit ?? '')}</span>
                                      <button onClick={saveEdit} className="px-2 py-1 rounded-lg bg-teal-500 text-white text-[11px] font-black hover:bg-teal-600">저장</button>
                                      <button onClick={() => setEditingReqLine(null)} className="px-2 py-1 rounded-lg bg-slate-100 text-slate-500 text-[11px] font-black hover:bg-slate-200">취소</button>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-2 shrink-0">
                                      <span className="text-sm font-black text-slate-800">{line.quantity}</span>
                                      <span className="text-[11px] text-slate-400">{line.isBox ? 'B' : (product?.unit ?? '')}</span>
                                      <button onClick={() => { setEditingReqLine(lineKey); setEditingReqVal(String(line.quantity)); }}
                                        className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200 transition-all" title="수정"><Edit size={13} /></button>
                                      <button onClick={removeLine} className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-300 hover:bg-rose-50 hover:text-rose-500 transition-all" title="삭제"><Trash2 size={13} /></button>
                                    </div>
                                  )}
                                </div>
                              );
                            }))}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* ── 입고대기 (발주카드 invoiced) ── */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <FileText size={14} className="text-amber-500" />
                    <span className="text-xs font-black text-slate-700 uppercase tracking-wider">입고대기</span>
                    {confirmedOrders.length > 0 && <span className="bg-amber-100 text-amber-700 text-[10px] font-black px-2 py-0.5 rounded-full">{confirmedOrders.length}건</span>}
                  </div>
                  {confirmedOrders.length === 0 ? (
                    <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center text-slate-400 text-sm">입고 대기 없음</div>
                  ) : (() => {
                    const groups = new Map<string, { partnerName: string; orders: typeof confirmedOrders }>();
                    confirmedOrders.forEach(po => {
                      const key = po.partnerName || '거래처 미지정';
                      if (!groups.has(key)) groups.set(key, { partnerName: key, orders: [] });
                      groups.get(key)!.orders.push(po);
                    });
                    return (
                      <div className="space-y-2">
                        {Array.from(groups.values()).map(group => (
                          <div key={group.partnerName} className="bg-white rounded-2xl border border-amber-100 p-4 shadow-sm space-y-3">
                            <p className="font-black text-slate-800 text-sm">{group.partnerName}</p>
                            {group.orders.map(po => {
                              // 임가공 배치 — 우리 원료가 나가 있는 것. 입고확정 대신 가공입고.
                              if (po.poType === 'oem') return (
                                <div key={po.id} className="rounded-xl border border-violet-200 bg-violet-50/40 p-2.5 space-y-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-[10px] font-black text-violet-600 bg-violet-100 px-2 py-0.5 rounded">임가공 · 외주 나감</span>
                                    <button onClick={() => setOemReceiveTarget(po)}
                                      className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-[11px] font-black hover:bg-violet-700 transition-all shrink-0">
                                      가공입고
                                    </button>
                                  </div>
                                  <p className="text-[10px] text-slate-400 font-bold">출고일 {(po.oemSentAt || po.createdAt || '').slice(0, 10)}</p>
                                  {(po.oemSent ?? []).map((s, idx) => (
                                    <div key={idx} className="flex justify-between text-xs text-slate-600 bg-white rounded-lg px-3 py-1.5">
                                      <span>{s.material} <span className="text-slate-400">보냄</span></span>
                                      <span className="font-bold">{s.kg.toLocaleString()} kg</span>
                                    </div>
                                  ))}
                                </div>
                              );
                              return (
                              <div key={po.id} className="rounded-xl border border-slate-100 p-2.5 space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[10px] text-slate-400 font-bold">발주일 {(po.createdAt||'').slice(0,10)}</span>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <button onClick={() => onFinishConfirmedOrder(po.id)}
                                      className="px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-[11px] font-black hover:bg-emerald-600 transition-all">
                                      입고확정
                                    </button>
                                    {po.linkedStatementId && onRequestPoEdit && (
                                      <button onClick={() => setPoEditModal({ po, rows: poLines(po).map(l => ({ itemId: l.itemId, name: l.name, qty: String(l.quantity) })), reason: '' })}
                                        className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-[11px] font-black hover:bg-slate-200 transition-all">
                                        수정
                                      </button>
                                    )}
                                  </div>
                                </div>
                                {poLines(po).map((line, idx) => {
                                  const product = productMap.get(line.itemId);
                                  const unit = line.isBox ? '박스' : (line.unit || product?.unit || '');
                                  return (
                                    <div key={`${po.id}-${idx}`} className="flex justify-between text-xs text-slate-600 bg-slate-50 rounded-lg px-3 py-1.5">
                                      <span>{line.name || product?.name}</span>
                                      <span className="font-bold">{line.quantity.toLocaleString()} {unit}</span>
                                    </div>
                                  );
                                })}
                              </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>

                {/* ── 입고이력 ── */}
                <div>
                  <div className="flex items-center gap-3 mb-3">
                    <History size={14} className="text-slate-400" />
                    <span className="text-xs font-black text-slate-700 uppercase tracking-wider">입고이력</span>
                    {history.length > 0 && <span className="text-[10px] font-black bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{history.length}건</span>}
                    <input type="month" value={historyMonth} onChange={e => { setHistoryMonth(e.target.value); setHistoryPage(1); }} className="border border-slate-200 rounded-xl px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-teal-400 ml-auto" />
                  </div>
                  {history.length === 0 ? (
                    <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center text-slate-400 text-sm">해당 월의 입고 이력 없음</div>
                  ) : (
                    <div className="space-y-2">
                      {pagedHistory.map(r => {
                        const isOem = r.poType === 'oem';
                        const oemSentTotal = (r.oemSent ?? []).reduce((a, s) => a + (s.kg || 0), 0);
                        return (
                        <div key={r.id} className={`bg-white rounded-2xl border p-4 shadow-sm space-y-2 ${isOem ? 'border-violet-200' : 'border-slate-100'}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-black text-slate-800 text-sm">
                                {r.partnerName}
                                {isOem && <span className="ml-1.5 text-[10px] font-black text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded">임가공</span>}
                              </p>
                              <p className="text-xs text-slate-400">
                                {(r.receivedAt ?? '').slice(0, 10)}
                                {isOem && ` · 보낸 원료 ${oemSentTotal.toLocaleString()}kg → 받은 ${(r.oemReceivedKg ?? 0).toLocaleString()}kg (로스 ${Math.max(0, Math.round((oemSentTotal - (r.oemReceivedKg ?? 0)) * 1000) / 1000).toLocaleString()}kg)`}
                              </p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className={`px-2 py-1 rounded-lg text-[10px] font-black ${r.linkedStatementId ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                                {r.linkedStatementId ? '✓ 전표 연결됨' : (isOem ? '가공비 전표 → 확인사항' : '전표 미작성')}
                              </span>
                              {/* 가공비 전표 발행은 확인사항에서 — 여기 버튼 없음(경로 하나로) */}
                            </div>
                          </div>
                          {(r.items ?? []).map((item, i) => (
                            <div key={i} className="flex justify-between text-xs text-slate-600 bg-slate-50 rounded-lg px-3 py-1.5">
                              <span>{item.name}</span>
                              <span className="font-bold">{item.quantity.toLocaleString()} {item.unit}</span>
                            </div>
                          ))}
                        </div>
                        );
                      })}
                      {historyTotalPages > 1 && (
                        <div className="flex items-center justify-center gap-1 pt-2">
                          <button onClick={() => setHistoryPage(p => Math.max(1, p - 1))} disabled={historySafePage === 1}
                            className="px-3 h-8 rounded-lg text-xs font-black text-slate-500 bg-white border border-slate-200 disabled:opacity-40 hover:bg-slate-50 transition-all">이전</button>
                          {Array.from({ length: historyTotalPages }, (_, i) => i + 1).map(p => (
                            <button key={p} onClick={() => setHistoryPage(p)}
                              className={`w-8 h-8 rounded-lg text-xs font-black transition-all ${historySafePage === p ? 'bg-teal-600 text-white shadow' : 'text-slate-400 bg-white border border-slate-200 hover:bg-slate-50'}`}>{p}</button>
                          ))}
                          <button onClick={() => setHistoryPage(p => Math.min(historyTotalPages, p + 1))} disabled={historySafePage === historyTotalPages}
                            className="px-3 h-8 rounded-lg text-xs font-black text-slate-500 bg-white border border-slate-200 disabled:opacity-40 hover:bg-slate-50 transition-all">다음</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            );
          })()}
          {inboundSubTab === '반품' && returnContent && returnContent}
        </div>
      )}

      {/* 임가공(OEM) 모달 — 목록은 위 입고대기·입고이력에 녹아 있다 */}
      {oemEnabled && onOemIssue && onOemReceive && onOemIssueFee && rawStockKg && (
        <OemManager
          items={items}
          partners={(partners ?? []) as any}
          rawStockKg={rawStockKg}
          issueOpen={oemIssueOpen}
          receiveTarget={oemReceiveTarget}
          feeTarget={oemFeeTarget}
          onClose={closeOem}
          onIssue={onOemIssue}
          onReceive={onOemReceive}
          onIssueFee={onOemIssueFee}
        />
      )}

      {/* ── 로트 탭: 원료 홀더별 로트/수불부 확인 전용 ── */}
      {activeTab === 'lots' && (
        <div className="flex flex-col gap-3 flex-1 min-h-0">
          <div className="relative w-full sm:w-72 self-start">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={15} />
            <input
              type="text"
              placeholder="원료명 검색..."
              value={lotSearch}
              onChange={(e) => setLotSearch(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-2xl pl-9 pr-4 py-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400 shadow-sm transition-all"
            />
          </div>
          <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar flex flex-col gap-2">
            {items
              .filter(p => isRawHolder(p) && (!lotSearch.trim() || baseRawName(p.name).includes(lotSearch.trim()) || p.name.includes(lotSearch.trim())))
              .sort((a, b) => baseRawName(a.name).localeCompare(baseRawName(b.name), 'ko'))
              .map(raw => {
                const material = baseRawName(raw.name);
                const stock = displayStockOf(raw);
                const unitLabel = raw.unit ?? (unitOf(material) === 'L' ? 'L' : 'kg');
                const activeLotCount = (raw.lots ?? []).filter(l => l.status === 'active' && (l.kgRemaining ?? 0) > 0).length;
                const isOpen = lotExpandedId === raw.id;
                return (
                  <div key={raw.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                    <button
                      onClick={() => setLotExpandedId(isOpen ? null : raw.id)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50/60 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <ChevronRight size={14} className={`text-slate-300 transition-transform shrink-0 ${isOpen ? 'rotate-90' : ''}`} />
                        <Grape size={14} className="text-emerald-500 shrink-0" />
                        <span className="text-sm font-black text-slate-700 truncate">{material}</span>
                        <span className="text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full shrink-0">로트 {activeLotCount}</span>
                      </div>
                      <span className={`text-sm font-black shrink-0 tabular-nums ${stock < 0 ? 'text-rose-600' : 'text-slate-800'}`}>{Math.round(stock * 10) / 10} {unitLabel}</span>
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-4 pt-1 bg-emerald-50/40 border-t border-emerald-100">
                        <RawMaterialLotPanel
                          product={raw}
                          isAdmin={isAdmin}
                          ledgerEntries={rawMaterialLedger.filter(e => e.material === material)}
                          onDeleteEntry={onDeleteRawMaterialEntry}
                          currentUserName={currentUser?.name}
                          onLotChanged={onLedgerChanged}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            {items.filter(isRawHolder).length === 0 && (
              <div className="text-center text-slate-400 text-xs font-bold py-16">원료 품목이 없습니다.</div>
            )}
          </div>
        </div>
      )}

      {activeTab !== 'inbound' && activeTab !== 'lots' && (zeroStockOnly || topTab === 'submaterial' || topTab === 'finished' || topTab === 'goods' || topTab === 'rawmaterial' || topTab === 'wip') && <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
        {activeTab === 'requests' && draftOrders.length > 0 && (
          <div className="mb-8 bg-indigo-50/50 border border-indigo-100 rounded-[32px] p-6">
            <div className="flex items-center justify-between mb-6 px-2">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-600">
                  <ListPlus size={18} />
                </div>
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">발주 확정 대기 리스트</h3>
                <span className="bg-indigo-200 text-indigo-800 text-[10px] font-black px-2 py-0.5 rounded-full">{draftOrders.length}</span>
              </div>
              <button 
                onClick={submitDraftToHistory}
                className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-black shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all active:scale-95"
              >
                최종 발주 확정
              </button>
            </div>
            <div className="space-y-3">
              {draftOrders.map(draft => {
                const product = items.find(p => p.id === draft.id);
                if (!product) return null;
                return (
                  <div key={draft.id} className="bg-white border border-slate-100 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-center space-x-3 flex-1 min-w-0">
                      <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400 shrink-0">
                        <Package size={20} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-black text-slate-800 truncate">{withSpec(product)}</p>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">{product.category}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 sm:gap-8 justify-between sm:justify-end">
                      <div className="text-left sm:text-center">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-tighter mb-0.5">현재 재고</p>
                        <p className="text-sm font-black text-slate-900">
                          {product.subtype === '향미유' ? fmtHamiyou(product.stock) : `${displayStockOf(product)}${product.unit}`}
                        </p>
                      </div>

                      <div className="text-left sm:text-center">
                        <p className="text-[10px] font-black text-indigo-400 uppercase tracking-tighter mb-0.5">발주 예정 수량</p>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            value={draft.quantity}
                            onChange={(e) => updateDraftQty(draft.id, parseInt(e.target.value) || 0)}
                            className="w-16 text-center text-sm font-black text-indigo-600 bg-white border border-indigo-100 rounded-lg py-1 outline-none focus:border-indigo-500"
                          />
                          <span className="text-[10px] font-black text-indigo-400">{product.unit}</span>
                        </div>
                      </div>

                      <button
                        onClick={() => removeFromDraft(draft.id)}
                        className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all shrink-0"
                      >
                        <X size={18} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {/* ── 재고 현황: 테이블 뷰 ── */}
        {activeTab === 'master' && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden mb-4">
            <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">카테고리</th>
                  <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest hidden sm:table-cell">거래처</th>
                  <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">품목명</th>
                  <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest hidden sm:table-cell">라벨</th>
                  <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">현재 재고</th>
                  <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right hidden sm:table-cell">최소 수량</th>
                  <th className="px-4 py-3 hidden sm:table-cell"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {pagedRows.map(({ p: product, isChild, boxCount }) => {
                  const confInfo = confirmedOrders.find(c => (c.itemId ?? c.id) === product.id);
                  const inCart = cart.some(c => c.id === product.id);
                  const isExpanded = expandedRowId === product.id;
                  // 로트가 저장된 원료(raw) 품목 — raw면 자기 자신, 매입 SKU(캔/반제품)면 연결된 원료
                  const lotRaw = isRawHolder(product)
                    ? product
                    : items.find(i => isRawHolder(i) && baseRawName(i.name) === (product.rawMaterialName || baseRawName(product.name)));
                  // 반제품/매입 캔: 재고를 원료 로트(kg)에서 파생 표시 — '캔 수 = 원료 활성잔량 ÷ 캔용량'.
                  // 입고/사용이 원료 로트에 반영되므로 캔 수도 자동으로 따라감(캔 품목의 stock 필드는 표시에 쓰지 않음).
                  const canPackageKg = (lotRaw && lotRaw.id !== product.id && product.category !== 'product')
                    ? (product.packageKg ?? parsePackageKg(product.spec) ?? parsePackageKg(product.name) ?? null)
                    : null;
                  const derivedRawKg = canPackageKg ? lotKgRemaining((lotRaw!.lots ?? []).filter(l => l.status === 'active')) : null;
                  const derivedCans = (canPackageKg && derivedRawKg != null) ? derivedRawKg / canPackageKg : null;
                  // #2 원료 단일 소스: 원료(raw)는 화면도 로트 합계를 직접 읽어 stock 미러와의 불일치 방지.
                  //   lot이 하나도 없는 원료(예: 깻묵)는 기존 stock으로 폴백.
                  const rawLots = isRawHolder(product) ? (product.lots ?? []) : null;
                  const rawLotStock = rawLots && rawLots.length > 0 ? lotStockInUnit(rawLots, baseRawName(product.name)) : null;
                  const effStock = derivedCans != null ? derivedCans : (rawLotStock != null ? rawLotStock : product.stock);
                  // 표시·편집 시드용 재고 (원료는 로트 합계, 그 외는 stock)
                  const displayStock = rawLotStock != null ? rawLotStock : product.stock;
                  const isCritical = normCat(product.category) !== '완제품' && effStock < product.minStock;
                  const statusBadge = normCat(product.category) === '완제품' ? (
                    <span className="text-[9px] font-black text-slate-300">자체생산</span>
                  ) : confInfo ? (
                    <span className="text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full whitespace-nowrap">입고대기 {confInfo.quantity}{product.unit}</span>
                  ) : inCart ? (
                    <span className="text-[9px] font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full whitespace-nowrap">발주요청</span>
                  ) : isCritical ? (
                    <span className="text-[9px] font-black text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full">재고부족</span>
                  ) : (
                    <span className="text-[9px] font-black text-slate-300">정상</span>
                  );
                  return (
                    <React.Fragment key={product.id}>
                    <tr
                      className={`transition-colors cursor-pointer sm:cursor-default ${inCart ? 'bg-indigo-50/40' : isCritical ? 'bg-rose-50/30 hover:bg-rose-50/50' : 'hover:bg-slate-50/50'}`}
                      onClick={() => setExpandedRowId(isExpanded ? null : product.id)}
                    >
                      <td className="px-4 py-3">
                        <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${(() => {
                          const sub = inferSubtype(product);
                          if (sub === '향미유' || sub === '참기름' || sub === '들기름') return 'bg-purple-50 text-purple-600';
                          if (sub === '고춧가루') return 'bg-red-50 text-red-500';
                          if (sub === '참깨' || sub === '들깨' || sub === '검정깨') return 'bg-amber-50 text-amber-700';
                          if (normCat(product.category) === '완제품') return 'bg-indigo-50 text-indigo-600';
                          if (normCat(product.category) === '상품') return 'bg-orange-50 text-orange-500';
                          if (sub === '용기') return 'bg-sky-50 text-sky-600';
                          if (sub === '라벨') return 'bg-amber-50 text-amber-600';
                          if (sub === '박스') return 'bg-emerald-50 text-emerald-600';
                          if (sub === '마개') return 'bg-slate-100 text-slate-600';
                          if (sub === '테이프') return 'bg-teal-50 text-teal-600';
                          return 'bg-slate-100 text-slate-500';
                        })()}`}>{inferSubtype(product)}</span>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell" onClick={e => e.stopPropagation()}>
                        {normCat(product.category) === '완제품' ? (
                          // 완제품: 매출처 (Direction='out', partnerIds 기반)
                          product.partnerIds && product.partnerIds.length > 0 ? (() => {
                            const isExp = expandedClientRowId === product.id;
                            const sorted = priorityClientId && product.partnerIds.includes(priorityClientId)
                              ? [priorityClientId, ...product.partnerIds.filter(id => id !== priorityClientId)]
                              : product.partnerIds;
                            const shown = isExp ? sorted : sorted.slice(0, 1);
                            return (
                              <div className="flex flex-wrap gap-1 items-center">
                                {shown.map(cid => {
                                  const cIdx = partners.findIndex(c => c.id === cid);
                                  const cname = cIdx >= 0 ? partners[cIdx].name : null;
                                  if (!cname) return null;
                                  return <span key={cid} className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${CLIENT_BADGE_COLORS[cIdx % CLIENT_BADGE_COLORS.length]}`}>{cname}</span>;
                                })}
                                {!isExp && product.partnerIds.length > 1 && (
                                  <button onClick={() => setExpandedClientRowId(product.id)} className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 transition-colors">+{product.partnerIds.length - 1}</button>
                                )}
                                {isExp && (
                                  <button onClick={() => setExpandedClientRowId(null)} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 transition-colors">접기</button>
                                )}
                              </div>
                            );
                          })() : <span className="text-[10px] text-slate-200">-</span>
                        ) : (
                          // 상품/부자재: 매입처 (Direction='in', psMap 기반)
                          (() => {
                            const partnerId = psMap.get(product.id);
                            const sname = partnerId ? inboundPartnerMap.get(partnerId)?.name : null;
                            return sname
                              ? <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">{sname}</span>
                              : <span className="text-[10px] text-slate-200">-</span>;
                          })()
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className={`flex items-center gap-2 ${isChild ? 'pl-5' : ''}`}>
                          {boxCount > 0 && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setCollapsedParents(prev => { const n = new Set(prev); n.has(product.id) ? n.delete(product.id) : n.add(product.id); return n; }); }}
                              className="shrink-0 text-slate-400 hover:text-indigo-600" title="박스 규격 접기/펼치기">
                              <ChevronRight size={14} className={`transition-transform ${collapsedParents.has(product.id) ? '' : 'rotate-90'}`} />
                            </button>
                          )}
                          {isChild && <span className="text-indigo-300 text-xs shrink-0">↳</span>}
                          <span className={`font-bold ${isChild ? 'text-[13px] text-slate-500' : 'text-sm text-slate-800'}`}>{withSpec(product)}</span>
                          {boxCount > 0 && <span className="text-[9px] font-black text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded-full shrink-0">박스 {boxCount}</span>}
                          {isCritical && <AlertCircle size={12} className="text-rose-500 shrink-0" />}
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        {product.품목 ? (
                          <div className="flex flex-col">
                            <span className="text-[11px] font-bold text-slate-600">{product.품목}</span>
                            {product.spec && <span className="text-[10px] text-slate-400">{product.spec}</span>}
                          </div>
                        ) : <span className="text-[10px] text-slate-200">-</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {derivedCans != null ? (
                          // 원료에서 파생된 캔 수 (읽기전용) — 입고/사용에 자동 연동
                          <div className="flex flex-col items-end leading-tight" onClick={e => e.stopPropagation()}
                            title={`원료 ${Math.round(derivedRawKg! * 10) / 10}kg ÷ ${canPackageKg}kg = ${Math.round(derivedCans * 10) / 10}캔`}>
                            <span className={`text-base font-black ${isCritical ? 'text-rose-600' : 'text-slate-800'}`}>
                              {Math.floor(derivedCans)}<span className="text-[10px] text-slate-400 ml-0.5">{product.unit || '개'}</span>
                            </span>
                            <span className="text-[9px] font-bold text-emerald-500">원료 {Math.round(derivedRawKg! * 10) / 10}kg ≈ {Math.round(derivedCans * 10) / 10}캔</span>
                          </div>
                        ) : editingStockId === product.id ? (
                          <div className="flex items-center justify-end gap-1">
                            <input
                              autoFocus
                              type="number"
                              value={editingStockVal}
                              onChange={e => setEditingStockVal(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') { stockEditCancelled.current = false; e.currentTarget.blur(); }
                                if (e.key === 'Escape') { stockEditCancelled.current = true; e.currentTarget.blur(); }
                              }}
                              onBlur={() => {
                                if (!stockEditCancelled.current) commitStockEdit(product, parseFloat(editingStockVal));
                                setEditingStockId(null);
                                stockEditCancelled.current = false;
                              }}
                              onClick={e => e.stopPropagation()}
                              className="w-20 text-right text-sm font-black border border-indigo-300 rounded-lg py-1 px-2 outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                            />
                            <span className="text-[10px] text-slate-400">{product.subtype === '향미유' ? 'B' : product.unit}</span>
                          </div>
                        ) : (
                          <button
                            onClick={e => { e.stopPropagation(); setEditingStockId(product.id); setEditingStockVal(String(product.subtype === '향미유' ? Math.floor(product.stock / 12) : displayStock)); }}
                            className={`text-base font-black hover:underline hover:text-indigo-600 transition-colors cursor-pointer ${isCritical ? 'text-rose-600' : 'text-slate-800'}`}
                            title="클릭하여 수량 수정"
                          >
                            {product.subtype === '향미유' ? fmtHamiyou(product.stock) : displayStock}
                          </button>
                        )}
                        {derivedCans == null && editingStockId !== product.id && (
                          <span className="text-[10px] text-slate-400 ml-1">
                            {product.category !== '향미유' && product.unit}
                          </span>
                        )}
                        {product.unpackTo && editingStockId !== product.id && (
                          <button
                            onClick={e => { e.stopPropagation(); unpackBox(product); }}
                            className="ml-1.5 text-[9px] font-black px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-600 border border-amber-200 hover:bg-amber-100 transition-colors align-middle"
                            title={`1박스 개봉 → 낱개 +${product.unpackTo.count}`}
                          >개봉 +{product.unpackTo.count}</button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right hidden sm:table-cell">
                        {product.category !== '완제품'
                          ? <span className="text-xs font-bold text-slate-400">{product.minStock} {product.unit}</span>
                          : <span className="text-[10px] text-slate-200">-</span>}
                      </td>
                      <td className="px-3 py-3 text-right hidden sm:table-cell">
                        <div className="flex items-center justify-end gap-1.5">
                          {purchasableIds.has(product.id) && (
                            inCart ? (
                              <button
                                onClick={e => { e.stopPropagation(); removeFromCart(product.id); }}
                                className="text-[10px] font-black px-2.5 py-1.5 rounded-xl bg-indigo-500 text-white hover:bg-indigo-600 transition-all shadow-sm"
                              >담김 ✓</button>
                            ) : inlineCartId === product.id ? (
                              <div className="flex items-center gap-1 justify-end" onClick={e => e.stopPropagation()}>
                                {product.subtype === '향미유' && (
                                  <div className="flex rounded-lg border border-indigo-200 overflow-hidden text-[9px] font-black">
                                    <button onClick={() => setInlineCartIsBox(false)} className={`px-1.5 py-1 transition-all ${!inlineCartIsBox ? 'bg-indigo-500 text-white' : 'bg-white text-slate-400'}`}>낱개</button>
                                    <button onClick={() => setInlineCartIsBox(true)} className={`px-1.5 py-1 transition-all ${inlineCartIsBox ? 'bg-indigo-500 text-white' : 'bg-white text-slate-400'}`}>BOX</button>
                                  </div>
                                )}
                                <input
                                  autoFocus
                                  type="number"
                                  value={inlineCartQty}
                                  onChange={e => setInlineCartQty(parseInt(e.target.value) || 0)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') { addToCart(product.id, inlineCartQty, product.subtype === '향미유' ? inlineCartIsBox : undefined); setInlineCartId(null); }
                                    if (e.key === 'Escape') setInlineCartId(null);
                                  }}
                                  className="w-14 text-center text-xs font-black border border-indigo-300 rounded-lg py-1 outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                                />
                                <span className="text-[10px] text-slate-400">{product.subtype === '향미유' && inlineCartIsBox ? 'BOX' : product.unit}</span>
                                <button
                                  onClick={() => { addToCart(product.id, inlineCartQty, product.subtype === '향미유' ? inlineCartIsBox : undefined); setInlineCartId(null); }}
                                  className="text-[10px] font-black px-2 py-1 rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 transition-all"
                                >담기</button>
                                <button onClick={() => setInlineCartId(null)} className="text-slate-300 hover:text-slate-500"><X size={12} /></button>
                              </div>
                            ) : (
                              <button
                                onClick={e => { e.stopPropagation(); setInlineCartId(product.id); setInlineCartQty(product.minStock * 2 || 20); setInlineCartIsBox(false); }}
                                className="text-[10px] font-black px-2.5 py-1.5 rounded-xl bg-slate-100 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 transition-all border border-slate-200"
                              >+ 담기</button>
                            )
                          )}
                          <button
                            onClick={e => { e.stopPropagation(); setRowEditProduct(product); setRowEditForm({ name: product.name, category: product.category, stock: product.stock, minStock: product.minStock, unit: product.unit }); }}
                            className="text-[10px] font-black px-2.5 py-1.5 rounded-xl bg-slate-100 text-slate-500 hover:bg-amber-50 hover:text-amber-600 hover:border-amber-200 transition-all border border-slate-200"
                          >{productEditable ? '수정' : '실사조정'}</button>
                        </div>
                      </td>
                    </tr>
                    {/* 볶음참깨 규격별 재고 패널 */}
                    {isExpanded && product.isRawMaterial && (() => {
                      const ics = partnerItems.filter(pi => pi.Direction === 'out' && pi.itemId === product.id);
                      // 고유 (displaySize, labelId) 조합
                      const variantMap = new Map<string, { displaySize: string; labelId: string; labelName: string; weightInKg: number }>();
                      for (const ic of ics) {
                        const key = `${ic.displaySize}||${ic.labelId ?? ''}`;
                        if (!variantMap.has(key)) {
                          const labelName = items.find(p => p.id === ic.labelId)?.name ?? (ic.labelId ? ic.labelId : '무라벨');
                          variantMap.set(key, { displaySize: ic.displaySize ?? '', labelId: ic.labelId ?? '', labelName, weightInKg: ic.weightInKg ?? 0 });
                        }
                      }
                      const variants = Array.from(variantMap.entries()).sort((a, b) => a[1].weightInKg - b[1].weightInKg);
                      const editing = editingVariantStocks[product.id] ?? {};
                      const currentStocks = product.variantStocks ?? {};
                      const totalKg = variants.reduce((sum, [key, v]) => {
                        const qty = editing[key] !== undefined ? editing[key] : (currentStocks[key] ?? 0);
                        return sum + qty * v.weightInKg;
                      }, 0);
                      const isDirty = variants.some(([key]) => editing[key] !== undefined);
                      return (
                        <tr className="bg-emerald-50/40">
                          <td colSpan={7} className="px-4 py-3">
                            <div className="flex flex-col gap-3">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-black text-emerald-700 uppercase tracking-wide">규격별 재고</span>
                                <span className="text-sm font-black text-emerald-800">합계 {totalKg.toFixed(1)} kg</span>
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                                {variants.map(([key, v]) => {
                                  const val = editing[key] !== undefined ? editing[key] : (currentStocks[key] ?? 0);
                                  return (
                                    <div key={key} className="flex flex-col gap-1 bg-white rounded-xl border border-emerald-100 px-3 py-2">
                                      <div className="flex items-center justify-between gap-1">
                                        <span className="text-[10px] font-black text-emerald-700">{v.displaySize}</span>
                                        <span className="text-[9px] font-bold text-slate-400 truncate max-w-[70px]">{v.labelName}</span>
                                      </div>
                                      <div className="flex items-center gap-1">
                                        <input
                                          type="number"
                                          min={0}
                                          value={val === 0 && editing[key] === undefined ? '' : val}
                                          placeholder="0"
                                          onClick={e => e.stopPropagation()}
                                          onChange={e => {
                                            const n = e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value) || 0);
                                            setEditingVariantStocks(prev => ({ ...prev, [product.id]: { ...(prev[product.id] ?? {}), [key]: n } }));
                                          }}
                                          className="w-full text-right text-sm font-black border border-emerald-200 rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-emerald-400 bg-white"
                                        />
                                        <span className="text-[10px] text-slate-400 shrink-0">개</span>
                                      </div>
                                      <span className="text-[9px] text-slate-400 text-right">{(val * v.weightInKg).toFixed(1)} kg</span>
                                    </div>
                                  );
                                })}
                              </div>
                              {isDirty && (
                                <div className="flex justify-end gap-2" onClick={e => e.stopPropagation()}>
                                  <button
                                    onClick={() => setEditingVariantStocks(prev => { const n = { ...prev }; delete n[product.id]; return n; })}
                                    className="text-[11px] font-black px-3 py-1.5 rounded-xl bg-slate-100 text-slate-500 border border-slate-200 hover:bg-slate-200 transition-all"
                                  >취소</button>
                                  <button
                                    onClick={async () => {
                                      const newStocks = { ...currentStocks, ...editing };
                                      await onUpdateItem({ ...product, variantStocks: newStocks });
                                      setEditingVariantStocks(prev => { const n = { ...prev }; delete n[product.id]; return n; });
                                    }}
                                    className="text-[11px] font-black px-3 py-1.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition-all shadow-sm"
                                  >저장</button>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })()}
                    {/* 로트 확인은 상단 '로트' 탭으로 이동 (여기선 표시하지 않음) */}
                    {/* 모바일 펼침 행 */}
                    {isExpanded && (
                      <tr className="sm:hidden bg-slate-50/80">
                        <td colSpan={3} className="px-4 py-3">
                          <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-black text-slate-400 uppercase">최소수량</span>
                              <span className="text-xs font-bold text-slate-500">
                                {product.category !== '완제품' ? `${product.minStock} ${product.unit}` : '-'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-black text-slate-400 uppercase">상태</span>
                              <div>{statusBadge}</div>
                            </div>
                            <div className="flex items-center gap-2 pt-1" onClick={e => e.stopPropagation()}>
                              {purchasableIds.has(product.id) && (
                                inCart ? (
                                  <button
                                    onClick={() => removeFromCart(product.id)}
                                    className="flex-1 text-[11px] font-black py-2 rounded-xl bg-indigo-500 text-white"
                                  >담김 ✓</button>
                                ) : inlineCartId === product.id ? (
                                  <div className="flex-1 flex flex-col gap-1">
                                    {product.subtype === '향미유' && (
                                      <div className="flex rounded-lg border border-indigo-200 overflow-hidden text-[10px] font-black self-start">
                                        <button onClick={() => setInlineCartIsBox(false)} className={`px-2 py-1 transition-all ${!inlineCartIsBox ? 'bg-indigo-500 text-white' : 'bg-white text-slate-400'}`}>낱개</button>
                                        <button onClick={() => setInlineCartIsBox(true)} className={`px-2 py-1 transition-all ${inlineCartIsBox ? 'bg-indigo-500 text-white' : 'bg-white text-slate-400'}`}>BOX</button>
                                      </div>
                                    )}
                                    <div className="flex items-center gap-1">
                                      <input
                                        autoFocus
                                        type="number"
                                        value={inlineCartQty}
                                        onChange={e => setInlineCartQty(parseInt(e.target.value) || 0)}
                                        onKeyDown={e => {
                                          if (e.key === 'Enter') { addToCart(product.id, inlineCartQty, product.subtype === '향미유' ? inlineCartIsBox : undefined); setInlineCartId(null); setExpandedRowId(null); }
                                          if (e.key === 'Escape') setInlineCartId(null);
                                        }}
                                        className="flex-1 text-center text-xs font-black border border-indigo-300 rounded-lg py-1.5 outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                                      />
                                      <span className="text-[10px] text-slate-400">{product.subtype === '향미유' && inlineCartIsBox ? 'BOX' : product.unit}</span>
                                      <button
                                        onClick={() => { addToCart(product.id, inlineCartQty, product.subtype === '향미유' ? inlineCartIsBox : undefined); setInlineCartId(null); setExpandedRowId(null); }}
                                        className="text-[11px] font-black px-3 py-1.5 rounded-xl bg-indigo-500 text-white"
                                      >담기</button>
                                      <button onClick={() => setInlineCartId(null)} className="text-slate-300"><X size={14} /></button>
                                    </div>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => { setInlineCartId(product.id); setInlineCartQty(product.minStock * 2 || 20); setInlineCartIsBox(false); }}
                                    className="flex-1 text-[11px] font-black py-2 rounded-xl bg-slate-100 text-slate-500 border border-slate-200"
                                  >+ 발주담기</button>
                                )
                              )}
                              <button
                                onClick={() => { setRowEditProduct(product); setRowEditForm({ name: product.name, category: product.category, stock: product.stock, minStock: product.minStock, unit: product.unit }); setExpandedRowId(null); }}
                                className="flex-1 text-[11px] font-black py-2 rounded-xl bg-slate-100 text-slate-500 border border-slate-200"
                              >{productEditable ? '수정' : '실사조정'}</button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                })}
                {pagedRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-16 text-center">
                      <div className="flex flex-col items-center gap-2 text-slate-300">
                        <Package size={32} strokeWidth={1.5} />
                        <p className="text-sm font-bold">등록된 품목이 없습니다</p>
                        <p className="text-xs font-medium">상단의 + 버튼으로 품목을 추가해보세요</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          </div>
        )}

        {/* ── 원료재고 전체 입출고 기록 (원료 필터 + 유형 필터 + 페이지네이션) ── */}
        {activeTab === 'master' && topTab === 'rawmaterial' && (() => {
          const materials = Array.from(new Set(rawMaterialLedger.map(e => e.material).filter(Boolean))).sort();
          const ledgerMonths = Array.from(new Set(rawMaterialLedger.map(e => (e.date ?? '').slice(0, 7)).filter(Boolean))).sort().reverse();
          const oneMonthAgo = (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 10); })();
          const entries = (ledgerMaterialFilter === '전체'
            ? rawMaterialLedger
            : rawMaterialLedger.filter(e => e.material === ledgerMaterialFilter)
          ).filter(e => {
            if (ledgerPeriod === 'all') return true;
            if (ledgerPeriod === '1m') return (e.date ?? '') >= oneMonthAgo;
            return (e.date ?? '').slice(0, 7) === ledgerPeriod; // 특정 월(YYYY-MM)
          });
          return (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mt-4">
              <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <History size={14} className="text-slate-400" />
                  <h3 className="text-xs font-black text-slate-700 uppercase tracking-wider">전체 입출고 기록</h3>
                </div>
                <div className="flex items-center gap-2">
                  <select value={ledgerPeriod} onChange={e => setLedgerPeriod(e.target.value)}
                    className="border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-600 outline-none focus:ring-2 focus:ring-teal-400 bg-white">
                    <option value="1m">최근 1개월</option>
                    <option value="all">전체 기간</option>
                    {ledgerMonths.length > 0 && (
                      <optgroup label="월별">
                        {ledgerMonths.map(m => <option key={m} value={m}>{m}</option>)}
                      </optgroup>
                    )}
                  </select>
                  <select value={ledgerMaterialFilter} onChange={e => setLedgerMaterialFilter(e.target.value)}
                    className="border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-600 outline-none focus:ring-2 focus:ring-teal-400 bg-white">
                    <option value="전체">전체 원료</option>
                    {materials.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>
              <div className="p-4">
                <RawLedgerList
                  entries={entries}
                  isAdmin={isAdmin}
                  currentUserName={currentUser?.name}
                  onDelete={onDeleteRawMaterialEntry}
                  showMaterial={ledgerMaterialFilter === '전체'}
                  pageSize={12}
                  emptyText="입출고 기록 없음"
                />
              </div>
              {!isAdmin && (
                <p className="px-5 py-2 text-[10px] text-slate-400 border-t border-slate-100">
                  삭제는 관리자만 가능합니다.
                </p>
              )}
            </div>
          );
        })()}

        {/* ── 행 수정 모달 ── */}
        {rowEditProduct && (
          <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setRowEditProduct(null)} />
            <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
              <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-base font-black text-slate-900">{productEditable ? '품목 수정' : '재고 실사조정'}</h3>
                <button onClick={() => setRowEditProduct(null)} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg"><X size={18} /></button>
              </div>
              <div className="p-5 space-y-4">
                {/* 품목 정보 — 재고관리에선 읽기 전용(실사조정). 편집은 품목관리에서. */}
                {productEditable ? (
                  <>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">카테고리</label>
                      <select
                        value={rowEditForm.category as string || ''}
                        onChange={e => setRowEditForm(f => ({ ...f, category: e.target.value as any }))}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                      >
                        {['완제품','향미유','고춧가루','용기','마개','테이프','박스','라벨'].map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">품목명</label>
                      <input
                        type="text"
                        value={rowEditForm.name || ''}
                        onChange={e => setRowEditForm(f => ({ ...f, name: e.target.value }))}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                      />
                    </div>
                  </>
                ) : (
                  <div className="bg-slate-50 rounded-2xl px-4 py-3">
                    <p className="text-sm font-black text-slate-800">{withSpec(rowEditProduct)}</p>
                    <p className="text-[11px] text-slate-400 font-bold mt-0.5">
                      {rowEditProduct.category} · 단위 {rowEditProduct.unit || '-'}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-1.5">
                      실물을 세어 보고 <b>현재 재고</b>를 맞춰주세요. 품목명·카테고리·단위는 관리자만 바꿀 수 있습니다.
                    </p>
                  </div>
                )}
                {/* 현재 재고 + 최소 수량 */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">현재 재고</label>
                    <input
                      type="number"
                      value={rowEditForm.stock ?? ''}
                      onChange={e => setRowEditForm(f => ({ ...f, stock: parseInt(e.target.value) || 0 }))}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                    />
                    {!productEditable && (rowEditForm.stock ?? 0) !== (rowEditProduct.stock ?? 0) && (
                      <p className="text-[10px] font-black text-amber-600 mt-1">
                        앱 재고 {rowEditProduct.stock ?? 0} → {rowEditForm.stock ?? 0}
                        {' '}({(rowEditForm.stock ?? 0) > (rowEditProduct.stock ?? 0) ? '+' : ''}{(rowEditForm.stock ?? 0) - (rowEditProduct.stock ?? 0)})
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">최소 수량</label>
                    <input
                      type="number"
                      value={rowEditForm.minStock ?? ''}
                      onChange={e => setRowEditForm(f => ({ ...f, minStock: parseInt(e.target.value) || 0 }))}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                    />
                  </div>
                </div>
                {/* 단위 — 품목관리에서만 */}
                {productEditable && (
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">단위</label>
                    <input
                      type="text"
                      value={rowEditForm.unit || ''}
                      onChange={e => setRowEditForm(f => ({ ...f, unit: e.target.value }))}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                    />
                  </div>
                )}
              </div>
              <div className="p-5 border-t border-slate-100 flex gap-2">
                <button onClick={() => setRowEditProduct(null)} className="flex-1 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-xl text-sm">취소</button>
                <button
                  onClick={async () => {
                    const p = rowEditProduct!;
                    // 직원은 실사조정만 — 카테고리·품목명·단위는 UI뿐 아니라 저장에서도 막는다
                    const form = productEditable ? rowEditForm : { stock: rowEditForm.stock, minStock: rowEditForm.minStock };
                    const { stock: newStock, ...meta } = form;
                    if (isRawHolder(p) && newStock !== undefined && newStock !== p.stock) {
                      // 원료: 재고(stock)·로트(lots)는 commitStockEdit(트랜잭션)이 관리한다.
                      // 메타 저장이 옛 stock/lots로 덮어써 로트가 사라지는 경합을 막으려 둘을 제외하고 먼저 반영.
                      const { stock: _s, lots: _l, ...metaOnly } = { ...p, ...meta } as any;
                      await onUpdateItem(metaOnly as Item);
                      await commitStockEdit(p, newStock);
                    } else {
                      await onUpdateItem({ ...p, ...form } as Item);
                    }
                    setRowEditProduct(null);
                  }}
                  className="flex-1 py-2.5 bg-indigo-600 text-white font-bold rounded-xl text-sm hover:bg-indigo-700 transition-all"
                >{productEditable ? '저장' : '실사 반영'}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── 발주 내역 (카트 + 이력) ── */}
        {activeTab === 'requests' && (
          <div className="space-y-4 pb-32">
            {/* 장바구니 섹션 */}
            {cart.length > 0 && (
              <>
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-slate-50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ShoppingCart size={16} className="text-indigo-500" />
                      <span className="font-black text-sm text-slate-800">발주 예정 목록</span>
                      <span className="text-[10px] font-black bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full">{cart.length}건</span>
                    </div>
                    <button onClick={() => setCart([])} className="text-[10px] font-bold text-slate-400 hover:text-rose-500 transition-all">전체 비우기</button>
                  </div>
                  <div className="divide-y divide-slate-50">
                    {cart
                      .filter(item => {
                        if (activeSupplierId === '전체') return true;
                        return psMap.get(item.id) === activeSupplierId;
                      })
                      .map(item => {
                      const product = productMap.get(item.id);
                      if (!product) return null;
                      const partnerName = inboundPartnerMap.get(psMap.get(product.id) ?? '')?.name;
                      return (
                        <div key={item.id} className="px-5 py-3 flex items-center gap-4">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-slate-800 truncate">{withSpec(product)}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <p className="text-[10px] text-slate-400">
                                현재 재고 {product.subtype === '향미유' ? fmtHamiyou(product.stock) : `${displayStockOf(product)} ${product.unit}`}
                              </p>
                              {partnerName && (
                                <span className="text-[10px] font-black text-orange-500 bg-orange-50 px-1.5 py-0.5 rounded-md">{partnerName}</span>
                              )}
                            </div>
                          </div>
                          {product.subtype === '향미유' && (
                            <button
                              onClick={() => onUpdateOrderRequestIsBox?.(item.id, !item.isBox)}
                              className={`text-[10px] font-black px-2 py-1 rounded-lg border transition-all shrink-0 ${item.isBox ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-slate-500 border-slate-200 hover:border-purple-300'}`}
                            >{item.isBox ? 'BOX' : '낱개'}</button>
                          )}
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button onClick={() => updateCartQty(item.id, item.qty - 1)} className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-black transition-all">-</button>
                            <input
                              type="number"
                              value={item.qty}
                              onChange={e => updateCartQty(item.id, parseInt(e.target.value) || 0)}
                              className="w-14 text-center text-sm font-black border border-slate-200 rounded-xl py-1.5 outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                            />
                            <button onClick={() => updateCartQty(item.id, item.qty + 1)} className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-black transition-all">+</button>
                            <span className="text-[11px] text-slate-400 shrink-0">
                              {product.subtype === '향미유' ? (item.isBox ? `B(${item.qty * 12}개)` : '개') : product.unit}
                            </span>
                          </div>
                          <button onClick={() => removeFromCart(item.id)} className="text-slate-300 hover:text-rose-400 transition-all shrink-0 ml-1"><X size={15} /></button>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {isAdmin && (
                  <button
                    onClick={() => setShowCartModal(true)}
                    className="w-full py-4 bg-indigo-600 text-white rounded-2xl text-sm font-black shadow-lg hover:bg-indigo-700 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
                  >
                    <ShoppingCart size={16} />
                    전표 작성 ({cart.length}건)
                  </button>
                )}
              </>
            )}

            {/* 선입고 섹션 — 발주 없이 스캔된 입고 (전표 작성 전) */}
            {activeTab === 'requests' && (() => {
              const unlinked = receivedOrders.filter(r => !r.linkedStatementId);
              if (unlinked.length === 0) return null;
              return (
                <div className="bg-white rounded-2xl border border-amber-100 shadow-sm overflow-hidden mb-4">
                  <div className="px-5 py-3 border-b border-amber-50 flex items-center justify-between bg-amber-50/50">
                    <div className="flex items-center gap-2">
                      <Inbox size={15} className="text-amber-500" />
                      <span className="font-black text-sm text-slate-800">선입고</span>
                      <span className="text-[10px] font-black bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{unlinked.length}건</span>
                      <span className="text-[10px] text-slate-400">전표 작성 전 · 재고 반영 완료</span>
                    </div>
                  </div>
                  <div className="divide-y divide-slate-50">
                    {unlinked.sort((a, b) => (b.receivedAt ?? '').localeCompare(a.receivedAt ?? '')).map(r => (
                      <div key={r.id} className="px-5 py-3 flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-bold text-xs text-slate-700">{r.partnerName || '거래처 미확인'}</span>
                            <span className="text-[10px] text-slate-400">{(r.receivedAt ?? '').slice(0, 10)}</span>
                          </div>
                          {(r.items ?? []).map((item, i) => (
                            <div key={i} className="flex items-center gap-1 text-xs text-slate-600">
                              <span>{item.name}</span>
                              <span className="text-slate-400">·</span>
                              <span className="font-bold">{item.quantity.toLocaleString()} {item.unit}</span>
                            </div>
                          ))}
                        </div>
                        {isAdmin && onRequestPurchaseInvoice && (
                          <button
                            onClick={() => {
                              onRequestPurchaseInvoice(
                                '',
                                r.partnerName ?? '',
                                (r.items ?? []).map(i => ({ name: i.name, spec: '', qty: i.quantity, price: 0 }))
                              );
                            }}
                            className="shrink-0 flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-xl text-[11px] font-black hover:bg-indigo-700 transition-all"
                          >
                            전표 작성
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* 발주 내역 — 입고 대기 (통합: 수동 발주 + 전표 기반) */}
            {(() => {
              const pendingStatements = issuedStatements.filter(s => s.type === '매입' && !s.taxIssuedAt);
              // 전표에 이미 포함된 품목명 집합 (수동 발주 중복 방지)
              const statementItemNames = new Set(pendingStatements.flatMap(s => s.items.map(i => i.name)));
              const confirmedWithoutStatement = confirmedOrders.filter(conf => {
                const product = productMap.get(conf.id);
                return product && !statementItemNames.has(product.name);
              });
              const totalCount = confirmedWithoutStatement.length;

              if (totalCount === 0 && cart.length === 0) return (
                <div className="bg-white rounded-2xl border border-slate-100 py-20 flex flex-col items-center justify-center gap-3 opacity-30">
                  <ClipboardCheck size={40} />
                  <p className="text-sm font-bold">발주 내역이 없습니다</p>
                </div>
              );
              if (totalCount === 0) return null;

              return (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-slate-50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ClipboardCheck size={16} className="text-emerald-500" />
                      <span className="font-black text-sm text-slate-800">입고 대기</span>
                      <span className="text-[10px] font-black bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full">{totalCount}건</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {isAdmin && confirmedChecked.size > 0 && onRequestPurchaseInvoice && (
                        <button
                          onClick={() => setShowConfirmedModal(true)}
                          className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-xl text-[11px] font-black hover:bg-indigo-700 transition-all"
                        >
                          전표 작성 ({confirmedChecked.size})
                        </button>
                      )}
                      {confirmedOrders.length > 0 && (
                        <button onClick={onClearAllConfirmedOrders} className="text-[10px] font-bold text-slate-400 hover:text-rose-500 transition-all">전체 비우기</button>
                      )}
                    </div>
                  </div>
                  <div className="divide-y divide-slate-50">
                    {/* 전표 기반 입고확인 제거됨 — 매입전표는 발주카드만 생성하고, 재고 반영은 발주카드 '입고확정'(lot)으로 처리 */}
                    {/* 전표 없는 수동 입고 대기 */}
                    {confirmedWithoutStatement
                      .filter(conf => {
                        if (activeSupplierId === '전체') return true;
                        return psMap.get(conf.id) === activeSupplierId;
                      })
                      .map(conf => {
                        const product = productMap.get(conf.id);
                        if (!product) return null;
                        const partnerName = inboundPartnerMap.get(psMap.get(product.id) ?? '')?.name;
                        const isExpanded = expandedReqId === conf.id;
                        return (
                          <div key={conf.id}>
                            <div className="px-5 py-3 flex items-center gap-3">
                              <input
                                type="checkbox"
                                checked={confirmedChecked.has(conf.id)}
                                onChange={e => {
                                  setConfirmedChecked(prev => {
                                    const next = new Set(prev);
                                    e.target.checked ? next.add(conf.id) : next.delete(conf.id);
                                    return next;
                                  });
                                }}
                                className="w-4 h-4 accent-indigo-600 cursor-pointer shrink-0"
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-slate-800 truncate">{withSpec(product)}</p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <p className="text-[10px] text-slate-400">{product.category}</p>
                                  {partnerName && (
                                    <span className="text-[10px] font-black text-orange-500 bg-orange-50 px-1.5 py-0.5 rounded-md">{partnerName}</span>
                                  )}
                                  <span className="text-[9px] font-black text-amber-600 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded-md">전표없음</span>
                                </div>
                              </div>
                              <span className="text-xs font-black text-emerald-700 bg-emerald-50 border border-emerald-100 px-2.5 py-1 rounded-xl shrink-0">입고대기 {conf.quantity}{product.unit}</span>
                              {isAdmin && psMap.get(product.id) && onRequestPurchaseInvoice && (
                                <button
                                  onClick={() => {
                                    onRequestPurchaseInvoice(
                                      psMap.get(product.id)!,
                                      partnerName || '',
                                      [{ name: product.name, spec: product.spec || '', qty: conf.quantity, price: product.price ?? 0 }]
                                    );
                                  }}
                                  className="text-[10px] font-black px-2.5 py-1.5 rounded-xl transition-all shrink-0 border bg-white text-indigo-600 border-indigo-200 hover:bg-indigo-50"
                                >전표</button>
                              )}
                              <button
                                onClick={() => {
                                  if (isExpanded) { setExpandedReqId(null); }
                                  else { setExpandedReqId(conf.id); setReqEditQty(conf.quantity); setReqNote(''); }
                                }}
                                className={`text-[10px] font-black px-2.5 py-1.5 rounded-xl transition-all shrink-0 border ${isExpanded ? 'bg-slate-100 text-slate-500 border-slate-200' : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'}`}
                              >{isExpanded ? '닫기' : '수정'}</button>
                              <button
                                onClick={() => onFinishConfirmedOrder(product.id)}
                                className="text-[10px] font-black px-2.5 py-1.5 rounded-xl bg-slate-800 text-white hover:bg-slate-900 transition-all shrink-0"
                              >입고확인</button>
                            </div>
                            {isExpanded && (
                              <div className="px-5 py-4 bg-slate-50/60 space-y-3 animate-in slide-in-from-top-1 duration-150">
                                <div className="flex items-center gap-3">
                                  <span className="text-[10px] font-black text-slate-500 w-16 shrink-0">수량 변경</span>
                                  <div className="flex items-center gap-1.5">
                                    <button onClick={() => setReqEditQty(q => Math.max(1, q - 1))} className="w-7 h-7 flex items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-600 font-black hover:bg-slate-100 transition-all">-</button>
                                    <input
                                      type="number"
                                      value={reqEditQty}
                                      onChange={e => setReqEditQty(parseInt(e.target.value) || 1)}
                                      className="w-16 text-center text-sm font-black border border-slate-200 rounded-xl py-1.5 outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                                    />
                                    <button onClick={() => setReqEditQty(q => q + 1)} className="w-7 h-7 flex items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-600 font-black hover:bg-slate-100 transition-all">+</button>
                                    <span className="text-[11px] text-slate-400">{product.unit}</span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="text-[10px] font-black text-slate-500 w-16 shrink-0">사유</span>
                                  <input
                                    type="text"
                                    value={reqNote}
                                    onChange={e => setReqNote(e.target.value)}
                                    placeholder="수량 수정 사유 (선택)"
                                    className="flex-1 text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                                  />
                                </div>
                                <div className="flex gap-2 pt-1">
                                  <button
                                    onClick={() => { onRemoveConfirmedOrder(conf.id); setExpandedReqId(null); }}
                                    className="py-2 px-3 bg-rose-50 border border-rose-100 text-rose-500 rounded-xl text-xs font-black hover:bg-rose-100 transition-all"
                                  >발주 취소</button>
                                  <button
                                    onClick={() => {
                                      onUpdateConfirmedQty(conf.id, reqEditQty);
                                      setExpandedReqId(null);
                                    }}
                                    className="flex-1 py-2 bg-white border border-indigo-200 text-indigo-600 rounded-xl text-xs font-black hover:bg-indigo-50 transition-all"
                                  >수량 저장</button>
                                  <button
                                    onClick={() => { onFinishConfirmedOrder(conf.id); setExpandedReqId(null); }}
                                    className="flex-1 py-2 bg-slate-800 text-white rounded-xl text-xs font-black hover:bg-slate-900 transition-all"
                                  >입고 확인</button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-1 py-5">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}
              className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-400 hover:bg-white disabled:opacity-30 transition-all">←</button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
              <button key={p} onClick={() => setPage(p)}
                className={`w-8 h-8 rounded-lg text-xs font-black transition-all ${safePage === p ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:bg-white'}`}>
                {p}
              </button>
            ))}
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
              className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-400 hover:bg-white disabled:opacity-30 transition-all">→</button>
          </div>
        )}
      </div>}


      {/* Draft Orders Floating Button removed as requested */}

      {/* ── 플로팅 카트 아이콘 ── */}
      {topTab === 'submaterial' && cart.length > 0 && (
        <button
          onClick={() => setShowCartPanel(true)}
          className="fixed bottom-8 right-6 z-40 flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-3 rounded-2xl shadow-xl transition-all active:scale-95 animate-in fade-in zoom-in-95 duration-300"
        >
          <ShoppingCart size={20} />
          <span className="font-black text-sm">발주 내역</span>
          <span className="w-6 h-6 bg-white text-indigo-600 text-xs font-black rounded-full flex items-center justify-center shadow-sm">{cart.length}</span>
        </button>
      )}

      {/* ── 발주 장바구니 패널 ── */}
      {showCartPanel && (
        <>
          <div className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm" onClick={() => setShowCartPanel(false)} />
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-sm flex flex-col bg-white shadow-2xl animate-in slide-in-from-right-4 duration-300">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-indigo-600 text-white"><ShoppingCart size={18} /></div>
                <div>
                  <h3 className="font-black text-slate-900">발주 내역</h3>
                  <p className="text-[11px] text-slate-400 font-medium">{cart.length}개 품목</p>
                </div>
              </div>
              <button onClick={() => setShowCartPanel(false)} className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 transition-all">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-2">
              {cart.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full opacity-30 gap-3">
                  <ShoppingCart size={36} />
                  <p className="text-sm font-bold">담긴 품목이 없습니다</p>
                </div>
              ) : cart.map(item => {
                const product = items.find(p => p.id === item.id);
                if (!product) return null;
                return (
                  <div key={item.id} className="bg-slate-50 rounded-2xl border border-slate-100 p-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-800 truncate">{withSpec(product)}</p>
                      <p className="text-[10px] text-slate-400 font-medium">현재 재고 {product.subtype === '향미유' ? fmtHamiyou(product.stock) : `${displayStockOf(product)}${product.unit}`}</p>
                      {product.subtype === '향미유' && (
                        <div className="flex rounded-lg border border-indigo-200 overflow-hidden text-[9px] font-black mt-1 w-fit">
                          <button onClick={() => updateCartIsBox(item.id, false)} className={`px-2 py-0.5 transition-all ${!item.isBox ? 'bg-indigo-500 text-white' : 'bg-white text-slate-400'}`}>낱개</button>
                          <button onClick={() => updateCartIsBox(item.id, true)} className={`px-2 py-0.5 transition-all ${item.isBox ? 'bg-indigo-500 text-white' : 'bg-white text-slate-400'}`}>BOX</button>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button onClick={() => updateCartQty(item.id, item.qty - 1)} className="w-6 h-6 flex items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-100 text-sm font-black transition-all">-</button>
                      <input
                        type="number"
                        value={item.qty}
                        onChange={e => updateCartQty(item.id, parseInt(e.target.value) || 0)}
                        className="w-12 text-center text-sm font-black border border-slate-200 rounded-lg py-1 outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                      />
                      <button onClick={() => updateCartQty(item.id, item.qty + 1)} className="w-6 h-6 flex items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-100 text-sm font-black transition-all">+</button>
                      <span className="text-[10px] text-slate-400 w-6">{product.subtype === '향미유' && item.isBox ? 'BOX' : product.unit}</span>
                    </div>
                    <button onClick={() => removeFromCart(item.id)} className="text-slate-300 hover:text-rose-400 transition-all shrink-0">
                      <X size={14} />
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="px-4 pt-4 border-t border-slate-100 space-y-2" style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))' }}>
              <button
                type="button"
                disabled={cart.length === 0 || isConfirming}
                onClick={async () => {
                  if (cart.length === 0 || isConfirming) return;
                  setIsConfirming(true);
                  try {
                    await submitCart();
                  } catch (e) {
                    console.error('확정 처리 오류:', e);
                    const msg = e instanceof Error ? e.message : String(e);
                    alert(`확정 처리 중 오류가 발생했습니다.\n\n${msg}`);
                  } finally {
                    setIsConfirming(false);
                  }
                }}
                className="w-full py-3.5 bg-indigo-600 text-white rounded-2xl text-sm font-black shadow-lg hover:bg-indigo-700 active:scale-[0.98] transition-all disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-2"
              >
                <ClipboardCheck size={16} />
                {isConfirming ? '처리 중...' : `확정 (${cart.length}건)`}
              </button>
              <button
                type="button"
                onClick={() => setCart([])}
                className="w-full py-2.5 text-xs font-bold text-slate-400 hover:text-slate-600 transition-all"
              >전체 비우기</button>
            </div>
          </div>
        </>
      )}

      {/* 분류 관리는 품목 관리(관리자 메뉴)로 이동됨 */}

      {/* ── 재고 만들기 — 품목 골라 만든 수량만큼 재고 +N ── */}
      {isAddModalOpen && (() => {
        const picked = Object.entries(makeQty).filter(([, v]) => (parseFloat(v) || 0) > 0);
        const kw = makeSearch.trim();

        // 원료·부자재는 제외 — 만드는 게 아니라 사오는 것, 입고/실사조정으로만 움직인다
        const base = items.filter(p => !p.archived && !p.phantom && !isRawHolder(p) && !isSubmaterial(p.category));
        // 분류 — 완제품은 subtype이 없고 이름/품목키로 갈리므로 품명 기준으로 묶는다
        const nameOf = (p: Item) => `${p.품목 ?? ''} ${p.name}`;
        const inCat = (p: Item, c: string): boolean => {
          const s = nameOf(p);
          if (c === '참기름') return /참기름/.test(s);
          if (c === '들기름') return /들기름/.test(s);
          return !/참기름/.test(s) && !/들기름/.test(s);   // 기타 — 참기름·들기름 외 전부(참깨·들깨·선물세트 등)
        };
        // 용기(180/300/350/1750/1800) — 품목설정의 용량(spec)을 우선 참고. spec은 "1750ml"처럼 정규화돼
        //   있어 이름("1.75ML")보다 신뢰도 높고, BOM/부자재가 비어 있어도 안전. spec 없으면 이름 ml로 폴백.
        const vesselKey = (p: Item): string | null => {
          const src = `${p.spec ?? ''}`;
          let m = src.match(/(\d+(?:\.\d+)?)\s*ml/i);
          if (m) return String(Math.round(parseFloat(m[1])));         // "1500ml" → "1500"
          m = src.match(/(\d+(?:\.\d+)?)\s*l(?![a-z])/i);
          if (m) return String(Math.round(parseFloat(m[1]) * 1000));  // "1.75L" → "1750"
          m = src.match(/(\d+(?:\.\d+)?)\s*kg/i);
          if (m) return `${parseFloat(m[1])}kg`;                      // "16.5kg" → "16.5kg" (캔)
          m = `${p.name}`.match(/(\d+(?:\.\d+)?)\s*ml/i);
          return m ? String(Math.round(parseFloat(m[1]))) : null;
        };
        const matchVessel = (p: Item, size: string): boolean => vesselKey(p) === size;
        // 등급(골드/A/분/특A) — 이름의 '/'·괄호 구분 토큰 기준. A는 정확히 'A' 토큰만(골드A·특A는 제외),
        //   골드/분/특A는 토큰 부분포함(특골드·골드A는 골드로, 특A는 특A로 잡힘).
        const matchGrade = (p: Item, g: string): boolean => {
          const toks = `${p.품목 ?? ''}/${p.name}`.split(/[/()]/).map(s => s.trim());
          // A·특은 정확일치(골드A·특A·특골드와 안 겹치게), 나머지는 토큰 부분포함
          return (g === 'A' || g === '특') ? toks.some(t => t === g) : toks.some(t => t.includes(g));
        };
        // 실제 품목이 있는 분류만 탭으로 (빈 탭 안 만듦)
        const MAKE_CATS = ['참기름', '들기름', '기타']
          .map(c => ({ c, n: base.filter(p => inCat(p, c)).length }))
          .filter(x => x.n > 0);
        // 없어진 분류가 골라져 있으면 첫 탭으로
        const cat = MAKE_CATS.some(x => x.c === makeCat) ? makeCat : (MAKE_CATS[0]?.c ?? '');

        // 검색: 품목명·품목키·거래처(매출처), '+'로 여러 키워드 AND. 초성 검색 유지.
        const makeTokens = parseSearchTokens(kw);
        const matchMake = (p: Item) => {
          const partnerStr = salesPartnerNames.get(p.id) ?? '';
          return makeTokens.every(t =>
            matchesSearch(withSpec(p), t) || matchesSearch(p.품목 ?? '', t) || matchesSearch(partnerStr, t));
        };
        // 순서는 건드리지 않는다 — 수량 넣었다고 목록이 움직이면 이어서 못 적는다.
        // 검색 중이면 분류·용기·등급을 무시하고 전체에서 찾는다(거래처 검색 시 다른 탭 품목도 나오게).
        const showSub = cat === '참기름' || cat === '들기름';   // 용기·등급 필터는 기름류에서만
        const listedItems = makeTokens.length > 0
          ? base.filter(matchMake)
          : base.filter(p => inCat(p, cat)
              && (!showSub || !makeVessel || matchVessel(p, makeVessel))
              && (!showSub || !makeGrade || matchGrade(p, makeGrade)));
        // 낱개 밑에 박스 묶어서 표시 (수량과 무관한 고정 정렬이라 입력 중에도 안 움직임)
        const listed = groupLooseBoxRows(listedItems);

        const commit = async () => {
          if (picked.length === 0 || makeBusy) return;
          setMakeBusy(true);
          try {
            for (const [id, v] of picked) {
              const p = items.find(x => x.id === id);
              if (!p || isRawHolder(p)) continue;   // 원료는 대상 아님
              const add = parseFloat(v) || 0;
              if (add <= 0) continue;
              onUpdateItem({ ...p, stock: Math.round(((p.stock ?? 0) + add) * 1000) / 1000 });
            }
            setToast({ message: `${picked.length}개 품목 재고를 늘렸습니다` });
            setIsAddModalOpen(false);
          } finally {
            setMakeBusy(false);
          }
        };

        return (
          <div className="fixed inset-0 z-[1100] flex items-end sm:items-center justify-center sm:p-4">
            <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setIsAddModalOpen(false)} />
            {/* 모바일=바텀시트 전체화면, 데스크톱=가운데 카드 (목록 길이 무관 고정 높이) */}
            <div className="relative bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-xl h-[92dvh] sm:h-[85vh] flex flex-col animate-in zoom-in-95 duration-200">
              <div className="p-5 border-b border-slate-100 flex items-center justify-between shrink-0">
                <div>
                  <h3 className="text-base font-black text-slate-900">품목 추가하기</h3>
                  <p className="text-[11px] text-slate-400 font-bold mt-0.5">전체 품목에서 검색 → 수량 입력 → 확정하면 그만큼 재고가 생깁니다</p>
                </div>
                <button onClick={() => setIsAddModalOpen(false)} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg"><X size={18} /></button>
              </div>

              {/* 분류 탭 */}
              <div className="px-5 pt-3 flex gap-1.5 flex-wrap shrink-0">
                {MAKE_CATS.map(({ c, n }) => (
                  <button key={c} onClick={() => setMakeCat(c)}
                    className={`px-3 py-1.5 rounded-xl border text-xs font-black transition-all ${
                      cat === c ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                    }`}>
                    {c} <span className={cat === c ? 'text-indigo-200' : 'text-slate-300'}>{n}</span>
                  </button>
                ))}
              </div>

              {/* 용기·등급 필터 — 참기름·들기름에서만 (검색 중엔 숨김). 가로 스크롤 한 줄로 모바일 정리 */}
              {showSub && makeTokens.length === 0 && (
                <div className="px-5 pt-2 space-y-1 shrink-0">
                  <div className="flex items-center gap-1.5">
                    <span className="w-7 shrink-0 text-[10px] font-black text-slate-400">용기</span>
                    <div className="flex gap-1 overflow-x-auto no-scrollbar">
                      {['', '180', '300', '350', '1500', '1750', '1800'].map(v => (
                        <button key={v || 'all'} onClick={() => setMakeVessel(v)}
                          className={`shrink-0 px-2.5 py-1 rounded-lg border text-[11px] font-black transition-all ${makeVessel === v ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                          {v === '' ? '전체' : v}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-7 shrink-0 text-[10px] font-black text-slate-400">등급</span>
                    <div className="flex gap-1 overflow-x-auto no-scrollbar">
                      {['', '골드', 'A', '분', '특', '특A', '원액'].map(g => (
                        <button key={g || 'all'} onClick={() => setMakeGrade(g)}
                          className={`shrink-0 px-2.5 py-1 rounded-lg border text-[11px] font-black transition-all ${makeGrade === g ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                          {g === '' ? '전체' : g}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="px-5 py-3 shrink-0">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" />
                  <input
                    autoFocus value={makeSearch} onChange={e => setMakeSearch(e.target.value)} placeholder="품목·거래처 검색 (초성·+ 가능, 예: 참기름+가득찬)"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto divide-y divide-slate-50 border-t border-slate-50">
                {listed.length === 0 && (
                  <p className="px-5 py-16 text-center text-xs font-bold text-slate-300">
                    {kw ? '검색 결과가 없습니다' : '이 분류에 품목이 없습니다'}
                  </p>
                )}
                {listed.map(({ p, isChild }) => {
                  const v = makeQty[p.id] ?? '';
                  const add = parseFloat(v) || 0;
                  const cur = displayStockOf(p) ?? 0;
                  const low = p.minStock > 0 && cur < p.minStock;
                  // 이 품목에 들어가는 부자재 — 재고를 같이 보여준다
                  const subs = p.submaterials ?? [];
                  const lbl = parseMakeLabel(p);   // 대표이름 + 구분요소(등급·용량·개입·거래처)
                  return (
                    <div key={p.id} className={`px-4 sm:px-5 py-3.5 ${add > 0 ? 'bg-indigo-50/40' : isChild ? 'bg-slate-50/40' : ''} ${isChild ? 'pl-8 sm:pl-9' : ''}`}>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          {/* 이름 + 거래처 + 등급·용량(병/페트)·개입 배지 — 이름 옆 한 줄 그룹(넘치면 줄바꿈) */}
                          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                            <p className={`text-[15px] leading-tight break-keep ${isChild ? 'font-bold text-slate-500' : 'font-black text-slate-800'}`}>
                              {isChild && <span className="text-slate-300 mr-1">└</span>}{lbl.base}
                              {lbl.brand && <span className="ml-1.5 text-[13px] font-black text-violet-600">· {lbl.brand}</span>}
                            </p>
                            {lbl.grade && <span className="text-[11px] font-black px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-700">{lbl.grade}</span>}
                            {lbl.size && <span className="text-[11px] font-black px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600">{lbl.size}{lbl.container && <span className="ml-1 text-slate-400">{lbl.container}</span>}</span>}
                            {lbl.pack && <span className="text-[11px] font-black px-1.5 py-0.5 rounded-md bg-indigo-100 text-indigo-700">{lbl.pack}</span>}
                          </div>
                          {/* 품목에 물려있는 거래처(매출처) — 가로 스크롤 한 줄이라 많아도 UI 안 깨짐 */}
                          {p.partnerIds && p.partnerIds.length > 0 && (
                            <div className="flex gap-1 mt-1 overflow-x-auto no-scrollbar">
                              {p.partnerIds.map(cid => {
                                const cn = partners.find(c => c.id === cid)?.name;
                                return cn ? <span key={cid} className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-violet-50 text-violet-600">{cn}</span> : null;
                              })}
                            </div>
                          )}
                        </div>
                        {/* 현재고 → 입력칸 바로 왼쪽 */}
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="text-right leading-tight">
                            <p className={`text-[11px] font-bold ${low ? 'text-rose-500' : 'text-slate-400'}`}>현재 {cur.toLocaleString()}{p.unit || ''}</p>
                            {low && <p className="text-[10px] font-bold text-rose-400">최소 {p.minStock}</p>}
                            {add > 0 && <p className="text-[12px] font-black text-indigo-600">→ {(cur + add).toLocaleString()}</p>}
                          </div>
                          <input
                            inputMode="decimal" value={v} placeholder="0"
                            onChange={e => setMakeQty(q => ({ ...q, [p.id]: e.target.value.replace(/[^\d.]/g, '') }))}
                            className={`w-16 sm:w-20 shrink-0 border rounded-xl px-2.5 py-2.5 text-right text-base font-black tabular-nums outline-none focus:ring-2 focus:ring-indigo-400 ${add > 0 ? 'border-indigo-300 bg-white' : 'border-slate-200'}`}
                          />
                        </div>
                      </div>
                      {/* 부자재 — 이름 비슷할 때 구분용이라 더 크고 잘 보이게 */}
                      {subs.length > 0 && (
                        <div className="flex gap-1.5 flex-wrap mt-2">
                          {subs.map((s, i) => {
                            const sub = items.find(x => x.id === s.id);
                            return (
                              <span key={i}
                                className="text-[11px] font-bold px-2 py-1 rounded-lg border bg-slate-50 border-slate-200 text-slate-600">
                                {sub ? withSpec(sub) : s.name}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* 고른 것 — 목록은 안 흔들고, 여기에 모아서 보여준다 */}
              {picked.length > 0 && (
                <div className="px-5 py-3 border-t border-slate-100 bg-indigo-50/40 shrink-0 max-h-32 overflow-y-auto">
                  <div className="flex gap-1.5 flex-wrap">
                    {picked.map(([id, v]) => {
                      const p = items.find(x => x.id === id);
                      return (
                        <button key={id} onClick={() => setMakeQty(q => { const n = { ...q }; delete n[id]; return n; })}
                          className="flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 bg-white border border-indigo-200 rounded-lg text-[11px] font-black text-slate-700 hover:border-rose-300 hover:text-rose-500 group">
                          <span className="truncate max-w-[180px]">{p ? withSpec(p) : id}</span>
                          <span className="text-indigo-600 tabular-nums group-hover:text-rose-500">+{v}</span>
                          <X size={11} className="text-slate-300 group-hover:text-rose-400" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="p-5 border-t border-slate-100 flex items-center gap-2">
                <p className="flex-1 text-[11px] font-bold text-slate-400">
                  {picked.length > 0 ? `${picked.length}개 품목 선택됨` : '수량을 입력하면 선택됩니다'}
                </p>
                <button onClick={() => setIsAddModalOpen(false)} className="px-5 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-xl text-sm">취소</button>
                <button onClick={commit} disabled={picked.length === 0 || makeBusy}
                  className="px-5 py-2.5 bg-indigo-600 text-white font-bold rounded-xl text-sm hover:bg-indigo-700 disabled:opacity-30 transition-all">
                  {makeBusy ? '반영 중…' : '확정'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {confirmModal && (
        <ConfirmModal
          message={confirmModal.message}
          subMessage={confirmModal.subMessage}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}

      <RawMaterialEntryModal
        open={!!rawEntryModal}
        mode={rawEntryModal?.mode ?? 'inbound'}
        materials={RM_LIST as unknown as string[]}
        currentUserName={currentUser?.name}
        onClose={() => setRawEntryModal(null)}
        onSubmit={async (entry) => {
          // 원료수불부에 기록 (kg canonical)
          await onAddRawMaterialEntry(entry);
          const rawTarget = items.find((i) => isRawHolder(i) && baseRawName(i.name) === entry.material);
          if (rawTarget) {
            try {
            if ((entry.received ?? 0) > 0) {
              // 입고: 거래처 입고와 동일하게 로트 생성(+기존재고 이월 보존). stock은 로트 합계로 산정.
              const lot = buildReceiveLot({
                material: entry.material,
                supplierName: entry.note?.trim() || '직접입고',
                qtyIn: entry.canCount ?? 0,
                kgIn: entry.received,
                packageKg: entry.canSize,
                packageType: entry.canSizeTag,
                receivedDate: entry.date,
              });
              await mutateRawMaterialLots(
                rawTarget.id,
                (lots, stock) => settleCarryOver([...withCarryOverLot(lots, stock, entry.material), { ...lot, lotNo: nextLotNo(lots, lot.receivedDate) }]),
                (lots) => lotStockInUnit(lots, entry.material),
              );
            } else if ((entry.used ?? 0) > 0) {
              // 사용: 로트 FIFO(혼합 시 비율) 차감 — 기존재고 이월 보존 후 차감. stock은 로트 합계로 산정
              // (직접 stock만 줄이면 다음 로트연산 때 stock=로트합계로 덮어써져 사용분이 사라지므로 반드시 로트에서 차감)
              const mix = rawTarget.mixEnabled ? { topPercent: rawTarget.mixTopPercent ?? 50 } : undefined;
              await mutateRawMaterialLots(
                rawTarget.id,
                (lots, stock) => deductFromLots(withCarryOverLot(lots, stock, entry.material), entry.used, mix).lots,
                (lots) => lotStockInUnit(lots, entry.material),
              );
            } else {
              // 그 외(정정): stock 직접 X → 로트로 delta 반영 (수불부는 위 onAddRawMaterialEntry로 이미 기록)
              const delta = (entry.received ?? 0) - (entry.used ?? 0);
              if (Math.abs(delta) > 0.0001) {
                await mutateRawMaterialLots(
                  rawTarget.id,
                  (lots, stock) => {
                    const carried = withCarryOverLot(lots, stock, entry.material);
                    if (delta >= 0) {
                      const lot = buildReceiveLot({ material: entry.material, supplierName: '정정', qtyIn: 0, kgIn: delta, receivedDate: entry.date });
                      return settleCarryOver([...carried, { ...lot, lotNo: nextLotNo(carried, lot.receivedDate) }]);
                    }
                    return deductFromLots(carried, -delta).lots;
                  },
                  (lots) => lotStockInUnit(lots, entry.material),
                );
              }
            }
            } catch (err) {
              // 로트/재고 반영 실패(읽기 한도 외 네트워크 오류 등) — 수불부 기록은 이미 저장됨.
              // 예전엔 여기서 throw되어 모달이 안 닫히고 재시도 시 수불부 중복 기록이 생겼다.
              console.error('[원료 기록] 로트/재고 반영 실패:', err);
              setToast({ message: `${entry.material} 기록은 저장됐지만 재고 반영에 실패했습니다. 네트워크/재고를 확인하세요.` });
              return; // 성공 토스트 생략 (모달은 정상 종료)
            }
          }
          // 저장 완료 토스트
          const amt = entry.received > 0 ? entry.received : Math.abs(entry.used);
          const action = entry.received > 0 ? '입고' : '사용';
          const u = entry.unit ?? 'kg';
          setToast({ message: `${entry.material} ${amt}${u} ${action} 기록이 저장되었습니다` });
        }}
      />

      {/* 저장 토스트 */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[1200] pointer-events-none">
          <div className="bg-slate-900/90 backdrop-blur-sm text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <ClipboardCheck size={14} className="text-emerald-400" />
            <span>{toast.message}</span>
          </div>
        </div>
      )}

      {/* ── 발주 확정 모달 ── */}
      {showCartModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => setShowCartModal(false)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <ShoppingCart size={16} className="text-indigo-500" />
                <span className="font-black text-slate-800">전표 작성</span>
                <span className="text-[10px] font-black bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full">{cart.length}건</span>
              </div>
              <button onClick={() => setShowCartModal(false)} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {(() => {
                // 거래처별 그룹화
                const groups = new Map<string, { partnerId: string; partnerName: string; items: Array<{ name: string; spec: string; qty: number; price: number; itemId: string; isBox?: boolean }> }>();
                cart.forEach(item => {
                  const product = items.find(p => p.id === item.id);
                  if (!product) return;
                  const sid = psMap.get(product.id) || '__none__';
                  const sname = inboundPartners.find(s => s.id === sid)?.name || '거래처 미지정';
                  if (!groups.has(sid)) groups.set(sid, { partnerId: sid, partnerName: sname, items: [] });
                  groups.get(sid)!.items.push({
                    name: product.name,
                    spec: product.spec || '',
                    qty: item.qty,
                    price: product.price ?? 0,
                    itemId: product.id,
                    isBox: item.isBox,
                  });
                });
                return Array.from(groups.values()).map(group => (
                  <div key={group.partnerId} className="border border-slate-200 rounded-2xl overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50">
                      <div className="flex items-center gap-2">
                        <span className="font-black text-sm text-slate-700">{group.partnerName}</span>
                        <span className="text-[10px] text-slate-400">{group.items.length}품목</span>
                      </div>
                      {group.partnerId !== '__none__' && onRequestPurchaseInvoice ? (
                        <button
                          onClick={() => {
                            onRequestPurchaseInvoice(group.partnerId, group.partnerName, group.items);
                            setShowCartModal(false);
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-xl text-[11px] font-black hover:bg-indigo-700 transition-all"
                        >
                          전표 작성
                        </button>
                      ) : group.partnerId === '__none__' ? (
                        <span className="text-[10px] text-amber-500 font-bold">거래처 미지정 — 전표 작성 불가</span>
                      ) : null}
                    </div>
                    <div className="divide-y divide-slate-50">
                      {group.items.map((item, i) => (
                        <div key={i} className="px-4 py-2 flex items-center gap-3">
                          <span className="text-xs font-bold text-slate-700 flex-1">{item.name}{item.spec ? ` (${item.spec})` : ''}</span>
                          <span className="text-xs font-black text-slate-500">
                            {item.isBox ? `${item.qty}B(${item.qty * 12}개)` : `${item.qty}개`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ));
              })()}
            </div>
            <div className="px-5 py-4 border-t border-slate-100">
              <button onClick={() => setShowCartModal(false)}
                className="w-full py-3 rounded-2xl border border-slate-200 text-sm font-black text-slate-500 hover:bg-slate-50 transition-all">
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 입고 대기 일괄 전표 작성 모달 ── */}
      {showConfirmedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => setShowConfirmedModal(false)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <ClipboardCheck size={16} className="text-indigo-500" />
                <span className="font-black text-slate-800">전표 작성</span>
                <span className="text-[10px] font-black bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full">{confirmedChecked.size}건 선택</span>
              </div>
              <button onClick={() => setShowConfirmedModal(false)} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {(() => {
                // 선택된 confirmedWithoutStatement 아이템을 거래처별로 그룹화
                const groups = new Map<string, { partnerId: string; partnerName: string; items: Array<{ name: string; spec: string; qty: number; price: number; itemId: string }> }>();
                confirmedOrders.forEach(conf => {
                  if (!confirmedChecked.has(conf.id)) return;
                  const product = productMap.get(conf.id);
                  if (!product) return;
                  const sid = psMap.get(product.id) || '__none__';
                  const sname = inboundPartnerMap.get(sid)?.name || '거래처 미지정';
                  if (!groups.has(sid)) groups.set(sid, { partnerId: sid, partnerName: sname, items: [] });
                  groups.get(sid)!.items.push({
                    name: product.name,
                    spec: product.spec || '',
                    qty: conf.quantity,
                    price: product.price ?? 0,
                    itemId: product.id,
                  });
                });
                if (groups.size === 0) return (
                  <p className="text-sm text-slate-400 text-center py-10">선택된 항목이 없습니다</p>
                );
                return Array.from(groups.values()).map(group => (
                  <div key={group.partnerId} className="border border-slate-200 rounded-2xl overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50">
                      <div className="flex items-center gap-2">
                        <span className="font-black text-sm text-slate-700">{group.partnerName}</span>
                        <span className="text-[10px] text-slate-400">{group.items.length}건</span>
                      </div>
                      {group.partnerId !== '__none__' && onRequestPurchaseInvoice ? (
                        <button
                          onClick={() => {
                            onRequestPurchaseInvoice(group.partnerId, group.partnerName, group.items);
                            setShowConfirmedModal(false);
                            setConfirmedChecked(new Set());
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-xl text-[11px] font-black hover:bg-indigo-700 transition-all"
                        >
                          전표 작성 ({group.items.length})
                        </button>
                      ) : (
                        <span className="text-[10px] text-amber-500 font-bold">거래처 미지정 — 전표 작성 불가</span>
                      )}
                    </div>
                    <div className="divide-y divide-slate-50">
                      {group.items.map((item, i) => (
                        <div key={i} className="px-4 py-2 flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-700">{item.name}{item.spec ? ` (${item.spec})` : ''}</span>
                          <span className="text-xs font-black text-slate-500">{item.qty.toLocaleString()}개</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ));
              })()}
            </div>
            <div className="px-5 py-4 border-t border-slate-100">
              <button onClick={() => setShowConfirmedModal(false)}
                className="w-full py-3 rounded-2xl border border-slate-200 text-sm font-black text-slate-500 hover:bg-slate-50 transition-all">
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {adjustmentModal?.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-md rounded-[32px] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-8">
              <div className="flex items-center space-x-4 mb-6">
                <div className="p-3 bg-amber-50 rounded-2xl text-amber-500">
                  <AlertCircle size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-slate-900">수량 변동 및 취소 요청</h3>
                  <p className="text-sm text-slate-500 font-medium">{adjustmentModal.itemName}</p>
                </div>
              </div>

              <div className="space-y-6">
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <span className="text-xs font-bold text-slate-500">기존 입고 예정 수량</span>
                  <span className="text-lg font-black text-slate-900">{adjustmentModal.originalQuantity}</span>
                </div>

                <div className="space-y-3">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">요청 유형</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button 
                      onClick={() => setAdjustmentModal({...adjustmentModal, type: 'quantity_change'})}
                      className={`py-3 rounded-xl text-xs font-black border transition-all ${
                        adjustmentModal.type === 'quantity_change' 
                          ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg' 
                          : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'
                      }`}
                    >
                      수량 변경
                    </button>
                    <button 
                      onClick={() => setAdjustmentModal({...adjustmentModal, type: 'cancel_receipt'})}
                      className={`py-3 rounded-xl text-xs font-black border transition-all ${
                        adjustmentModal.type === 'cancel_receipt' 
                          ? 'bg-rose-500 border-rose-500 text-white shadow-lg' 
                          : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'
                      }`}
                    >
                      입고 취소
                    </button>
                  </div>
                </div>

                {adjustmentModal.type === 'quantity_change' && (
                  <div className="space-y-3">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">변경할 수량</label>
                    <div className="flex items-center space-x-3 bg-slate-50 border border-slate-200 p-2 rounded-2xl">
                      <input 
                        type="number" 
                        value={adjustmentQty}
                        onChange={(e) => setAdjustmentQty(parseInt(e.target.value) || 0)}
                        className="flex-1 bg-transparent text-center font-black text-lg outline-none"
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">변동 사유</label>
                  <textarea 
                    value={adjustmentReason}
                    onChange={(e) => setAdjustmentReason(e.target.value)}
                    placeholder="사유를 입력해주세요 (예: 오발주, 수량 오기입 등)"
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-sm font-medium outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all h-24 resize-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mt-8">
                <button 
                  onClick={() => setAdjustmentModal(null)}
                  className="py-4 bg-slate-100 text-slate-500 rounded-2xl text-sm font-black hover:bg-slate-200 transition-all"
                >
                  닫기
                </button>
                <button 
                  disabled={!adjustmentReason.trim()}
                  onClick={() => {
                    onAddAdjustmentRequest({
                      id: `ADJ-${Date.now()}`,
                      itemId: adjustmentModal.itemId,
                      itemName: adjustmentModal.itemName,
                      originalQuantity: adjustmentModal.originalQuantity,
                      requestedQuantity: adjustmentModal.type === 'quantity_change' ? adjustmentQty : 0,
                      type: adjustmentModal.type,
                      reason: adjustmentReason,
                      status: 'pending',
                      requestedAt: new Date().toISOString()
                    });
                    setAdjustmentModal(null);
                    alert('변동 요청이 관리자에게 전달되었습니다.');
                  }}
                  className="py-4 bg-indigo-600 text-white rounded-2xl text-sm font-black shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  요청 전송
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    {/* ── 재고 마감 모달 ───────────────────────────────────────────── */}
    {showClosingModal && (() => {
      const src = viewingClosing;
      const displayDate = src ? src.date : closingDate;
      // 그리드 행: 조회면 저장값, 신규면 완제품 목록(입력)
      type GridRow = { itemId: string; label: string; boxes: string; loose: string; editable: boolean; isChild?: boolean };
      const toRows = (arr: Item[]): GridRow[] => arr.map(p => ({ itemId: p.id, label: withSpec(p), boxes: closingCounts[p.id]?.boxes ?? '', loose: closingCounts[p.id]?.loose ?? '', editable: true }));
      // 저장·보드·합계 대상 = 재고있는+입력한 완제품 (조회모드면 저장된 항목)
      const rowsForGrid: GridRow[] = src
        ? src.items.map(r => ({ itemId: r.itemId, label: (r.spec && !hasVolumeInName(r.name)) ? `${r.name}${r.spec}` : r.name, boxes: r.boxes ? String(r.boxes) : '', loose: r.loose ? String(r.loose) : '', editable: false }))
        : toRows(showAllClosing ? allClosingItems : closingItems);
      const totalStock = src ? src.totalStock : closingItems.reduce((s, p) => s + closingTotalOf(p.id), 0);
      // 3열 그리드
      const cols: GridRow[][] = [[], [], []];
      rowsForGrid.forEach((r, i) => cols[i % 3].push(r));
      const nRows = Math.max(cols[0].length, cols[1].length, cols[2].length);
      const bTd: React.CSSProperties = { border: '1px solid #94a3b8', padding: '5px 7px', textAlign: 'center', fontSize: '12px' };
      const bTh: React.CSSProperties = { ...bTd, background: '#f1f5f9', fontWeight: 700, fontSize: '11px' };
      // 화면 리스트: 검색(품목명·규격·거래처, '+'로 여러 키워드 AND) + 낱개 밑에 박스 묶어 표시
      const term = closingSearch.trim();
      const tokens = parseSearchTokens(term);
      const matchClosing = (p: Item) => {
        const hay = `${withSpec(p)} ${p.품목 ?? ''} ${salesPartnerNames.get(p.id) ?? ''}`;
        return tokens.every(t => matchesSearch(hay, t));
      };
      // 분류 필터(참기름/들기름/기타) — 이름 기준. 기타 = 참기름·들기름이 아닌 나머지 전부(볶음참깨·가루류 등).
      const catMatch = (p: Item) => {
        if (closingCat === 'all') return true;
        if (closingCat === '참기름') return p.name.includes('참기름');
        if (closingCat === '들기름') return p.name.includes('들기름');
        return !p.name.includes('참기름') && !p.name.includes('들기름');
      };
      const dispatchedOf = (id: string) => dispatchedQtyByItem[id] ?? 0;
      const baseClosingItems = (term ? allClosingItems.filter(matchClosing) : (showAllClosing ? allClosingItems : closingItems)).filter(catMatch);
      let listRows: GridRow[] = src
        ? rowsForGrid
        : groupLooseBoxRows(baseClosingItems)
            .map(({ p, isChild }) => ({ itemId: p.id, label: withSpec(p), boxes: closingCounts[p.id]?.boxes ?? '', loose: closingCounts[p.id]?.loose ?? '', editable: true, isChild }));
      // 구분=작업완료: 작업완료분이 있는 품목만 남긴다.
      if (!src && closingView === 'dispatched') listRows = listRows.filter(r => dispatchedOf(r.itemId) > 0);
      // 구분=재고: 현재고 > 작업완료분(남은 재고>0)인 품목만. 작업완료로 다 빠진 품목은 목록에서 제거.
      // 단 검색 중이거나 '0포함'이면 남긴다 — 이 뷰에서 실사 수정을 하므로 0으로 적은 행이 사라지면 다시 못 고친다.
      if (!src && closingView === 'stock' && !term && !showAllClosing) listRows = listRows.filter(r => Math.round(((productMap.get(r.itemId)?.stock ?? 0) - dispatchedOf(r.itemId)) * 1000) / 1000 > 0);
      // 페이지 나눔(모바일)
      const pageCount = Math.max(1, Math.ceil(listRows.length / CLOSING_PAGE_SIZE));
      const page = Math.min(closingPage, pageCount - 1);
      const pageRows = listRows.slice(page * CLOSING_PAGE_SIZE, page * CLOSING_PAGE_SIZE + CLOSING_PAGE_SIZE);

      return (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-lg h-[92dvh] sm:h-[88vh] shadow-2xl flex flex-col overflow-hidden">
            {/* 헤더 */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 shrink-0">
              <span className="text-base font-black text-slate-900">재고 현황</span>
              <button onClick={() => { setEditingClosingId(null); setShowClosingModal(false); }} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100">
                <X size={18} />
              </button>
            </div>

            {/* ── 본문(스크롤) ── */}
            <div className="flex-1 overflow-y-auto px-4 pt-3 pb-4">
              {/* 검색 + 전체 완제품 토글 (재고 0짜리도 만들기 하려면 켠다) */}
              <div className="flex items-center gap-2 mb-2.5">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
                  <input value={closingSearch} onChange={e => { setClosingSearch(e.target.value); setClosingPage(0); }} placeholder="품목·거래처 검색 (+로 여러개, 예: 참기름+1800)"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-9 py-2.5 text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-300" />
                  {closingSearch && (
                    <button onClick={() => { setClosingSearch(''); setClosingPage(0); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"><X size={15} /></button>
                  )}
                </div>
                <button onClick={() => { setShowAllClosing(v => !v); setClosingPage(0); }}
                  className={`shrink-0 px-3 py-2.5 rounded-xl text-xs font-black border transition-all ${showAllClosing ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-300'}`}
                  title="재고 0인 완제품까지 다 보기 (만들기용)">
                  0포함
                </button>
              </div>

              {/* 구분 필터 — 전체(현재고) / 작업완료(미출고 생산분) / 재고(작업완료 제외) */}
              {!src && (
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="shrink-0 w-8 text-[10px] font-black text-slate-400">구분</span>
                  {([['stock', '재고'], ['dispatched', '작업완료'], ['all', '전체']] as const).map(([v, label]) => (
                    <button key={v} onClick={() => { setClosingView(v); setClosingPage(0); }}
                      className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-black border transition-all ${closingView === v ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {/* 분류 필터 — 전체 / 참기름 / 들기름 / 가루종류 */}
              {!src && (
                <div className="flex items-center gap-1.5 mb-2.5">
                  <span className="shrink-0 w-8 text-[10px] font-black text-slate-400">분류</span>
                  {([['all', '전체'], ['참기름', '참기름'], ['들기름', '들기름'], ['기타', '기타']] as const).map(([v, label]) => (
                    <button key={v} onClick={() => { setClosingCat(v); setClosingPage(0); }}
                      className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-black border transition-all ${closingCat === v ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-300'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {/* 품목 추가하기 — 전체 품목 검색·수량입력·확정으로 재고 생성(ADD) */}
              <button onClick={openMakeModal}
                className="w-full mb-2.5 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-black text-indigo-600 border border-dashed border-indigo-300 hover:bg-indigo-50 transition-all">
                <Plus size={16} strokeWidth={3} />품목 추가하기
              </button>

              <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
                {pageRows.length === 0 && (
                  <div className="px-3 py-8 text-center text-xs text-slate-400">{term ? '검색 결과가 없습니다.' : closingView === 'dispatched' ? '작업완료(미출고)된 완제품이 없습니다.' : closingView === 'stock' ? '재고로 남은 완제품이 없습니다. (작업완료분 제외)' : '완제품이 없습니다. 검색하거나 "0포함"을 켜세요.'}</div>
                )}
                {pageRows.map(r => {
                  const product = productMap.get(r.itemId);
                  const cur = product?.stock ?? 0;
                  const disp = src ? 0 : (dispatchedQtyByItem[r.itemId] ?? 0);      // 작업완료(미출고)분
                  const base = Math.round((cur - disp) * 1000) / 1000;              // 재고(작업완료 제외)
                  const shownNum = (!src && closingView === 'dispatched') ? disp : (!src && closingView === 'stock') ? base : cur;
                  // 재고 뷰 실사 수정 — 입력값은 작업완료를 뺀 순수 재고. 저장 시 작업완료분을 다시 얹어야
                  //   전체 뷰가 '재고 + 작업완료' 합계로 보인다. 작업완료 뷰는 주문에서 파생된 값이라 읽기전용.
                  const stockEdit = !src && closingView === 'stock';
                  const editable = src ? true : closingView !== 'dispatched';
                  const editing = editable && editingClosingId === r.itemId;
                  return (
                    <div key={r.itemId} className={`w-full flex items-center gap-2 px-3 py-2.5 ${r.isChild ? 'pl-7 bg-slate-50/50' : ''}`}>
                      <span className={`flex-1 min-w-0 text-[13px] break-keep ${r.isChild ? 'font-semibold text-slate-500' : 'font-bold text-slate-800'}`}>{r.isChild && <span className="text-slate-300 mr-1">└</span>}{r.label}</span>
                      {/* 작업완료(미출고)분 배지 — 전체·작업완료 뷰에만. 재고 뷰는 이미 뺀 순수 재고라 배지 없음. */}
                      {disp > 0 && closingView !== 'stock' && (
                        <span className="shrink-0 text-[9px] font-black text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full whitespace-nowrap"
                          title={closingView === 'all' ? `재고 ${base} + 작업완료(미출고) ${disp} = 현재고 ${cur}` : '작업완료(미출고)분'}>
                          {closingView === 'all' ? `재고 ${base} + 작업완료 ${disp}` : `작업완료 ${disp}`}
                        </span>
                      )}
                      {editing ? (
                        <input autoFocus type="text" inputMode="decimal" value={editingClosingVal}
                          onChange={e => setEditingClosingVal(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') { closingEditCancelled.current = false; e.currentTarget.blur(); }
                            if (e.key === 'Escape') { closingEditCancelled.current = true; e.currentTarget.blur(); }
                          }}
                          onBlur={() => {
                            if (product && !closingEditCancelled.current && editingClosingVal.trim() !== '') commitStockEdit(product, parseFloat(editingClosingVal), stockEdit ? disp : 0);
                            setEditingClosingId(null); closingEditCancelled.current = false;
                          }}
                          className="w-16 shrink-0 border border-indigo-300 rounded-lg px-2 py-1 text-right text-sm font-black outline-none focus:ring-2 focus:ring-indigo-400" />
                      ) : editable ? (
                        <button onClick={() => { if (!product) return; setEditingClosingId(r.itemId); setEditingClosingVal(String(product.subtype === '향미유' ? Math.floor(shownNum / 12) : shownNum)); }}
                          title={stockEdit ? '눌러서 실사 수정 (작업완료 제외한 재고)' : '눌러서 실사 수정'}
                          className={`shrink-0 text-sm font-black ${shownNum > 0 ? 'text-slate-700' : 'text-slate-300'} hover:text-indigo-600 hover:underline`}>
                          {shownNum}<span className="text-[10px] font-bold text-slate-400 ml-0.5">개</span>
                        </button>
                      ) : (
                        <span className={`shrink-0 text-sm font-black ${shownNum > 0 ? 'text-slate-700' : 'text-slate-300'}`} title={closingView === 'dispatched' ? '작업완료(미출고)분' : '재고(작업완료 제외)'}>
                          {shownNum}<span className="text-[10px] font-bold text-slate-400 ml-0.5">개</span>
                        </span>
                      )}
                      {editable && (
                        <button onClick={() => {
                            if (!product) return;
                            // 재고 뷰에서는 '재고분만' 0으로 — 작업완료분은 주문에 물려 있으니 남긴다.
                            // 전체 뷰에서는 현재고를 통째로 0으로 만들어 작업완료분까지 날아간다 → 미리 경고.
                            //   (실제로 이 버튼으로 작업완료 900개가 통째로 지워진 사고가 있었음)
                            const msg = disp <= 0
                              ? `"${product.name}" 재고를 0으로 만들까요?`
                              : stockEdit
                                ? `"${product.name}" 재고를 0으로 만들까요?\n작업완료 ${disp}개는 남습니다. (현재고 ${cur} → ${disp})`
                                : `"${product.name}" 현재고를 0으로 만들까요?\n\n⚠ 작업완료(미출고) ${disp}개도 함께 사라집니다. (현재고 ${cur} → 0)\n작업완료분을 남기려면 '재고' 뷰에서 지우세요.`;
                            if (confirm(msg)) commitStockEdit(product, 0, stockEdit ? disp : 0);
                          }}
                          title="재고 0으로" className="shrink-0 p-1 rounded text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition-colors">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* 페이지 이동 */}
              {pageCount > 1 && (
                <div className="flex items-center justify-center gap-3 mt-3">
                  <button onClick={() => setClosingPage(Math.max(0, page - 1))} disabled={page === 0}
                    className="px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-xs font-bold disabled:opacity-40 hover:bg-slate-200">이전</button>
                  <span className="text-xs font-bold text-slate-500">{page + 1} / {pageCount}</span>
                  <button onClick={() => setClosingPage(Math.min(pageCount - 1, page + 1))} disabled={page >= pageCount - 1}
                    className="px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-xs font-bold disabled:opacity-40 hover:bg-slate-200">다음</button>
                </div>
              )}
            </div>

          </div>
        </div>
      );
    })()}

    {/* ── 입고대기 수정 → 매입전표 수정 요청 모달 ── */}
    {poEditModal && (
      <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setPoEditModal(null)} />
        <div className="relative bg-white rounded-3xl w-full max-w-md mx-4 shadow-2xl animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col">
          <div className="px-6 pt-5 pb-4 border-b border-slate-100 flex items-center justify-between shrink-0">
            <div>
              <h2 className="text-sm font-black text-slate-800">전표 수정 요청</h2>
              <p className="text-[11px] text-slate-400 font-medium mt-0.5">연결된 매입전표 수정을 관리자에게 요청합니다</p>
            </div>
            <button onClick={() => setPoEditModal(null)} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl transition-all"><X size={18} /></button>
          </div>
          <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">수정 수량 (0 입력 시 해당 품목 삭제)</p>
            {poEditModal.rows.map((row, i) => (
              <div key={`${row.itemId}-${i}`} className="flex items-center gap-3">
                <span className="flex-1 text-sm font-bold text-slate-700 truncate">{row.name}</span>
                <input type="number" value={row.qty}
                  onChange={e => setPoEditModal(m => m ? { ...m, rows: m.rows.map((r, j) => j === i ? { ...r, qty: e.target.value } : r) } : m)}
                  className="w-20 text-center text-sm font-black border border-slate-300 rounded-lg px-2 py-1.5 outline-none focus:ring-2 focus:ring-teal-400" />
              </div>
            ))}
            <div className="pt-2">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">사유</p>
              <textarea value={poEditModal.reason}
                onChange={e => setPoEditModal(m => m ? { ...m, reason: e.target.value } : m)}
                placeholder="수정 사유를 입력하세요 (예: 입고 수량 부족)"
                className="w-full h-20 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-400 resize-none" />
            </div>
          </div>
          <div className="px-6 py-4 border-t border-slate-100 flex gap-2 shrink-0">
            <button onClick={() => setPoEditModal(null)}
              className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-xs font-black hover:bg-slate-200 transition-all">취소</button>
            <button
              onClick={() => {
                if (!poEditModal.reason.trim()) { alert('사유를 입력하세요.'); return; }
                const newLines = poEditModal.rows.map(r => ({ itemId: r.itemId, quantity: Math.max(0, parseInt(r.qty) || 0) }));
                onRequestPoEdit?.(poEditModal.po.id, newLines, poEditModal.reason.trim());
                setPoEditModal(null);
              }}
              className="flex-1 py-2.5 rounded-xl bg-teal-500 text-white text-xs font-black hover:bg-teal-600 transition-all">수정 요청</button>
          </div>
        </div>
      </div>
    )}
    </div>
  );
};

export default ItemList;
