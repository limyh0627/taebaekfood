
import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import {
  FileText, Printer, Search, ChevronDown, CalendarDays,
  Package, ClipboardList, ChevronRight, CheckCircle2, Edit2, Plus, X, ArrowLeft,
  Tag, Save, AlertCircle, Download, CheckSquare,
  ChevronLeft
} from 'lucide-react';
import * as ExcelJS from 'exceljs';
import { Order, Product, Client, ProductClient, ProductSupplier, OrderStatus, IssuedStatement, CompanyInfo, PaymentRecord } from '../types';
import PageHeader from './PageHeader';

interface TradeStatementProps {
  orders: Order[];
  allProducts: Product[];
  clients: Client[];
  productClients: ProductClient[];
  productSuppliers: ProductSupplier[];
  issuedStatements: IssuedStatement[];
  onUpdateStatus?: (id: string, status: OrderStatus) => void;
  onUpdateProductClientPrice?: (id: string, price: number) => void;
  onUpdateProductClientTaxType?: (id: string, taxType: '과세' | '면세') => void;
  onUpsertProductSupplier?: (ps: ProductSupplier) => void;
  onUpdateProductSupplierTaxType?: (id: string, taxType: '과세' | '면세') => void;
  onMarkInvoicePrinted?: (id: string, value: boolean) => void;
  onAddIssuedStatement?: (stmt: IssuedStatement) => void;
  onUpdateIssuedStatement?: (id: string, data: Partial<IssuedStatement>) => void;
  onDeleteIssuedStatement?: (id: string) => void;
  pendingInvoice?: { supplierId: string; supplierName: string; items: Array<{ name: string; spec: string; qty: number; price: number; isBox?: boolean }> } | null;
  onClearPendingInvoice?: () => void;
  confirmedOrders?: { id: string; quantity: number }[];
  orderRequests?: { id: string; quantity: number; confirmedByUser?: boolean }[];
  onAddConfirmedOrder?: (item: { id: string; quantity: number }) => void;
  onRemoveConfirmedOrder?: (id: string) => void;
  onRemoveOrderRequest?: (id: string) => void;
  companyInfo?: CompanyInfo | null;
  onSaveCompanyInfo?: (info: CompanyInfo) => void;
  onUpdateProductCost?: (productId: string, cost: number) => void;
  onUpdateOrder?: (id: string, data: Partial<import('../types').Order>) => void;
}

type StatementType = '매출' | '매입';

const STATUS_LABEL: Record<string, string> = {
  [OrderStatus.PENDING]: '대기중', [OrderStatus.PROCESSING]: '작업중',
  [OrderStatus.DISPATCHED]: '작업완료', [OrderStatus.SHIPPED]: '출고완료',
  [OrderStatus.DELIVERED]: '배송완료',
};
const STATUS_COLOR: Record<string, string> = {
  [OrderStatus.PENDING]: 'bg-slate-100 text-slate-500',
  [OrderStatus.PROCESSING]: 'bg-amber-100 text-amber-700',
  [OrderStatus.DISPATCHED]: 'bg-sky-100 text-sky-700',
  [OrderStatus.SHIPPED]: 'bg-indigo-100 text-indigo-700',
  [OrderStatus.DELIVERED]: 'bg-emerald-100 text-emerald-700',
};

const ACTIVE_STATUSES = new Set([OrderStatus.PENDING, OrderStatus.PROCESSING, OrderStatus.DISPATCHED, OrderStatus.SHIPPED]);

const fmt = (n: number) => n.toLocaleString('ko-KR');

function buildSupplierGroups<T extends { id: string }>(
  orders: T[], allProducts: Product[], clients: Client[]
): { supplierId: string; supplierName: string; items: { product: Product; item: T }[] }[] {
  const map = new Map<string, { supplierName: string; items: { product: Product; item: T }[] }>();
  for (const item of orders) {
    const product = allProducts.find(p => p.id === item.id);
    if (!product?.supplierId) continue;
    const sName = clients.find(c => c.id === product.supplierId)?.name ?? product.supplierId;
    if (!map.has(product.supplierId)) map.set(product.supplierId, { supplierName: sName, items: [] });
    map.get(product.supplierId)!.items.push({ product, item });
  }
  return Array.from(map.entries()).map(([sid, v]) => ({ supplierId: sid, ...v }));
}

const today = () => new Date().toISOString().slice(0, 10);
const weekStart = () => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d.toISOString().slice(0, 10); };
const monthStart = () => new Date().toISOString().slice(0, 7) + '-01';
const yearStart  = () => new Date().getFullYear() + '-01-01';

const TradeStatement: React.FC<TradeStatementProps> = ({
  orders, allProducts, clients, productClients, productSuppliers,
  issuedStatements, onUpdateStatus, onUpdateProductClientPrice,
  onUpdateProductClientTaxType, onUpsertProductSupplier, onUpdateProductSupplierTaxType,
  onMarkInvoicePrinted, onAddIssuedStatement,
  onUpdateIssuedStatement,
  onDeleteIssuedStatement,
  pendingInvoice,
  onClearPendingInvoice,
  confirmedOrders = [],
  orderRequests = [],
  onAddConfirmedOrder,
  onRemoveConfirmedOrder,
  onRemoveOrderRequest,
  companyInfo,
  onSaveCompanyInfo,
  onUpdateProductCost,
  onUpdateOrder,
}) => {

  // ── 전표 생성 오버레이 ──
  const [createMode, setCreateMode] = useState<StatementType | null>(null);

  // ── 거래처/주문 선택 ──
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [onlyActive, setOnlyActive] = useState(false);

  // ── 기간 필터 (주문 선택) ──
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [orderDateQuick, setOrderDateQuick] = useState<'당일'|'금주'|'당월'|''>('');

  // ── 거래 일자 ──
  const [tradeDate, setTradeDate] = useState(today);

  // ── 미리보기 ──
  const [showPreview, setShowPreview] = useState(false);

  // ── 인라인 단가 수정 ──
  const [editablePrices, setEditablePrices] = useState<Record<string, string>>({});

  // ── 과세/면세 수동 오버라이드 (undefined = PC 기본값 사용) ──
  const [taxExemptOverrides, setTaxExemptOverrides] = useState<Record<string, boolean>>({});

  // ── 단가 DB 관리 패널 ──
  const [showPricePanel, setShowPricePanel] = useState(false);
  const [pricePanelEdits, setPricePanelEdits] = useState<Record<string, string>>({});

  // ── 직접 입력 모드 ──
  const [manualMode, setManualMode] = useState(false);
  type ManualRow = { name: string; spec: string; qty: string; price: string; isTaxExempt: boolean; note?: string; isBoxUnit?: boolean; boxSize?: number };
  const [manualItems, setManualItems] = useState<ManualRow[]>([
    { name: '', spec: '', qty: '', price: '', isTaxExempt: false, note: '' },
  ]);
  // ── 품목명 드롭다운 검색 ──
  const [activeSearchRow, setActiveSearchRow] = useState<number | null>(null);
  // ── 전표 추가 필드 ──
  const [tradeNote, setTradeNote] = useState('');       // 전표비고
  const [selectedItemIdx, setSelectedItemIdx] = useState<number | null>(null); // 선택된 품목 행

  // ── 빠른 품목 입력 행 ──
  const [quickName, setQuickName] = useState('');
  const [quickSpec, setQuickSpec] = useState('');
  const [quickQty, setQuickQty] = useState('');
  const [quickPrice, setQuickPrice] = useState('');
  const [quickNote, setQuickNote] = useState('');
  const [quickSearchOpen, setQuickSearchOpen] = useState(false);
  const [quickIsTaxExempt, setQuickIsTaxExempt] = useState(false);

  // ── 품목 선택 팝업 ──
  const [showItemPicker, setShowItemPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  // 팝업 내 수량 임시 입력: { [productId]: qty }
  const [pickerQtys, setPickerQtys] = useState<Record<string,string>>({});

  // 현재 전표 세션에서 이미 issuedStatement에 저장했는지 추적 (인쇄 중복 방지)
  const hasIssuedRef = useRef(false);

  // ── 지불/수불 처리 모달 ──
  const [payTarget, setPayTarget] = useState<IssuedStatement | null>(null);
  const [payForm, setPayForm] = useState<{ amount: string; date: string; method: PaymentRecord['method']; note: string }>({
    amount: '', date: new Date().toISOString().slice(0, 10), method: '계좌이체', note: '',
  });

  const getPaid = (s: IssuedStatement) => (s.payments ?? []).reduce((a, p) => a + p.amount, 0);
  const getBalance = (s: IssuedStatement) => s.totalAmount - getPaid(s);

  const openPayModal = (stmt: IssuedStatement) => {
    setPayTarget(stmt);
    setPayForm({ amount: String(getBalance(stmt)), date: new Date().toISOString().slice(0, 10), method: '계좌이체', note: '' });
  };

  const savePayment = () => {
    if (!payTarget || !payForm.amount) return;
    const newPayment: PaymentRecord = {
      id: Date.now().toString(),
      amount: Number(payForm.amount),
      date: payForm.date,
      method: payForm.method,
      ...(payForm.note.trim() ? { note: payForm.note.trim() } : {}),
    };
    onUpdateIssuedStatement?.(payTarget.id, { payments: [...(payTarget.payments ?? []), newPayment] });
    setPayTarget(null);
  };

  // ── 메인 탭 ──
  const [mainTab, setMainTab] = useState<'history' | 'prices' | 'taxinvoice'>('history');

  // ── 회사 설정 모달 ──
  const [showCompanyModal, setShowCompanyModal] = useState(false);
  const [companyForm, setCompanyForm] = useState<CompanyInfo>({
    name: '', ceoName: '', bizNo: '', bizType: '', bizItem: '', address: '', phone: '', fax: '', email: '',
  });

  // ── 세금계산서 탭 ──
  const [taxClientId, setTaxClientId] = useState('');
  const [taxClientSearch, setTaxClientSearch] = useState('');
  const [taxStmtIds, setTaxStmtIds] = useState<string[]>([]);
  const [taxBuyerInfo, setTaxBuyerInfo] = useState({ bizNo: '', ceoName: '', bizType: '', bizItem: '', address: '' });
  const taxPrintRef = useRef<HTMLDivElement>(null);

  // ── 단가관리 탭 ──
  const [priceTabMode, setPriceTabMode] = useState<'매출' | '매입'>('매출');
  const [priceClientId, setPriceClientId] = useState('');
  const [priceClientSearch, setPriceClientSearch] = useState('');
  const [priceEdits, setPriceEdits] = useState<Record<string, string>>({});
  const [priceTaxEdits, setPriceTaxEdits] = useState<Record<string, '과세' | '면세'>>({});
  const [costEdits, setCostEdits] = useState<Record<string, string>>({});   // productId → cost
  const [priceSaving, setPriceSaving] = useState(false);
  const [priceSaved, setPriceSaved] = useState(false);

  // ── 발행내역 필터 ──
  const [histFrom, setHistFrom] = useState(monthStart);
  const [histTo, setHistTo]     = useState(today);
  const [histTypeFilter, setHistTypeFilter] = useState<'전체' | '매출' | '매입'>('전체');
  const [histSearch, setHistSearch] = useState('');
  const [histQuick, setHistQuick] = useState<'당일'|'금주'|'당월'|'당년'|'ALL'|''>('당월');

  // ── 발행내역 상세 보기 ──
  const [detailStmt, setDetailStmt] = useState<IssuedStatement | null>(null);

  // ── 발주확정 선택 / 매입 품목 검색 ──
  const [selectedConfirmedIds, setSelectedConfirmedIds] = useState<string[]>([]);
  const [purchaseSearch, setPurchaseSearch] = useState('');
  const [showPurchasePicker, setShowPurchasePicker] = useState(false);

  // ── 중복발행 경고 ──
  const [warnDuplicate, setWarnDuplicate] = useState<{ order: Order; stmt: IssuedStatement } | null>(null);

  // ── 기존 전표 수정 ──
  const [editingStmt, setEditingStmt] = useState<IssuedStatement | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);

  const printRef = useRef<HTMLDivElement>(null);

  // ── 전표 유형 (createMode 파생) ──
  const stmtType: StatementType = createMode || '매출';

  // ── 생성 오버레이 열기/닫기 ──
  const openCreate = (type: StatementType) => {
    setCreateMode(type);
    setSelectedClientId('');
    setSelectedOrderId('');
    setShowPreview(false);
    setEditablePrices({});
    setTaxExemptOverrides({});
    setTradeDate(today());
    setClientSearch('');
    setDateFrom(type === '매출' ? monthStart() : '');
    setDateTo(type === '매출' ? today() : '');
    setOrderDateQuick(type === '매출' ? '당월' : '');
    setShowPricePanel(false);
    setManualMode(false);
    setManualItems([{ name: '', spec: '', qty: '', price: '', isTaxExempt: false }]);
    setSelectedConfirmedIds([]);
    setPurchaseSearch('');
    setShowPurchasePicker(false);
    setActiveSearchRow(null);
  };
  const closeCreate = () => { setCreateMode(null); setEditingStmt(null); setIsEditMode(false); setTradeNote(''); setSelectedItemIdx(null); setQuickName(''); setQuickSpec(''); setQuickQty(''); setQuickPrice(''); setQuickNote(''); setQuickSearchOpen(false); setQuickIsTaxExempt(false); setShowItemPicker(false); setPickerSearch(''); setPickerQtys({}); hasIssuedRef.current = false; };

  // pendingInvoice가 오면 자동으로 매입전표 생성 모달 열기
  useEffect(() => {
    if (!pendingInvoice) return;
    openCreate('매입');
    setManualMode(true);
    // 거래처 설정 (supplierId로 매입처 찾기)
    const matchedClient = clients.find(c => c.id === pendingInvoice.supplierId);
    if (matchedClient) setSelectedClientId(matchedClient.id);
    // 품목 채우기
    setManualItems([
      ...pendingInvoice.items.map(item => ({
        name: item.name,
        spec: item.spec,
        qty: String(item.qty),
        price: String(item.price || ''),
        isTaxExempt: false,
        isBoxUnit: item.isBox ?? false,
        boxSize: item.isBox ? 12 : undefined,
      })),
      { name: '', spec: '', qty: '', price: '', isTaxExempt: false },
    ]);
    onClearPendingInvoice?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingInvoice]);

  const openEdit = (stmt: IssuedStatement) => {
    setEditingStmt(stmt);
    setIsEditMode(false);
    setCreateMode(stmt.type);
    setSelectedClientId(stmt.clientId);
    setSelectedOrderId(stmt.orderId || '');
    setTradeDate(stmt.tradeDate);
    setManualMode(true);
    setManualItems([
      ...stmt.items.map(i => ({
        name: i.name,
        spec: i.spec,
        qty: String(i.qty),
        price: String(i.isTaxExempt ? i.price : Math.round(i.price * 1.1)),
        isTaxExempt: i.isTaxExempt,
      })),
      { name: '', spec: '', qty: '', price: '', isTaxExempt: false },
    ]);
    setEditablePrices({});
    setTaxExemptOverrides({});
    setClientSearch('');
    setShowPricePanel(false);
    setActiveSearchRow(null);
  };

  // ── 매입전표에 이미 사용된 품목명 집합 ──
  const issuedPurchaseNames = useMemo(() => {
    const s = new Set<string>();
    issuedStatements.filter(st => st.type === '매입').forEach(st => st.items.forEach(i => s.add(i.name)));
    return s;
  }, [issuedStatements]);

  // ── 발주확정 공급처별 그룹 ──
  const confirmedBySupplier = useMemo(
    () => buildSupplierGroups(confirmedOrders, allProducts, clients)
      .map(g => ({ ...g, items: g.items.map(({ product, item }) => ({ product, co: item as { id: string; quantity: number } })) })),
    [confirmedOrders, allProducts, clients]
  );

  // ── 발주예정 공급처별 그룹 ──
  const orderRequestsBySupplier = useMemo(
    () => buildSupplierGroups(orderRequests, allProducts, clients)
      .map(g => ({ ...g, items: g.items.map(({ product, item }) => ({ product, req: item as { id: string; quantity: number; confirmedByUser?: boolean } })) })),
    [orderRequests, allProducts, clients]
  );

  // ── 매입 품목 선택 패널용: supplierId 연결된 품목 전체 (공급처별 그룹) ──
  const purchasableBySupplier = useMemo(() => {
    const term = purchaseSearch.toLowerCase().trim();
    const products = allProducts.filter(p =>
      p.supplierId &&
      (!term || p.name.toLowerCase().includes(term))
    );
    const map = new Map<string, { supplierName: string; items: typeof products }>();
    for (const p of products) {
      const supplier = clients.find(c => c.id === p.supplierId);
      const sName = supplier?.name ?? p.supplierId!;
      if (!map.has(p.supplierId!)) map.set(p.supplierId!, { supplierName: sName, items: [] });
      map.get(p.supplierId!)!.items.push(p);
    }
    return Array.from(map.entries()).map(([sid, v]) => ({ supplierId: sid, ...v }));
  }, [allProducts, clients, purchaseSearch]);

  // ── 현재 진행 주문 (매출전표 현재 주문만 패널용) ──
  const activeOrders = useMemo(() =>
    orders
      .filter(o => (ACTIVE_STATUSES.has(o.status as OrderStatus) || !!o.invoicePrinted) && o.customerName !== '생산기록')
      .sort((a, b) => {
        const aP = !!a.invoicePrinted, bP = !!b.invoicePrinted;
        if (aP !== bP) return aP ? 1 : -1;
        return new Date(a.deliveryDate || a.createdAt).getTime() - new Date(b.deliveryDate || b.createdAt).getTime();
      }),
    [orders]
  );

  // ── 선택된 발주항목(확정+예정) → 매입전표 직접 입력 모드 ──
  const loadSelectedToManual = () => {
    const rows: ManualRow[] = [];
    selectedConfirmedIds.forEach(id => {
      const product = allProducts.find(p => p.id === id);
      if (!product) return;
      const co = confirmedOrders.find(c => c.id === id);
      if (co) {
        const isBox = product.category === '향미유' && (co as any).isBox;
        rows.push({ name: product.name, spec: product.용량 || product.unit || '', qty: String(co.quantity), price: '', isTaxExempt: false, isBoxUnit: isBox, boxSize: isBox ? 12 : undefined });
        return;
      }
      const req = orderRequests?.find((r: { id: string; quantity: number; isBox?: boolean }) => r.id === id);
      if (req) {
        const ps = productSuppliers.find(s => s.productId === id && s.supplierId === selectedClientId);
        const isBox = product.category === '향미유' && (req as any).isBox;
        rows.push({ name: product.name, spec: product.용량 || product.unit || '', qty: String(req.quantity), price: ps?.price ? String(ps.price) : '', isTaxExempt: ps?.taxType === '면세', isBoxUnit: isBox, boxSize: isBox ? 12 : undefined });
      }
    });
    if (rows.length === 0) return;
    setManualItems([...rows, { name: '', spec: '', qty: '', price: '', isTaxExempt: false }]);
    setSelectedConfirmedIds([]);
    setManualMode(true);
  };

  // ── 거래처 목록 ──
  const activeClientIds = useMemo(() =>
    new Set(orders.filter(o => ACTIVE_STATUSES.has(o.status as OrderStatus)).map(o => o.clientId)),
    [orders]
  );
  const availableClients = useMemo(() => {
    let base = clients.filter(c => {
      if (createMode === '매입') {
        // 매입전표: 매입처 또는 매출+매입처
        return c.partnerType === '매입처' || c.partnerType === '매출+매입처';
      }
      // 매출전표: 매출처(기본) 또는 매출+매입처, 일반/택배 타입
      return (c.type === '일반' || c.type === '택배') &&
        (c.partnerType === undefined || c.partnerType === '매출처' || c.partnerType === '매출+매입처');
    });
    if (onlyActive) base = base.filter(c => activeClientIds.has(c.id));
    if (!clientSearch.trim()) return base;
    return base.filter(c => c.name.toLowerCase().includes(clientSearch.toLowerCase()));
  }, [clients, clientSearch, onlyActive, activeClientIds, createMode]);

  // ── 주문 목록 ──
  const clientOrders = useMemo(() => {
    let list = orders
      .filter(o => o.clientId === selectedClientId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (onlyActive) {
      list = list.filter(o => ACTIVE_STATUSES.has(o.status as OrderStatus) || !!o.invoicePrinted);
      list = [...list].sort((a, b) => {
        const aP = !!a.invoicePrinted, bP = !!b.invoicePrinted;
        if (aP !== bP) return aP ? 1 : -1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
    }
    if (dateFrom) list = list.filter(o => (o.deliveryDate || o.createdAt || '').slice(0, 10) >= dateFrom);
    if (dateTo)   list = list.filter(o => (o.deliveryDate || o.createdAt || '').slice(0, 10) <= dateTo);
    return list;
  }, [orders, selectedClientId, onlyActive, dateFrom, dateTo]);

  const selectedOrder  = clientOrders.find(o => o.id === selectedOrderId);
  const selectedClient = clients.find(c => c.id === selectedClientId);

  // ── 품목 행 계산 ──
  type LineItem = {
    key: string; no: number; name: string; spec: string;
    qty: number; price: number; supply: number; tax: number; total: number;
    isTaxExempt: boolean; isBoxUnit?: boolean; boxSize?: number;
  };

  const lineItems = useMemo((): LineItem[] => {
    if (manualMode) {
      return manualItems
        .filter(i => i.name.trim())
        .map((item, idx) => {
          const qty = parseFloat(item.qty) || 0;
          const price = parseFloat(item.price) || 0;
          const supply = qty * price;
          const tax = item.isTaxExempt ? 0 : Math.round(supply * 0.1);
          return { key: `manual-${idx}`, no: idx + 1, name: item.name, spec: item.spec, qty, price, supply, tax, total: supply + tax, isTaxExempt: item.isTaxExempt, isBoxUnit: item.isBoxUnit, boxSize: item.boxSize };
        });
    }
    if (!selectedOrder) return [];
    const itemMap: Record<string, LineItem> = {};
    let no = 1;
    selectedOrder.items.forEach(item => {
      const product = allProducts.find(p => p.id === item.productId);
      const displayName = product?.품목 || item.name;
      const spec = product?.용량 || '';
      const key  = `${displayName}||${spec}`;
      const pcEntry = productClients.find(
        pc => pc.productId === item.productId && pc.clientId === selectedClientId
      );
      const pcPrice   = pcEntry?.price;
      const pcTaxType = pcEntry?.taxType; // '과세' | '면세' | undefined(=과세 기본)
      const defaultPrice = pcPrice ?? item.price ?? product?.price ?? 0;
      const unitPrice    = editablePrices[key] !== undefined
        ? (parseFloat(editablePrices[key]) || 0) : defaultPrice;
      // 면세 여부: 수동 오버라이드 > PC taxType (undefined이면 과세 기본)
      const isTaxExempt  = key in taxExemptOverrides
        ? taxExemptOverrides[key]
        : pcTaxType === '면세';
      // 과세: 단가는 부가세 포함 → 공급가액 역산
      let supply: number, tax: number, displayPrice: number;
      if (isTaxExempt) {
        displayPrice = unitPrice;
        supply = unitPrice * item.quantity;
        tax = 0;
      } else {
        // 부가세 포함 단가 → 공급가액 = round(단가/1.1)*수량
        displayPrice = Math.round(unitPrice / 1.1);
        supply = displayPrice * item.quantity;
        tax = unitPrice * item.quantity - supply;
      }
      if (itemMap[key]) {
        itemMap[key].qty += item.quantity;
        itemMap[key].supply += supply;
        itemMap[key].tax += tax;
        itemMap[key].total += supply + tax;
      } else {
        itemMap[key] = { key, no: no++, name: displayName, spec, qty: item.quantity, price: unitPrice, supply, tax, total: supply + tax, isTaxExempt };
      }
    });
    return Object.values(itemMap);
  }, [manualMode, manualItems, selectedOrder, allProducts, productClients, selectedClientId, editablePrices, taxExemptOverrides]);

  const totalSupply = lineItems.reduce((s, r) => s + r.supply, 0);
  const totalTax    = lineItems.reduce((s, r) => s + r.tax, 0);
  const totalAmount = totalSupply + totalTax;

  const tradeDateObj = new Date(tradeDate + 'T00:00:00');
  const dateStr = `${tradeDateObj.getFullYear()}년 ${tradeDateObj.getMonth() + 1}월 ${tradeDateObj.getDate()}일`;
  const docNo   = `${tradeDateObj.getFullYear()}-${String(tradeDateObj.getMonth() + 1).padStart(2, '0')}-${String(issuedStatements.length + 1).padStart(4, '0')}`;

  const supplierLabel = stmtType === '매출' ? '【 공급자 】' : `【 공급자 】　${selectedClient?.name||''}`;
  const receiverLabel = stmtType === '매출' ? `【 공급받는자 】　${selectedClient?.name||''}` : '【 공급받는자 】';

  // ── 발행 처리 ──
  // 발행 가능 여부
  const canIssue = lineItems.length > 0 && selectedClientId && (manualMode || !!selectedOrderId);

  const markIssued = useCallback(() => {
    if (!selectedClientId || lineItems.length === 0) return;
    if (selectedOrderId) {
      onMarkInvoicePrinted?.(selectedOrderId, true);
    }
    const stmt: IssuedStatement = {
      id: `stmt-${Date.now()}`,
      issuedAt: new Date().toISOString(),
      tradeDate,
      type: stmtType,
      clientId: selectedClientId,
      clientName: selectedClient?.name || '',
      orderId: selectedOrderId,
      docNo,
      totalSupply,
      totalTax,
      totalAmount,
      items: lineItems.map(i => ({
        name: i.name, spec: i.spec, qty: i.qty, price: i.price,
        supply: i.supply, tax: i.tax, total: i.total, isTaxExempt: i.isTaxExempt,
        isBoxUnit: i.isBoxUnit, boxSize: i.boxSize,
      })),
    };
    onAddIssuedStatement?.(stmt);
    // 매출전표 발행 시 사용된 단가를 ProductClient에 자동 저장
    if (stmtType === '매출' && onUpdateProductClientPrice) {
      for (const item of lineItems) {
        if (!item.price || item.price <= 0) continue;
        const product = allProducts.find(p => (p.품목 || p.name) === item.name);
        if (!product) continue;
        const pc = productClients.find(p => p.productId === product.id && p.clientId === selectedClientId);
        if (pc && pc.price !== item.price) {
          onUpdateProductClientPrice(pc.id, item.price);
        }
      }
    }
    // 주문 기반 전표에서 품목/수량 변경 시 원본 주문 업데이트 (반품=음수 수량이면 주문 카드 영향 없음)
    const hasReturn = manualItems.some(r => (parseFloat(r.qty) || 0) < 0);
    if (manualMode && selectedOrderId && onUpdateOrder && selectedOrder && !hasReturn) {
      // 기존 주문 품목 이름 집합 (매칭용)
      const existingItemNames = new Set(selectedOrder.items.map(oi => {
        const product = allProducts.find(p => p.id === oi.productId);
        return (product?.품목 || oi.name).trim();
      }));
      // 기존 품목: 수량 업데이트
      const updatedItems = selectedOrder.items.map(oi => {
        const product = allProducts.find(p => p.id === oi.productId);
        const displayName = product?.품목 || oi.name;
        const row = manualItems.find(r => r.name.trim() === displayName.trim());
        if (row) return { ...oi, quantity: parseFloat(row.qty) || oi.quantity };
        return oi;
      });
      // 새로 추가된 품목: 기존 주문에 없는 항목 추가
      for (const row of manualItems) {
        const name = row.name.trim();
        if (!name || existingItemNames.has(name)) continue;
        const qty = parseFloat(row.qty) || 0;
        if (qty <= 0) continue;
        const product = allProducts.find(p => (p.품목 || p.name) === name);
        updatedItems.push({
          productId: product?.id || '',
          name,
          quantity: qty,
          price: parseFloat(row.price) || 0,
        });
      }
      onUpdateOrder(selectedOrderId, { items: updatedItems });
    }
    // 매입전표 발행 시 ProductSupplier 단가 자동 저장 + Product.cost 동기화
    if (stmtType === '매입' && onUpsertProductSupplier) {
      for (const item of lineItems) {
        if (!item.price || item.price <= 0) continue;
        const product = allProducts.find(p => (p.품목 || p.name) === item.name);
        if (!product || !selectedClientId) continue;
        const psId = `${product.id}_${selectedClientId}`;
        const existing = productSuppliers.find(s => s.id === psId);
        if (!existing || existing.price !== item.price) {
          onUpsertProductSupplier({ id: psId, productId: product.id, supplierId: selectedClientId, price: item.price, taxType: existing?.taxType });
          onUpdateProductCost?.(product.id, item.price);
        }
      }
    }
    // 매입전표 발행 시 입고대기(confirmedOrders)에 있는 품목 자동 제거 (전표가 입고 추적 담당)
    if (stmtType === '매입' && onRemoveConfirmedOrder) {
      for (const item of lineItems) {
        const product = allProducts.find(p => p.name === item.name);
        if (product) {
          const existing = confirmedOrders.find(c => c.id === product.id);
          if (existing) {
            onRemoveConfirmedOrder(existing.id);
          }
        }
      }
    }
    // 매입전표 발행 시 발주예정(orderRequests)에 있는 품목 자동 제거
    if (stmtType === '매입' && onRemoveOrderRequest) {
      for (const item of lineItems) {
        const product = allProducts.find(p => p.name === item.name);
        if (product) {
          const existing = orderRequests.find(r => r.id === product.id);
          if (existing) {
            onRemoveOrderRequest(existing.id);
          }
        }
      }
    }
  }, [manualMode, selectedOrderId, selectedClientId, tradeDate, stmtType, selectedClient, docNo, totalSupply, totalTax, totalAmount, lineItems, onMarkInvoicePrinted, onAddIssuedStatement, onAddConfirmedOrder, onRemoveConfirmedOrder, onRemoveOrderRequest, allProducts, confirmedOrders, orderRequests, productClients, productSuppliers, onUpdateProductClientPrice, onUpsertProductSupplier, onUpdateProductCost, onUpdateOrder, selectedOrder, manualItems]);

  const handleIssue = () => {
    markIssued();
    closeCreate();
  };

  const handleSaveEdit = useCallback(() => {
    if (!editingStmt || lineItems.length === 0) return;
    onUpdateIssuedStatement?.(editingStmt.id, {
      tradeDate,
      clientId: selectedClientId,
      clientName: selectedClient?.name || '',
      totalSupply,
      totalTax,
      totalAmount,
      items: lineItems.map(i => ({
        name: i.name, spec: i.spec, qty: i.qty, price: i.price,
        supply: i.supply, tax: i.tax, total: i.total, isTaxExempt: i.isTaxExempt,
        isBoxUnit: i.isBoxUnit, boxSize: i.boxSize,
      })),
    });
    setIsEditMode(false);
  }, [editingStmt, tradeDate, selectedClientId, selectedClient, totalSupply, totalTax, totalAmount, lineItems, onUpdateIssuedStatement]);

  const buildPrintHtml = (items: LineItem[] | IssuedStatement['items'], sup: number, tax: number, amt: number, type: StatementType, client: string, docNoStr: string, dateString: string) => {
    const m = dateString.match(/(\d+)년\s*(\d+)월\s*(\d+)일/);
    const yyyy = m ? m[1] : '';
    const mmN  = m ? m[2] : '';
    const dd   = m ? m[3] : '';
    const dateLabel = `${yyyy}-${mmN.padStart(2,'0')}-${dd.padStart(2,'0')}`;

    const ci = companyInfo;
    const isSale = type === '매출';

    const supName    = isSale ? (ci?.name || '') : client;
    const supCeo     = isSale ? (ci?.ceoName || '') : '';
    const supBizNo   = isSale ? (ci?.bizNo || '') : '';
    const supBizType = isSale ? (ci?.bizType || '') : '';
    const supBizItem = isSale ? (ci?.bizItem || '') : '';
    const supAddr    = isSale ? (ci?.address || '') : '';
    const supPhone   = isSale ? (ci?.phone || '') : '';
    const supFax     = isSale ? (ci?.fax || '') : '';

    const buyName    = isSale ? client : (ci?.name || '');
    const buyCeo     = isSale ? '' : (ci?.ceoName || '');
    const buyBizNo   = isSale ? '' : (ci?.bizNo || '');
    const buyBizType = isSale ? '' : (ci?.bizType || '');
    const buyBizItem = isSale ? '' : (ci?.bizItem || '');
    const buyAddr    = isSale ? '' : (ci?.address || '');
    const buyPhone   = isSale ? (clients.find(c => c.name === client)?.phone || '') : (ci?.phone || '');
    const buyFax   = isSale ? '' : (ci?.fax||'');

    const MAX_ROWS = 9;
    const itemList = items as any[];
    const totalQty = itemList.reduce((s,i)=>s+(Number(i.qty)||0),0);

    const makePage = (borderColor: string, pageLabel: string, stripeColor: string) => {
      const BC = borderColor;
      const SC = stripeColor;
      const LB = '#efefef';

      // ── 헤더 (테두리 바깥) ──
      const headerHtml = `
<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:0.5mm;">
  <span style="font-size:8px;">[순백지 출력_FA15출]</span>
  <span style="font-size:20px;font-weight:bold;letter-spacing:6px;color:${BC};">거&nbsp;&nbsp;래&nbsp;&nbsp;명&nbsp;&nbsp;세&nbsp;&nbsp;서</span>
  <span style="font-size:8px;">[재발행]</span>
</div>
<div style="display:flex;justify-content:space-between;align-items:center;font-size:8px;margin-bottom:0.5mm;">
  <span>전표일자 : <strong>${dateLabel}</strong></span>
  <span style="color:${BC};font-weight:bold;">${pageLabel}</span>
  <span>전표NO. : <strong>${docNoStr}</strong></span>
</div>`;

      // ── 회사 정보 ──
      const V = (t:string, extra='') =>
        `<td style="border:1px solid ${BC};padding:1px 4px;font-size:8px;${extra}">${t}</td>`;
      const L = (t:string) =>
        `<td style="border:1px solid ${BC};background:${LB};padding:1px 4px;font-size:7.5px;font-weight:bold;white-space:nowrap;text-align:center;">${t}</td>`;

      const infoHtml = `
<table style="width:100%;border-collapse:collapse;table-layout:fixed;">
  <colgroup>
    <col style="width:5.5mm;"/>
    <col style="width:13mm;"/><col/>
    <col style="width:5.5mm;"/>
    <col style="width:11mm;"/><col style="width:26mm;"/>
    <col style="width:13mm;"/><col style="width:22mm;"/>
  </colgroup>
  <tbody>
    <tr style="height:5.5mm;">
      <td rowspan="5" style="border:1px solid ${BC};background:${LB};text-align:center;vertical-align:middle;writing-mode:vertical-rl;letter-spacing:3px;font-size:8px;font-weight:bold;color:${BC};">공급받는자</td>
      ${L('상&nbsp;&nbsp;호')}${V(buyName,'font-weight:bold;font-size:9px;')}
      <td rowspan="5" style="border:1px solid ${BC};background:${LB};text-align:center;vertical-align:middle;writing-mode:vertical-rl;letter-spacing:3px;font-size:8px;font-weight:bold;color:${BC};">공급자</td>
      ${L('대&nbsp;&nbsp;표')}${V(supCeo,'font-weight:bold;')}${L('상&nbsp;&nbsp;호')}${V(supName,'font-weight:bold;font-size:9px;')}
    </tr>
    <tr style="height:5mm;">
      ${L('대&nbsp;&nbsp;표')}${V(buyCeo)}
      ${L('주&nbsp;&nbsp;소')}${V(supAddr,'font-size:7.5px;')} ${L('')}${V('')}
    </tr>
    <tr style="height:5mm;">
      ${L('사업자번호')}${V(buyBizNo)}
      ${L('전화번호')}${V(supPhone+(supFax?'&nbsp;&nbsp;FAX:'+supFax:''),'font-size:7.5px;')} ${L('')}${V('')}
    </tr>
    <tr style="height:5mm;">
      ${L('주&nbsp;&nbsp;소')}${V(buyAddr,'font-size:7.5px;')}
      ${L('사업번호')}${V(supBizNo)}${L('페이지')}${V('1 / 1','text-align:center;')}
    </tr>
    <tr style="height:5mm;">
      ${L('전화번호')}${V((buyPhone?buyPhone:'')+(buyFax?'&nbsp;&nbsp;FAX:'+buyFax:''),'font-size:7.5px;')}
      ${L('')}${V('')}${L('')}${V('')}
    </tr>
  </tbody>
</table>`;

      // ── 품목 테이블 ──
      const TH = (t:string) =>
        `<th style="border:1px solid ${BC};background:${SC};padding:1px 2px;font-size:8px;text-align:center;font-weight:bold;">${t}</th>`;

      const iRows = itemList.map((item:any, idx:number) => {
        const bg = idx%2===0 ? '#ffffff' : SC;
        return `<tr style="height:5.5mm;background:${bg};">
          <td style="border:1px solid ${BC};text-align:center;font-size:8px;padding:0 1px;">${idx+1}</td>
          <td style="border:1px solid ${BC};font-size:8px;padding:0 3px;overflow:hidden;white-space:nowrap;">${item.name||''}</td>
          <td style="border:1px solid ${BC};text-align:center;font-size:7.5px;padding:0 2px;">${item.spec||''}</td>
          <td style="border:1px solid ${BC};text-align:center;font-size:8px;padding:0 2px;">${(item as any).unit||'개'}</td>
          <td style="border:1px solid ${BC};text-align:right;font-size:8px;padding:0 3px;">${(item as any).isBoxUnit ? `${item.qty}BOX(${item.qty*12}개)` : fmt(item.qty)}</td>
          <td style="border:1px solid ${BC};text-align:right;font-size:8px;padding:0 3px;">${fmt(item.price)}</td>
          <td style="border:1px solid ${BC};text-align:right;font-size:8px;padding:0 3px;">${fmt(item.total)}</td>
        </tr>`;
      }).join('');

      // **** 이하여백 **** — 마지막 아이템 바로 다음
      const blankBg0 = itemList.length%2===0 ? '#ffffff' : SC;
      const blankRow = `<tr style="height:5.5mm;background:${blankBg0};">
        <td style="border:1px solid ${BC};text-align:center;font-size:8px;padding:0;"></td>
        <td colspan="6" style="border:1px solid ${BC};font-size:8px;padding:0 3px;color:${BC};">*&nbsp;*&nbsp;*&nbsp;*&nbsp;&nbsp;이&nbsp;하&nbsp;여&nbsp;백&nbsp;&nbsp;*&nbsp;*&nbsp;*&nbsp;*</td>
      </tr>`;

      const emptyCount = Math.max(0, MAX_ROWS - itemList.length - 1);
      const eRows = Array.from({length:emptyCount}).map((_,idx)=>{
        const bg = (itemList.length+1+idx)%2===0 ? '#ffffff' : SC;
        return `<tr style="height:5.5mm;background:${bg};">
          <td style="border:1px solid ${BC};"></td><td style="border:1px solid ${BC};"></td>
          <td style="border:1px solid ${BC};"></td><td style="border:1px solid ${BC};"></td>
          <td style="border:1px solid ${BC};"></td><td style="border:1px solid ${BC};"></td>
          <td style="border:1px solid ${BC};"></td>
        </tr>`;
      }).join('');

      const itemsHtml = `
<table style="width:100%;border-collapse:collapse;table-layout:fixed;">
  <colgroup>
    <col style="width:7mm;"/><col/><col style="width:19mm;"/>
    <col style="width:11mm;"/><col style="width:14mm;"/>
    <col style="width:19mm;"/><col style="width:23mm;"/>
  </colgroup>
  <thead>
    <tr style="background:${SC};">${TH('순번')}${TH('제&nbsp;&nbsp;&nbsp;품&nbsp;&nbsp;&nbsp;명')}${TH('규&nbsp;&nbsp;격')}${TH('단&nbsp;&nbsp;위')}${TH('수&nbsp;&nbsp;량')}${TH('단&nbsp;&nbsp;가')}${TH('금&nbsp;&nbsp;액')}</tr>
  </thead>
  <tbody>${iRows}${blankRow}${eRows}</tbody>
</table>`;

      // ── 합계 (전표소계 + 합계 2행) ──
      const totalsHtml = `
<table style="width:100%;border-collapse:collapse;table-layout:fixed;">
  <colgroup>
    <col style="width:14mm;"/><col style="width:12mm;"/>
    <col style="width:14mm;"/><col style="width:14mm;"/>
    <col style="width:18mm;"/><col style="width:14mm;"/>
    <col style="width:18mm;"/><col style="width:12mm;"/><col/>
  </colgroup>
  <tr style="height:5mm;background:${SC};">
    <td colspan="2" style="border:1px solid ${BC};text-align:center;font-size:7.5px;font-weight:bold;">전표소계&nbsp;수량</td>
    <td style="border:1px solid ${BC};"></td>
    <td style="border:1px solid ${BC};text-align:center;font-size:7.5px;font-weight:bold;">공급가</td>
    <td style="border:1px solid ${BC};"></td>
    <td style="border:1px solid ${BC};text-align:center;font-size:7.5px;font-weight:bold;">부가세</td>
    <td style="border:1px solid ${BC};"></td>
    <td style="border:1px solid ${BC};text-align:center;font-size:7.5px;font-weight:bold;">합&nbsp;계</td>
    <td style="border:1px solid ${BC};"></td>
  </tr>
  <tr style="height:5mm;background:${SC};">
    <td style="border:1px solid ${BC};text-align:center;font-size:7.5px;font-weight:bold;">합&nbsp;&nbsp;&nbsp;계</td>
    <td style="border:1px solid ${BC};text-align:center;font-size:7.5px;">수량</td>
    <td style="border:1px solid ${BC};text-align:right;font-size:8px;font-weight:bold;padding:0 3px;">${fmt(totalQty)}</td>
    <td style="border:1px solid ${BC};text-align:center;font-size:7.5px;">공급가</td>
    <td style="border:1px solid ${BC};text-align:right;font-size:8px;font-weight:bold;padding:0 3px;">${fmt(sup)}</td>
    <td style="border:1px solid ${BC};text-align:center;font-size:7.5px;">부가세</td>
    <td style="border:1px solid ${BC};text-align:right;font-size:8px;font-weight:bold;padding:0 3px;">${fmt(tax)}</td>
    <td style="border:1px solid ${BC};text-align:center;font-size:7.5px;">합계</td>
    <td style="border:1px solid ${BC};text-align:right;font-size:8px;font-weight:bold;padding:0 3px;">${fmt(amt)}</td>
  </tr>
</table>`;

      // ── 하단: 비고 | 인수 | 미수금 ──
      const now = new Date();
      const h = now.getHours(); const mn = now.getMinutes(); const sc2 = now.getSeconds();
      const ampm = h<12?'오전':'오후'; const hh = h%12||12;

      const bottomHtml = `
<table style="width:100%;border-collapse:collapse;">
  <tr>
    <td style="border:1px solid ${BC};width:5.5mm;text-align:center;vertical-align:top;font-size:9px;font-weight:bold;padding:2px 1px;">비</td>
    <td rowspan="2" style="border:1px solid ${BC};vertical-align:bottom;padding:2px 4px;font-size:7.5px;min-height:14mm;"></td>
    <td rowspan="2" style="border:1px solid ${BC};width:18mm;text-align:center;vertical-align:middle;font-size:8px;font-weight:bold;padding:2px;">인<br/><br/>수<br/><br/>확<br/><br/>인</td>
    <td rowspan="2" style="border:1px solid ${BC};padding:0;vertical-align:top;">
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="border-bottom:1px solid ${BC};border-right:1px solid ${BC};font-size:7.5px;padding:1px 3px;white-space:nowrap;">전일미수</td>
            <td style="border-bottom:1px solid ${BC};text-align:right;font-size:7.5px;padding:1px 4px;min-width:24mm;">0</td></tr>
        <tr><td style="border-bottom:1px solid ${BC};border-right:1px solid ${BC};font-size:7.5px;padding:1px 3px;">금일판매</td>
            <td style="border-bottom:1px solid ${BC};text-align:right;font-size:7.5px;padding:1px 4px;">${fmt(amt)}</td></tr>
        <tr><td style="border-bottom:1px solid ${BC};border-right:1px solid ${BC};font-size:7.5px;padding:1px 3px;">금일입금</td>
            <td style="border-bottom:1px solid ${BC};text-align:right;font-size:7.5px;padding:1px 4px;">0</td></tr>
        <tr><td style="border-right:1px solid ${BC};font-size:7.5px;font-weight:bold;padding:1px 3px;">금일미수</td>
            <td style="text-align:right;font-size:8px;font-weight:bold;padding:1px 4px;">${fmt(amt)}</td></tr>
      </table>
    </td>
  </tr>
  <tr>
    <td style="border:1px solid ${BC};width:5.5mm;text-align:center;vertical-align:bottom;font-size:9px;font-weight:bold;padding:2px 1px;">고</td>
  </tr>
</table>
<div style="display:flex;justify-content:space-between;font-size:7px;margin-top:0.5mm;color:#555;padding:0 1mm;">
  <span>발행일시 : ${dateLabel} ${ampm} ${hh}:${String(mn).padStart(2,'0')}:${String(sc2).padStart(2,'0')}</span>
  <span>${ci?.name||''}&nbsp;/&nbsp;${ci?.phone||''}</span>
</div>`;

      return `
<div style="font-family:'맑은 고딕',sans-serif;color:#000;box-sizing:border-box;">
  ${headerHtml}
  <div style="border:1.5px solid ${BC};">${infoHtml}${itemsHtml}${totalsHtml}${bottomHtml}</div>
</div>`;
    };

    return `
<div style="width:210mm;display:flex;flex-direction:column;gap:3mm;padding:5mm 6mm;box-sizing:border-box;">
  ${makePage('#cc0000','(공급자용)','#f5d8b0')}
  ${makePage('#0044cc','(공급받는자용)','#c4d4f0')}
</div>`;
  };

  const printViaIframe = (html: string, title: string) => {
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) { document.body.removeChild(iframe); return; }
    doc.open();
    doc.write(`<html><head><title>${title}</title>
      <style>
        @page{size:A4 portrait;margin:0;}
        *{margin:0;padding:0;box-sizing:border-box;print-color-adjust:exact;-webkit-print-color-adjust:exact;}
        body{font-family:'맑은 고딕',sans-serif;font-size:8px;color:#000;}
        table{border-collapse:collapse;}
      </style></head><body>${html}</body></html>`);
    doc.close();
    setTimeout(() => {
      iframe.contentWindow?.print();
      setTimeout(() => { document.body.removeChild(iframe); }, 1000);
    }, 400);
  };

  const handlePrint = () => {
    const html = buildPrintHtml(lineItems, totalSupply, totalTax, totalAmount, stmtType, selectedClient?.name || '', docNo, dateStr);
    printViaIframe(html, `${stmtType}전표`);
    // 기존 전표 조회 중이거나 이미 이번 세션에서 발행했으면 중복 저장 안 함
    if (!editingStmt && !hasIssuedRef.current) {
      markIssued();
      hasIssuedRef.current = true;
    }
  };

  const handleDetailPrint = (stmt: IssuedStatement) => {
    const d = new Date(stmt.tradeDate + 'T00:00:00');
    const ds = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
    const html = buildPrintHtml(stmt.items as any, stmt.totalSupply, stmt.totalTax, stmt.totalAmount, stmt.type, stmt.clientName, stmt.docNo, ds);
    printViaIframe(html, `${stmt.type}전표`);
  };

  const handleTaxInvoice = () => {
    const ci = companyInfo;
    const isSale = stmtType === '매출';
    const clientObj = selectedClient;
    const taxableItems = lineItems.filter(i => !i.isTaxExempt);
    const exemptItems  = lineItems.filter(i => i.isTaxExempt);
    const taxSupply = taxableItems.reduce((s,i)=>s+i.supply, 0);
    const taxAmt    = taxableItems.reduce((s,i)=>s+i.tax, 0);
    const exSupply  = exemptItems.reduce((s,i)=>s+i.supply, 0);

    const supName  = isSale ? (ci?.name||'') : (clientObj?.name||'');
    const supBizNo = isSale ? (ci?.bizNo||'') : '';
    const supCeo   = isSale ? (ci?.ceoName||'') : '';
    const supAddr  = isSale ? (ci?.address||'') : (clientObj?.region||'');
    const supBizType = isSale ? (ci?.bizType||'') : '';
    const supBizItem = isSale ? (ci?.bizItem||'') : '';
    const buyName  = isSale ? (clientObj?.name||'') : (ci?.name||'');
    const buyBizNo = isSale ? '' : (ci?.bizNo||'');
    const buyCeo   = isSale ? '' : (ci?.ceoName||'');
    const buyAddr  = isSale ? (clientObj?.region||'') : (ci?.address||'');
    const buyBizType = isSale ? '' : (ci?.bizType||'');
    const buyBizItem = isSale ? '' : (ci?.bizItem||'');

    const d = new Date(tradeDate+'T00:00:00');
    const yyyy = d.getFullYear(), mm = d.getMonth()+1, dd = d.getDate();

    const fmt2 = (n:number) => n.toLocaleString('ko-KR');

    const makeInfoTable = (title: string, bizNo: string, name: string, ceo: string, addr: string, bizType: string, bizItem: string) => `
<table style="border-collapse:collapse;width:100%;font-size:8px;">
  <tr>
    <td rowspan="4" style="border:1px solid #000;padding:2px 4px;font-weight:bold;text-align:center;width:16px;writing-mode:vertical-rl;letter-spacing:2px;">${title}</td>
    <td style="border:1px solid #000;padding:1px 4px;background:#f0f0f0;font-weight:bold;white-space:nowrap;">등록번호</td>
    <td colspan="3" style="border:1px solid #000;padding:1px 4px;font-weight:bold;letter-spacing:2px;">${bizNo}</td>
  </tr>
  <tr>
    <td style="border:1px solid #000;padding:1px 4px;background:#f0f0f0;font-weight:bold;white-space:nowrap;">상&nbsp;&nbsp;&nbsp;호</td>
    <td style="border:1px solid #000;padding:1px 4px;width:30%;">${name}</td>
    <td style="border:1px solid #000;padding:1px 4px;background:#f0f0f0;font-weight:bold;white-space:nowrap;">성&nbsp;&nbsp;&nbsp;명</td>
    <td style="border:1px solid #000;padding:1px 4px;">${ceo}</td>
  </tr>
  <tr>
    <td style="border:1px solid #000;padding:1px 4px;background:#f0f0f0;font-weight:bold;white-space:nowrap;">사업장주소</td>
    <td colspan="3" style="border:1px solid #000;padding:1px 4px;">${addr}</td>
  </tr>
  <tr>
    <td style="border:1px solid #000;padding:1px 4px;background:#f0f0f0;font-weight:bold;white-space:nowrap;">업&nbsp;&nbsp;&nbsp;태</td>
    <td style="border:1px solid #000;padding:1px 4px;">${bizType}</td>
    <td style="border:1px solid #000;padding:1px 4px;background:#f0f0f0;font-weight:bold;white-space:nowrap;">종&nbsp;&nbsp;&nbsp;목</td>
    <td style="border:1px solid #000;padding:1px 4px;">${bizItem}</td>
  </tr>
</table>`;

    const itemRows = lineItems.map(item => `
<tr>
  <td style="border:1px solid #000;padding:1px 3px;text-align:center;">${mm}</td>
  <td style="border:1px solid #000;padding:1px 3px;text-align:center;">${dd}</td>
  <td style="border:1px solid #000;padding:1px 3px;">${item.name}</td>
  <td style="border:1px solid #000;padding:1px 3px;text-align:center;">${item.spec||''}</td>
  <td style="border:1px solid #000;padding:1px 3px;text-align:right;">${item.isBoxUnit ? `${item.qty}BOX(${item.qty*12}개)` : fmt2(item.qty)}</td>
  <td style="border:1px solid #000;padding:1px 3px;text-align:right;">${fmt2(item.price)}</td>
  <td style="border:1px solid #000;padding:1px 3px;text-align:right;">${fmt2(item.supply)}</td>
  <td style="border:1px solid #000;padding:1px 3px;text-align:right;">${item.isTaxExempt?'면세':fmt2(item.tax)}</td>
  <td style="border:1px solid #000;padding:1px 3px;"></td>
</tr>`).join('');

    const emptyRows = Math.max(0, 9 - lineItems.length);
    const blankRows = Array(emptyRows).fill(`<tr>${Array(9).fill('<td style="border:1px solid #000;height:14px;"></td>').join('')}</tr>`).join('');

    const makePage = (copyLabel: string) => `
<div style="page-break-after:always;padding:6mm;font-family:'맑은 고딕',sans-serif;font-size:8px;color:#000;">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2mm;">
    <div style="font-size:7px;">※ 이 계산서는 부가가치세법 제32조 규정에 의하여 작성한 것입니다.</div>
    <div style="font-size:18px;font-weight:900;letter-spacing:6px;">세&nbsp;금&nbsp;계&nbsp;산&nbsp;서</div>
    <div style="font-size:9px;font-weight:bold;border:1px solid #000;padding:2px 8px;">${copyLabel}</div>
  </div>
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1mm;font-size:8px;">
    <span>작성일자: <strong>${yyyy}년 ${mm}월 ${dd}일</strong></span>
    <span>공급가액: <strong style="font-size:10px;">${fmt2(taxSupply+exSupply)}</strong>원</span>
    <span>세&nbsp;&nbsp;&nbsp;&nbsp;액: <strong style="font-size:10px;">${fmt2(taxAmt)}</strong>원</span>
    <span>전표No: <strong>${docNo}</strong></span>
  </div>
  <div style="display:flex;gap:4mm;margin-bottom:2mm;">
    <div style="flex:1;">${makeInfoTable('공급자', supBizNo, supName, supCeo, supAddr, supBizType, supBizItem)}</div>
    <div style="flex:1;">${makeInfoTable('공급받는자', buyBizNo, buyName, buyCeo, buyAddr, buyBizType, buyBizItem)}</div>
  </div>
  <table style="border-collapse:collapse;width:100%;font-size:8px;">
    <thead>
      <tr style="background:#f0f0f0;">
        <th style="border:1px solid #000;padding:2px 3px;width:18px;">월</th>
        <th style="border:1px solid #000;padding:2px 3px;width:18px;">일</th>
        <th style="border:1px solid #000;padding:2px 3px;">품&nbsp;&nbsp;&nbsp;&nbsp;목</th>
        <th style="border:1px solid #000;padding:2px 3px;width:50px;">규격</th>
        <th style="border:1px solid #000;padding:2px 3px;width:35px;">수량</th>
        <th style="border:1px solid #000;padding:2px 3px;width:60px;">단가</th>
        <th style="border:1px solid #000;padding:2px 3px;width:70px;">공급가액</th>
        <th style="border:1px solid #000;padding:2px 3px;width:60px;">세액</th>
        <th style="border:1px solid #000;padding:2px 3px;width:50px;">비고</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}${blankRows}
    </tbody>
    <tfoot>
      <tr style="background:#f0f0f0;font-weight:bold;">
        <td colspan="2" style="border:1px solid #000;padding:2px 3px;text-align:center;">합계</td>
        <td style="border:1px solid #000;"></td>
        <td style="border:1px solid #000;"></td>
        <td style="border:1px solid #000;padding:2px 3px;text-align:right;">${fmt2(lineItems.reduce((s,i)=>s+i.qty,0))}</td>
        <td style="border:1px solid #000;"></td>
        <td style="border:1px solid #000;padding:2px 3px;text-align:right;">${fmt2(taxSupply+exSupply)}</td>
        <td style="border:1px solid #000;padding:2px 3px;text-align:right;">${fmt2(taxAmt)}</td>
        <td style="border:1px solid #000;"></td>
      </tr>
    </tfoot>
  </table>
  <div style="margin-top:2mm;display:flex;justify-content:space-between;font-size:8px;">
    <span>합계금액(공급가액+세액): <strong style="font-size:11px;">${fmt2(taxSupply+exSupply+taxAmt)}</strong>원</span>
    ${exSupply>0?`<span style="color:#555;">면세공급가액: ${fmt2(exSupply)}원 포함</span>`:''}
    <span style="color:#888;">※ 국세청 홈택스(www.hometax.go.kr) 전자세금계산서 발급 시 이 서류를 참고하세요</span>
  </div>
</div>`;

    const html = makePage('공급자 보관용') + makePage('공급받는자 보관용');
    printViaIframe(html, '세금계산서');
    if (!editingStmt && !hasIssuedRef.current) {
      markIssued();
      hasIssuedRef.current = true;
    }
  };

  const handleReceipt = () => {
    const ci = companyInfo;
    const fmt2 = (n:number) => n.toLocaleString('ko-KR');
    const d = new Date(tradeDate+'T00:00:00');
    const ds = `${d.getFullYear()}.${d.getMonth()+1}.${d.getDate()}`;
    const html = `
<div style="font-family:'맑은 고딕',sans-serif;font-size:9px;color:#000;width:80mm;margin:0 auto;padding:4mm;">
  <div style="text-align:center;font-size:16px;font-weight:900;border-bottom:2px solid #000;padding-bottom:3mm;margin-bottom:3mm;">영&nbsp;&nbsp;수&nbsp;&nbsp;증</div>
  <div style="display:flex;justify-content:space-between;margin-bottom:1mm;">
    <span>일자: <strong>${ds}</strong></span>
    <span>No: ${docNo}</span>
  </div>
  <div style="margin-bottom:3mm;border-bottom:1px solid #ccc;padding-bottom:2mm;">
    <div>공급자: <strong>${ci?.name||''}</strong></div>
    <div>사업자: ${ci?.bizNo||''}</div>
    <div>주소: ${ci?.address||''}</div>
    <div>대표: ${ci?.ceoName||''}</div>
  </div>
  <div style="margin-bottom:1mm;border-bottom:1px solid #000;padding-bottom:1mm;font-weight:bold;">
    <span>거래처: ${selectedClient?.name||''}</span>
  </div>
  <table style="border-collapse:collapse;width:100%;margin-bottom:2mm;font-size:8px;">
    <thead>
      <tr style="background:#f0f0f0;">
        <th style="border:1px solid #ccc;padding:1px 3px;text-align:left;">품목</th>
        <th style="border:1px solid #ccc;padding:1px 3px;text-align:center;">수량</th>
        <th style="border:1px solid #ccc;padding:1px 3px;text-align:right;">금액</th>
      </tr>
    </thead>
    <tbody>
      ${lineItems.map(i=>`<tr>
        <td style="border:1px solid #ccc;padding:1px 3px;">${i.name}${i.spec?' ('+i.spec+')':''}</td>
        <td style="border:1px solid #ccc;padding:1px 3px;text-align:center;">${fmt2(i.qty)}</td>
        <td style="border:1px solid #ccc;padding:1px 3px;text-align:right;">${fmt2(i.total)}</td>
      </tr>`).join('')}
    </tbody>
  </table>
  <div style="border-top:2px solid #000;padding-top:2mm;">
    <div style="display:flex;justify-content:space-between;"><span>공급가액</span><span>${fmt2(totalSupply)}원</span></div>
    <div style="display:flex;justify-content:space-between;"><span>부가세</span><span>${fmt2(totalTax)}원</span></div>
    <div style="display:flex;justify-content:space-between;font-size:11px;font-weight:900;margin-top:1mm;border-top:1px solid #000;padding-top:1mm;">
      <span>합계</span><span>${fmt2(totalAmount)}원</span>
    </div>
  </div>
  <div style="margin-top:4mm;text-align:center;font-size:7px;color:#888;">위 금액을 정히 영수합니다</div>
  <div style="margin-top:6mm;text-align:right;">서&nbsp;&nbsp;명:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</div>
</div>`;
    printViaIframe(html, '영수증');
  };

  const handleExcel = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`${stmtType}전표`);
    const border: Partial<ExcelJS.Borders> = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
    const hFill: ExcelJS.Fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFD9E1F2'} };
    ws.columns = [{width:5},{width:20},{width:10},{width:8},{width:12},{width:14},{width:12},{width:14}];
    ws.mergeCells('A1:H1');
    const t = ws.getCell('A1');
    t.value = stmtType === '매출' ? '거  래  명  세  서' : '거  래  명  세  서 (매입)';
    t.font = {bold:true,size:18}; t.alignment={horizontal:'center',vertical:'middle'}; ws.getRow(1).height=36;
    ws.mergeCells('A2:D2'); ws.getCell('A2').value=`문서번호: ${docNo}`;
    ws.mergeCells('E2:H2'); ws.getCell('E2').value=`거래일자: ${dateStr}`; ws.getCell('E2').alignment={horizontal:'right'}; ws.getRow(2).height=18;
    ws.getRow(3).height=16; ws.mergeCells('A3:D3');
    ws.getCell('A3').value = stmtType==='매출' ? '【 공급자 】' : `【 공급자 】  ${selectedClient?.name||''}`;
    ws.getCell('A3').fill=hFill; ws.getCell('A3').font={bold:true}; ws.getCell('A3').border=border;
    ws.mergeCells('E3:H3');
    ws.getCell('E3').value = stmtType==='매출' ? `【 공급받는자 】  ${selectedClient?.name||''}` : '【 공급받는자 】';
    ws.getCell('E3').fill=hFill; ws.getCell('E3').font={bold:true}; ws.getCell('E3').border=border;
    ws.addRow([]);
    const hRow = ws.addRow(['No','품목명','규격','수량','단가','공급가액','세액','합계']);
    hRow.height=18; hRow.eachCell(c=>{c.font={bold:true,size:9};c.fill=hFill;c.border=border;c.alignment={horizontal:'center',vertical:'middle'};});
    lineItems.forEach(item=>{
      const r=ws.addRow([item.no,item.name,item.spec,item.qty,item.price,item.supply,item.isTaxExempt?'면세':item.tax,item.total]);
      r.height=16; r.eachCell((c,col)=>{c.border=border;c.font={size:9};c.alignment={horizontal:col<=3?'left':'right',vertical:'middle'};if(col>=4&&col!==7)c.numFmt='#,##0';});
    });
    const em=Math.max(0,10-lineItems.length);
    for(let i=0;i<em;i++){const r=ws.addRow(['','','','','','','','']);r.height=14;r.eachCell(c=>{c.border=border;});}
    const sr=ws.addRow(['합계','','','','',totalSupply,totalTax,totalAmount]);
    sr.height=18; sr.eachCell((c,col)=>{c.border=border;c.font={bold:true,size:9};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFEFF6FF'}};c.alignment={horizontal:col<=3?'center':'right',vertical:'middle'};if(col>=5)c.numFmt='#,##0';});
    ws.mergeCells(`A${sr.number}:E${sr.number}`);
    const buf=await wb.xlsx.writeBuffer();
    const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download=`${stmtType}전표_${selectedClient?.name||''}_${tradeDate}.xlsx`; a.click();
    URL.revokeObjectURL(url);
    markIssued();
  };

  // ── 단가 패널 / 등록 품목 ──
  // 매출 전표용: productClients 테이블 기반 (거래처별 단가 포함)
  const clientProductRows = useMemo(() =>
    productClients.filter(pc=>pc.clientId===selectedClientId)
      .map(pc=>({ pc, product: allProducts.find(p=>p.id===pc.productId) }))
      .filter(r=>r.product),
    [productClients, selectedClientId, allProducts]
  );

  // 매입 전표용: supplierId로 연결된 품목 + ProductSupplier 단가
  // pc는 ProductClient 호환 shim (searchableRows 공통 사용을 위해)
  const supplierProductRows = useMemo(() =>
    allProducts
      .filter(p => p.supplierId === selectedClientId)
      .map(p => {
        const ps = productSuppliers.find(s => s.productId === p.id && s.supplierId === selectedClientId)
          ?? { id: `${p.id}_${selectedClientId}`, productId: p.id, supplierId: selectedClientId } as ProductSupplier;
        const pc = { id: ps.id, productId: ps.productId, clientId: ps.supplierId, price: ps.price, taxType: ps.taxType };
        return { pc, ps, product: p };
      }),
    [allProducts, selectedClientId, productSuppliers]
  );

  // 현재 모드에 따른 검색 소스
  const searchableRows = createMode === '매입' ? supplierProductRows : clientProductRows;

  // 매출 단가 저장
  const savePcPrice = (pcId: string) => {
    const val = parseFloat(pricePanelEdits[pcId] || '');
    if (!isNaN(val) && val >= 0) onUpdateProductClientPrice?.(pcId, val);
  };

  // 매입 단가 저장 (ProductSupplier upsert + Product.cost 동기화)
  const savePsPrice = (ps: ProductSupplier, newPrice: number) => {
    if (isNaN(newPrice) || newPrice < 0) return;
    onUpsertProductSupplier?.({ ...ps, price: newPrice });
    onUpdateProductCost?.(ps.productId, newPrice);
  };

  // ── 등록 품목 추가 (직접입력 모드) ──
  const addProductRow = useCallback((pc: typeof clientProductRows[0]) => {
    setManualItems(prev => {
      const filled = prev.filter(r => r.name.trim());
      return [
        ...filled,
        { name: pc.product!.name, spec: pc.product!.용량 || '', qty: '1', price: String(pc.pc.price ?? pc.product!.price ?? 0), isTaxExempt: false },
        { name: '', spec: '', qty: '', price: '', isTaxExempt: false },
      ];
    });
  }, []);

  // ── 발행내역 필터링 ──
  const filteredHistory = useMemo(() => {
    return issuedStatements
      .filter(s => {
        const d = s.tradeDate;
        if (histFrom && d < histFrom) return false;
        if (histTo   && d > histTo)   return false;
        if (histTypeFilter !== '전체' && s.type !== histTypeFilter) return false;
        if (histSearch.trim()) {
          const q = histSearch.toLowerCase();
          if (!s.clientName.toLowerCase().includes(q) && !s.docNo.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  }, [issuedStatements, histFrom, histTo, histTypeFilter, histSearch]);

  const setQuickRange = (preset: '당일'|'금주'|'당월'|'당년'|'ALL') => {
    setHistQuick(preset);
    if (preset === 'ALL') { setHistFrom(''); setHistTo(''); return; }
    const t = today();
    if (preset === '당일')  { setHistFrom(t); setHistTo(t); }
    if (preset === '금주')  { setHistFrom(weekStart()); setHistTo(t); }
    if (preset === '당월')  { setHistFrom(monthStart()); setHistTo(t); }
    if (preset === '당년')  { setHistFrom(yearStart()); setHistTo(t); }
  };

  // ── 주문 클릭 처리 (중복 발행 감지) ──
  const handleOrderClick = (o: Order) => {
    const existing = issuedStatements.find(s => s.orderId === o.id);
    if (existing && o.invoicePrinted) {
      setWarnDuplicate({ order: o, stmt: existing });
    } else {
      if (o.id === selectedOrderId) {
        setSelectedOrderId('');
        setManualMode(false);
        setManualItems([{ name: '', spec: '', qty: '', price: '', isTaxExempt: false }]);
      } else {
        setSelectedOrderId(o.id);
        setTradeDate(o.createdAt.slice(0, 10));
        setShowPreview(false);
        setEditablePrices({});
        setTaxExemptOverrides({});
        // 주문 품목을 편집 가능한 형태로 미리 채움
        const rows: ManualRow[] = o.items.map(item => {
          const product = allProducts.find(p => p.id === item.productId);
          const displayName = product?.품목 || item.name;
          const spec = product?.용량 || '';
          const pcEntry = productClients.find(pc => pc.productId === item.productId && pc.clientId === o.clientId);
          const price = pcEntry?.price ?? item.price ?? product?.price ?? 0;
          const isTaxExempt = pcEntry?.taxType === '면세';
          return { name: displayName, spec, qty: String(item.quantity), price: String(price), isTaxExempt, note: '' };
        });
        rows.push({ name: '', spec: '', qty: '', price: '', isTaxExempt: false, note: '' });
        setManualItems(rows);
        setManualMode(true);
      }
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-300">

      <PageHeader
        title="거래명세서"
        subtitle="발행된 전표를 조회하거나 새 전표를 생성합니다."
        right={<div className="flex items-center gap-2">
          {mainTab === 'history' && <>
            <button
              onClick={() => openCreate('매입')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black bg-rose-600 text-white hover:bg-rose-700 shadow-sm transition-all"
            >
              <Plus size={13} strokeWidth={3}/>매입전표
            </button>
            <button
              onClick={() => openCreate('매출')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black bg-blue-600 text-white hover:bg-blue-700 shadow-sm transition-all"
            >
              <Plus size={13} strokeWidth={3}/>매출전표
            </button>
          </>}
          <button
            onClick={() => { setShowCompanyModal(true); setCompanyForm(companyInfo ?? { name:'',ceoName:'',bizNo:'',bizType:'',bizItem:'',address:'',phone:'',fax:'',email:'' }); }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black bg-slate-100 text-slate-500 hover:bg-slate-200 transition-all"
            title="회사 정보 설정"
          >
            <Save size={13}/>회사정보
          </button>
        </div>}
      />

      {/* 탭 네비게이션 */}
      <div className="flex bg-slate-100 rounded-xl p-1 gap-1 self-start overflow-x-auto no-scrollbar">
        {([
          { id: 'history',     icon: ClipboardList, label: '전표내역'   },
          { id: 'prices',      icon: Tag,           label: '단가관리'   },
          { id: 'taxinvoice',  icon: FileText,      label: '세금계산서' },
        ] as const).map(t => (
          <button key={t.id}
            onClick={() => setMainTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-black transition-all whitespace-nowrap ${mainTab === t.id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <t.icon size={13}/>{t.label}
          </button>
        ))}
      </div>

      {/* ── 단가관리 탭 ── */}
      {mainTab === 'prices' && (() => {
        const filteredClients = clients
          .filter(c => !priceClientSearch || c.name.includes(priceClientSearch))
          .sort((a, b) => a.name.localeCompare(b.name));

        // ── 매출단가용 ──
        const selectedPcRows = priceClientId
          ? productClients
              .filter(pc => pc.clientId === priceClientId)
              .map(pc => ({ pc, product: allProducts.find(p => p.id === pc.productId) }))
              .filter(r => r.product)
              .sort((a, b) => a.product!.name.localeCompare(b.product!.name))
          : [];

        // ── 매입단가용 ──
        const selectedPsRows = priceClientId
          ? allProducts
              .filter(p => p.supplierId === priceClientId)
              .map(p => {
                const ps = productSuppliers.find(s => s.productId === p.id && s.supplierId === priceClientId)
                  ?? { id: `${p.id}_${priceClientId}`, productId: p.id, supplierId: priceClientId } as ProductSupplier;
                return { ps, product: p };
              })
              .sort((a, b) => a.product.name.localeCompare(b.product.name))
          : [];

        const hasMissingPrice = priceTabMode === '매출'
          ? selectedPcRows.some(r => !r.pc.price)
          : selectedPsRows.some(r => !r.ps.price);

        const saveAll = async () => {
          setPriceSaving(true);
          if (priceTabMode === '매출') {
            for (const [pcId, val] of Object.entries(priceEdits)) {
              const n = parseFloat(val);
              if (!isNaN(n) && n >= 0) onUpdateProductClientPrice?.(pcId, n);
            }
            for (const [pcId, tax] of Object.entries(priceTaxEdits)) {
              onUpdateProductClientTaxType?.(pcId, tax);
            }
            for (const [productId, val] of Object.entries(costEdits)) {
              const n = parseFloat(val);
              if (!isNaN(n) && n >= 0) onUpdateProductCost?.(productId, n);
            }
          } else {
            // 매입단가 저장: ProductSupplier upsert + Product.cost 동기화
            for (const [psId, val] of Object.entries(priceEdits)) {
              const n = parseFloat(val);
              if (isNaN(n) || n < 0) continue;
              const row = selectedPsRows.find(r => r.ps.id === psId);
              if (!row) continue;
              onUpsertProductSupplier?.({ ...row.ps, price: n });
              onUpdateProductCost?.(row.ps.productId, n);
            }
            for (const [psId, tax] of Object.entries(priceTaxEdits)) {
              const row = selectedPsRows.find(r => r.ps.id === psId);
              if (!row) continue;
              onUpsertProductSupplier?.({ ...row.ps, taxType: tax });
              onUpdateProductSupplierTaxType?.(psId, tax);
            }
          }
          setPriceEdits({});
          setPriceTaxEdits({});
          setCostEdits({});
          setPriceSaving(false);
          setPriceSaved(true);
          setTimeout(() => setPriceSaved(false), 2000);
        };

        const hasEdits = Object.keys(priceEdits).length > 0 || Object.keys(priceTaxEdits).length > 0 || Object.keys(costEdits).length > 0;

        return (
          <div className="flex gap-4 min-h-[600px]">
            {/* 좌측: 거래처 목록 */}
            <div className="w-56 shrink-0 bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden">
              <div className="px-3 pt-3 pb-2 border-b border-slate-100">
                <div className="relative">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none"/>
                  <input
                    type="text"
                    placeholder="거래처 검색..."
                    value={priceClientSearch}
                    onChange={e => setPriceClientSearch(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-7 pr-2 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-violet-300"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
                {filteredClients.map(c => {
                  const pcCount = priceTabMode === '매출'
                    ? productClients.filter(pc => pc.clientId === c.id).length
                    : allProducts.filter(p => p.supplierId === c.id).length;
                  const missingCount = priceTabMode === '매출'
                    ? productClients.filter(pc => pc.clientId === c.id && !pc.price).length
                    : allProducts.filter(p => p.supplierId === c.id && !productSuppliers.find(s => s.productId === p.id && s.supplierId === c.id)?.price).length;
                  if (pcCount === 0) return null;
                  return (
                    <button
                      key={c.id}
                      onClick={() => { setPriceClientId(c.id); setPriceEdits({}); setPriceTaxEdits({}); }}
                      className={`w-full text-left px-3 py-2.5 transition-all hover:bg-violet-50 ${priceClientId === c.id ? 'bg-violet-50 border-r-2 border-violet-500' : ''}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`text-xs font-black truncate ${priceClientId === c.id ? 'text-violet-700' : 'text-slate-700'}`}>{c.name}</span>
                        {missingCount > 0 && (
                          <span className="text-[9px] font-black bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full ml-1 shrink-0">{missingCount}</span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-400">{pcCount}품목</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 우측: 단가 테이블 */}
            <div className="flex-1 bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden">
              {/* 매출/매입 토글 */}
              <div className="flex items-center gap-2 px-5 pt-3 pb-2 border-b border-slate-100">
                <div className="flex bg-slate-100 rounded-lg p-0.5 gap-0.5">
                  {(['매출', '매입'] as const).map(m => (
                    <button key={m} onClick={() => { setPriceTabMode(m); setPriceClientId(''); setPriceEdits({}); setPriceTaxEdits({}); setCostEdits({}); }}
                      className={`px-3 py-1 rounded-md text-xs font-black transition-all ${priceTabMode === m ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                      {m}단가
                    </button>
                  ))}
                </div>
                <span className="text-[10px] text-slate-400">{priceTabMode === '매출' ? '거래처별 판매단가' : '매입처별 매입단가 (= 원가)'}</span>
              </div>
              {!priceClientId ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-300">
                  <Tag size={40} strokeWidth={1.5}/>
                  <span className="text-sm font-bold">좌측에서 거래처를 선택하세요</span>
                </div>
              ) : (
                <>
                  {/* 헤더 */}
                  <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <span className="font-black text-slate-900 text-sm">{clients.find(c => c.id === priceClientId)?.name}</span>
                      <span className="text-xs text-slate-400">{selectedPcRows.length}품목</span>
                      {hasMissingPrice && (
                        <div className="flex items-center gap-1 text-[10px] font-black text-amber-600 bg-amber-50 px-2 py-1 rounded-lg">
                          <AlertCircle size={10}/>단가 미입력 품목 있음
                        </div>
                      )}
                    </div>
                    <button
                      onClick={saveAll}
                      disabled={!hasEdits || priceSaving}
                      className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black transition-all ${
                        priceSaved ? 'bg-emerald-500 text-white' :
                        hasEdits ? 'bg-violet-600 text-white hover:bg-violet-700' :
                        'bg-slate-100 text-slate-300 cursor-not-allowed'
                      }`}
                    >
                      <Save size={12}/>{priceSaved ? '저장완료!' : '전체 저장'}
                    </button>
                  </div>

                  {/* 테이블 */}
                  <div className="flex-1 overflow-y-auto">
                    {priceTabMode === '매출' ? (
                    <table className="w-full text-left border-collapse">
                      <thead className="sticky top-0 bg-slate-50 z-10">
                        <tr>
                          <th className="px-5 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest">품목명</th>
                          <th className="px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest">용량/규격</th>
                          <th className="px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">원가</th>
                          <th className="px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">매출단가</th>
                          <th className="px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">마진율</th>
                          <th className="px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">과세</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {selectedPcRows.map(({ pc, product }) => {
                          const priceEdited = priceEdits[pc.id] !== undefined;
                          const costEdited = costEdits[product!.id] !== undefined;
                          const taxEdited = priceTaxEdits[pc.id] !== undefined;
                          const currentTax = priceTaxEdits[pc.id] ?? pc.taxType ?? '과세';
                          const priceInputVal = priceEdits[pc.id] ?? '';
                          const costInputVal = costEdits[product!.id] ?? '';
                          const hasNoPrice = !pc.price;
                          const effectivePrice = priceEdits[pc.id] ? parseFloat(priceEdits[pc.id]) : (pc.price ?? 0);
                          const effectiveCost = costEdits[product!.id] ? parseFloat(costEdits[product!.id]) : (product!.cost ?? 0);
                          const margin = effectivePrice > 0 && effectiveCost > 0
                            ? Math.round((effectivePrice - effectiveCost) / effectivePrice * 100) : null;
                          return (
                            <tr key={pc.id} className={`hover:bg-slate-50 transition-colors ${hasNoPrice ? 'bg-amber-50/40' : ''}`}>
                              <td className="px-5 py-3">
                                <span className="text-xs font-black text-slate-800">{product!.name}</span>
                                {hasNoPrice && <span className="ml-1.5 text-[9px] font-black text-amber-500 bg-amber-100 px-1.5 py-0.5 rounded-full">단가 미입력</span>}
                              </td>
                              <td className="px-4 py-3 text-[11px] text-slate-400">{product!.용량 || '-'}</td>
                              <td className="px-4 py-3"><div className="flex justify-end">
                                <input type="number" placeholder={product!.cost ? String(product!.cost) : '원가'} value={costInputVal}
                                  onChange={e => setCostEdits(prev => ({ ...prev, [product!.id]: e.target.value }))}
                                  className={`w-24 text-right bg-white border rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-orange-300 transition-all ${costEdited ? 'border-orange-400 bg-orange-50' : 'border-slate-200'}`}/>
                              </div></td>
                              <td className="px-4 py-3"><div className="flex justify-end">
                                <input type="number" placeholder={pc.price ? String(pc.price) : '단가 입력'} value={priceInputVal}
                                  onChange={e => setPriceEdits(prev => ({ ...prev, [pc.id]: e.target.value }))}
                                  className={`w-24 text-right bg-white border rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-violet-300 transition-all ${priceEdited ? 'border-violet-400 bg-violet-50' : 'border-slate-200'}`}/>
                              </div></td>
                              <td className="px-4 py-3 text-center">
                                {margin !== null ? (
                                  <span className={`text-[11px] font-black px-2 py-1 rounded-lg ${margin >= 30 ? 'bg-emerald-100 text-emerald-700' : margin >= 10 ? 'bg-amber-100 text-amber-700' : margin >= 0 ? 'bg-slate-100 text-slate-600' : 'bg-rose-100 text-rose-700'}`}>{margin}%</span>
                                ) : <span className="text-[10px] text-slate-300">—</span>}
                              </td>
                              <td className="px-4 py-3 text-center">
                                <button onClick={() => setPriceTaxEdits(prev => ({ ...prev, [pc.id]: (priceTaxEdits[pc.id] ?? pc.taxType ?? '과세') === '과세' ? '면세' : '과세' }))}
                                  className={`px-3 py-1.5 rounded-lg text-[10px] font-black border transition-all ${taxEdited ? currentTax === '면세' ? 'bg-indigo-500 text-white border-indigo-500' : 'bg-slate-500 text-white border-slate-500' : currentTax === '면세' ? 'bg-indigo-100 text-indigo-700 border-indigo-200' : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'}`}>
                                  {currentTax}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    ) : (
                    /* ── 매입단가 테이블 ── */
                    <table className="w-full text-left border-collapse">
                      <thead className="sticky top-0 bg-slate-50 z-10">
                        <tr>
                          <th className="px-5 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest">품목명</th>
                          <th className="px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest">용량/규격</th>
                          <th className="px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">매입단가(원가)</th>
                          <th className="px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">과세</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {selectedPsRows.map(({ ps, product }) => {
                          const edited = priceEdits[ps.id] !== undefined;
                          const taxEdited = priceTaxEdits[ps.id] !== undefined;
                          const currentTax = priceTaxEdits[ps.id] ?? ps.taxType ?? '과세';
                          const hasNoPrice = !ps.price;
                          return (
                            <tr key={ps.id} className={`hover:bg-slate-50 transition-colors ${hasNoPrice ? 'bg-amber-50/40' : ''}`}>
                              <td className="px-5 py-3">
                                <span className="text-xs font-black text-slate-800">{product.name}</span>
                                {hasNoPrice && <span className="ml-1.5 text-[9px] font-black text-amber-500 bg-amber-100 px-1.5 py-0.5 rounded-full">미입력</span>}
                              </td>
                              <td className="px-4 py-3 text-[11px] text-slate-400">{product.용량 || '-'}</td>
                              <td className="px-4 py-3"><div className="flex justify-end">
                                <input type="number" placeholder={ps.price ? String(ps.price) : '매입단가'} value={priceEdits[ps.id] ?? ''}
                                  onChange={e => setPriceEdits(prev => ({ ...prev, [ps.id]: e.target.value }))}
                                  className={`w-28 text-right bg-white border rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-rose-300 transition-all ${edited ? 'border-rose-400 bg-rose-50' : 'border-slate-200'}`}/>
                              </div></td>
                              <td className="px-4 py-3 text-center">
                                <button onClick={() => setPriceTaxEdits(prev => ({ ...prev, [ps.id]: (priceTaxEdits[ps.id] ?? ps.taxType ?? '과세') === '과세' ? '면세' : '과세' }))}
                                  className={`px-3 py-1.5 rounded-lg text-[10px] font-black border transition-all ${taxEdited ? currentTax === '면세' ? 'bg-indigo-500 text-white border-indigo-500' : 'bg-slate-500 text-white border-slate-500' : currentTax === '면세' ? 'bg-indigo-100 text-indigo-700 border-indigo-200' : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'}`}>
                                  {currentTax}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── 세금계산서 탭 ── */}
      {mainTab === 'taxinvoice' && (() => {
        const taxClients = clients
          .filter(c => issuedStatements.some(s => s.clientId === c.id && s.type === '매출'))
          .filter(c => !taxClientSearch || c.name.includes(taxClientSearch))
          .sort((a, b) => a.name.localeCompare(b.name));

        const clientStmts = taxClientId
          ? issuedStatements.filter(s => s.clientId === taxClientId && s.type === '매출')
              .sort((a, b) => b.tradeDate.localeCompare(a.tradeDate))
          : [];

        // 월별 그룹
        const byMonth = new Map<string, IssuedStatement[]>();
        clientStmts.forEach(s => {
          const ym = s.tradeDate.slice(0, 7);
          if (!byMonth.has(ym)) byMonth.set(ym, []);
          byMonth.get(ym)!.push(s);
        });
        const months = [...byMonth.keys()].sort((a, b) => b.localeCompare(a));

        // 선택된 전표들
        const selectedStmts = clientStmts.filter(s => taxStmtIds.includes(s.id));

        // 선택 전표 품목 합산 (과세/면세 분리)
        type MergedItem = { name: string; spec: string; qty: number; supply: number; tax: number; total: number; isTaxExempt: boolean };
        const mergedMap = new Map<string, MergedItem>();
        selectedStmts.forEach(stmt => {
          stmt.items.forEach(item => {
            const k = `${item.name}||${item.spec}||${item.isTaxExempt}`;
            const ex = mergedMap.get(k);
            if (ex) { ex.qty += item.qty; ex.supply += item.supply; ex.tax += item.tax; ex.total += item.total; }
            else mergedMap.set(k, { name: item.name, spec: item.spec, qty: item.qty, supply: item.supply, tax: item.tax, total: item.total, isTaxExempt: !!item.isTaxExempt });
          });
        });
        const allCombined = [...mergedMap.values()];
        const taxableItems = allCombined.filter(i => !i.isTaxExempt);
        const exemptItems  = allCombined.filter(i => i.isTaxExempt);
        const taxSupply  = taxableItems.reduce((s, i) => s + i.supply, 0);
        const taxAmt     = taxableItems.reduce((s, i) => s + i.tax, 0);
        const exemptSup  = exemptItems.reduce((s, i) => s + i.supply, 0);
        const grandTotal = taxSupply + taxAmt + exemptSup;

        const toggleStmt = (id: string) =>
          setTaxStmtIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

        const toggleMonth = (ym: string) => {
          const ids = (byMonth.get(ym) || []).map(s => s.id);
          const allSel = ids.every(id => taxStmtIds.includes(id));
          setTaxStmtIds(prev => allSel ? prev.filter(id => !ids.includes(id)) : [...new Set([...prev, ...ids])]);
        };

        const selectedClient = clients.find(c => c.id === taxClientId);
        const sup = companyInfo;
        const tradeMonth = selectedStmts.length > 0 ? selectedStmts[selectedStmts.length - 1].tradeDate.slice(0, 7) : '';

        const handleTaxPdf = async () => {
          if (!taxPrintRef.current || selectedStmts.length === 0) return;
          const html2canvas = (await import('html2canvas')).default;
          const jsPDF = (await import('jspdf')).default;
          const canvas = await html2canvas(taxPrintRef.current, { scale: 2, useCORS: true });
          const imgData = canvas.toDataURL('image/png');
          const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
          const pageW = pdf.internal.pageSize.getWidth(), pageH = pdf.internal.pageSize.getHeight();
          const imgW = pageW - 20, imgH = canvas.height * imgW / canvas.width;
          const yOffset = imgH < pageH ? (pageH - imgH) / 2 : 10;
          pdf.addImage(imgData, 'PNG', 10, yOffset, imgW, imgH);
          pdf.save(`세금계산서_${selectedClient?.name}_${tradeMonth}.pdf`);
          selectedStmts.forEach(s => onUpdateIssuedStatement?.(s.id, { receivedAt: new Date().toISOString() } as any));
        };

        const handleTaxPrint = () => {
          if (!taxPrintRef.current || selectedStmts.length === 0) return;
          const win = window.open('', '_blank', 'width=900,height=700');
          if (!win) return;
          win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>세금계산서</title>
            <style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:'Malgun Gothic','맑은 고딕',sans-serif;font-size:10px;background:#fff;padding:12px;}
            .wrap{border:2px solid #000;width:100%;}.title-row{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #000;padding:6px 10px;}
            .title-row h1{font-size:18px;font-weight:900;letter-spacing:6px;}.info-grid{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid #000;}
            .info-box{padding:6px 8px;border-right:1px solid #000;}.info-box:last-child{border-right:none;}
            .info-box h3{font-size:9px;font-weight:900;color:#333;margin-bottom:4px;border-bottom:1px solid #eee;padding-bottom:2px;}
            .info-row{display:flex;gap:4px;margin-bottom:2px;font-size:9px;}.info-row label{color:#666;width:64px;}
            .items-table{width:100%;border-collapse:collapse;font-size:9px;}
            .items-table th{background:#f5f5f5;border:1px solid #ccc;padding:4px 6px;font-weight:900;text-align:center;}
            .items-table td{border:1px solid #ccc;padding:4px 6px;text-align:right;}.items-table td.left{text-align:left;}.items-table td.center{text-align:center;}
            .section-header{background:#e8f0fe;font-weight:900;font-size:9px;padding:3px 6px;border:1px solid #ccc;}
            .total-row{display:flex;justify-content:flex-end;gap:16px;padding:8px 10px;border-top:2px solid #000;font-size:11px;font-weight:900;}
            @media print{body{padding:0;}@page{margin:8mm;}}</style></head><body>`);
          win.document.write(taxPrintRef.current.innerHTML);
          win.document.write('</body></html>');
          win.document.close(); win.focus();
          setTimeout(() => win.print(), 500);
          selectedStmts.forEach(s => onUpdateIssuedStatement?.(s.id, { receivedAt: new Date().toISOString() } as any));
        };

        const fmt2 = (n: number) => n.toLocaleString('ko-KR');
        const buyer = selectedClient;

        return (
          <div className="flex gap-4 min-h-[600px]">
            {/* 좌측: 거래처 + 월별 전표 선택 */}
            <div className="w-64 shrink-0 flex flex-col gap-3">
              {/* 거래처 목록 */}
              <div className="bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden" style={{maxHeight:280}}>
                <div className="px-3 pt-3 pb-2 border-b border-slate-100">
                  <div className="relative">
                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none"/>
                    <input type="text" placeholder="거래처 검색..." value={taxClientSearch}
                      onChange={e => setTaxClientSearch(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-7 pr-2 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-emerald-300"/>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
                  {taxClients.map(c => (
                    <button key={c.id} onClick={() => { setTaxClientId(c.id); setTaxStmtIds([]); }}
                      className={`w-full text-left px-3 py-2.5 transition-all hover:bg-emerald-50 ${taxClientId === c.id ? 'bg-emerald-50 border-r-2 border-emerald-500' : ''}`}>
                      <span className={`text-xs font-black ${taxClientId === c.id ? 'text-emerald-700' : 'text-slate-700'}`}>{c.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* 선택 요약 */}
              {taxStmtIds.length > 0 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 space-y-1.5">
                  <div className="text-[10px] font-black text-emerald-700 uppercase tracking-widest">{taxStmtIds.length}건 선택</div>
                  {taxSupply > 0 && <div className="text-xs text-slate-600">과세 공급가: <b>{fmt2(taxSupply)}</b>원</div>}
                  {taxAmt > 0 && <div className="text-xs text-slate-600">세액: <b>{fmt2(taxAmt)}</b>원</div>}
                  {exemptSup > 0 && <div className="text-xs text-slate-600">면세 공급가: <b>{fmt2(exemptSup)}</b>원</div>}
                  <div className="text-sm font-black text-emerald-700 border-t border-emerald-200 pt-1.5">합계 {fmt2(grandTotal)}원</div>
                  <div className="flex gap-1.5 pt-1">
                    <button onClick={handleTaxPdf}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-blue-600 text-white rounded-lg text-[11px] font-black hover:bg-blue-700">
                      <Download size={10}/>PDF
                    </button>
                    <button onClick={handleTaxPrint}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-emerald-600 text-white rounded-lg text-[11px] font-black hover:bg-emerald-700">
                      <Printer size={10}/>인쇄
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 우측: 월별 전표 목록 + 미리보기 */}
            <div className="flex-1 flex flex-col gap-3 min-w-0">
              {!taxClientId ? (
                <div className="flex flex-col items-center justify-center h-full bg-white rounded-2xl border border-dashed border-slate-200 py-20">
                  <FileText size={36} className="text-slate-200 mb-3"/>
                  <p className="text-slate-400 text-sm font-bold">거래처를 선택하세요</p>
                </div>
              ) : clientStmts.length === 0 ? (
                <div className="bg-white rounded-2xl border border-dashed border-slate-200 py-12 text-center text-slate-400 text-sm font-bold">발행된 전표가 없습니다</div>
              ) : (<>
                {/* 공급받는자 정보 */}
                <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">공급받는자 정보 (선택)</p>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { key: 'bizNo', label: '사업자번호', placeholder: '000-00-00000' },
                      { key: 'ceoName', label: '대표자명', placeholder: '홍길동' },
                      { key: 'bizType', label: '업태', placeholder: '제조업' },
                      { key: 'bizItem', label: '종목', placeholder: '식품' },
                      { key: 'address', label: '주소', placeholder: '사업장 주소' },
                    ].map(f => (
                      <div key={f.key}>
                        <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">{f.label}</label>
                        <input type="text" placeholder={f.placeholder}
                          value={(taxBuyerInfo as any)[f.key]}
                          onChange={e => setTaxBuyerInfo(prev => ({ ...prev, [f.key]: e.target.value }))}
                          className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-emerald-300"/>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 월별 전표 선택 */}
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  {months.map(ym => {
                    const stmts = byMonth.get(ym)!;
                    const allSel = stmts.every(s => taxStmtIds.includes(s.id));
                    const someSel = stmts.some(s => taxStmtIds.includes(s.id));
                    return (
                      <div key={ym}>
                        <div className="flex items-center gap-3 px-4 py-2 bg-slate-50 border-b border-slate-100 sticky top-0">
                          <button onClick={() => toggleMonth(ym)}
                            className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${allSel ? 'bg-emerald-600 border-emerald-600' : someSel ? 'bg-emerald-200 border-emerald-400' : 'border-slate-300'}`}>
                            {(allSel || someSel) && <CheckSquare size={10} className="text-white"/>}
                          </button>
                          <span className="text-[11px] font-black text-slate-700">{ym.replace('-', '년 ')}월</span>
                          <span className="text-[10px] text-slate-400">{stmts.length}건</span>
                          <span className="ml-auto text-[11px] font-black text-slate-600">
                            {fmt2(stmts.reduce((s, r) => s + r.totalAmount, 0))}원
                          </span>
                        </div>
                        {stmts.map(s => {
                          const isSel = taxStmtIds.includes(s.id);
                          const isIssued = !!(s as any).receivedAt;
                          return (
                            <button key={s.id} onClick={() => toggleStmt(s.id)}
                              className={`w-full flex items-center gap-3 px-4 py-2.5 border-b border-slate-50 text-left transition-all ${isSel ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}>
                              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all ${isSel ? 'bg-emerald-600 border-emerald-600' : 'border-slate-300'}`}>
                                {isSel && <CheckSquare size={10} className="text-white"/>}
                              </div>
                              <span className="text-xs font-black text-slate-700">{s.tradeDate}</span>
                              <span className="text-[10px] text-slate-400 font-mono">{s.docNo}</span>
                              <span className="text-[10px] text-slate-400 flex-1 truncate">
                                {s.items.slice(0,2).map(i=>i.name).join(', ')}{s.items.length>2?` 외 ${s.items.length-2}건`:''}
                              </span>
                              {isIssued && <span className="text-[9px] font-black bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full shrink-0">발행</span>}
                              <span className={`text-xs font-black shrink-0 ${isSel ? 'text-emerald-700' : 'text-slate-700'}`}>{fmt2(s.totalAmount)}원</span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>

                {/* 선택 전표 세금계산서 미리보기 */}
                {taxStmtIds.length > 0 && (
                  <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">세금계산서 미리보기</span>
                    </div>
                    {/* 과세/면세 총액 요약 카드 */}
                    <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap gap-4">
                      {taxableItems.length > 0 && (
                        <div className="flex items-center gap-3 bg-blue-50 border border-blue-100 rounded-xl px-4 py-2.5">
                          <span className="text-[11px] font-black text-blue-600">과세</span>
                          <span className="text-xs text-slate-600">공급가 <b className="text-slate-900">{fmt2(taxSupply)}</b></span>
                          <span className="text-xs text-slate-600">세액 <b className="text-slate-900">{fmt2(taxAmt)}</b></span>
                          <span className="text-sm font-black text-blue-700">{fmt2(taxSupply+taxAmt)}원</span>
                        </div>
                      )}
                      {exemptItems.length > 0 && (
                        <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-2.5">
                          <span className="text-[11px] font-black text-indigo-600">면세</span>
                          <span className="text-xs text-slate-600">공급가 <b className="text-slate-900">{fmt2(exemptSup)}</b></span>
                          <span className="text-sm font-black text-indigo-700">{fmt2(exemptSup)}원</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-2.5 ml-auto">
                        <span className="text-[11px] font-black text-emerald-600">합계</span>
                        <span className="text-lg font-black text-emerald-700">{fmt2(grandTotal)}원</span>
                      </div>
                    </div>
                    <div className="p-4 overflow-x-auto">
                      <div ref={taxPrintRef}>
                        <div className="wrap border-2 border-black" style={{fontFamily:"'Malgun Gothic','맑은 고딕',sans-serif",minWidth:640,fontSize:'11px'}}>
                          <div className="flex items-center justify-between border-b-2 border-black px-4 py-3">
                            <h1 style={{fontSize:'22px',fontWeight:900,letterSpacing:'6px'}}>세 금 계 산 서</h1>
                            <div className="text-right" style={{fontSize:'10px',color:'#666'}}>
                              <div>거래처: {buyer?.name}</div>
                              <div>발행기간: {tradeMonth}</div>
                            </div>
                          </div>
                          {/* 공급자 / 공급받는자 */}
                          <div className="grid grid-cols-2 border-b border-black">
                            <div className="p-3 border-r border-black">
                              <h3 style={{fontSize:'10px',fontWeight:900,marginBottom:'6px',paddingBottom:'4px',borderBottom:'1px solid #eee',color:'#444'}}>공 급 자</h3>
                              {[['등록번호', sup?.bizNo||''], ['상    호', sup?.name||''], ['대 표 자', sup?.ceoName||''], ['사업장주소', sup?.address||''], ['업    태', sup?.bizType||''], ['종    목', sup?.bizItem||'']].map(([label, value]) => (
                                <div key={label} style={{display:'flex',gap:'8px',marginBottom:'3px',fontSize:'10px'}}>
                                  <span style={{color:'#666',width:'60px',flexShrink:0}}>{label}</span>
                                  <span style={{fontWeight:700}}>{value}</span>
                                </div>
                              ))}
                            </div>
                            <div className="p-3">
                              <h3 style={{fontSize:'10px',fontWeight:900,marginBottom:'6px',paddingBottom:'4px',borderBottom:'1px solid #eee',color:'#444'}}>공급받는자</h3>
                              {[['등록번호', taxBuyerInfo.bizNo||''], ['상    호', buyer?.name||''], ['대 표 자', taxBuyerInfo.ceoName||''], ['사업장주소', taxBuyerInfo.address||''], ['업    태', taxBuyerInfo.bizType||''], ['종    목', taxBuyerInfo.bizItem||'']].map(([label, value]) => (
                                <div key={label} style={{display:'flex',gap:'8px',marginBottom:'3px',fontSize:'10px'}}>
                                  <span style={{color:'#666',width:'60px',flexShrink:0}}>{label}</span>
                                  <span style={{fontWeight:700}}>{value}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                          {/* 품목표 */}
                          <table style={{width:'100%',borderCollapse:'collapse',fontSize:'11px'}}>
                            <thead>
                              <tr>
                                {['품목', '규격', '수량', '공급가액', '세액', '합계'].map(h => (
                                  <th key={h} style={{border:'1px solid #ccc',background:'#f5f5f5',padding:'6px 8px',fontWeight:900,textAlign:'center'}}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {taxableItems.length > 0 && (<>
                                <tr><td colSpan={6} style={{padding:'4px 8px',background:'#dbeafe',fontWeight:900,color:'#1d4ed8',border:'1px solid #ccc',fontSize:'10px'}}>▶ 과세 품목</td></tr>
                                {taxableItems.map((item, i) => (
                                  <tr key={i}>
                                    <td style={{border:'1px solid #ccc',padding:'5px 8px',fontWeight:700}}>{item.name}</td>
                                    <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'center'}}>{item.spec}</td>
                                    <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right'}}>{fmt2(item.qty)}</td>
                                    <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right'}}>{fmt2(item.supply)}</td>
                                    <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right'}}>{fmt2(item.tax)}</td>
                                    <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900}}>{fmt2(item.total)}</td>
                                  </tr>
                                ))}
                                <tr style={{background:'#eff6ff'}}>
                                  <td colSpan={3} style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900,color:'#1d4ed8'}}>과세 소계</td>
                                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900,color:'#1d4ed8'}}>{fmt2(taxSupply)}</td>
                                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900,color:'#1d4ed8'}}>{fmt2(taxAmt)}</td>
                                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900,color:'#1d4ed8'}}>{fmt2(taxSupply+taxAmt)}</td>
                                </tr>
                              </>)}
                              {exemptItems.length > 0 && (<>
                                <tr><td colSpan={6} style={{padding:'4px 8px',background:'#e0e7ff',fontWeight:900,color:'#4338ca',border:'1px solid #ccc',fontSize:'10px'}}>▶ 면세 품목</td></tr>
                                {exemptItems.map((item, i) => (
                                  <tr key={i}>
                                    <td style={{border:'1px solid #ccc',padding:'5px 8px',fontWeight:700}}>{item.name}</td>
                                    <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'center'}}>{item.spec}</td>
                                    <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right'}}>{fmt2(item.qty)}</td>
                                    <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right'}}>{fmt2(item.supply)}</td>
                                    <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'center',color:'#666'}}>면세</td>
                                    <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900}}>{fmt2(item.supply)}</td>
                                  </tr>
                                ))}
                                <tr style={{background:'#eef2ff'}}>
                                  <td colSpan={3} style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900,color:'#4338ca'}}>면세 소계</td>
                                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900,color:'#4338ca'}}>{fmt2(exemptSup)}</td>
                                  <td style={{border:'1px solid #ccc',padding:'5px 8px'}}/>
                                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900,color:'#4338ca'}}>{fmt2(exemptSup)}</td>
                                </tr>
                              </>)}
                              <tr style={{background:'#f1f5f9'}}>
                                <td colSpan={3} style={{border:'1px solid #ccc',padding:'7px 8px',textAlign:'right',fontWeight:900,fontSize:'12px'}}>합 계</td>
                                <td style={{border:'1px solid #ccc',padding:'7px 8px',textAlign:'right',fontWeight:900}}>{fmt2(taxSupply+exemptSup)}</td>
                                <td style={{border:'1px solid #ccc',padding:'7px 8px',textAlign:'right',fontWeight:900}}>{fmt2(taxAmt)}</td>
                                <td style={{border:'1px solid #ccc',padding:'7px 8px',textAlign:'right',fontWeight:900,color:'#059669',fontSize:'13px'}}>{fmt2(grandTotal)}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>)}
            </div>
          </div>
        );
      })()}

      {/* ── 회사 정보 설정 모달 ── */}
      {showCompanyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => setShowCompanyModal(false)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <span className="font-black text-slate-900">회사 정보 설정</span>
              <button onClick={() => setShowCompanyModal(false)} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl"><X size={18}/></button>
            </div>
            <div className="px-6 py-5 space-y-3">
              {([
                { key: 'name', label: '상호 (회사명)', placeholder: '(주)회사명' },
                { key: 'bizNo', label: '사업자등록번호', placeholder: '000-00-00000' },
                { key: 'ceoName', label: '대표자명', placeholder: '홍길동' },
                { key: 'address', label: '사업장 주소', placeholder: '경기도 ...' },
                { key: 'bizType', label: '업태', placeholder: '제조업' },
                { key: 'bizItem', label: '종목', placeholder: '식품 제조·판매' },
                { key: 'phone', label: '전화번호', placeholder: '031-000-0000' },
                { key: 'fax', label: '팩스번호', placeholder: '031-000-0000' },
                { key: 'email', label: '이메일', placeholder: 'info@company.com' },
              ] as { key: keyof CompanyInfo; label: string; placeholder: string }[]).map(f => (
                <div key={f.key} className="grid grid-cols-3 items-center gap-3">
                  <label className="text-xs font-black text-slate-500 text-right">{f.label}</label>
                  <input type="text" placeholder={f.placeholder}
                    value={companyForm[f.key] ?? ''}
                    onChange={e => setCompanyForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                    className="col-span-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-300"/>
                </div>
              ))}
            </div>
            <div className="flex gap-2 px-6 pb-5">
              <button onClick={() => setShowCompanyModal(false)}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-xs font-black hover:bg-slate-200">취소</button>
              <button onClick={() => { onSaveCompanyInfo?.(companyForm); setShowCompanyModal(false); }}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-black hover:bg-emerald-700 flex items-center justify-center gap-1.5">
                <Save size={13}/>저장
              </button>
            </div>
          </div>
        </div>
      )}

      {mainTab === 'history' && <>

      {/* ── 필터 바 ── */}
      <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3 space-y-2.5">
        {/* 1행: 기간 퀵버튼 + 날짜 직접입력 */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest w-10 shrink-0">기간</span>
          {(['당일','금주','당월','당년','ALL'] as const).map(p => (
            <button key={p} onClick={()=>setQuickRange(p)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-black border transition-all ${
                histQuick===p
                  ? 'bg-slate-700 text-white border-slate-700'
                  : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400 hover:text-slate-700'
              }`}>{p}</button>
          ))}
          <div className="flex items-center gap-1.5 ml-1">
            <input type="date" value={histFrom}
              onChange={e=>{setHistFrom(e.target.value);setHistQuick('');}}
              className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300"/>
            <span className="text-slate-300 text-xs">~</span>
            <input type="date" value={histTo}
              onChange={e=>{setHistTo(e.target.value);setHistQuick('');}}
              className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300"/>
          </div>
        </div>
        <div className="border-t border-slate-100"/>
        {/* 2행: 유형 + 검색 + 건수 */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest w-10 shrink-0">유형</span>
          {(['전체','매출','매입'] as const).map(t => (
            <button key={t} onClick={()=>setHistTypeFilter(t)}
              className={`px-3.5 py-1.5 rounded-lg text-[11px] font-black border transition-all ${
                histTypeFilter===t
                  ? t==='매출' ? 'bg-blue-600 text-white border-blue-600'
                    : t==='매입' ? 'bg-rose-600 text-white border-rose-600'
                    : 'bg-slate-700 text-white border-slate-700'
                  : 'bg-white text-slate-400 border-slate-200 hover:border-slate-400 hover:text-slate-600'
              }`}>{t}</button>
          ))}
          <div className="relative flex-1 max-w-xs ml-1">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none"/>
            <input type="text" placeholder="업체명 또는 문서번호" value={histSearch}
              onChange={e=>setHistSearch(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-8 pr-3 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-400"/>
          </div>
          <span className="text-[11px] text-slate-400 font-bold shrink-0">{filteredHistory.length}건</span>
        </div>
      </div>

      {/* ── 발행내역 테이블 ── */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {filteredHistory.length === 0 ? (
          <div className="py-16 text-center text-slate-300 text-sm font-bold">
            <FileText size={32} className="mx-auto mb-2 opacity-40"/>
            발행된 전표가 없습니다
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 whitespace-nowrap">전표일자</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 whitespace-nowrap">구분</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400">업체명</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 text-right whitespace-nowrap">합계</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 text-right whitespace-nowrap">잔액</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400">거래내역</th>
                <th className="px-4 py-3"/>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredHistory.map(stmt => {
                const issuedDate = new Date(stmt.issuedAt);
                const dateLabel  = `${stmt.tradeDate} ${String(issuedDate.getHours()).padStart(2,'0')}:${String(issuedDate.getMinutes()).padStart(2,'0')}`;
                const summary    = stmt.items.slice(0, 2).map(i => i.name).join(', ') + (stmt.items.length > 2 ? ` 외 ${stmt.items.length - 2}건` : '');
                const isReturn   = stmt.items.some(i => i.qty < 0);
                return (
                  <tr key={stmt.id} className={`transition-colors cursor-pointer ${isReturn ? 'bg-rose-50 hover:bg-rose-100' : 'hover:bg-slate-50'}`}
                    onClick={() => openEdit(stmt)}>
                    <td className="px-4 py-3 text-[11px] font-mono text-slate-600 whitespace-nowrap">{dateLabel}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                          stmt.type === '매출' ? 'bg-blue-100 text-blue-700' : 'bg-rose-100 text-rose-700'
                        }`}>{stmt.type}</span>
                        {isReturn && <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">반품</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs font-bold text-slate-800">{stmt.clientName}</td>
                    <td className={`px-4 py-3 text-xs text-right font-black ${isReturn ? 'text-rose-600' : 'text-slate-800'}`}>{fmt(stmt.totalAmount)}</td>
                    <td className="px-4 py-3 text-xs text-right">
                      {(() => {
                        const bal = getBalance(stmt);
                        return bal > 0
                          ? <span className="font-black text-rose-600">{fmt(bal)}</span>
                          : <span className="text-emerald-500 font-black">완납</span>;
                      })()}
                    </td>
                    <td className="px-4 py-3 text-[11px] text-slate-400 max-w-[180px] truncate">{summary}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {getBalance(stmt) > 0 && (
                          <button onClick={e=>{e.stopPropagation();openPayModal(stmt);}}
                            className={`text-[10px] font-black px-2 py-1 rounded-lg transition-all flex items-center gap-1 ${
                              stmt.type === '매입'
                                ? 'bg-rose-50 text-rose-600 hover:bg-rose-100'
                                : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                            }`}>
                            <Save size={10}/>{stmt.type === '매입' ? '지불처리' : '수불처리'}
                          </button>
                        )}
                        <button onClick={e=>{e.stopPropagation();handleDetailPrint(stmt);}}
                          className="text-[10px] font-black px-2 py-1 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-lg transition-all flex items-center gap-1">
                          <Printer size={10}/>인쇄
                        </button>
                        <button onClick={e=>{e.stopPropagation();if(window.confirm('이 전표를 삭제하시겠습니까?'))onDeleteIssuedStatement?.(stmt.id);}}
                          className="text-[10px] font-black px-2 py-1 bg-red-50 text-red-500 hover:bg-red-100 rounded-lg transition-all flex items-center gap-1">
                          <X size={10}/>삭제
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── 지불/수불 처리 모달 ── */}
      {payTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => setPayTarget(null)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 space-y-4"
            onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-black text-slate-800">
              {payTarget.type === '매입' ? '지불처리 — 미지급금 감소' : '수불처리 — 미수금 감소'}
            </h3>
            <div className="text-xs text-slate-400">{payTarget.clientName} · {payTarget.tradeDate}</div>
            <div className="bg-slate-50 rounded-xl px-4 py-3 text-xs text-center">
              <span className="text-slate-500">잔여 {payTarget.type === '매입' ? '미지급금' : '미수금'} </span>
              <span className="font-black text-rose-600 text-base">{fmt(getBalance(payTarget))}원</span>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">금액</label>
                <input type="number" value={payForm.amount}
                  onChange={e => setPayForm(p => ({ ...p, amount: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-300"/>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">일자</label>
                <input type="date" value={payForm.date}
                  onChange={e => setPayForm(p => ({ ...p, date: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-300"/>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">결제 방법</label>
                <div className="flex gap-1.5 flex-wrap">
                  {(['현금', '계좌이체', '어음', '카드', '기타'] as PaymentRecord['method'][]).map(m => (
                    <button key={String(m)} onClick={() => setPayForm(p => ({ ...p, method: m }))}
                      className={`px-3 py-1.5 rounded-lg text-xs font-black border transition-all ${payForm.method === m ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">비고</label>
                <input type="text" placeholder="예: 1차 분할" value={payForm.note}
                  onChange={e => setPayForm(p => ({ ...p, note: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300"/>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setPayTarget(null)}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-xs font-black hover:bg-slate-200">취소</button>
              <button onClick={savePayment}
                disabled={!payForm.amount || Number(payForm.amount) <= 0}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-black hover:bg-blue-700 disabled:opacity-40 flex items-center justify-center gap-1.5">
                <Save size={12}/>저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 발행내역 상세 모달 ── */}
      {detailStmt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={()=>setDetailStmt(null)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
            onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-black px-2.5 py-1 rounded-full ${detailStmt.type==='매출'?'bg-blue-100 text-blue-700':'bg-rose-100 text-rose-700'}`}>{detailStmt.type}</span>
                <span className="font-black text-slate-900">{detailStmt.clientName}</span>
                <span className="text-xs text-slate-400">{detailStmt.tradeDate}</span>
                <span className="text-[10px] text-slate-300 font-mono">{detailStmt.docNo}</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={()=>handleDetailPrint(detailStmt)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-slate-700 text-white rounded-xl text-xs font-black hover:bg-slate-800">
                  <Printer size={12}/>인쇄
                </button>
                <button onClick={()=>{if(window.confirm('이 전표를 삭제하시겠습니까?')){onDeleteIssuedStatement?.(detailStmt.id);setDetailStmt(null);}}}
                  className="flex items-center gap-1.5 px-3 py-2 bg-red-500 text-white rounded-xl text-xs font-black hover:bg-red-600">
                  <X size={12}/>삭제
                </button>
                <button onClick={()=>setDetailStmt(null)} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl">✕</button>
              </div>
            </div>
            <div className="p-6 overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50">
                    {['No','품목명','규격','수량','단가','공급가액','세액','합계'].map(h=>(
                      <th key={h} className="border border-slate-200 px-3 py-2 text-[10px] font-black text-slate-500 text-center whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {detailStmt.items.map((item, i) => (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="border border-slate-200 px-3 py-2 text-[11px] text-center">{i+1}</td>
                      <td className="border border-slate-200 px-3 py-2 text-[11px] font-bold">{item.name}</td>
                      <td className="border border-slate-200 px-3 py-2 text-[11px] text-center">{item.spec}</td>
                      <td className="border border-slate-200 px-3 py-2 text-[11px] text-right">{fmt(item.qty)}</td>
                      <td className="border border-slate-200 px-3 py-2 text-[11px] text-right">{fmt(item.price)}</td>
                      <td className="border border-slate-200 px-3 py-2 text-[11px] text-right">{fmt(item.supply)}</td>
                      <td className="border border-slate-200 px-3 py-2 text-[11px] text-right">{item.isTaxExempt?'면세':fmt(item.tax)}</td>
                      <td className="border border-slate-200 px-3 py-2 text-[11px] text-right font-black">{fmt(item.total)}</td>
                    </tr>
                  ))}
                  <tr className="bg-blue-50">
                    <td colSpan={5} className="border border-slate-200 px-3 py-2 text-xs font-black text-center">합계</td>
                    <td className="border border-slate-200 px-3 py-2 text-xs font-black text-right">{fmt(detailStmt.totalSupply)}</td>
                    <td className="border border-slate-200 px-3 py-2 text-xs font-black text-right">{fmt(detailStmt.totalTax)}</td>
                    <td className="border border-slate-200 px-3 py-2 text-xs font-black text-right text-indigo-800">{fmt(detailStmt.totalAmount)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════ 전표 생성 모달 ══════════════════════════════════════ */}
      {createMode && (
        <div className="fixed inset-0 z-40 flex items-end justify-center pb-2">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={closeCreate}/>
          <div className="relative w-full max-w-6xl flex flex-col bg-white rounded-t-3xl shadow-2xl overflow-hidden"
               style={{height:'calc(100vh - 56px)'}}>

            {/* ── 헤더 ── */}
            <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-100 flex-shrink-0">
              <span className={`text-xs font-black px-2.5 py-1 rounded-full ${createMode==='매출'?'bg-blue-100 text-blue-700':'bg-rose-100 text-rose-700'}`}>
                {createMode==='매출'?'매출':'매입'}전표
              </span>
              {editingStmt && (
                <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded-lg">[수정중] {editingStmt.docNo}</span>
              )}
              {selectedClient
                ? <span className="font-black text-slate-900">{selectedClient.name}</span>
                : <span className="text-slate-400 font-bold text-sm">거래처를 선택하세요</span>
              }
              {selectedClient?.phone && <span className="text-xs text-slate-400">{selectedClient.phone}</span>}
              <span className="text-slate-200">·</span>
              {editingStmt && !isEditMode
                ? <span className="text-xs font-black text-slate-700 bg-slate-100 px-2.5 py-1.5 rounded-lg">{tradeDate}</span>
                : <input type="date" value={tradeDate} onChange={e=>setTradeDate(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300 cursor-pointer"/>}
              <div className="ml-auto flex items-center gap-2">
                <button onClick={()=>{closeCreate();setTimeout(()=>setCreateMode(stmtType),50);}}
                  className="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-600 text-xs font-black hover:bg-slate-200 transition-all">
                  새 전표
                </button>
                <button onClick={closeCreate} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl transition-all">
                  <X size={18}/>
                </button>
              </div>
            </div>

            {/* ── 거래처 선택 / 모드 전환 바 ── */}
            <div className="flex items-center gap-2 px-5 py-2.5 border-b border-slate-100 flex-shrink-0 bg-slate-50 flex-wrap">
              {!selectedClientId ? (<>
                <div className="relative">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none"/>
                  <input type="text" placeholder="거래처 검색..." value={clientSearch}
                    onChange={e=>setClientSearch(e.target.value)}
                    className="bg-white border border-slate-200 rounded-lg pl-7 pr-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300 w-40"/>
                </div>
                <select value={selectedClientId}
                  onChange={e=>{setSelectedClientId(e.target.value);setSelectedOrderId('');setEditablePrices({});setTaxExemptOverrides({});setSelectedConfirmedIds([]);}}
                  className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300 min-w-[180px]">
                  <option value="">— 거래처 선택 —</option>
                  {availableClients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {createMode==='매출' && (
                  <button onClick={()=>setOnlyActive(v=>!v)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-black border transition-all ${onlyActive?'bg-blue-600 text-white border-blue-600':'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}>
                    진행 주문만
                  </button>
                )}
              </>) : (<>
                <button onClick={()=>{setSelectedClientId('');setSelectedOrderId('');setEditablePrices({});setTaxExemptOverrides({});setShowPricePanel(false);setManualItems([{name:'',spec:'',qty:'',price:'',isTaxExempt:false}]);setSelectedConfirmedIds([]);}}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-black text-slate-600 hover:bg-slate-100 transition-all shrink-0">
                  <ChevronLeft size={12}/>거래처 변경
                </button>
                {searchableRows.length>0 && (
                  <button onClick={()=>setShowPricePanel(v=>!v)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-black border transition-all ${showPricePanel?'bg-violet-600 text-white border-violet-600':'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}>
                    단가관리
                  </button>
                )}
                {createMode==='매출' && !editingStmt && (
                  <div className="ml-auto flex bg-slate-200 rounded-lg p-0.5 gap-0.5">
                    <button onClick={()=>setManualMode(false)}
                      className={`px-3 py-1 rounded-md text-xs font-black transition-all ${!manualMode?'bg-white text-slate-800 shadow-sm':'text-slate-500 hover:text-slate-700'}`}>
                      주문 불러오기
                    </button>
                    <button onClick={()=>setManualMode(true)}
                      className={`px-3 py-1 rounded-md text-xs font-black transition-all ${manualMode?'bg-white text-slate-800 shadow-sm':'text-slate-500 hover:text-slate-700'}`}>
                      직접 입력
                    </button>
                  </div>
                )}
              </>)}
            </div>

            {/* ── 단가관리 패널 ── */}
            {showPricePanel && selectedClientId && searchableRows.length > 0 && (
              <div className="flex-shrink-0 border-b border-slate-100 max-h-36 overflow-y-auto">
                <div className="px-5 py-2 bg-violet-50 sticky top-0">
                  <span className="text-[10px] font-black text-violet-600 uppercase tracking-widest">단가·과세 관리 ({searchableRows.length}품목)</span>
                </div>
                <div className="divide-y divide-slate-50">
                  {searchableRows.map(({pc,product})=>(
                    <div key={pc.id} className="flex items-center gap-3 px-5 py-2">
                      <span className="text-xs font-black text-slate-700 flex-1 truncate">{product!.name}</span>
                      {product!.용량 && <span className="text-[10px] text-slate-400">{product!.용량}</span>}
                      <input type="number" placeholder="단가"
                        value={pricePanelEdits[pc.id]??(pc.price!==undefined?String(pc.price):'')}
                        onChange={e=>setPricePanelEdits(prev=>({...prev,[pc.id]:e.target.value}))}
                        className="w-24 text-right bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-violet-300"/>
                      <button onClick={()=>onUpdateProductClientTaxType?.(pc.id,pc.taxType==='면세'?'과세':'면세')}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-black border transition-all ${pc.taxType==='면세'?'bg-indigo-500 text-white border-indigo-500':'bg-white text-slate-500 border-slate-200 hover:bg-slate-100'}`}>
                        {pc.taxType==='면세'?'면세':'과세'}
                      </button>
                      <button onClick={()=>savePcPrice(pc.id)}
                        className="px-2.5 py-1 rounded-lg text-[10px] font-black bg-violet-600 text-white hover:bg-violet-700 transition-all">
                        저장
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── 중간 단계: 주문/발주 선택 ── */}
            {selectedClientId && !(selectedOrderId || manualMode || editingStmt) && (
              <div className="flex-1 overflow-y-auto flex flex-col min-h-0">
                <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100 bg-slate-50 flex-shrink-0 flex-wrap">
                  <span className="text-xs font-black text-slate-600">{createMode==='매출'?'주문 선택':'발주 선택'}</span>
                  {createMode==='매출' && <span className="text-xs text-slate-400">{clientOrders.length}건</span>}
                  {createMode==='매출' && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {(['당일','금주','당월'] as const).map(p=>(
                        <button key={p} onClick={()=>{
                          const t=today();
                          const from=p==='당일'?t:p==='금주'?weekStart():monthStart();
                          setDateFrom(from);setDateTo(t);setOrderDateQuick(p);
                        }}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-black border transition-all ${orderDateQuick===p?'bg-slate-700 text-white border-slate-700':'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}>{p}</button>
                      ))}
                      <input type="date" value={dateFrom} onChange={e=>{setDateFrom(e.target.value);setOrderDateQuick('');}}
                        className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300"/>
                      <span className="text-slate-300 text-xs">~</span>
                      <input type="date" value={dateTo} onChange={e=>{setDateTo(e.target.value);setOrderDateQuick('');}}
                        className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300"/>
                      {(dateFrom||dateTo)&&!orderDateQuick&&(
                        <button onClick={()=>{setDateFrom('');setDateTo('');setOrderDateQuick('');}}
                          className="text-xs text-slate-400 hover:text-slate-700 font-black">전체</button>
                      )}
                    </div>
                  )}
                  {createMode==='매입' && (
                    <div className="ml-auto flex items-center gap-2">
                      {selectedConfirmedIds.length > 0 && (
                        <button
                          onClick={loadSelectedToManual}
                          className="px-3 py-1.5 rounded-lg text-xs font-black bg-indigo-600 text-white hover:bg-indigo-700 transition-all">
                          전표 작성 ({selectedConfirmedIds.length}건)
                        </button>
                      )}
                      <button onClick={()=>setManualMode(true)}
                        className="px-3 py-1.5 rounded-lg text-xs font-black bg-slate-700 text-white hover:bg-slate-800 transition-all">
                        직접 입력
                      </button>
                    </div>
                  )}
                </div>

                {createMode==='매출' && (()=>{
                  if(clientOrders.length===0) return (
                    <div className="flex flex-col items-center justify-center flex-1 py-12 text-slate-300">
                      <ClipboardList size={36} strokeWidth={1.5} className="mb-2"/>
                      <p className="text-xs font-bold text-slate-400">해당 조건의 주문이 없습니다</p>
                    </div>
                  );
                  const byMonth: Record<string,Order[]>={};
                  clientOrders.forEach(o=>{
                    const m=(o.deliveryDate||o.createdAt||'').slice(0,7);
                    if(!byMonth[m])byMonth[m]=[];
                    byMonth[m].push(o);
                  });
                  const months=Object.keys(byMonth).sort().reverse();
                  return (
                    <div className="divide-y divide-slate-100">
                      {months.map(month=>(
                        <div key={month}>
                          <div className="px-5 py-2 bg-slate-50 flex items-center gap-2 sticky top-0 z-10">
                            <span className="text-[11px] font-black text-slate-500">{month}</span>
                            <span className="text-[10px] text-slate-400">{byMonth[month].length}건</span>
                          </div>
                          <div className="divide-y divide-slate-50">
                            {byMonth[month].map(o=>{
                              const alreadyIssued=!!o.invoicePrinted&&!!issuedStatements.find(s=>s.orderId===o.id);
                              return (
                                <button key={o.id} onClick={()=>handleOrderClick(o)}
                                  className={`w-full flex items-center gap-3 text-left px-5 py-3 text-xs transition-all ${alreadyIssued?'bg-emerald-50 hover:bg-emerald-100':'hover:bg-pink-50'}`}>
                                  <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                                    <span className="font-black text-slate-800">납품: {o.deliveryDate?.slice(0,10)||'미정'}</span>
                                    <span className="text-slate-400">주문일 {o.createdAt?.slice(0,10)} · {o.items.length}품목</span>
                                  </div>
                                  <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${STATUS_COLOR[o.status]||'bg-slate-100 text-slate-500'}`}>{STATUS_LABEL[o.status]||o.status}</span>
                                  {alreadyIssued
                                    ? <span className="text-[10px] font-black text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded-full">발행완료</span>
                                    : <span className="text-[10px] font-black text-pink-500 bg-pink-100 px-1.5 py-0.5 rounded-full">미발행</span>}
                                  <ChevronRight size={14} className="text-slate-300 shrink-0"/>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {createMode==='매입' && (()=>{
                  const supplierItems=confirmedBySupplier.find(s=>s.supplierId===selectedClientId);
                  const reqItems=orderRequestsBySupplier.find(s=>s.supplierId===selectedClientId);
                  const hasConfirmed=supplierItems&&supplierItems.items.length>0;
                  const hasRequests=reqItems&&reqItems.items.length>0;
                  if(!hasConfirmed&&!hasRequests) return (
                    <div className="flex flex-col items-center justify-center flex-1 py-12 text-slate-300">
                      <ClipboardList size={36} strokeWidth={1.5} className="mb-2"/>
                      <p className="text-xs font-bold text-slate-400">발주 항목이 없습니다</p>
                      <p className="text-xs text-slate-300 mt-1">직접 입력으로 전표를 작성하세요</p>
                    </div>
                  );
                  return (
                    <div className="divide-y divide-slate-100">
                      {hasConfirmed && <>
                        <div className="px-5 py-2 bg-emerald-50 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={supplierItems!.items.every(({product})=>selectedConfirmedIds.includes(product.id))}
                              ref={el=>{if(el){const some=supplierItems!.items.some(({product})=>selectedConfirmedIds.includes(product.id));el.indeterminate=some&&!supplierItems!.items.every(({product})=>selectedConfirmedIds.includes(product.id));}}}
                              onChange={e=>{
                                const ids=supplierItems!.items.map(({product})=>product.id);
                                setSelectedConfirmedIds(prev=>e.target.checked?[...new Set([...prev,...ids])]:prev.filter(id=>!ids.includes(id)));
                              }}
                              className="w-3.5 h-3.5 accent-emerald-600 cursor-pointer"
                            />
                            <span className="text-[11px] font-black text-emerald-700">발주확정 ({supplierItems!.items.length}품목)</span>
                          </div>
                        </div>
                        {supplierItems!.items.map(({product,co})=>{
                          const issued=issuedPurchaseNames.has(product.name);
                          const checked=selectedConfirmedIds.includes(product.id);
                          return (
                            <label key={product.id}
                              className={`w-full flex items-center gap-3 px-5 py-3 text-xs cursor-pointer transition-colors ${checked?'bg-emerald-50/60':'hover:bg-slate-50'}`}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={e=>{
                                  setSelectedConfirmedIds(prev=>e.target.checked?[...prev,product.id]:prev.filter(id=>id!==product.id));
                                }}
                                className="w-4 h-4 accent-indigo-600 shrink-0"
                              />
                              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                                <span className="font-black text-slate-800">{product.name}</span>
                                {product.용량&&<span className="text-slate-400">{product.용량}</span>}
                              </div>
                              <span className="text-slate-600 font-bold">
                                {product.category === '향미유' && (co as any).isBox
                                  ? `${co.quantity}BOX(${co.quantity*12}개)`
                                  : `${co.quantity}${product.unit||'개'}`}
                              </span>
                              {issued
                                ? <span className="text-[10px] font-black text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded-full">발행완료</span>
                                : <span className="text-[10px] font-black text-pink-500 bg-pink-100 px-1.5 py-0.5 rounded-full">미발행</span>}
                            </label>
                          );
                        })}
                      </>}
                      {hasRequests && <>
                        <div className="px-5 py-2 bg-indigo-50 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={reqItems!.items.every(({product})=>selectedConfirmedIds.includes(product.id))}
                              ref={el=>{if(el){const some=reqItems!.items.some(({product})=>selectedConfirmedIds.includes(product.id));el.indeterminate=some&&!reqItems!.items.every(({product})=>selectedConfirmedIds.includes(product.id));}}}
                              onChange={e=>{
                                const ids=reqItems!.items.map(({product})=>product.id);
                                setSelectedConfirmedIds(prev=>e.target.checked?[...new Set([...prev,...ids])]:prev.filter(id=>!ids.includes(id)));
                              }}
                              className="w-3.5 h-3.5 accent-indigo-600 cursor-pointer"
                            />
                            <span className="text-[11px] font-black text-indigo-600">발주예정 ({reqItems!.items.length}품목)</span>
                          </div>
                        </div>
                        {reqItems!.items.map(({product,req})=>{
                          const issued=issuedPurchaseNames.has(product.name);
                          const ps=productSuppliers.find(s=>s.productId===product.id&&s.supplierId===selectedClientId);
                          const checked=selectedConfirmedIds.includes(product.id);
                          return (
                            <label key={product.id}
                              className={`w-full flex items-center gap-3 px-5 py-3 text-xs cursor-pointer transition-colors ${checked?'bg-indigo-50/60':'hover:bg-slate-50'}`}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={e=>{
                                  setSelectedConfirmedIds(prev=>e.target.checked?[...prev,product.id]:prev.filter(id=>id!==product.id));
                                }}
                                className="w-4 h-4 accent-indigo-600 shrink-0"
                              />
                              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                                <span className="font-black text-slate-800">{product.name}</span>
                                {product.용량&&<span className="text-slate-400">{product.용량}</span>}
                              </div>
                              <div className="flex flex-col items-end gap-0.5 shrink-0">
                                <span className="text-slate-600 font-bold">
                                  {product.category === '향미유' && (req as any).isBox
                                    ? `${req.quantity}BOX(${req.quantity*12}개)`
                                    : `${req.quantity}${product.unit||'개'}`}
                                </span>
                                {ps?.price ? <span className="text-[10px] text-slate-400">{ps.price.toLocaleString()}원</span> : <span className="text-[10px] text-amber-400">단가미등록</span>}
                              </div>
                              {issued
                                ? <span className="text-[10px] font-black text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded-full">발행완료</span>
                                : <span className="text-[10px] font-black text-indigo-400 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded-full">예정</span>}
                            </label>
                          );
                        })}
                      </>}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* ── 진행 주문 목록 (매출·진행주문만·거래처 미선택) ── */}
            {createMode==='매출' && onlyActive && !selectedClientId && activeOrders.length > 0 && (
              <div className="flex-shrink-0 border-b border-slate-100">
                <div className="px-5 py-2 bg-slate-50 flex items-center gap-2">
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">진행 주문</span>
                  <span className="text-[10px] text-slate-400">{activeOrders.length}건</span>
                </div>
                <div className="max-h-40 overflow-y-auto divide-y divide-slate-50">
                  {activeOrders.map(o => {
                    const cl = clients.find(c => c.id === o.clientId);
                    return (
                      <button key={o.id}
                        onClick={() => { setSelectedClientId(o.clientId ?? ''); setSelectedOrderId(''); setManualMode(false); }}
                        className="w-full flex items-center gap-3 text-left px-5 py-2 text-xs hover:bg-blue-50 transition-colors">
                        <span className="font-black text-slate-800 w-28 truncate">{cl?.name || o.clientId}</span>
                        <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${STATUS_COLOR[o.status] || 'bg-slate-100 text-slate-500'}`}>
                          {STATUS_LABEL[o.status] || o.status}
                        </span>
                        <span className="text-slate-400">납품: {o.deliveryDate?.slice(0,10) || '미정'}</span>
                        {o.invoicePrinted
                          ? <span className="text-[10px] font-black text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded-full">발행완료</span>
                          : <span className="text-[10px] font-black text-pink-500 bg-pink-100 px-1.5 py-0.5 rounded-full">미발행</span>}
                        <span className="ml-auto text-slate-400">{o.items.length}품목</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── 발주확정 + 발주예정 목록 (매입·거래처 미선택) ── */}
            {createMode==='매입' && !selectedClientId && (confirmedBySupplier.length > 0 || orderRequestsBySupplier.length > 0) && (
              <div className="flex-shrink-0 px-5 py-3 border-b border-slate-100 bg-slate-50 space-y-3">
                {confirmedBySupplier.length > 0 && (
                  <>
                    <div className="text-[10px] font-black text-emerald-700 uppercase tracking-widest">발주확정 ({confirmedOrders.length})</div>
                    <div className="flex flex-wrap gap-2">
                      {confirmedBySupplier.map(({supplierId,supplierName,items})=>{
                        const issuedCount = items.filter(({product}) => issuedPurchaseNames.has(product.name)).length;
                        return (
                          <button key={supplierId}
                            onClick={()=>{
                              setSelectedClientId(supplierId);
                              const rows = items.map(({product,co})=>{
                                const isBox = product.category==='향미유'&&(co as any).isBox;
                                return {name:product.name,spec:product.용량||product.unit||'',qty:String(co.quantity),price:'',isTaxExempt:false,isBoxUnit:isBox,boxSize:isBox?12:undefined};
                              });
                              setManualItems([...rows,{name:'',spec:'',qty:'',price:'',isTaxExempt:false}]);
                              setManualMode(true);
                            }}
                            className="flex items-center gap-2 px-3 py-2 bg-white border border-emerald-200 rounded-xl text-xs font-black text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 transition-all">
                            <span>{supplierName}</span>
                            <span className="text-slate-400">{items.length}품목</span>
                            {issuedCount > 0 && (
                              <span className="text-[10px] font-black text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-full">{issuedCount}발행</span>
                            )}
                            <ChevronRight size={11}/>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
                {orderRequestsBySupplier.length > 0 && (
                  <>
                    <div className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">발주예정 ({orderRequests.length})</div>
                    <div className="flex flex-wrap gap-2">
                      {orderRequestsBySupplier.map(({supplierId,supplierName,items})=>(
                        <button key={supplierId}
                          onClick={()=>{
                            setSelectedClientId(supplierId);
                            const rows = items.map(({product,req})=>{
                              const ps = productSuppliers.find(s=>s.productId===product.id&&s.supplierId===supplierId);
                              const isBox = product.category==='향미유'&&(req as any).isBox;
                              return {name:product.name,spec:product.용량||product.unit||'',qty:String(req.quantity),price:ps?.price?String(ps.price):'',isTaxExempt:ps?.taxType==='면세',isBoxUnit:isBox,boxSize:isBox?12:undefined};
                            });
                            setManualItems([...rows,{name:'',spec:'',qty:'',price:'',isTaxExempt:false}]);
                            setManualMode(true);
                          }}
                          className="flex items-center gap-2 px-3 py-2 bg-white border border-indigo-200 rounded-xl text-xs font-black text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 transition-all">
                          <span>{supplierName}</span>
                          <span className="text-indigo-400">{items.length}품목</span>
                          <ChevronRight size={11}/>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── 빠른 품목 입력 바 ── */}
            {selectedClientId && (selectedOrderId || manualMode || editingStmt) && (!editingStmt || isEditMode) && (() => {
              const qProduct = searchableRows.find(r=>(r.product!.품목||r.product!.name)===quickName)?.product as any;
              const selRow = selectedItemIdx!==null&&manualMode ? manualItems[selectedItemIdx] : null;
              const selItem = selectedItemIdx!==null&&!manualMode ? lineItems[selectedItemIdx] : null;
              const infoProduct = quickName ? qProduct
                : selRow ? (searchableRows.find(r=>(r.product!.품목||r.product!.name)===selRow.name)?.product as any)
                : selItem ? (allProducts.find(p=>(p.품목||p.name)===selItem.name) as any)
                : null;
              const productCost = infoProduct?.cost ?? 0;
              const salePrice = quickName ? (parseFloat(quickPrice)||0)
                : selRow ? (parseFloat(selRow.price)||0)
                : selItem ? selItem.price : 0;
              const margin = salePrice>0 ? ((salePrice-productCost)/salePrice*100).toFixed(1) : '0.0';
              const qQty = parseFloat(quickQty)||0;
              const qPrc = parseFloat(quickPrice)||0;
              const qAmt = quickIsTaxExempt ? qQty*qPrc : Math.round(qQty*qPrc/1.1);
              const qTax = quickIsTaxExempt ? 0 : qQty*qPrc-qAmt;
              const quickResults = quickSearchOpen
                ? searchableRows.filter(r=>{
                    if(!quickName.trim()) return false;
                    const q=quickName.toLowerCase();
                    const docN=(r.product!.품목||r.product!.name).toLowerCase();
                    return docN.includes(q)||r.product!.name.toLowerCase().includes(q);
                  })
                : [];
              const addQuickItem = () => {
                if (!quickName.trim()) return;
                const newRow: ManualRow = {name:quickName,spec:quickSpec,qty:quickQty.trim()||'1',price:quickPrice,isTaxExempt:quickIsTaxExempt,note:quickNote};
                setManualMode(true);
                setManualItems(prev=>{
                  const rows = prev.filter(r=>r.name.trim());
                  return [...rows,newRow,{name:'',spec:'',qty:'',price:'',isTaxExempt:false,note:''}];
                });
                setQuickName('');setQuickSpec('');setQuickQty('');setQuickPrice('');setQuickNote('');setQuickSearchOpen(false);setQuickIsTaxExempt(false);
              };
              return (
                <div className="flex-shrink-0 border-b border-slate-100 px-5 py-2.5 bg-white space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative">
                      <input type="text" value={quickName} placeholder="품목명..."
                        onChange={e=>{setQuickName(e.target.value);setQuickSearchOpen(true);
                          const match=searchableRows.find(r=>(r.product!.품목||r.product!.name)===e.target.value);
                          if(match){setQuickSpec(match.product!.용량||'');setQuickPrice(String(match.pc.price??match.product!.price??''));setQuickIsTaxExempt(match.pc.taxType==='면세');}
                        }}
                        onFocus={()=>setQuickSearchOpen(true)}
                        onBlur={()=>setTimeout(()=>setQuickSearchOpen(false),150)}
                        className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300 w-40"/>
                      {quickResults.length > 0 && (
                        <div className="absolute left-0 top-full z-50 mt-1 w-72 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
                          <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-100">
                            <span className="text-[10px] font-black text-slate-500">품목 선택</span>
                          </div>
                          {quickResults.slice(0,10).map(r=>{
                            const docN=r.product!.품목||r.product!.name;
                            return (
                              <button key={r.pc.id}
                                onMouseDown={()=>{setQuickName(docN);setQuickSpec(r.product!.용량||'');setQuickPrice(String(r.pc.price??r.product!.price??''));setQuickIsTaxExempt(r.pc.taxType==='면세');setQuickSearchOpen(false);}}
                                className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-blue-50 text-left transition-colors">
                                <span className="font-black text-slate-800">{docN}</span>
                                <span className="text-slate-400">{r.product!.용량||''}{r.pc.price!==undefined?' · '+fmt(r.pc.price)+'원':''}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <input type="text" value={quickSpec} placeholder="규격" onChange={e=>setQuickSpec(e.target.value)}
                      className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300 w-20"/>
                    <input type="number" value={quickQty} placeholder="수량" onChange={e=>setQuickQty(e.target.value)}
                      className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300 w-20 text-right"/>
                    <input type="number" value={quickPrice} placeholder="단가" onChange={e=>setQuickPrice(e.target.value)}
                      className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300 w-24 text-right"/>
                    <input type="text" value={quickNote||''} placeholder="비고" onChange={e=>setQuickNote(e.target.value)}
                      className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300 w-28"/>
                    <button type="button" onClick={addQuickItem}
                      className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-black hover:bg-slate-200 transition-all">
                      직접 추가
                    </button>
                    <button type="button" onClick={()=>{setShowItemPicker(true);setPickerSearch('');setPickerQtys({});}}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-black hover:bg-blue-700 transition-all">
                      <Plus size={11} strokeWidth={3}/>품목 선택
                    </button>
                  </div>
                  <div className="flex items-center gap-4 text-[10px] text-slate-400">
                    <span>원가 <b className="text-slate-600">{fmt(productCost)}</b></span>
                    <span>매출단가 <b className="text-slate-600">{salePrice>0?fmt(salePrice):'-'}</b></span>
                    {qAmt>0 && <span>공급가액 <b className="text-blue-600">{fmt(qAmt)}</b></span>}
                    {qTax>0 && <span>세액 <b className="text-slate-600">{fmt(qTax)}</b></span>}
                    {salePrice>0 && <span>마진율 <b className={parseFloat(margin)>0?'text-emerald-600':'text-rose-600'}>{margin}%</b></span>}
                  </div>
                </div>
              );
            })()}

            {/* ── 품목 선택 팝업 ── */}
            {showItemPicker && (() => {
              const filtered = searchableRows.filter(r=>{
                if(!pickerSearch.trim()) return true;
                const q=pickerSearch.toLowerCase();
                const docN=(r.product!.품목||r.product!.name).toLowerCase();
                return docN.includes(q)||r.product!.name.toLowerCase().includes(q);
              });
              const confirmPick = () => {
                const toAdd: ManualRow[] = [];
                for (const [productId,qtyStr] of Object.entries(pickerQtys)) {
                  const qty=parseFloat(qtyStr);
                  if(!qty) continue;
                  const row=searchableRows.find(r=>r.product!.id===productId);
                  if(!row) continue;
                  const docN=row.product!.품목||row.product!.name;
                  toAdd.push({name:docN,spec:row.product!.용량||'',qty:String(qty),price:String(row.pc.price??row.product!.price??''),isTaxExempt:row.pc.taxType==='면세',note:''});
                }
                if(toAdd.length===0){setShowItemPicker(false);return;}
                setManualMode(true);
                setManualItems(prev=>{
                  const existing=prev.filter(r=>r.name.trim());
                  return [...existing,...toAdd,{name:'',spec:'',qty:'',price:'',isTaxExempt:false,note:''}];
                });
                setShowItemPicker(false);setPickerSearch('');setPickerQtys({});
              };
              return (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
                  onKeyDown={e=>{if(e.key==='Enter')confirmPick();if(e.key==='Escape')setShowItemPicker(false);}}>
                  <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl max-h-[80vh] flex flex-col overflow-hidden mx-4">
                    <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                      <div>
                        <div className="font-black text-slate-900">품목 선택</div>
                        <div className="text-[10px] text-slate-400">{filtered.length}품목</div>
                      </div>
                      <button type="button" onClick={()=>setShowItemPicker(false)}
                        className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl"><X size={16}/></button>
                    </div>
                    <div className="px-5 py-3 border-b border-slate-100">
                      <div className="relative">
                        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none"/>
                        <input autoFocus type="text" value={pickerSearch} onChange={e=>setPickerSearch(e.target.value)}
                          placeholder="품목명 검색..."
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300"/>
                      </div>
                    </div>
                    <div className="flex-1 overflow-y-auto">
                      <table className="w-full text-left">
                        <thead className="sticky top-0 bg-slate-50 z-10">
                          <tr>
                            {['품목명','규격','단가','과세','수량'].map(h=>(
                              <th key={h} className="px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {filtered.length===0 ? (
                            <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">품목이 없습니다</td></tr>
                          ) : filtered.map((r,idx)=>{
                            const docN=r.product!.품목||r.product!.name;
                            const productId=r.product!.id;
                            const qty=pickerQtys[productId]||'';
                            const hasQty=!!parseFloat(qty);
                            return (
                              <tr key={productId}
                                className={`cursor-pointer transition-colors ${hasQty?'bg-blue-50':idx%2===0?'hover:bg-slate-50':'bg-slate-50/50 hover:bg-slate-100'}`}
                                onClick={()=>setPickerQtys(prev=>{const u={...prev};if(u[productId])delete u[productId];else u[productId]='1';return u;})}>
                                <td className="px-4 py-2.5">
                                  <span className="text-xs font-black text-slate-800">{docN}</span>
                                </td>
                                <td className="px-4 py-2.5 text-[11px] text-slate-400">{r.product!.용량||''}</td>
                                <td className="px-4 py-2.5 text-xs text-right font-black text-slate-700">
                                  {r.pc.price!==undefined ? fmt(r.pc.price)+'원' : <span className="text-slate-300 font-normal">미설정</span>}
                                </td>
                                <td className="px-4 py-2.5 text-center">
                                  <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${r.pc.taxType==='면세'?'bg-indigo-100 text-indigo-700':'bg-slate-100 text-slate-500'}`}>
                                    {r.pc.taxType==='면세'?'면세':'과세'}
                                  </span>
                                </td>
                                <td className="px-4 py-2.5" onClick={e=>e.stopPropagation()}>
                                  <input type="number" value={qty}
                                    onChange={e=>setPickerQtys(prev=>({...prev,[productId]:e.target.value}))}
                                    placeholder="수량"
                                    className={`w-20 text-right text-xs font-bold border rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-blue-300 ${hasQty?'bg-blue-50 border-blue-200':'bg-white border-slate-200'}`}/>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100">
                      <span className="text-xs text-slate-500">
                        선택 <b className="text-blue-600">{Object.values(pickerQtys).filter(q=>parseFloat(q)>0).length}</b>품목
                      </span>
                      <div className="flex gap-2">
                        <button type="button" onClick={()=>setShowItemPicker(false)}
                          className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-black hover:bg-slate-200">취소</button>
                        <button type="button" onClick={confirmPick}
                          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-black hover:bg-blue-700">
                          <Plus size={12} strokeWidth={3}/>추가
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ── 주문 연결 안내 배너 ── */}
            {manualMode && selectedOrderId && !editingStmt && (
              <div className="flex-shrink-0 flex items-center gap-2 px-5 py-2 bg-blue-50 border-b border-blue-100">
                <CheckCircle2 size={13} className="text-blue-500 shrink-0"/>
                <span className="text-[11px] font-black text-blue-700">
                  주문 기반 편집 — 품목 추가·수량 변경이 원본 주문에도 반영됩니다
                </span>
              </div>
            )}

            {/* ── 품목 테이블 ── */}
            {selectedClientId && (selectedOrderId || manualMode || editingStmt) ? (
              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 z-10 bg-slate-50">
                    <tr className="border-b border-slate-200">
                      {['No','품목명','규격','수량','단가','공급가액','세액','합계','비고',''].map((h,i)=>(
                        <th key={i} className="px-3 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {manualMode ? (() => {
                      const ro=!!(editingStmt&&!isEditMode);
                      const activeRows=ro?manualItems.filter(r=>r.name.trim()):manualItems;
                      return (<>
                        {activeRows.map((row,idx)=>{
                          const q=parseFloat(row.qty)||0,p=parseFloat(row.price)||0;
                          const sup=row.isTaxExempt?q*p:Math.round(q*p/1.1);
                          const tax=row.isTaxExempt?0:q*p-sup;
                          const searchResults=ro?[]:searchableRows.filter(r=>{
                            if(!row.name.trim())return false;
                            const q=row.name.toLowerCase();
                            const docN=(r.product!.품목||r.product!.name).toLowerCase();
                            return docN.includes(q)||r.product!.name.toLowerCase().includes(q);
                          });
                          const isSel=selectedItemIdx===idx;
                          const isNegQty=(parseFloat(row.qty)||0)<0;
                          return (
                            <tr key={idx}
                              onClick={()=>setSelectedItemIdx(isSel?null:idx)}
                              className={`cursor-pointer transition-colors text-xs ${isSel?'bg-blue-50':isNegQty?'bg-rose-50 hover:bg-rose-100':'hover:bg-slate-50'}`}>
                              <td className="px-3 py-2 text-slate-400 text-center w-8">{idx+1}</td>
                              <td className="px-3 py-2 relative min-w-[120px]">
                                {ro ? <span className="font-black text-slate-800">{row.name}</span> : (<>
                                  <input type="text" placeholder="제품명..." value={row.name}
                                    onChange={e=>setManualItems(prev=>prev.map((r,i)=>i===idx?{...r,name:e.target.value}:r))}
                                    onFocus={()=>setActiveSearchRow(idx)}
                                    onBlur={()=>setTimeout(()=>setActiveSearchRow(null),150)}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300 min-w-[120px]"/>
                                  {activeSearchRow===idx && searchResults.length>0 && (
                                    <div className="absolute left-0 top-full z-50 mt-1 w-64 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
                                      {searchResults.slice(0,8).map(r=>{
                                        const docN=r.product!.품목||r.product!.name;
                                        return (
                                          <button key={r.pc.id}
                                            onMouseDown={()=>{setManualItems(prev=>prev.map((item,i)=>i===idx?{...item,name:docN,spec:r.product!.용량||'',price:String(r.pc.price??r.product!.price??0),isTaxExempt:r.pc.taxType==='면세'}:item));setActiveSearchRow(null);}}
                                            className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-blue-50 text-left transition-colors">
                                            <span className="font-black text-slate-800">{docN}</span>
                                            <span className="text-slate-400">{r.product!.용량||''}{r.pc.price!==undefined?' · '+fmt(r.pc.price)+'원':''}</span>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                </>)}
                              </td>
                              <td className="px-3 py-2 w-20">
                                {ro ? <span className="text-slate-500">{row.spec}</span>
                                  : <input type="text" placeholder="규격" value={row.spec}
                                      onChange={e=>setManualItems(prev=>prev.map((r,i)=>i===idx?{...r,spec:e.target.value}:r))}
                                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300"/>}
                              </td>
                              <td className="px-3 py-2 w-16">
                                {ro
                                  ? <span className="block text-right font-bold">
                                      {row.isBoxUnit ? `${row.qty}BOX(${parseFloat(row.qty as string)*12}개)` : row.qty}
                                    </span>
                                  : <div className="flex items-center gap-1">
                                      <input type="number" placeholder="0" value={row.qty}
                                        onChange={e=>setManualItems(prev=>prev.map((r,i)=>i===idx?{...r,qty:e.target.value}:r))}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-right outline-none focus:ring-2 focus:ring-blue-300"/>
                                      {row.isBoxUnit && <span className="text-[10px] text-blue-600 font-bold whitespace-nowrap">BOX</span>}
                                    </div>}
                              </td>
                              <td className="px-3 py-2 w-24">
                                {ro ? <span className="block text-right font-bold">{fmt(p)}</span>
                                  : <input type="number" placeholder="0" value={row.price}
                                      onChange={e=>setManualItems(prev=>prev.map((r,i)=>i===idx?{...r,price:e.target.value}:r))}
                                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-right outline-none focus:ring-2 focus:ring-blue-300"/>}
                              </td>
                              <td className="px-3 py-2 text-right text-slate-700">{sup>0?fmt(sup):'-'}</td>
                              <td className="px-3 py-2 text-center">
                                {ro ? (
                                  <span className={`text-[10px] font-black ${row.isTaxExempt?'text-indigo-600':''}`}>
                                    {row.isTaxExempt?'면세':tax>0?fmt(tax):'-'}
                                  </span>
                                ) : (
                                  <button onClick={e=>{e.stopPropagation();setManualItems(prev=>prev.map((r,i)=>i===idx?{...r,isTaxExempt:!r.isTaxExempt}:r));}}
                                    className={`px-2 py-0.5 rounded-md text-[10px] font-black border transition-all ${row.isTaxExempt?'bg-indigo-100 text-indigo-700 border-indigo-200':'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'}`}>
                                    {row.isTaxExempt?'면세':tax>0?fmt(tax):'-'}
                                  </button>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right font-black text-slate-800">{(sup+tax)>0?fmt(sup+tax):'-'}</td>
                              <td className="px-3 py-2 w-24">
                                {ro ? <span className="text-[10px] text-slate-400">{(row as any).note||''}</span>
                                  : <input type="text" placeholder="비고" value={(row as ManualRow).note||''}
                                      onChange={e=>setManualItems(prev=>prev.map((r,i)=>i===idx?{...r,note:e.target.value}:r))}
                                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-[10px] outline-none focus:ring-2 focus:ring-blue-300"/>}
                              </td>
                              <td className="px-3 py-2 w-8 text-center">
                                {!ro && manualItems.length>1 && (
                                  <button onClick={e=>{e.stopPropagation();setManualItems(prev=>prev.filter((_,i)=>i!==idx));}}
                                    className="text-slate-300 hover:text-rose-400 transition-colors">
                                    <X size={14}/>
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                        {!ro && (
                          <tr className="hover:bg-slate-50 transition-colors">
                            <td colSpan={10} className="px-3 py-2">
                              <button onClick={()=>setManualItems(prev=>[...prev,{name:'',spec:'',qty:'',price:'',isTaxExempt:false}])}
                                className="flex items-center gap-1.5 text-xs font-black text-blue-500 hover:text-blue-700 transition-colors">
                                <Plus size={12} strokeWidth={3}/>행 추가
                              </button>
                            </td>
                          </tr>
                        )}
                      </>);
                    })() : (
                      lineItems.length>0 ? lineItems.map((item,idx)=>{
                        const isSel2=selectedItemIdx===idx;
                        return (
                          <tr key={item.key}
                            onClick={()=>setSelectedItemIdx(isSel2?null:idx)}
                            className={`cursor-pointer transition-colors text-xs ${isSel2?'bg-blue-50':'hover:bg-slate-50'}`}>
                            <td className="px-3 py-2 text-slate-400 text-center w-8">{item.no}</td>
                            <td className="px-3 py-2 text-[11px] font-black text-slate-800 max-w-[140px]">
                              <span className="block truncate">{item.name}</span>
                            </td>
                            <td className="px-3 py-2 text-[11px] text-slate-400">{item.spec}</td>
                            <td className="px-3 py-2 text-right text-[11px] w-12">{fmt(item.qty)}</td>
                            <td className="px-3 py-2 w-28 shrink-0" onClick={e=>e.stopPropagation()}>
                              <input type="number" placeholder={String(item.price)} value={editablePrices[item.key]??''}
                                onChange={e=>setEditablePrices(prev=>({...prev,[item.key]:e.target.value}))}
                                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-right outline-none focus:ring-2 focus:ring-blue-300"/>
                            </td>
                            <td className="px-3 py-2 text-right text-slate-700">{fmt(item.supply)}</td>
                            <td className="px-3 py-2 text-center" onClick={e=>e.stopPropagation()}>
                              <button onClick={()=>setTaxExemptOverrides(prev=>({...prev,[item.key]:!item.isTaxExempt}))}
                                className={`px-2 py-0.5 rounded-md text-[10px] font-black border transition-all ${item.isTaxExempt?'bg-indigo-100 text-indigo-700 border-indigo-200':'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'}`}>
                                {item.isTaxExempt?'면세':fmt(item.tax)}
                              </button>
                            </td>
                            <td className="px-3 py-2 text-right font-black text-slate-800">{fmt(item.total)}</td>
                            <td className="px-3 py-2 text-slate-400 text-[10px]"/>
                            <td className="px-3 py-2"/>
                          </tr>
                        );
                      }) : (
                        <tr><td colSpan={10} className="px-3 py-12 text-center text-sm text-slate-300">주문을 선택하면 품목이 표시됩니다</td></tr>
                      )
                    )}
                    {/* 합계 행 */}
                    <tr className="bg-slate-50 border-t-2 border-slate-200">
                      <td colSpan={3} className="px-3 py-2.5 text-center text-xs font-black text-slate-600">합 계</td>
                      <td className="px-3 py-2.5 text-right text-xs font-black text-slate-700">
                        {fmt(manualMode
                          ? manualItems.reduce((s,r)=>s+(parseFloat(r.qty)||0),0)
                          : lineItems.reduce((s,i)=>s+(i.qty||0),0))}
                      </td>
                      <td/>
                      <td className="px-3 py-2.5 text-right text-xs font-black text-slate-700">{fmt(totalSupply)}</td>
                      <td className="px-3 py-2.5 text-right text-xs font-black text-slate-700">{fmt(totalTax)}</td>
                      <td className="px-3 py-2.5 text-right text-xs font-black text-slate-900">{fmt(totalAmount)}</td>
                      <td colSpan={2}/>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : !selectedClientId ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-300 bg-slate-50">
                <ClipboardList size={40} strokeWidth={1.5} className="mb-3"/>
                <p className="text-sm font-bold">업체명을 선택하면 전표를 작성할 수 있습니다</p>
              </div>
            ) : null}

            {/* ── 하단 액션 바 ── */}
            {(selectedOrderId || manualMode || editingStmt) && (
            <div className="flex items-center gap-4 px-5 py-3 border-t border-slate-100 bg-white flex-shrink-0 flex-wrap">
              <div className="ml-auto flex items-center gap-2 flex-wrap">
                {editingStmt ? (
                  isEditMode ? (<>
                    <button onClick={handleSaveEdit}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-black hover:bg-emerald-700 transition-all">
                      <Save size={13}/>저장
                    </button>
                    <button onClick={handlePrint}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-700 text-white text-xs font-black hover:bg-slate-800 transition-all">
                      <Printer size={13}/>거래명세서
                    </button>
                  </>) : (<>
                    <button onClick={()=>setIsEditMode(true)}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 text-white text-xs font-black hover:bg-amber-600 transition-all">
                      <Edit2 size={13}/>수정
                    </button>
                    <button onClick={handlePrint}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-700 text-white text-xs font-black hover:bg-slate-800 transition-all">
                      <Printer size={13}/>거래명세서
                    </button>
                  </>)
                ) : canIssue ? (<>
                  <button onClick={handleIssue}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black transition-all ${createMode==='매출'?'bg-blue-600 text-white hover:bg-blue-700':'bg-rose-600 text-white hover:bg-rose-700'}`}>
                    <Plus size={13} strokeWidth={3}/>저장
                  </button>
                  <button onClick={handlePrint}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-700 text-white text-xs font-black hover:bg-slate-800 transition-all">
                    <Printer size={13}/>거래명세서
                  </button>
                </>) : null}
                <button onClick={handleExcel}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-black hover:bg-slate-200 transition-all">
                  <Download size={13}/>엑셀
                </button>
              </div>
            </div>
            )}

            <style>{`@media print{.no-print{display:none!important;}}`}</style>

          </div>
        </div>
      )}


      {/* ── 중복 발행 경고 모달 ── */}
      {warnDuplicate && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={()=>setWarnDuplicate(null)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 space-y-4" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 size={20} className="text-amber-600"/>
              </div>
              <div>
                <p className="font-black text-slate-800 text-sm">이미 발행된 전표입니다</p>
                <p className="text-[11px] text-slate-400 mt-0.5">중복 발행 대신 기존 전표를 확인하세요.</p>
              </div>
            </div>
            <div className="bg-amber-50 rounded-2xl px-4 py-3 space-y-1">
              <p className="text-[11px] font-bold text-amber-800">{warnDuplicate.stmt.clientName} · {warnDuplicate.stmt.tradeDate}</p>
              <p className="text-[10px] text-amber-600">문서번호: {warnDuplicate.stmt.docNo}</p>
              <p className="text-[10px] text-amber-600">합계: {fmt(warnDuplicate.stmt.totalAmount)}원</p>
            </div>
            <div className="flex gap-2">
              <button onClick={()=>{openEdit(warnDuplicate.stmt);setWarnDuplicate(null);}}
                className="flex-1 py-2.5 rounded-xl bg-slate-700 text-white text-xs font-black hover:bg-slate-800">
                기존 전표 보기
              </button>
              <button onClick={()=>{
                const o = warnDuplicate.order;
                setWarnDuplicate(null);
                setSelectedOrderId(o.id);
                setShowPreview(false);
                setEditablePrices({});
                setTaxExemptOverrides({});
              }}
                className="flex-1 py-2.5 rounded-xl bg-rose-100 text-rose-700 text-xs font-black hover:bg-rose-200">
                그래도 재발행
              </button>
            </div>
            <button onClick={()=>setWarnDuplicate(null)} className="w-full text-center text-[11px] text-slate-400 hover:text-slate-600">취소</button>
          </div>
        </div>
      )}

      </>}

    </div>
  );
};

export default TradeStatement;
