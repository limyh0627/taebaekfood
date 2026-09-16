import { ChevronDown, Search } from 'lucide-react';

export type StatementAccountChoice = {
  value: string;
  label: string;
  path: string;
  axis: '손익' | '재무';
  branch: string;
  isGroup?: boolean;
  groupId?: string;
};

export default function StatementHistorySearchFields(props: {
  partner: string;
  partnerOpen: boolean;
  partnerQuery: string;
  partnerShown: string[];
  onPartnerOpen: (open: boolean) => void;
  onPartnerQuery: (query: string) => void;
  onPartner: (partner: string) => void;
  account: string;
  accountOpen: boolean;
  accountQuery: string;
  accountAxis: '' | '손익' | '재무';
  accountBranch: string;
  accountGroup: string;
  accountPicked?: StatementAccountChoice;
  accountShown: StatementAccountChoice[];
  accountItems: StatementAccountChoice[];
  onAccountOpen: (open: boolean) => void;
  onAccountQuery: (query: string) => void;
  onAccountAxis: (axis: '' | '손익' | '재무') => void;
  onAccountBranch: (branch: string) => void;
  onAccountGroup: (group: string) => void;
  onAccount: (account: string) => void;
  search: string;
  onSearch: (search: string) => void;
}) {
  const closeAccount = () => props.onAccountOpen(false);
  const clearAccount = () => {
    props.onAccount(''); props.onAccountAxis(''); props.onAccountBranch(''); props.onAccountGroup(''); closeAccount();
  };
  return <>
    <div className="relative flex flex-col gap-1">
      <span className="text-[10px] font-bold text-slate-500">거래처</span>
      <button type="button" onClick={() => { props.onPartnerOpen(!props.partnerOpen); props.onPartnerQuery(''); }}
        className={`flex h-9 min-w-[145px] max-w-[210px] items-center justify-between gap-1.5 rounded-md border bg-slate-50 px-2.5 text-xs font-bold outline-none transition-all ${props.partner ? 'border-indigo-300 text-indigo-700' : 'border-slate-200 text-slate-500 hover:border-slate-400'}`}>
        <span className="truncate">{props.partner || '거래처 선택'}</span><ChevronDown size={12} className="shrink-0 opacity-50"/>
      </button>
      {props.partnerOpen && <>
        <div className="fixed inset-0 z-40" onClick={() => props.onPartnerOpen(false)}/>
        <div className="absolute left-0 top-full z-50 mt-1 w-[240px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
          <div className="border-b border-slate-100 p-2"><input autoFocus value={props.partnerQuery} onChange={event => props.onPartnerQuery(event.target.value)} placeholder="거래처 이름으로 찾기" className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300"/></div>
          <div className="h-[260px] overflow-y-auto py-1">
            {props.partner && <button type="button" onClick={() => { props.onPartner(''); props.onPartnerOpen(false); }} className="w-full px-3 py-1.5 text-left text-xs font-black text-slate-400 hover:bg-slate-50">필터 해제</button>}
            {!props.partnerShown.length && <p className="px-3 py-6 text-center text-[11px] font-bold text-slate-300">찾는 거래처가 없습니다</p>}
            {props.partnerShown.map(name => <button key={name} type="button" onClick={() => { props.onPartner(name); props.onPartnerOpen(false); }} className={`w-full px-3 py-1.5 text-left text-xs font-black transition-colors hover:bg-slate-50 ${props.partner === name ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700'}`}>{name}</button>)}
          </div>
        </div>
      </>}
    </div>

    <div className="relative flex flex-col gap-1">
      <span className="text-[10px] font-bold text-slate-500">계정과목</span>
      <button type="button" onClick={() => { props.onAccountOpen(!props.accountOpen); props.onAccountQuery(''); }}
        className={`flex h-9 min-w-[190px] max-w-[280px] items-center justify-between gap-1.5 rounded-md border bg-slate-50 px-2.5 text-xs font-bold outline-none transition-all ${props.account ? 'border-indigo-300 text-indigo-700' : 'border-slate-200 text-slate-500 hover:border-slate-400'}`}>
        <span className="truncate">{props.accountPicked ? <><span className="font-bold text-slate-400">{props.accountPicked.path} › </span>{props.accountPicked.label}</> : '계정 선택'}</span>
        <ChevronDown size={12} className="shrink-0 opacity-50"/>
      </button>
      {props.accountOpen && <>
        <div className="fixed inset-0 z-40" onClick={closeAccount}/>
        <div className="absolute left-0 top-full z-50 mt-1 w-[320px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
          <div className="border-b border-slate-100 p-2"><input autoFocus value={props.accountQuery} onChange={event => props.onAccountQuery(event.target.value)} placeholder="계정 이름·번호·묶음(재료비·판관비)" className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300"/></div>
          {!props.accountQuery.trim() && <div className="space-y-1.5 border-b border-slate-100 px-2 py-2">
            <div className="flex gap-1">{(['손익', '재무'] as const).map(axis => <button key={axis} type="button" onClick={() => { props.onAccountAxis(axis); props.onAccountBranch(''); props.onAccountGroup(''); }} className={`flex-1 rounded-lg border py-1.5 text-[11px] font-black transition-all ${props.accountAxis === axis ? 'border-slate-700 bg-slate-700 text-white' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-400'}`}>{axis}</button>)}</div>
            {props.accountAxis && <div className="flex gap-1">{(props.accountAxis === '손익' ? ['이익', '비용'] : ['자산', '부채', '자본']).map(branch => <button key={branch} type="button" onClick={() => { props.onAccountBranch(branch); props.onAccountGroup(''); }} className={`flex-1 rounded-lg border py-1.5 text-[11px] font-black transition-all ${props.accountBranch === branch ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-400'}`}>{branch}</button>)}</div>}
            {props.accountBranch && props.accountGroup && <button type="button" onClick={() => props.onAccountGroup('')} className="flex w-full items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1.5 text-[11px] font-black text-indigo-700 transition-all hover:bg-indigo-100"><ChevronDown size={11} className="shrink-0 rotate-90"/>{props.accountItems.find(item => item.isGroup && item.groupId === props.accountGroup)?.label ?? '묶음'}<span className="ml-auto text-[10px] font-bold text-indigo-400">묶음 다시 고르기</span></button>}
          </div>}
          <div className="h-[260px] overflow-y-auto py-1">
            {props.account && <button type="button" onClick={clearAccount} className="w-full px-3 py-1.5 text-left text-xs font-black text-slate-400 hover:bg-slate-50">필터 해제</button>}
            {!props.accountShown.length && <p className="px-3 py-6 text-center text-[11px] font-bold text-slate-300">{props.accountQuery.trim() ? '찾는 계정이 없습니다' : !props.accountAxis ? '손익 · 재무 중에서 고르세요' : !props.accountBranch ? '갈래를 고르세요' : props.accountGroup ? '이 묶음에 딸린 계정이 없습니다' : '묶음을 고르세요'}</p>}
            {props.accountShown.map(item => <button key={item.value} type="button" onClick={() => { if (item.isGroup && !props.accountQuery.trim()) { props.onAccountGroup(item.groupId ?? ''); return; } props.onAccount(item.value); closeAccount(); }} className={`w-full px-3 py-1.5 text-left transition-colors hover:bg-slate-50 ${props.account === item.value ? 'bg-indigo-50' : ''}`}>
              <span className={`text-xs font-black ${props.account === item.value ? 'text-indigo-700' : 'text-slate-700'}`}>{item.label}{item.isGroup && <span role="button" tabIndex={0} onClick={event => { event.stopPropagation(); props.onAccount(item.value); closeAccount(); }} onKeyDown={event => { if (event.key === 'Enter') (event.target as HTMLElement).click(); }} className="float-right cursor-pointer rounded-full bg-indigo-100 px-1.5 py-0.5 text-[9px] font-black text-indigo-600 hover:bg-indigo-200">이 묶음 전체</span>}</span>
              <span className="block text-[10px] font-bold leading-tight text-slate-300">{item.path}</span>
            </button>)}
          </div>
        </div>
      </>}
    </div>

    <label className="flex min-w-[260px] max-w-sm flex-1 flex-col gap-1"><span className="text-[10px] font-bold text-slate-500">전체 검색</span><div className="relative"><Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input type="text" placeholder="업체명 · 문서번호 · 계정과목 검색" value={props.search} onChange={event => props.onSearch(event.target.value)} className="h-9 w-full rounded-md border border-slate-200 bg-slate-50 pl-8 pr-3 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-400"/></div></label>
  </>;
}
