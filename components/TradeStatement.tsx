
import React, { useState, useRef } from 'react';
import { FileText, Printer, ChevronDown } from 'lucide-react';
import * as ExcelJS from 'exceljs';
import { Order, Product, Client, OrderStatus } from '../types';

interface TradeStatementProps {
  orders: Order[];
  allProducts: Product[];
  clients: Client[];
}

const TradeStatement: React.FC<TradeStatementProps> = ({ orders, allProducts, clients }) => {
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const printRef = useRef<HTMLDivElement>(null);

  // SHIPPED 주문에서 거래처 목록
  const shippedOrders = orders.filter(o => o.status === OrderStatus.SHIPPED);
  const availableClients = clients.filter(c =>
    shippedOrders.some(o => o.clientId === c.id)
  );

  // 선택된 거래처의 주문 목록
  const clientOrders = shippedOrders.filter(o => o.clientId === selectedClientId);

  // 선택된 주문들의 품목 집계 (같은 품목 합산)
  type LineItem = { no: number; name: string; spec: string; qty: number; price: number; supply: number; tax: number; total: number };
  const lineItems: LineItem[] = [];
  const itemMap: Record<string, LineItem> = {};
  let no = 1;

  clientOrders
    .filter(o => selectedOrderIds.includes(o.id))
    .forEach(order => {
      order.items.forEach(item => {
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
    });
  Object.values(itemMap).forEach(v => lineItems.push(v));

  const totalSupply = lineItems.reduce((s, r) => s + r.supply, 0);
  const totalTax = lineItems.reduce((s, r) => s + r.tax, 0);
  const totalAmount = totalSupply + totalTax;

  const today = new Date();
  const dateStr = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`;
  const docNo = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(orders.filter(o => o.status === OrderStatus.SHIPPED).length).padStart(4, '0')}`;
  const selectedClient = clients.find(c => c.id === selectedClientId);

  const fmt = (n: number) => n.toLocaleString('ko-KR');

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
        .title { font-size: 20px; font-weight: bold; text-align: center; margin-bottom: 12px; }
        .doc-info { text-align: right; font-size: 10px; margin-bottom: 8px; }
        .section-title { background: #d9e1f2; font-weight: bold; text-align: center; }
        .total-row { background: #eff6ff; font-weight: bold; }
        .amount-section { margin-top: 8px; text-align: right; font-size: 12px; font-weight: bold; }
        @media print { body { padding: 10px; } }
      </style></head><body>
      ${content.innerHTML}
      </body></html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    printWindow.close();
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

    // 제목
    ws.mergeCells('A1:H1');
    const titleCell = ws.getCell('A1');
    titleCell.value = '거  래  명  세  서';
    titleCell.font = { bold: true, size: 18 };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 36;

    // 문서번호 / 날짜
    ws.mergeCells('A2:D2');
    ws.getCell('A2').value = `문서번호: ${docNo}`;
    ws.mergeCells('E2:H2');
    ws.getCell('E2').value = `거래일자: ${dateStr}`;
    ws.getCell('E2').alignment = { horizontal: 'right' };
    ws.getRow(2).height = 18;

    // 공급자 / 공급받는자
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

    // 헤더
    const hRow = ws.addRow(['No', '품목명', '규격', '수량', '단가', '공급가액', '세액', '합계']);
    hRow.height = 18;
    hRow.eachCell(c => {
      c.font = { bold: true, size: 9 };
      c.fill = headerFill;
      c.border = border;
      c.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    // 품목 행
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

    // 빈 행 채우기 (최소 10행)
    const emptyRows = Math.max(0, 10 - lineItems.length);
    for (let i = 0; i < emptyRows; i++) {
      const r = ws.addRow(['', '', '', '', '', '', '', '']);
      r.height = 14;
      r.eachCell(c => { c.border = border; });
    }

    // 합계
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
    a.download = `거래명세서_${selectedClient?.name || ''}_${today.toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5 animate-in slide-in-from-right-4 duration-500">
      {/* 거래처 / 주문 선택 */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
        <p className="text-xs font-black text-slate-400 uppercase tracking-widest">거래명세서 생성</p>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">거래처 선택</label>
            <div className="relative">
              <select
                value={selectedClientId}
                onChange={e => { setSelectedClientId(e.target.value); setSelectedOrderIds([]); }}
                className="appearance-none bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-400 pr-8 min-w-[180px]"
              >
                <option value="">거래처 선택</option>
                {availableClients.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
          </div>

          {selectedClientId && clientOrders.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">주문 선택 (복수 가능)</label>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setSelectedOrderIds(
                    selectedOrderIds.length === clientOrders.length ? [] : clientOrders.map(o => o.id)
                  )}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-black border transition-all bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100"
                >
                  전체 선택
                </button>
                {clientOrders.map(o => (
                  <button
                    key={o.id}
                    onClick={() => setSelectedOrderIds(prev =>
                      prev.includes(o.id) ? prev.filter(id => id !== o.id) : [...prev, o.id]
                    )}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-black border transition-all ${
                      selectedOrderIds.includes(o.id)
                        ? 'bg-indigo-600 border-indigo-600 text-white'
                        : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                    }`}
                  >
                    {o.deliveryDate?.slice(0, 10)} ({o.items.length}종)
                  </button>
                ))}
              </div>
            </div>
          )}

          {lineItems.length > 0 && (
            <div className="flex gap-2 ml-auto">
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
          )}
        </div>
      </div>

      {/* 미리보기 */}
      {lineItems.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 overflow-x-auto">
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
      )}

      {selectedClientId && clientOrders.length === 0 && (
        <div className="bg-slate-50 rounded-2xl border border-dashed border-slate-200 py-16 text-center text-slate-400 text-sm font-bold">
          해당 거래처의 출고 대기 주문이 없습니다.
        </div>
      )}

      {!selectedClientId && (
        <div className="bg-slate-50 rounded-2xl border border-dashed border-slate-200 py-16 text-center text-slate-400 text-sm font-bold">
          거래처를 선택하면 거래명세서 미리보기가 표시됩니다.
        </div>
      )}
    </div>
  );
};

export default TradeStatement;
