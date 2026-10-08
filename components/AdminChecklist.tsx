
import { appConfirm } from '../src/shared/components/appDialog';
import React, { useMemo, useState, useRef } from 'react';
import {
  Clock, AlertCircle, Package, ArrowRight,
  CalendarDays, User, ShoppingCart, AtSign,
  ClipboardList, RotateCcw, Building2, FileText, History, Link2,
  X, Check,
} from 'lucide-react';
import { LeaveRequest, LeaveStatus, AdjustmentRequest, Employee, ReturnRequest, IssuedStatement, Partner, PendingStatementEdit, Item, PartnerItem, PurchaseOrder, PurchaseOrderItem, poLines } from '../src/shared/types';
import PageHeader from './PageHeader';
import { dateOfLocal } from '../src/shared/day';
import { adjTypeLabel, adjTypeClass } from '../src/shared/adjustmentStyle';

interface AdminChecklistProps {
  leaveRequests: LeaveRequest[];
  adjustmentRequests: AdjustmentRequest[];
  employees: Employee[];
  returnRequests?: ReturnRequest[];
  onProcessReturn?: (request: ReturnRequest) => Promise<void>;
  receivedOrders?: PurchaseOrder[];
  partners?: Partner[];
  issuedStatements?: IssuedStatement[];
  onUpdateLeaveStatus: (_id: string, _status: LeaveStatus, _reason?: string) => void;
  onUpdateAdjustmentStatus: (_id: string, _status: 'processed' | 'rejected') => void;
  onDeleteAdjustmentRequest?: (_id: string) => void;
  onProcessAdjustment: (_req: AdjustmentRequest) => void;
  pendingStatementEdits?: PendingStatementEdit[];
  onApproveStatementEdit?: (_edit: PendingStatementEdit) => void | Promise<void>;
  onRejectStatementEdit?: (_id: string) => void;
  orderRequests?: PurchaseOrder[];
  items?: Item[];
  partnerItems?: PartnerItem[];
  onCreatePurchaseStatement?: (_data: { partnerId: string; partnerName: string; items: Array<{ itemId: string; name: string; spec: string; qty: number; price: number; isBox?: boolean }>; poIds?: string[] }) => void;
}

type TabType = 'leave' | 'adjustment' | 'ops';

const LEAVE_TYPE_LABEL: Record<string, string> = {
  '연차': '연차', '오전반차': '오전반차', '오후반차': '오후반차',
  '병가': '병가', '경조사': '경조사', '기타': '기타',
};

const AdminChecklist: React.FC<AdminChecklistProps> = ({
  leaveRequests,
  adjustmentRequests,
  employees,
  returnRequests = [],
  onProcessReturn,
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

  const approvingEditIds = useRef(new Set<string>());
  const [approvingEdits, setApprovingEdits] = useState<Set<string>>(new Set());
  const [editApprovalErrors, setEditApprovalErrors] = useState<Record<string,string>>({});
  const approveStatementEdit = async (edit: PendingStatementEdit) => {
    if (!onApproveStatementEdit || approvingEditIds.current.has(edit.id)) return;
    approvingEditIds.current.add(edit.id);
    setApprovingEdits(new Set(approvingEditIds.current));
    setEditApprovalErrors(errors => ({...errors,[edit.id]:''}));
    try { await onApproveStatementEdit(edit); }
    catch (error) { setEditApprovalErrors(errors => ({...errors,[edit.id]:error instanceof Error ? error.message : '전표 수정 승인에 실패했습니다.'})); }
    finally { approvingEditIds.current.delete(edit.id);setApprovingEdits(new Set(approvingEditIds.current)); }
  };

  const returnBusy = useRef(false);
  const [processingReturnId, setProcessingReturnId] = useState<string | null>(null);

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
  // OEM 배치는 선입고 매입전표에서 제외 — 품목 매입이 아니라 가공비라 별도(oem_fee 확인사항)로 발행한다.
  const purchaseReceipts = useMemo(() => receivedOrders.filter(r => r.poType !== 'oem'), [receivedOrders]);
  const pendingVoucherCount = purchaseReceipts.filter(r => !r.linkedStatementId).length;
  const filteredReceipts = useMemo(() => {
    const list = inboundFilter === 'pending_voucher'
      ? purchaseReceipts.filter(r => !r.linkedStatementId)
      : purchaseReceipts;
    return [...list].sort((a, b) => (b.receivedAt ?? '').localeCompare(a.receivedAt ?? ''));
  }, [purchaseReceipts, inboundFilter]);

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
        const ps = partnerItems.find(s => (s.itemId === lines[0].itemId || s.itemId === lines[0].itemId) && s.Direction === 'in');
        resolvedPartnerId = ps?.partnerId ?? ps?.partnerId;
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

  //  이름·색은 [shared/adjustmentStyle](../src/shared/adjustmentStyle.ts) 한 곳이 정한다
  const getAdjTypeLabel = adjTypeLabel;
  const getAdjTypeClass = adjTypeClass;
  const getLeaveStatusBadge = (req: LeaveRequest) => {
    if (req.status === 'cancel_pending')
      return <span className="flex items-center gap-1 text-orange-500 font-black text-[10px]"><Clock size={11} />취소 요청</span>;
    if (req.modifyRequest?.status === 'pending')
      return <span className="flex items-center gap-1 text-purple-500 font-black text-[10px]"><Clock size={11} />수정 요청</span>;
    return <span className="flex items-center gap-1 text-amber-500 font-black text-[10px]"><Clock size={11} />승인 대기</span>;
  };
  const getEmployeeName = (empId: string) => employees.find(e => e.id === empId)?.name ?? empId;

  const processReturnRequest = async (request: ReturnRequest) => {
    if (!onProcessReturn || returnBusy.current) return;
    returnBusy.current = true;
    setProcessingReturnId(request.id);
    try {
      if (!await appConfirm('반품 역분개·재고·비현금 상계를 함께 확정하시겠습니까?')) return;
      await onProcessReturn(request);
    } catch (error) { alert(error instanceof Error ? error.message : '반품 처리를 완료하지 못했습니다.'); }
    finally { returnBusy.current = false; setProcessingReturnId(null); }
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
      const pi = partnerItems.find(p => p.itemId === line.itemId && p.partnerId === partnerId && p.Direction === 'in');
      const item = items.find(it => it.id === line.itemId);
      return {
        itemId: line.itemId,
        name: line.name || item?.name || '',
        spec: line.unit || item?.unit || '',
        qty: line.quantity,
        price: Number(pi?.price ?? pi?.price ?? 0),
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
                            /*  취소 요청은 **받아 주기만** 한다(2026-09-04 사장님:
                                "직원이 취소한걸 반려하는 경우는 없어").
                                전에 있던 반려 단추가 뜻이 뒤집혀 쓰이던 자리다.
                                'approved' 를 보내서 **취소가 아무 일도 안 했다** — 이제 'cancelled' 다. */
                            <button onClick={() => onUpdateLeaveStatus(req.id, 'cancelled')} className="px-2 py-1.5 bg-orange-500 text-white rounded-lg text-[10px] font-black hover:bg-orange-600 transition-all shadow-sm whitespace-nowrap">취소승인</button>
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
                        ) : req.type === 'oem_fee' ? (
                          <div className="flex items-center space-x-1 whitespace-nowrap">
                            <span className="text-[10px] font-bold text-slate-400">{req.originalQuantity}kg × {(req.oemFeePerKg ?? 0).toLocaleString()}</span>
                            <ArrowRight size={10} className="text-slate-300" />
                            <span className="text-[11px] font-black text-violet-600">{(req.oemTotal ?? 0).toLocaleString()}원</span>
                          </div>
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
                            className={`px-2 py-1.5 text-white rounded-lg text-[10px] font-black transition-all shadow-sm whitespace-nowrap ${req.type === 'reorder_alert' ? 'bg-rose-500 hover:bg-rose-600' : req.type === 'oem_fee' ? 'bg-violet-600 hover:bg-violet-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                          >
                            {req.type === 'chat_mention' ? '확인' : req.type === 'reorder_alert' ? '발주완료' : req.type === 'oem_fee' ? '전표 발행' : '승인'}
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
                          <button disabled={!onProcessReturn || !!processingReturnId} onClick={() => void processReturnRequest(req)} className="flex items-center gap-1 px-2 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[10px] font-black transition-all shadow-sm whitespace-nowrap"><FileText size={11} /> {processingReturnId === req.id ? '처리 중...' : '반품 원자 처리'}</button>
                        ) : (
                          <span className="flex items-center gap-1 text-emerald-600 text-[10px] font-black whitespace-nowrap"><Check size={11} /> 처리 이력</span>
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
                          <span className="flex items-center gap-1 text-emerald-600 text-[10px] font-black whitespace-nowrap"><Check size={11} /> 처리 이력</span>
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
                        <button disabled={approvingEdits.has(edit.id) || !onApproveStatementEdit} onClick={() => { void approveStatementEdit(edit); }} className="flex items-center gap-1 px-2 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-[10px] font-black transition-colors whitespace-nowrap"><Check size={10} />승인</button>
                        <button disabled={approvingEdits.has(edit.id)} onClick={() => onRejectStatementEdit?.(edit.id)} className="flex items-center gap-1 px-2 py-1.5 bg-rose-100 hover:bg-rose-200 text-rose-600 rounded-lg text-[10px] font-black transition-colors whitespace-nowrap"><X size={10} />거절</button>
                        {editApprovalErrors[edit.id] && <span role="alert" className="text-xs text-rose-600">{editApprovalErrors[edit.id]}</span>}
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

    </div>
  );
};

export default AdminChecklist;
