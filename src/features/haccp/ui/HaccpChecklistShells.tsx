import React, {useState,useRef,useEffect,useReducer} from 'react';
import {ClipboardList,Thermometer,Bug,CheckSquare,Scan,ShoppingCart,Wrench,ShieldAlert,User} from 'lucide-react';
import {doc,onSnapshot} from 'firebase/firestore';
import {db} from '../../../shared/firebase';
import {setDocument} from '../../../shared/services/firebaseService';
import {haccpTemplateDocId} from '../../../shared/haccpTemplateId';
import type {CompanyId} from '../../../shared/types';
import {HaccpCompanyContext} from '../context/HaccpCompanyContext';
import {useHaccpRecordActor} from '../hooks/useHaccpRecordActor';
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

type OrderOutcome = 'idle' | 'saving' | 'saved' | 'rejected' | 'unknown' | 'blocked' | 'matched' | 'server';
const sameOrder = (left: string[], right: string[]) => JSON.stringify(left) === JSON.stringify(right);

function useChecklistTabOrder(options: {companyId: CompanyId; currentUserId?: string; isAdmin?: boolean; templateKey: string}) {
  const actor = useHaccpRecordActor(options), owner = actor.ownerToken;
  const admin = useRef(options.isAdmin); admin.current = options.isAdmin;
  const [, paint] = useReducer(value => value + 1, 0);
  const make = () => ({owner, key: options.templateKey, order: [] as string[], server: [] as string[], pending: null as string[] | null,
    ack: null as string[] | null, echo: null as string[] | null, run: null as object | null, ready: false, readError: '', error: '', outcome: 'idle' as OrderOutcome, revision: 0});
  const ref = useRef<ReturnType<typeof make> | null>(null);
  if (!ref.current || ref.current.owner !== owner || ref.current.key !== options.templateKey) ref.current = make();
  const state = ref.current;
  const current = () => ref.current === state && actor.isCurrent(owner);
  const authorized = () => current() && actor.canAct('save', owner) && !!admin.current;
  const notify = () => { if (current()) paint(); };
  const blockPending = () => {
    if (state.pending && !state.run && state.outcome === 'idle') {
      state.outcome = 'blocked'; state.error = '탭 순서를 아직 저장하지 않았습니다. 변경한 순서는 전송하지 않았으며 화면에 보존했습니다. 서버 조회와 관리자 권한을 확인해 주세요.';
    }
  };
  if (!authorized()) blockPending();
  const canMove = () => authorized() && state.ready && !state.run && state.outcome !== 'unknown' && state.outcome !== 'rejected' && state.outcome !== 'blocked';
  useEffect(() => {
    let active = true;
    state.ready = false; state.readError = '';
    const stop = onSnapshot(doc(db, 'haccp_templates', haccpTemplateDocId(options.companyId, state.key)), {includeMetadataChanges: true}, snap => {
      if (!active || !current()) return;
      state.ready = snap.metadata?.fromCache === false;
      if (!state.ready) blockPending();
      if (state.ready) {
        const value = snap.exists() ? snap.data().order : undefined;
        state.server = Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
        state.readError = '';
        if (state.run && state.pending && sameOrder(state.pending, state.server)) state.echo = [...state.server];
        if (state.pending) {
          if (!state.run && sameOrder(state.pending, state.server)) {
            state.pending = null; state.ack = null; state.order = [...state.server]; state.error = ''; state.outcome = 'matched';
          }
        } else if (state.ack) {
          if (sameOrder(state.ack, state.server)) { state.ack = null; state.order = [...state.server]; }
        } else state.order = [...state.server];
      }
      notify();
    }, () => {
      if (!active || !current()) return;
      active = false; state.ready = false; blockPending(); state.readError = '탭 순서를 조회하지 못했습니다. 화면 순서는 유지했습니다. 다시 조회해 주세요.'; notify();
    });
    return () => { active = false; stop(); };
  }, [state, state.revision]);
  const send = async () => {
    if (!authorized() || !state.ready || state.run || !state.pending) return;
    const order = [...state.pending], run = {}; state.run = run; state.echo = null; state.outcome = 'saving'; state.error = ''; notify();
    const owns = () => current() && state.run === run;
    try {
      if (!authorized() || !state.ready) return;
      await setDocument('haccp_templates', haccpTemplateDocId(options.companyId, state.key), {order});
      if (!owns()) return;
      // 역할·조회 상태가 바뀌어도 같은 owner가 이미 받은 정상 응답은 성공으로 남긴다.
      state.pending = null; state.order = order; state.ack = (state.echo && sameOrder(state.echo, order)) || sameOrder(state.server, order) ? null : order;
      state.outcome = 'saved'; state.error = '';
    } catch (error) {
      if (!owns()) return;
      if (state.ready && sameOrder(state.server, order)) {
        state.pending = null; state.order = [...state.server]; state.ack = null; state.outcome = 'matched'; state.error = '';
      } else {
        const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
        const rejected = ['permission-denied', 'unauthenticated', 'invalid-argument'].some(value => code.includes(value));
        state.pending = order; state.order = order; state.outcome = rejected ? 'rejected' : 'unknown';
        state.error = rejected ? (code.includes('invalid-argument') ? '입력 형식 때문에 저장이 거절되었습니다. 화면 순서는 보존했습니다. 입력을 확인한 뒤 다시 저장하거나 서버 순서를 사용해 주세요.' : '계정 권한 때문에 저장이 거절되었습니다. 화면 순서는 보존했습니다. 권한을 확인한 뒤 다시 저장하거나 서버 순서를 사용해 주세요.') : '탭 순서의 저장 여부를 확인하지 못했습니다. 변경한 화면 순서는 보존했습니다.';
      }
    } finally { if (owns()) { state.run = null; notify(); } }
  };
  return {
    order: state.order, canDrag: canMove(), busy: !!state.run, ready: state.ready, error: state.error, readError: state.readError,
    outcome: state.outcome, pending: !!state.pending, canRetry: authorized() && state.ready && !state.run && !!state.pending,
    canUseServer: current() && state.ready && !state.run && (!!state.pending || !!state.ack),
    differs: !!state.pending && state.ready && !sameOrder(state.pending, state.server),
    move(order: string[]) { if (!canMove()) return; state.order = [...order]; state.pending = [...order]; state.ack = null; state.echo = null; state.error = ''; state.outcome = 'idle'; notify(); },
    settle: () => { if (state.outcome !== 'idle' || !state.pending) return; if (!authorized() || !state.ready) { blockPending(); notify(); return; } void send(); },
    retry: () => { if (state.outcome === 'unknown' || state.outcome === 'rejected' || state.outcome === 'blocked' || (state.outcome === 'idle' && state.pending)) void send(); },
    refresh() { if (!current() || state.run) return; state.ready = false; state.readError = ''; state.revision++; notify(); },
    useServer() { if (!current() || !state.ready || state.run) return; state.pending = null; state.ack = null; state.order = [...state.server]; state.error = ''; state.outcome = 'server'; notify(); },
  };
}

const TabOrderStatus = ({control}: {control: ReturnType<typeof useChecklistTabOrder>}) => {
  const message = control.error || control.readError;
  if (!message && control.ready && control.outcome === 'idle' && !control.pending) return null;
  return <div className="mx-4 my-2 rounded border border-slate-200 bg-white p-3 text-xs text-slate-700" role={message ? 'alert' : 'status'}>
    <p>{message || (control.busy ? '탭 순서를 저장 중입니다. 탭 선택은 계속 사용할 수 있습니다.' : control.outcome === 'saved' ? '탭 순서를 저장했습니다.' : control.outcome === 'matched' ? '현재 서버 순서가 변경한 순서와 같습니다.' : control.outcome === 'server' ? '현재 서버 순서를 표시했습니다.' : control.pending && control.ready ? '탭 순서를 변경했습니다. 드래그 종료 후 저장합니다.' : '서버의 탭 순서를 확인 중입니다. 탭은 사용할 수 있습니다.')}</p>
    {control.outcome === 'saved' && message && <p className="mt-1">탭 순서 저장 응답은 확인했습니다. 이후 조회는 다시 확인해 주세요.</p>}
    {control.differs && <p className="mt-1">조회된 서버 순서와 변경한 화면 순서가 다릅니다.</p>}
    {control.pending && !control.busy && <p className="mt-1">{control.outcome === 'blocked' || control.outcome === 'idle' ? '이 변경은 아직 전송하지 않았습니다. 다시 저장하면 다른 기기의 순서를 덮을 수 있습니다.' : control.outcome === 'unknown' ? '다시 저장하면 보존한 순서로 다른 기기의 순서를 덮을 수 있습니다. 서버 순서 사용은 미확인 요청을 취소하지 않습니다.' : '다시 저장하면 보존한 순서로 다른 기기의 순서를 덮을 수 있습니다.'}</p>}
    <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" disabled={control.busy} onClick={control.refresh} className="rounded border px-2 py-1 disabled:opacity-40">탭 순서 다시 조회</button>
      {control.pending && !control.busy && <button type="button" disabled={!control.canRetry} onClick={control.retry} className="rounded border px-2 py-1 disabled:opacity-40">보존한 순서 다시 저장</button>}
      {control.canUseServer && <button type="button" onClick={control.useServer} className="rounded border px-2 py-1">서버 순서 사용</button>}
    </div>
  </div>;
};

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
  const orderControl = useChecklistTabOrder({companyId, currentUserId: currentUser?.id, isAdmin, templateKey: 'staff_tab_order'});
  const tabOrder = orderControl.order;

  // 저장된 순서 우선, 저장에 없는(새로 생긴) 탭은 기본 순서로 뒤에 붙임
  const tabById = new Map(STAFF_TABS.map(t => [t.id as string, t]));
  const orderedTabs = [
    ...tabOrder.map(id => tabById.get(id)).filter((t): t is typeof STAFF_TABS[number] => !!t),
    ...STAFF_TABS.filter(t => !tabOrder.includes(t.id)),
  ];

  const { dragIdx, handleProps, rowProps } = useDragReorder(
    (from, to) => {
      const next = arrayMove(orderedTabs.map(t => t.id as string), from, to);
      orderControl.move(next);
    },
    orderControl.settle
  );

  return (
    <HaccpCompanyContext.Provider value={companyId}>
    <div className="flex flex-col h-full bg-slate-50">
      <TabOrderStatus control={orderControl} />
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
              {...(orderControl.canDrag ? { ...handleProps(idx), ...rowProps(idx) } : {})}
              title={orderControl.canDrag ? '드래그로 탭 순서 변경' : undefined}
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
  const orderControl = useChecklistTabOrder({companyId, currentUserId: currentUser?.id, isAdmin, templateKey: 'haccp_tab_order'});
  const tabOrder = orderControl.order;

  // 저장된 순서 우선, 저장에 없는(새로 생긴) 탭은 기본 순서로 뒤에 붙임
  const tabById = new Map(TABS.map(t => [t.id as string, t]));
  const orderedTabs = [
    ...tabOrder.map(id => tabById.get(id)).filter((t): t is typeof TABS[number] => !!t),
    ...TABS.filter(t => !tabOrder.includes(t.id)),
  ];

  const { dragIdx, handleProps, rowProps } = useDragReorder(
    (from, to) => {
      const next = arrayMove(orderedTabs.map(t => t.id as string), from, to);
      orderControl.move(next);
    },
    orderControl.settle
  );

  return (
    <HaccpCompanyContext.Provider value={companyId}>
    <div className="flex flex-col h-full bg-slate-50">
      <TabOrderStatus control={orderControl} />
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
              {...(orderControl.canDrag ? { ...handleProps(idx), ...rowProps(idx) } : {})}
              title={orderControl.canDrag ? '드래그로 탭 순서 변경' : undefined}
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
