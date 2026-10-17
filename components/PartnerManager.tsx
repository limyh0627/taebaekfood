import { PartnerEditModal } from '../src/features/partners/ui/PartnerEditModal';
import ActionButton from '../src/shared/components/ActionButton';

import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  Users,
  Plus,
  Edit,
  Phone,
  Mail,
  User,
  Truck,
  Store,
  LayoutGrid,
  Search,
  Trash2,
  MapPin,
  X,
  Check,
} from 'lucide-react';
import RegionSelect from './RegionSelect';
import { Partner, PartnerChannel, PartnerType } from '../types';

//  window.daum 타입은 [AddPartnerModal](AddPartnerModal.tsx) 이 한 번만 선언한다
import AddPartnerModal, { partnerSaveErrorMessage } from './AddPartnerModal';
import ConfirmModal from './ConfirmModal';
import PageHeader from './PageHeader';
import { isShipMethod, isShippingPartner } from '../src/shared/partnerShipping';
import type { ShipMethod } from '../src/shared/types';

interface PartnerManagerProps {
  partners: Partner[];
  onUpdateClient: (_client: Partner) => void | Promise<unknown>;
  onAddClient: (_client: Partner) => void | Promise<unknown>;
  onDeleteClient: (_id: string) => void;
}

const PartnerManager: React.FC<PartnerManagerProps> = ({ partners, onUpdateClient, onAddClient, onDeleteClient }) => {
  const [editForm, setEditForm] = useState<Partner | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ message: string; subMessage?: string; onConfirm: () => void } | null>(null);
  const [activeTab, setActiveTab] = useState<PartnerType | '전체'>('전체');
  const [activeTypeTab, setActiveTypeTab] = useState<PartnerChannel | '전체'>('전체');
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const savingRef = useRef(false);
  const formGeneration = useRef(0);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; formGeneration.current += 1; }; }, []);
  const openEditing = (partner: Partner) => {
    if (savingRef.current) return;
    formGeneration.current += 1;
    setSaveError('');
    setEditForm({ ...partner });
  };
  const closeEditing = () => {
    if (savingRef.current) return;
    formGeneration.current += 1;
    setSaveError('');
    setEditForm(null);
  };
  const PAGE_SIZE = 15;

  const partnerTabs: { id: PartnerType | '전체', label: string }[] = [
    { id: '전체', label: '전체' },
    { id: '매출처', label: '매출처' },
    { id: '매입처', label: '매입처' },
    { id: '매출+매입처', label: '매출+매입처' },
    { id: '금융기관', label: '금융기관' },
  ];

  const partnerChannelTypes: { id: PartnerChannel | '전체', label: string, icon: any, color: string }[] = [
    { id: '전체', label: '전체', icon: LayoutGrid, color: 'bg-slate-100 text-slate-600' },
    { id: '일반', label: '일반 거래처', icon: User, color: 'bg-indigo-100 text-indigo-600' },
    { id: '택배', label: '택배사/대행', icon: Truck, color: 'bg-pink-100 text-pink-600' },
    { id: '스마트스토어', label: '스마트스토어', icon: Store, color: 'bg-lime-100 text-lime-600' },
  ];

  const activePartners = useMemo(() => partners.filter(partner => partner.archived !== true), [partners]);

  const getEffectivePartnerType = (c: Partner): PartnerType => c.partnerType ?? '매출처';

  const filteredClients = useMemo(() => {
    let result = activePartners;
    if (activeTab !== '전체') result = result.filter(c => getEffectivePartnerType(c) === activeTab);
    if (activeTypeTab !== '전체' && (activeTab === '매출처' || activeTab === '전체')) {
      result = result.filter(c => c.type === activeTypeTab);
    }
    if (searchTerm.trim() !== '') {
      result = result.filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()));
    }
    return [...result].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }, [activePartners, activeTab, activeTypeTab, searchTerm]);

  const totalPages = Math.max(1, Math.ceil(filteredClients.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedClients = filteredClients.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const saveEditing = async () => {
    if (!editForm || savingRef.current || !mounted.current) return;
    const generation = formGeneration.current;
    savingRef.current = true;
    setIsSaving(true);
    setSaveError('');
    try {
      await onUpdateClient(editForm);
      if (mounted.current && generation === formGeneration.current) setEditForm(null);
    } catch (error) {
      if (mounted.current && generation === formGeneration.current) setSaveError(partnerSaveErrorMessage(error));
    } finally {
      savingRef.current = false;
      if (mounted.current && generation === formGeneration.current) setIsSaving(false);
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-300 h-full flex flex-col">
      <PageHeader
        title="거래처 관리"
        subtitle="거래처 정보를 관리하고 성격별로 분류하세요."
        right={
          <ActionButton tone="primary" disabled={isSaving} onClick={() => { if (!savingRef.current) setIsAddModalOpen(true); }}>
            <Plus size={15} /><span>거래처 등록</span>
          </ActionButton>
        }
      />

      <div className="flex flex-col space-y-4">
        <div className="flex items-center space-x-2 overflow-x-auto pb-2 no-scrollbar">
          {partnerTabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); setActiveTypeTab('전체'); setPage(1); setSearchTerm(''); }}
                className={`flex items-center space-x-2 px-4 py-2 rounded-xl transition-all whitespace-nowrap border text-sm ${
                  isActive ? 'bg-white border-indigo-200 text-indigo-600 shadow-sm ring-1 ring-indigo-50' : 'bg-white border-slate-100 text-slate-500 hover:border-slate-200'
                }`}
              >
                <span className="font-bold text-sm">{tab.label}</span>
                <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400">
                  {tab.id === '전체' ? activePartners.length : activePartners.filter(c => getEffectivePartnerType(c) === tab.id).length}
                </span>
              </button>
            );
          })}
        </div>

        {(activeTab === '매출처' || activeTab === '전체') && (
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {partnerChannelTypes.filter(t => t.id !== '전체').map(t => {
              const Icon = t.icon;
              const isActive = activeTypeTab === t.id;
              const count = activePartners
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
            <button onClick={() => setSearchTerm('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {pagedClients.map((partner) => {
            const currentTypeConfig = partnerChannelTypes.find(t => t.id === partner.type) || partnerChannelTypes[1];
            const TypeIcon = currentTypeConfig.icon;
            const pt = getEffectivePartnerType(partner);
            const ptColor = pt === '매출처' ? 'bg-indigo-100 text-indigo-600'
              : pt === '매입처' ? 'bg-orange-100 text-orange-600'
              : pt === '금융기관' ? 'bg-slate-200 text-slate-600'
              : 'bg-violet-100 text-violet-600';
            const fullAddress = [partner.address, partner.addressDetail].filter(Boolean).join(' ');

            return (
              <div key={partner.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all">
                <div className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3 min-w-0">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${currentTypeConfig.color}`}>
                        <TypeIcon size={18} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-bold text-slate-900 truncate">{partner.name}</h3>
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-black flex-shrink-0 ${ptColor}`}>{pt}</span>
                          {(pt === '매출처' || pt === '매출+매입처') && (
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-black flex-shrink-0 ${currentTypeConfig.color}`}>{partner.type}</span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-slate-400">
                          {isShippingPartner(partner.partnerType) && <div className="text-[11px] text-slate-500">기본 배송방식: {isShipMethod(partner.defaultShipMethod) ? partner.defaultShipMethod : '미설정'}</div>}
                          {partner.ownerName && <div className="flex items-center text-[11px] font-bold text-slate-500">{partner.ownerName}</div>}
                          {partner.bizNo && <div className="text-[11px]">{partner.bizNo}</div>}
                          {(partner.tel || partner.mobile || partner.phone) && <div className="flex items-center text-[11px]"><Phone size={11} className="mr-1" />{partner.tel || partner.mobile || partner.phone}</div>}
                          {partner.email && <div className="flex items-center text-[11px]"><Mail size={11} className="mr-1" />{partner.email}</div>}
                          {partner.region && <div className="flex items-center text-[11px]"><LayoutGrid size={11} className="mr-1" /><span className="font-bold text-slate-600">{partner.region}</span></div>}
                          {fullAddress && (
                            <div className="flex items-center text-[11px] w-full mt-0.5">
                              <MapPin size={11} className="mr-1 flex-shrink-0" />
                              <span className="text-slate-500 truncate">{fullAddress}</span>
                            </div>
                          )}
                          {partner.note && (
                            <div className="text-[11px] w-full mt-0.5 text-slate-400 italic truncate">{partner.note}</div>
                          )}
                        </div>
                      </div>
                    </div>
                    <button
                      disabled={isSaving} aria-label={partner.name+' 수정'} onClick={() => openEditing(partner)}
                      className="p-1.5 text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all flex-shrink-0"
                    >
                      <Edit size={15} />
                    </button>
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
              {searchTerm ? `"${searchTerm}"에 대한 검색 결과가 없습니다.` : '해당 카테고리의 거래처가 없습니다.'}
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

      {/* 수정 오버레이 모달 */}
      {editForm && (
        <PartnerEditModal editForm={editForm} setEditForm={setEditForm} isSaving={isSaving} saveError={saveError}
          onClose={closeEditing} onSave={saveEditing} onDelete={() => { if (!savingRef.current) setConfirmModal({
                  message: `"${editForm.name}" 거래처를 삭제하시겠습니까?`,
                  subMessage: '연결된 주문 및 품목 데이터에 영향을 줄 수 있습니다.',
                  onConfirm: () => { onDeleteClient(editForm.id); setEditForm(null); setConfirmModal(null); },
                }); }} onSearchAddress={() => {
                      const generation = formGeneration.current;
                      const partnerId = editForm.id;
                      new window.daum.Postcode({
                        oncomplete: (data) => {
                          if (mounted.current && !savingRef.current && generation === formGeneration.current) setEditForm(prev => prev?.id === partnerId ? { ...prev, address: data.address } : prev);
                        },
                      }).open();
                    }} />
      )}

      {isAddModalOpen && (
        <AddPartnerModal
          onClose={() => setIsAddModalOpen(false)}
          onSave={onAddClient}
          onOpenExisting={openEditing}
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

export default PartnerManager;
