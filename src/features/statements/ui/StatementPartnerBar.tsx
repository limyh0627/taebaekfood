import { ChevronLeft, Search } from 'lucide-react';

export default function StatementPartnerBar(props: {
  partners: { id: string; name: string }[];
  selectedPartnerId: string;
  search: string;
  sale: boolean;
  editing: boolean;
  onlyActive: boolean;
  manualMode: boolean;
  onSearch: (value: string) => void;
  onSelect: (partnerId: string) => void;
  onClear: () => void;
  onOnlyActive: () => void;
  onManualMode: (manual: boolean) => void;
}) {
  return <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-5 py-2.5">
    {!props.selectedPartnerId ? <>
      <div className="relative"><Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300"/><input type="text" placeholder="거래처 검색..." value={props.search} onChange={event => props.onSearch(event.target.value)} className="w-40 rounded-lg border border-slate-200 bg-white py-1.5 pl-7 pr-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300"/></div>
      <select aria-label="거래처 선택" value={props.selectedPartnerId} onChange={event => props.onSelect(event.target.value)} className="min-w-[180px] rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300"><option value="">— 거래처 선택 —</option>{props.partners.map(partner => <option key={partner.id} value={partner.id}>{partner.name}</option>)}</select>
      {props.sale && <button onClick={props.onOnlyActive} className={`rounded-lg border px-3 py-1.5 text-xs font-black transition-all ${props.onlyActive ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-400'}`}>미발행</button>}
    </> : <>
      <button onClick={props.onClear} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-600 transition-all hover:bg-slate-100"><ChevronLeft size={12}/>거래처 변경</button>
      {props.sale && !props.editing && <div className="ml-auto flex gap-0.5 rounded-lg bg-slate-200 p-0.5"><button onClick={() => props.onManualMode(false)} className={`rounded-md px-3 py-1 text-xs font-black transition-all ${!props.manualMode ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>주문 불러오기</button><button onClick={() => props.onManualMode(true)} className={`rounded-md px-3 py-1 text-xs font-black transition-all ${props.manualMode ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>직접 입력</button></div>}
    </>}
  </div>;
}
