
import React, { useState, useRef, useMemo } from 'react';
import { FileText, Printer, Search, ChevronDown, CalendarDays, Package, ClipboardList } from 'lucide-react';
import * as ExcelJS from 'exceljs';
import { Order, Product, Client, OrderStatus } from '../types';

interface TradeStatementProps {
  orders: Order[];
  allProducts: Product[];
  clients: Client[];
  onUpdateStatus?: (id: string, status: OrderStatus) => void;
}

const STATUS_LABEL: Record<string, string> = {
  [OrderStatus.PENDING]:    '대기중',
  [OrderStatus.PROCESSING]: '작업중',
  [OrderStatus.DISPATCHED]: '작업완료',
  [OrderStatus.SHIPPED]:    '출고완료',
  [OrderStatus.DELIVERED]:  '배송완료',
};
const STATUS_COLOR: Record<string, string> = {
  [OrderStatus.PENDING]:    'bg-slate-100 text-slate-500',
  [OrderStatus.PROCESSING]: 'bg-amber-100 text-amber-700',
  [OrderStatus.DISPATCHED]: 'bg-sky-100 text-sky-700',
  [OrderStatus.SHIPPED]:    'bg-indigo-100 text-indigo-700',
  [OrderStatus.DELIVERED]:  'bg-emerald-100 text-emerald-700',
};

const TradeStatement: React.FC<TradeStatementProps> = ({ orders, allProducts, clients, onUpdateStatus }) => {
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [selectedOrderId, setSelectedOrderId] = useState<string>('');
  const [clientSearch, setClientSearch] = useState('');
  const [orderSearch, setOrderSearch] = useState('');
  const [onlyActive, setOnlyActive] = useState(false);
  const [tradeDate, setTradeDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [showPreview, setShowPreview] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  // 거래명세서 대상 주문: 모든 상태 포함 (이력 포함)
  const statementOrders = useMemo(() =>
    orders.filter(o =>
      o.status === OrderStatus.SHIPPED ||
      o.status === OrderStatus.DELIVERED ||
      o.status === OrderStatus.PENDING ||
      o.status === OrderStatus.PROCESSING ||
      o.status === OrderStatus.DISPATCHED
    ),
    [orders]
  );

  // 현재 진행중인 거래처 ID 집합 (DELIVERED 제외)
  const activeClientIds = useMemo(() =>
    new Set(
      orders
        .filter(o => o.status !== OrderStatus.DELIVERED)
        .map(o => o.clientId)
    ),
    [orders]
  );

  // 거래처 목록: 스마트스토어 제외, 일반+택배만
  const availableClients = useMemo(() => {
    let base = clients.filter(c => c.type === '일반' || c.type === '택배');
    if (onlyActive) base = base.filter(c => activeClientIds.has(c.id));
    if (!clientSearch.trim()) return base;
    return base.filter(c => c.name.toLowerCase().includes(clientSearch.toLowerCase()));
  }, [clients, clientSearch, onlyActive, activeClientIds]);

  // 선택된 거래처의 주문 목록 (최신순)
  const clientOrders = useMemo(() =>
    statementOrders
      .filter(o => o.clientId === selectedClientId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [statementOrders, selectedClientId]
  );

  // 주문 검색 필터
  const filteredClientOrders = useMemo(() => {
    if (!orderSearch.trim()) return clientOrders;
    const q = orderSearch.toLowerCase();
    return clientOrders.filter(o =>
      o.deliveryDate?.includes(q) ||
      o.createdAt?.slice(0, 10).includes(q) ||
      STATUS_LABEL[o.status]?.includes(q)
    );
  }, [clientOrders, orderSearch]);

  const selectedOrder = clientOrders.find(o => o.id === selectedOrderId);

  // 선택된 주문의 품목 집계
  type LineItem = { no: number; name: string; spec: string; qty: number; price: number; supply: number; tax: number; total: number };
  const lineItems = useMemo(() => {
    if (!selectedOrder) return [];
    const itemMap: Record<string, LineItem> = {};
    let no = 1;
    selectedOrder.items.forEach(item => {
      const product = allProducts.find(p => p.id === item.productId);
      const spec = product?.용량 || '';
      const key = `${item.name}||${spec}`;
      const unitPrice = item.price || product?.price || 0;
      const supply = unitPrice * item.quantity;
      const tax = Math.round(supply * 0.1);
      if (itemMap[key]) {
        itemMap[key].qty += item.quantity;
        itemMap[key].supply += supply;
        itemMap[key].tax += tax;
        itemMap[key].total += supply + tax;
      } else {
        itemMap[key] = { no: no++, name: item.name, spec, qty: item.quantity, price: unitPrice, supply, tax, total: supply + tax };
      }
    });
    return Object.values(itemMap);
  }, [selectedOrder, allProducts]);

  const totalSupply = lineItems.reduce((s, r) => s + r.supply, 0);
  const totalTax = lineItems.reduce((s, r) => s + r.tax, 0);
  const totalAmount = totalSupply + totalTax;

  const tradeDateObj = new Date(tradeDate + 'T00:00:00');
  const dateStr = `${tradeDateObj.getFullYear()}년 ${tradeDateObj.getMonth() + 1}월 ${tradeDateObj.getDate()}일`;
  const docNo = `${tradeDateObj.getFullYear()}-${String(tradeDateObj.getMonth() + 1).padStart(2, '0')}-${String(orders.filter(o => o.status === OrderStatus.SHIPPED).length).padStart(4, '0')}`;
  const selectedClient = clients.find(c => c.id === selectedClientId);

  const fmt = (n: number) => n.toLocaleString('ko-KR');

  const markAsDelivered = () => {
    if (onUpdateStatus && selectedOrderId && selectedOrder?.status === OrderStatus.SHIPPED) {
      onUpdateStatus(selectedOrderId, OrderStatus.DELIVERED);
    }
  };

  const handlePrint = () => {
    const content = printRef.current;
    if (!content) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`
      <html><head><title>거래명세서</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: '맑은 고딕', sans-serif; font-size: 11px; color: #000; padding: 20px; }
        table { border-collapse: collapse; width: 100%; }
        td, th { border: 1px solid #000; padding: 4px 6px; }
        @media print { body { padding: 10px; } }
      </style></head><body>
      ${content.innerHTML}
      </body></html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    printWindow.close();
    markAsDelivered();
  };

  const handleExcel = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('거래명세서');
    const border: Partial<ExcelJS.Borders> = {
      top: { style: 'thin' }, bottom: { style: 'thin' },
      left: { style: 'thin' }, right: { style: 'thin' },
    };
    const headerFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };

    ws.columns = [
      { width: 5 }, { width: 20 }, { width: 10 }, { width: 8 },
      { width: 12 }, { width: 14 }, { width: 12 }, { width: 14 },
    ];

    ws.mergeCells('A1:H1');
    const titleCell = ws.getCell('A1');
    titleCell.value = '거  래  명  세  서';
    titleCell.font = { bold: true, size: 18 };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 36;

    ws.mergeCells('A2:D2');
    ws.getCell('A2').value = `문서번호: ${docNo}`;
    ws.mergeCells('E2:H2');
    ws.getCell('E2').value = `거래일자: ${dateStr}`;
    ws.getCell('E2').alignment = { horizontal: 'right' };
    ws.getRow(2).height = 18;

    ws.getRow(3).height = 16;
    ws.mergeCells('A3:D3');
    ws.getCell('A3').value = '【 공급자 】';
    ws.getCell('A3').fill = headerFill;
    ws.getCell('A3').font = { bold: true };
    ws.getCell('A3').border = border;
    ws.mergeCells('E3:H3');
    ws.getCell('E3').value = `【 공급받는자 】  ${selectedClient?.name || ''}`;
    ws.getCell('E3').fill = headerFill;
    ws.getCell('E3').font = { bold: true };
    ws.getCell('E3').border = border;

    ws.addRow([]);

    const hRow = ws.addRow(['No', '품목명', '규격', '수량', '단가', '공급가액', '세액', '합계']);
    hRow.height = 18;
    hRow.eachCell(c => {
      c.font = { bold: true, size: 9 };
      c.fill = headerFill;
      c.border = border;
      c.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    lineItems.forEach(item => {
      const r = ws.addRow([item.no, item.name, item.spec, item.qty, item.price, item.supply, item.tax, item.total]);
      r.height = 16;
      r.eachCell((c, col) => {
        c.border = border;
        c.font = { size: 9 };
        c.alignment = { horizontal: col <= 3 ? 'left' : 'right', vertical: 'middle' };
        if (col >= 4) c.numFmt = '#,##0';
      });
    });

    const emptyRows = Math.max(0, 10 - lineItems.length);
    for (let i = 0; i < emptyRows; i++) {
      const r = ws.addRow(['', '', '', '', '', '', '', '']);
      r.height = 14;
      r.eachCell(c => { c.border = border; });
    }

    const sumRow = ws.addRow(['합계', '', '', '', '', totalSupply, totalTax, totalAmount]);
    sumRow.height = 18;
    sumRow.eachCell((c, col) => {
      c.border = border;
      c.font = { bold: true, size: 9 };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
      c.alignment = { horizontal: col <= 3 ? 'center' : 'right', vertical: 'middle' };
      if (col >= 5) c.numFmt = '#,##0';
    });
    ws.mergeCells(`A${sumRow.number}:E${sumRow.number}`);

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `거래명세서_${selectedClient?.name || ''}_${tradeDate}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    markAsDelivered();
  };

  return (
    <div className="space-y-5 animate-in slide-in-from-right-4 duration-500">

      {/* ── 1단계: 거래처 + 주문 선택 ── */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-5">
        <p className="text-xs font-black text-slate-400 uppercase tracking-widest">거래명세서 생성</p>

        {/* 거래처 선택 행 */}
        <div className="space-y-2">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">거래처</label>
          <div className="flex items-center gap-2 flex-wrap">
            {/* 검색 */}
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" />
              <input
                type="text"
                placeholder="거래처 검색..."
                value={clientSearch}
                onChange={e => setClientSearch(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl pl-8 pr-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-400 w-36"
              />
            </div>
            {/* 현재 주문 거래처만 토글 */}
            <button
              onClick={() => { setOnlyActive(v => !v); setSelectedClientId(''); setSelectedOrderId(''); setShowPreview(false); }}
              className={`px-3 py-2.5 rounded-xl text-[11px] font-black border transition-all whitespace-nowrap ${
                onlyActive
                  ? 'bg-indigo-600 border-indigo-600 text-white'
                  : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300'
              }`}
            >
              현재 주문 거래처만
            </button>
            {/* 셀렉트 */}
            <div className="relative">
              <select
                value={selectedClientId}
                onChange={e => { setSelectedClientId(e.target.value); setSelectedOrderId(''); setShowPreview(false); }}
                className="appearance-none bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-400 pr-8 min-w-[180px]"
              >
                <option value="">— 선택 —</option>
                {availableClients.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* 주문 선택 (거래처 선택 후 표시) */}
        {selectedClientId && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                주문 선택 <span className="normal-case font-medium text-slate-300">({clientOrders.length}건)</span>
              </label>
              {/* 주문 검색 */}
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" />
                <input
                  type="text"
                  placeholder="날짜·상태 검색"
                  value={orderSearch}
                  onChange={e => setOrderSearch(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-lg pl-7 pr-3 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300 w-32"
                />
              </div>
            </div>

            {clientOrders.length === 0 ? (
              <div className="flex items-center gap-2 text-slate-300 text-xs font-bold py-4 px-3">
                <Package size={16} /> 해당 거래처의 주문 이력이 없습니다.
              </div>
            ) : (
              <div className="border border-slate-100 rounded-xl overflow-hidden">
                {/* 스크롤 영역 */}
                <div className="max-h-52 overflow-y-auto divide-y divide-slate-50">
                  {filteredClientOrders.length === 0 ? (
                    <div className="py-6 text-center text-slate-300 text-xs font-bold">검색 결과 없음</div>
                  ) : (
                    filteredClientOrders.map(o => {
                      const isSelected = o.id === selectedOrderId;
                      return (
                        <button
                          key={o.id}
                          onClick={() => { setSelectedOrderId(isSelected ? '' : o.id); setShowPreview(false); }}
                          className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-all ${
                            isSelected
                              ? 'bg-indigo-50 border-l-4 border-l-indigo-500'
                              : 'bg-white hover:bg-slate-50 border-l-4 border-l-transparent'
                          }`}
                        >
                          {/* 라디오 */}
                          <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                            isSelected ? 'border-indigo-500' : 'border-slate-300'
                          }`}>
                            {isSelected && <div className="w-2 h-2 rounded-full bg-indigo-500" />}
                          </div>
                          {/* 주문 정보 */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-black text-slate-700">
                                납품일: {o.deliveryDate?.slice(0, 10) || '미정'}
                              </span>
                              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${STATUS_COLOR[o.status] || 'bg-slate-100 text-slate-500'}`}>
                                {STATUS_LABEL[o.status] || o.status}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              주문일 {o.createdAt?.slice(0, 10)} · {o.items.length}개 품목 · {o.items.reduce((s, i) => s + i.quantity, 0)}개
                            </p>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 거래일자 + 생성 버튼 */}
        {selectedOrderId && (
          <div className="flex items-end gap-3 flex-wrap pt-1 border-t border-slate-100">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                <CalendarDays size={11} /> 거래 일자
              </label>
              <input
                type="date"
                value={tradeDate}
                onChange={e => { setTradeDate(e.target.value); setShowPreview(false); }}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            <button
              onClick={() => setShowPreview(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-black hover:bg-indigo-700 transition-all"
            >
              <ClipboardList size={14} /> 거래명세서 생성
            </button>
          </div>
        )}
      </div>

      {/* ── 2단계: 미리보기 + 출력 ── */}
      {showPreview && lineItems.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          {/* 출력 버튼 */}
          <div className="flex items-center justify-between">
            <p className="text-xs font-black text-slate-400 uppercase tracking-widest">미리보기</p>
            <div className="flex gap-2">
              <button
                onClick={handlePrint}
                className="flex items-center gap-2 px-4 py-2.5 bg-slate-700 text-white rounded-xl text-xs font-black hover:bg-slate-800 transition-all"
              >
                <Printer size={14} /> 인쇄
              </button>
              <button
                onClick={handleExcel}
                className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-xs font-black hover:bg-emerald-700 transition-all"
              >
                <FileText size={14} /> 엑셀 저장
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <div ref={printRef} style={{ fontFamily: "'맑은 고딕', sans-serif", fontSize: 11, color: '#000', minWidth: 680 }}>
              {/* 제목 */}
              <div style={{ textAlign: 'center', fontSize: 22, fontWeight: 'bold', marginBottom: 12, letterSpacing: 8 }}>
                거  래  명  세  서
              </div>

              {/* 문서번호 / 날짜 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 10 }}>
                <span style={{ fontWeight: 'bold' }}>문서번호: {docNo}</span>
                <span>거래일자: {dateStr}</span>
              </div>

              {/* 공급자 / 공급받는자 */}
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 10 }}>
                <tbody>
                  <tr>
                    <td style={{ border: '1px solid #000', padding: '6px 10px', width: '50%', background: '#d9e1f2', fontWeight: 'bold', fontSize: 11 }}>
                      【 공급자 】
                    </td>
                    <td style={{ border: '1px solid #000', padding: '6px 10px', width: '50%', background: '#d9e1f2', fontWeight: 'bold', fontSize: 11 }}>
                      【 공급받는자 】　{selectedClient?.name}
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* 품목 테이블 */}
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#d9e1f2' }}>
                    {['No', '품목명', '규격', '수량', '단가', '공급가액', '세액', '합계'].map(h => (
                      <th key={h} style={{ border: '1px solid #000', padding: '5px 6px', fontSize: 10, fontWeight: 'bold', textAlign: 'center', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map(item => (
                    <tr key={item.no}>
                      <td style={{ border: '1px solid #000', padding: '4px 6px', textAlign: 'center', fontSize: 10 }}>{item.no}</td>
                      <td style={{ border: '1px solid #000', padding: '4px 8px', fontSize: 10 }}>{item.name}</td>
                      <td style={{ border: '1px solid #000', padding: '4px 6px', textAlign: 'center', fontSize: 10 }}>{item.spec}</td>
                      <td style={{ border: '1px solid #000', padding: '4px 6px', textAlign: 'right', fontSize: 10 }}>{fmt(item.qty)}</td>
                      <td style={{ border: '1px solid #000', padding: '4px 6px', textAlign: 'right', fontSize: 10 }}>{fmt(item.price)}</td>
                      <td style={{ border: '1px solid #000', padding: '4px 6px', textAlign: 'right', fontSize: 10 }}>{fmt(item.supply)}</td>
                      <td style={{ border: '1px solid #000', padding: '4px 6px', textAlign: 'right', fontSize: 10 }}>{fmt(item.tax)}</td>
                      <td style={{ border: '1px solid #000', padding: '4px 6px', textAlign: 'right', fontSize: 10, fontWeight: 'bold' }}>{fmt(item.total)}</td>
                    </tr>
                  ))}
                  {/* 빈 행 */}
                  {Array.from({ length: Math.max(0, 8 - lineItems.length) }).map((_, i) => (
                    <tr key={`empty-${i}`} style={{ height: 22 }}>
                      {[...Array(8)].map((__, j) => (
                        <td key={j} style={{ border: '1px solid #000' }} />
                      ))}
                    </tr>
                  ))}
                  {/* 합계 행 */}
                  <tr style={{ background: '#eff6ff' }}>
                    <td colSpan={5} style={{ border: '1px solid #000', padding: '5px 8px', fontWeight: 'bold', textAlign: 'center', fontSize: 10 }}>합　계</td>
                    <td style={{ border: '1px solid #000', padding: '5px 6px', textAlign: 'right', fontWeight: 'bold', fontSize: 10 }}>{fmt(totalSupply)}</td>
                    <td style={{ border: '1px solid #000', padding: '5px 6px', textAlign: 'right', fontWeight: 'bold', fontSize: 10 }}>{fmt(totalTax)}</td>
                    <td style={{ border: '1px solid #000', padding: '5px 6px', textAlign: 'right', fontWeight: 'bold', fontSize: 11, color: '#1e3a5f' }}>{fmt(totalAmount)}</td>
                  </tr>
                </tbody>
              </table>

              {/* 금액 요약 */}
              <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 24, fontSize: 11 }}>
                <span>공급가액: <strong>{fmt(totalSupply)}원</strong></span>
                <span>세액: <strong>{fmt(totalTax)}원</strong></span>
                <span style={{ fontSize: 13, color: '#1e3a5f' }}>청구금액: <strong>{fmt(totalAmount)}원</strong></span>
              </div>
            </div>
          </div>
        </div>
      )}

      {!selectedClientId && (
        <div className="bg-slate-50 rounded-2xl border border-dashed border-slate-200 py-16 text-center text-slate-400 text-sm font-bold">
          거래처를 선택하면 주문 목록이 표시됩니다.
        </div>
      )}
    </div>
  );
};

export default TradeStatement;
