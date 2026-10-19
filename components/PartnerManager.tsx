import ModalShell from '../src/shared/components/ModalShell';
import {usePartnerEditor} from '../src/features/partners/hooks/usePartnerEditor';
import type {PartnerEditBindings} from '../src/shared/services/partnerEditWrites';
import {useDirectoryDelete,type DirectoryDeleteBindings} from '../src/shared/hooks/useDirectoryDelete';
import DirectoryDeleteDialogs from '../src/shared/components/DirectoryDeleteDialogs';
import SearchableSelect from '../src/shared/components/SearchableSelect';
import QueryFilterPanel, { QUERY_FILTER_LABEL_CLASS, QUERY_FILTER_CONTROL_CLASS , QUERY_FILTER_FIELD_CLASS, QUERY_FILTER_SEARCH_CLASS, QUERY_FILTER_DATE_CLASS } from '../src/shared/components/QueryFilterPanel';
import { PartnerEditModal } from '../src/features/partners/ui/PartnerEditModal';
import ActionButton from '../src/shared/components/ActionButton';

import React, { useRef, useState, useMemo } from 'react';
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
import AddPartnerModal from './AddPartnerModal';
import PageHeader from './PageHeader';
import { isShipMethod, isShippingPartner } from '../src/shared/partnerShipping';
import type { ShipMethod } from '../src/shared/types';

interface PartnerManagerProps extends DirectoryDeleteBindings {
  partners: Partner[];
  companyId?: Partner['companyId'];
  actorUid?: string;
  partnerEditBindings?: PartnerEditBindings;
  onAddClient: (_client: Partner) => void | Promise<unknown>;
}

const PartnerManager: React.FC<PartnerManagerProps> = ({ partners, companyId, actorUid, partnerEditBindings, onAddClient,requestScopeKey,onPrepareDirectoryDelete,onConfirmDirectoryDelete,onInspectDirectoryDelete,onCancelDirectoryDelete,onReadPendingDirectoryDeletes,onReadDirectoryDeleteReferences }) => {
  const deletion=useDirectoryDelete({scopeKey:'partners:'+(requestScopeKey??''),prepare:onPrepareDirectoryDelete,confirm:onConfirmDirectoryDelete,inspect:onInspectDirectoryDelete,cancel:onCancelDirectoryDelete,readPending:onReadPendingDirectoryDeletes,readReferences:onReadDirectoryDeleteReferences});

  const [activeTab, setActiveTab] = useState<PartnerType | '전체'>('전체');
  const [activeTypeTab, setActiveTypeTab] = useState<PartnerChannel | '전체'>('전체');
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [page, setPage] = useState(1);
  const editor=usePartnerEditor({companyId,actorUid,partners,partnerEditBindings,externalBusy:deletion.busy,selectOpening:original=>deletion.select({kind:'partner',targetId:original.id,opening:{...original}})});
  const {editForm,setEditForm,isSaving,openEditing,closeEditing,saveEditing}=editor;
  const deleteAck=useRef<((id:string)=>void)|null>(null);
  const recoveryOwner=useRef({key:editor.recoveryScopeKey});
  if(recoveryOwner.current.key!==editor.recoveryScopeKey)recoveryOwner.current={key:editor.recoveryScopeKey};
  const [recovery,setRecovery]=useState<{owner:typeof recoveryOwner.current;view:'failure'|'history'}|null>(null);
  const recoveryVisible=!!recovery&&recovery.owner===recoveryOwner.current&&editor.isCurrentActor();
  const openRecovery=(view:'failure'|'history')=>setRecovery({owner:recoveryOwner.current,view});
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

  return (
    <div className="space-y-5 animate-in fade-in duration-300 h-full flex flex-col">
      <PageHeader
        title="거래처 관리"
        subtitle="거래처 정보를 관리하고 성격별로 분류하세요."
        tabs={
        <div className="flex w-full items-center gap-1 overflow-x-auto no-scrollbar">
          {partnerTabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); setActiveTypeTab('전체'); setPage(1); setSearchTerm(''); }}
                className={`flex items-center space-x-2 h-9 px-3 rounded-lg transition-colors whitespace-nowrap border text-xs ${
                  isActive ? 'bg-white border-indigo-300 text-indigo-600' : 'bg-white border-slate-100 text-slate-500 hover:border-slate-200'
                }`}
              >
                <span className="font-bold text-xs">{tab.label}</span>
                <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400">
                  {tab.id === '전체' ? activePartners.length : activePartners.filter(c => getEffectivePartnerType(c) === tab.id).length}
                </span>
              </button>
            );
          })}
        </div>
        }
        actions={
          <ActionButton tone="primary" disabled={isSaving} onClick={() => { if (!editor.isBusy()&&!deletion.busy) setIsAddModalOpen(true); }}>
            <Plus size={15} /><span>거래처 등록</span>
          </ActionButton>
        }
      />

      <QueryFilterPanel onReset={() => { setActiveTypeTab('전체'); setPage(1); setSearchTerm(''); }} conditionRow={(activeTab === '매출처' || activeTab === '전체') && (
          <label className={QUERY_FILTER_FIELD_CLASS}>거래처 유형
            <SearchableSelect ariaLabel="거래처 유형" className={(QUERY_FILTER_CONTROL_CLASS) + ' w-full min-w-0 max-w-full'} value={activeTypeTab}
              onChange={value => { setActiveTypeTab(value as PartnerChannel | '전체'); setPage(1); }}
              options={partnerChannelTypes.map(t => ({value:t.id,label:t.id === '전체' ? '전체' : t.label + ' ' + activePartners.filter(c => activeTab === '전체' || getEffectivePartnerType(c) === activeTab).filter(c => c.type === t.id).length}))}/>
          </label>
        )} searchRow={<>
<label className={QUERY_FILTER_SEARCH_CLASS}><span>전체 검색</span>
<div className="relative w-full min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={13} />
          <input
            type="text"
            placeholder={`${activeTab === '전체' ? '전체' : activeTab} 거래처 검색...`}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={(QUERY_FILTER_CONTROL_CLASS + ' w-full' + ' pl-9 pr-3') + ' w-full min-w-0 max-w-full'}
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={16} />
            </button>
          )}
        </div>
</label>
</>} />

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

      {editor.inlineMessage&&<p role="status">{editor.inlineMessage}</p>}
      {editor.readError&&<p role="alert">보관 요청을 읽지 못했습니다. 처리 기록에서 다시 확인해 주세요.</p>}
      {!editForm&&<div className="flex flex-wrap gap-2">{editor.failureCount>0&&<ActionButton onClick={()=>openRecovery('failure')}>실패 {editor.failureCount}</ActionButton>}<ActionButton onClick={()=>openRecovery('history')}>처리 기록</ActionButton></div>}
      {recoveryVisible&&<ModalShell title="거래처 수정 처리 확인" layer={1100} onClose={()=>setRecovery(null)} footer={<ActionButton onClick={()=>setRecovery(null)}>닫기</ActionButton>}>
        <div className="space-y-3 text-sm text-slate-700">
          <div className="flex flex-wrap gap-2"><ActionButton onClick={()=>openRecovery('failure')}>미해결만 보기</ActionButton><ActionButton onClick={()=>openRecovery('history')}>처리 기록 보기</ActionButton></div>
          {editor.recoveryError&&<p role="alert">{editor.recoveryError}</p>}{editor.recoveryMessage&&<p role="status">{editor.recoveryMessage}</p>}
          {editor.readLoading&&<p role="status">보관된 수정 요청을 읽고 있습니다.</p>}{editor.readError&&<p role="alert">{editor.readError}</p>}
          <div className="flex flex-wrap gap-2"><ActionButton disabled={editor.busy||editor.readLoading} onClick={()=>void editor.refresh()}>보관 요청 다시 읽기</ActionButton><ActionButton disabled={editor.busy||editor.historyLoading} onClick={()=>void editor.loadHistory()}>지난 처리 기록 조회</ActionButton></div>
          {editor.historyLoading&&<p role="status">거래처 수정 처리 기록을 조회하고 있습니다.</p>}{editor.historyError&&<p role="alert">{editor.historyError}</p>}
          {(recovery.view==='failure'?editor.failureRows:editor.historyRows).map(({entry,currentState,cause,nextAction})=><div key={entry.key} className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
            <p className="break-words font-semibold">{entry.description}</p><p>현재 상태: {currentState}</p><p className="whitespace-pre-line">내용: {cause}</p><p className="whitespace-pre-line">다음 행동: {nextAction}</p>
            {entry.observedLocalText!==null&&<details className="text-xs"><summary>보관한 수정 원문</summary><pre className="mt-2 whitespace-pre-wrap break-all">{entry.observedLocalText}</pre></details>}
            <div className="flex flex-wrap gap-2">{entry.reference&&<ActionButton disabled={editor.busy} onClick={()=>void editor.inspect(entry)}>결과 확인</ActionButton>}{editor.canRetry(entry)&&<ActionButton disabled={editor.busy} onClick={()=>void editor.retry(entry)}>같은 요청 재시도</ActionButton>}{editor.canCancel(entry)&&<ActionButton disabled={editor.busy} onClick={()=>void editor.cancel(entry)}>미처리 요청 중단</ActionButton>}{editor.canDiscard(entry)&&<ActionButton disabled={editor.busy} onClick={()=>void editor.discardCopy(entry)}>이 기기의 사본 정리</ActionButton>}</div>
          </div>)}
          {editor.historyMore&&<ActionButton disabled={editor.busy||editor.historyLoading} onClick={()=>void editor.nextHistory()}>다음 처리 기록</ActionButton>}
        </div>
      </ModalShell>}
      {/* 수정 오버레이 모달 */}
      {editForm && (
        <PartnerEditModal editForm={editForm} setEditForm={setEditForm} isSaving={editor.busy||deletion.busy} locked={editor.locked} recoveryActions={<div className="flex flex-wrap gap-2">{editor.failureCount>0&&<ActionButton disabled={editor.busy} onClick={()=>openRecovery('failure')}>실패 {editor.failureCount}</ActionButton>}<ActionButton disabled={editor.busy} onClick={()=>openRecovery('history')}>처리 기록</ActionButton></div>} canReopen={editor.canReopenCurrent} onReopen={()=>void editor.reopenCurrent()} saveError={editor.inlineError}
          onClose={closeEditing} onSave={()=>void saveEditing()} onDelete={()=>{if(!editor.isBusy()){deleteAck.current=editor.captureDeleteGuard();void deletion.openSelected();}}} onSearchAddress={editor.searchAddress} />
      )}

      {isAddModalOpen && (
        <AddPartnerModal
          onClose={() => setIsAddModalOpen(false)}
          onSave={onAddClient}
          onOpenExisting={openEditing}
        />
      )}
      <DirectoryDeleteDialogs controller={deletion} onConfirmed={id=>deleteAck.current?.(id)}/>
    </div>
  );
};

export default PartnerManager;
