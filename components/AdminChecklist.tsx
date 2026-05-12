
import React, { useMemo, useState } from 'react';
import {
  Clock, AlertCircle, Package, ArrowRight,
  CalendarDays, User, ShoppingCart, AtSign,
  ClipboardList, RotateCcw, Building2, FileText, History, Link2,
  X, Loader2, Check, Plus,
} from 'lucide-react';
import { LeaveRequest, AdjustmentRequest, Employee, ReturnRequest, ReturnItem, PendingReceipt, IssuedStatement, IssuedStatementItem, Client, PendingStatementEdit, Item, PartnerItem } from '../types';
import { addItem, updateItem } from '../src/shared/services/firebaseService';
import PageHeader from './PageHeader';

interface AdminChecklistProps {
  leaveRequests: LeaveRequest[];
  adjustmentRequests: AdjustmentRequest[];
  employees: Employee[];
  returnRequests?: ReturnRequest[];
  pendingReceipts?: PendingReceipt[];
  clients?: Client[];
  issuedStatements?: IssuedStatement[];
  onUpdateLeaveStatus: (_id: string, _status: 'approved' | 'rejected') => void;
  onUpdateAdjustmentStatus: (_id: string, _status: 'processed' | 'rejected') => void;
  onProcessAdjustment: (_req: AdjustmentRequest) => void;
  pendingStatementEdits?: PendingStatementEdit[];
  onApproveStatementEdit?: (_edit: PendingStatementEdit) => void;
  onRejectStatementEdit?: (_id: string) => void;
  orderRequests?: { id: string; quantity: number; isBox?: boolean }[];
  items?: Item[];
  productSuppliers?: PartnerItem[];
  onCreatePurchaseStatement?: (_data: { supplierId: string; supplierName: string; items: Array<{ name: string; spec: string; qty: number; price: number; isBox?: boolean }> }) => void;
}

type TabType = 'leave' | 'adjustment' | 'return' | 'inbound' | 'stmtedit' | 'order';

interface StatementDraftItem { name: string; qty: string; price: string; unit: string; isTaxExempt: boolean; }
interface StatementDraft {
  receipt: PendingReceipt;
  clientId: string;
  tradeDate: string;
  items: StatementDraftItem[];
}
interface ReturnStatementDraft {
  returnReq: ReturnRequest;
  clientId: string;
  tradeDate: string;
  items: StatementDraftItem[];
}

const LEAVE_TYPE_LABEL: Record<string, string> = {
  '연차': '연차', '오전반차': '오전반차', '오후반차': '오후반차',
  '병가': '병가', '경조사': '경조사', '기타': '기타',
};

const AdminChecklist: React.FC<AdminChecklistProps> = ({
  leaveRequests,
  adjustmentRequests,
  employees,
  returnRequests = [],
  pendingReceipts = [],
  clients = [],
  issuedStatements = [],
  onUpdateLeaveStatus,
  onUpdateAdjustmentStatus,
  onProcessAdjustment,
  pendingStatementEdits = [],
  onApproveStatementEdit,
  onRejectStatementEdit,
  orderRequests = [],
  items = [],
  productSuppliers = [],
  onCreatePurchaseStatement,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('leave');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [inboundFilter, setInboundFilter] = useState<'pending_voucher' | 'all'>('all');

  const [statementDraft, setStatementDraft] = useState<StatementDraft | null>(null);
  const [statementSaving, setStatementSaving] = useState(false);
  const [returnStmtDraft, setReturnStmtDraft] = useState<ReturnStatementDraft | null>(null);
  const [returnStmtSaving, setReturnStmtSaving] = useState(false);

  const pendingLeaves = useMemo(() =>
    leaveRequests.filter(r => r.status === 'pending' || r.status === 'cancel_pending' || r.modifyRequest?.status === 'pending')
      .sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()),
    [leaveRequests]
  );
  const pendingAdjustments = useMemo(() =>
    adjustmentRequests.filter(r => r.status === 'pending')
      .sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()),
    [adjustmentRequests]
  );
  const pendingReturns = useMemo(() =>
    returnRequests.filter(r => r.status === 'pending')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [returnRequests]
  );
  const pendingVoucherCount = pendingReceipts.filter(r => r.status === 'pending_voucher').length;
  const filteredReceipts = useMemo(() => {
    const list = inboundFilter === 'pending_voucher'
      ? pendingReceipts.filter(r => r.status === 'pending_voucher')
      : pendingReceipts;
    return [...list].sort((a, b) => b.registeredAt.localeCompare(a.registeredAt));
  }, [pendingReceipts, inboundFilter]);

  const pendingStmtEdits = useMemo(() =>
    pendingStatementEdits.filter(e => e.status === 'pending')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [pendingStatementEdits]
  );
  const totalPending = pendingLeaves.length + pendingAdjustments.length + pendingReturns.length + pendingStmtEdits.length;

  // 발주 예정: 거래처(공급처)별 그룹화
  const orderGroups = useMemo(() => {
    const map = new Map<string, { supplierId: string; supplierName: string; items: Array<{ productId: string; name: string; spec: string; qty: number; price: number; isBox: boolean }> }>();
    for (const req of orderRequests) {
      const product = items.find(p => p.id === req.id);
      if (!product) continue;
      const ps = productSuppliers.find(s => (s.Item_ID === req.id || s.productId === req.id) && s.Direction === 'in');
      const supplierId = ps?.Partner_ID ?? ps?.supplierId ?? 'unknown';
      const supplierName = ps ? (clients.find(c => c.id === supplierId)?.name ?? supplierId) : '미지정';
      if (!map.has(supplierId)) map.set(supplierId, { supplierId, supplierName, items: [] });
      map.get(supplierId)!.items.push({
        productId: req.id,
        name: product.name,
        spec: (product as any).용량 || product.unit || '',
        qty: req.quantity,
        price: ps?.Standard_Price ?? ps?.price ?? 0,
        isBox: req.isBox ?? false,
      });
    }
    return Array.from(map.values());
  }, [orderRequests, items, productSuppliers, clients]);

  const getAdjTypeLabel = (type: string) => {
    if (type === 'quantity_change') return '수량 변동';
    if (type === 'cancel_receipt') return '입고 취소';
    if (type === 'reorder_alert') return '발주 필요';
    return '채팅 언급';
  };
  const getAdjTypeClass = (type: string) => {
    if (type === 'quantity_change') return 'bg-blue-50 text-blue-600';
    if (type === 'cancel_receipt') return 'bg-rose-50 text-rose-600';
    if (type === 'reorder_alert') return 'bg-rose-50 text-rose-600';
    return 'bg-indigo-50 text-indigo-600';
  };
  const getLeaveStatusBadge = (req: LeaveRequest) => {
    if (req.status === 'cancel_pending')
      return <span className="flex items-center gap-1 text-orange-500 font-black text-[10px]"><Clock size={11} />취소 요청</span>;
    if (req.modifyRequest?.status === 'pending')
      return <span className="flex items-center gap-1 text-purple-500 font-black text-[10px]"><Clock size={11} />수정 요청</span>;
    return <span className="flex items-center gap-1 text-amber-500 font-black text-[10px]"><Clock size={11} />승인 대기</span>;
  };
  const getEmployeeName = (empId: string) => employees.find(e => e.id === empId)?.name ?? empId;

  const openReturnStmtModal = (req: ReturnRequest) => {
    const matchedClient = clients.find(c => c.id === req.clientId);
    setReturnStmtDraft({
      returnReq: req,
      clientId: matchedClient?.id ?? '',
      tradeDate: req.createdAt.slice(0, 10),
      items: (req.items as ReturnItem[]).map(item => ({
        name: item.name,
        qty: item.quantity.toString(),
        price: (item.price ?? 0).toString(),
        unit: '',
        isTaxExempt: false,
      })),
    });
  };

  const saveReturnStatement = async () => {
    if (!returnStmtDraft) return;
    const client = clients.find(c => c.id === returnStmtDraft.clientId);
    if (!client) { alert('거래처를 선택해주세요.'); return; }
    const validItems = returnStmtDraft.items.filter(i => Number(i.qty) > 0);
    if (validItems.length === 0) { alert('수량을 1개 이상 입력해주세요.'); return; }
    setReturnStmtSaving(true);
    try {
      const stmtItems: IssuedStatementItem[] = validItems.map(i => {
        const qty = Number(i.qty);
        const price = Number(i.price);
        const supply = qty * price;
        const tax = i.isTaxExempt ? 0 : Math.round(supply * 0.1);
        return { name: i.name, spec: i.unit, qty, price, supply, tax, total: supply + tax, isTaxExempt: i.isTaxExempt };
      });
      const totalSupply = stmtItems.reduce((s, i) => s + i.supply, 0);
      const totalTax = stmtItems.reduce((s, i) => s + i.tax, 0);
      const docNo = `반품-${returnStmtDraft.tradeDate.slice(0, 7)}-${String(issuedStatements.length + 1).padStart(4, '0')}`;
      const stmtId = await addItem('issuedStatements', {
        issuedAt: new Date().toISOString(),
        tradeDate: returnStmtDraft.tradeDate,
        type: '매출' as const,
        clientId: client.id,
        clientName: client.name,
        orderId: returnStmtDraft.returnReq.id,
        docNo,
        totalSupply,
        totalTax,
        totalAmount: totalSupply + totalTax,
        items: stmtItems,
      } as Omit<IssuedStatement, 'id'>);
      await updateItem('returnRequests', returnStmtDraft.returnReq.id, {
        status: 'processed',
        processedAt: new Date().toISOString(),
        linkedStatementId: stmtId,
      });
      setReturnStmtDraft(null);
    } finally {
      setReturnStmtSaving(false);
    }
  };

  const openStatementModal = (receipt: PendingReceipt) => {
    const matchedClient = clients.find(c =>
      c.name === receipt.supplierName ||
      c.name.includes(receipt.supplierName) ||
      receipt.supplierName.includes(c.name)
    );
    setStatementDraft({
      receipt,
      clientId: matchedClient?.id ?? '',
      tradeDate: receipt.registeredAt.slice(0, 10),
      items: receipt.items.map(item => ({
        name: item.name,
        qty: item.quantity.toString(),
        price: (item.unitPrice ?? 0).toString(),
        unit: item.unit,
        isTaxExempt: false,
      })),
    });
  };

  const saveStatement = async () => {
    if (!statementDraft) return;
    const client = clients.find(c => c.id === statementDraft.clientId);
    if (!client) { alert('거래처를 선택해주세요.'); return; }
    const validItems = statementDraft.items.filter(i => Number(i.qty) > 0);
    if (validItems.length === 0) { alert('수량을 1개 이상 입력해주세요.'); return; }
    setStatementSaving(true);
    try {
      const stmtItems: IssuedStatementItem[] = validItems.map(i => {
        const qty = Number(i.qty);
        const price = Number(i.price);
        const supply = qty * price;
        const tax = i.isTaxExempt ? 0 : Math.round(supply * 0.1);
        return { name: i.name, spec: i.unit, qty, price, supply, tax, total: supply + tax, isTaxExempt: i.isTaxExempt };
      });
      const totalSupply = stmtItems.reduce((s, i) => s + i.supply, 0);
      const totalTax = stmtItems.reduce((s, i) => s + i.tax, 0);
      const docNo = `${statementDraft.tradeDate.slice(0, 7)}-${String(issuedStatements.length + 1).padStart(4, '0')}`;
      const stmtId = await addItem('issuedStatements', {
        issuedAt: new Date().toISOString(),
        tradeDate: statementDraft.tradeDate,
        type: '매입' as const,
        clientId: client.id,
        clientName: client.name,
        orderId: statementDraft.receipt.id,
        docNo,
        totalSupply,
        totalTax,
        totalAmount: totalSupply + totalTax,
        items: stmtItems,
      } as Omit<IssuedStatement, 'id'>);
      await updateItem('pendingReceipts', statementDraft.receipt.id, {
        status: 'voucher_linked',
        linkedStatementId: stmtId,
      });
      setStatementDraft(null);
    } finally {
      setStatementSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-500">
      <PageHeader
        title="관리자 확인사항"
        subtitle="연차 신청, 재고 변동, 입고/반품 처리가 필요한 항목을 확인하세요."
        right={(totalPending + pendingVoucherCount) > 0 ? (
          <div className="bg-amber-50 border border-amber-100 px-4 py-2 rounded-xl flex items-center space-x-2">
            <AlertCircle size={18} className="text-amber-500" />
            <span className="text-sm font-bold text-amber-700">대기 중 {totalPending + pendingVoucherCount}건</span>
          </div>
        ) : undefined}
      />

      {/* 탭 */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setActiveTab('leave')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${activeTab === 'leave' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'}`}
        >
          <CalendarDays size={15} />연차 신청
          {pendingLeaves.length > 0 && (
            <span className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-black flex items-center justify-center ${activeTab === 'leave' ? 'bg-white/30 text-white' : 'bg-amber-100 text-amber-700'}`}>
              {pendingLeaves.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('adjustment')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${activeTab === 'adjustment' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'}`}
        >
          <Package size={15} />재고
          {pendingAdjustments.length > 0 && (
            <span className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-black flex items-center justify-center ${activeTab === 'adjustment' ? 'bg-white/30 text-white' : 'bg-amber-100 text-amber-700'}`}>
              {pendingAdjustments.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('return')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${activeTab === 'return' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'}`}
        >
          <RotateCcw size={15} />반품
          {pendingReturns.length > 0 && (
            <span className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-black flex items-center justify-center ${activeTab === 'return' ? 'bg-white/30 text-white' : 'bg-amber-100 text-amber-700'}`}>
              {pendingReturns.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('inbound')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${activeTab === 'inbound' ? 'bg-teal-600 text-white shadow-sm' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'}`}
        >
          <History size={15} />선입고 이력
          {pendingVoucherCount > 0 && (
            <span className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-black flex items-center justify-center ${activeTab === 'inbound' ? 'bg-white/30 text-white' : 'bg-rose-100 text-rose-700'}`}>
              {pendingVoucherCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('stmtedit')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${activeTab === 'stmtedit' ? 'bg-violet-600 text-white shadow-sm' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'}`}
        >
          <FileText size={15} />전표 수정
          {pendingStmtEdits.length > 0 && (
            <span className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-black flex items-center justify-center ${activeTab === 'stmtedit' ? 'bg-white/30 text-white' : 'bg-amber-100 text-amber-700'}`}>
              {pendingStmtEdits.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('order')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${activeTab === 'order' ? 'bg-orange-500 text-white shadow-sm' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'}`}
        >
          <ShoppingCart size={15} />발주 예정
          {orderRequests.length > 0 && (
            <span className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-black flex items-center justify-center ${activeTab === 'order' ? 'bg-white/30 text-white' : 'bg-orange-100 text-orange-700'}`}>
              {orderRequests.length}
            </span>
          )}
        </button>
      </div>

      {/* 연차 신청 탭 */}
      {activeTab === 'leave' && (
        <div className="bg-white rounded-[32px] border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-100">
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">신청일</th>
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">직원</th>
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">유형</th>
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">기간</th>
                  <th className="hidden sm:table-cell px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">사유</th>
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">상태</th>
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center whitespace-nowrap">처리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {pendingLeaves.length === 0 ? (
                  <tr><td colSpan={7} className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center gap-2 text-slate-400">
                      <CalendarDays size={32} className="text-slate-200" />
                      <span className="text-sm font-medium">대기 중인 연차 신청이 없습니다</span>
                    </div>
                  </td></tr>
                ) : pendingLeaves.map(req => (
                  <React.Fragment key={req.id}>
                    <tr className="hover:bg-slate-50/50 transition-colors cursor-pointer sm:cursor-default" onClick={() => setExpandedId(expandedId === req.id ? null : req.id)}>
                      <td className="px-3 py-3">
                        <div className="flex items-center space-x-1 text-slate-500">
                          <Clock size={12} className="shrink-0" />
                          <span className="text-[10px] font-bold whitespace-nowrap">{new Date(req.requestedAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0"><User size={13} className="text-indigo-600" /></div>
                          <span className="text-[11px] font-black text-slate-800 whitespace-nowrap">{req.employeeName || getEmployeeName(req.employeeId)}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3"><span className="px-2 py-1 rounded-lg text-[10px] font-black bg-indigo-50 text-indigo-600 whitespace-nowrap">{LEAVE_TYPE_LABEL[req.type] ?? req.type}</span></td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1 whitespace-nowrap">
                          <span className="text-[10px] font-bold text-slate-700">{req.startDate}</span>
                          {req.startDate !== req.endDate && (<><ArrowRight size={9} className="text-slate-300" /><span className="text-[10px] font-bold text-slate-700">{req.endDate}</span></>)}
                          <span className="text-[10px] text-slate-400 ml-1">({req.daysUsed}일)</span>
                        </div>
                      </td>
                      <td className="hidden sm:table-cell px-3 py-3"><span className="text-xs text-slate-600 line-clamp-1">{req.reason || '-'}</span></td>
                      <td className="px-3 py-3">{getLeaveStatusBadge(req)}</td>
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1">
                          {req.status === 'cancel_pending' ? (
                            <>
                              <button onClick={() => onUpdateLeaveStatus(req.id, 'approved')} className="px-2 py-1.5 bg-orange-500 text-white rounded-lg text-[10px] font-black hover:bg-orange-600 transition-all shadow-sm whitespace-nowrap">취소승인</button>
                              <button onClick={() => onUpdateLeaveStatus(req.id, 'rejected')} className="px-2 py-1.5 bg-white border border-slate-200 text-slate-400 rounded-lg text-[10px] font-black hover:bg-slate-50 transition-all">반려</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => onUpdateLeaveStatus(req.id, 'approved')} className="px-2 py-1.5 bg-indigo-600 text-white rounded-lg text-[10px] font-black hover:bg-indigo-700 transition-all shadow-sm whitespace-nowrap">승인</button>
                              <button onClick={() => onUpdateLeaveStatus(req.id, 'rejected')} className="px-2 py-1.5 bg-white border border-slate-200 text-slate-400 rounded-lg text-[10px] font-black hover:bg-slate-50 transition-all">반려</button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expandedId === req.id && (
                      <tr className="sm:hidden bg-slate-50/80"><td colSpan={7} className="px-4 py-3">
                        <p className="text-[10px] font-black text-slate-400 uppercase mb-0.5">사유</p>
                        <p className="text-xs text-slate-700 font-medium">{req.reason || '-'}</p>
                        {req.modifyRequest && (
                          <div className="mt-2">
                            <p className="text-[10px] font-black text-purple-400 uppercase mb-0.5">수정 요청 내용</p>
                            <p className="text-xs text-slate-700">{req.modifyRequest.startDate} ~ {req.modifyRequest.endDate} ({req.modifyRequest.daysUsed}일)</p>
                            <p className="text-xs text-slate-500">{req.modifyRequest.reason}</p>
                          </div>
                        )}
                      </td></tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 재고 탭 */}
      {activeTab === 'adjustment' && (
        <div className="bg-white rounded-[32px] border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-100">
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">요청 일시</th>
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">품목명</th>
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">유형</th>
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">변동 내용</th>
                  <th className="hidden sm:table-cell px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">사유</th>
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center whitespace-nowrap">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {pendingAdjustments.length === 0 ? (
                  <tr><td colSpan={6} className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center gap-2 text-slate-400">
                      <Package size={32} className="text-slate-200" />
                      <span className="text-sm font-medium">대기 중인 재고 요청이 없습니다</span>
                    </div>
                  </td></tr>
                ) : pendingAdjustments.map(req => (
                  <React.Fragment key={req.id}>
                    <tr className="hover:bg-slate-50/50 transition-colors cursor-pointer sm:cursor-default" onClick={() => setExpandedId(expandedId === req.id ? null : req.id)}>
                      <td className="px-3 py-3">
                        <div className="flex items-center space-x-1 text-slate-500">
                          <Clock size={12} className="shrink-0" />
                          <span className="text-[10px] font-bold whitespace-nowrap">{new Date(req.requestedAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center space-x-2">
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${req.type === 'chat_mention' ? 'bg-indigo-100 text-indigo-600' : req.type === 'reorder_alert' ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-400'}`}>
                            {req.type === 'chat_mention' ? <AtSign size={14} /> : req.type === 'reorder_alert' ? <ShoppingCart size={14} /> : <Package size={14} />}
                          </div>
                          <span className="text-[11px] font-black text-slate-800 whitespace-nowrap">{req.productName}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3"><span className={`px-2 py-1 rounded-lg text-[10px] font-black whitespace-nowrap ${getAdjTypeClass(req.type)}`}>{getAdjTypeLabel(req.type)}</span></td>
                      <td className="px-3 py-3">
                        {req.type === 'chat_mention' ? (
                          <span className="text-xs font-bold text-slate-400">-</span>
                        ) : req.type === 'reorder_alert' ? (
                          <div className="flex items-center space-x-1 whitespace-nowrap">
                            <span className="text-[10px] font-bold text-slate-400">{req.originalQuantity}{req.unit || '개'}</span>
                            <ArrowRight size={10} className="text-slate-300" />
                            <span className="text-[11px] font-black text-rose-600">부족 {req.requestedQuantity}{req.unit || '개'}</span>
                          </div>
                        ) : (
                          <div className="flex items-center space-x-1 whitespace-nowrap">
                            <span className="text-[10px] font-bold text-slate-400 line-through">{req.originalQuantity}</span>
                            <ArrowRight size={10} className="text-slate-300" />
                            <span className="text-[11px] font-black text-indigo-600">{req.type === 'cancel_receipt' ? 0 : req.requestedQuantity}</span>
                          </div>
                        )}
                      </td>
                      <td className="hidden sm:table-cell px-3 py-3"><span className="text-xs text-slate-600 line-clamp-1">{req.reason || '-'}</span></td>
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => { if (req.type === 'chat_mention' || req.type === 'reorder_alert') { onUpdateAdjustmentStatus(req.id, 'processed'); } else { onProcessAdjustment(req); } }}
                            className={`px-2 py-1.5 text-white rounded-lg text-[10px] font-black transition-all shadow-sm whitespace-nowrap ${req.type === 'reorder_alert' ? 'bg-rose-500 hover:bg-rose-600' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                          >
                            {req.type === 'chat_mention' ? '확인' : req.type === 'reorder_alert' ? '발주완료' : '승인'}
                          </button>
                          <button onClick={() => onUpdateAdjustmentStatus(req.id, 'rejected')} className="px-2 py-1.5 bg-white border border-slate-200 text-slate-400 rounded-lg text-[10px] font-black hover:bg-slate-50 transition-all">반려</button>
                        </div>
                      </td>
                    </tr>
                    {expandedId === req.id && (
                      <tr className="sm:hidden bg-slate-50/80"><td colSpan={6} className="px-4 py-3">
                        <p className="text-[10px] font-black text-slate-400 uppercase mb-0.5">사유</p>
                        <p className="text-xs text-slate-700 font-medium">{req.reason || '-'}</p>
                      </td></tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 반품 탭 */}
      {activeTab === 'return' && (
        <div className="bg-white rounded-[32px] border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-100">
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">요청 일시</th>
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">거래처</th>
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">품목</th>
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right whitespace-nowrap">품목 수</th>
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center whitespace-nowrap">전표</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {pendingReturns.length === 0 ? (
                  <tr><td colSpan={5} className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center gap-2 text-slate-400">
                      <RotateCcw size={32} className="text-slate-200" />
                      <span className="text-sm font-medium">대기 중인 반품 요청이 없습니다</span>
                    </div>
                  </td></tr>
                ) : pendingReturns.map(req => (
                  <tr key={req.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-3 py-3">
                      <div className="flex items-center space-x-1 text-slate-500">
                        <Clock size={12} className="shrink-0" />
                        <span className="text-[10px] font-bold whitespace-nowrap">{new Date(req.createdAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3"><span className="text-[11px] font-black text-slate-800">{req.clientName}</span></td>
                    <td className="px-3 py-3">
                      <div className="space-y-0.5">
                        {req.items.slice(0, 2).map((item, i) => (
                          <div key={i} className="text-[10px] text-slate-600 whitespace-nowrap">{item.name} × {item.quantity}</div>
                        ))}
                        {req.items.length > 2 && <div className="text-[10px] text-slate-400">+{req.items.length - 2}건</div>}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <span className="text-[11px] font-black text-slate-400">{req.items.length}품목</span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-center gap-1">
                        {req.status === 'pending' ? (
                          <button onClick={() => openReturnStmtModal(req)} className="flex items-center gap-1 px-2 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[10px] font-black transition-all shadow-sm whitespace-nowrap">
                            <FileText size={11} /> 반품 전표 발행
                          </button>
                        ) : (
                          <span className="flex items-center gap-1 text-emerald-600 text-[10px] font-black whitespace-nowrap">
                            <Check size={11} /> 전표 발행됨
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 선입고 이력 탭 */}
      {activeTab === 'inbound' && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setInboundFilter('pending_voucher')}
              className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all ${inboundFilter === 'pending_voucher' ? 'bg-rose-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
            >
              전표 미발행 {pendingVoucherCount > 0 && `(${pendingVoucherCount})`}
            </button>
            <button
              onClick={() => setInboundFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all ${inboundFilter === 'all' ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
            >
              전체 이력
            </button>
          </div>

          {filteredReceipts.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-100 p-16 text-center text-slate-400">
              <History size={32} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">{inboundFilter === 'pending_voucher' ? '전표 미발행 선입고가 없습니다' : '선입고 이력이 없습니다'}</p>
              <p className="text-xs mt-1 text-slate-300">입고/반품 메뉴에서 선입고 처리 후 여기서 전표를 발행하세요</p>
            </div>
          ) : filteredReceipts.map(r => (
            <div key={r.id} className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-teal-100 flex items-center justify-center shrink-0">
                    <Building2 size={18} className="text-teal-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-black text-slate-800 text-sm">{r.supplierName}</p>
                    <p className="text-xs text-slate-400">{r.registeredAt.slice(0, 10)} · {r.registeredBy}</p>
                  </div>
                </div>
                <span className={`px-2 py-1 rounded-lg text-[10px] font-black shrink-0 ${r.status === 'voucher_linked' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                  {r.status === 'voucher_linked' ? '✓ 전표 발행됨' : '전표 미발행'}
                </span>
              </div>

              <div className="space-y-1">
                {r.items.map((item, i) => (
                  <div key={i} className="flex justify-between text-xs text-slate-600 bg-slate-50 rounded-lg px-3 py-1.5">
                    <span>{item.name}</span>
                    <span className="font-bold">{item.quantity.toLocaleString()} {item.unit}{item.unitPrice ? ` · ${(item.unitPrice * item.quantity).toLocaleString()}원` : ''}</span>
                  </div>
                ))}
              </div>

              {r.totalAmount !== undefined && r.totalAmount > 0 && (
                <p className="text-xs text-slate-400 pt-1 border-t border-slate-50">
                  합계 <span className="font-black text-slate-700">{r.totalAmount.toLocaleString()}원</span>
                </p>
              )}
              {r.note && (
                <p className="text-xs text-slate-500 bg-amber-50 border border-amber-100 rounded-lg px-3 py-1.5">비고: {r.note}</p>
              )}

              {r.status === 'pending_voucher' && (
                <button
                  onClick={() => openStatementModal(r)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-black transition-all"
                >
                  <FileText size={12} /> 매입 전표 발행
                </button>
              )}
              {r.status === 'voucher_linked' && (
                <p className="flex items-center gap-1 text-xs text-emerald-600">
                  <Link2 size={11} /> 전표 연결됨{r.linkedStatementId ? ` (${r.linkedStatementId.slice(-6)})` : ''}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {totalPending === 0 && activeTab !== 'inbound' && (
        <div className="bg-white rounded-[32px] border border-slate-200 shadow-sm p-12 flex flex-col items-center gap-3 text-slate-400">
          <ClipboardList size={40} className="text-slate-200" />
          <p className="text-sm font-bold">처리할 항목이 없습니다</p>
          <p className="text-xs text-slate-300">신규 연차 신청이나 재고 변동이 발생하면 여기에 표시됩니다.</p>
        </div>
      )}

      {/* 전표 수정 요청 탭 */}
      {activeTab === 'stmtedit' && (
        <div className="bg-white rounded-[32px] border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-100">
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">요청일</th>
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">전표번호</th>
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">구분</th>
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">거래처</th>
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">요청자</th>
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">변경 내용</th>
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center whitespace-nowrap">처리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {pendingStmtEdits.length === 0 ? (
                  <tr><td colSpan={7} className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center gap-2 text-slate-400">
                      <FileText size={32} className="text-slate-200" />
                      <span className="text-sm font-medium">대기 중인 전표 수정 요청이 없습니다</span>
                    </div>
                  </td></tr>
                ) : pendingStmtEdits.map(edit => (
                  <tr key={edit.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-3 py-3 text-[10px] text-slate-500 whitespace-nowrap">
                      {new Date(edit.createdAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}
                    </td>
                    <td className="px-3 py-3 text-[11px] font-bold text-slate-800">{edit.statementDocNo}</td>
                    <td className="px-3 py-3">
                      <span className={`px-2 py-1 rounded-lg text-[10px] font-black whitespace-nowrap ${edit.statementType === '매출' ? 'bg-blue-50 text-blue-600' : 'bg-orange-50 text-orange-600'}`}>
                        {edit.statementType}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-[11px] text-slate-700">{edit.clientName}</td>
                    <td className="px-3 py-3 text-[11px] text-slate-500">{edit.createdBy}</td>
                    <td className="px-3 py-3 text-[10px] text-slate-500">
                      <div className="space-y-0.5">
                        <div>거래일: <span className="font-bold text-slate-700">{edit.proposedData.tradeDate}</span></div>
                        <div>합계: <span className="font-bold text-slate-700">{(edit.proposedData.totalAmount ?? 0).toLocaleString()}원</span></div>
                        <div>품목 {edit.proposedData.items?.length ?? 0}개</div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => onApproveStatementEdit?.(edit)}
                          className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-[10px] font-black transition-colors"
                        >
                          <Check size={11} />승인
                        </button>
                        <button
                          onClick={() => onRejectStatementEdit?.(edit.id)}
                          className="flex items-center gap-1 px-3 py-1.5 bg-rose-100 hover:bg-rose-200 text-rose-600 rounded-lg text-[10px] font-black transition-colors"
                        >
                          <X size={11} />거절
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 발주 예정 탭 */}
      {activeTab === 'order' && (
        <div className="space-y-4">
          {orderGroups.length === 0 ? (
            <div className="bg-white rounded-[32px] border border-slate-200 shadow-sm px-6 py-20 text-center">
              <div className="flex flex-col items-center gap-2 text-slate-400">
                <ShoppingCart size={32} className="text-slate-200" />
                <span className="text-sm font-medium">발주 예정 품목이 없습니다</span>
              </div>
            </div>
          ) : orderGroups.map(group => (
            <div key={group.supplierId} className="bg-white rounded-[32px] border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Building2 size={15} className="text-orange-500" />
                  <span className="font-black text-sm text-slate-800">{group.supplierName}</span>
                  <span className="text-[10px] font-black bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full">{group.items.length}품목</span>
                </div>
                {onCreatePurchaseStatement && (
                  <button
                    onClick={() => onCreatePurchaseStatement({ supplierId: group.supplierId, supplierName: group.supplierName, items: group.items.map(i => ({ name: i.name, spec: i.spec, qty: i.qty, price: i.price, isBox: i.isBox })) })}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-[11px] font-black transition-colors"
                  >
                    <FileText size={12} />매입전표 작성
                  </button>
                )}
              </div>
              <div className="divide-y divide-slate-50">
                {group.items.map(item => (
                  <div key={item.productId} className="px-5 py-3 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-800">{item.name}</p>
                      {item.spec && <p className="text-xs text-slate-400">{item.spec}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-black text-slate-700">
                        {item.isBox ? `${item.qty}BOX` : `${item.qty}${item.spec || ''}`}
                      </p>
                      {item.price > 0 && (
                        <p className="text-xs text-slate-400">{item.price.toLocaleString()}원/{item.spec || '개'}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 반품 전표 발행 모달 */}
      {returnStmtDraft && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end md:items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <p className="font-black text-slate-800">반품 전표 발행</p>
                <p className="text-xs text-slate-400 mt-0.5">{returnStmtDraft.returnReq.clientName} · {returnStmtDraft.returnReq.createdAt.slice(0, 10)} 반품</p>
              </div>
              <button onClick={() => setReturnStmtDraft(null)} className="p-2 text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>

            <div className="overflow-auto flex-1 px-5 py-4 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-black text-slate-500 uppercase tracking-wider">거래처 (매출처) *</label>
                <select
                  value={returnStmtDraft.clientId}
                  onChange={e => setReturnStmtDraft(d => d ? { ...d, clientId: e.target.value } : null)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-rose-400"
                >
                  <option value="">거래처 선택</option>
                  {clients
                    .filter(c => !c.partnerType || c.partnerType === '매출처' || c.partnerType === '매출+매입처')
                    .map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-black text-slate-500 uppercase tracking-wider">거래일자 *</label>
                <input
                  type="date"
                  value={returnStmtDraft.tradeDate}
                  onChange={e => setReturnStmtDraft(d => d ? { ...d, tradeDate: e.target.value } : null)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">품목</label>
                  <button
                    onClick={() => setReturnStmtDraft(d => d ? { ...d, items: [...d.items, { name: '', qty: '', price: '', unit: '', isTaxExempt: false }] } : null)}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-rose-600 border border-rose-200 rounded-lg hover:bg-rose-50"
                  >
                    <Plus size={11} /> 품목 추가
                  </button>
                </div>
                <div className="grid grid-cols-12 gap-1 px-1 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                  <div className="col-span-4">품목명</div>
                  <div className="col-span-2 text-center">수량</div>
                  <div className="col-span-1 text-center">단위</div>
                  <div className="col-span-3 text-center">단가(원)</div>
                  <div className="col-span-1 text-center">세금</div>
                  <div className="col-span-1" />
                </div>
                {returnStmtDraft.items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-1 items-center bg-slate-50 rounded-xl p-2">
                    <div className="col-span-4">
                      <input value={item.name} onChange={e => setReturnStmtDraft(d => d ? { ...d, items: d.items.map((it, i) => i === idx ? { ...it, name: e.target.value } : it) } : null)}
                        placeholder="품목명" className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-rose-400" />
                    </div>
                    <div className="col-span-2">
                      <input type="number" min={0} value={item.qty} onChange={e => setReturnStmtDraft(d => d ? { ...d, items: d.items.map((it, i) => i === idx ? { ...it, qty: e.target.value } : it) } : null)}
                        placeholder="0" className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs text-center focus:outline-none focus:ring-1 focus:ring-rose-400" />
                    </div>
                    <div className="col-span-1">
                      <input value={item.unit} onChange={e => setReturnStmtDraft(d => d ? { ...d, items: d.items.map((it, i) => i === idx ? { ...it, unit: e.target.value } : it) } : null)}
                        placeholder="개" className="w-full px-1 py-1.5 border border-slate-200 rounded-lg text-xs text-center focus:outline-none focus:ring-1 focus:ring-rose-400" />
                    </div>
                    <div className="col-span-3">
                      <input type="number" min={0} value={item.price} onChange={e => setReturnStmtDraft(d => d ? { ...d, items: d.items.map((it, i) => i === idx ? { ...it, price: e.target.value } : it) } : null)}
                        placeholder="0" className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs text-right focus:outline-none focus:ring-1 focus:ring-rose-400" />
                    </div>
                    <div className="col-span-1 flex justify-center">
                      <button onClick={() => setReturnStmtDraft(d => d ? { ...d, items: d.items.map((it, i) => i === idx ? { ...it, isTaxExempt: !it.isTaxExempt } : it) } : null)}
                        className={`px-1 py-1 rounded text-[10px] font-black transition-colors ${item.isTaxExempt ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-400'}`}>
                        {item.isTaxExempt ? '면세' : '과세'}
                      </button>
                    </div>
                    <div className="col-span-1 flex justify-center">
                      <button onClick={() => setReturnStmtDraft(d => d ? { ...d, items: d.items.filter((_, i) => i !== idx) } : null)} className="p-1 text-slate-300 hover:text-rose-500">
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {(() => {
                const supply = returnStmtDraft.items.reduce((s, i) => s + Number(i.qty || 0) * Number(i.price || 0), 0);
                const tax = returnStmtDraft.items.reduce((s, i) => {
                  const amt = Number(i.qty || 0) * Number(i.price || 0);
                  return s + (i.isTaxExempt ? 0 : Math.round(amt * 0.1));
                }, 0);
                return (
                  <div className="bg-rose-50 rounded-xl px-4 py-3 space-y-1">
                    <div className="flex justify-between text-xs text-slate-500"><span>공급가액</span><span className="font-bold">{supply.toLocaleString()}원</span></div>
                    <div className="flex justify-between text-xs text-slate-500"><span>세액</span><span className="font-bold">{tax.toLocaleString()}원</span></div>
                    <div className="flex justify-between text-sm font-black text-slate-800 border-t border-rose-200 pt-1"><span>합계</span><span>{(supply + tax).toLocaleString()}원</span></div>
                  </div>
                );
              })()}
            </div>

            <div className="px-5 py-4 border-t border-slate-100">
              <button
                onClick={saveReturnStatement}
                disabled={returnStmtSaving || !returnStmtDraft.clientId}
                className="w-full flex items-center justify-center gap-2 py-3 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white rounded-xl font-black text-sm transition-all"
              >
                {returnStmtSaving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                {returnStmtSaving ? '발행 중...' : '반품 전표 발행'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 전표 발행 모달 */}
      {statementDraft && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end md:items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <p className="font-black text-slate-800">매입 전표 발행</p>
                <p className="text-xs text-slate-400 mt-0.5">{statementDraft.receipt.supplierName} · {statementDraft.receipt.registeredAt.slice(0, 10)} 선입고</p>
              </div>
              <button onClick={() => setStatementDraft(null)} className="p-2 text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>

            <div className="overflow-auto flex-1 px-5 py-4 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-black text-slate-500 uppercase tracking-wider">거래처 (매입처) *</label>
                <select
                  value={statementDraft.clientId}
                  onChange={e => setStatementDraft(d => d ? { ...d, clientId: e.target.value } : null)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-rose-400"
                >
                  <option value="">거래처 선택</option>
                  {clients
                    .filter(c => c.partnerType === '매입처' || c.partnerType === '매출+매입처' || !c.partnerType)
                    .map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-black text-slate-500 uppercase tracking-wider">거래일자 *</label>
                <input
                  type="date"
                  value={statementDraft.tradeDate}
                  onChange={e => setStatementDraft(d => d ? { ...d, tradeDate: e.target.value } : null)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">품목</label>
                  <button
                    onClick={() => setStatementDraft(d => d ? { ...d, items: [...d.items, { name: '', qty: '', price: '', unit: '', isTaxExempt: false }] } : null)}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-rose-600 border border-rose-200 rounded-lg hover:bg-rose-50"
                  >
                    <Plus size={11} /> 품목 추가
                  </button>
                </div>
                <div className="grid grid-cols-12 gap-1 px-1 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                  <div className="col-span-4">품목명</div>
                  <div className="col-span-2 text-center">수량</div>
                  <div className="col-span-1 text-center">단위</div>
                  <div className="col-span-3 text-center">단가(원)</div>
                  <div className="col-span-1 text-center">세금</div>
                  <div className="col-span-1" />
                </div>
                {statementDraft.items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-1 items-center bg-slate-50 rounded-xl p-2">
                    <div className="col-span-4">
                      <input value={item.name} onChange={e => setStatementDraft(d => d ? { ...d, items: d.items.map((it, i) => i === idx ? { ...it, name: e.target.value } : it) } : null)}
                        placeholder="품목명" className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-rose-400" />
                    </div>
                    <div className="col-span-2">
                      <input type="number" min={0} value={item.qty} onChange={e => setStatementDraft(d => d ? { ...d, items: d.items.map((it, i) => i === idx ? { ...it, qty: e.target.value } : it) } : null)}
                        placeholder="0" className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs text-center focus:outline-none focus:ring-1 focus:ring-rose-400" />
                    </div>
                    <div className="col-span-1">
                      <input value={item.unit} onChange={e => setStatementDraft(d => d ? { ...d, items: d.items.map((it, i) => i === idx ? { ...it, unit: e.target.value } : it) } : null)}
                        placeholder="개" className="w-full px-1 py-1.5 border border-slate-200 rounded-lg text-xs text-center focus:outline-none focus:ring-1 focus:ring-rose-400" />
                    </div>
                    <div className="col-span-3">
                      <input type="number" min={0} value={item.price} onChange={e => setStatementDraft(d => d ? { ...d, items: d.items.map((it, i) => i === idx ? { ...it, price: e.target.value } : it) } : null)}
                        placeholder="0" className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs text-right focus:outline-none focus:ring-1 focus:ring-rose-400" />
                    </div>
                    <div className="col-span-1 flex justify-center">
                      <button onClick={() => setStatementDraft(d => d ? { ...d, items: d.items.map((it, i) => i === idx ? { ...it, isTaxExempt: !it.isTaxExempt } : it) } : null)}
                        className={`px-1 py-1 rounded text-[10px] font-black transition-colors ${item.isTaxExempt ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-400'}`}>
                        {item.isTaxExempt ? '면세' : '과세'}
                      </button>
                    </div>
                    <div className="col-span-1 flex justify-center">
                      <button onClick={() => setStatementDraft(d => d ? { ...d, items: d.items.filter((_, i) => i !== idx) } : null)} className="p-1 text-slate-300 hover:text-rose-500">
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {(() => {
                const supply = statementDraft.items.reduce((s, i) => s + Number(i.qty || 0) * Number(i.price || 0), 0);
                const tax = statementDraft.items.reduce((s, i) => {
                  const amt = Number(i.qty || 0) * Number(i.price || 0);
                  return s + (i.isTaxExempt ? 0 : Math.round(amt * 0.1));
                }, 0);
                return (
                  <div className="bg-rose-50 rounded-xl px-4 py-3 space-y-1">
                    <div className="flex justify-between text-xs text-slate-500"><span>공급가액</span><span className="font-bold">{supply.toLocaleString()}원</span></div>
                    <div className="flex justify-between text-xs text-slate-500"><span>세액</span><span className="font-bold">{tax.toLocaleString()}원</span></div>
                    <div className="flex justify-between text-sm font-black text-slate-800 border-t border-rose-200 pt-1"><span>합계</span><span>{(supply + tax).toLocaleString()}원</span></div>
                  </div>
                );
              })()}
            </div>

            <div className="px-5 py-4 border-t border-slate-100">
              <button
                onClick={saveStatement}
                disabled={statementSaving || !statementDraft.clientId}
                className="w-full flex items-center justify-center gap-2 py-3 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white rounded-xl font-black text-sm transition-all"
              >
                {statementSaving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                {statementSaving ? '발행 중...' : '매입 전표 발행'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminChecklist;
