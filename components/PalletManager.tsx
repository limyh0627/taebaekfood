
import React, { useState, useMemo, useEffect } from 'react';
import {
  Layers,
  RefreshCw,
  Plus,
  AlertTriangle,
  CheckCircle2,
  Activity,
  Edit2,
  Check,
  X,
  Users,
  Clock,
  Search,
  Trash2
} from 'lucide-react';
import { PalletStock, Order, Partner, OrderStatus, PalletTransaction } from '../types';
import { fetchDateRange, updateItem, deleteItem } from '../src/shared/services/firebaseService';
import PageHeader from './PageHeader';

// 모듈 캐시 — 페이지 재진입 시 24개월 과거 거래 재조회 방지 (읽기 절약). 5분 TTL.
let palletTxCache: { data: PalletTransaction[]; at: number } | null = null;

interface PalletManagerProps {
  pallets: PalletStock[];
  orders: Order[];
  partners: Partner[];
  palletTransactions: PalletTransaction[];
  onUpdatePallet: (_pallet: PalletStock) => void;
  onAddPalletTransaction: (_transaction: PalletTransaction) => void;
}

const PalletManager: React.FC<PalletManagerProps> = ({
  pallets,
  orders, partners,
  palletTransactions: liveTransactions,
  onUpdatePallet,
  onAddPalletTransaction
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'partners' | 'history'>('partners');

  // 라이브 구독은 7일치만 → 파렛트 잔량 계산에는 과거 누적이 필수이므로 24개월치 온디맨드 로드
  // 읽기 절약: 페이지 재진입마다 다시 읽지 않도록 모듈 캐시(5분). 최근 변경분은 라이브 7일 구독으로 반영됨.
  const [extraTransactions, setExtraTransactions] = useState<PalletTransaction[]>(palletTxCache?.data ?? []);
  useEffect(() => {
    if (palletTxCache && Date.now() - palletTxCache.at < 5 * 60 * 1000) {
      setExtraTransactions(palletTxCache.data);
      return;
    }
    const to = new Date().toISOString().slice(0, 10);
    const fromDate = new Date(); fromDate.setMonth(fromDate.getMonth() - 24);
    const from = fromDate.toISOString().slice(0, 10);
    fetchDateRange<PalletTransaction>('palletTransactions', 'date', from, to)
      .then(d => { palletTxCache = { data: d, at: Date.now() }; setExtraTransactions(d); })
      .catch(e => console.error('[PalletManager] 과거 파렛트 거래 로드 실패:', e));
  }, []);

  // 라이브(7일) + 과거(24개월) 병합 — id 기준 dedup, 라이브 우선
  const palletTransactions = useMemo(() => {
    const map = new Map<string, PalletTransaction>();
    extraTransactions.forEach(t => map.set(t.id, t));
    liveTransactions.forEach(t => map.set(t.id, t));
    return Array.from(map.values());
  }, [liveTransactions, extraTransactions]);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<PalletStock | null>(null);
  const [isTransactionModalOpen, setIsTransactionModalOpen] = useState(false);
  const [selectedClientForTrans, setSelectedClientForTrans] = useState<Partner | null>(null);
  const [transType, setTransType] = useState<'in' | 'out' | 'exchange'>('in');
  const [selectedClientIdForDetail, setSelectedClientIdForDetail] = useState<string | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyDateFilter, setHistoryDateFilter] = useState('');
  const [monthFilter, setMonthFilter] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; // 기본값: 이번 달 ('' = 전체 기간)
  });

  const ITEMS_PER_PAGE = 5;

  const partnerPalletStatus = useMemo(() => {
    const stats: Record<string, { name: string; pallets: Record<string, number> }> = {};
    
    // Initialize with all partners
    partners.forEach(partner => {
      stats[partner.id] = { name: partner.name, pallets: {} };
    });

    // Add from orders
    orders
      .filter(o => o.pallets && o.pallets.length > 0 && (o.status === OrderStatus.SHIPPED || o.status === OrderStatus.DELIVERED))
      .forEach(order => {
        const partnerId = order.partnerId || 'unknown';
        if (!stats[partnerId]) stats[partnerId] = { name: order.partnerName, pallets: {} };
        
        order.pallets?.filter(p => !p.isExchange).forEach(p => {
          const pType = p.type || '기타';
          const qty = p.quantity || 0;
          if (!stats[partnerId].pallets[pType]) stats[partnerId].pallets[pType] = 0;
          stats[partnerId].pallets[pType] -= qty; // Outbound -> balance down (-)
        });
      });

    // Add/Subtract from manual transactions
    palletTransactions.forEach(trans => {
      const partnerId = trans.partnerId;
      if (!stats[partnerId]) {
        const partner = partners.find(c => c.id === partnerId);
        stats[partnerId] = { name: partner?.name || '알 수 없는 거래처', pallets: {} };
      }
      
      const pallet = pallets.find(p => p.id === trans.palletId);
      const pType = pallet?.name || '기타';
      
      if (!stats[partnerId].pallets[pType]) stats[partnerId].pallets[pType] = 0;
      
      if (trans.type === 'in') {
        stats[partnerId].pallets[pType] += trans.quantity; // Inbound -> balance up (+)
      } else {
        stats[partnerId].pallets[pType] -= trans.quantity; // Outbound -> balance down (-)
      }
    });
      
    return Object.entries(stats)
      .map(([id, data]) => {
        const total = Object.values(data.pallets).reduce((a, b) => a + b, 0);
        return {
          id,
          name: data.name,
          pallets: data.pallets,
          total
        };
      })
      .filter(item => {
        if (!item.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
        // 검색어 없을 때는 잔량 있는 거래처만 표시
        if (!searchTerm.trim()) {
          return Object.values(item.pallets).some(v => v !== 0);
        }
        return true;
      })
      .sort((a, b) => {
        // Non-zero totals first
        if (a.total !== 0 && b.total === 0) return -1;
        if (a.total === 0 && b.total !== 0) return 1;
        // Then by total magnitude (most negative/positive first)
        return Math.abs(b.total) - Math.abs(a.total);
      });
  }, [orders, partners, palletTransactions, pallets, searchTerm]);

  const CLIENT_PAGE_SIZE = 15;
  const [partnerPage, setClientPage] = useState(1);
  const partnerTotalPages = Math.max(1, Math.ceil(partnerPalletStatus.length / CLIENT_PAGE_SIZE));
  const partnerSafePage = Math.min(partnerPage, partnerTotalPages);
  const pagedClientPalletStatus = partnerPalletStatus.slice((partnerSafePage - 1) * CLIENT_PAGE_SIZE, partnerSafePage * CLIENT_PAGE_SIZE);

  const partnerHistory = useMemo(() => {
    if (!selectedClientIdForDetail) return [];

    const history: { id: string; type: 'in' | 'out'; quantity: number; date: string; note: string; palletName: string; txId?: string }[] = [];

    // From manual transactions
    palletTransactions
      .filter(t => t.partnerId === selectedClientIdForDetail)
      .forEach(t => {
        const pallet = pallets.find(p => p.id === t.palletId);
        history.push({
          id: t.id,
          type: t.type,
          quantity: t.quantity,
          date: t.date,
          note: t.note || (t.type === 'in' ? '수동 입고' : '수동 출고'),
          palletName: pallet?.name || '기타',
          txId: t.id,
        });
      });

    // From orders
    orders
      .filter(o => o.partnerId === selectedClientIdForDetail && o.pallets && o.pallets.length > 0 && (o.status === OrderStatus.SHIPPED || o.status === OrderStatus.DISPATCHED))
      .forEach(o => {
        o.pallets?.forEach((p, idx) => {
          history.push({
            id: `${o.id}-${idx}`,
            type: 'out',
            quantity: p.quantity,
            date: o.deliveryDate.split('T')[0],
            note: `주문 출고 (${o.id})`,
            palletName: p.type
          });
        });
      });

    return history
      .filter(item => !historyDateFilter || item.date.includes(historyDateFilter))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [selectedClientIdForDetail, palletTransactions, orders, pallets, historyDateFilter]);

  const paginatedHistory = useMemo(() => {
    const startIndex = (historyPage - 1) * ITEMS_PER_PAGE;
    return partnerHistory.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [partnerHistory, historyPage]);

  const totalPages = Math.ceil(partnerHistory.length / ITEMS_PER_PAGE);

  const handleAddTransaction = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const partnerId = (formData.get('partnerId') as string) || selectedClientForTrans?.id || '';
    const palletId = formData.get('palletId') as string;
    const note = (formData.get('note') as string) || '';
    if (!partnerId) { alert('거래처를 선택해주세요.'); return; }
    if (!palletId) { alert('파렛트 종류를 선택해주세요.'); return; }

    const date = new Date().toISOString().split('T')[0];

    if (transType === 'exchange') {
      const returnQty = parseInt(formData.get('returnQty') as string) || 0;
      const newQty = parseInt(formData.get('newQty') as string) || 0;
      if (newQty <= 0) { alert('교체 지급(신규) 수량을 입력해주세요.'); return; }
      // 교체중: 신 파레트 지급(out)만 먼저 기록. 헌 파레트(returnQty) 회수는 입고 확인 시 '교체완료'로 처리.
      onAddPalletTransaction({
        id: `ptrans-${Date.now()}-exout`, partnerId, palletId,
        type: 'out', quantity: newQty, date, note: `교체 지급${note ? ' — ' + note : ''}`,
        status: '교체중', exchangeReturnQty: returnQty,
      });
      const pallet = pallets.find(p => p.id === palletId);
      if (pallet) onUpdatePallet({ ...pallet, inUse: pallet.inUse + newQty });
    } else {
      const quantity = parseInt(formData.get('quantity') as string) || 0;
      if (quantity <= 0) return;
      onAddPalletTransaction({ id: `ptrans-${Date.now()}`, partnerId, palletId, type: transType as 'in' | 'out', quantity, date, note });
      const pallet = pallets.find(p => p.id === palletId);
      if (pallet) onUpdatePallet({ ...pallet, inUse: transType === 'in' ? Math.max(0, pallet.inUse - quantity) : pallet.inUse + quantity });
    }

    setIsTransactionModalOpen(false);
    setSelectedClientForTrans(null);
  };

  // 선택 가능한 월 목록(YYYY-MM) — 거래/주문 출고 날짜 기준, 최신순
  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    const now = new Date();
    set.add(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`); // 이번 달은 거래 없어도 항상 표시
    palletTransactions.forEach(t => { if (t.date) set.add(t.date.slice(0, 7)); });
    orders.forEach(o => {
      if (o.pallets && o.pallets.length > 0 && (o.status === OrderStatus.SHIPPED || o.status === OrderStatus.DELIVERED)) {
        const m = (o.deliveryDate || '').slice(0, 7);
        if (m) set.add(m);
      }
    });
    return Array.from(set).filter(Boolean).sort((a, b) => b.localeCompare(a));
  }, [palletTransactions, orders]);

  // 전체 요약: 입고(들어온 합계) / 지급(나간 합계) / 교체중(교체 진행 중)
  // monthFilter 지정 시 해당 월(YYYY-MM) 거래만 합산
  const palletSummary = useMemo(() => {
    let totalOut = 0, totalIn = 0, exchanging = 0;
    const inMonth = (d?: string) => !monthFilter || (d ?? '').startsWith(monthFilter);
    palletTransactions.forEach(t => {
      if (!inMonth(t.date)) return;
      if (t.type === 'out') totalOut += t.quantity;
      else if (t.type === 'in') totalIn += t.quantity;
      if (t.status === '교체중') exchanging += t.quantity;
    });
    orders
      .filter(o => o.pallets && o.pallets.length > 0 && (o.status === OrderStatus.SHIPPED || o.status === OrderStatus.DELIVERED))
      .forEach(o => { if (inMonth(o.deliveryDate)) o.pallets?.filter(p => !p.isExchange).forEach(p => { totalOut += p.quantity || 0; }); });
    return { 입고: totalIn, 지급: totalOut, 교체중: exchanging };
  }, [palletTransactions, orders, monthFilter]);

  // 교체중 거래 목록 (거래처별 표시·완료 처리용)
  const pendingExchanges = useMemo(
    () => palletTransactions.filter(t => t.status === '교체중'),
    [palletTransactions],
  );

  // 전체 이력 — 이미 로딩된 거래(palletTransactions, 24개월) + 주문 출고분 재사용 (추가 Firebase 읽기 없음)
  const allPalletHistory = useMemo(() => {
    const pName = (id: string) => partners.find(p => p.id === id)?.name || '알 수 없음';
    type Row = { id: string; date: string; partner: string; pallet: string; type: 'in' | 'out'; quantity: number; status?: string; note: string; txId?: string };
    const rows: Row[] = palletTransactions.map(t => ({
      id: t.id, date: t.date, partner: pName(t.partnerId),
      pallet: pallets.find(p => p.id === t.palletId)?.name || '기타',
      type: t.type, quantity: t.quantity, status: t.status, note: t.note || '', txId: t.id,
    }));
    orders
      .filter(o => o.pallets && o.pallets.length > 0 && (o.status === OrderStatus.SHIPPED || o.status === OrderStatus.DELIVERED))
      .forEach(o => o.pallets?.filter(p => !p.isExchange).forEach((p, i) => rows.push({
        id: `${o.id}-pl-${i}`, date: (o.deliveryDate || '').split('T')[0], partner: o.partnerName,
        pallet: p.type || '기타', type: 'out', quantity: p.quantity || 0, note: '주문 출고',
      })));
    return rows
      .filter(r => !monthFilter || (r.date ?? '').startsWith(monthFilter))
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  }, [palletTransactions, orders, partners, pallets, monthFilter]);

  // 교체완료: 헌 파레트 입고 확인 → 원 거래를 교체완료로 표시 + 회수(in) 기록
  const completeExchange = async (tx: PalletTransaction) => {
    const retQty = tx.exchangeReturnQty ?? tx.quantity;
    if (!confirm(`헌 파레트 ${retQty}개가 입고(회수)되었나요? 교체완료로 처리합니다.`)) return;
    try {
      await updateItem('palletTransactions', tx.id, { status: '교체완료' });
      const date = new Date().toISOString().split('T')[0];
      if (retQty > 0) {
        onAddPalletTransaction({ id: `ptrans-${Date.now()}-exin`, partnerId: tx.partnerId, palletId: tx.palletId, type: 'in', quantity: retQty, date, note: '교체완료 회수' });
        const pallet = pallets.find(p => p.id === tx.palletId);
        if (pallet) onUpdatePallet({ ...pallet, inUse: Math.max(0, pallet.inUse - retQty) });
      }
    } catch (e) {
      console.error('[파레트] 교체완료 실패:', e);
      alert('교체완료 처리 실패: ' + ((e as Error)?.message ?? e));
    }
  };

  // 거래 삭제(정정) — 오입력된 수동 거래 제거. inUse 되돌림 + 로컬 캐시에서도 제거.
  // (주문 출고에서 파생된 행은 txId가 없어 삭제 버튼이 노출되지 않음)
  const deleteTransaction = async (txId: string) => {
    const tx = palletTransactions.find(t => t.id === txId);
    if (!tx) return;
    const label = tx.type === 'in' ? '입고' : '지급';
    if (!confirm(`이 파렛트 ${label} 거래(${tx.quantity}개)를 삭제할까요?\n되돌릴 수 없습니다.`)) return;
    try {
      await deleteItem('palletTransactions', tx.id);
      // inUse 되돌림: 입고였으면 다시 +, 지급이었으면 −
      const pallet = pallets.find(p => p.id === tx.palletId);
      if (pallet) {
        const delta = tx.type === 'in' ? tx.quantity : -tx.quantity;
        onUpdatePallet({ ...pallet, inUse: Math.max(0, pallet.inUse + delta) });
      }
      // 라이브 구독(7일)이 즉시 못 지우는 과거 거래 대비 — 로컬 캐시/상태에서도 제거
      setExtraTransactions(prev => prev.filter(t => t.id !== tx.id));
      if (palletTxCache) palletTxCache = { data: palletTxCache.data.filter(t => t.id !== tx.id), at: palletTxCache.at };
    } catch (e) {
      console.error('[파레트] 거래 삭제 실패:', e);
      alert('삭제 실패: ' + ((e as Error)?.message ?? e));
    }
  };

  const handleEdit = (pallet: PalletStock) => {
    setEditingId(pallet.id);
    setEditForm({ ...pallet });
  };

  const handleSave = () => {
    if (editForm) {
      onUpdatePallet(editForm);
      setEditingId(null);
      setEditForm(null);
    }
  };

  const handleChange = (field: keyof PalletStock, value: any) => {
    if (editForm) {
      setEditForm({ ...editForm, [field]: value });
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-300 h-full flex flex-col">
      <PageHeader
        title="파렛트 관리"
        subtitle="실제 현장 출고 데이터를 기반으로 한 파렛트 순환 현황입니다."
        right={<div className="flex bg-slate-100 p-1 rounded-2xl items-center">
          <button
            onClick={() => setActiveTab('partners')}
            className={`px-4 py-2 rounded-xl flex items-center gap-1.5 transition-all ${activeTab === 'partners' ? 'bg-white text-amber-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <Users size={14} />
            <span className="text-xs font-black">거래처별</span>
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2 rounded-xl flex items-center gap-1.5 transition-all ${activeTab === 'history' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <Clock size={14} />
            <span className="text-xs font-black">이력</span>
          </button>
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 rounded-xl flex items-center gap-1.5 transition-all ${activeTab === 'overview' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <Layers size={14} />
            <span className="text-xs font-black">전체 재고</span>
          </button>
        </div>}
      />

      {activeTab === 'overview' ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex items-center space-x-4">
              <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center">
                <Activity size={24} />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">회수 대기 (거래처 소재)</p>
                <p className="text-2xl font-black text-slate-900">{pallets.reduce((acc, p) => acc + p.inUse, 0)}개</p>
              </div>
            </div>
            <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex items-center space-x-4">
              <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center">
                <CheckCircle2 size={24} />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">공장 내 가용</p>
                <p className="text-2xl font-black text-slate-900">{pallets.reduce((acc, p) => acc + (p.total - p.inUse - p.damaged), 0)}개</p>
              </div>
            </div>
            <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex items-center space-x-4">
              <div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-2xl flex items-center justify-center">
                <AlertTriangle size={24} />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">파손/수리 필요</p>
                <p className="text-2xl font-black text-slate-900">{pallets.reduce((acc, p) => acc + p.damaged, 0)}개</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {pallets.map(pallet => {
              const isEditing = editingId === pallet.id;
              const available = pallet.total - pallet.inUse - pallet.damaged;

              return (
                <div key={pallet.id} className={`bg-white rounded-3xl border transition-all duration-300 overflow-hidden ${isEditing ? 'ring-2 ring-indigo-500 border-indigo-200' : 'border-slate-100 shadow-sm'}`}>
                  <div className="p-8">
                    <div className="flex items-center justify-between mb-8">
                      <div className="flex items-center space-x-4">
                        <div className="w-14 h-14 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center">
                          <Layers size={28} />
                        </div>
                        <div>
                          {isEditing ? (
                            <input 
                              type="text" 
                              value={editForm?.name} 
                              onChange={(e) => handleChange('name', e.target.value)}
                              className="text-xl font-bold text-slate-900 border-b border-indigo-200 outline-none w-full"
                            />
                          ) : (
                            <h3 className="text-xl font-bold text-slate-900">{pallet.name}</h3>
                          )}
                          <p className="text-xs text-slate-400 font-bold tracking-widest uppercase">자산 요약</p>
                        </div>
                      </div>
                      
                      {isEditing ? (
                        <div className="flex items-center space-x-2">
                          <button onClick={handleSave} className="p-2 bg-indigo-600 text-white rounded-xl shadow-lg hover:bg-indigo-700">
                            <Check size={20} />
                          </button>
                          <button onClick={() => setEditingId(null)} className="p-2 bg-slate-100 text-slate-500 rounded-xl hover:bg-slate-200">
                            <X size={20} />
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => handleEdit(pallet)} className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all">
                          <Edit2 size={20} />
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-3 gap-6">
                      <div className="space-y-1">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">전체 자산</p>
                        {isEditing ? (
                          <input 
                            type="number" 
                            value={editForm?.total} 
                            onChange={(e) => handleChange('total', parseInt(e.target.value) || 0)}
                            className="text-2xl font-black text-slate-900 border-b border-indigo-200 outline-none w-full"
                          />
                        ) : (
                          <p className="text-2xl font-black text-slate-900">{pallet.total}</p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">출고(사용 중)</p>
                        <p className="text-2xl font-black text-indigo-600">{pallet.inUse}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">파손/수리</p>
                        {isEditing ? (
                          <input 
                            type="number" 
                            value={editForm?.damaged} 
                            onChange={(e) => handleChange('damaged', parseInt(e.target.value) || 0)}
                            className="text-2xl font-black text-rose-600 border-b border-indigo-200 outline-none w-full"
                          />
                        ) : (
                          <p className="text-2xl font-black text-rose-600">{pallet.damaged}</p>
                        )}
                      </div>
                    </div>

                    <div className="mt-8">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-xs font-bold text-slate-500">가용 리포트</span>
                        <span className="text-xs font-bold text-emerald-600">{Math.round((available / pallet.total) * 100)}% 가용 가능</span>
                      </div>
                      <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden flex">
                        <div style={{ width: `${(pallet.inUse / pallet.total) * 100}%` }} className="bg-indigo-500 h-full" />
                        <div style={{ width: `${(available / pallet.total) * 100}%` }} className="bg-emerald-500 h-full" />
                        <div style={{ width: `${(pallet.damaged / pallet.total) * 100}%` }} className="bg-rose-500 h-full" />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : activeTab === 'history' ? (
        <div className="space-y-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Clock size={14} className="text-slate-400" />
                <h3 className="text-xs font-black text-slate-700 uppercase tracking-wider">파렛트 거래 이력</h3>
                <span className="text-[10px] font-black text-slate-300">{allPalletHistory.length}건</span>
              </div>
              <select
                value={monthFilter}
                onChange={(e) => setMonthFilter(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-400"
              >
                <option value="">전체 기간</option>
                {availableMonths.map(m => (
                  <option key={m} value={m}>{m.slice(0, 4)}년 {m.slice(5)}월</option>
                ))}
              </select>
            </div>
            <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50/50 border-b border-slate-100 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-[10px] font-black text-slate-400 uppercase whitespace-nowrap">날짜</th>
                    <th className="px-3 py-2 text-[10px] font-black text-slate-400 uppercase">거래처</th>
                    <th className="px-3 py-2 text-[10px] font-black text-slate-400 uppercase">파렛트</th>
                    <th className="px-3 py-2 text-[10px] font-black text-slate-400 uppercase text-center">구분</th>
                    <th className="px-3 py-2 text-[10px] font-black text-slate-400 uppercase text-right">수량</th>
                    <th className="px-3 py-2 text-[10px] font-black text-slate-400 uppercase">비고</th>
                    <th className="px-3 py-2 text-[10px] font-black text-slate-400 uppercase text-center">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {allPalletHistory.length === 0 ? (
                    <tr><td colSpan={7} className="px-3 py-16 text-center text-xs font-bold text-slate-300">거래 이력이 없습니다</td></tr>
                  ) : allPalletHistory.map(r => (
                    <tr key={r.id} className="hover:bg-slate-50/40">
                      <td className="px-3 py-2.5 text-[11px] font-bold text-slate-500 whitespace-nowrap">{r.date}</td>
                      <td className="px-3 py-2.5 text-[11px] font-bold text-slate-700">{r.partner}</td>
                      <td className="px-3 py-2.5 text-[11px] text-slate-500">{r.pallet}</td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${r.status === '교체중' ? 'bg-violet-50 text-violet-600' : r.status === '교체완료' ? 'bg-violet-100 text-violet-700' : r.type === 'in' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                          {r.status ? r.status : r.type === 'in' ? '입고' : '지급'}
                        </span>
                      </td>
                      <td className={`px-3 py-2.5 text-right text-[11px] font-black ${r.type === 'in' ? 'text-emerald-600' : 'text-rose-600'}`}>{r.type === 'in' ? '+' : '−'}{r.quantity}</td>
                      <td className="px-3 py-2.5 text-[10px] text-slate-400 truncate max-w-[180px]">{r.note}</td>
                      <td className="px-3 py-2.5 text-center">
                        {r.txId ? (
                          <button onClick={() => deleteTransaction(r.txId!)} className="p-1 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded transition-colors" title="거래 삭제(정정)">
                            <Trash2 size={13} />
                          </button>
                        ) : <span className="text-[9px] text-slate-200">주문</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4 animate-in fade-in duration-300">
          {/* 월 선택 — 요약 숫자(입고/지급/교체중)를 해당 월로 필터 */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-black text-slate-500">기간</span>
            <select
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-400"
            >
              <option value="">전체 기간</option>
              {availableMonths.map(m => (
                <option key={m} value={m}>{m.slice(0, 4)}년 {m.slice(5)}월</option>
              ))}
            </select>
            {monthFilter && (
              <span className="text-[10px] font-bold text-indigo-500">{monthFilter.slice(0, 4)}년 {monthFilter.slice(5)}월 기준</span>
            )}
          </div>
          {/* 전체 요약: 입고 / 지급 / 교체중 */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white p-4 rounded-2xl border border-emerald-100 shadow-sm">
              <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">입고</p>
              <p className="text-2xl font-black text-emerald-600">{palletSummary.입고.toLocaleString()}<span className="text-sm font-bold text-slate-400">개</span></p>
              <p className="text-[10px] text-slate-400">{monthFilter ? '이 달 들어온 파레트' : '거래처에서 들어온 총 파레트'}</p>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
              <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest">지급</p>
              <p className="text-2xl font-black text-indigo-600">{palletSummary.지급.toLocaleString()}<span className="text-sm font-bold text-slate-400">개</span></p>
              <p className="text-[10px] text-slate-400">{monthFilter ? '이 달 내준 파레트' : '거래처에 내준 총 파레트'}</p>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-violet-100 shadow-sm">
              <p className="text-[10px] font-black text-violet-500 uppercase tracking-widest">교체중</p>
              <p className="text-2xl font-black text-violet-600">{palletSummary.교체중.toLocaleString()}<span className="text-sm font-bold text-slate-400">개</span></p>
              <p className="text-[10px] text-slate-400">입고 확인 대기 (교체 진행 중)</p>
            </div>
          </div>
          <div className="flex items-center justify-between bg-white p-4 rounded-3xl border border-slate-100 shadow-sm">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input 
                type="text" 
                placeholder="거래처 검색..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-slate-50 border border-slate-100 rounded-2xl pl-12 pr-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
              />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => { setSelectedClientForTrans(null); setTransType('out'); setIsTransactionModalOpen(true); }} className="px-3 py-2 rounded-xl text-xs font-black bg-rose-50 text-rose-600 hover:bg-rose-100 transition-colors flex items-center gap-1"><Plus size={13} />지급</button>
              <button onClick={() => { setSelectedClientForTrans(null); setTransType('exchange'); setIsTransactionModalOpen(true); }} className="px-3 py-2 rounded-xl text-xs font-black bg-amber-50 text-amber-600 hover:bg-amber-100 transition-colors flex items-center gap-1"><RefreshCw size={13} />교체</button>
              <button onClick={() => { setSelectedClientForTrans(null); setTransType('in'); setIsTransactionModalOpen(true); }} className="px-3 py-2 rounded-xl text-xs font-black bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors flex items-center gap-1"><RefreshCw size={13} />신규 입고</button>
            </div>
          </div>

          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-slate-50/50 border-b border-slate-100">
                <tr>
                  <th className="px-3 py-3 text-xs font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">거래처</th>
                  <th className="px-3 py-3 text-xs font-bold text-slate-400 uppercase tracking-widest">파렛트 현황</th>
                  <th className="px-3 py-3 text-xs font-bold text-slate-400 uppercase tracking-widest text-right whitespace-nowrap">작업</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {pagedClientPalletStatus.length > 0 ? (
                  pagedClientPalletStatus.map((status, idx) => (
                    <tr 
                      key={idx} 
                      onClick={() => setSelectedClientIdForDetail(status.id)}
                      className="hover:bg-slate-50/30 transition-colors group cursor-pointer"
                    >
                      <td className="px-3 py-4">
                        <div className="flex items-center space-x-2">
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs uppercase shrink-0 ${status.total > 0 ? 'bg-indigo-50 text-indigo-500' : 'bg-slate-50 text-slate-300'}`}>
                            {status.name[0]}
                          </div>
                          <span className={`text-[11px] font-bold whitespace-nowrap ${status.total > 0 ? 'text-slate-800' : 'text-slate-400'}`}>
                            {status.name.length > 5 ? status.name.slice(0, 5) + '...' : status.name}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-4">
                        <div className="flex flex-wrap gap-1.5">
                          {(() => {
                            const owed = Object.entries(status.pallets).filter(([, q]) => q < 0);          // 미회수
                            const overTotal = Object.entries(status.pallets).filter(([, q]) => q > 0).reduce((s, [, q]) => s + q, 0); // 과반납
                            if (owed.length === 0 && overTotal === 0) return <span className="text-[10px] text-slate-300 italic">정상</span>;
                            return (<>
                              {owed.map(([type, q]) => (
                                <div key={type} className="flex items-center space-x-1 px-2 py-1 rounded-lg border bg-amber-50 border-amber-100">
                                  <span className="text-[11px] font-bold whitespace-nowrap text-amber-700">미회수 {Math.abs(q)}개<span className="text-[9px] font-bold text-amber-400 ml-1">{type}</span></span>
                                </div>
                              ))}
                              {overTotal > 0 && (
                                <div className="flex items-center space-x-1 px-2 py-1 rounded-lg border bg-rose-50 border-rose-100" title="받은 것보다 많이 반납됨 — 정산/확인 필요">
                                  <span className="text-[11px] font-bold whitespace-nowrap text-rose-600">확인필요 +{overTotal}개</span>
                                </div>
                              )}
                            </>);
                          })()}
                        </div>
                      </td>
                      <td className="px-3 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                        {(() => {
                          const pending = pendingExchanges.filter(t => t.partnerId === status.id)
                            .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')); // 오래된 것부터
                          if (pending.length === 0) return <span className="text-[10px] text-slate-200">—</span>;
                          const total = pending.reduce((s, t) => s + t.quantity, 0);
                          return (
                            <div className="flex items-center justify-end gap-1.5 flex-wrap">
                              <span className="px-1.5 py-1 rounded-lg text-[10px] font-black bg-violet-50 text-violet-600 whitespace-nowrap">교체중 {total}</span>
                              <button onClick={() => completeExchange(pending[0])} className="px-2 py-1 rounded-lg text-[10px] font-black bg-violet-600 text-white hover:bg-violet-700 transition-colors whitespace-nowrap">교체완료</button>
                            </div>
                          );
                        })()}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="px-8 py-20 text-center">
                      <div className="flex flex-col items-center">
                        <Layers size={48} className="text-slate-100 mb-4" />
                        <p className="text-slate-400 font-bold">검색 결과가 없거나 출고된 파렛트가 없습니다.</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {partnerTotalPages > 1 && (
              <div className="flex items-center justify-center gap-1 py-4 border-t border-slate-100">
                <button onClick={() => setClientPage(p => Math.max(1, p - 1))} disabled={partnerSafePage === 1}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-400 hover:bg-slate-50 disabled:opacity-30 transition-all">←</button>
                {Array.from({ length: partnerTotalPages }, (_, i) => i + 1).map(p => (
                  <button key={p} onClick={() => setClientPage(p)}
                    className={`w-8 h-8 rounded-lg text-xs font-black transition-all ${partnerSafePage === p ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:bg-slate-50'}`}>
                    {p}
                  </button>
                ))}
                <button onClick={() => setClientPage(p => Math.min(partnerTotalPages, p + 1))} disabled={partnerSafePage === partnerTotalPages}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-400 hover:bg-slate-50 disabled:opacity-30 transition-all">→</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Partner Detail Modal */}
      {selectedClientIdForDetail && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={() => {
            setSelectedClientIdForDetail(null);
            setHistoryPage(1);
            setHistoryDateFilter('');
          }} />
          <div className="relative bg-white w-full max-w-2xl rounded-[40px] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 flex flex-col max-h-[90vh]">
            <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center space-x-4">
                <div className="w-14 h-14 bg-indigo-600 text-white rounded-2xl flex items-center justify-center shadow-lg">
                  <Users size={28} />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-slate-900">
                    {partners.find(c => c.id === selectedClientIdForDetail)?.name || '거래처 정보'}
                  </h3>
                  <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">파렛트 입출고 내역</p>
                </div>
              </div>
              <button onClick={() => {
                setSelectedClientIdForDetail(null);
                setHistoryPage(1);
                setHistoryDateFilter('');
              }} className="p-2 text-slate-400 hover:text-slate-900 hover:bg-white rounded-full transition-all">
                <X size={24} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
              {/* Current Status Summary */}
              <div className="space-y-4">
                <h4 className="text-sm font-black text-slate-800 uppercase tracking-widest flex items-center">
                  <Activity className="mr-2 text-indigo-500" size={16} />
                  현재 파렛트 잔량 (수지타산)
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {Object.entries(partnerPalletStatus.find(s => s.id === selectedClientIdForDetail)?.pallets || {}).map(([type, qty]) => (
                      <div key={type} className="bg-slate-50 p-6 rounded-3xl border border-slate-100 flex items-center justify-between">
                      <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{type}</p>
                        <p className={`text-2xl font-black ${qty > 0 ? 'text-emerald-600' : (qty < 0 ? 'text-rose-600' : 'text-slate-400')}`}>
                          {qty > 0 ? `+${qty}` : qty}개
                        </p>
                      </div>
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${qty > 0 ? 'bg-emerald-100 text-emerald-600' : (qty < 0 ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-400')}`}>
                        <Layers size={20} />
                      </div>
                    </div>
                  ))}
                  {Object.keys(partnerPalletStatus.find(s => s.id === selectedClientIdForDetail)?.pallets || {}).length === 0 && (
                    <div className="col-span-full py-8 text-center bg-slate-50 rounded-3xl border border-dashed border-slate-200 text-slate-400 text-sm font-bold">
                      기록된 파렛트 잔량이 없습니다.
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={() => { const partner = partners.find(c => c.id === selectedClientIdForDetail); if (partner) { setSelectedClientForTrans(partner); setTransType('in'); setIsTransactionModalOpen(true); } }}
                  className="flex-1 py-3.5 bg-emerald-600 text-white rounded-2xl font-black shadow-lg shadow-emerald-100 hover:bg-emerald-700 transition-all flex items-center justify-center gap-1.5 text-sm"
                >
                  <RefreshCw size={16} />
                  <span>회수</span>
                </button>
                <button
                  onClick={() => { const partner = partners.find(c => c.id === selectedClientIdForDetail); if (partner) { setSelectedClientForTrans(partner); setTransType('exchange'); setIsTransactionModalOpen(true); } }}
                  className="flex-1 py-3.5 bg-amber-500 text-white rounded-2xl font-black shadow-lg shadow-amber-100 hover:bg-amber-600 transition-all flex items-center justify-center gap-1.5 text-sm"
                >
                  <RefreshCw size={16} />
                  <span>교체</span>
                </button>
                <button
                  onClick={() => { const partner = partners.find(c => c.id === selectedClientIdForDetail); if (partner) { setSelectedClientForTrans(partner); setTransType('out'); setIsTransactionModalOpen(true); } }}
                  className="flex-1 py-3.5 bg-rose-600 text-white rounded-2xl font-black shadow-lg shadow-rose-100 hover:bg-rose-700 transition-all flex items-center justify-center gap-1.5 text-sm"
                >
                  <Plus size={16} />
                  <span>지급</span>
                </button>
              </div>

              {/* 교체중 — 헌 파레트 입고 확인 시 교체완료 */}
              {(() => {
                const pend = pendingExchanges.filter(t => t.partnerId === selectedClientIdForDetail);
                if (pend.length === 0) return null;
                return (
                  <div className="bg-violet-50/60 border border-violet-100 rounded-2xl p-4 space-y-2">
                    <p className="text-xs font-black text-violet-600">교체중 {pend.length}건 — 헌 파레트 입고 확인되면 완료 처리</p>
                    {pend.map(t => {
                      const pName = pallets.find(p => p.id === t.palletId)?.name || '기타';
                      const ret = t.exchangeReturnQty ?? t.quantity;
                      return (
                        <div key={t.id} className="flex items-center justify-between bg-white rounded-xl px-3 py-2 gap-2">
                          <div className="text-[11px] font-bold text-slate-600 min-w-0">
                            {pName} · 지급 {t.quantity}개 / 회수예정 {ret}개 <span className="text-slate-400">({t.date})</span>
                          </div>
                          <button onClick={() => completeExchange(t)} className="shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-black bg-violet-600 text-white hover:bg-violet-700 transition-colors">교체완료</button>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* History Table */}
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <h4 className="text-sm font-black text-slate-800 uppercase tracking-widest flex items-center">
                    <Clock className="mr-2 text-indigo-500" size={16} />
                    입출고 히스토리
                  </h4>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                    <input 
                      type="date" 
                      value={historyDateFilter}
                      onChange={(e) => {
                        setHistoryDateFilter(e.target.value);
                        setHistoryPage(1);
                      }}
                      className="pl-9 pr-4 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold text-slate-600 outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                    />
                    {historyDateFilter && (
                      <button 
                        onClick={() => {
                          setHistoryDateFilter('');
                          setHistoryPage(1);
                        }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="bg-white border border-slate-100 rounded-3xl overflow-hidden shadow-sm">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase">날짜</th>
                        <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase">구분</th>
                        <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase">종류</th>
                        <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase text-right">수량</th>
                        <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase text-center">관리</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {paginatedHistory.map(item => (
                        <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-6 py-4 text-xs font-bold text-slate-500">{item.date}</td>
                          <td className="px-6 py-4">
                            <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${item.type === 'in' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                              {item.type === 'in' ? '입고' : '출고'}
                            </span>
                            <p className="text-[10px] text-slate-400 mt-0.5">{item.note}</p>
                          </td>
                          <td className="px-6 py-4 text-xs font-bold text-slate-700">{item.palletName}</td>
                          <td className={`px-6 py-4 text-sm font-black text-right ${item.type === 'in' ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {item.type === 'in' ? '+' : '-'}{item.quantity}
                          </td>
                          <td className="px-6 py-4 text-center">
                            {item.txId ? (
                              <button onClick={() => deleteTransaction(item.txId!)} className="p-1 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded transition-colors" title="거래 삭제(정정)">
                                <Trash2 size={14} />
                              </button>
                            ) : <span className="text-[9px] text-slate-200">주문</span>}
                          </td>
                        </tr>
                      ))}
                      {paginatedHistory.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-6 py-10 text-center text-slate-400 text-xs font-bold italic">기록이 없습니다.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-center space-x-2 pt-2">
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                      <button
                        key={page}
                        onClick={() => setHistoryPage(page)}
                        className={`w-8 h-8 rounded-lg text-xs font-bold transition-all ${historyPage === page ? 'bg-indigo-600 text-white shadow-md' : 'bg-white text-slate-400 border border-slate-100 hover:bg-slate-50'}`}
                      >
                        {page}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Transaction Modal */}
      {isTransactionModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsTransactionModalOpen(false)} />
          <div className="relative bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
            <div className={`p-6 border-b border-slate-100 flex items-center justify-between ${transType === 'in' ? 'bg-emerald-50' : transType === 'exchange' ? 'bg-amber-50' : 'bg-rose-50'}`}>
              <div className="flex items-center space-x-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-lg ${transType === 'in' ? 'bg-emerald-600' : transType === 'exchange' ? 'bg-amber-500' : 'bg-rose-600'}`}>
                  <RefreshCw size={20} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    {transType === 'in' ? '파렛트 신규 입고' : transType === 'exchange' ? '파렛트 교체' : '파렛트 지급'}
                  </h3>
                  <p className="text-xs text-slate-500">{selectedClientForTrans ? selectedClientForTrans.name : '거래처를 선택하세요'}</p>
                </div>
              </div>
              <button onClick={() => setIsTransactionModalOpen(false)} className="p-2 text-slate-400 hover:text-slate-900 hover:bg-white/50 rounded-full transition-all">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleAddTransaction} className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">거래처</label>
                <select name="partnerId" required defaultValue={selectedClientForTrans?.id ?? ''} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">거래처 선택</option>
                  {[...partners].sort((a, b) => a.name.localeCompare(b.name)).map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">파렛트 종류</label>
                <select name="palletId" required className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">종류 선택</option>
                  {pallets.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {transType === 'exchange' ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2 text-[11px] font-bold text-amber-600 bg-amber-50 rounded-lg px-3 py-2">신 파레트를 지급하면 '교체중'으로 등록돼요. 헌 파레트가 입고되면 거래처 상세에서 '교체완료'를 누르세요.</div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">회수 예정(헌 파레트)</label>
                    <input name="returnQty" type="number" min="0" defaultValue={0} placeholder="회수 예정" className="w-full bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-400" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-rose-600 uppercase tracking-widest">지급(신 파레트)</label>
                    <input name="newQty" type="number" min="0" defaultValue={0} placeholder="지급" className="w-full bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-rose-400" />
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">수량</label>
                  <input name="quantity" type="number" required min="1" placeholder="수량 입력" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">비고 (선택)</label>
                <input name="note" type="text" placeholder="사유 등 입력" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>

              <div className="pt-4 flex space-x-3">
                <button type="button" onClick={() => setIsTransactionModalOpen(false)} className="flex-1 py-3 rounded-xl font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 transition-all">취소</button>
                <button type="submit" className={`flex-1 py-3 rounded-xl font-bold text-white shadow-lg transition-all ${transType === 'in' ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-100' : transType === 'exchange' ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-100' : 'bg-rose-600 hover:bg-rose-700 shadow-rose-100'}`}>
                  {transType === 'in' ? '입고 완료' : transType === 'exchange' ? '교체 등록(교체중)' : '지급 완료'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default PalletManager;
