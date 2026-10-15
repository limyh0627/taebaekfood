
import React, { useEffect, useRef, useState } from 'react';
import { Phone, Mail, LayoutGrid, Check, Store, Truck, User, MapPin } from 'lucide-react';
import { Partner, PartnerChannel, PartnerType, ShipMethod } from '../types';
import { channelStyle, CHANNELS } from '../src/shared/channelStyle';
import { isShippingPartner, isShipMethod } from '../src/shared/partnerShipping';
import type { PartnerRegistrationConflict } from '../src/shared/services/firebaseService';
import ModalShell from '../src/shared/components/ModalShell';

declare global {
  interface Window {
    daum: { Postcode: new (config: { oncomplete: (data: { address: string }) => void }) => { open: () => void } };
  }
}

interface AddPartnerModalProps {
  onClose: () => void;
  onSave: (_client: Partner) => void | Promise<unknown>;
  onOpenExisting?: (partner: Partner) => void;
}

export function partnerSaveErrorMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code).split('/').pop() : '';
  const action = code === 'permission-denied' ? '현재 계정에 거래처 저장 권한이 있는지 확인해 주세요.'
    : code === 'unauthenticated' ? '로그인 상태를 확인한 뒤 다시 시도해 주세요.'
    : ['unavailable', 'deadline-exceeded', 'aborted'].includes(code ?? '') ? '연결 또는 처리가 지연되어 저장 결과를 확인하지 못했습니다. 연결 상태를 확인하고 이 창에서 다시 시도해 주세요.'
    : code === 'not-found' ? '거래처를 찾지 못했습니다. 목록에서 거래처가 존재하는지 확인해 주세요.'
    : code === 'partner-registration-conflict' ? '같은 등록 번호의 거래처가 이미 존재하며 현재 입력과 다릅니다. 거래처 목록에서 기존 거래처를 확인한 뒤 수정해 주세요.'
    : error instanceof Error && /[가-힣]/.test(error.message) ? error.message + ' 내용을 확인하고 이 창에서 다시 시도해 주세요.'
    : '거래처 저장을 완료하지 못했습니다. 연결 상태와 입력을 확인하고 이 창에서 다시 시도해 주세요.';
  return action + ' 이 창의 입력은 유지했습니다.';
}

const AddPartnerModal: React.FC<AddPartnerModalProps> = ({ onClose, onSave, onOpenExisting }) => {
  // 응답을 잃어도 같은 창의 재시도가 새 거래처를 만들지 않게 등록 번호를 고정한다.
  const [registrationId] = useState(() => 'c-' + crypto.randomUUID());
  const savingRef = useRef(false);
  const mounted = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [conflictPartner, setConflictPartner] = useState<Partner | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const close = () => { if (!savingRef.current) onClose(); };
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    mobile: '',
    type: '일반' as PartnerChannel,
    address: '',
    addressDetail: '',
    note: '',
    partnerType: '매출처' as PartnerType,
    defaultShipMethod: '' as ShipMethod | ''
  });

  const [shippingError, setShippingError] = useState('');

  const openAddressSearch = () => {
    new window.daum.Postcode({
      oncomplete: (data) => { if (mounted.current && !savingRef.current) setFormData(prev => ({ ...prev, address: data.address })); },
    }).open();
  };

  //  아이콘·이름표·색은 [shared/channelStyle](../src/shared/channelStyle) 한 곳이 정한다
  const partnerChannelTypes = CHANNELS.map(id => {
    const c = channelStyle(id);
    return { id: id as PartnerChannel, label: c.label, icon: c.icon, color: c.chip };
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingRef.current || !mounted.current) return;
    if (!formData.name) return;
    if (isShippingPartner(formData.partnerType) && !isShipMethod(formData.defaultShipMethod)) {
      setShippingError('기본 배송방식을 선택해 주세요.');
      return;
    }

    const newClient: Partner = {
      id: registrationId,
      name: formData.name,
      email: formData.email,
      mobile: formData.mobile,
      type: formData.type,
      address: formData.address,
      addressDetail: formData.addressDetail,
      note: formData.note,
      partnerType: formData.partnerType,
      ...(isShippingPartner(formData.partnerType) && isShipMethod(formData.defaultShipMethod) ? { defaultShipMethod: formData.defaultShipMethod } : {})
    };

    savingRef.current = true;
    setIsSaving(true);
    setSaveError('');
    setConflictPartner(null);
    try {
      await onSave(newClient);
      if (mounted.current) onClose();
    } catch (error) {
      if (!mounted.current) return;
      setSaveError(partnerSaveErrorMessage(error));
      const conflict = error && typeof error === 'object' ? error as Partial<PartnerRegistrationConflict> : null;
      if (conflict?.code === 'partner-registration-conflict' && conflict.partnerId === registrationId && conflict.existingPartner?.id === registrationId && typeof conflict.existingPartner.name === 'string' && conflict.existingPartner.name.trim()) setConflictPartner(conflict.existingPartner);
    } finally {
      savingRef.current = false;
      if (mounted.current) setIsSaving(false);
    }
  };

  return (
    <ModalShell title="신규 거래처 등록" onClose={close} bodyClassName="!p-0">

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 custom-scrollbar">
          <fieldset disabled={isSaving} className="min-w-0 space-y-6">
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
            <input
              type="text"
              value={formData.addressDetail}
              onChange={(e) => setFormData({ ...formData, addressDetail: e.target.value })}
              placeholder="상세 주소 (동/호수 등)"
              aria-label="상세주소"
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center">
              <Mail size={14} className="mr-2" /> 이메일
            </label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({...formData, email: e.target.value})}
              placeholder="contact@partner.com"
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(['매출처', '매입처', '매출+매입처', '금융기관'] as PartnerType[]).map(pt => (
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
            {formData.partnerType === '금융기관' && (
              <p className="text-[11px] font-bold text-slate-400 leading-snug">
                은행·카드사처럼 <b>빌리고 갚는 상대</b>입니다. 주문·발주·매입전표 거래처 목록에는 안 뜨고,
                일반전표(대출상환·이자)에서 고릅니다.
              </p>
            )}
          </div>

          {isShippingPartner(formData.partnerType) && <label className="block space-y-2 text-sm font-bold text-slate-600">기본 배송방식 (필수)
            <select aria-label="기본 배송방식" required value={formData.defaultShipMethod} onChange={e => { setShippingError(''); setFormData({...formData, defaultShipMethod:e.target.value as ShipMethod | ''}); }} className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3">
              <option value="">선택해 주세요</option>{(['배송','화물','수령','택배'] as const).map(method => <option key={method} value={method}>{method}</option>)}
            </select>
            {shippingError && <span role="alert" className="block text-xs text-slate-600">{shippingError}</span>}
          </label>}
          {(formData.partnerType === '매출처' || formData.partnerType === '매출+매입처') && (
          <div className="space-y-4">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center">
              <LayoutGrid size={14} className="mr-2" /> 주문 채널 유형
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {partnerChannelTypes.map((type) => {
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
          </fieldset>
        </form>
        {saveError && <div role="alert" className="mx-6 mb-3 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700">{saveError}</div>}
        {conflictPartner && onOpenExisting && <button type="button" className="mx-6 mb-3 rounded-lg border border-slate-300 bg-white p-3 text-sm font-bold text-slate-700" onClick={() => { if (!savingRef.current) { onOpenExisting(conflictPartner); onClose(); } }}>기존 거래처 확인/수정</button>}

        <div className="p-6 border-t border-slate-100 bg-slate-50/50 rounded-b-3xl flex space-x-3">
          <button
            type="button"
            disabled={isSaving}
            onClick={close}
            className="flex-1 py-4 rounded-2xl font-bold text-slate-500 bg-white border border-slate-200 hover:bg-slate-50 transition-all"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={isSaving}
            onClick={handleSubmit}
            className="flex-1 py-4 rounded-2xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-xl shadow-indigo-100 transition-all flex items-center justify-center space-x-2"
          >
            <Check size={20} />
            <span>{isSaving ? '저장 중…' : '등록 완료'}</span>
          </button>
        </div>
    </ModalShell>
  );
};

export default AddPartnerModal;
