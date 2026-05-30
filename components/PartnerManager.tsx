
import React, { useState, useMemo } from 'react';
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

declare global {
  interface Window {
    daum: { Postcode: new (config: { oncomplete: (data: { address: string }) => void }) => { open: () => void } };
  }
}
import AddPartnerModal from './AddPartnerModal';
import ConfirmModal from './ConfirmModal';
import PageHeader from './PageHeader';

interface PartnerManagerProps {
  partners: Partner[];
  onUpdateClient: (_client: Partner) => void;
  onAddClient: (_client: Partner) => void;
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
  const PAGE_SIZE = 15;

  const partnerTabs: { id: PartnerType | '전체', label: string }[] = [
    { id: '전체', label: '전체' },
    { id: '매출처', label: '매출처' },
    { id: '매입처', label: '매입처' },
    { id: '매출+매입처', label: '매출+매입처' },
  ];

  const partnerChannelTypes: { id: PartnerChannel | '전체', label: string, icon: any, color: string }[] = [
    { id: '전체', label: '전체', icon: LayoutGrid, color: 'bg-slate-100 text-slate-600' },
    { id: '일반', label: '일반 거래처', icon: User, color: 'bg-indigo-100 text-indigo-600' },
    { id: '택배', label: '택배사/대행', icon: Truck, color: 'bg-pink-100 text-pink-600' },
    { id: '스마트스토어', label: '스마트스토어', icon: Store, color: 'bg-lime-100 text-lime-600' },
  ];

  const getEffectivePartnerType = (c: Partner): PartnerType => c.partnerType ?? '매출처';

  const filteredClients = useMemo(() => {
    let result = partners;
    if (activeTab !== '전체') result = result.filter(c => getEffectivePartnerType(c) === activeTab);
    if (activeTypeTab !== '전체' && (activeTab === '매출처' || activeTab === '전체')) {
      result = result.filter(c => c.type === activeTypeTab);
    }
    if (searchTerm.trim() !== '') {
      result = result.filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()));
    }
    return [...result].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }, [partners, activeTab, activeTypeTab, searchTerm]);

  const totalPages = Math.max(1, Math.ceil(filteredClients.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedClients = filteredClients.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const saveEditing = () => {
    if (editForm) {
      onUpdateClient(editForm);
      setEditForm(null);
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
                  {tab.id === '전체' ? partners.length : partners.filter(c => getEffectivePartnerType(c) === tab.id).length}
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
              const count = partners
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
            const ptColor = pt === '매출처' ? 'bg-indigo-100 text-indigo-600' : pt === '매입처' ? 'bg-orange-100 text-orange-600' : 'bg-violet-100 text-violet-600';
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
                      onClick={() => setEditForm({ ...partner })}
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
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setEditForm(null)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            {/* 헤더 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h2 className="text-base font-black text-slate-800">거래처 수정</h2>
              <button onClick={() => setEditForm(null)} className="w-8 h-8 flex items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100">
                <X size={18} />
              </button>
            </div>

            {/* 폼 */}
            <div className="px-6 py-5 space-y-4 overflow-y-auto max-h-[70vh]">
              {/* 거래처명 */}
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">거래처명</label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={e => setEditForm(prev => prev ? { ...prev, name: e.target.value } : null)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="거래처명"
                />
              </div>

              {/* 대표자 / 사업자번호 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">대표자</label>
                  <input
                    type="text"
                    value={editForm.ownerName || ''}
                    onChange={e => setEditForm(prev => prev ? { ...prev, ownerName: e.target.value } : null)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="대표자명"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">사업자번호</label>
                  <input
                    type="text"
                    value={editForm.bizNo || ''}
                    onChange={e => setEditForm(prev => prev ? { ...prev, bizNo: e.target.value } : null)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="000-00-00000"
                  />
                </div>
              </div>

              {/* 대표전화 / 핸드폰 / 팩스 */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">대표전화</label>
                  <input
                    type="text"
                    value={editForm.tel || ''}
                    onChange={e => setEditForm(prev => prev ? { ...prev, tel: e.target.value } : null)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="02-0000-0000"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">핸드폰</label>
                  <input
                    type="text"
                    value={editForm.mobile || editForm.phone || ''}
                    onChange={e => setEditForm(prev => prev ? { ...prev, mobile: e.target.value, phone: e.target.value } : null)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="010-0000-0000"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">팩스</label>
                  <input
                    type="text"
                    value={editForm.fax || ''}
                    onChange={e => setEditForm(prev => prev ? { ...prev, fax: e.target.value } : null)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="02-0000-0000"
                  />
                </div>
              </div>

              {/* 이메일 */}
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block flex items-center gap-1"><Mail size={11} />이메일</label>
                <input
                  type="text"
                  value={editForm.email || ''}
                  onChange={e => setEditForm(prev => prev ? { ...prev, email: e.target.value } : null)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="이메일"
                />
              </div>

              {/* 구분 / 유형 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">거래처 구분</label>
                  <select
                    value={editForm.partnerType ?? '매출처'}
                    onChange={e => setEditForm(prev => prev ? { ...prev, partnerType: e.target.value as PartnerType } : null)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="매출처">매출처</option>
                    <option value="매입처">매입처</option>
                    <option value="매출+매입처">매출+매입처</option>
                  </select>
                </div>
                {(editForm.partnerType === '매출처' || editForm.partnerType === '매출+매입처' || !editForm.partnerType) && (
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">유형</label>
                    <select
                      value={editForm.type}
                      onChange={e => setEditForm(prev => prev ? { ...prev, type: e.target.value as PartnerChannel } : null)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="일반">일반</option>
                      <option value="택배">택배</option>
                      <option value="스마트스토어">스마트스토어</option>
                    </select>
                  </div>
                )}
              </div>

              {/* 주소 */}
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1"><MapPin size={11} />주소</label>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    readOnly
                    value={editForm.address || ''}
                    placeholder="주소 검색 버튼을 눌러주세요"
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none text-slate-600 cursor-default"
                  />
                  <button
                    type="button"
                    onClick={() => new window.daum.Postcode({
                      oncomplete: (data) => setEditForm(prev => prev ? { ...prev, address: data.address } : null),
                    }).open()}
                    className="px-4 py-3 bg-indigo-600 text-white text-sm font-bold rounded-2xl hover:bg-indigo-700 transition-all whitespace-nowrap"
                  >
                    검색
                  </button>
                </div>
                <input
                  type="text"
                  value={editForm.addressDetail || ''}
                  onChange={e => setEditForm(prev => prev ? { ...prev, addressDetail: e.target.value } : null)}
                  placeholder="상세 주소 (동/호수 등)"
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* 비고 */}
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">비고</label>
                <textarea
                  rows={2}
                  value={editForm.note || ''}
                  onChange={e => setEditForm(prev => prev ? { ...prev, note: e.target.value } : null)}
                  placeholder="메모, 특이사항 등"
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>
            </div>

            {/* 하단 버튼 */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100">
              <button
                onClick={() => setConfirmModal({
                  message: `"${editForm.name}" 거래처를 삭제하시겠습니까?`,
                  subMessage: '연결된 주문 및 품목 데이터에 영향을 줄 수 있습니다.',
                  onConfirm: () => { onDeleteClient(editForm.id); setEditForm(null); setConfirmModal(null); },
                })}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-rose-50 text-rose-500 rounded-xl text-sm font-bold hover:bg-rose-100 transition-all"
              >
                <Trash2 size={14} />삭제
              </button>
              <div className="flex items-center gap-2">
                <button onClick={() => setEditForm(null)} className="px-4 py-2.5 bg-slate-100 text-slate-500 rounded-xl text-sm font-bold hover:bg-slate-200 transition-all">
                  취소
                </button>
                <button onClick={saveEditing} className="flex items-center gap-1.5 px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-black hover:bg-indigo-700 transition-all shadow-sm">
                  <Check size={14} />저장
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isAddModalOpen && (
        <AddPartnerModal
          onClose={() => setIsAddModalOpen(false)}
          onSave={(newClient) => { onAddClient(newClient); setIsAddModalOpen(false); }}
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
