import React, {useState,useRef,useEffect} from 'react';
import {ClipboardList,Thermometer,Bug,CheckSquare,Scan,ShoppingCart,Wrench,ShieldAlert,User} from 'lucide-react';
import {doc,onSnapshot} from 'firebase/firestore';
import {db} from '../../../shared/firebase';
import {setDocument} from '../../../shared/services/firebaseService';
import {haccpTemplateDocId} from '../../../shared/haccpTemplateId';
import type {CompanyId} from '../../../shared/types';
import {HaccpCompanyContext} from '../context/HaccpCompanyContext';
import {useDragReorder,arrayMove} from '../hooks/useDragReorder';
import {DRAG_HANDLE_CLASS,PersonalHygieneTemplateEditor,TempZoneTemplateEditor,SanitationTemplateEditor,PeriodicSanitationTemplateEditor,ClosingChecklistTemplateEditor} from './ChecklistTemplateEditors';
import {TempForm} from './TempForm';
import {IncomingForm} from './IncomingForm';
import {PestForm} from './PestForm';
import {CleaningForm} from './CleaningForm';
import {SanitationForm} from './SanitationForm';
import {PersonalHygieneForm} from './PersonalHygieneForm';
import {PeriodicSanitationForm} from './PeriodicSanitationForm';
import {ClosingChecklistForm} from './ClosingChecklistForm';
import CCPHeatForm from './CCPHeatForm';
import CCPMetalForm from './CCPMetalForm';
import {OverviewForm} from './OverviewForm';
import {DailyForm} from './DailyForm';

type TabId = 'overview' | 'daily' | 'pest' | 'temp' | 'ccp-heat' | 'ccp-metal' | 'incoming' | 'cleaning' | 'sanitation' | 'personal' | 'weekly-sanitation' | 'closing';

const TABS: { id: TabId; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: 'overview',    label: '사후평가 점검표',    icon: <ClipboardList size={14} />, desc: '소규모 HACCP 20항목 사후평가' },
  { id: 'daily',      label: '일반위생관리',        icon: <CheckSquare size={14} />,   desc: '일일/주간/월간/반기/연간 위생점검' },
  { id: 'cleaning',   label: '세척·소독 일지',      icon: <Wrench size={14} />,        desc: '기계·설비(착유기·볶음기·필터프레스) 및 작업구역 청소소독 기록' },
  { id: 'pest',       label: '방충·방서 점검',      icon: <Bug size={14} />,           desc: '하절기 주 1회 / 동절기 월 1회' },
  { id: 'temp',       label: '온도관리 일지',        icon: <Thermometer size={14} />,   desc: '냉장·냉동창고 온도 기록' },
  { id: 'ccp-heat',   label: 'CCP-B 가열·살균',    icon: <Scan size={14} />,          desc: '가열공정 온도·시간 모니터링' },
  { id: 'ccp-metal',  label: 'CCP-P 금속검출',     icon: <Scan size={14} />,          desc: 'Fe 2.0㎜ / Sus 2.5㎜ 불검출' },
  { id: 'incoming',   label: '입고검사일지',         icon: <ShoppingCart size={14} />,  desc: '원료·부자재 입고검사' },
  { id: 'sanitation',        label: '작업장 위생점검표',        icon: <ShieldAlert size={14} />,   desc: 'HACCP-PRP-001 · 작업장 위생 8개 항목 점검 (Firestore 저장)' },
  { id: 'weekly-sanitation', label: '위생점검표(주간/월간)',    icon: <ClipboardList size={14} />, desc: '작업장 위생 점검표 — 주간 · 월간 주기 점검 (Firestore 저장)' },
  { id: 'closing',           label: '마감 체크리스트',          icon: <CheckSquare size={14} />,   desc: '일별 마감 점검 — 오늘 날짜만 작성 가능 (Firestore 저장)' },
  { id: 'personal',          label: '개인위생점검표',          icon: <User size={14} />,           desc: 'HACCP-PRP-002 · 작업자 개인위생 점검 (1일 1회)' },
];

export const StaffChecklistForCompany: React.FC<{ currentUser?: { id: string; name: string }; isAdmin?: boolean; companyId: CompanyId }> = ({ currentUser, isAdmin, companyId }) => {
  const [activeTab, setActiveTab] = useState<'sanitation' | 'personal' | 'temp' | 'weekly-sanitation' | 'closing'>('sanitation');
  const STAFF_TABS = [
    { id: 'sanitation' as const,        label: '작업장 위생점검표',    desc: 'HACCP-PRP-001 · 작업장 위생 점검 (1일 2회)',   icon: <ShieldAlert size={13} />,   color: 'emerald' },
    { id: 'weekly-sanitation' as const, label: '위생점검표(주간/월간)', desc: '작업장 위생 점검 — 주간 · 월간 주기',           icon: <ClipboardList size={13} />, color: 'teal'    },
    { id: 'closing' as const,           label: '마감 체크리스트',       desc: '일별 마감 점검 — 오늘 날짜만 작성 가능',         icon: <CheckSquare size={13} />,   color: 'orange'  },
    { id: 'personal' as const,          label: '개인위생점검표',        desc: 'HACCP-PRP-002 · 작업자 개인위생 점검 (1일 1회)', icon: <User size={13} />,          color: 'blue'    },
    { id: 'temp' as const,              label: '온도관리 일지',         desc: '냉장·냉동창고 온도 기록 (월 단위)',              icon: <Thermometer size={13} />,   color: 'slate'   },
  ];
  const activeColor: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-700 font-bold',
    teal:    'bg-teal-50 text-teal-700 font-bold',
    orange:  'bg-orange-50 text-orange-700 font-bold',
    blue:    'bg-blue-50 text-blue-700 font-bold',
    slate:   'bg-slate-200 text-slate-700 font-bold',
  };

  // 탭 순서: 관리자가 드래그로 변경 → Firestore에 저장돼 모든 기기에서 동일하게 표시
  const [tabOrder, setTabOrder] = useState<string[]>([]);
  const pendingTabOrder = useRef<string[] | null>(null);
  useEffect(() => {
    return onSnapshot(doc(db, 'haccp_templates', haccpTemplateDocId(companyId, 'staff_tab_order')), snap => {
      const data = snap.exists() ? snap.data().order : null;
      if (Array.isArray(data)) setTabOrder(data);
    });
  }, [companyId]);

  // 저장된 순서 우선, 저장에 없는(새로 생긴) 탭은 기본 순서로 뒤에 붙임
  const tabById = new Map(STAFF_TABS.map(t => [t.id as string, t]));
  const orderedTabs = [
    ...tabOrder.map(id => tabById.get(id)).filter((t): t is typeof STAFF_TABS[number] => !!t),
    ...STAFF_TABS.filter(t => !tabOrder.includes(t.id)),
  ];

  const { dragIdx, handleProps, rowProps } = useDragReorder(
    (from, to) => {
      const next = arrayMove(orderedTabs.map(t => t.id as string), from, to);
      pendingTabOrder.current = next;
      setTabOrder(next);
    },
    () => {
      if (!pendingTabOrder.current) return;
      setDocument('haccp_templates', haccpTemplateDocId(companyId, 'staff_tab_order'), { order: pendingTabOrder.current });
      pendingTabOrder.current = null;
    }
  );

  return (
    <HaccpCompanyContext.Provider value={companyId}>
    <div className="flex flex-col h-full bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center">
            <ShieldAlert size={18} className="text-emerald-600" />
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-black text-slate-800 leading-tight">위생·온도 점검표</h1>
            <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">HACCP-PRP · 작업장 위생, 개인위생, 온도 기록</p>
          </div>
        </div>
      </div>
      <div className="bg-white border-b border-slate-200 px-4">
        <div className="flex gap-0.5 py-2 overflow-x-auto">
          {orderedTabs.map((tab, idx) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              {...(isAdmin ? { ...handleProps(idx), ...rowProps(idx) } : {})}
              title={isAdmin ? '드래그로 탭 순서 변경' : undefined}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.id ? activeColor[tab.color] : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              } ${dragIdx === idx ? 'opacity-60 ring-1 ring-indigo-400' : ''}`}>
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="px-6 py-2 bg-slate-50 border-b border-slate-100">
        <p className="text-xs text-slate-500">{STAFF_TABS.find(t => t.id === activeTab)?.desc}</p>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'sanitation' && (
          <div className="flex flex-col gap-4">
            {isAdmin && <SanitationTemplateEditor />}
            <SanitationForm currentUser={currentUser} isAdmin={isAdmin} canConfirm={isAdmin} />
          </div>
        )}
        {activeTab === 'weekly-sanitation' && (
          <div className="flex flex-col gap-4">
            <PeriodicSanitationForm currentUser={currentUser} isAdmin={isAdmin} canConfirm={isAdmin} />
          </div>
        )}
        {activeTab === 'closing' && (
          <div className="flex flex-col gap-4">
            <ClosingChecklistForm currentUser={currentUser} isAdmin={isAdmin} canConfirm={isAdmin} />
          </div>
        )}
        {activeTab === 'personal'   && <PersonalHygieneForm currentUser={currentUser} isAdmin={isAdmin} canConfirm={isAdmin} />}
        {activeTab === 'temp'       && <TempForm currentUser={currentUser} isAdmin={isAdmin} canConfirm={isAdmin} />}
      </div>
    </div>
    </HaccpCompanyContext.Provider>
  );
};

export const HaccpChecklistForCompany: React.FC<{ currentUser?: { id: string; name: string }; isAdmin?: boolean; companyId: CompanyId }> = ({ currentUser, isAdmin, companyId }) => {
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  // 탭 순서: 관리자가 드래그로 변경 → Firestore에 저장돼 모든 기기에서 동일하게 표시
  const [tabOrder, setTabOrder] = useState<string[]>([]);
  const pendingTabOrder = useRef<string[] | null>(null);
  useEffect(() => {
    return onSnapshot(doc(db, 'haccp_templates', haccpTemplateDocId(companyId, 'haccp_tab_order')), snap => {
      const data = snap.exists() ? snap.data().order : null;
      if (Array.isArray(data)) setTabOrder(data);
    });
  }, [companyId]);

  // 저장된 순서 우선, 저장에 없는(새로 생긴) 탭은 기본 순서로 뒤에 붙임
  const tabById = new Map(TABS.map(t => [t.id as string, t]));
  const orderedTabs = [
    ...tabOrder.map(id => tabById.get(id)).filter((t): t is typeof TABS[number] => !!t),
    ...TABS.filter(t => !tabOrder.includes(t.id)),
  ];

  const { dragIdx, handleProps, rowProps } = useDragReorder(
    (from, to) => {
      const next = arrayMove(orderedTabs.map(t => t.id as string), from, to);
      pendingTabOrder.current = next;
      setTabOrder(next);
    },
    () => {
      if (!pendingTabOrder.current) return;
      setDocument('haccp_templates', haccpTemplateDocId(companyId, 'haccp_tab_order'), { order: pendingTabOrder.current });
      pendingTabOrder.current = null;
    }
  );

  return (
    <HaccpCompanyContext.Provider value={companyId}>
    <div className="flex flex-col h-full bg-slate-50">
      {/* 헤더 */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center">
            <ClipboardList size={18} className="text-emerald-600" />
          </div>
          <div>
            <h1 className="text-base font-black text-slate-800">HACCP 관리 체크리스트</h1>
            <p className="text-xs text-slate-400">소규모 업체 기준 · 태백식품 신규공장 (향미유·고춧가루)</p>
          </div>
        </div>
      </div>

      {/* 탭 네비게이션 */}
      <div className="bg-white border-b border-slate-200 px-4 overflow-x-auto">
        <div className="flex gap-0.5 py-2 min-w-max">
          {orderedTabs.map((tab, idx) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              {...(isAdmin ? { ...handleProps(idx), ...rowProps(idx) } : {})}
              title={isAdmin ? '드래그로 탭 순서 변경' : undefined}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? 'bg-emerald-50 text-emerald-700 font-bold'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              } ${dragIdx === idx ? 'opacity-60 ring-1 ring-indigo-400' : ''}`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 탭 설명 */}
      <div className="px-6 py-2 bg-slate-50 border-b border-slate-100">
        <p className="text-xs text-slate-500">{TABS.find(t => t.id === activeTab)?.desc}</p>
      </div>

      {/* 콘텐츠 */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'overview'  && <OverviewForm />}
        {activeTab === 'daily'     && <DailyForm />}
        {activeTab === 'cleaning'  && <CleaningForm currentUser={currentUser} isAdmin={isAdmin} canConfirm={false} />}
        {activeTab === 'pest'      && <PestForm />}
        {activeTab === 'temp'      && (
          <div className="flex flex-col gap-4">
            <TempZoneTemplateEditor />
            <TempForm currentUser={currentUser} isAdmin={isAdmin} canConfirm={isAdmin ?? false} />
          </div>
        )}
        {activeTab === 'ccp-heat'  && <CCPHeatForm />}
        {activeTab === 'ccp-metal'   && <CCPMetalForm />}
        {activeTab === 'incoming'    && <IncomingForm currentUser={currentUser} isAdmin={isAdmin} canConfirm={false} />}
        {activeTab === 'sanitation'  && (
          <div className="flex flex-col gap-4">
            <SanitationTemplateEditor />
            <SanitationForm currentUser={currentUser} isAdmin={isAdmin} canConfirm={isAdmin ?? false} />
          </div>
        )}
        {activeTab === 'weekly-sanitation' && (
          <div className="flex flex-col gap-4">
            {isAdmin && <PeriodicSanitationTemplateEditor cycle="weekly" />}
            {isAdmin && <PeriodicSanitationTemplateEditor cycle="monthly" />}
            <PeriodicSanitationForm currentUser={currentUser} isAdmin={isAdmin} canConfirm={isAdmin ?? false} />
          </div>
        )}
        {activeTab === 'closing' && (
          <div className="flex flex-col gap-4">
            {isAdmin && <ClosingChecklistTemplateEditor />}
            <ClosingChecklistForm currentUser={currentUser} isAdmin={isAdmin} canConfirm={isAdmin ?? false} />
          </div>
        )}
        {activeTab === 'personal'    && (
          <div className="flex flex-col gap-4">
            <PersonalHygieneTemplateEditor />
            <PersonalHygieneForm currentUser={currentUser} isAdmin={isAdmin} canConfirm={isAdmin ?? false} />
          </div>
        )}
      </div>
    </div>
    </HaccpCompanyContext.Provider>
  );
};
