
import React, { useState } from 'react';
import { X, Users, Phone, Mail, LayoutGrid, Check, Store, Truck, User, MapPin } from 'lucide-react';
import { Partner, PartnerChannel, PartnerType } from '../types';

declare global {
  interface Window {
    daum: { Postcode: new (config: { oncomplete: (data: { address: string }) => void }) => { open: () => void } };
  }
}

interface AddClientModalProps {
  onClose: () => void;
  onSave: (_client: Partner) => void;
}

const AddClientModal: React.FC<AddClientModalProps> = ({ onClose, onSave }) => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    mobile: '',
    type: '일반' as PartnerChannel,
    address: '',
    note: '',
    partnerType: '매출처' as PartnerType
  });

  const openAddressSearch = () => {
    new window.daum.Postcode({
      oncomplete: (data) => setFormData(prev => ({ ...prev, address: data.address })),
    }).open();
  };

  const clientTypes: { id: PartnerChannel, label: string, icon: any, color: string }[] = [
    { id: '일반', label: '일반 거래처', icon: User, color: 'bg-indigo-100 text-indigo-600' },
    { id: '택배', label: '택배사/대행', icon: Truck, color: 'bg-pink-100 text-pink-600' },
    { id: '스마트스토어', label: '스마트스토어', icon: Store, color: 'bg-lime-100 text-lime-600' },
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) return;

    const newClient: Partner = {
      id: `c-${Date.now()}`,
      name: formData.name,
      email: formData.email,
      mobile: formData.mobile,
      type: formData.type,
      address: formData.address,
      note: formData.note,
      partnerType: formData.partnerType
    };

    onSave(newClient);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300" onClick={onClose} />

      <div className="relative bg-white w-full max-w-lg rounded-3xl shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-300">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-indigo-600 text-white rounded-xl flex items-center justify-center shadow-lg">
              <Users size={20} />
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-900">신규 거래처 등록</h3>
              <p className="text-xs text-slate-500">새로운 비즈니스 파트너를 시스템에 추가합니다.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-full">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center">
              <User size={14} className="mr-2" /> 거래처명 (상호명)
            </label>
            <input
              required
              autoFocus
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({...formData, name: e.target.value})}
              placeholder="예: 태백물산"
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center">
              <Phone size={14} className="mr-2" /> 핸드폰
            </label>
            <input
              type="text"
              value={formData.mobile}
              onChange={(e) => setFormData({...formData, mobile: e.target.value})}
              placeholder="010-0000-0000"
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center">
              <MapPin size={14} className="mr-2" /> 주소
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={formData.address}
                placeholder="주소 검색 버튼을 눌러주세요"
                className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 text-sm font-bold outline-none text-slate-600 cursor-default"
              />
              <button
                type="button"
                onClick={openAddressSearch}
                className="px-4 py-3.5 bg-indigo-600 text-white text-sm font-bold rounded-2xl hover:bg-indigo-700 transition-all whitespace-nowrap"
              >
                주소 검색
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center">
              <Mail size={14} className="mr-2" /> 이메일
            </label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({...formData, email: e.target.value})}
              placeholder="contact@client.com"
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">비고</label>
            <textarea
              rows={2}
              value={formData.note}
              onChange={(e) => setFormData({...formData, note: e.target.value})}
              placeholder="메모, 특이사항 등"
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 transition-all resize-none"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center">
              <LayoutGrid size={14} className="mr-2" /> 거래처 구분
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['매출처', '매입처', '매출+매입처'] as PartnerType[]).map(pt => (
                <button
                  key={pt}
                  type="button"
                  onClick={() => setFormData({...formData, partnerType: pt})}
                  className={`py-2.5 rounded-xl text-xs font-black border transition-all ${
                    formData.partnerType === pt
                      ? 'bg-indigo-600 border-indigo-600 text-white shadow'
                      : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'
                  }`}
                >
                  {pt}
                </button>
              ))}
            </div>
          </div>

          {(formData.partnerType === '매출처' || formData.partnerType === '매출+매입처') && (
          <div className="space-y-4">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center">
              <LayoutGrid size={14} className="mr-2" /> 주문 채널 유형
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {clientTypes.map((type) => {
                const Icon = type.icon;
                const isSelected = formData.type === type.id;
                return (
                  <button
                    key={type.id}
                    type="button"
                    onClick={() => setFormData({...formData, type: type.id})}
                    className={`flex flex-col items-center justify-center p-4 rounded-2xl border transition-all ${
                      isSelected
                        ? 'bg-indigo-50 border-indigo-500 ring-1 ring-indigo-500 shadow-md'
                        : 'bg-white border-slate-100 hover:border-slate-200'
                    }`}
                  >
                    <div className={`p-2 rounded-xl mb-2 ${isSelected ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                      <Icon size={18} />
                    </div>
                    <span className={`text-[11px] font-black ${isSelected ? 'text-indigo-900' : 'text-slate-500'}`}>{type.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          )}
        </form>

        <div className="p-6 border-t border-slate-100 bg-slate-50/50 rounded-b-3xl flex space-x-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-4 rounded-2xl font-bold text-slate-500 bg-white border border-slate-200 hover:bg-slate-50 transition-all"
          >
            취소
          </button>
          <button
            type="submit"
            onClick={handleSubmit}
            className="flex-1 py-4 rounded-2xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-xl shadow-indigo-100 transition-all flex items-center justify-center space-x-2"
          >
            <Check size={20} />
            <span>등록 완료</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default AddClientModal;
