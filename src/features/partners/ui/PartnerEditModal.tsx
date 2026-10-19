import React from 'react';
import { Mail, MapPin, Trash2, Check } from 'lucide-react';
import type { Partner, PartnerChannel, PartnerType, ShipMethod } from '../../../shared/types';
import { isShipMethod, isShippingPartner } from '../../../shared/partnerShipping';
import ShipToEditor from '../../../shared/components/ShipToEditor';
import ModalShell from '../../../shared/components/ModalShell';
interface PartnerEditModalProps {
 editForm: Partner;
 setEditForm: React.Dispatch<React.SetStateAction<Partner | null>>;
 isSaving: boolean; locked?: boolean; recoveryActions?:React.ReactNode; canReopen?: boolean; onReopen?:()=>void; saveError: string;
 onClose: () => void; onSave: () => void; onDelete: () => void; onSearchAddress: () => void;
}
export function PartnerEditModal({ editForm, setEditForm, isSaving, locked=false, recoveryActions, canReopen=false, onReopen, saveError, onClose, onSave, onDelete, onSearchAddress }: PartnerEditModalProps) {
 return (
        <ModalShell title="거래처 수정" onClose={onClose} bodyClassName="!p-0">
            {recoveryActions&&<div className="px-5 pt-4">{recoveryActions}</div>}
            {canReopen&&<div className="px-5 pt-4"><button type="button" disabled={isSaving} onClick={onReopen} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600">현재 거래처 다시 열기</button></div>}
            {/* 폼 */}
            <fieldset disabled={isSaving||locked} className="min-w-0 px-5 py-5 space-y-4">
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
                    <option value="금융기관">금융기관</option>
                  </select>
                  {editForm.partnerType === '금융기관' && (
                    <p className="text-[11px] font-bold text-slate-400 leading-snug mt-1.5">
                      은행·카드사처럼 <b>빌리고 갚는 상대</b>입니다. 주문·발주·매입전표 거래처 목록에는 안 뜨고,
                      일반전표(대출상환·이자)에서 고릅니다.
                    </p>
                  )}
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

              {isShippingPartner(editForm.partnerType) && <label className="block text-xs font-bold text-slate-600">기본 배송방식
                <select aria-label="기본 배송방식" value={isShipMethod(editForm.defaultShipMethod)?editForm.defaultShipMethod:''} onChange={e=>setEditForm(prev=>prev?{...prev,defaultShipMethod:e.target.value as ShipMethod}:null)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <option value="" disabled>미설정 (기존 채널 기본 사용)</option>{(['배송','화물','수령','택배'] as const).map(m=><option key={m} value={m}>{m}</option>)}
                </select>
              </label>}
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
                    onClick={onSearchAddress}
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

              {/*  **배송지**(2026-09-16 사장님: "일반기능으로 넣고") — 한 거래처가 여러 곳으로
                   나갈 때 답니다. 안 단 거래처는 화면이 하나도 안 바뀝니다. */}
              <ShipToEditor
                shippingEnabled={isShippingPartner(editForm.partnerType)}
                value={editForm.shipTos ?? []}
                onChange={next => setEditForm(prev => prev ? { ...prev, shipTos: next } : null)}
              />

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
            </fieldset>
            {saveError && <p role="alert" className="mx-5 mb-3 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700">{saveError}</p>}

            {/* 하단 버튼 */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100">
              <button
                disabled={isSaving}
                onClick={onDelete}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-rose-50 text-rose-500 rounded-xl text-sm font-bold hover:bg-rose-100 transition-all"
              >
                <Trash2 size={14} />삭제
              </button>
              <div className="flex items-center gap-2">
                <button disabled={isSaving} onClick={onClose} className="px-4 py-2.5 bg-slate-100 text-slate-500 rounded-xl text-sm font-bold hover:bg-slate-200 transition-all">
                  취소
                </button>
                <button disabled={isSaving||locked} onClick={onSave} className="flex items-center gap-1.5 px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-black hover:bg-indigo-700 transition-all shadow-sm">
                  <Check size={14} />{isSaving ? '저장 중…' : '저장'}
                </button>
              </div>
            </div>
        </ModalShell>
 );
}
