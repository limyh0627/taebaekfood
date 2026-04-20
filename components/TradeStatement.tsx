
import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import {
  FileText, Printer, Search, ChevronDown, CalendarDays,
  Package, ClipboardList, ChevronRight, CheckCircle2, Edit2, Plus, X, ArrowLeft
} from 'lucide-react';
import * as ExcelJS from 'exceljs';
import { Order, Product, Client, ProductClient, OrderStatus, IssuedStatement } from '../types';
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
  pendingInvoice?: { supplierId: string; supplierName: string; items: Array<{ name: string; spec: string; qty: number; price: number }> } | null;
  onClearPendingInvoice?: () => void;
  confirmedOrders?: { id: string; quantity: number }[];
  onAddConfirmedOrder?: (item: { id: string; quantity: number }) => void;
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
  pendingInvoice,
  onClearPendingInvoice,
  confirmedOrders = [],
  onAddConfirmedOrder,
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
  type ManualRow = { name: string; spec: string; qty: string; price: string; isTaxExempt: boolean };
  const [manualItems, setManualItems] = useState<ManualRow[]>([
    { name: '', spec: '', qty: '', price: '', isTaxExempt: false },
  ]);
  // ── 품목명 드롭다운 검색 ──
  const [activeSearchRow, setActiveSearchRow] = useState<number | null>(null);

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
  const closeCreate = () => { setCreateMode(null); setEditingStmt(null); setIsEditMode(false); };

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
      const spec = product?.용량 || '';
      const key  = `${item.name}||${spec}`;
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
        itemMap[key] = { key, no: no++, name: item.name, spec, qty: item.quantity, price: unitPrice, supply, tax, total: supply + tax, isTaxExempt };
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
    const supplierLbl = type === '매출' ? '【 공급자 】' : `【 공급자 】　${client}`;
    const receiverLbl = type === '매출' ? `【 공급받는자 】　${client}` : '【 공급받는자 】';
    const rows = (items as any[]).map((item: any, idx: number) => `
      <tr>
        <td style="border:1px solid #000;padding:4px 6px;text-align:center;font-size:10px">${idx + 1}</td>
        <td style="border:1px solid #000;padding:4px 8px;font-size:10px">${item.name}</td>
        <td style="border:1px solid #000;padding:4px 6px;text-align:center;font-size:10px">${item.spec || ''}</td>
        <td style="border:1px solid #000;padding:4px 6px;text-align:right;font-size:10px">${fmt(item.qty)}</td>
        <td style="border:1px solid #000;padding:4px 6px;text-align:right;font-size:10px">${fmt(item.price)}</td>
        <td style="border:1px solid #000;padding:4px 6px;text-align:right;font-size:10px">${fmt(item.supply)}</td>
        <td style="border:1px solid #000;padding:4px 6px;text-align:right;font-size:10px">${item.isTaxExempt ? '면세' : fmt(item.tax)}</td>
        <td style="border:1px solid #000;padding:4px 6px;text-align:right;font-size:10px;font-weight:bold">${fmt(item.total)}</td>
      </tr>`).join('');
    const empty = Math.max(0, 8 - items.length);
    const emptyRows = Array.from({ length: empty }).map(() =>
      `<tr style="height:22px">${[...Array(8)].map(() => '<td style="border:1px solid #000"></td>').join('')}</tr>`
    ).join('');
    return `
      <div style="text-align:center;font-size:22px;font-weight:bold;margin-bottom:12px;letter-spacing:8px">
        ${type === '매출' ? '거  래  명  세  서' : '거  래  명  세  서 (매입)'}
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:10px">
        <span style="font-weight:bold">문서번호: ${docNoStr}</span>
        <span>거래일자: ${dateString}</span>
      </div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:10px">
        <tbody><tr>
          <td style="border:1px solid #000;padding:6px 10px;width:50%;background:#d9e1f2;font-weight:bold;font-size:11px">${supplierLbl}</td>
          <td style="border:1px solid #000;padding:6px 10px;width:50%;background:#d9e1f2;font-weight:bold;font-size:11px">${receiverLbl}</td>
        </tr></tbody>
      </table>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:#d9e1f2">
          ${['No','품목명','규격','수량','단가','공급가액','세액','합계'].map(h =>
            `<th style="border:1px solid #000;padding:5px 6px;font-size:10px;font-weight:bold;text-align:center;white-space:nowrap">${h}</th>`
          ).join('')}
        </tr></thead>
        <tbody>
          ${rows}${emptyRows}
          <tr style="background:#eff6ff">
            <td colspan="5" style="border:1px solid #000;padding:5px 8px;font-weight:bold;text-align:center;font-size:10px">합　계</td>
            <td style="border:1px solid #000;padding:5px 6px;text-align:right;font-weight:bold;font-size:10px">${fmt(sup)}</td>
            <td style="border:1px solid #000;padding:5px 6px;text-align:right;font-weight:bold;font-size:10px">${fmt(tax)}</td>
            <td style="border:1px solid #000;padding:5px 6px;text-align:right;font-weight:bold;font-size:11px;color:#1e3a5f">${fmt(amt)}</td>
          </tr>
        </tbody>
      </table>
      <div style="margin-top:12px;display:flex;justify-content:flex-end;gap:24px;font-size:11px">
        <span>공급가액: <strong>${fmt(sup)}원</strong></span>
        <span>세액: <strong>${fmt(tax)}원</strong></span>
        <span style="font-size:13px;color:#1e3a5f">청구금액: <strong>${fmt(amt)}원</strong></span>
      </div>`;
  };

  const handlePrint = () => {
    const html = buildPrintHtml(lineItems, totalSupply, totalTax, totalAmount, stmtType, selectedClient?.name || '', docNo, dateStr);
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<html><head><title>${stmtType}전표</title>
      <style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'맑은 고딕',sans-serif;font-size:11px;color:#000;padding:20px;}
      table{border-collapse:collapse;width:100%;}td,th{border:1px solid #000;padding:4px 6px;}
      @media print{body{padding:10px;}}</style></head><body>${html}</body></html>`);
    win.document.close(); win.focus(); win.print(); win.close();
    markIssued();
  };

  const handleDetailPrint = (stmt: IssuedStatement) => {
    const d = new Date(stmt.tradeDate + 'T00:00:00');
    const ds = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
    const html = buildPrintHtml(stmt.items as any, stmt.totalSupply, stmt.totalTax, stmt.totalAmount, stmt.type, stmt.clientName, stmt.docNo, ds);
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<html><head><title>${stmt.type}전표</title>
      <style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'맑은 고딕',sans-serif;font-size:11px;color:#000;padding:20px;}
      table{border-collapse:collapse;width:100%;}td,th{border:1px solid #000;padding:4px 6px;}</style></head><body>${html}</body></html>`);
    win.document.close(); win.focus(); win.print(); win.close();
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
        right={<div className="flex gap-2">
          <button
            onClick={() => openCreate('매입')}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-black bg-rose-600 text-white hover:bg-rose-700 shadow-sm transition-all"
          >
            <Plus size={14} strokeWidth={3}/>매입전표
          </button>
          <button
            onClick={() => openCreate('매출')}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-black bg-blue-600 text-white hover:bg-blue-700 shadow-sm transition-all"
          >
            <Plus size={14} strokeWidth={3}/>매출전표
          </button>
        </div>}
      />

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
                      <button onClick={e=>{e.stopPropagation();handleDetailPrint(stmt);}}
                        className="text-[10px] font-black px-2 py-1 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-lg transition-all flex items-center gap-1">
                        <Printer size={10}/>인쇄
                      </button>
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
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
          {/* 배경 딤 */}
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={closeCreate}/>
          {/* 센터 모달 */}
          <div className="relative w-full max-w-6xl h-[92vh] bg-white rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">

            {/* ── 모달 헤더 ── */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 rounded-t-3xl bg-white flex-shrink-0">
              <div className="flex items-center gap-3">
                <span className={`text-xs font-black px-3 py-1.5 rounded-full text-white ${createMode==='매출'?'bg-blue-600':'bg-rose-600'}`}>{createMode}전표</span>
                <span className="font-black text-slate-800 text-sm">{editingStmt ? '전표 수정' : '전표 생성'}</span>
                {selectedClient && <span className="text-slate-400 text-sm font-bold">— {selectedClient.name}</span>}
                {editingStmt && <span className="text-[10px] font-mono text-slate-400">{editingStmt.docNo}</span>}
              </div>
              <div className="flex items-center gap-2">
                {editingStmt ? (
                  /* 수정 모드 */
                  isEditMode ? (
                    <>
                      <button onClick={handleSaveEdit}
                        className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-black hover:bg-emerald-700 transition-all">
                        <CheckCircle2 size={12}/>저장
                      </button>
                      <button onClick={handlePrint}
                        className="flex items-center gap-1.5 px-4 py-2 bg-slate-700 text-white rounded-xl text-xs font-black hover:bg-slate-800 transition-all">
                        <Printer size={12}/>인쇄(발행)
                      </button>
                      <button onClick={handleExcel}
                        className="p-2 rounded-xl bg-slate-100 text-slate-500 hover:bg-emerald-100 hover:text-emerald-700 transition-all" title="엑셀 저장">
                        <FileText size={14}/>
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={()=>setIsEditMode(true)}
                        className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 text-white rounded-xl text-xs font-black hover:bg-amber-600 transition-all">
                        <Edit2 size={12}/>수정
                      </button>
                      <button onClick={handlePrint}
                        className="flex items-center gap-1.5 px-4 py-2 bg-slate-700 text-white rounded-xl text-xs font-black hover:bg-slate-800 transition-all">
                        <Printer size={12}/>인쇄
                      </button>
                      <button onClick={handleExcel}
                        className="p-2 rounded-xl bg-slate-100 text-slate-500 hover:bg-emerald-100 hover:text-emerald-700 transition-all" title="엑셀 저장">
                        <FileText size={14}/>
                      </button>
                    </>
                  )
                ) : (
                  /* 신규 발행 모드 */
                  canIssue && (
                    <>
                      <button onClick={handleIssue}
                        className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black transition-all ${createMode==='매출'?'bg-blue-600 hover:bg-blue-700 text-white':'bg-rose-600 hover:bg-rose-700 text-white'}`}>
                        <CheckCircle2 size={12}/>발행
                      </button>
                      <button onClick={handlePrint}
                        className="flex items-center gap-1.5 px-4 py-2 bg-slate-700 text-white rounded-xl text-xs font-black hover:bg-slate-800 transition-all">
                        <Printer size={12}/>인쇄(발행)
                      </button>
                      <button onClick={handleExcel}
                        className="p-2 rounded-xl bg-slate-100 text-slate-500 hover:bg-emerald-100 hover:text-emerald-700 transition-all" title="엑셀 저장">
                        <FileText size={14}/>
                      </button>
                    </>
                  )
                )}
                <button onClick={closeCreate} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-all"><X size={18}/></button>
              </div>
            </div>

            {/* ── 거래처 + 전표일자 설정 바 ── */}
            <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center gap-4 flex-shrink-0">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">거래처</span>
                {selectedClientId ? (
                  /* 거래처 선택 완료 → 잠금 표시 */
                  <>
                    <span className="font-black text-slate-800 text-sm px-3 py-1.5 bg-white border border-slate-200 rounded-lg">
                      {selectedClient?.name}
                    </span>
                    <button
                      onClick={()=>{setSelectedClientId('');setSelectedOrderId('');setEditablePrices({});setTaxExemptOverrides({});setShowPricePanel(false);setManualItems([{name:'',spec:'',qty:'',price:'',isTaxExempt:false}]);}}
                      className="px-2.5 py-1.5 rounded-lg text-[11px] font-black border border-slate-200 bg-white text-slate-400 hover:text-rose-500 hover:border-rose-300 transition-all whitespace-nowrap">
                      변경
                    </button>
                    {searchableRows.length > 0 && (
                      <button onClick={()=>setShowPricePanel(v=>!v)}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-black border transition-all whitespace-nowrap flex items-center gap-1 ${showPricePanel?'bg-violet-600 border-violet-600 text-white':'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                        <Edit2 size={10}/>단가관리
                      </button>
                    )}
                  </>
                ) : (
                  /* 거래처 미선택 → 검색 + 드롭다운 */
                  <>
                    <div className="relative">
                      <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none"/>
                      <input type="text" placeholder="검색..." value={clientSearch} onChange={e=>setClientSearch(e.target.value)}
                        className="bg-white border border-slate-200 rounded-lg pl-7 pr-2 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300 w-24"/>
                    </div>
                    <div className="relative">
                      <select value={selectedClientId}
                        onChange={e=>{setSelectedClientId(e.target.value);setSelectedOrderId('');setEditablePrices({});setTaxExemptOverrides({});}}
                        className="appearance-none bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300 pr-7 min-w-[160px]">
                        <option value="">— 선택 —</option>
                        {availableClients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
                    </div>
                    {createMode === '매출' && (
                      <button onClick={()=>setOnlyActive(v=>!v)}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-black border transition-all whitespace-nowrap ${onlyActive?'bg-indigo-600 border-indigo-600 text-white':'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                        현재 주문만
                      </button>
                    )}
                  </>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <CalendarDays size={13} className="text-slate-400"/>
                <input type="date" value={tradeDate} onChange={e=>setTradeDate(e.target.value)}
                  className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300"/>
              </div>
            </div>

            {/* ── 매출전표: 현재 주문 목록 패널 ── */}
            {createMode === '매출' && onlyActive && !selectedClientId && (
              <div className="px-5 py-3 border-b border-slate-100 bg-indigo-50/40 flex-shrink-0">
                <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-2 block">
                  현재 진행 주문 ({activeOrders.length}건)
                </span>
                {activeOrders.length === 0 ? (
                  <p className="text-xs text-slate-400 py-2">진행 중인 주문이 없습니다.</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {activeOrders.map(o => {
                      const cl = clients.find(c => c.id === o.clientId);
                      return (
                        <button key={o.id}
                          onClick={() => { setSelectedClientId(o.clientId ?? ''); setSelectedOrderId(o.id); setManualMode(false); }}
                          className="flex items-center gap-3 bg-white border border-indigo-100 rounded-xl px-4 py-2.5 text-left hover:border-indigo-400 hover:shadow-sm transition-all">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-black text-slate-800">{cl?.name ?? o.clientId}</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">납품일: {o.deliveryDate?.slice(0,10)||'미정'} · {o.items.length}품목</p>
                          </div>
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLOR[o.status]||'bg-slate-100 text-slate-500'}`}>{STATUS_LABEL[o.status]||o.status}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── 매입전표: 발주확정 공급처별 패널 ── */}
            {createMode === '매입' && !selectedClientId && (
              <div className="px-5 py-3 border-b border-slate-100 bg-amber-50/30 flex-shrink-0">
                <span className="text-[10px] font-black text-amber-500 uppercase tracking-widest mb-2 block">
                  발주확정 목록 ({confirmedOrders.length})
                </span>
                {confirmedBySupplier.length === 0 ? (
                  <p className="text-xs text-slate-400 py-2">발주확정된 항목이 없습니다.</p>
                ) : (
                  <div className="flex flex-col gap-3 max-h-56 overflow-y-auto">
                    {confirmedBySupplier.map(({ supplierId, supplierName, items }) => (
                      <div key={supplierId} className="bg-white border border-amber-100 rounded-xl overflow-hidden">
                        <div className="flex items-center justify-between px-3 py-2 bg-amber-50 border-b border-amber-100">
                          <span className="text-xs font-black text-slate-700">{supplierName}</span>
                          <button
                            onClick={() => {
                              setSelectedClientId(supplierId);
                              const rows = items.map(({ product, co }) => ({
                                name: product.name,
                                spec: product.용량 || product.unit || '',
                                qty: String(co.quantity),
                                price: '',
                                isTaxExempt: false,
                              }));
                              setManualItems([...rows, { name: '', spec: '', qty: '', price: '', isTaxExempt: false }]);
                            }}
                            className="text-[10px] font-black px-2.5 py-1 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-all whitespace-nowrap">
                            전표 작성
                          </button>
                        </div>
                        <div className="divide-y divide-slate-50">
                          {items.map(({ product, co }) => (
                            <div key={product.id} className="flex items-center justify-between px-3 py-1.5">
                              <span className="text-xs font-bold text-slate-700 truncate">{product.name}</span>
                              <span className="text-[10px] text-slate-400 shrink-0 ml-2">{co.quantity} {product.unit || ''}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── 단가관리 패널 ── */}
            {showPricePanel && selectedClientId && searchableRows.length > 0 && (
              <div className="px-5 py-3 border-b border-slate-100 bg-violet-50 flex-shrink-0">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-black text-violet-500 uppercase tracking-widest">단가 · 과세 관리 ({searchableRows.length}품목)</span>
                  <span className="text-[10px] text-slate-400">변경 후 저장 버튼을 눌러주세요</span>
                </div>
                <div className="space-y-1.5 max-h-52 overflow-y-auto">
                  {searchableRows.map(({pc, product}) => (
                    <div key={pc.id} className="flex items-center gap-2 bg-white rounded-xl px-3 py-2 border border-violet-100">
                      <span className="text-xs font-black text-slate-700 flex-1 min-w-0 truncate">{product!.name}</span>
                      {product!.용량 && <span className="text-[10px] text-slate-400 whitespace-nowrap">{product!.용량}</span>}
                      <div className="flex items-center gap-1 shrink-0">
                        <input
                          type="number"
                          placeholder="단가"
                          value={pricePanelEdits[pc.id] ?? (pc.price !== undefined ? String(pc.price) : '')}
                          onChange={e => setPricePanelEdits(prev => ({...prev, [pc.id]: e.target.value}))}
                          className="w-24 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-right outline-none focus:ring-2 focus:ring-violet-300"
                        />
                        <button
                          onClick={() => {
                            const cur = pc.taxType ?? '과세';
                            const next = cur === '과세' ? '면세' : '과세';
                            onUpdateProductClientTaxType?.(pc.id, next);
                          }}
                          className={`px-2.5 py-1 rounded-lg text-[10px] font-black border transition-all whitespace-nowrap ${
                            pc.taxType === '면세'
                              ? 'bg-indigo-100 text-indigo-700 border-indigo-200'
                              : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
                          }`}
                        >
                          {pc.taxType === '면세' ? '면세' : '과세'}
                        </button>
                        <button
                          onClick={() => savePcPrice(pc.id)}
                          className="px-2.5 py-1 rounded-lg text-[10px] font-black bg-violet-600 text-white hover:bg-violet-700 transition-all whitespace-nowrap"
                        >
                          저장
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── 모달 본문 (스크롤) ── */}
            <div className="flex-1 overflow-y-auto">

              {/* 매출: 주문/직접 모드 토글 */}
              {selectedClientId && createMode === '매출' && (
                <div className="px-5 pt-4 pb-0">
                  <div className="flex gap-2">
                    <button onClick={()=>{setManualMode(false);}}
                      className={`flex-1 py-2 rounded-xl text-xs font-black border transition-all ${!manualMode?'bg-slate-700 text-white border-slate-700':'bg-white text-slate-400 border-slate-200 hover:border-slate-400'}`}>
                      주문에서 불러오기
                    </button>
                    <button onClick={()=>{setManualMode(true);setSelectedOrderId('');}}
                      className={`flex-1 py-2 rounded-xl text-xs font-black border transition-all ${manualMode?'bg-slate-700 text-white border-slate-700':'bg-white text-slate-400 border-slate-200 hover:border-slate-400'}`}>
                      직접 입력
                    </button>
                  </div>
                </div>
              )}

              {/* 매출: 주문 목록 */}
              {selectedClientId && createMode === '매출' && !manualMode && (
                <div className="px-5 pt-3 pb-2">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">주문 선택 ({clientOrders.length}건)</span>
                    <div className="flex items-center gap-1.5">
                      <input type="date" value={dateFrom} onChange={e=>{setDateFrom(e.target.value);setSelectedOrderId('');}}
                        className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-[11px] font-bold outline-none focus:ring-2 focus:ring-indigo-300"/>
                      <span className="text-slate-300 text-xs">~</span>
                      <input type="date" value={dateTo} onChange={e=>{setDateTo(e.target.value);setSelectedOrderId('');}}
                        className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-[11px] font-bold outline-none focus:ring-2 focus:ring-indigo-300"/>
                      {(dateFrom||dateTo)&&<button onClick={()=>{setDateFrom('');setDateTo('');}} className="text-[10px] font-bold text-slate-400 hover:text-rose-500">초기화</button>}
                    </div>
                  </div>
                  {clientOrders.length === 0 ? (
                    <div className="flex items-center justify-center gap-2 text-slate-300 text-xs font-bold py-3">
                      <Package size={14}/> 해당 조건의 주문이 없습니다.
                    </div>
                  ) : (
                    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                      <div className="max-h-36 overflow-y-auto divide-y divide-slate-50">
                        {clientOrders.map(o => {
                          const isSel = o.id === selectedOrderId;
                          const existingStmt = issuedStatements.find(s => s.orderId === o.id);
                          const alreadyIssued = !!o.invoicePrinted && !!existingStmt;
                          return (
                            <button key={o.id} onClick={()=>handleOrderClick(o)}
                              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-all ${
                                isSel?'bg-indigo-50 border-l-4 border-l-indigo-500'
                                :alreadyIssued?'bg-amber-50 border-l-4 border-l-amber-400 hover:bg-amber-100'
                                :'bg-white hover:bg-slate-50 border-l-4 border-l-transparent'
                              }`}>
                              <div className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${isSel?'border-indigo-500':alreadyIssued?'border-amber-400':'border-slate-300'}`}>
                                {isSel&&<div className="w-1.5 h-1.5 rounded-full bg-indigo-500"/>}
                                {!isSel&&alreadyIssued&&<div className="w-1.5 h-1.5 rounded-full bg-amber-400"/>}
                              </div>
                              <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-black text-slate-700">납품일: {o.deliveryDate?.slice(0,10)||'미정'}</span>
                                <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${STATUS_COLOR[o.status]||'bg-slate-100 text-slate-500'}`}>{STATUS_LABEL[o.status]||o.status}</span>
                                {alreadyIssued&&<span className="flex items-center gap-0.5 text-[9px] font-black px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200"><CheckCircle2 size={8}/>발행완료</span>}
                                <span className="text-[10px] text-slate-400 ml-auto">주문일 {o.createdAt?.slice(0,10)} · {o.items.length}품목</span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── 전표 본체 (거래처 선택 즉시 표시) ── */}
              {selectedClientId && (
                <div className="p-5 space-y-4">

                  {/* 전표 헤더 */}
                  <div className="text-center text-xl font-black tracking-widest text-slate-800">
                    {createMode==='매출' ? '거  래  명  세  서' : '거  래  명  세  서 (매입)'}
                  </div>
                  <div className="flex justify-between text-xs text-slate-500">
                    <span className="font-bold">문서번호: {docNo}</span>
                    <span>거래일자: {dateStr}</span>
                  </div>
                  <div className="grid grid-cols-2 border border-slate-300 rounded-lg overflow-hidden text-xs font-bold">
                    <div className="bg-slate-50 px-4 py-2.5 text-slate-700">{supplierLabel}</div>
                    <div className="bg-slate-50 px-4 py-2.5 text-slate-700 border-l border-slate-300">{receiverLabel}</div>
                  </div>

                  {/* 품목 테이블 */}
                  <div className="border border-slate-200 rounded-xl overflow-visible">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          {['No','품목명','규격','수량','단가','공급가액','세액','합계',''].map((h,i)=>(
                            <th key={i} className="px-3 py-2.5 text-[10px] font-black text-slate-500 text-center whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {manualMode ? (() => {
                          const ro = !!(editingStmt && !isEditMode); // 읽기 전용 여부
                          const activeRows = ro ? manualItems.filter(r => r.name.trim()) : manualItems;
                          return (
                          <>
                            {activeRows.map((row, idx) => {
                              const q = parseFloat(row.qty)||0, p = parseFloat(row.price)||0;
                              const sup = row.isTaxExempt ? q*p : Math.round(q*p/1.1);
                              const tax = row.isTaxExempt ? 0 : q*p - sup;
                              const searchResults = ro ? [] : searchableRows.filter(r =>
                                row.name.trim() && r.product!.name.toLowerCase().includes(row.name.toLowerCase())
                              );
                              return (
                                <tr key={idx} className={ro ? '' : 'hover:bg-slate-50'}>
                                  <td className="px-3 py-2 text-[11px] text-center text-slate-400 w-8">{idx+1}</td>
                                  <td className="px-2 py-1.5 relative">
                                    {ro ? (
                                      <span className="px-2 text-xs font-bold text-slate-800">{row.name}</span>
                                    ) : (
                                      <>
                                        <input type="text" placeholder="품목명 검색..." value={row.name}
                                          onChange={e=>setManualItems(prev=>prev.map((r,i)=>i===idx?{...r,name:e.target.value}:r))}
                                          onFocus={()=>setActiveSearchRow(idx)}
                                          onBlur={()=>setTimeout(()=>setActiveSearchRow(null),150)}
                                          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300 min-w-[110px]"/>
                                        {activeSearchRow===idx && searchResults.length > 0 && (
                                          <div className="absolute left-2 top-full mt-0.5 z-50 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden min-w-[200px]">
                                            {searchResults.slice(0,8).map(r=>(
                                              <button key={r.pc.id}
                                                onMouseDown={()=>{
                                                  setManualItems(prev=>prev.map((item,i)=>i===idx?{
                                                    ...item,
                                                    name: r.product!.name,
                                                    spec: r.product!.용량||'',
                                                    price: String(r.pc.price??r.product!.price??0),
                                                    isTaxExempt: r.pc.taxType==='면세',
                                                  }:item));
                                                  setActiveSearchRow(null);
                                                }}
                                                className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-indigo-50 hover:text-indigo-700 transition-colors text-left">
                                                <span className="font-bold">{r.product!.name}</span>
                                                <span className="text-[10px] text-slate-400 ml-2">{r.pc.price!==undefined?fmt(r.pc.price)+'원':''}</span>
                                              </button>
                                            ))}
                                          </div>
                                        )}
                                      </>
                                    )}
                                  </td>
                                  <td className="px-2 py-1.5">
                                    {ro ? (
                                      <span className="px-2 text-xs text-slate-500">{row.spec}</span>
                                    ) : (
                                      <input type="text" placeholder="규격" value={row.spec}
                                        onChange={e=>setManualItems(prev=>prev.map((r,i)=>i===idx?{...r,spec:e.target.value}:r))}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300 w-16"/>
                                    )}
                                  </td>
                                  <td className="px-2 py-1.5">
                                    {ro ? (
                                      <span className="block px-2 text-xs text-right text-slate-700 font-bold">{row.qty}</span>
                                    ) : (
                                      <input type="number" placeholder="0" value={row.qty}
                                        onChange={e=>setManualItems(prev=>prev.map((r,i)=>i===idx?{...r,qty:e.target.value}:r))}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300 text-right w-14"/>
                                    )}
                                  </td>
                                  <td className="px-2 py-1.5">
                                    {ro ? (
                                      <span className="block px-2 text-xs text-right text-slate-700 font-bold">{fmt(p)}</span>
                                    ) : (
                                      <input type="number" placeholder="0" value={row.price}
                                        onChange={e=>setManualItems(prev=>prev.map((r,i)=>i===idx?{...r,price:e.target.value}:r))}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300 text-right w-20"/>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-xs text-right text-slate-600 whitespace-nowrap">{sup>0?fmt(sup):'-'}</td>
                                  <td className="px-2 py-1.5 text-center">
                                    {ro ? (
                                      <span className={`px-2 py-1 rounded-md text-[9px] font-black ${row.isTaxExempt?'text-indigo-600':'text-slate-400'}`}>
                                        {row.isTaxExempt?'면세':tax>0?fmt(tax):'-'}
                                      </span>
                                    ) : (
                                      <button onClick={()=>setManualItems(prev=>prev.map((r,i)=>i===idx?{...r,isTaxExempt:!r.isTaxExempt}:r))}
                                        className={`px-2 py-1 rounded-md text-[9px] font-black border transition-all whitespace-nowrap ${row.isTaxExempt?'bg-indigo-100 text-indigo-600 border-indigo-200':'bg-slate-100 text-slate-400 border-slate-200 hover:bg-slate-200'}`}>
                                        {row.isTaxExempt?'면세':tax>0?fmt(tax):'-'}
                                      </button>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-xs text-right font-black text-slate-800 whitespace-nowrap">{(sup+tax)>0?fmt(sup+tax):'-'}</td>
                                  <td className="px-2 py-2 text-center">
                                    {!ro && manualItems.length>1&&(
                                      <button onClick={()=>setManualItems(prev=>prev.filter((_,i)=>i!==idx))}
                                        className="p-1 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"><X size={12}/></button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                            {!ro && (
                              <tr>
                                <td colSpan={9} className="px-3 py-2 border-t border-slate-100">
                                  <button onClick={()=>setManualItems(prev=>[...prev,{name:'',spec:'',qty:'',price:'',isTaxExempt:false}])}
                                    className="flex items-center gap-1 text-[11px] font-black text-slate-400 hover:text-indigo-600 transition-all">
                                    <Plus size={11} strokeWidth={3}/>행 추가
                                  </button>
                                </td>
                              </tr>
                            )}
                          </>
                          );
                        })() : (
                          lineItems.length > 0 ? lineItems.map(item => (
                            <tr key={item.key} className="hover:bg-slate-50">
                              <td className="px-3 py-2.5 text-[11px] text-center text-slate-500 w-8">{item.no}</td>
                              <td className="px-3 py-2.5 text-xs font-bold text-slate-800">{item.name}</td>
                              <td className="px-3 py-2.5 text-[11px] text-center text-slate-500">{item.spec}</td>
                              <td className="px-3 py-2.5 text-xs text-right text-slate-600">{fmt(item.qty)}</td>
                              <td className="px-2 py-1.5">
                                <input type="number" placeholder={String(item.price)} value={editablePrices[item.key]??''}
                                  onChange={e=>setEditablePrices(prev=>({...prev,[item.key]:e.target.value}))}
                                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-right outline-none focus:ring-2 focus:ring-indigo-300 w-20"/>
                              </td>
                              <td className="px-3 py-2.5 text-xs text-right text-slate-600">{fmt(item.supply)}</td>
                              <td className="px-2 py-1.5 text-center">
                                <button onClick={()=>setTaxExemptOverrides(prev=>({...prev,[item.key]:!item.isTaxExempt}))}
                                  className={`px-2 py-1 rounded-md text-[9px] font-black border transition-all ${item.isTaxExempt?'bg-indigo-100 text-indigo-600 border-indigo-200':'bg-slate-100 text-slate-400 border-slate-200 hover:bg-slate-200'}`}>
                                  {item.isTaxExempt?'면세':fmt(item.tax)}
                                </button>
                              </td>
                              <td className="px-3 py-2.5 text-xs text-right font-black text-slate-800">{fmt(item.total)}</td>
                              <td/>
                            </tr>
                          )) : (
                            <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-300 text-xs font-bold">주문을 선택하면 품목이 표시됩니다</td></tr>
                          )
                        )}
                        {/* 합계 행 */}
                        {lineItems.length > 0 && (
                          <tr className="bg-slate-50 border-t border-slate-200">
                            <td colSpan={5} className="px-3 py-2.5 text-xs font-black text-center text-slate-700">합　계</td>
                            <td className="px-3 py-2.5 text-xs font-black text-right text-slate-700">{fmt(totalSupply)}</td>
                            <td className="px-3 py-2.5 text-xs font-black text-right text-slate-700">{fmt(totalTax)}</td>
                            <td className="px-3 py-2.5 text-sm font-black text-right text-blue-800">{fmt(totalAmount)}</td>
                            <td/>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* 합계 요약 */}
                  <div className="flex items-center justify-end gap-6 text-xs text-slate-400 pr-1">
                    <span>공급가액 <strong className="text-slate-700">{fmt(totalSupply)}원</strong></span>
                    <span>세액 <strong className="text-slate-700">{fmt(totalTax)}원</strong></span>
                    <span className="text-sm">청구금액 <strong className="text-blue-700 text-base">{fmt(totalAmount)}원</strong></span>
                  </div>
                </div>
              )}

              {!selectedClientId && (
                <div className="flex flex-col items-center justify-center py-24 text-slate-300">
                  <ClipboardList size={40} className="mb-3 opacity-40"/>
                  <p className="font-black text-sm">거래처를 선택하면 전표를 작성할 수 있습니다</p>
                </div>
              )}

            </div>{/* 모달 본문 끝 */}
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

    </div>
  );
};

export default TradeStatement;
