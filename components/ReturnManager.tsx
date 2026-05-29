import React, { useState, useEffect } from 'react';
import {
  RotateCcw,
  Plus,
  Trash2,
  Check,
  X,
  ChevronDown,
} from 'lucide-react';
import {
  ReturnRequest,
  ReturnItem,
  ReturnReason,
  Item,
  Partner,
  Order,
  IssuedStatement,
} from '../src/shared/types';
import { addItem, subscribeToCollection } from '../src/shared/services/firebaseService';
import PageHeader from './PageHeader';

interface ReturnManagerProps {
  items: Item[];
  partners: Partner[];
  orders: Order[];
  issuedStatements: IssuedStatement[];
  currentUser: { id: string; name: string };
  isAdmin: boolean;
  onProcessReturn: (req: ReturnRequest) => Promise<void>;
}

type Tab = '접수' | '이력';

const RETURN_REASONS: ReturnReason[] = ['품질불량', '오배송', '과잉재고', '기타'];

const ReturnManager: React.FC<ReturnManagerProps> = ({
  items, partners,
  orders,
  issuedStatements,
  currentUser,
  isAdmin,
  onProcessReturn,
}) => {
  const [tab, setTab] = useState<Tab>('접수');
  const [returnRequests, setReturnRequests] = useState<ReturnRequest[]>([]);

  // 접수 폼
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [selectedStatementId, setSelectedStatementId] = useState('');
  const [returnLineItems, setReturnLineItems] = useState<Partial<ReturnItem>[]>([]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  // 이력 필터
  const [filterMonth, setFilterMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    return subscribeToCollection<ReturnRequest>('returnRequests', setReturnRequests);
  }, []);

  // 거래처 변경 시 하위 선택 초기화
  useEffect(() => {
    setSelectedOrderId('');
    setSelectedStatementId('');
    setReturnLineItems([]);
  }, [selectedClientId]);

  const sellableProducts = items.filter(p =>
    ['완제품', '향미유', '고춧가루'].includes(p.category as string)
  );

  const clientOrders = orders
    .filter(o => o.partnerId === selectedClientId && o.status === 'DELIVERED')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 30);

  const clientStatements = issuedStatements
    .filter(s => s.partnerId === selectedClientId && s.type === '매출')
    .sort((a, b) => b.tradeDate.localeCompare(a.tradeDate))
    .slice(0, 30);

  const handleSelectOrder = (orderId: string) => {
    setSelectedOrderId(orderId);
    if (!orderId) { setReturnLineItems([]); return; }
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    setReturnLineItems(
      order.items.map(i => ({
        itemId: i.itemId,
        name: i.name,
        quantity: 0,
        price: i.price,
        reason: '기타' as ReturnReason,
        isResellable: true,
      }))
    );
  };

  const appendItem = () => {
    setReturnLineItems(prev => [...prev, { reason: '기타' as ReturnReason, isResellable: true, quantity: 0, price: 0 }]);
  };

  const updateItemField = <K extends keyof ReturnItem>(idx: number, key: K, val: ReturnItem[K]) => {
    setReturnLineItems(prev => prev.map((it, i) => (i === idx ? { ...it, [key]: val } : it)));
  };

  const removeItemRow = (idx: number) => {
    setReturnLineItems(prev => prev.filter((_, i) => i !== idx));
  };

  const handleProductSelect = (idx: number, itemId: string) => {
    const p = items.find(x => x.id === itemId);
    setReturnLineItems(prev =>
      prev.map((it, i) =>
        i === idx ? { ...it, itemId, name: p?.name ?? '', price: p?.price ?? 0 } : it
      )
    );
  };

  const validItems = returnLineItems.filter(
    (it): it is ReturnItem =>
      !!it.itemId && !!it.name && (it.quantity ?? 0) > 0
  );

  const totalAmount = validItems.reduce((sum, it) => sum + it.quantity * it.price, 0);

  const handleSubmit = async () => {
    const selectedClient = partners.find(c => c.id === selectedClientId);
    if (!selectedClient) { alert('거래처를 선택해주세요.'); return; }
    if (validItems.length === 0) { alert('반품 품목을 1개 이상 입력해주세요.'); return; }

    setSaving(true);
    try {
      const req = {
        partnerId: selectedClientId,
        clientName: selectedClient.name,
        ...(selectedOrderId && { orderId: selectedOrderId }),
        ...(selectedStatementId && { linkedStatementId: selectedStatementId }),
        items: validItems,
        totalAmount,
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
        ...(note && { note }),
      };
      await addItem('returnRequests', req);
      setSelectedClientId('');
      setReturnLineItems([]);
      setNote('');
      setTab('이력');
    } finally {
      setSaving(false);
    }
  };

  const handleProcess = async (req: ReturnRequest) => {
    if (!isAdmin) { alert('관리자만 반품 처리를 할 수 있습니다.'); return; }
    if (!window.confirm(`${req.clientName}의 반품을 처리하시겠습니까?\n재판매 가능 품목의 재고가 복귀됩니다.`)) return;
    setProcessingId(req.id);
    try {
      await onProcessReturn(req);
    } finally {
      setProcessingId(null);
    }
  };

  const filteredHistory = returnRequests
    .filter(r => r.createdAt.slice(0, 7) === filterMonth)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="space-y-4">
      <PageHeader title="반품 관리" subtitle="고객 반품 접수 및 재고/정산 처리" />

      {/* 탭 */}
      <div className="flex bg-slate-100 rounded-xl p-1 gap-1 w-fit">
        {(['접수', '이력'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-black transition-all ${
              tab === t ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            {t}
            {t === '이력' && returnRequests.filter(r => r.status === 'pending').length > 0 && (
              <span className="ml-1.5 bg-amber-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full">
                {returnRequests.filter(r => r.status === 'pending').length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── 접수 탭 ── */}
      {tab === '접수' && (
        <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-5">
          {/* 거래처 / 원주문 / 전표 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-black text-slate-500 uppercase tracking-wider">거래처 *</label>
              <select
                value={selectedClientId}
                onChange={e => setSelectedClientId(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">거래처 선택</option>
                {partners.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-black text-slate-500 uppercase tracking-wider">원주문 (선택)</label>
              <select
                value={selectedOrderId}
                onChange={e => handleSelectOrder(e.target.value)}
                disabled={!selectedClientId}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-40"
              >
                <option value="">원주문 선택 (품목 자동 채움)</option>
                {clientOrders.map(o => (
                  <option key={o.id} value={o.id}>
                    {o.createdAt.slice(0, 10)} — {o.items.map(i => i.name).join(', ').slice(0, 25)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-black text-slate-500 uppercase tracking-wider">연결 전표 (선택)</label>
              <select
                value={selectedStatementId}
                onChange={e => setSelectedStatementId(e.target.value)}
                disabled={!selectedClientId}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-40"
              >
                <option value="">전표 선택 (미수금 차감)</option>
                {clientStatements.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.tradeDate} — {s.docNo} (₩{s.totalAmount.toLocaleString()})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 반품 품목 헤더 */}
          <div className="flex items-center justify-between">
            <label className="text-xs font-black text-slate-500 uppercase tracking-wider">반품 품목 *</label>
            <button
              onClick={appendItem}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-black hover:bg-blue-100 transition-colors"
            >
              <Plus size={13} /> 품목 추가
            </button>
          </div>

          {/* 품목 컬럼 헤더 */}
          {returnLineItems.length > 0 && (
            <div className="grid grid-cols-12 gap-2 px-2.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">
              <div className="col-span-4">품목</div>
              <div className="col-span-1 text-center">수량</div>
              <div className="col-span-2 text-center">단가</div>
              <div className="col-span-3">반품 사유</div>
              <div className="col-span-2 text-center">재고 처리</div>
            </div>
          )}

          {/* 품목 행 */}
          {returnLineItems.length === 0 ? (
            <p className="text-slate-400 text-sm py-6 text-center border-2 border-dashed border-slate-200 rounded-xl">
              원주문을 선택하거나 품목을 직접 추가하세요
            </p>
          ) : (
            <div className="space-y-2">
              {returnLineItems.map((it, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center bg-slate-50 rounded-xl p-2.5">
                  <div className="col-span-4">
                    <select
                      value={it.itemId ?? ''}
                      onChange={e => handleProductSelect(idx, e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                    >
                      <option value="">품목 선택</option>
                      {sellableProducts.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-1">
                    <input
                      type="number"
                      min={1}
                      placeholder="0"
                      value={it.quantity || ''}
                      onChange={e => updateItemField(idx, 'quantity', Number(e.target.value))}
                      className="w-full border border-slate-200 rounded-lg px-1 py-1.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                  </div>
                  <div className="col-span-2">
                    <input
                      type="number"
                      min={0}
                      placeholder="0"
                      value={it.price || ''}
                      onChange={e => updateItemField(idx, 'price', Number(e.target.value))}
                      className="w-full border border-slate-200 rounded-lg px-1 py-1.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                  </div>
                  <div className="col-span-3">
                    <select
                      value={it.reason ?? '기타'}
                      onChange={e => updateItemField(idx, 'reason', e.target.value as ReturnReason)}
                      className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                    >
                      {RETURN_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div className="col-span-1 flex justify-center">
                    <button
                      onClick={() => updateItemField(idx, 'isResellable', !it.isResellable)}
                      title={it.isResellable ? '재판매 가능 (클릭시 폐기로 변경)' : '폐기 처리 (클릭시 재판매로 변경)'}
                      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-black transition-colors ${
                        it.isResellable
                          ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                          : 'bg-red-100 text-red-600 hover:bg-red-200'
                      }`}
                    >
                      {it.isResellable ? <><Check size={10} />재판매</> : <><X size={10} />폐기</>}
                    </button>
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <button
                      onClick={() => removeItemRow(idx)}
                      className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 비고 */}
          <div className="space-y-1.5">
            <label className="text-xs font-black text-slate-500 uppercase tracking-wider">비고</label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="반품 관련 메모 (선택)"
              rows={2}
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* 합계 & 접수 버튼 */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-100">
            <div>
              <p className="text-xs text-slate-400">총 반품금액</p>
              <p className="text-xl font-black text-slate-800">₩{totalAmount.toLocaleString()}</p>
              {selectedStatementId && totalAmount > 0 && (
                <p className="text-xs text-emerald-600 mt-0.5">→ 선택된 전표에서 미수금 차감</p>
              )}
            </div>
            <button
              onClick={handleSubmit}
              disabled={saving || !selectedClientId || validItems.length === 0}
              className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-black hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              <RotateCcw size={15} />
              {saving ? '저장 중...' : '반품 접수'}
            </button>
          </div>
        </div>
      )}

      {/* ── 이력 탭 ── */}
      {tab === '이력' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <label className="text-xs font-black text-slate-500 uppercase tracking-wider">기간</label>
            <input
              type="month"
              value={filterMonth}
              onChange={e => setFilterMonth(e.target.value)}
              className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-xs text-slate-400">{filteredHistory.length}건</span>
          </div>

          {filteredHistory.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center text-slate-400">
              <RotateCcw size={32} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">해당 월의 반품 이력이 없습니다</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredHistory.map(req => (
                <ReturnCard
                  key={req.id}
                  req={req}
                  isAdmin={isAdmin}
                  isProcessing={processingId === req.id}
                  onProcess={() => handleProcess(req)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── 반품 이력 카드 ────────────────────────────────────────────────────────────

interface ReturnCardProps {
  req: ReturnRequest;
  isAdmin: boolean;
  isProcessing: boolean;
  onProcess: () => void;
}

const ReturnCard: React.FC<ReturnCardProps> = ({ req, isAdmin, isProcessing, onProcess }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
      <div
        className="p-4 flex items-center gap-4 cursor-pointer hover:bg-slate-50 transition-colors"
        onClick={() => setExpanded(p => !p)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-black text-slate-800 text-sm">{req.clientName}</p>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                req.status === 'processed'
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-amber-100 text-amber-700'
              }`}
            >
              {req.status === 'processed' ? '처리완료' : '처리대기'}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            {req.createdAt.slice(0, 10)} · {req.items.length}개 품목 · ₩{req.totalAmount.toLocaleString()}
          </p>
        </div>

        {req.status === 'pending' && isAdmin && (
          <button
            onClick={e => { e.stopPropagation(); onProcess(); }}
            disabled={isProcessing}
            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-black hover:bg-blue-700 disabled:opacity-40 transition-colors shrink-0"
          >
            {isProcessing ? '처리 중...' : '처리'}
          </button>
        )}

        <ChevronDown
          size={16}
          className={`text-slate-400 shrink-0 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
        />
      </div>

      {expanded && (
        <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-2.5">
          {req.orderId && (
            <p className="text-xs text-slate-400">원주문 ID: {req.orderId}</p>
          )}
          {req.linkedStatementId && (
            <p className="text-xs text-emerald-600">연결 전표: {req.linkedStatementId}</p>
          )}

          <div className="space-y-1.5">
            {req.items.map((item, i) => (
              <div
                key={i}
                className="flex items-center justify-between text-xs bg-slate-50 rounded-lg px-3 py-2"
              >
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <span className="font-semibold text-slate-700">{item.name}</span>
                  <span className="text-slate-400">{item.quantity}개 × ₩{item.price.toLocaleString()}</span>
                  <span className="text-slate-400">· {item.reason}</span>
                </div>
                <span
                  className={`ml-2 shrink-0 px-2 py-0.5 rounded-full text-[10px] font-black ${
                    item.isResellable
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-red-100 text-red-600'
                  }`}
                >
                  {item.isResellable ? '재판매' : '폐기'}
                </span>
              </div>
            ))}
          </div>

          {req.note && (
            <p className="text-xs text-slate-500 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              비고: {req.note}
            </p>
          )}

          {req.processedAt && (
            <p className="text-xs text-slate-400">
              처리일시: {req.processedAt.slice(0, 16).replace('T', ' ')}
              {req.processedBy && ` (${req.processedBy})`}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default ReturnManager;
