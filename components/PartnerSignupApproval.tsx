import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, XCircle, Search, UserCheck, Phone, Mail, Calendar, Building2, AlertCircle } from 'lucide-react';
import { where } from 'firebase/firestore';
import { Partner } from '../src/shared/types';
import { subscribeToCollection, setDocument } from '../src/shared/services/firebaseService';
import PageHeader from './PageHeader';

interface PartnerSignupUser {
  id: string;
  uid?: string;
  username?: string;
  name?: string;
  phone?: string;
  email?: string;
  type?: 'business' | 'individual';
  status?: 'pending' | 'approved' | 'rejected';
  linkedPartnerId?: string | null;
  createdAt?: string;
}

interface Props {
  partners: Partner[];
}

const fmtDate = (iso?: string) => {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};

const PartnerSignupApproval: React.FC<Props> = ({ partners }) => {
  const [pendingUsers, setPendingUsers] = useState<PartnerSignupUser[]>([]);
  const [searchByUser, setSearchByUser] = useState<Record<string, string>>({});
  const [selectedPartnerByUser, setSelectedPartnerByUser] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeToCollection<PartnerSignupUser>(
      'users',
      (data) => setPendingUsers(data.filter(u => u.status === 'pending')),
      [where('status', '==', 'pending')],
    );
    return unsub;
  }, []);

  const sortedUsers = useMemo(() => {
    return [...pendingUsers].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  }, [pendingUsers]);

  const handleApprove = async (user: PartnerSignupUser) => {
    const pid = selectedPartnerByUser[user.id];
    if (!pid) { alert('연결할 거래처를 먼저 선택해주세요.'); return; }
    const partner = partners.find(p => p.id === pid);
    if (!partner) { alert('선택한 거래처를 찾을 수 없습니다.'); return; }
    setBusyId(user.id);
    try {
      await setDocument('users', user.id, {
        status: 'approved',
        linkedPartnerId: pid,
        linkedPartnerName: partner.name,
        approvedAt: new Date().toISOString(),
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (user: PartnerSignupUser) => {
    if (!window.confirm(`${user.name ?? user.username ?? '해당 사용자'} 님의 가입을 거절하시겠습니까?`)) return;
    setBusyId(user.id);
    try {
      await setDocument('users', user.id, {
        status: 'rejected',
        rejectedAt: new Date().toISOString(),
      });
    } finally {
      setBusyId(null);
    }
  };

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

      {sortedUsers.length === 0 ? (
        <div className="mt-8 bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <CheckCircle2 className="w-10 h-10 text-emerald-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">승인 대기 중인 가입 신청이 없습니다.</p>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {sortedUsers.map((user) => {
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
                        type="text"
                        value={search}
                        onChange={(e) => setSearchByUser(prev => ({ ...prev, [user.id]: e.target.value }))}
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
                            onClick={() => setSelectedPartnerByUser(prev => ({ ...prev, [user.id]: p.id }))}
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

                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busyId === user.id || !selectedId}
                        onClick={() => handleApprove(user)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white transition-colors"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        승인 및 연결
                      </button>
                      <button
                        type="button"
                        disabled={busyId === user.id}
                        onClick={() => handleReject(user)}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        거절
                      </button>
                    </div>
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
