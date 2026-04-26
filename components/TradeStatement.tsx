
import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import {
  FileText, Printer, Search, ChevronDown, CalendarDays,
  Package, ClipboardList, ChevronRight, CheckCircle2, Edit2, Plus, X, ArrowLeft,
  Tag, Save, AlertCircle, Download, Wallet, TrendingDown, CheckSquare,
  BarChart2, ChevronLeft, Users
} from 'lucide-react';
import * as ExcelJS from 'exceljs';
import { Order, Product, Client, ProductClient, OrderStatus, IssuedStatement, CompanyInfo, PaymentRecord } from '../types';
import PageHeader from './PageHeader';

interface TradeStatementProps {
  orders: Order[];
  allProducts: Product[];
  clients: Client[];
  productClients: ProductClient[];
  issuedStatements: IssuedStatement[];
  onUpdateStatus?: (id: string, status: OrderStatus) => void;
  onUpdateProductClientPrice?: (id: string, price: number) => void;
  onUpdateProductClientTaxType?: (id: string, taxType: '과세' | '면세') => void;
  onMarkInvoicePrinted?: (id: string, value: boolean) => void;
  onAddIssuedStatement?: (stmt: IssuedStatement) => void;
  onUpdateIssuedStatement?: (id: string, data: Partial<IssuedStatement>) => void;
  onDeleteIssuedStatement?: (id: string) => void;
  pendingInvoice?: { supplierId: string; supplierName: string; items: Array<{ name: string; spec: string; qty: number; price: number }> } | null;
  onClearPendingInvoice?: () => void;
  confirmedOrders?: { id: string; quantity: number }[];
  onAddConfirmedOrder?: (item: { id: string; quantity: number }) => void;
  companyInfo?: CompanyInfo | null;
  onSaveCompanyInfo?: (info: CompanyInfo) => void;
  onUpdateProductCost?: (productId: string, cost: number) => void;
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

const fmt = (n: number) => n.toLocaleString('ko-KR');
const today = () => new Date().toISOString().slice(0, 10);
const weekStart = () => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d.toISOString().slice(0, 10); };
const monthStart = () => new Date().toISOString().slice(0, 7) + '-01';
const yearStart  = () => new Date().getFullYear() + '-01-01';

const TradeStatement: React.FC<TradeStatementProps> = ({
  orders, allProducts, clients, productClients,
  issuedStatements, onUpdateStatus, onUpdateProductClientPrice,
  onUpdateProductClientTaxType, onMarkInvoicePrinted, onAddIssuedStatement,
  onUpdateIssuedStatement,
  onDeleteIssuedStatement,
  pendingInvoice,
  onClearPendingInvoice,
  confirmedOrders = [],
  onAddConfirmedOrder,
  companyInfo,
  onSaveCompanyInfo,
  onUpdateProductCost,
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
  type ManualRow = { name: string; spec: string; qty: string; price: string; isTaxExempt: boolean; note?: string };
  const [manualItems, setManualItems] = useState<ManualRow[]>([
    { name: '', spec: '', qty: '', price: '', isTaxExempt: false, note: '' },
  ]);
  // ── 품목명 드롭다운 검색 ──
  const [activeSearchRow, setActiveSearchRow] = useState<number | null>(null);
  // ── 전표 추가 필드 ──
  const [tradeNote, setTradeNote] = useState('');       // 전표비고
  const [isBanpum, setIsBanpum] = useState(false);      // 반품 여부
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

  // ── 메인 탭 ──
  const [mainTab, setMainTab] = useState<'history' | 'prices' | 'taxinvoice' | 'receivables' | 'stats'>('history');
  const [statsClientId, setStatsClientId] = useState('');
  const [statsYear, setStatsYear] = useState(() => new Date().getFullYear());

  // ── 미수금 탭 ──
  const [recClientId, setRecClientId] = useState('');
  const [recClientSearch, setRecClientSearch] = useState('');
  const [showPayModal, setShowPayModal] = useState(false);
  const [payTarget, setPayTarget] = useState<IssuedStatement | null>(null);
  const [payForm, setPayForm] = useState({ amount: '', date: new Date().toISOString().slice(0,10), method: '계좌이체' as PaymentRecord['method'], note: '' });

  // ── 회사 설정 모달 ──
  const [showCompanyModal, setShowCompanyModal] = useState(false);
  const [companyForm, setCompanyForm] = useState<CompanyInfo>({
    name: '', ceoName: '', bizNo: '', bizType: '', bizItem: '', address: '', phone: '', fax: '', email: '',
  });

  // ── 세금계산서 탭 ──
  const [taxClientId, setTaxClientId] = useState('');
  const [taxClientSearch, setTaxClientSearch] = useState('');
  const [taxStmtId, setTaxStmtId] = useState('');
  const [taxBuyerInfo, setTaxBuyerInfo] = useState({ bizNo: '', ceoName: '', bizType: '', bizItem: '', address: '' });
  const taxPrintRef = useRef<HTMLDivElement>(null);

  // ── 단가관리 탭 ──
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
    setDateFrom('');
    setDateTo('');
    setShowPricePanel(false);
    setManualMode(type === '매입'); // 매입은 항상 직접입력
    setManualItems([{ name: '', spec: '', qty: '', price: '', isTaxExempt: false }]);
    setSelectedConfirmedIds([]);
    setPurchaseSearch('');
    setShowPurchasePicker(false);
    setActiveSearchRow(null);
  };
  const closeCreate = () => { setCreateMode(null); setEditingStmt(null); setIsEditMode(false); setTradeNote(''); setIsBanpum(false); setSelectedItemIdx(null); setQuickName(''); setQuickSpec(''); setQuickQty(''); setQuickPrice(''); setQuickNote(''); setQuickSearchOpen(false); setQuickIsTaxExempt(false); setShowItemPicker(false); setPickerSearch(''); setPickerQtys({}); hasIssuedRef.current = false; };

  // pendingInvoice가 오면 자동으로 매입전표 생성 모달 열기
  useEffect(() => {
    if (!pendingInvoice) return;
    openCreate('매입');
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

  // ── 발주확정 공급처별 그룹 ──
  const confirmedBySupplier = useMemo(() => {
    const map = new Map<string, { supplierName: string; items: { product: (typeof allProducts)[0]; co: { id: string; quantity: number } }[] }>();
    for (const co of confirmedOrders) {
      const product = allProducts.find(p => p.id === co.id);
      if (!product?.supplierId) continue;
      const supplier = clients.find(c => c.id === product.supplierId);
      const sName = supplier?.name ?? product.supplierId;
      if (!map.has(product.supplierId)) map.set(product.supplierId, { supplierName: sName, items: [] });
      map.get(product.supplierId)!.items.push({ product, co });
    }
    return Array.from(map.entries()).map(([sid, v]) => ({ supplierId: sid, ...v }));
  }, [confirmedOrders, allProducts, clients]);

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
      .filter(o => o.status !== OrderStatus.DELIVERED && o.customerName !== '생산기록')
      .sort((a, b) => new Date(a.deliveryDate || a.createdAt).getTime() - new Date(b.deliveryDate || b.createdAt).getTime()),
    [orders]
  );

  // ── 발주확정 항목 불러오기 (매입전표용) ──
  const loadConfirmedToManual = () => {
    const rows = selectedConfirmedIds
      .map(id => {
        const co = confirmedOrders.find(c => c.id === id);
        const product = allProducts.find(p => p.id === id);
        if (!co || !product) return null;
        return { name: product.name, spec: product.용량 || product.unit || '', qty: String(co.quantity), price: '', isTaxExempt: false };
      })
      .filter(Boolean) as ManualRow[];
    if (rows.length === 0) return;
    setManualItems([...rows, { name: '', spec: '', qty: '', price: '', isTaxExempt: false }]);
    setSelectedConfirmedIds([]);
  };

  // ── 거래처 목록 ──
  const activeClientIds = useMemo(() =>
    new Set(orders.filter(o => o.status !== OrderStatus.DELIVERED).map(o => o.clientId)),
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
    if (onlyActive) list = list.filter(o => o.status !== OrderStatus.DELIVERED);
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
    isTaxExempt: boolean;
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
          return { key: `manual-${idx}`, no: idx + 1, name: item.name, spec: item.spec, qty, price, supply, tax, total: supply + tax, isTaxExempt: item.isTaxExempt };
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
    if (!manualMode && selectedOrderId) {
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
      })),
    };
    onAddIssuedStatement?.(stmt);
    // 매입전표 발행 시 발주확정이 없는 품목 자동 확정
    if (stmtType === '매입' && onAddConfirmedOrder) {
      for (const item of lineItems) {
        const product = allProducts.find(p => p.name === item.name);
        if (product && !confirmedOrders.find(c => c.id === product.id)) {
          onAddConfirmedOrder({ id: product.id, quantity: item.qty });
        }
      }
    }
  }, [manualMode, selectedOrderId, selectedClientId, tradeDate, stmtType, selectedClient, docNo, totalSupply, totalTax, totalAmount, lineItems, onMarkInvoicePrinted, onAddIssuedStatement, onAddConfirmedOrder, allProducts, confirmedOrders]);

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
          <td style="border:1px solid ${BC};text-align:right;font-size:8px;padding:0 3px;">${fmt(item.qty)}</td>
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
  <td style="border:1px solid #000;padding:1px 3px;text-align:right;">${fmt2(item.qty)}</td>
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

  // 매입 전표용: supplierId로 연결된 품목
  const supplierProductRows = useMemo(() =>
    allProducts
      .filter(p => p.supplierId === selectedClientId)
      .map(p => ({
        pc: productClients.find(pc => pc.productId === p.id && pc.clientId === selectedClientId)
          ?? { id: '', productId: p.id, clientId: selectedClientId },
        product: p,
      })),
    [allProducts, selectedClientId, productClients]
  );

  // 현재 모드에 따른 검색 소스
  const searchableRows = createMode === '매입' ? supplierProductRows : clientProductRows;
  const savePcPrice = (pcId: string) => {
    const val=parseFloat(pricePanelEdits[pcId]||'');
    if(!isNaN(val)&&val>=0) onUpdateProductClientPrice?.(pcId,val);
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
      const isSel = o.id === selectedOrderId;
      setSelectedOrderId(isSel ? '' : o.id);
      setShowPreview(false);
      setEditablePrices({});
      setTaxExemptOverrides({});
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
          { id: 'receivables', icon: Wallet,        label: '미수금'     },
          { id: 'stats',       icon: BarChart2,     label: '거래처통계' },
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
        // 거래처별로 묶인 productClients
        const filteredClients = clients
          .filter(c => !priceClientSearch || c.name.includes(priceClientSearch))
          .sort((a, b) => a.name.localeCompare(b.name));

        const selectedPcRows = priceClientId
          ? productClients
              .filter(pc => pc.clientId === priceClientId)
              .map(pc => ({ pc, product: allProducts.find(p => p.id === pc.productId) }))
              .filter(r => r.product)
              .sort((a, b) => a.product!.name.localeCompare(b.product!.name))
          : [];

        const hasMissingPrice = selectedPcRows.some(r => !r.pc.price);

        const saveAll = async () => {
          setPriceSaving(true);
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
                  const pcCount = productClients.filter(pc => pc.clientId === c.id).length;
                  const missingCount = productClients.filter(pc => pc.clientId === c.id && !pc.price).length;
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
                    <table className="w-full text-left border-collapse">
                      <thead className="sticky top-0 bg-slate-50 z-10">
                        <tr>
                          <th className="px-5 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest">품목명</th>
                          <th className="px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest">용량/규격</th>
                          <th className="px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">원가</th>
                          <th className="px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">단가</th>
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

                          // 마진율 계산 — 편집 중인 값 우선 반영
                          const effectivePrice = priceEdits[pc.id] ? parseFloat(priceEdits[pc.id]) : (pc.price ?? 0);
                          const effectiveCost = costEdits[product!.id] ? parseFloat(costEdits[product!.id]) : (product!.cost ?? 0);
                          const margin = effectivePrice > 0 && effectiveCost > 0
                            ? Math.round((effectivePrice - effectiveCost) / effectivePrice * 100)
                            : null;

                          return (
                            <tr key={pc.id} className={`hover:bg-slate-50 transition-colors ${hasNoPrice ? 'bg-amber-50/40' : ''}`}>
                              <td className="px-5 py-3">
                                <span className="text-xs font-black text-slate-800">{product!.name}</span>
                                {hasNoPrice && <span className="ml-1.5 text-[9px] font-black text-amber-500 bg-amber-100 px-1.5 py-0.5 rounded-full">단가 미입력</span>}
                              </td>
                              <td className="px-4 py-3 text-[11px] text-slate-400">{product!.용량 || '-'}</td>
                              {/* 원가 입력 */}
                              <td className="px-4 py-3">
                                <div className="flex justify-end">
                                  <input
                                    type="number"
                                    placeholder={product!.cost ? String(product!.cost) : '원가'}
                                    value={costInputVal}
                                    onChange={e => setCostEdits(prev => ({ ...prev, [product!.id]: e.target.value }))}
                                    className={`w-24 text-right bg-white border rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-orange-300 transition-all ${
                                      costEdited ? 'border-orange-400 bg-orange-50' : 'border-slate-200'
                                    }`}
                                  />
                                </div>
                              </td>
                              {/* 단가 입력 */}
                              <td className="px-4 py-3">
                                <div className="flex justify-end">
                                  <input
                                    type="number"
                                    placeholder={pc.price ? String(pc.price) : '단가 입력'}
                                    value={priceInputVal}
                                    onChange={e => setPriceEdits(prev => ({ ...prev, [pc.id]: e.target.value }))}
                                    className={`w-24 text-right bg-white border rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-violet-300 transition-all ${
                                      priceEdited ? 'border-violet-400 bg-violet-50' : 'border-slate-200'
                                    }`}
                                  />
                                </div>
                              </td>
                              {/* 마진율 */}
                              <td className="px-4 py-3 text-center">
                                {margin !== null ? (
                                  <span className={`text-[11px] font-black px-2 py-1 rounded-lg ${
                                    margin >= 30 ? 'bg-emerald-100 text-emerald-700' :
                                    margin >= 10 ? 'bg-amber-100 text-amber-700' :
                                    margin >= 0  ? 'bg-slate-100 text-slate-600' :
                                    'bg-rose-100 text-rose-700'
                                  }`}>
                                    {margin}%
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-slate-300">—</span>
                                )}
                              </td>
                              {/* 과세 토글 */}
                              <td className="px-4 py-3 text-center">
                                <button
                                  onClick={() => setPriceTaxEdits(prev => ({
                                    ...prev,
                                    [pc.id]: (priceTaxEdits[pc.id] ?? pc.taxType ?? '과세') === '과세' ? '면세' : '과세'
                                  }))}
                                  className={`px-3 py-1.5 rounded-lg text-[10px] font-black border transition-all ${
                                    taxEdited
                                      ? currentTax === '면세'
                                        ? 'bg-indigo-500 text-white border-indigo-500'
                                        : 'bg-slate-500 text-white border-slate-500'
                                      : currentTax === '면세'
                                        ? 'bg-indigo-100 text-indigo-700 border-indigo-200'
                                        : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
                                  }`}
                                >
                                  {currentTax}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── 미수금 탭 ── */}
      {mainTab === 'receivables' && (() => {
        // 매출 전표만 대상
        const salesStmts = issuedStatements.filter(s => s.type === '매출');

        // 전표별 잔액 계산
        const getPaid = (s: IssuedStatement) => (s.payments ?? []).reduce((a, p) => a + p.amount, 0);
        const getBalance = (s: IssuedStatement) => s.totalAmount - getPaid(s);
        const isFullyPaid = (s: IssuedStatement) => getBalance(s) <= 0;

        // 거래처별 집계
        type ClientSummary = { clientId: string; clientName: string; total: number; paid: number; balance: number; count: number; unpaidCount: number };
        const summaryMap = new Map<string, ClientSummary>();
        salesStmts.forEach(s => {
          const existing = summaryMap.get(s.clientId) ?? { clientId: s.clientId, clientName: s.clientName, total: 0, paid: 0, balance: 0, count: 0, unpaidCount: 0 };
          const paid = getPaid(s);
          const balance = s.totalAmount - paid;
          existing.total += s.totalAmount;
          existing.paid += paid;
          existing.balance += balance;
          existing.count++;
          if (balance > 0) existing.unpaidCount++;
          summaryMap.set(s.clientId, existing);
        });
        const summaries = [...summaryMap.values()]
          .filter(s => !recClientSearch || s.clientName.includes(recClientSearch))
          .sort((a, b) => b.balance - a.balance);

        const totalOutstanding = summaries.reduce((a, s) => a + s.balance, 0);

        // 선택 거래처의 전표 목록
        const clientStmts = recClientId
          ? salesStmts.filter(s => s.clientId === recClientId).sort((a, b) => b.tradeDate.localeCompare(a.tradeDate))
          : [];

        const openPayModal = (stmt: IssuedStatement) => {
          setPayTarget(stmt);
          const balance = getBalance(stmt);
          setPayForm({ amount: String(balance), date: new Date().toISOString().slice(0,10), method: '계좌이체', note: '' });
          setShowPayModal(true);
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
          const existing = payTarget.payments ?? [];
          onUpdateIssuedStatement?.(payTarget.id, { payments: [...existing, newPayment] });
          setShowPayModal(false);
          setPayTarget(null);
        };

        return (
          <>
            <div className="flex gap-4 min-h-[600px]">
              {/* 좌측: 거래처별 미수금 요약 */}
              <div className="w-72 shrink-0 flex flex-col gap-3">
                {/* 전체 미수금 요약 카드 */}
                <div className="bg-rose-50 border border-rose-200 rounded-2xl px-4 py-3">
                  <div className="flex items-center gap-2 mb-1">
                    <TrendingDown size={14} className="text-rose-500"/>
                    <span className="text-[10px] font-black text-rose-500 uppercase tracking-widest">전체 미수금</span>
                  </div>
                  <div className="text-2xl font-black text-rose-700">{fmt(totalOutstanding)}<span className="text-sm ml-1">원</span></div>
                  <div className="text-[10px] text-rose-400 mt-0.5">{summaries.filter(s => s.balance > 0).length}개 거래처 미결</div>
                </div>

                {/* 거래처 검색 */}
                <div className="relative">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none"/>
                  <input type="text" placeholder="거래처 검색..." value={recClientSearch}
                    onChange={e => setRecClientSearch(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl pl-7 pr-2 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-rose-300"/>
                </div>

                {/* 거래처 목록 */}
                <div className="bg-white rounded-2xl border border-slate-200 flex-1 overflow-y-auto divide-y divide-slate-50">
                  {summaries.map(s => (
                    <button key={s.clientId}
                      onClick={() => setRecClientId(s.clientId === recClientId ? '' : s.clientId)}
                      className={`w-full text-left px-4 py-3 transition-all hover:bg-rose-50 ${recClientId === s.clientId ? 'bg-rose-50 border-r-2 border-rose-500' : ''}`}>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className={`text-xs font-black ${recClientId === s.clientId ? 'text-rose-700' : 'text-slate-700'}`}>{s.clientName}</span>
                        {s.balance > 0
                          ? <span className="text-[10px] font-black text-rose-600 bg-rose-100 px-1.5 py-0.5 rounded-full">{s.unpaidCount}건 미결</span>
                          : <span className="text-[10px] font-black text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded-full">완납</span>
                        }
                      </div>
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-slate-400">발행 {fmt(s.total)}원</span>
                        <span className={`font-black ${s.balance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                          미수 {fmt(s.balance)}원
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* 우측: 선택 거래처 전표별 수금 현황 */}
              <div className="flex-1 bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden">
                {!recClientId ? (
                  <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-300">
                    <Wallet size={40} strokeWidth={1.5}/>
                    <span className="text-sm font-bold">좌측에서 거래처를 선택하세요</span>
                  </div>
                ) : (
                  <>
                    <div className="px-5 py-3 border-b border-slate-100">
                      <span className="font-black text-slate-900">{summaryMap.get(recClientId)?.clientName}</span>
                      <span className="text-xs text-slate-400 ml-2">{clientStmts.length}건 전표</span>
                    </div>
                    <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
                      {clientStmts.map(stmt => {
                        const paid = getPaid(stmt);
                        const balance = getBalance(stmt);
                        const fully = isFullyPaid(stmt);
                        const pct = stmt.totalAmount > 0 ? Math.min(100, Math.round(paid / stmt.totalAmount * 100)) : 0;
                        return (
                          <div key={stmt.id} className={`px-5 py-4 ${fully ? 'bg-emerald-50/30' : ''}`}>
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  {fully
                                    ? <CheckSquare size={13} className="text-emerald-500 shrink-0"/>
                                    : <div className="w-3.5 h-3.5 rounded-sm border-2 border-rose-400 shrink-0"/>
                                  }
                                  <span className="text-xs font-black text-slate-700">{stmt.tradeDate}</span>
                                  <span className="text-[10px] font-mono text-slate-400">{stmt.docNo}</span>
                                  {fully && <span className="text-[9px] font-black text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded-full">완납</span>}
                                </div>
                                <div className="flex items-center gap-4 text-[11px] mb-2">
                                  <span className="text-slate-500">청구 <b className="text-slate-800">{fmt(stmt.totalAmount)}</b>원</span>
                                  <span className="text-emerald-600">수금 <b>{fmt(paid)}</b>원</span>
                                  {balance > 0 && <span className="text-rose-600 font-black">잔액 {fmt(balance)}원</span>}
                                </div>
                                {/* 진행바 */}
                                <div className="w-full bg-slate-100 rounded-full h-1.5 mb-2">
                                  <div className={`h-1.5 rounded-full transition-all ${fully ? 'bg-emerald-400' : 'bg-rose-400'}`} style={{width: `${pct}%`}}/>
                                </div>
                                {/* 수금 내역 */}
                                {(stmt.payments ?? []).length > 0 && (
                                  <div className="space-y-1">
                                    {(stmt.payments ?? []).map(p => (
                                      <div key={p.id} className="flex items-center gap-2 text-[10px] bg-slate-50 rounded-lg px-2.5 py-1">
                                        <span className="text-slate-400">{p.date}</span>
                                        <span className="font-black text-emerald-700">{fmt(p.amount)}원</span>
                                        {p.method && <span className="text-slate-400 bg-white border border-slate-200 px-1.5 py-0.5 rounded-md">{p.method}</span>}
                                        {p.note && <span className="text-slate-400 truncate">{p.note}</span>}
                                        <button
                                          onClick={() => {
                                            const newPayments = (stmt.payments ?? []).filter(x => x.id !== p.id);
                                            onUpdateIssuedStatement?.(stmt.id, { payments: newPayments });
                                          }}
                                          className="ml-auto text-slate-300 hover:text-rose-400 transition-colors"
                                        ><X size={10}/></button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                              {!fully && (
                                <button onClick={() => openPayModal(stmt)}
                                  className="shrink-0 flex items-center gap-1 px-3 py-1.5 bg-rose-600 text-white rounded-xl text-[11px] font-black hover:bg-rose-700 transition-all">
                                  <Plus size={11}/>수금 등록
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* 수금 등록 모달 */}
            {showPayModal && payTarget && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
                onClick={() => setShowPayModal(false)}>
                <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                    <div>
                      <div className="font-black text-slate-900">수금 등록</div>
                      <div className="text-xs text-slate-400">{payTarget.clientName} · {payTarget.tradeDate}</div>
                    </div>
                    <button onClick={() => setShowPayModal(false)} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl"><X size={18}/></button>
                  </div>
                  <div className="px-6 py-5 space-y-4">
                    <div className="bg-slate-50 rounded-xl px-4 py-3 text-xs text-center">
                      <span className="text-slate-500">잔여 미수금 </span>
                      <span className="font-black text-rose-600 text-base">{fmt(getBalance(payTarget))}원</span>
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">수금 금액</label>
                      <input type="number" value={payForm.amount}
                        onChange={e => setPayForm(p => ({ ...p, amount: e.target.value }))}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-rose-300 text-right"/>
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">수금 일자</label>
                      <input type="date" value={payForm.date}
                        onChange={e => setPayForm(p => ({ ...p, date: e.target.value }))}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-rose-300 cursor-pointer"/>
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">결제 수단</label>
                      <div className="flex gap-2 flex-wrap">
                        {(['현금','계좌이체','어음','카드','기타'] as PaymentRecord['method'][]).map(m => (
                          <button key={m as string} onClick={() => setPayForm(p => ({ ...p, method: m }))}
                            className={`px-3 py-1.5 rounded-lg text-xs font-black border transition-all ${payForm.method === m ? 'bg-rose-600 text-white border-rose-600' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}>
                            {m}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">메모 (선택)</label>
                      <input type="text" placeholder="예: 1차 분할 납부" value={payForm.note}
                        onChange={e => setPayForm(p => ({ ...p, note: e.target.value }))}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-rose-300"/>
                    </div>
                  </div>
                  <div className="flex gap-2 px-6 pb-5">
                    <button onClick={() => setShowPayModal(false)}
                      className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-xs font-black hover:bg-slate-200">취소</button>
                    <button onClick={savePayment}
                      disabled={!payForm.amount || Number(payForm.amount) <= 0}
                      className="flex-1 py-2.5 rounded-xl bg-rose-600 text-white text-xs font-black hover:bg-rose-700 disabled:opacity-40 flex items-center justify-center gap-1.5">
                      <Save size={12}/>수금 저장
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        );
      })()}

      {/* ── 세금계산서 탭 ── */}
      {mainTab === 'taxinvoice' && (() => {
        const taxClients = clients
          .filter(c => !taxClientSearch || c.name.includes(taxClientSearch))
          .sort((a, b) => a.name.localeCompare(b.name));

        const clientStmts = issuedStatements
          .filter(s => s.clientId === taxClientId && s.type === '매출')
          .sort((a, b) => b.tradeDate.localeCompare(a.tradeDate));

        const selectedStmt = clientStmts.find(s => s.id === taxStmtId) ?? null;

        const handleTaxPdf = async () => {
          if (!selectedStmt || !taxPrintRef.current) return;
          const { default: jsPDF } = await import('jspdf');
          const { default: html2canvas } = await import('html2canvas');
          const el = taxPrintRef.current;
          const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
          const imgData = canvas.toDataURL('image/png');
          const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
          const pageW = pdf.internal.pageSize.getWidth();
          const pageH = pdf.internal.pageSize.getHeight();
          const ratio = canvas.width / canvas.height;
          const imgW = pageW - 20;
          const imgH = imgW / ratio;
          const yOffset = imgH < pageH ? (pageH - imgH) / 2 : 10;
          pdf.addImage(imgData, 'PNG', 10, yOffset, imgW, imgH);
          const fileName = `세금계산서_${selectedStmt.clientName}_${selectedStmt.tradeDate}.pdf`;
          pdf.save(fileName);
        };

        const handleTaxPrint = () => {
          if (!selectedStmt) return;
          const el = taxPrintRef.current;
          if (!el) return;
          const win = window.open('', '_blank', 'width=900,height=700');
          if (!win) return;
          win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>세금계산서</title>
            <style>
              *{box-sizing:border-box;margin:0;padding:0;}
              body{font-family:'Malgun Gothic','맑은 고딕',sans-serif;font-size:10px;background:#fff;padding:12px;}
              .wrap{border:2px solid #000;width:100%;}
              .title-row{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #000;padding:6px 10px;}
              .title-row h1{font-size:18px;font-weight:900;letter-spacing:6px;}
              .title-row .doc-no{font-size:10px;color:#555;}
              .info-grid{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid #000;}
              .info-box{padding:6px 8px;border-right:1px solid #000;}
              .info-box:last-child{border-right:none;}
              .info-box h3{font-size:9px;font-weight:900;color:#333;margin-bottom:4px;border-bottom:1px solid #eee;padding-bottom:2px;}
              .info-row{display:flex;gap:4px;margin-bottom:2px;font-size:9px;}
              .info-row label{color:#666;width:64px;shrink:0;}
              .info-row span{font-weight:700;}
              .items-table{width:100%;border-collapse:collapse;font-size:9px;}
              .items-table th{background:#f5f5f5;border:1px solid #ccc;padding:4px 6px;font-weight:900;text-align:center;}
              .items-table td{border:1px solid #ccc;padding:4px 6px;text-align:right;}
              .items-table td.left{text-align:left;}
              .items-table td.center{text-align:center;}
              .total-row{display:flex;justify-content:flex-end;gap:16px;padding:8px 10px;border-top:2px solid #000;font-size:11px;font-weight:900;}
              .supply{color:#1a56db;} .tax{color:#e3a008;} .total{color:#111;}
              @media print{body{padding:0;} @page{margin:8mm;}}
            </style></head><body>`);
          win.document.write(el.innerHTML);
          win.document.write('</body></html>');
          win.document.close();
          win.focus();
          setTimeout(() => win.print(), 500);
        };

        const sup = companyInfo;
        const buyer = clients.find(c => c.id === taxClientId);

        return (
          <div className="flex gap-4 min-h-[600px]">
            {/* 좌측: 거래처 + 발행내역 선택 */}
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
                    <button key={c.id} onClick={() => { setTaxClientId(c.id); setTaxStmtId(''); }}
                      className={`w-full text-left px-3 py-2.5 transition-all hover:bg-emerald-50 ${taxClientId === c.id ? 'bg-emerald-50 border-r-2 border-emerald-500' : ''}`}>
                      <span className={`text-xs font-black ${taxClientId === c.id ? 'text-emerald-700' : 'text-slate-700'}`}>{c.name}</span>
                    </button>
                  ))}
                </div>
              </div>
              {/* 발행된 매출 전표 목록 */}
              {taxClientId && (
                <div className="bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden flex-1">
                  <div className="px-3 py-2 border-b border-slate-100">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">발행 전표 선택</span>
                  </div>
                  <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
                    {clientStmts.length === 0 ? (
                      <div className="px-3 py-4 text-xs text-slate-300 text-center">발행 내역 없음</div>
                    ) : clientStmts.map(s => (
                      <button key={s.id} onClick={() => {
                        setTaxStmtId(s.id);
                        setTaxBuyerInfo({ bizNo:'', ceoName:'', bizType:'', bizItem:'', address:'' });
                      }}
                        className={`w-full text-left px-3 py-2.5 transition-all hover:bg-emerald-50 ${taxStmtId === s.id ? 'bg-emerald-50 border-r-2 border-emerald-500' : ''}`}>
                        <div className="text-xs font-black text-slate-700">{s.tradeDate}</div>
                        <div className="text-[10px] text-slate-400">{fmt(s.totalAmount)}원 · {s.items.length}품목</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 우측: 세금계산서 양식 */}
            <div className="flex-1 bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden">
              {!selectedStmt ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-300">
                  <FileText size={40} strokeWidth={1.5}/>
                  <span className="text-sm font-bold">거래처와 전표를 선택하세요</span>
                  {!sup && <span className="text-xs text-amber-400 font-bold">⚠ 회사정보 미설정 — 상단 회사정보 버튼에서 입력하세요</span>}
                </div>
              ) : (
                <>
                  {/* 공급받는자 추가 정보 입력 */}
                  <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">공급받는자 정보 입력 (선택)</span>
                      <button onClick={handleTaxPdf}
                        className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-black hover:bg-blue-700 transition-all">
                        <Download size={12}/>PDF 저장
                      </button>
                      <button onClick={handleTaxPrint}
                        className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-black hover:bg-emerald-700 transition-all">
                        <Printer size={12}/>인쇄
                      </button>
                    </div>
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

                  {/* 세금계산서 미리보기 */}
                  <div className="flex-1 overflow-y-auto p-4">
                    <div ref={taxPrintRef}>
                      <div className="wrap border-2 border-black text-[10px]" style={{fontFamily:"'Malgun Gothic','맑은 고딕',sans-serif"}}>
                        {/* 제목행 */}
                        <div className="flex items-center justify-between border-b-2 border-black px-3 py-2">
                          <h1 className="text-xl font-black tracking-[6px]">세 금 계 산 서</h1>
                          <div className="text-right">
                            <div className="text-[9px] text-slate-500">전표번호: {selectedStmt.docNo}</div>
                            <div className="text-[9px] text-slate-500">작성일자: {selectedStmt.tradeDate}</div>
                          </div>
                        </div>
                        {/* 공급자 / 공급받는자 */}
                        <div className="grid grid-cols-2 border-b border-black">
                          {/* 공급자 */}
                          <div className="p-3 border-r border-black">
                            <h3 className="text-[9px] font-black text-slate-600 mb-2 pb-1 border-b border-slate-200">공 급 자</h3>
                            {[
                              ['등록번호', sup?.bizNo || '미입력'],
                              ['상    호', sup?.name || '미입력'],
                              ['대 표 자', sup?.ceoName || '미입력'],
                              ['사업장주소', sup?.address || '미입력'],
                              ['업    태', sup?.bizType || '미입력'],
                              ['종    목', sup?.bizItem || '미입력'],
                              ['전    화', sup?.phone || '-'],
                            ].map(([label, value]) => (
                              <div key={label} className="flex gap-2 mb-1 text-[9px]">
                                <span className="text-slate-500 w-16 shrink-0">{label}</span>
                                <span className="font-bold">{value}</span>
                              </div>
                            ))}
                          </div>
                          {/* 공급받는자 */}
                          <div className="p-3">
                            <h3 className="text-[9px] font-black text-slate-600 mb-2 pb-1 border-b border-slate-200">공급받는자</h3>
                            {[
                              ['등록번호', taxBuyerInfo.bizNo || '-'],
                              ['상    호', buyer?.name || selectedStmt.clientName],
                              ['대 표 자', taxBuyerInfo.ceoName || '-'],
                              ['사업장주소', taxBuyerInfo.address || '-'],
                              ['업    태', taxBuyerInfo.bizType || '-'],
                              ['종    목', taxBuyerInfo.bizItem || '-'],
                              ['전    화', buyer?.phone || '-'],
                            ].map(([label, value]) => (
                              <div key={label} className="flex gap-2 mb-1 text-[9px]">
                                <span className="text-slate-500 w-16 shrink-0">{label}</span>
                                <span className="font-bold">{value}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        {/* 합계 금액 요약 */}
                        <div className="flex border-b border-black">
                          {[
                            { label: '합계금액', value: fmt(selectedStmt.totalAmount) + '원', color: 'text-slate-900' },
                            { label: '공급가액', value: fmt(selectedStmt.totalSupply) + '원', color: 'text-blue-700' },
                            { label: '세    액', value: fmt(selectedStmt.totalTax) + '원', color: 'text-amber-700' },
                          ].map(({ label, value, color }) => (
                            <div key={label} className="flex-1 text-center py-2 border-r last:border-r-0 border-black">
                              <div className="text-[9px] text-slate-500">{label}</div>
                              <div className={`font-black text-sm ${color}`}>{value}</div>
                            </div>
                          ))}
                        </div>
                        {/* 품목 테이블 */}
                        <div className="overflow-x-auto">
                          <table className="w-full border-collapse text-[9px]">
                            <thead>
                              <tr className="bg-slate-50">
                                {['월','일','품목','규격','수량','단가','공급가액','세액','비고'].map(h => (
                                  <th key={h} className="border border-slate-300 px-2 py-1.5 font-black text-slate-600 text-center whitespace-nowrap">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {selectedStmt.items.map((item, i) => {
                                const d = new Date(selectedStmt.tradeDate);
                                return (
                                  <tr key={i} className="hover:bg-slate-50">
                                    <td className="border border-slate-200 px-2 py-1.5 text-center">{String(d.getMonth()+1).padStart(2,'0')}</td>
                                    <td className="border border-slate-200 px-2 py-1.5 text-center">{String(d.getDate()).padStart(2,'0')}</td>
                                    <td className="border border-slate-200 px-2 py-1.5">{item.name}</td>
                                    <td className="border border-slate-200 px-2 py-1.5 text-center">{item.spec}</td>
                                    <td className="border border-slate-200 px-2 py-1.5 text-right">{item.qty}</td>
                                    <td className="border border-slate-200 px-2 py-1.5 text-right">{fmt(item.price)}</td>
                                    <td className="border border-slate-200 px-2 py-1.5 text-right">{fmt(item.supply)}</td>
                                    <td className="border border-slate-200 px-2 py-1.5 text-right">{item.isTaxExempt ? '면세' : fmt(item.tax)}</td>
                                    <td className="border border-slate-200 px-2 py-1.5"></td>
                                  </tr>
                                );
                              })}
                              {/* 빈 행 채우기 */}
                              {Array.from({length: Math.max(0, 8 - selectedStmt.items.length)}).map((_, i) => (
                                <tr key={`empty-${i}`}>
                                  {Array.from({length:9}).map((_,j) => (
                                    <td key={j} className="border border-slate-200 px-2 py-1.5">&nbsp;</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {/* 하단 서명란 */}
                        <div className="flex border-t border-black">
                          <div className="flex-1 p-3 border-r border-black text-center">
                            <div className="text-[9px] text-slate-500 mb-4">공급자 (인)</div>
                            <div className="font-black">{sup?.name || ''}</div>
                          </div>
                          <div className="flex-1 p-3 text-center">
                            <div className="text-[9px] text-slate-500 mb-4">공급받는자 (인)</div>
                            <div className="font-black">{buyer?.name || selectedStmt.clientName}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
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
                { key: 'name', label: '상호 (회사명)', placeholder: '태백식품' },
                { key: 'bizNo', label: '사업자등록번호', placeholder: '000-00-00000' },
                { key: 'ceoName', label: '대표자명', placeholder: '홍길동' },
                { key: 'address', label: '사업장 주소', placeholder: '경기도 ...' },
                { key: 'bizType', label: '업태', placeholder: '제조업' },
                { key: 'bizItem', label: '종목', placeholder: '참기름, 들기름' },
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
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 text-right whitespace-nowrap">공급가액</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 text-right whitespace-nowrap">세액</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 text-right whitespace-nowrap">합계</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400">거래내역</th>
                <th className="px-4 py-3"/>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredHistory.map(stmt => {
                const issuedDate = new Date(stmt.issuedAt);
                const dateLabel  = `${stmt.tradeDate} ${String(issuedDate.getHours()).padStart(2,'0')}:${String(issuedDate.getMinutes()).padStart(2,'0')}`;
                const summary    = stmt.items.slice(0, 2).map(i => i.name).join(', ') + (stmt.items.length > 2 ? ` 외 ${stmt.items.length - 2}건` : '');
                return (
                  <tr key={stmt.id} className="hover:bg-slate-50 transition-colors cursor-pointer"
                    onClick={() => openEdit(stmt)}>
                    <td className="px-4 py-3 text-[11px] font-mono text-slate-600 whitespace-nowrap">{dateLabel}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                        stmt.type === '매출' ? 'bg-blue-100 text-blue-700' : 'bg-rose-100 text-rose-700'
                      }`}>{stmt.type}</span>
                    </td>
                    <td className="px-4 py-3 text-xs font-bold text-slate-800">{stmt.clientName}</td>
                    <td className="px-4 py-3 text-xs text-right text-slate-600">{fmt(stmt.totalSupply)}</td>
                    <td className="px-4 py-3 text-xs text-right text-slate-600">{fmt(stmt.totalTax)}</td>
                    <td className="px-4 py-3 text-xs text-right font-black text-slate-800">{fmt(stmt.totalAmount)}</td>
                    <td className="px-4 py-3 text-[11px] text-slate-400 max-w-[180px] truncate">{summary}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
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
          <div className="absolute inset-0 bg-black/60" onClick={closeCreate}/>
          {/* DS판매재고 Windows 스타일 다이얼로그 */}
          <div className="relative w-full max-w-6xl flex flex-col overflow-hidden shadow-2xl"
               style={{height:'calc(100vh - 56px)',background:'#d4d0c8',border:'2px solid',borderColor:'#ffffff #808080 #808080 #ffffff'}}>

            {/* ── Windows 타이틀바 ── */}
            <div className="flex items-center justify-between px-2 py-1 flex-shrink-0"
                 style={{background:'linear-gradient(to right,#000080,#1084d0)'}}>
              <div className="flex items-center gap-1.5">
                <FileText size={12} className="text-white opacity-80"/>
                <span className="text-white font-bold text-[12px]">
                  {createMode==='매출'?'판매':'매입'}-({selectedClient?.name||'거래처 선택'}) : {tradeDate}
                  {editingStmt&&<span className="ml-2 text-blue-200 text-[10px]">[수정중] {editingStmt.docNo}</span>}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button className="text-[11px] px-2 py-0.5 font-bold"
                  style={{background:'#d4d0c8',border:'2px solid',borderColor:'#ffffff #808080 #808080 #ffffff'}}>거래내역[O]</button>
                <button onClick={()=>{closeCreate();setTimeout(()=>setCreateMode(stmtType),50);}} className="text-[11px] px-2 py-0.5 font-bold"
                  style={{background:'#d4d0c8',border:'2px solid',borderColor:'#ffffff #808080 #808080 #ffffff'}}>새전표 작성[N]</button>
                <button onClick={closeCreate} className="text-[11px] px-2 py-0.5 font-bold"
                  style={{background:'#d4d0c8',border:'2px solid',borderColor:'#ffffff #808080 #808080 #ffffff'}}>종료[F12▶]</button>
              </div>
            </div>

            {/* ── DS판매재고 스타일 헤더 ── */}
            <div className="flex-shrink-0" style={{borderBottom:'2px solid #808080',background:'#d4d0c8'}}>
              {(() => {
                const L = (t: string, w?: number) => (
                  <span style={{background:'#08007c',color:'white',fontSize:'11px',fontWeight:'bold',padding:'1px 4px',whiteSpace:'nowrap',flexShrink:0,...(w?{minWidth:`${w}px`,textAlign:'center' as const}:{})}}>{t}</span>
                );
                const F = (v: React.ReactNode, w=80) => (
                  <span style={{fontSize:'11px',padding:'1px 4px',border:'1px solid #808080',background:'white',minWidth:`${w}px`,display:'inline-block',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{v}&nbsp;</span>
                );
                const WB = (lbl: string, onClick?: ()=>void, pressed=false) => (
                  <button onClick={onClick} style={{fontSize:'11px',fontWeight:'bold',padding:'1px 6px',background:pressed?'#c0c0c0':'#d4d0c8',border:'2px solid',borderColor:pressed?'#808080 #ffffff #ffffff #808080':'#ffffff #808080 #808080 #ffffff',cursor:'pointer',whiteSpace:'nowrap'}}>{lbl}</button>
                );
                const ROW = (children: React.ReactNode) => (
                  <div style={{display:'flex',alignItems:'center',gap:'2px',minHeight:'22px'}}>{children}</div>
                );
                return (
                  <div style={{display:'flex',gap:0}}>

                    {/* ── 좌측: 전표 입력 폼 ── */}
                    <div style={{flex:'0 0 auto',display:'flex',flexDirection:'column',gap:'2px',padding:'3px 4px',minWidth:'420px'}}>

                      {/* 행1: 전표일자 + 매출처 + 부가세 */}
                      {ROW(<>
                        {L('전표일자')}
                        <input type="date" value={tradeDate} onChange={e=>setTradeDate(e.target.value)}
                          style={{fontSize:'11px',fontWeight:'bold',padding:'1px 3px',border:'2px inset #808080',background:'white',outline:'none'}}/>
                        <select style={{fontSize:'11px',padding:'1px 2px',border:'2px inset #808080',background:'white',outline:'none',marginLeft:'2px'}}>
                          <option>{createMode==='매출'?'매출처':'매입처'}</option>
                        </select>
                        <div style={{display:'flex',alignItems:'center',gap:'5px',padding:'1px 5px',border:'1px solid #808080',background:'white',fontSize:'11px',marginLeft:'2px'}}>
                          {['없음','있음','역산'].map(v=>(
                            <label key={v} style={{display:'flex',alignItems:'center',gap:'2px',cursor:'pointer',fontSize:'11px'}}>
                              <input type="radio" name={`buga-${createMode}`} defaultChecked={v==='있음'} style={{width:'11px',height:'11px'}}/>{v}
                            </label>
                          ))}
                        </div>
                      </>)}

                      {/* 행2: 업체명 */}
                      {ROW(<>
                        <span style={{color:'#08007c',fontSize:'11px',fontWeight:'bold',marginRight:'1px'}}>🔍</span>
                        {L('업체명')}
                        {selectedClientId ? (<>
                          <span style={{fontSize:'11px',fontWeight:'bold',padding:'1px 5px',border:'1px solid #808080',background:'white',minWidth:'180px',display:'inline-block'}}>{selectedClient?.name}</span>
                          {WB('변경', ()=>{setSelectedClientId('');setSelectedOrderId('');setEditablePrices({});setTaxExemptOverrides({});setShowPricePanel(false);setManualItems([{name:'',spec:'',qty:'',price:'',isTaxExempt:false}]);})}
                          {searchableRows.length>0 && WB('단가관리', ()=>setShowPricePanel(v=>!v), showPricePanel)}
                        </>) : (<>
                          <input type="text" placeholder="검색..." value={clientSearch} onChange={e=>setClientSearch(e.target.value)}
                            style={{fontSize:'11px',padding:'1px 3px',border:'2px inset #808080',background:'white',outline:'none',width:'70px'}}/>
                          <select value={selectedClientId} onChange={e=>{setSelectedClientId(e.target.value);setSelectedOrderId('');setEditablePrices({});setTaxExemptOverrides({});}}
                            style={{fontSize:'11px',padding:'1px 3px',border:'2px inset #808080',background:'white',outline:'none',minWidth:'150px'}}>
                            <option value="">— 거래처 선택 —</option>
                            {availableClients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                          {createMode==='매출' && WB('현재주문만', ()=>setOnlyActive(v=>!v), onlyActive)}
                        </>)}
                        {WB('+')}
                      </>)}

                      {/* 행3: 영업사원 */}
                      {ROW(<>
                        {L('영업사원')}
                        {F('없음', 100)}
                        {WB('+')}
                        {selectedClientId && createMode==='매출' && (<>
                          <div style={{borderLeft:'1px solid #808080',height:'16px',margin:'0 3px'}}/>
                          {WB('주문불러오기[F4]', ()=>setManualMode(false), !manualMode)}
                          {WB('직접입력[F5]', ()=>{setManualMode(true);setSelectedOrderId('');}, manualMode)}
                        </>)}
                      </>)}

                      {/* 행4: 전표비고 */}
                      {ROW(<>
                        {L('전표비고[B]')}
                        <input type="text" value={tradeNote} onChange={e=>setTradeNote(e.target.value)} placeholder=""
                          style={{fontSize:'11px',padding:'1px 4px',border:'2px inset #808080',background:'white',outline:'none',flex:1}}/>
                      </>)}

                      {/* 행5: 할인율 + 관리지역 + 현미수 */}
                      {ROW(<>
                        {L('할인율')}
                        {F('0', 30)}
                        <span style={{fontSize:'11px'}}>%</span>
                        {L('관리지역')}
                        {F(selectedClient?.region||'', 60)}
                        <div style={{borderLeft:'1px solid #808080',height:'16px',margin:'0 3px'}}/>
                        {L('현미수')}
                        <span style={{fontSize:'12px',fontWeight:'bold',padding:'1px 6px',border:'1px solid #808080',background:'white',minWidth:'90px',textAlign:'right',display:'inline-block',color:'#cc0000'}}>
                          0
                        </span>
                      </>)}
                    </div>

                    {/* ── 세로 구분 + 업/체/정/보 레이블 ── */}
                    <div style={{borderLeft:'2px solid #808080',display:'flex',alignItems:'stretch',flexShrink:0}}>
                      <div style={{background:'#d4d0c8',display:'flex',flexDirection:'column',justifyContent:'center',alignItems:'center',padding:'2px 3px',borderRight:'1px solid #808080',gap:'1px'}}>
                        {'업체정보'.split('').map((ch,i)=>(
                          <span key={i} style={{fontSize:'10px',fontWeight:'bold',color:'#08007c',lineHeight:'14px'}}>{ch}</span>
                        ))}
                      </div>
                    </div>

                    {/* ── 우측: 업체 정보 패널 ── */}
                    <div style={{flex:1,display:'flex',flexDirection:'column',gap:'2px',padding:'3px 4px',background:'#d4d0c8',fontSize:'11px'}}>
                      {/* 상단 정보 그리드 */}
                      <div style={{display:'grid',gridTemplateColumns:'auto 1fr auto 1fr auto 1fr',gap:'2px',alignItems:'center'}}>
                        {L('사업자번호')}{F('', 100)}
                        {L('대표자명')}{F('', 80)}
                        {L('처음거래일')}{F('', 80)}
                      </div>
                      <div style={{display:'grid',gridTemplateColumns:'auto 1fr auto 1fr',gap:'2px',alignItems:'center'}}>
                        {L('업태')}{F(selectedClient?.type||'', 80)}
                        {L('종목')}{F('', 100)}
                      </div>
                      <div style={{display:'grid',gridTemplateColumns:'auto 1fr auto 1fr',gap:'2px',alignItems:'center'}}>
                        {L('대표전화')}{F(selectedClient?.phone||'', 110)}
                        {L('최종거래일')}{F('', 90)}
                      </div>
                      <div style={{display:'grid',gridTemplateColumns:'auto 1fr auto 1fr',gap:'2px',alignItems:'center'}}>
                        {L('팩스')}{F('', 110)}
                        <label style={{display:'flex',alignItems:'center',gap:'2px',fontSize:'11px',cursor:'pointer',gridColumn:'2 / span 2'}}>
                          <input type="checkbox" style={{width:'12px',height:'12px'}}/> H.P 노출
                        </label>
                      </div>
                      <div style={{display:'grid',gridTemplateColumns:'auto 1fr auto auto auto 1fr',gap:'2px',alignItems:'center'}}>
                        {L('담당자/등급')}{F('', 80)}
                        {L('매출가격용')}{F('', 60)}
                        {L('코드')}{F('01', 30)}
                      </div>
                      <div style={{display:'flex',alignItems:'center',gap:'2px'}}>
                        <button style={{fontSize:'11px',fontWeight:'bold',padding:'1px 6px',background:'#d4d0c8',border:'2px solid',borderColor:'#ffffff #808080 #808080 #ffffff',cursor:'pointer',whiteSpace:'nowrap'}}>🔍변환검색</button>
                        {F(selectedClient?.region||'', 200)}
                      </div>
                    </div>

                  </div>
                );
              })()}
            </div>

            {/* ── 기능 버튼 바 (추가/수정/삭제/전장/취소) ── */}
            <div className="flex items-center gap-1 px-2 py-1 flex-shrink-0" style={{borderBottom:'1px solid #808080',background:'#d4d0c8'}}>
              {editingStmt ? (
                isEditMode ? (<>
                  <button onClick={handleSaveEdit} style={{fontSize:'11px',fontWeight:'bold',padding:'2px 10px',background:'#d4d0c8',border:'2px solid',borderColor:'#ffffff #808080 #808080 #ffffff',cursor:'pointer'}}>저장[F2]</button>
                  <button onClick={handlePrint} style={{fontSize:'11px',fontWeight:'bold',padding:'2px 10px',background:'#d4d0c8',border:'2px solid',borderColor:'#ffffff #808080 #808080 #ffffff',cursor:'pointer'}}>인쇄[F9]</button>
                </>) : (<>
                  <button onClick={()=>setIsEditMode(true)} style={{fontSize:'11px',fontWeight:'bold',padding:'2px 10px',background:'#d4d0c8',border:'2px solid',borderColor:'#ffffff #808080 #808080 #ffffff',cursor:'pointer'}}>수정[F6]</button>
                  <button onClick={handlePrint} style={{fontSize:'11px',fontWeight:'bold',padding:'2px 12px',background:'#d4d0c8',border:'2px solid',borderColor:'#ffffff #808080 #808080 #ffffff',cursor:'pointer'}}>인쇄[F9]</button>
                </>)
              ) : canIssue ? (<>
                <button onClick={handleIssue} style={{fontSize:'11px',fontWeight:'bold',padding:'2px 10px',background:'#d4d0c8',border:'2px solid',borderColor:'#ffffff #808080 #808080 #ffffff',cursor:'pointer'}}>추가[F5]</button>
                <button onClick={handlePrint} style={{fontSize:'11px',fontWeight:'bold',padding:'2px 10px',background:'#d4d0c8',border:'2px solid',borderColor:'#ffffff #808080 #808080 #ffffff',cursor:'pointer'}}>전장[F8]</button>
              </>) : null}
              {selectedItemIdx !== null && manualMode && (
                <button type="button" onClick={()=>{
                  setManualItems(prev=>{
                    const next = prev.filter((_,i)=>i!==selectedItemIdx);
                    // 빈 행이 없으면 하나 추가
                    if(!next.some(r=>!r.name.trim())) next.push({name:'',spec:'',qty:'',price:'',isTaxExempt:false,note:''});
                    return next;
                  });
                  setSelectedItemIdx(null);
                }} style={{fontSize:'11px',fontWeight:'bold',padding:'2px 10px',background:'#d4d0c8',border:'2px solid',borderColor:'#ffffff #808080 #808080 #ffffff',cursor:'pointer',color:'#cc0000'}}>삭제[F7]</button>
              )}
              <div style={{borderLeft:'1px solid #808080',height:'16px',margin:'0 4px'}}/>
              <button onClick={handleExcel} style={{fontSize:'11px',fontWeight:'bold',padding:'2px 10px',background:'#d4d0c8',border:'2px solid',borderColor:'#ffffff #808080 #808080 #ffffff',cursor:'pointer'}}>엑셀[E]</button>
              <button onClick={closeCreate} style={{fontSize:'11px',fontWeight:'bold',padding:'2px 10px',background:'#d4d0c8',border:'2px solid',borderColor:'#ffffff #808080 #808080 #ffffff',cursor:'pointer',marginLeft:'auto'}}>닫기[ESC]</button>
            </div>

            {/* ── 진행 주문 패널 (매출, 거래처 미선택 시) ── */}
            {createMode === '매출' && onlyActive && !selectedClientId && activeOrders.length > 0 && (
              <div className="flex-shrink-0 px-2 py-1" style={{borderBottom:'1px solid #808080',background:'#d4d0c8',maxHeight:'120px',overflowY:'auto'}}>
                <div style={{fontSize:'10px',fontWeight:'bold',color:'#000080',marginBottom:'4px'}}>▶ 진행 주문 ({activeOrders.length}건)</div>
                {activeOrders.map(o=>{
                  const cl = clients.find(c=>c.id===o.clientId);
                  return (
                    <button key={o.id} onClick={()=>{setSelectedClientId(o.clientId??'');setSelectedOrderId(o.id);setManualMode(false);}}
                      className="w-full flex items-center gap-2 text-left"
                      style={{fontSize:'11px',padding:'2px 4px',borderBottom:'1px solid #c0c0c0',background:'white',cursor:'pointer'}}
                      onMouseOver={e=>{(e.currentTarget as HTMLElement).style.background='#316ac5';(e.currentTarget as HTMLElement).style.color='white';}}
                      onMouseOut={e=>{(e.currentTarget as HTMLElement).style.background='white';(e.currentTarget as HTMLElement).style.color='black';}}>
                      <span style={{fontWeight:'bold'}}>{cl?.name||o.clientId}</span>
                      <span style={{color:'#606060'}}>납품: {o.deliveryDate?.slice(0,10)||'미정'}</span>
                      <span style={{marginLeft:'auto',fontWeight:'bold'}}>{STATUS_LABEL[o.status]||o.status}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* ── 발주확정 목록 (매입, 거래처 미선택 시) ── */}
            {createMode === '매입' && !selectedClientId && (
              <div className="flex-shrink-0 px-2 py-1" style={{borderBottom:'1px solid #808080',background:'#d4d0c8',maxHeight:'140px',overflowY:'auto'}}>
                <div style={{fontSize:'10px',fontWeight:'bold',color:'#000080',marginBottom:'4px'}}>▶ 발주확정 목록 ({confirmedOrders.length})</div>
                {confirmedBySupplier.length === 0 ? (
                  <p style={{fontSize:'11px',color:'#808080',padding:'4px 0'}}>발주확정된 항목이 없습니다.</p>
                ) : confirmedBySupplier.map(({supplierId,supplierName,items})=>(
                  <div key={supplierId} className="flex items-center gap-2 mb-1">
                    <span style={{fontSize:'11px',fontWeight:'bold',minWidth:'120px'}}>{supplierName}</span>
                    <span style={{fontSize:'11px',color:'#606060'}}>{items.length}품목</span>
                    <button onClick={()=>{
                        setSelectedClientId(supplierId);
                        const rows = items.map(({product,co})=>({name:product.name,spec:product.용량||product.unit||'',qty:String(co.quantity),price:'',isTaxExempt:false}));
                        setManualItems([...rows,{name:'',spec:'',qty:'',price:'',isTaxExempt:false}]);
                      }}
                      style={{fontSize:'11px',fontWeight:'bold',padding:'1px 8px',background:'#d4d0c8',border:'2px solid',borderColor:'#ffffff #808080 #808080 #ffffff',cursor:'pointer'}}>
                      전표 작성
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* ── 단가관리 패널 ── */}
            {showPricePanel && selectedClientId && searchableRows.length > 0 && (
              <div className="flex-shrink-0 px-2 py-1" style={{borderBottom:'1px solid #808080',background:'#e8e8ff',maxHeight:'130px',overflowY:'auto'}}>
                <div style={{fontSize:'10px',fontWeight:'bold',color:'#000080',marginBottom:'4px'}}>▶ 단가·과세 관리 ({searchableRows.length}품목)</div>
                {searchableRows.map(({pc,product})=>(
                  <div key={pc.id} className="flex items-center gap-2 mb-0.5">
                    <span style={{fontSize:'11px',fontWeight:'bold',flex:1,overflow:'hidden',whiteSpace:'nowrap',textOverflow:'ellipsis'}}>{product!.name}</span>
                    {product!.용량&&<span style={{fontSize:'10px',color:'#606060',whiteSpace:'nowrap'}}>{product!.용량}</span>}
                    <input type="number" placeholder="단가"
                      value={pricePanelEdits[pc.id]??(pc.price!==undefined?String(pc.price):'')}
                      onChange={e=>setPricePanelEdits(prev=>({...prev,[pc.id]:e.target.value}))}
                      style={{width:'90px',fontSize:'11px',fontWeight:'bold',padding:'1px 4px',border:'1px solid #808080',background:'#ffffc0',outline:'none',textAlign:'right'}}/>
                    <button onClick={()=>onUpdateProductClientTaxType?.(pc.id,pc.taxType==='면세'?'과세':'면세')}
                      style={{fontSize:'10px',fontWeight:'bold',padding:'1px 6px',background: pc.taxType==='면세'?'#8080ff':'#d4d0c8',color: pc.taxType==='면세'?'white':'black',border:'1px solid #808080',cursor:'pointer',whiteSpace:'nowrap'}}>
                      {pc.taxType==='면세'?'면세':'과세'}
                    </button>
                    <button onClick={()=>savePcPrice(pc.id)}
                      style={{fontSize:'10px',fontWeight:'bold',padding:'1px 6px',background:'#000080',color:'white',border:'1px solid #808080',cursor:'pointer',whiteSpace:'nowrap'}}>저장</button>
                  </div>
                ))}
              </div>
            )}

            {/* ── 주문 목록 (매출, 거래처 선택 후) ── */}
            {selectedClientId && createMode==='매출' && !manualMode && (
              <div className="flex-shrink-0 px-2 py-1" style={{borderBottom:'1px solid #808080',background:'#d4d0c8'}}>
                <div className="flex items-center gap-2 mb-1">
                  <span style={{fontSize:'10px',fontWeight:'bold',color:'#000080'}}>▶ 주문 선택 ({clientOrders.length}건)</span>
                  <input type="date" value={dateFrom} onChange={e=>{setDateFrom(e.target.value);setSelectedOrderId('');}}
                    style={{fontSize:'11px',padding:'1px 4px',border:'1px solid #808080',background:'white',outline:'none',marginLeft:'auto'}}/>
                  <span style={{color:'#808080',fontSize:'11px'}}>~</span>
                  <input type="date" value={dateTo} onChange={e=>{setDateTo(e.target.value);setSelectedOrderId('');}}
                    style={{fontSize:'11px',padding:'1px 4px',border:'1px solid #808080',background:'white',outline:'none'}}/>
                  {(dateFrom||dateTo)&&<button onClick={()=>{setDateFrom('');setDateTo('');}}
                    style={{fontSize:'11px',fontWeight:'bold',padding:'1px 6px',background:'#d4d0c8',border:'1px solid #808080',cursor:'pointer'}}>초기화</button>}
                </div>
                <div style={{maxHeight:'90px',overflowY:'auto',border:'1px solid #808080',background:'white'}}>
                  {clientOrders.length===0 ? (
                    <p style={{fontSize:'11px',color:'#808080',padding:'4px 8px'}}>해당 조건의 주문이 없습니다.</p>
                  ) : clientOrders.map((o,idx)=>{
                    const isSel=o.id===selectedOrderId;
                    const alreadyIssued=!!o.invoicePrinted&&!!issuedStatements.find(s=>s.orderId===o.id);
                    return (
                      <button key={o.id} onClick={()=>handleOrderClick(o)}
                        className="w-full flex items-center gap-3 text-left"
                        style={{fontSize:'11px',padding:'3px 8px',borderBottom:'1px solid #e8e8e8',
                          background: isSel?'#316ac5': alreadyIssued?'#ffffcc': idx%2===0?'#ffffff':'#f0f0f0',
                          color: isSel?'white': alreadyIssued?'#cc6600':'black',cursor:'pointer'}}>
                        <span style={{width:'14px',textAlign:'center'}}>{isSel?'▶':''}</span>
                        <span style={{fontWeight:'bold'}}>납품: {o.deliveryDate?.slice(0,10)||'미정'}</span>
                        <span>{STATUS_LABEL[o.status]||o.status}</span>
                        {alreadyIssued&&<span style={{fontWeight:'bold'}}>[발행완료]</span>}
                        <span style={{marginLeft:'auto'}}>주문일 {o.createdAt?.slice(0,10)} · {o.items.length}품목</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── 품목 선택 팝업 ── */}
            {showItemPicker && (() => {
              const filtered = searchableRows.filter(r => {
                if (!pickerSearch.trim()) return true;
                const q = pickerSearch.toLowerCase();
                const docN = (r.product!.품목 || r.product!.name).toLowerCase();
                return docN.includes(q) || r.product!.name.toLowerCase().includes(q);
              });
              const confirmPick = () => {
                const toAdd: ManualRow[] = [];
                for (const [pcId, qtyStr] of Object.entries(pickerQtys)) {
                  const qty = parseFloat(qtyStr);
                  if (!qty || qty <= 0) continue;
                  const row = searchableRows.find(r => r.pc.id === pcId);
                  if (!row) continue;
                  const docN = row.product!.품목 || row.product!.name;
                  toAdd.push({
                    name: docN,
                    spec: row.product!.용량 || '',
                    qty: String(qty),
                    price: String(row.pc.price ?? row.product!.price ?? ''),
                    isTaxExempt: row.pc.taxType === '면세',
                    note: '',
                  });
                }
                if (toAdd.length === 0) { setShowItemPicker(false); return; }
                setManualMode(true);
                setManualItems(prev => {
                  const existing = prev.filter(r => r.name.trim());
                  return [...existing, ...toAdd, { name:'', spec:'', qty:'', price:'', isTaxExempt:false, note:'' }];
                });
                setShowItemPicker(false);
                setPickerSearch('');
                setPickerQtys({});
              };
              return (
                <div className="absolute inset-0 z-50 flex items-center justify-center" style={{background:'rgba(0,0,0,0.5)'}}
                  onKeyDown={e=>{if(e.key==='Enter')confirmPick();if(e.key==='Escape')setShowItemPicker(false);}}>
                  <div style={{background:'#d4d0c8',border:'2px solid',borderColor:'#ffffff #808080 #808080 #ffffff',width:'540px',maxHeight:'80vh',display:'flex',flexDirection:'column',boxShadow:'4px 4px 12px rgba(0,0,0,0.5)'}}>
                    {/* 팝업 타이틀바 */}
                    <div style={{background:'linear-gradient(to right,#000080,#1084d0)',padding:'3px 8px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                      <span style={{color:'white',fontWeight:'bold',fontSize:'12px'}}>품목 선택</span>
                      <button type="button" onClick={()=>setShowItemPicker(false)}
                        style={{color:'white',fontWeight:'bold',fontSize:'12px',background:'#cc0000',border:'1px solid #ff4444',padding:'0 6px',cursor:'pointer'}}>✕</button>
                    </div>
                    {/* 검색 */}
                    <div style={{padding:'6px 8px',borderBottom:'1px solid #808080',display:'flex',alignItems:'center',gap:'6px'}}>
                      <span style={{fontSize:'11px',fontWeight:'bold',whiteSpace:'nowrap'}}>🔍 검색:</span>
                      <input autoFocus type="text" value={pickerSearch} onChange={e=>setPickerSearch(e.target.value)}
                        placeholder="품목명 입력..."
                        style={{flex:1,fontSize:'11px',padding:'2px 6px',border:'2px inset #808080',background:'#ffffc0',outline:'none'}}/>
                      <span style={{fontSize:'10px',color:'#606060',whiteSpace:'nowrap'}}>{filtered.length}품목</span>
                    </div>
                    {/* 품목 목록 */}
                    <div style={{flex:1,overflowY:'auto',background:'white'}}>
                      <table style={{width:'100%',borderCollapse:'collapse',fontSize:'11px'}}>
                        <thead className="sticky top-0">
                          <tr style={{background:'#d4d0c8'}}>
                            {['품목명(서류용)','규격','거래처단가','과세','수량 입력'].map(h=>(
                              <th key={h} style={{border:'1px solid #808080',padding:'3px 6px',fontWeight:'bold',textAlign:'center',whiteSpace:'nowrap'}}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.length === 0 ? (
                            <tr><td colSpan={5} style={{padding:'20px',textAlign:'center',color:'#808080'}}>품목이 없습니다</td></tr>
                          ) : filtered.map((r, idx) => {
                            const docN = r.product!.품목 || r.product!.name;
                            const pcId = r.pc.id;
                            const qty = pickerQtys[pcId] || '';
                            const hasQty = parseFloat(qty) > 0;
                            const bg = hasQty ? '#e8f4e8' : idx%2===0 ? '#ffffff' : '#f8f8f8';
                            return (
                              <tr key={pcId} style={{background:bg}}
                                onClick={()=>{
                                  if (!pickerQtys[pcId]) setPickerQtys(prev=>({...prev,[pcId]:'1'}));
                                }}>
                                <td style={{border:'1px solid #d0d0d0',padding:'3px 6px',fontWeight:'bold'}}>{docN}</td>
                                <td style={{border:'1px solid #d0d0d0',padding:'3px 6px',textAlign:'center',color:'#606060'}}>{r.product!.용량||''}</td>
                                <td style={{border:'1px solid #d0d0d0',padding:'3px 6px',textAlign:'right',fontWeight:'bold'}}>
                                  {r.pc.price !== undefined ? r.pc.price.toLocaleString('ko-KR')+'원' : <span style={{color:'#aaa'}}>미설정</span>}
                                </td>
                                <td style={{border:'1px solid #d0d0d0',padding:'3px 6px',textAlign:'center'}}>
                                  <span style={{fontSize:'10px',fontWeight:'bold',color:r.pc.taxType==='면세'?'#0000cc':'#cc0000'}}>
                                    {r.pc.taxType==='면세'?'면세':'과세'}
                                  </span>
                                </td>
                                <td style={{border:'1px solid #d0d0d0',padding:'2px 4px',textAlign:'center'}} onClick={e=>e.stopPropagation()}>
                                  <input type="number" min="0" value={qty}
                                    onChange={e=>setPickerQtys(prev=>({...prev,[pcId]:e.target.value}))}
                                    placeholder="수량"
                                    style={{width:'60px',fontSize:'11px',fontWeight:'bold',padding:'1px 4px',border:'2px inset #808080',background: hasQty?'#ffffc0':'#f0f0f0',outline:'none',textAlign:'right'}}/>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {/* 하단 버튼 */}
                    <div style={{padding:'6px 8px',borderTop:'1px solid #808080',display:'flex',alignItems:'center',justifyContent:'space-between',background:'#d4d0c8'}}>
                      <span style={{fontSize:'11px',color:'#606060'}}>
                        선택된 품목: <strong style={{color:'#000080'}}>{Object.values(pickerQtys).filter(q=>parseFloat(q)>0).length}</strong>개
                      </span>
                      <div style={{display:'flex',gap:'6px'}}>
                        <button type="button" onClick={confirmPick}
                          style={{fontSize:'11px',fontWeight:'bold',padding:'3px 16px',background:'#000080',color:'white',border:'2px solid',borderColor:'#6060c0 #000040 #000040 #6060c0',cursor:'pointer'}}>
                          추가[Enter]
                        </button>
                        <button type="button" onClick={()=>setShowItemPicker(false)}
                          style={{fontSize:'11px',fontWeight:'bold',padding:'3px 12px',background:'#d4d0c8',border:'2px solid',borderColor:'#ffffff #808080 #808080 #ffffff',cursor:'pointer'}}>
                          취소[ESC]
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ── 메인: 품목 테이블 + 우측 버튼 ── */}
            <div className="flex flex-1 overflow-hidden">

              {/* 품목 테이블 영역 */}
              <div className="flex-1 flex flex-col overflow-hidden">

                {/* ── 제품 빠른 입력 행 + 매입단가 행 ── */}
                {selectedClientId && (() => {
                  // 현재 입력 중인 빠른 입력 or 선택된 품목의 단가 정보 계산
                  const qProduct = searchableRows.find(r => (r.product!.품목||r.product!.name) === quickName)?.product as any;
                  const selRow = selectedItemIdx !== null && manualMode ? manualItems[selectedItemIdx] : null;
                  const selItem = selectedItemIdx !== null && !manualMode ? lineItems[selectedItemIdx] : null;
                  const infoProduct = quickName
                    ? qProduct
                    : selRow
                    ? (searchableRows.find(r => (r.product!.품목||r.product!.name) === selRow.name)?.product as any)
                    : selItem
                    ? (allProducts.find(p => (p.품목||p.name) === selItem.name) as any)
                    : null;
                  const productCost = infoProduct?.cost ?? 0;
                  const salePrice = quickName
                    ? (parseFloat(quickPrice) || 0)
                    : selRow
                    ? (parseFloat(selRow.price) || 0)
                    : selItem ? selItem.price : 0;
                  const margin = salePrice > 0 ? ((salePrice - productCost) / salePrice * 100).toFixed(2) : '0.00';

                  const qQty = parseFloat(quickQty) || 0;
                  const qPrc = parseFloat(quickPrice) || 0;
                  const qAmt = quickIsTaxExempt ? qQty * qPrc : Math.round(qQty * qPrc / 1.1);
                  const qTax = quickIsTaxExempt ? 0 : qQty * qPrc - qAmt;

                  const quickResults = quickSearchOpen
                    ? searchableRows.filter(r => {
                        if (!quickName.trim()) return false;
                        const q = quickName.toLowerCase();
                        const docN = (r.product!.품목 || r.product!.name).toLowerCase();
                        return docN.includes(q) || r.product!.name.toLowerCase().includes(q);
                      })
                    : [];

                  const addQuickItem = () => {
                    if (!quickName.trim()) return;
                    const finalQty = quickQty.trim() || '1';
                    const newRow: ManualRow = { name: quickName, spec: quickSpec, qty: finalQty, price: quickPrice, isTaxExempt: quickIsTaxExempt, note: quickNote };
                    setManualMode(true);
                    setManualItems(prev => {
                      const rows = prev.filter(r => r.name.trim());
                      return [...rows, newRow, { name: '', spec: '', qty: '', price: '', isTaxExempt: false, note: '' }];
                    });
                    setQuickName(''); setQuickSpec(''); setQuickQty(''); setQuickPrice(''); setQuickNote(''); setQuickSearchOpen(false);
                  };

                  const LB2 = (t: string) => <span style={{background:'#08007c',color:'white',fontSize:'11px',fontWeight:'bold',padding:'1px 5px',whiteSpace:'nowrap'}}>{t}</span>;
                  const FD2 = (v: React.ReactNode, w=60) => <span style={{fontSize:'11px',padding:'1px 4px',border:'1px inset #808080',background:'white',minWidth:`${w}px`,textAlign:'right',display:'inline-block'}}>{v}</span>;
                  const QI = (val: string, set: (v:string)=>void, w: number, bg='#ffffc0', ph='') => (
                    <input type="text" value={val} onChange={e=>set(e.target.value)} placeholder={ph}
                      style={{width:`${w}px`,fontSize:'11px',padding:'1px 3px',border:'2px inset #808080',background:bg,outline:'none'}}/>
                  );

                  return (
                    <div style={{borderBottom:'1px solid #808080',background:'#d4d0c8',padding:'2px 4px',flexShrink:0}}>
                      {/* 행1-상: 제품명 + 규격/수량/단가/금액/세액 */}
                      <div style={{display:'flex',alignItems:'center',gap:'2px',position:'relative',flexWrap:'wrap'}}>
                        {LB2('제품명(바코드)')}
                        <div style={{position:'relative'}}>
                          <input type="text" value={quickName}
                            onChange={e=>{setQuickName(e.target.value);setQuickSearchOpen(true);
                              const docName = e.target.value;
                              const match = searchableRows.find(r=>(r.product!.품목||r.product!.name)===docName);
                              if(match){setQuickSpec(match.product!.용량||'');setQuickPrice(String(match.pc.price??match.product!.price??''));setQuickIsTaxExempt(match.pc.taxType==='면세');}
                            }}
                            onFocus={()=>setQuickSearchOpen(true)}
                            onBlur={()=>setTimeout(()=>setQuickSearchOpen(false),150)}
                            placeholder="품목명 입력..."
                            style={{width:'160px',fontSize:'11px',fontWeight:'bold',padding:'1px 3px',border:'2px inset #808080',background:'#ffffc0',outline:'none'}}/>
                          {quickResults.length > 0 && (
                            <div style={{position:'absolute',left:0,top:'100%',zIndex:100,minWidth:'240px',border:'2px solid #000080',background:'white',boxShadow:'2px 2px 8px rgba(0,0,0,0.3)',maxHeight:'200px',overflowY:'auto'}}>
                              <div style={{background:'#000080',color:'white',fontSize:'10px',fontWeight:'bold',padding:'3px 8px'}}>품목 선택</div>
                              {quickResults.slice(0,10).map(r=>{
                                const docN = r.product!.품목 || r.product!.name;
                                return (
                                <button key={r.pc.id}
                                  onMouseDown={()=>{
                                    setQuickName(docN);
                                    setQuickSpec(r.product!.용량||'');
                                    setQuickPrice(String(r.pc.price??r.product!.price??''));
                                    setQuickIsTaxExempt(r.pc.taxType==='면세');
                                    setQuickSearchOpen(false);
                                  }}
                                  style={{display:'flex',alignItems:'center',justifyContent:'space-between',width:'100%',padding:'3px 8px',fontSize:'11px',borderBottom:'1px solid #e8e8e8',background:'white',cursor:'pointer',textAlign:'left'}}
                                  onMouseOver={e=>{(e.currentTarget as HTMLElement).style.background='#316ac5';(e.currentTarget as HTMLElement).style.color='white';}}
                                  onMouseOut={e=>{(e.currentTarget as HTMLElement).style.background='white';(e.currentTarget as HTMLElement).style.color='black';}}>
                                  <span style={{fontWeight:'bold'}}>{docN}</span>
                                  <span style={{color:'#808080',fontSize:'10px'}}>{r.product!.용량||''} · {fmt(r.pc.price??r.product!.price??0)}원</span>
                                </button>
                              );})}
                            </div>
                          )}
                        </div>
                        {LB2('규격')}{QI(quickSpec, setQuickSpec, 55, '#ffffc0')}
                        {LB2('수량')}{QI(quickQty, setQuickQty, 45, '#ffffc0')}
                        {LB2('단가[T]')}{QI(quickPrice, setQuickPrice, 65, '#ffffc0')}
                        {LB2('금액')}{FD2(qAmt > 0 ? fmt(qAmt) : '0', 65)}
                        {LB2('세액')}{FD2(qTax > 0 ? fmt(qTax) : '0', 55)}
                      </div>
                      {/* 행1-하: 비고 + 반품 + 버튼 */}
                      <div style={{display:'flex',alignItems:'center',gap:'2px',marginTop:'2px',flexWrap:'wrap'}}>
                        {LB2('비고[C]')}{QI(quickNote, setQuickNote, 120, '#ffffc0')}
                        <div style={{borderLeft:'1px solid #808080',height:'16px',margin:'0 4px'}}/>
                        <label style={{display:'flex',alignItems:'center',gap:'3px',fontSize:'11px',fontWeight:'bold',cursor:'pointer',padding:'1px 6px',border:'2px solid',borderColor:isBanpum?'#808080 #ffffff #ffffff #808080':'#ffffff #808080 #808080 #ffffff',background:isBanpum?'#c0c0c0':'#d4d0c8',whiteSpace:'nowrap'}}>
                          <input type="checkbox" checked={isBanpum} onChange={e=>setIsBanpum(e.target.checked)} style={{width:'12px',height:'12px'}}/>
                          반품(-입력)[F1]
                        </label>
                        <button type="button" onClick={addQuickItem}
                          style={{fontSize:'11px',fontWeight:'bold',padding:'1px 10px',background:'#d4d0c8',border:'2px solid',borderColor:'#ffffff #808080 #808080 #ffffff',cursor:'pointer'}}>직접추가</button>
                        <button type="button" onClick={()=>{setShowItemPicker(true);setPickerSearch('');setPickerQtys({});}}
                          style={{fontSize:'11px',fontWeight:'bold',padding:'1px 10px',background:'#000080',color:'white',border:'2px solid',borderColor:'#6060c0 #000040 #000040 #6060c0',cursor:'pointer'}}>+품목선택</button>
                      </div>
                      {/* 행2: 매입단가/매출단가/소비자가/현재고/이익률 */}
                      <div style={{display:'flex',alignItems:'center',gap:'2px',marginTop:'2px',flexWrap:'wrap'}}>
                        {LB2('매입단가[W]')}{FD2(productCost ? fmt(productCost) : '0', 70)}
                        {LB2('매출단가')}{FD2(salePrice ? fmt(salePrice) : '0', 70)}
                        {LB2('소비자가')}{FD2('0', 60)}
                        {LB2('현재고')}{FD2('–', 60)}
                        {LB2('이익률')}{FD2(margin+'%', 60)}
                        <div style={{borderLeft:'1px solid #808080',height:'16px',margin:'0 6px'}}/>
                        <button type="button" onClick={addQuickItem}
                          style={{fontSize:'11px',fontWeight:'bold',padding:'1px 10px',background:'#d4d0c8',border:'2px solid',borderColor:'#ffffff #808080 #808080 #ffffff',cursor:'pointer'}}>연속추가</button>
                        <button onClick={handlePrint}
                          style={{fontSize:'11px',fontWeight:'bold',padding:'1px 10px',background:'#d4d0c8',border:'2px solid',borderColor:'#ffffff #808080 #808080 #ffffff',cursor:'pointer'}}>전장[F8]</button>
                      </div>
                    </div>
                  );
                })()}

                {selectedClientId && (
                  <div className="flex-1 overflow-y-auto" style={{background:'white'}}>
                    <table className="w-full border-collapse" style={{fontSize:'11px'}}>
                      <thead className="sticky top-0 z-10">
                        <tr style={{background:'#d4d0c8'}}>
                          {['No','제품명','규격','수량','단가','금액','세액','합계','비고',''].map((h,i)=>(
                            <th key={i} style={{border:'1px solid #808080',padding:'3px 6px',fontWeight:'bold',textAlign:'center',whiteSpace:'nowrap'}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {manualMode ? (() => {
                          const ro = !!(editingStmt && !isEditMode);
                          const activeRows = ro ? manualItems.filter(r=>r.name.trim()) : manualItems;
                          return (<>
                            {activeRows.map((row,idx)=>{
                              const q=parseFloat(row.qty)||0, p=parseFloat(row.price)||0;
                              const sup=row.isTaxExempt?q*p:Math.round(q*p/1.1);
                              const tax=row.isTaxExempt?0:q*p-sup;
                              const searchResults=ro?[]:searchableRows.filter(r=>{
                                if(!row.name.trim()) return false;
                                const q=row.name.toLowerCase();
                                const docN=(r.product!.품목||r.product!.name).toLowerCase();
                                return docN.includes(q)||r.product!.name.toLowerCase().includes(q);
                              });
                              const isSel = selectedItemIdx === idx;
                              const bg = isSel ? '#316ac5' : idx%2===0 ? '#ffffff' : '#f0f0f8';
                              const textC = isSel ? 'white' : undefined;
                              const TD = (content: React.ReactNode, align='left', extra?: React.CSSProperties) => (
                                <td style={{border:'1px solid #d0d0d0',padding:'2px 6px',textAlign:align as any,background:bg,color:textC,...extra}}>{content}</td>
                              );
                              return (
                                <tr key={idx} onClick={()=>setSelectedItemIdx(isSel?null:idx)} style={{cursor:'pointer'}}>
                                  {TD(idx+1,'center',{width:'30px',color:'#606060'})}
                                  <td style={{border:'1px solid #d0d0d0',padding:'1px 2px',background:bg,position:'relative'}}>
                                    {ro ? <span style={{padding:'0 4px',fontWeight:'bold'}}>{row.name}</span> : (<>
                                      <input type="text" placeholder="제품명..." value={row.name}
                                        onChange={e=>setManualItems(prev=>prev.map((r,i)=>i===idx?{...r,name:e.target.value}:r))}
                                        onFocus={()=>setActiveSearchRow(idx)}
                                        onBlur={()=>setTimeout(()=>setActiveSearchRow(null),150)}
                                        style={{width:'100%',fontSize:'11px',fontWeight:'bold',padding:'1px 4px',border:'1px solid #808080',background:'#ffffc0',outline:'none',minWidth:'120px'}}/>
                                      {activeSearchRow===idx && searchResults.length>0 && (
                                        <div style={{position:'absolute',left:0,top:'100%',zIndex:50,minWidth:'220px',border:'2px solid #000080',background:'white',boxShadow:'2px 2px 8px rgba(0,0,0,0.3)'}}>
                                          <div style={{background:'#000080',color:'white',fontSize:'10px',fontWeight:'bold',padding:'3px 8px'}}>품목 선택</div>
                                          {searchResults.slice(0,8).map(r=>{
                                            const docN=r.product!.품목||r.product!.name;
                                            return (
                                            <button key={r.pc.id}
                                              onMouseDown={()=>{setManualItems(prev=>prev.map((item,i)=>i===idx?{...item,name:docN,spec:r.product!.용량||'',price:String(r.pc.price??r.product!.price??0),isTaxExempt:r.pc.taxType==='면세'}:item));setActiveSearchRow(null);}}
                                              style={{display:'flex',alignItems:'center',justifyContent:'space-between',width:'100%',padding:'4px 8px',fontSize:'11px',borderBottom:'1px solid #e8e8e8',background:'white',cursor:'pointer',textAlign:'left'}}
                                              onMouseOver={e=>{(e.currentTarget as HTMLElement).style.background='#316ac5';(e.currentTarget as HTMLElement).style.color='white';}}
                                              onMouseOut={e=>{(e.currentTarget as HTMLElement).style.background='white';(e.currentTarget as HTMLElement).style.color='black';}}>
                                              <span style={{fontWeight:'bold'}}>{docN}</span>
                                              <span style={{marginLeft:'8px',fontSize:'10px',color:'#808080'}}>{r.product!.용량||''}{r.pc.price!==undefined?' · '+fmt(r.pc.price)+'원':''}</span>
                                            </button>
                                          );})}
                                        </div>
                                      )}
                                    </>)}
                                  </td>
                                  <td style={{border:'1px solid #d0d0d0',padding:'1px 2px',background:bg}}>
                                    {ro ? <span style={{padding:'0 4px'}}>{row.spec}</span>
                                      : <input type="text" placeholder="규격" value={row.spec}
                                          onChange={e=>setManualItems(prev=>prev.map((r,i)=>i===idx?{...r,spec:e.target.value}:r))}
                                          style={{width:'100%',fontSize:'11px',padding:'1px 4px',border:'1px solid #808080',background:'#ffffc0',outline:'none'}}/>}
                                  </td>
                                  <td style={{border:'1px solid #d0d0d0',padding:'1px 2px',background:bg}}>
                                    {ro ? <span style={{display:'block',textAlign:'right',fontWeight:'bold',padding:'0 4px'}}>{row.qty}</span>
                                      : <input type="number" placeholder="0" value={row.qty}
                                          onChange={e=>setManualItems(prev=>prev.map((r,i)=>i===idx?{...r,qty:e.target.value}:r))}
                                          style={{width:'100%',fontSize:'11px',fontWeight:'bold',padding:'1px 4px',border:'1px solid #808080',background:'#ffffc0',outline:'none',textAlign:'right'}}/>}
                                  </td>
                                  <td style={{border:'1px solid #d0d0d0',padding:'1px 2px',background:bg}}>
                                    {ro ? <span style={{display:'block',textAlign:'right',fontWeight:'bold',padding:'0 4px'}}>{fmt(p)}</span>
                                      : <input type="number" placeholder="0" value={row.price}
                                          onChange={e=>setManualItems(prev=>prev.map((r,i)=>i===idx?{...r,price:e.target.value}:r))}
                                          style={{width:'100%',fontSize:'11px',fontWeight:'bold',padding:'1px 4px',border:'1px solid #808080',background:'#ffffc0',outline:'none',textAlign:'right'}}/>}
                                  </td>
                                  {TD(sup>0?fmt(sup):' ','right')}
                                  <td style={{border:'1px solid #d0d0d0',padding:'1px 2px',textAlign:'center',background:bg}}>
                                    {ro ? <span style={{fontSize:'10px',fontWeight:'bold',color: row.isTaxExempt?'#0000cc':undefined}}>{row.isTaxExempt?'면세':tax>0?fmt(tax):' '}</span>
                                      : <button onClick={()=>setManualItems(prev=>prev.map((r,i)=>i===idx?{...r,isTaxExempt:!r.isTaxExempt}:r))}
                                          style={{fontSize:'10px',fontWeight:'bold',padding:'1px 6px',background: row.isTaxExempt?'#8080ff':'#d4d0c8',color: row.isTaxExempt?'white':'black',border:'1px solid #808080',cursor:'pointer'}}>
                                          {row.isTaxExempt?'면세':tax>0?fmt(tax):'-'}
                                        </button>}
                                  </td>
                                  {TD((sup+tax)>0?fmt(sup+tax):' ','right',{fontWeight:'bold'})}
                                  <td style={{border:'1px solid #d0d0d0',padding:'1px 2px',background:bg}}>
                                    {ro ? <span style={{padding:'0 4px',fontSize:'10px',color:'#606060'}}>{(row as any).note||''}</span>
                                      : <input type="text" placeholder="비고" value={(row as ManualRow).note||''}
                                          onChange={e=>setManualItems(prev=>prev.map((r,i)=>i===idx?{...r,note:e.target.value}:r))}
                                          style={{width:'100%',fontSize:'10px',padding:'1px 4px',border:'1px solid #808080',background:'#ffffc0',outline:'none',minWidth:'60px'}}/>}
                                  </td>
                                  <td style={{border:'1px solid #d0d0d0',padding:'1px 2px',textAlign:'center',background:bg,width:'24px'}}>
                                    {!ro && manualItems.length>1 && (
                                      <button onClick={()=>setManualItems(prev=>prev.filter((_,i)=>i!==idx))}
                                        style={{color:'#c0c0c0',fontWeight:'bold',fontSize:'14px',lineHeight:1,cursor:'pointer',background:'none',border:'none'}}
                                        onMouseOver={e=>(e.currentTarget as HTMLElement).style.color='#cc0000'}
                                        onMouseOut={e=>(e.currentTarget as HTMLElement).style.color='#c0c0c0'}>×</button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                            {!ro && (
                              <tr style={{background:'#f8f8f8'}}>
                                <td colSpan={10} style={{border:'1px solid #d0d0d0',padding:'3px 8px'}}>
                                  <button onClick={()=>setManualItems(prev=>[...prev,{name:'',spec:'',qty:'',price:'',isTaxExempt:false}])}
                                    style={{display:'flex',alignItems:'center',gap:'4px',fontSize:'11px',fontWeight:'bold',color:'#000080',background:'none',border:'none',cursor:'pointer'}}>
                                    <Plus size={11} strokeWidth={3}/>행 추가 (Insert)
                                  </button>
                                </td>
                              </tr>
                            )}
                          </>);
                        })() : (
                          lineItems.length>0 ? lineItems.map((item,idx)=>{
                            const isSel2 = selectedItemIdx === idx;
                            const bg = isSel2 ? '#316ac5' : idx%2===0 ? '#ffffff' : '#f0f0f8';
                            const tc = isSel2 ? 'white' : undefined;
                            const CS: React.CSSProperties = {border:'1px solid #d0d0d0',padding:'3px 6px',background:bg,color:tc};
                            return (
                              <tr key={item.key} onClick={()=>setSelectedItemIdx(isSel2?null:idx)} style={{cursor:'pointer'}}>
                                <td style={{...CS,textAlign:'center',color:'#606060'}}>{item.no}</td>
                                <td style={{...CS,fontWeight:'bold'}}>{item.name}</td>
                                <td style={{...CS,textAlign:'center',color:'#606060'}}>{item.spec}</td>
                                <td style={{...CS,textAlign:'right'}}>{fmt(item.qty)}</td>
                                <td style={{...CS,padding:'1px 2px'}}>
                                  <input type="number" placeholder={String(item.price)} value={editablePrices[item.key]??''}
                                    onChange={e=>setEditablePrices(prev=>({...prev,[item.key]:e.target.value}))}
                                    style={{width:'100%',fontSize:'11px',fontWeight:'bold',padding:'1px 4px',border:'1px solid #808080',background:'#ffffc0',outline:'none',textAlign:'right'}}/>
                                </td>
                                <td style={{...CS,textAlign:'right'}}>{fmt(item.supply)}</td>
                                <td style={{...CS,padding:'1px 2px',textAlign:'center'}}>
                                  <button onClick={()=>setTaxExemptOverrides(prev=>({...prev,[item.key]:!item.isTaxExempt}))}
                                    style={{fontSize:'10px',fontWeight:'bold',padding:'1px 6px',background: item.isTaxExempt?'#8080ff':'#d4d0c8',color: item.isTaxExempt?'white':'black',border:'1px solid #808080',cursor:'pointer'}}>
                                    {item.isTaxExempt?'면세':fmt(item.tax)}
                                  </button>
                                </td>
                                <td style={{...CS,textAlign:'right',fontWeight:'bold'}}>{fmt(item.total)}</td>
                                <td style={{...CS,color:'#606060',fontSize:'10px'}}/>
                                <td style={{...CS,width:'24px'}}/>
                              </tr>
                            );
                          }) : (
                            <tr><td colSpan={10} style={{border:'1px solid #d0d0d0',padding:'40px 16px',textAlign:'center',color:'#808080'}}>주문을 선택하면 품목이 표시됩니다</td></tr>
                          )
                        )}
                        {/* 합계 행 */}
                        <tr style={{background:'#d4d0c8',fontWeight:'bold'}}>
                          <td colSpan={3} style={{border:'1px solid #808080',padding:'3px 8px',textAlign:'center',fontWeight:'900'}}>합　계</td>
                          <td style={{border:'1px solid #808080',padding:'3px 6px',textAlign:'right'}}>
                            {fmt(manualMode
                              ? manualItems.reduce((s,r)=>s+(parseFloat(r.qty)||0),0)
                              : lineItems.reduce((s,i)=>s+(i.qty||0),0))}
                          </td>
                          <td style={{border:'1px solid #808080'}}/>
                          <td style={{border:'1px solid #808080',padding:'3px 6px',textAlign:'right'}}>{fmt(totalSupply)}</td>
                          <td style={{border:'1px solid #808080',padding:'3px 6px',textAlign:'right'}}>{fmt(totalTax)}</td>
                          <td style={{border:'1px solid #808080',padding:'3px 6px',textAlign:'right'}}>{fmt(totalAmount)}</td>
                          <td style={{border:'1px solid #808080'}} colSpan={2}/>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}

                {!selectedClientId && (
                  <div className="flex-1 flex flex-col items-center justify-center" style={{background:'#d4d0c8',color:'#808080'}}>
                    <ClipboardList size={40} className="mb-3 opacity-30"/>
                    <p style={{fontSize:'12px',fontWeight:'bold'}}>업체명을 선택하면 전표를 작성할 수 있습니다</p>
                  </div>
                )}
              </div>

              {/* ── 우측 버튼 패널 ── */}
              <div className="flex-shrink-0 flex flex-col p-1 gap-1" style={{width:'96px',borderLeft:'1px solid #808080',background:'#d4d0c8'}}>
                <div style={{fontSize:'10px',fontWeight:'bold',textAlign:'center',color:'#000080',marginBottom:'2px'}}>거래명세서 발행</div>
                {([['거래명세서[S]', handlePrint],['영수증[Y]', handleReceipt],['픽킹[P]',undefined]] as [string,(()=>void)|undefined][]).map(([lbl,fn])=>(
                  <button key={lbl} onClick={fn} disabled={!fn}
                    style={{fontSize:'11px',fontWeight:'bold',padding:'4px 2px',background:'#d4d0c8',border:'2px solid',borderColor:'#ffffff #808080 #808080 #ffffff',cursor:fn?'pointer':'default',textAlign:'center',opacity:fn?1:0.5}}>
                    {lbl}
                  </button>
                ))}
                <div style={{borderTop:'1px solid #808080',margin:'2px 0'}}/>
                {([['세금계산서[H]', handleTaxInvoice],['엑셀 저장[K]', handleExcel]] as [string,()=>void][]).map(([lbl,fn])=>(
                  <button key={lbl} onClick={fn}
                    style={{fontSize:'11px',fontWeight:'bold',padding:'4px 2px',background:'#d4d0c8',border:'2px solid',borderColor:'#ffffff #808080 #808080 #ffffff',cursor:'pointer',textAlign:'center'}}>
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            {/* ── 하단 합계 바 (DS스타일) ── */}
            <div className="flex items-stretch flex-shrink-0" style={{borderTop:'2px solid #808080',background:'#d4d0c8'}}>
              {([
                ['전일미수','0',false],
                ['합계액',fmt(totalAmount),false],
                ['수금액','0',false],
                ['지불액','0',false],
                ['미수잔액',fmt(totalAmount),true],
                ['거래발행일',tradeDate,false],
              ] as [string,string,boolean][]).map(([label,value,red])=>(
                <div key={label} className="flex items-center" style={{borderRight:'1px solid #808080'}}>
                  <span style={{background:'#000080',color:'white',fontSize:'11px',fontWeight:'bold',padding:'4px 6px',whiteSpace:'nowrap'}}>{label}</span>
                  <span style={{fontSize:'11px',fontWeight:'bold',padding:'4px 10px',minWidth:'80px',textAlign:'right',color:red?'#cc0000':'black'}}>{value}</span>
                </div>
              ))}
              <div style={{marginLeft:'auto',display:'flex',alignItems:'center',padding:'0 12px',fontSize:'11px',fontWeight:'bold'}}>
                수량: {fmt(manualMode
                  ? manualItems.reduce((s,r)=>s+(parseFloat(r.qty)||0),0)
                  : lineItems.reduce((s,i)=>s+(i.qty||0),0))}
              </div>
            </div>

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

      {/* ── 거래처통계 탭 ── */}
      {mainTab === 'stats' && (() => {
        const salesClients = clients.filter(c => issuedStatements.some(s => s.clientId === c.id && s.type === '매출'));
        const selectedClient = salesClients.find(c => c.id === statsClientId);
        const stmts = issuedStatements.filter(s => s.clientId === statsClientId && s.type === '매출');
        const yearStmts = stmts.filter(s => s.tradeDate.startsWith(String(statsYear)));
        const yearTotal = yearStmts.reduce((s, r) => s + r.totalAmount, 0);
        const yearCount = yearStmts.length;
        const months = Array.from({ length: 12 }, (_, i) => {
          const m = String(i + 1).padStart(2, '0');
          const rows = yearStmts.filter(s => s.tradeDate.startsWith(`${statsYear}-${m}`));
          return { label: `${i + 1}월`, amount: rows.reduce((s, r) => s + r.totalAmount, 0), count: rows.length };
        });
        const maxAmt = Math.max(...months.map(m => m.amount), 1);
        const availableYears = Array.from(new Set(stmts.map(s => Number(s.tradeDate.slice(0, 4))))).sort((a, b) => b - a);
        const fmtS = (n: number) => n >= 100000000 ? `${(n / 100000000).toFixed(1)}억` : n >= 10000 ? `${Math.round(n / 10000).toLocaleString()}만` : n.toLocaleString();
        const currentYear = new Date().getFullYear();

        return (
          <div className="flex gap-4 min-h-[600px]">
            {/* 왼쪽: 거래처 목록 */}
            <div className="w-52 shrink-0 bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col">
              <div className="px-4 py-3 border-b border-slate-100">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">매출처</p>
              </div>
              <div className="flex-1 overflow-y-auto">
                {salesClients.length === 0 && (
                  <div className="py-8 text-center text-slate-300 text-xs font-bold">발행 내역 없음</div>
                )}
                {salesClients.map(c => {
                  const total = issuedStatements.filter(s => s.clientId === c.id && s.type === '매출' && s.tradeDate.startsWith(String(currentYear))).reduce((s, r) => s + r.totalAmount, 0);
                  const isActive = statsClientId === c.id;
                  return (
                    <button key={c.id} onClick={() => { setStatsClientId(c.id); setStatsYear(currentYear); }}
                      className={`w-full text-left px-4 py-3 border-b border-slate-50 transition-all ${isActive ? 'bg-indigo-50 border-l-2 border-l-indigo-500' : 'hover:bg-slate-50'}`}>
                      <p className={`text-xs font-black truncate ${isActive ? 'text-indigo-700' : 'text-slate-700'}`}>{c.name}</p>
                      {total > 0 && <p className="text-[10px] text-slate-400 font-bold mt-0.5">{fmtS(total)}원</p>}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 오른쪽: 통계 */}
            <div className="flex-1 space-y-4">
              {!statsClientId ? (
                <div className="flex flex-col items-center justify-center h-full bg-white rounded-2xl border border-dashed border-slate-200 py-20">
                  <Users size={36} className="text-slate-200 mb-3" />
                  <p className="text-slate-400 text-sm font-bold">거래처를 선택하세요</p>
                </div>
              ) : (
                <>
                  {/* 헤더 */}
                  <div className="bg-white rounded-2xl border border-slate-200 px-5 py-4 flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <h3 className="text-sm font-black text-slate-800">{selectedClient?.name}</h3>
                      <p className="text-[11px] text-slate-400 mt-0.5">발행 명세서 기준 매출 통계</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => setStatsYear(y => y - 1)} className="p-1.5 hover:bg-slate-100 rounded-lg transition-all"><ChevronLeft size={16} /></button>
                      <span className="text-sm font-black text-slate-800 min-w-[52px] text-center">{statsYear}년</span>
                      <button onClick={() => setStatsYear(y => y + 1)} disabled={statsYear >= currentYear} className="p-1.5 hover:bg-slate-100 rounded-lg transition-all disabled:opacity-30"><ChevronRight size={16} /></button>
                      {availableYears.filter(y => y !== statsYear).map(y => (
                        <button key={y} onClick={() => setStatsYear(y)}
                          className="px-2.5 py-1 rounded-lg text-xs font-black bg-slate-100 text-slate-500 hover:bg-slate-200 transition-all">{y}</button>
                      ))}
                    </div>
                  </div>

                  {/* KPI 카드 */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-white rounded-2xl border border-slate-200 p-4">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">연간 매출</p>
                      <p className="text-xl font-black text-indigo-700 mt-1">{fmtS(yearTotal)}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{yearTotal.toLocaleString()}원</p>
                    </div>
                    <div className="bg-white rounded-2xl border border-slate-200 p-4">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">주문 횟수</p>
                      <p className="text-xl font-black text-slate-800 mt-1">{yearCount}건</p>
                    </div>
                    <div className="bg-white rounded-2xl border border-slate-200 p-4">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">건당 평균</p>
                      <p className="text-xl font-black text-slate-800 mt-1">{yearCount > 0 ? fmtS(Math.round(yearTotal / yearCount)) : '—'}</p>
                    </div>
                  </div>

                  {/* 월별 바 차트 */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-5">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">월별 매출</p>
                    <div className="flex items-end gap-1 h-32">
                      {months.map(({ label, amount, count }) => (
                        <div key={label} className="flex-1 flex flex-col items-center gap-1 group relative">
                          <div className="w-full bg-indigo-100 rounded-t-md transition-all hover:bg-indigo-300" style={{ height: `${Math.round((amount / maxAmt) * 100)}px`, minHeight: amount > 0 ? 4 : 0 }} />
                          {amount > 0 && (
                            <div className="absolute bottom-full mb-1.5 bg-slate-800 text-white text-[9px] font-black px-2 py-1 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 left-1/2 -translate-x-1/2">
                              {fmtS(amount)}원<br/>{count}건
                            </div>
                          )}
                          <span className="text-[8px] font-bold text-slate-400">{label}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 거래 내역 */}
                  {yearStmts.length > 0 && (
                    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                      <div className="px-5 py-3 border-b border-slate-100">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{statsYear}년 거래 내역 ({yearCount}건)</p>
                      </div>
                      <div className="divide-y divide-slate-50">
                        {[...yearStmts].sort((a, b) => b.tradeDate.localeCompare(a.tradeDate)).map(s => (
                          <div key={s.id} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors">
                            <div>
                              <span className="text-xs font-black text-slate-700">{s.tradeDate}</span>
                              <span className="ml-2 text-[10px] text-slate-400 font-mono">{s.docNo}</span>
                              <p className="text-[10px] text-slate-400 mt-0.5">{s.items.slice(0,2).map(i=>i.name).join(', ')}{s.items.length>2?` 외 ${s.items.length-2}건`:''}</p>
                            </div>
                            <span className="text-sm font-black text-indigo-700">{fmt(s.totalAmount)}원</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {yearStmts.length === 0 && (
                    <div className="bg-white rounded-2xl border border-dashed border-slate-200 py-12 text-center text-slate-400 text-sm font-bold">{statsYear}년 매출 데이터가 없습니다.</div>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })()}

    </div>
  );
};

export default TradeStatement;
