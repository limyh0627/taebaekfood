
import React, { useState, useMemo } from 'react';
import {
  Users,
  Plus,
  Edit,
  Phone,
  Mail,
  Check,
  X,
  User,
  Truck,
  Store,
  LayoutGrid,
  Search,
  Trash2
} from 'lucide-react';
import RegionSelect from './RegionSelect';
import { Client, ClientType, PartnerType } from '../types';
import AddClientModal from './AddClientModal';
import ConfirmModal from './ConfirmModal';
import PageHeader from './PageHeader';

interface ClientManagerProps {
  clients: Client[];
  onUpdateClient: (_client: Client) => void;
  onAddClient: (_client: Client) => void;
  onDeleteClient: (_id: string) => void;
}

const ClientManager: React.FC<ClientManagerProps> = ({ clients, onUpdateClient, onAddClient, onDeleteClient }) => {
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ message: string; subMessage?: string; onConfirm: () => void } | null>(null);
  const [editForm, setEditForm] = useState<Client | null>(null);
  const [activeTab, setActiveTab] = useState<PartnerType | '전체'>('전체');
  const [activeTypeTab, setActiveTypeTab] = useState<ClientType | '전체'>('전체');
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 15;

  const partnerTabs: { id: PartnerType | '전체', label: string, color: string }[] = [
    { id: '전체', label: '전체', color: 'bg-slate-100 text-slate-600' },
    { id: '매출처', label: '매출처', color: 'bg-indigo-100 text-indigo-600' },
    { id: '매입처', label: '매입처', color: 'bg-orange-100 text-orange-600' },
    { id: '매출+매입처', label: '매출+매입처', color: 'bg-violet-100 text-violet-600' },
  ];

  const clientTypes: { id: ClientType | '전체', label: string, icon: any, color: string }[] = [
    { id: '전체', label: '전체', icon: LayoutGrid, color: 'bg-slate-100 text-slate-600' },
    { id: '일반', label: '일반 거래처', icon: User, color: 'bg-indigo-100 text-indigo-600' },
    { id: '택배', label: '택배사/대행', icon: Truck, color: 'bg-pink-100 text-pink-600' },
    { id: '스마트스토어', label: '스마트스토어', icon: Store, color: 'bg-lime-100 text-lime-600' },
  ];

  const getEffectivePartnerType = (c: Client): PartnerType => c.partnerType ?? '매출처';

  const filteredClients = useMemo(() => {
    let result = clients;

    if (activeTab !== '전체') {
      result = result.filter(c => getEffectivePartnerType(c) === activeTab);
    }

    // 매출처 계열일 때 type 서브탭 필터
    if (activeTypeTab !== '전체' && (activeTab === '매출처' || activeTab === '전체')) {
      result = result.filter(c => c.type === activeTypeTab);
    }

    if (searchTerm.trim() !== '') {
      result = result.filter(c =>
        c.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    return [...result].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }, [clients, activeTab, activeTypeTab, searchTerm]);

  const totalPages = Math.max(1, Math.ceil(filteredClients.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedClients = filteredClients.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const startEditing = (client: Client) => {
    setEditingClientId(client.id);
    setEditForm({ ...client });
  };

  const cancelEditing = () => {
    setEditingClientId(null);
    setEditForm(null);
  };

  const saveEditing = () => {
    if (editForm) {
      onUpdateClient(editForm);
      cancelEditing();
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-300 h-full flex flex-col">
      <PageHeader
        title="거래처 관리"
        subtitle="거래처 정보를 관리하고 성격별로 분류하세요."
        right={
          <button onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2.5 rounded-xl text-sm font-black hover:bg-indigo-700 transition-all shadow-sm">
            <Plus size={15} /><span>거래처 등록</span>
          </button>
        }
      />

      <div className="flex flex-col space-y-4">
        {/* PartnerType Filter Tabs */}
        <div className="flex items-center space-x-2 overflow-x-auto pb-2 no-scrollbar">
          {partnerTabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); setActiveTypeTab('전체'); setPage(1); }}
                className={`flex items-center space-x-2.5 px-5 py-3 rounded-2xl transition-all whitespace-nowrap border ${
                  isActive
                    ? 'bg-white border-indigo-200 text-indigo-600 shadow-sm ring-1 ring-indigo-50'
                    : 'bg-white border-slate-100 text-slate-500 hover:border-slate-200'
                }`}
              >
                <span className="font-bold text-sm">{tab.label}</span>
                <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400">
                  {tab.id === '전체' ? clients.length : clients.filter(c => getEffectivePartnerType(c) === tab.id).length}
                </span>
              </button>
            );
          })}
        </div>

        {/* Type Sub-tabs (매출처 계열일 때만) */}
        {(activeTab === '매출처' || activeTab === '전체') && (
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {clientTypes.filter(t => t.id !== '전체').map(t => {
              const Icon = t.icon;
              const isActive = activeTypeTab === t.id;
              const count = clients
                .filter(c => activeTab === '전체' || getEffectivePartnerType(c) === activeTab)
                .filter(c => c.type === t.id).length;
              return (
                <button
                  key={t.id}
                  onClick={() => { setActiveTypeTab(isActive ? '전체' : t.id); setPage(1); }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-black whitespace-nowrap transition-all border ${
                    isActive ? `${t.color} border-current shadow-sm` : 'bg-white border-slate-100 text-slate-400 hover:border-slate-200'
                  }`}
                >
                  <Icon size={12} />
                  <span>{t.label}</span>
                  <span className="text-[9px] opacity-60">{count}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Search Bar */}
        <div className="relative max-w-md animate-in fade-in slide-in-from-top-2 duration-300">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text"
            placeholder={`${activeTab === '전체' ? '전체' : activeTab} 거래처 검색...`}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-2xl pl-12 pr-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm transition-all"
          />
          {searchTerm && (
            <button 
              onClick={() => setSearchTerm('')}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {pagedClients.map((client) => {
          const isEditing = editingClientId === client.id;
          const currentTypeConfig = clientTypes.find(t => t.id === (isEditing ? editForm?.type : client.type)) || clientTypes[1];
          const TypeIcon = currentTypeConfig.icon;

          return (
            <div key={client.id} className={`bg-white rounded-2xl border transition-all duration-300 ${isEditing ? 'ring-2 ring-indigo-500 border-indigo-200 shadow-xl col-span-full' : 'border-slate-100 shadow-sm hover:shadow-md'}`}>
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3 min-w-0">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${currentTypeConfig.color}`}>
                      <TypeIcon size={18} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editForm?.name}
                            onChange={(e) => setEditForm(prev => prev ? {...prev, name: e.target.value} : null)}
                            className="text-sm font-bold text-slate-900 border-b border-indigo-200 outline-none bg-transparent"
                            placeholder="거래처명 입력"
                          />
                        ) : (
                          <h3 className="text-sm font-bold text-slate-900 truncate">{client.name}</h3>
                        )}
                        {!isEditing && (() => {
                          const pt = getEffectivePartnerType(client);
                          const ptColor = pt === '매출처' ? 'bg-indigo-100 text-indigo-600' : pt === '매입처' ? 'bg-orange-100 text-orange-600' : 'bg-violet-100 text-violet-600';
                          return <span className={`px-1.5 py-0.5 rounded text-[9px] font-black flex-shrink-0 ${ptColor}`}>{pt}</span>;
                        })()}
                        {!isEditing && (getEffectivePartnerType(client) === '매출처' || getEffectivePartnerType(client) === '매출+매입처') && (
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-black flex-shrink-0 ${currentTypeConfig.color}`}>
                            {client.type}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-slate-400">
                        <div className="flex items-center text-[11px]">
                          <Phone size={11} className="mr-1" />
                          {isEditing ? <input type="text" value={editForm?.phone} onChange={(e) => setEditForm(prev => prev ? {...prev, phone: e.target.value} : null)} className="border-b border-slate-200 outline-none w-28 bg-transparent text-[11px]" /> : client.phone}
                        </div>
                        <div className="flex items-center text-[11px]">
                          <Mail size={11} className="mr-1" />
                          {isEditing ? <input type="text" value={editForm?.email} onChange={(e) => setEditForm(prev => prev ? {...prev, email: e.target.value} : null)} className="border-b border-slate-200 outline-none w-36 bg-transparent text-[11px]" /> : client.email}
                        </div>
                        <div className="flex items-center text-[11px]">
                          <LayoutGrid size={11} className="mr-1" />
                          {isEditing ? (
                            <RegionSelect
                              compact
                              value={editForm?.region || ''}
                              onChange={(v) => setEditForm(prev => prev ? {...prev, region: v} : null)}
                            />
                          ) : (
                            <span className="font-bold text-slate-600">{client.region || '미지정'}</span>
                          )}
                        </div>
                        {isEditing && (
                          <>
                            <select value={editForm?.partnerType ?? '매출처'} onChange={(e) => setEditForm(prev => prev ? {...prev, partnerType: e.target.value as PartnerType} : null)} className="text-[11px] font-bold text-orange-600 bg-orange-50 border-none rounded px-1.5 py-0.5 outline-none">
                              <option value="매출처">매출처</option>
                              <option value="매입처">매입처</option>
                              <option value="매출+매입처">매출+매입처</option>
                            </select>
                            {(editForm?.partnerType === '매출처' || editForm?.partnerType === '매출+매입처' || !editForm?.partnerType) && (
                              <select value={editForm?.type} onChange={(e) => setEditForm(prev => prev ? {...prev, type: e.target.value as ClientType} : null)} className="text-[11px] font-bold text-indigo-600 bg-indigo-50 border-none rounded px-1.5 py-0.5 outline-none">
                                <option value="일반">일반</option>
                                <option value="택배">택배</option>
                                <option value="스마트스토어">스마트스토어</option>
                              </select>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  {!isEditing ? (
                    <button onClick={() => startEditing(client)} className="p-1.5 text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all flex-shrink-0">
                      <Edit size={15} />
                    </button>
                  ) : (
                    <div className="flex items-center space-x-1.5 flex-shrink-0">
                      <button onClick={saveEditing} className="p-1.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700">
                        <Check size={15} />
                      </button>
                      <button onClick={() => setConfirmModal({
                          message: `"${client.name}" 거래처를 삭제하시겠습니까?`,
                          subMessage: '연결된 주문 및 품목 데이터에 영향을 줄 수 있습니다.',
                          onConfirm: () => { onDeleteClient(client.id); cancelEditing(); setConfirmModal(null); },
                        })} className="p-1.5 bg-rose-50 text-rose-400 rounded-xl hover:bg-rose-100 hover:text-rose-600">
                        <Trash2 size={15} />
                      </button>
                      <button onClick={cancelEditing} className="p-1.5 bg-slate-100 text-slate-500 rounded-xl hover:bg-slate-200">
                        <X size={15} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        </div>
        {filteredClients.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 bg-white rounded-3xl border-2 border-dashed border-slate-200 mt-3">
            <Users className="text-slate-200 mb-4" size={48} />
            <p className="text-slate-400 font-bold">
              {searchTerm
                ? `"${searchTerm}"에 대한 검색 결과가 없습니다.`
                : "해당 카테고리의 거래처가 없습니다."}
            </p>
          </div>
        )}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-1 py-4 mt-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}
              className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-400 hover:bg-white disabled:opacity-30 transition-all">←</button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
              <button key={p} onClick={() => setPage(p)}
                className={`w-8 h-8 rounded-lg text-xs font-black transition-all ${safePage === p ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:bg-white'}`}>
                {p}
              </button>
            ))}
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
              className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-400 hover:bg-white disabled:opacity-30 transition-all">→</button>
          </div>
        )}
      </div>

      {isAddModalOpen && (
        <AddClientModal
          onClose={() => setIsAddModalOpen(false)}
          onSave={(newClient) => {
            onAddClient(newClient);
            setIsAddModalOpen(false);
          }}
        />
      )}
      {confirmModal && (
        <ConfirmModal
          message={confirmModal.message}
          subMessage={confirmModal.subMessage}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}
    </div>
  );
};

export default ClientManager;
