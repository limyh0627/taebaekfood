import { usePartnerSignupApproval } from '../src/features/partners/hooks/usePartnerSignupApproval';
import React, { useMemo, useState } from 'react';
import { CheckCircle2, XCircle, Search, UserCheck, Phone, Mail, Calendar, Building2, AlertCircle } from 'lucide-react';
import { Partner, type CompanyId } from '../src/shared/types';
import PageHeader from './PageHeader';

interface Props {
  companyId: CompanyId;
  partners: Partner[];
}

const fmtDate = (iso?: string) => {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};

const PartnerSignupApproval: React.FC<Props> = ({ partners: allPartners, companyId }) => {
  const approval = usePartnerSignupApproval(companyId);
  const partners = allPartners.filter(partner => partner.companyId === companyId);
  const pendingUsers = approval.rows;
  const [searchByUser, setSearchByUser] = useState<Record<string, string>>({});
  const [selectedPartnerByUser, setSelectedPartnerByUser] = useState<Record<string, string>>({});
  const sortedUsers = useMemo(() => {
    return [...pendingUsers].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  }, [pendingUsers]);

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="거래처 가입승인"
        subtitle="홈페이지에서 가입 신청한 거래처를 승인하고 staff 거래처와 연결합니다."
        right={
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">
            대기 {sortedUsers.length}건
          </span>
        }
      />

      {approval.status === 'loading' && <p role="status" className="mt-4 text-sm text-slate-600">가입 신청 목록을 확인하고 있습니다.</p>}
      {approval.status === 'error' && <div role="alert" className="mt-4 rounded-xl border p-3 text-sm"><p>{approval.error}</p><button className="mt-2 h-9 rounded-lg border bg-white px-3 text-xs font-semibold" onClick={approval.retryRead}>다시 확인</button></div>}
      {approval.status === 'ready' && sortedUsers.length === 0 ? (
        <div className="mt-8 bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <CheckCircle2 className="w-10 h-10 text-emerald-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">승인 대기 중인 가입 신청이 없습니다.</p>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {sortedUsers.map((user) => {
            const record = approval.records.get(user.id);
            const busy = approval.busy(user.id);
            const search = searchByUser[user.id] ?? '';
            const selectedId = selectedPartnerByUser[user.id] ?? '';
            const selectedPartner = partners.find(p => p.id === selectedId);
            const filtered = !search
              ? partners.slice(0, 8)
              : partners
                  .filter(p =>
                    p.name.includes(search) ||
                    (p.ownerName ?? '').includes(search) ||
                    (p.bizNo ?? '').includes(search) ||
                    (p.mobile ?? '').includes(search) ||
                    (p.tel ?? '').includes(search),
                  )
                  .slice(0, 12);

            return (
              <div key={user.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                      <UserCheck className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-800 truncate">
                        {user.name ?? '(이름 미입력)'}
                        <span className="ml-2 text-xs font-medium text-slate-400">@{user.username}</span>
                      </p>
                      <div className="flex items-center gap-3 mt-0.5 text-[11px] text-slate-500">
                        {user.phone && <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" />{user.phone}</span>}
                        {user.email && <span className="inline-flex items-center gap-1"><Mail className="w-3 h-3" />{user.email}</span>}
                        <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3" />{fmtDate(user.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${user.type === 'business' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                    {user.type === 'business' ? '기존 거래처' : '신규/개인'}
                  </span>
                </div>

                <div className="px-5 py-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 mb-1.5">staff 거래처 검색</label>
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                      <input
                        disabled={busy || !!record} type="text"
                        value={search}
                        onChange={(e) => { if (!approval.busy(user.id) && !record) setSearchByUser(prev => ({ ...prev, [user.id]: e.target.value })); }}
                        placeholder="이름·대표자·사업자번호·연락처"
                        className="w-full pl-8 pr-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200"
                      />
                    </div>
                    <div className="mt-2 max-h-44 overflow-y-auto border border-slate-100 rounded-lg divide-y divide-slate-50">
                      {filtered.length === 0 ? (
                        <p className="text-xs text-slate-400 text-center py-3">검색 결과가 없습니다.</p>
                      ) : (
                        filtered.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            disabled={busy || !!record} onClick={() => { if (!approval.busy(user.id) && !record) setSelectedPartnerByUser(prev => ({ ...prev, [user.id]: p.id })); }}
                            className={`w-full text-left px-3 py-2 hover:bg-slate-50 transition-colors ${selectedId === p.id ? 'bg-blue-50' : ''}`}
                          >
                            <p className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                              <Building2 className="w-3 h-3 text-slate-400" />
                              {p.name}
                            </p>
                            <p className="text-[11px] text-slate-400 truncate">
                              {[p.ownerName, p.bizNo, p.mobile ?? p.tel].filter(Boolean).join(' · ')}
                            </p>
                          </button>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col">
                    <label className="block text-[11px] font-bold text-slate-500 mb-1.5">연결할 거래처</label>
                    {selectedPartner ? (
                      <div className="flex-1 border border-blue-200 bg-blue-50/50 rounded-lg p-3">
                        <p className="text-sm font-bold text-blue-900">{selectedPartner.name}</p>
                        <div className="mt-1 text-[11px] text-slate-600 space-y-0.5">
                          {selectedPartner.ownerName && <p>대표: {selectedPartner.ownerName}</p>}
                          {selectedPartner.bizNo && <p>사업자번호: {selectedPartner.bizNo}</p>}
                          {(selectedPartner.mobile || selectedPartner.tel) && <p>연락처: {selectedPartner.mobile ?? selectedPartner.tel}</p>}
                          {selectedPartner.address && <p className="truncate">주소: {selectedPartner.address}</p>}
                        </div>
                      </div>
                    ) : (
                      <div className="flex-1 border border-dashed border-slate-200 rounded-lg p-3 flex items-center justify-center text-center">
                        <p className="text-[11px] text-slate-400 inline-flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          좌측에서 거래처를 선택해주세요.
                        </p>
                      </div>
                    )}

                    {!record && approval.messages[user.id] && <p role="status" className="mt-2 text-xs text-slate-700">{approval.messages[user.id]}</p>}
                    {record && <div className="mt-3 space-y-2 text-xs">
                      <p>{record.message}</p>
                      <div className="flex flex-wrap gap-2">
                        <button className="min-h-9 rounded-lg border bg-white px-3 text-xs font-semibold" disabled={busy} onClick={() => approval.inspect(user.id)}>현재 상태 확인</button>
                        {'observed' in record && (record.observed === null || record.observed?.status === 'approved' || record.observed?.status === 'rejected') && <button className="min-h-9 rounded-lg border bg-white px-3 text-xs font-semibold" disabled={busy} onClick={() => approval.closeObserved(user.id)}>확인한 내용 닫기</button>}
                        {record.retryAllowed && <button className="min-h-9 rounded-lg border bg-white px-3 text-xs font-semibold" disabled={busy} onClick={() => approval.retryDecision(user.id)}>같은 내용으로 다시 시도</button>}
                      </div>
                      <p>확인할 요청은 이 화면에만 보관됩니다. 결과 확인 전 새로고침하거나 화면을 나가지 마세요.</p>
                    </div>}
                    {!record && <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busy || !selectedId}
                        onClick={() => approval.approve(user, selectedId)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white transition-colors"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        승인 및 연결
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => approval.reject(user)}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        거절
                      </button>
                    </div>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PartnerSignupApproval;
