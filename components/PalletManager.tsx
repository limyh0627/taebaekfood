
import React, { useState, useMemo } from 'react';
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
  Search
} from 'lucide-react';
import { PalletStock, Order, Client, OrderStatus, PalletTransaction } from '../types';

interface PalletManagerProps {
  pallets: PalletStock[];
  orders: Order[];
  clients: Client[];
  palletTransactions: PalletTransaction[];
  onUpdatePallet: (_pallet: PalletStock) => void;
  onAddPalletTransaction: (_transaction: PalletTransaction) => void;
}

const PalletManager: React.FC<PalletManagerProps> = ({ 
  pallets, 
  orders, 
  clients, 
  palletTransactions,
  onUpdatePallet,
  onAddPalletTransaction
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'clients'>('clients');
  const [searchTerm, setSearchTerm] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<PalletStock | null>(null);
  const [isTransactionModalOpen, setIsTransactionModalOpen] = useState(false);
  const [selectedClientForTrans, setSelectedClientForTrans] = useState<Client | null>(null);
  const [transType, setTransType] = useState<'in' | 'out'>('in');
  const [selectedClientIdForDetail, setSelectedClientIdForDetail] = useState<string | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyDateFilter, setHistoryDateFilter] = useState('');

  const ITEMS_PER_PAGE = 5;

  const clientPalletStatus = useMemo(() => {
    const stats: Record<string, { name: string; pallets: Record<string, number> }> = {};
    
    // Initialize with all clients
    clients.forEach(client => {
      stats[client.id] = { name: client.name, pallets: {} };
    });

    // Add from orders
    orders
      .filter(o => o.pallets && o.pallets.length > 0 && (o.status === OrderStatus.SHIPPED || o.status === OrderStatus.DISPATCHED))
      .forEach(order => {
        const clientId = order.clientId || 'unknown';
        if (!stats[clientId]) stats[clientId] = { name: order.customerName, pallets: {} };
        
        order.pallets?.forEach(p => {
          const pType = p.type || '기타';
          const qty = p.quantity || 0;
          if (!stats[clientId].pallets[pType]) stats[clientId].pallets[pType] = 0;
          stats[clientId].pallets[pType] -= qty; // Outbound -> balance down (-)
        });
      });

    // Add/Subtract from manual transactions
    palletTransactions.forEach(trans => {
      const clientId = trans.clientId;
      if (!stats[clientId]) {
        const client = clients.find(c => c.id === clientId);
        stats[clientId] = { name: client?.name || '알 수 없는 거래처', pallets: {} };
      }
      
      const pallet = pallets.find(p => p.id === trans.palletId);
      const pType = pallet?.name || '기타';
      
      if (!stats[clientId].pallets[pType]) stats[clientId].pallets[pType] = 0;
      
      if (trans.type === 'in') {
        stats[clientId].pallets[pType] += trans.quantity; // Inbound -> balance up (+)
      } else {
        stats[clientId].pallets[pType] -= trans.quantity; // Outbound -> balance down (-)
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
  }, [orders, clients, palletTransactions, pallets, searchTerm]);

  const CLIENT_PAGE_SIZE = 15;
  const [clientPage, setClientPage] = useState(1);
  const clientTotalPages = Math.max(1, Math.ceil(clientPalletStatus.length / CLIENT_PAGE_SIZE));
  const clientSafePage = Math.min(clientPage, clientTotalPages);
  const pagedClientPalletStatus = clientPalletStatus.slice((clientSafePage - 1) * CLIENT_PAGE_SIZE, clientSafePage * CLIENT_PAGE_SIZE);

  const clientHistory = useMemo(() => {
    if (!selectedClientIdForDetail) return [];

    const history: { id: string; type: 'in' | 'out'; quantity: number; date: string; note: string; palletName: string }[] = [];

    // From manual transactions
    palletTransactions
      .filter(t => t.clientId === selectedClientIdForDetail)
      .forEach(t => {
        const pallet = pallets.find(p => p.id === t.palletId);
        history.push({
          id: t.id,
          type: t.type,
          quantity: t.quantity,
          date: t.date,
          note: t.note || (t.type === 'in' ? '수동 입고' : '수동 출고'),
          palletName: pallet?.name || '기타'
        });
      });

    // From orders
    orders
      .filter(o => o.clientId === selectedClientIdForDetail && o.pallets && o.pallets.length > 0 && (o.status === OrderStatus.SHIPPED || o.status === OrderStatus.DISPATCHED))
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
    return clientHistory.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [clientHistory, historyPage]);

  const totalPages = Math.ceil(clientHistory.length / ITEMS_PER_PAGE);

  const handleAddTransaction = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const palletId = formData.get('palletId') as string;
    const quantity = parseInt(formData.get('quantity') as string) || 0;
    const note = formData.get('note') as string;

    if (!selectedClientForTrans || !palletId || quantity <= 0) return;

    const newTransaction: PalletTransaction = {
      id: `ptrans-${Date.now()}`,
      clientId: selectedClientForTrans.id,
      palletId,
      type: transType,
      quantity,
      date: new Date().toISOString().split('T')[0],
      note
    };

    onAddPalletTransaction(newTransaction);
    
    // Update PalletStock inUse
    const pallet = pallets.find(p => p.id === palletId);
    if (pallet) {
      const updatedPallet = { ...pallet };
      if (transType === 'in') {
        updatedPallet.inUse = Math.max(0, pallet.inUse - quantity);
      } else {
        updatedPallet.inUse = pallet.inUse + quantity;
      }
      onUpdatePallet(updatedPallet);
    }

    setIsTransactionModalOpen(false);
    setSelectedClientForTrans(null);
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
    <div className="space-y-8 animate-in slide-in-from-right-4 duration-500 h-full flex flex-col">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-3xl font-bold text-slate-900">파렛트 자산 관리</h2>
          <p className="text-slate-500">실제 현장 출고 데이터를 기반으로 한 파렛트 순환 현황입니다.</p>
        </div>
        
        <div className="bg-white p-1 rounded-xl border border-slate-200 flex items-center shadow-sm self-start">
          <button 
            onClick={() => setActiveTab('clients')} 
            className={`px-4 py-2 rounded-lg flex items-center space-x-2 transition-all ${activeTab === 'clients' ? 'bg-amber-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-50'}`}
          >
            <Users size={16} />
            <span className="text-xs font-bold">거래처별 현황</span>
          </button>
          <button 
            onClick={() => setActiveTab('overview')} 
            className={`px-4 py-2 rounded-lg flex items-center space-x-2 transition-all ${activeTab === 'overview' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-50'}`}
          >
            <Layers size={16} />
            <span className="text-xs font-bold">전체 재고</span>
          </button>
        </div>
      </div>

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
      ) : (
        <div className="space-y-4 animate-in fade-in duration-300">
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
            <div className="flex items-center space-x-2 text-[10px] font-black text-slate-400 uppercase tracking-widest px-4">
              <Activity size={14} className="text-indigo-500" />
              <span>미회수 거래처 우선 정렬됨</span>
            </div>
          </div>

          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-slate-50/50 border-b border-slate-100">
                <tr>
                  <th className="px-3 py-3 text-xs font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">거래처</th>
                  <th className="px-3 py-3 text-xs font-bold text-slate-400 uppercase tracking-widest">파렛트 현황</th>
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
                          {Object.entries(status.pallets).map(([type, qty]) => (
                            qty !== 0 && (
                              <div key={type} className={`flex items-center space-x-1 px-2 py-1 rounded-lg border ${qty > 0 ? 'bg-amber-50 border-amber-100' : 'bg-emerald-50 border-emerald-100'}`}>
                                <span className={`text-[11px] font-bold whitespace-nowrap ${qty > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{type}: {qty > 0 ? `+${qty}` : qty}개</span>
                              </div>
                            )
                          ))}
                          {Object.values(status.pallets).every(v => v === 0) && <span className="text-[10px] text-slate-300 italic">잔량 없음</span>}
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={2} className="px-8 py-20 text-center">
                      <div className="flex flex-col items-center">
                        <Layers size={48} className="text-slate-100 mb-4" />
                        <p className="text-slate-400 font-bold">검색 결과가 없거나 출고된 파렛트가 없습니다.</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {clientTotalPages > 1 && (
              <div className="flex items-center justify-center gap-1 py-4 border-t border-slate-100">
                <button onClick={() => setClientPage(p => Math.max(1, p - 1))} disabled={clientSafePage === 1}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-400 hover:bg-slate-50 disabled:opacity-30 transition-all">←</button>
                {Array.from({ length: clientTotalPages }, (_, i) => i + 1).map(p => (
                  <button key={p} onClick={() => setClientPage(p)}
                    className={`w-8 h-8 rounded-lg text-xs font-black transition-all ${clientSafePage === p ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:bg-slate-50'}`}>
                    {p}
                  </button>
                ))}
                <button onClick={() => setClientPage(p => Math.min(clientTotalPages, p + 1))} disabled={clientSafePage === clientTotalPages}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-400 hover:bg-slate-50 disabled:opacity-30 transition-all">→</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Client Detail Modal */}
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
                    {clients.find(c => c.id === selectedClientIdForDetail)?.name || '거래처 정보'}
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
                  {Object.entries(clientPalletStatus.find(s => s.id === selectedClientIdForDetail)?.pallets || {}).map(([type, qty]) => (
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
                  {Object.keys(clientPalletStatus.find(s => s.id === selectedClientIdForDetail)?.pallets || {}).length === 0 && (
                    <div className="col-span-full py-8 text-center bg-slate-50 rounded-3xl border border-dashed border-slate-200 text-slate-400 text-sm font-bold">
                      기록된 파렛트 잔량이 없습니다.
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex space-x-4">
                <button 
                  onClick={() => {
                    const client = clients.find(c => c.id === selectedClientIdForDetail);
                    if (client) {
                      setSelectedClientForTrans(client);
                      setTransType('in');
                      setIsTransactionModalOpen(true);
                    }
                  }}
                  className="flex-1 py-4 bg-emerald-600 text-white rounded-2xl font-black shadow-lg shadow-emerald-100 hover:bg-emerald-700 transition-all flex items-center justify-center space-x-2"
                >
                  <RefreshCw size={18} />
                  <span>파렛트 회수 (입고)</span>
                </button>
                <button 
                  onClick={() => {
                    const client = clients.find(c => c.id === selectedClientIdForDetail);
                    if (client) {
                      setSelectedClientForTrans(client);
                      setTransType('out');
                      setIsTransactionModalOpen(true);
                    }
                  }}
                  className="flex-1 py-4 bg-rose-600 text-white rounded-2xl font-black shadow-lg shadow-rose-100 hover:bg-rose-700 transition-all flex items-center justify-center space-x-2"
                >
                  <Plus size={18} />
                  <span>파렛트 지급 (출고)</span>
                </button>
              </div>

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
                        </tr>
                      ))}
                      {paginatedHistory.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-6 py-10 text-center text-slate-400 text-xs font-bold italic">기록이 없습니다.</td>
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
      {isTransactionModalOpen && selectedClientForTrans && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsTransactionModalOpen(false)} />
          <div className="relative bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
            <div className={`p-6 border-b border-slate-100 flex items-center justify-between ${transType === 'in' ? 'bg-emerald-50' : 'bg-rose-50'}`}>
              <div className="flex items-center space-x-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-lg ${transType === 'in' ? 'bg-emerald-600' : 'bg-rose-600'}`}>
                  <RefreshCw size={20} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">파렛트 {transType === 'in' ? '입고 (회수)' : '출고 (추가)'}</h3>
                  <p className="text-xs text-slate-500">{selectedClientForTrans.name}</p>
                </div>
              </div>
              <button onClick={() => setIsTransactionModalOpen(false)} className="p-2 text-slate-400 hover:text-slate-900 hover:bg-white/50 rounded-full transition-all">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleAddTransaction} className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">파렛트 종류</label>
                <select name="palletId" required className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">종류 선택</option>
                  {pallets.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">수량</label>
                <input 
                  name="quantity" 
                  type="number" 
                  required 
                  min="1"
                  placeholder="수량 입력"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">비고 (선택)</label>
                <input 
                  name="note" 
                  type="text" 
                  placeholder="사유 등 입력"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="pt-4 flex space-x-3">
                <button 
                  type="button" 
                  onClick={() => setIsTransactionModalOpen(false)}
                  className="flex-1 py-3 rounded-xl font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 transition-all"
                >
                  취소
                </button>
                <button 
                  type="submit"
                  className={`flex-1 py-3 rounded-xl font-bold text-white shadow-lg transition-all ${transType === 'in' ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-100' : 'bg-rose-600 hover:bg-rose-700 shadow-rose-100'}`}
                >
                  {transType === 'in' ? '입고 완료' : '출고 완료'}
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
