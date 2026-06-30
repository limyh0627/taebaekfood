
import React, { useMemo, useState } from 'react';
import {
  Clock, AlertCircle, Package, ArrowRight,
  CalendarDays, User, ShoppingCart, AtSign,
  ClipboardList, RotateCcw, Building2, FileText, History, Link2,
  X, Loader2, Check, Plus,
} from 'lucide-react';
import { LeaveRequest, AdjustmentRequest, Employee, ReturnRequest, ReturnItem, IssuedStatement, IssuedStatementItem, Partner, PendingStatementEdit, Item, PartnerItem, PurchaseOrder, PurchaseOrderItem, poLines } from '../src/shared/types';
import { addItem, updateItem } from '../src/shared/services/firebaseService';
import PageHeader from './PageHeader';

interface AdminChecklistProps {
  leaveRequests: LeaveRequest[];
  adjustmentRequests: AdjustmentRequest[];
  employees: Employee[];
  returnRequests?: ReturnRequest[];
  receivedOrders?: PurchaseOrder[];
  partners?: Partner[];
  issuedStatements?: IssuedStatement[];
  onUpdateLeaveStatus: (_id: string, _status: 'approved' | 'rejected') => void;
  onUpdateAdjustmentStatus: (_id: string, _status: 'processed' | 'rejected') => void;
  onDeleteAdjustmentRequest?: (_id: string) => void;
  onProcessAdjustment: (_req: AdjustmentRequest) => void;
  pendingStatementEdits?: PendingStatementEdit[];
  onApproveStatementEdit?: (_edit: PendingStatementEdit) => void;
  onRejectStatementEdit?: (_id: string) => void;
  orderRequests?: PurchaseOrder[];
  items?: Item[];
  partnerItems?: PartnerItem[];
  onCreatePurchaseStatement?: (_data: { partnerId: string; partnerName: string; items: Array<{ name: string; spec: string; qty: number; price: number; isBox?: boolean }>; poIds?: string[] }) => void;
}

type TabType = 'leave' | 'adjustment' | 'ops';

interface StatementDraftItem { name: string; qty: string; price: string; unit: string; isTaxExempt: boolean; }
interface ReturnStatementDraft {
  returnReq: ReturnRequest;
  partnerId: string;
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
  receivedOrders = [],
  partners = [],
  issuedStatements = [],
  onUpdateLeaveStatus,
  onUpdateAdjustmentStatus,
  onDeleteAdjustmentRequest,
  onProcessAdjustment,
  pendingStatementEdits = [],
  onApproveStatementEdit,
  onRejectStatementEdit,
  orderRequests = [],
  items = [],
  partnerItems = [],
  onCreatePurchaseStatement,
}) => {
  // Compute derived variables
  const partnerIn = (partnerItems ?? []).filter((pi: any) => pi.Direction === 'in');
  const [activeTab, setActiveTab] = useState<TabType>('ops'); // 기본: 거래명세서(전표/입고) 탭
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // 기본: 전표 미발행만 — 발행 완료된 선입고는 숨겨 목록이 끝없이 길어지지 않게. '전체'로 토글 가능.
  const [inboundFilter, setInboundFilter] = useState<'pending_voucher' | 'all'>('pending_voucher');

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
  const pendingVoucherCount = receivedOrders.filter(r => !r.linkedStatementId).length;
  const filteredReceipts = useMemo(() => {
    const list = inboundFilter === 'pending_voucher'
      ? receivedOrders.filter(r => !r.linkedStatementId)
      : receivedOrders;
    return [...list].sort((a, b) => (b.receivedAt ?? '').localeCompare(a.receivedAt ?? ''));
  }, [receivedOrders, inboundFilter]);

  const pendingStmtEdits = useMemo(() =>
    pendingStatementEdits.filter(e => e.status === 'pending')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [pendingStatementEdits]
  );
  const totalPending = pendingLeaves.length + pendingAdjustments.length + pendingReturns.length + pendingStmtEdits.length;

  // 발주 예정 거래처별 묶음: 같은 partnerId는 한 묶음, 미지정은 PO별 별도 묶음
  const orderGroups = useMemo(() => {
    const map = new Map<string, { key: string; partnerId: string; partnerName: string; pos: PurchaseOrder[]; lines: PurchaseOrderItem[] }>();
    for (const po of orderRequests) {
      // PO에 partnerId 저장돼있으면 우선 사용, 없으면 첫 라인 partner_item에서 추정
      let resolvedPartnerId: string | undefined = po.partnerId;
      let resolvedPartnerName: string | undefined = po.partnerName;
      const lines = poLines(po);
      if (!resolvedPartnerId && lines[0]) {
        const ps = partnerItems.find(s => (s.Item_ID === lines[0].itemId || s.itemId === lines[0].itemId) && s.Direction === 'in');
        resolvedPartnerId = ps?.Partner_ID ?? ps?.partnerId;
        if (resolvedPartnerId && !resolvedPartnerName) {
          resolvedPartnerName = partners.find(c => c.id === resolvedPartnerId)?.name ?? resolvedPartnerId;
        }
      }
      // 미지정이면 PO별로 고유키 → 별도 행, 지정이면 partnerId로 묶음
      const groupKey = resolvedPartnerId ?? `unknown__${po.id}`;
      const partnerName = resolvedPartnerName ?? '미지정';
      if (!map.has(groupKey)) {
        map.set(groupKey, { key: groupKey, partnerId: resolvedPartnerId ?? '', partnerName, pos: [], lines: [] });
      }
      const g = map.get(groupKey)!;
      g.pos.push(po);
      g.lines.push(...lines);
    }
    return Array.from(map.values());
  }, [orderRequests, partnerItems, partners]);

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
    const matchedClient = partners.find(c => c.id === req.partnerId);
    setReturnStmtDraft({
      returnReq: req,
      partnerId: matchedClient?.id ?? '',
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
    const partner = partners.find(c => c.id === returnStmtDraft.partnerId);
    if (!partner) { alert('거래처를 선택해주세요.'); return; }
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
        partnerId: partner.id,
        partnerName: partner.name,
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

  // 선입고/발주 → 매입전표 발행: TradeStatement 작성 화면으로 라우팅.
  // 발행(원가/매입단가 동기화 포함)은 TradeStatement 한 곳에서만 처리하고,
  // poIds를 함께 넘겨 발행 시 해당 PO들이 전표에 연결(linkedStatementId)되고 입고대기로 전환됨.
  const issueStatementForPos = (pos: PurchaseOrder[], partnerId: string, partnerName: string) => {
    if (pos.length === 0 || !onCreatePurchaseStatement) return;
    const matchedClient = partners.find(c =>
      c.id === partnerId || c.name === partnerName ||
      (partnerName && (c.name.includes(partnerName) || partnerName.includes(c.name)))
    );
    const invoiceItems = pos.flatMap(po => poLines(po)).map(line => {
      const pi = partnerItems.find(p => (p.Item_ID ?? (p as any).itemId) === line.itemId && p.Direction === 'in');
      const item = items.find(it => it.id === line.itemId);
      return {
        name: line.name || item?.name || '',
        spec: line.unit || item?.unit || '',
        qty: line.quantity,
        price: Number(pi?.price ?? pi?.Standard_Price ?? 0),
        isBox: false,
      };
    });
    onCreatePurchaseStatement({
      partnerId: matchedClient?.id ?? partnerId,
      partnerName: matchedClient?.name ?? partnerName,
      items: invoiceItems,
      poIds: pos.map(p => p.id),
    });
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
          onClick={() => setActiveTab('ops')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${activeTab === 'ops' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'}`}
        >
          <ClipboardList size={15} />거래명세서
          {(pendingReturns.length + pendingVoucherCount + pendingStmtEdits.length + orderRequests.length) > 0 && (
            <span className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-black flex items-center justify-center ${activeTab === 'ops' ? 'bg-white/30 text-white' : 'bg-amber-100 text-amber-700'}`}>
              {pendingReturns.length + pendingVoucherCount + pendingStmtEdits.length + orderRequests.length}
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
      </div>

      {/* 연차 신청 탭 */}
      {activeTab === 'leave' && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
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
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
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
                          <span className={`text-[11px] font-black whitespace-nowrap ${req.itemName ? 'text-slate-800' : 'text-slate-400 italic'}`}>{req.itemName || items.find(i => i.id === req.itemId)?.name || '(품목명 없음)'}</span>
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
                          {onDeleteAdjustmentRequest && <button onClick={() => onDeleteAdjustmentRequest(req.id)} className="px-2 py-1.5 bg-white border border-rose-200 text-rose-400 rounded-lg text-[10px] font-black hover:bg-rose-50 transition-all">삭제</button>}
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

      {/* 입고/반품/발주 통합 탭 */}
      {activeTab === 'ops' && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-100">
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">타입</th>
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">날짜</th>
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">거래처</th>
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">내용</th>
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap text-right">수</th>
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center whitespace-nowrap">처리</th>
                </tr>
              </thead>
              <tbody>
                {/* ── 반품 그룹 ── */}
                <tr><td colSpan={6} className="px-4 py-2 bg-rose-50 border-y border-rose-100">
                  <span className="flex items-center gap-1.5 text-[10px] font-black text-rose-600 uppercase tracking-widest">
                    <RotateCcw size={11} /> 반품 {pendingReturns.length > 0 ? `(${pendingReturns.length}건)` : ''}
                  </span>
                </td></tr>
                {pendingReturns.length === 0 ? (
                  <tr><td colSpan={6} className="px-6 py-5 text-center text-xs text-slate-300">반품 요청 없음</td></tr>
                ) : pendingReturns.map(req => (
                  <tr key={req.id} className="hover:bg-slate-50/50 transition-colors border-b border-slate-50">
                    <td className="px-3 py-3"><span className="px-2 py-1 rounded-lg text-[10px] font-black bg-rose-50 text-rose-600 whitespace-nowrap">반품</span></td>
                    <td className="px-3 py-3"><div className="flex items-center space-x-1 text-slate-500"><Clock size={12} className="shrink-0" /><span className="text-[10px] font-bold whitespace-nowrap">{new Date(req.createdAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}</span></div></td>
                    <td className="px-3 py-3"><span className="text-[11px] font-black text-slate-800">{req.partnerName}</span></td>
                    <td className="px-3 py-3">
                      <div className="space-y-0.5">
                        {req.items.slice(0, 2).map((item, i) => (<div key={i} className="text-[10px] text-slate-600 whitespace-nowrap">{item.name} × {item.quantity}</div>))}
                        {req.items.length > 2 && <div className="text-[10px] text-slate-400">+{req.items.length - 2}건</div>}
                        {req.note && <div className="text-[10px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1 mt-1">{req.note}</div>}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right"><span className="text-[11px] font-black text-slate-400">{req.items.length}품목</span></td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-center">
                        {req.status === 'pending' ? (
                          <button onClick={() => openReturnStmtModal(req)} className="flex items-center gap-1 px-2 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[10px] font-black transition-all shadow-sm whitespace-nowrap"><FileText size={11} /> 반품 전표 발행</button>
                        ) : (
                          <span className="flex items-center gap-1 text-emerald-600 text-[10px] font-black whitespace-nowrap"><Check size={11} /> 전표 발행됨</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}

                {/* ── 선입고 이력 그룹 ── */}
                <tr><td colSpan={6} className="px-4 py-2 bg-teal-50 border-y border-teal-100">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="flex items-center gap-1.5 text-[10px] font-black text-teal-600 uppercase tracking-widest">
                      <History size={11} /> 선입고 이력 {inboundFilter === 'pending_voucher' ? `(전표 미발행 ${pendingVoucherCount}건)` : `(전체 ${filteredReceipts.length}건)`}
                    </span>
                    <div className="flex items-center gap-0.5 bg-white rounded-lg p-0.5 border border-teal-100">
                      <button onClick={() => setInboundFilter('pending_voucher')} className={`px-2 py-1 rounded-md text-[10px] font-black transition-colors ${inboundFilter === 'pending_voucher' ? 'bg-teal-600 text-white' : 'text-teal-600 hover:bg-teal-50'}`}>전표 미발행만</button>
                      <button onClick={() => setInboundFilter('all')} className={`px-2 py-1 rounded-md text-[10px] font-black transition-colors ${inboundFilter === 'all' ? 'bg-teal-600 text-white' : 'text-teal-600 hover:bg-teal-50'}`}>전체</button>
                    </div>
                  </div>
                </td></tr>
                {filteredReceipts.length === 0 ? (
                  <tr><td colSpan={6} className="px-6 py-5 text-center text-xs text-slate-300">선입고 이력 없음</td></tr>
                ) : filteredReceipts.map(r => (
                  <tr key={r.id} className="hover:bg-slate-50/50 transition-colors border-b border-slate-50">
                    <td className="px-3 py-3"><span className={`px-2 py-1 rounded-lg text-[10px] font-black whitespace-nowrap ${r.linkedStatementId ? 'bg-emerald-50 text-emerald-600' : 'bg-teal-50 text-teal-600'}`}>{r.linkedStatementId ? '선입고✓' : '선입고'}</span></td>
                    <td className="px-3 py-3"><div className="flex items-center space-x-1 text-slate-500"><Clock size={12} className="shrink-0" /><span className="text-[10px] font-bold whitespace-nowrap">{(r.receivedAt ?? '').slice(5, 10).replace('-', '.')}</span></div></td>
                    <td className="px-3 py-3"><span className="text-[11px] font-black text-slate-800">{r.partnerName}</span></td>
                    <td className="px-3 py-3">
                      <div className="space-y-0.5">
                        {(r.items ?? []).slice(0, 2).map((item, i) => (<div key={i} className="text-[10px] text-slate-600 whitespace-nowrap">{item.name} × {item.quantity.toLocaleString()} {item.unit}</div>))}
                        {(r.items ?? []).length > 2 && <div className="text-[10px] text-slate-400">+{(r.items ?? []).length - 2}건</div>}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right"><span className="text-[11px] font-black text-slate-400">{(r.items ?? []).length}품목</span></td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-center">
                        {!r.linkedStatementId ? (
                          <button onClick={() => issueStatementForPos([r], r.partnerId ?? '', r.partnerName ?? '')} className="flex items-center gap-1 px-2 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[10px] font-black transition-all shadow-sm whitespace-nowrap"><FileText size={11} /> 매입전표 발행</button>
                        ) : (
                          <span className="flex items-center gap-1 text-emerald-600 text-[10px] font-black whitespace-nowrap"><Check size={11} /> 전표 발행됨</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}

                {/* ── 전표 수정 그룹 ── */}
                <tr><td colSpan={6} className="px-4 py-2 bg-violet-50 border-y border-violet-100">
                  <span className="flex items-center gap-1.5 text-[10px] font-black text-violet-600 uppercase tracking-widest">
                    <FileText size={11} /> 전표 수정 {pendingStmtEdits.length > 0 ? `(${pendingStmtEdits.length}건)` : ''}
                  </span>
                </td></tr>
                {pendingStmtEdits.length === 0 ? (
                  <tr><td colSpan={6} className="px-6 py-5 text-center text-xs text-slate-300">전표 수정 요청 없음</td></tr>
                ) : pendingStmtEdits.map(edit => (
                  <tr key={edit.id} className="hover:bg-slate-50/50 transition-colors border-b border-slate-50">
                    <td className="px-3 py-3"><span className="px-2 py-1 rounded-lg text-[10px] font-black bg-violet-50 text-violet-600 whitespace-nowrap">전표수정</span></td>
                    <td className="px-3 py-3"><div className="flex items-center space-x-1 text-slate-500"><Clock size={12} className="shrink-0" /><span className="text-[10px] font-bold whitespace-nowrap">{new Date(edit.createdAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}</span></div></td>
                    <td className="px-3 py-3"><span className="text-[11px] font-black text-slate-800">{edit.partnerName}</span></td>
                    <td className="px-3 py-3">
                      <div className="space-y-1 text-[10px] text-slate-600">
                        <div>{edit.statementDocNo} <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${edit.statementType === '매출' ? 'bg-blue-50 text-blue-600' : 'bg-orange-50 text-orange-600'}`}>{edit.statementType}</span></div>
                        <div>거래일: {edit.proposedData.tradeDate} · 합계: {(edit.proposedData.totalAmount ?? 0).toLocaleString()}원 · by {edit.createdBy}</div>
                        {edit.changes && edit.changes.length > 0 && (
                          <div className="flex flex-col gap-0.5 mt-1">
                            {edit.changes.map((c, i) => (
                              <div key={i} className="flex items-center gap-1 text-[10px]">
                                <span className="font-bold text-slate-700">{c.name}</span>
                                <span className="text-slate-400 font-black">{c.oldQty}</span>
                                <span className="text-slate-300">→</span>
                                {c.newQty <= 0
                                  ? <span className="px-1 py-0.5 rounded bg-rose-50 text-rose-600 font-black">삭제</span>
                                  : <span className="px-1 py-0.5 rounded bg-emerald-50 text-emerald-700 font-black">{c.newQty}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                        {edit.reason && <div className="text-[10px] text-amber-600 font-bold">사유: {edit.reason}</div>}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right"><span className="text-[11px] font-black text-slate-400">{edit.proposedData.items?.length ?? 0}품목</span></td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => onApproveStatementEdit?.(edit)} className="flex items-center gap-1 px-2 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-[10px] font-black transition-colors whitespace-nowrap"><Check size={10} />승인</button>
                        <button onClick={() => onRejectStatementEdit?.(edit.id)} className="flex items-center gap-1 px-2 py-1.5 bg-rose-100 hover:bg-rose-200 text-rose-600 rounded-lg text-[10px] font-black transition-colors whitespace-nowrap"><X size={10} />거절</button>
                      </div>
                    </td>
                  </tr>
                ))}

                {/* ── 발주 예정 그룹 ── */}
                <tr><td colSpan={6} className="px-4 py-2 bg-orange-50 border-y border-orange-100">
                  <span className="flex items-center gap-1.5 text-[10px] font-black text-orange-600 uppercase tracking-widest">
                    <ShoppingCart size={11} /> 발주 예정 {orderRequests.length > 0 ? `(${orderRequests.length}건)` : ''}
                  </span>
                </td></tr>
                {orderGroups.length === 0 ? (
                  <tr><td colSpan={6} className="px-6 py-5 text-center text-xs text-slate-300">발주 예정 품목 없음</td></tr>
                ) : orderGroups.map(group => {
                  // 그룹 대표일자: 묶인 PO 중 가장 빠른 createdAt
                  const repDate = [...group.pos]
                    .map(p => p.createdAt ?? '')
                    .sort()[0] ?? '';
                  const isUnknown = !group.partnerId;
                  return (
                    <tr key={group.key} className="hover:bg-slate-50/50 transition-colors border-b border-slate-50">
                      <td className="px-3 py-3">
                        <span className={`px-2 py-1 rounded-lg text-[10px] font-black whitespace-nowrap ${isUnknown ? 'bg-slate-50 text-slate-500' : 'bg-orange-50 text-orange-600'}`}>
                          {isUnknown ? '미지정' : '발주예정'}
                        </span>
                      </td>
                      <td className="px-3 py-3"><div className="flex items-center space-x-1 text-slate-500"><Clock size={12} className="shrink-0" /><span className="text-[10px] font-bold whitespace-nowrap">{repDate.slice(5, 10).replace('-', '.')}</span></div></td>
                      <td className="px-3 py-3">
                        <span className={`text-[11px] font-black ${isUnknown ? 'text-slate-400' : 'text-slate-800'}`}>{group.partnerName}</span>
                        {!isUnknown && group.pos.length > 1 && (
                          <span className="ml-1.5 text-[9px] font-black bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded">묶음 {group.pos.length}건</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="space-y-0.5">
                          {group.lines.slice(0, 2).map((line, i) => (<div key={i} className="text-[10px] text-slate-600 whitespace-nowrap">{line.name} × {line.quantity.toLocaleString()} {line.unit}</div>))}
                          {group.lines.length > 2 && <div className="text-[10px] text-slate-400">+{group.lines.length - 2}건</div>}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right"><span className="text-[11px] font-black text-slate-400">{group.lines.length}품목</span></td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-center">
                          <button
                            onClick={() => issueStatementForPos(group.pos, group.partnerId, group.partnerName)}
                            className="flex items-center gap-1 px-2 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-[10px] font-black transition-all shadow-sm whitespace-nowrap">
                            <FileText size={11} /> 매입전표 작성
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 반품 전표 발행 모달 */}
      {returnStmtDraft && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end md:items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <p className="font-black text-slate-800">반품 전표 발행</p>
                <p className="text-xs text-slate-400 mt-0.5">{returnStmtDraft.returnReq.partnerName} · {returnStmtDraft.returnReq.createdAt.slice(0, 10)} 반품</p>
              </div>
              <button onClick={() => setReturnStmtDraft(null)} className="p-2 text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>

            <div className="overflow-auto flex-1 px-5 py-4 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-black text-slate-500 uppercase tracking-wider">거래처 (매출처) *</label>
                <select
                  value={returnStmtDraft.partnerId}
                  onChange={e => setReturnStmtDraft(d => d ? { ...d, partnerId: e.target.value } : null)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-rose-400"
                >
                  <option value="">거래처 선택</option>
                  {partners
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
                disabled={returnStmtSaving || !returnStmtDraft.partnerId}
                className="w-full flex items-center justify-center gap-2 py-3 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white rounded-xl font-black text-sm transition-all"
              >
                {returnStmtSaving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                {returnStmtSaving ? '발행 중...' : '반품 전표 발행'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default AdminChecklist;
