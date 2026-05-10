
import React, { useState, useRef, useMemo } from 'react';
import {
  FileText, Printer, Search, Check, CheckSquare, Download, X,
  Receipt, Eye, Calendar, Building2,
} from 'lucide-react';
import { Client, IssuedStatement, CompanyInfo } from '../types';

interface TaxStatementProps {
  issuedStatements: IssuedStatement[];
  clients: Client[];
  companyInfo?: CompanyInfo | null;
  onUpdateIssuedStatement?: (id: string, data: Partial<IssuedStatement>) => void;
}

const fmt = (n: number) => n.toLocaleString('ko-KR');

const TaxStatement: React.FC<TaxStatementProps> = ({
  issuedStatements,
  clients,
  companyInfo,
  onUpdateIssuedStatement,
}) => {
  const [activeTab, setActiveTab] = useState<'issue' | 'history'>('issue');

  // ── 발행 탭 상태 ──
  const [taxClientId, setTaxClientId] = useState('');
  const [taxClientSearch, setTaxClientSearch] = useState('');
  const [taxStmtIds, setTaxStmtIds] = useState<string[]>([]);
  const [taxBuyerInfo, setTaxBuyerInfo] = useState({ bizNo: '', ceoName: '', bizType: '', bizItem: '', address: '' });
  const taxPrintRef = useRef<HTMLDivElement>(null);

  // ── 조회 탭 상태 ──
  const [histClientId, setHistClientId] = useState('');
  const [histClientSearch, setHistClientSearch] = useState('');
  const [histPreviewId, setHistPreviewId] = useState<string | null>(null);

  // ── 발행 탭 로직 ──
  const taxClients = useMemo(() =>
    clients
      .filter(c => issuedStatements.some(s => s.clientId === c.id && s.type === '매출'))
      .filter(c => !taxClientSearch || c.name.includes(taxClientSearch))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [clients, issuedStatements, taxClientSearch]
  );

  const clientStmts = useMemo(() =>
    taxClientId
      ? issuedStatements.filter(s => s.clientId === taxClientId && s.type === '매출')
          .sort((a, b) => b.tradeDate.localeCompare(a.tradeDate))
      : [],
    [issuedStatements, taxClientId]
  );

  const byMonth = useMemo(() => {
    const m = new Map<string, IssuedStatement[]>();
    clientStmts.forEach(s => {
      const ym = s.tradeDate.slice(0, 7);
      if (!m.has(ym)) m.set(ym, []);
      m.get(ym)!.push(s);
    });
    return m;
  }, [clientStmts]);
  const months = useMemo(() => [...byMonth.keys()].sort((a, b) => b.localeCompare(a)), [byMonth]);

  const selectedStmts = useMemo(() => clientStmts.filter(s => taxStmtIds.includes(s.id)), [clientStmts, taxStmtIds]);

  type MergedItem = { name: string; spec: string; qty: number; supply: number; tax: number; total: number; isTaxExempt: boolean };
  const { mergedItems, taxSupply, taxAmt, exemptSup, grandTotal } = useMemo(() => {
    const mergedMap = new Map<string, MergedItem>();
    selectedStmts.forEach(stmt => {
      stmt.items.forEach(item => {
        const k = `${item.name}||${item.spec}||${item.isTaxExempt}`;
        const ex = mergedMap.get(k);
        if (ex) { ex.qty += item.qty; ex.supply += item.supply; ex.tax += item.tax; ex.total += item.total; }
        else mergedMap.set(k, { name: item.name, spec: item.spec, qty: item.qty, supply: item.supply, tax: item.tax, total: item.total, isTaxExempt: !!item.isTaxExempt });
      });
    });
    const all = [...mergedMap.values()];
    const taxable = all.filter(i => !i.isTaxExempt);
    const exempt = all.filter(i => i.isTaxExempt);
    const ts = taxable.reduce((s, i) => s + i.supply, 0);
    const ta = taxable.reduce((s, i) => s + i.tax, 0);
    const es = exempt.reduce((s, i) => s + i.supply, 0);
    return { mergedItems: { taxable, exempt }, taxSupply: ts, taxAmt: ta, exemptSup: es, grandTotal: ts + ta + es };
  }, [selectedStmts]);

  const toggleStmt = (id: string) =>
    setTaxStmtIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const toggleMonth = (ym: string) => {
    const ids = (byMonth.get(ym) || []).map(s => s.id);
    const allSel = ids.every(id => taxStmtIds.includes(id));
    setTaxStmtIds(prev => allSel ? prev.filter(id => !ids.includes(id)) : [...new Set([...prev, ...ids])]);
  };

  const selectedClient = clients.find(c => c.id === taxClientId);
  const tradeMonth = selectedStmts.length > 0 ? selectedStmts[selectedStmts.length - 1].tradeDate.slice(0, 7) : '';

  const handleTaxIssue = () => {
    if (selectedStmts.length === 0) return;
    const issuedAt = new Date().toISOString();
    selectedStmts.forEach(s => onUpdateIssuedStatement?.(s.id, { taxIssuedAt: issuedAt }));
    setTaxStmtIds([]);
  };

  const handleTaxPdf = async () => {
    if (!taxPrintRef.current || selectedStmts.length === 0) return;
    const html2canvas = (await import('html2canvas')).default;
    const jsPDF = (await import('jspdf')).default;
    const canvas = await html2canvas(taxPrintRef.current, { scale: 2, useCORS: true });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth(), pageH = pdf.internal.pageSize.getHeight();
    const imgW = pageW - 20, imgH = canvas.height * imgW / canvas.width;
    pdf.addImage(imgData, 'PNG', 10, imgH < pageH ? (pageH - imgH) / 2 : 10, imgW, imgH);
    pdf.save(`세금계산서_${selectedClient?.name}_${tradeMonth}.pdf`);
  };

  const handleTaxPrint = () => {
    if (!taxPrintRef.current || selectedStmts.length === 0) return;
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>세금계산서</title>
      <style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:'Malgun Gothic','맑은 고딕',sans-serif;font-size:10px;background:#fff;padding:12px;}
      .wrap{border:2px solid #000;width:100%;}.title-row{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #000;padding:6px 10px;}
      .title-row h1{font-size:18px;font-weight:900;letter-spacing:6px;}.info-grid{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid #000;}
      .info-box{padding:6px 8px;border-right:1px solid #000;}.info-box:last-child{border-right:none;}
      .info-box h3{font-size:9px;font-weight:900;color:#333;margin-bottom:4px;border-bottom:1px solid #eee;padding-bottom:2px;}
      .info-row{display:flex;gap:4px;margin-bottom:2px;font-size:9px;}.info-row label{color:#666;width:64px;}
      .items-table{width:100%;border-collapse:collapse;font-size:9px;}
      .items-table th{background:#f5f5f5;border:1px solid #ccc;padding:4px 6px;font-weight:900;text-align:center;}
      .items-table td{border:1px solid #ccc;padding:4px 6px;text-align:right;}.items-table td.left{text-align:left;}.items-table td.center{text-align:center;}
      .section-header{background:#e8f0fe;font-weight:900;font-size:9px;padding:3px 6px;border:1px solid #ccc;}
      .total-row{display:flex;justify-content:flex-end;gap:16px;padding:8px 10px;border-top:2px solid #000;font-size:11px;font-weight:900;}
      @media print{body{padding:0;}@page{margin:8mm;}}</style></head><body>`);
    win.document.write(taxPrintRef.current.innerHTML);
    win.document.write('</body></html>');
    win.document.close(); win.focus();
    setTimeout(() => win.print(), 500);
  };

  // ── 조회 탭 로직 ──
  const issuedClients = useMemo(() =>
    clients
      .filter(c => issuedStatements.some(s => s.clientId === c.id && s.type === '매출' && !!s.taxIssuedAt))
      .filter(c => !histClientSearch || c.name.includes(histClientSearch))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [clients, issuedStatements, histClientSearch]
  );

  const histStmts = useMemo(() =>
    issuedStatements
      .filter(s => s.type === '매출' && !!s.taxIssuedAt && (!histClientId || s.clientId === histClientId))
      .sort((a, b) => (b.taxIssuedAt ?? '').localeCompare(a.taxIssuedAt ?? '')),
    [issuedStatements, histClientId]
  );

  // ── 미리보기용 단일 전표 ──
  const previewStmt = histPreviewId ? issuedStatements.find(s => s.id === histPreviewId) : null;
  const previewClient = previewStmt ? clients.find(c => c.id === previewStmt.clientId) : null;
  const previewPrintRef = useRef<HTMLDivElement>(null);

  const handleHistPrint = () => {
    if (!previewPrintRef.current) return;
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>세금계산서</title>
      <style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:'Malgun Gothic','맑은 고딕',sans-serif;font-size:10px;background:#fff;padding:12px;}
      table{border-collapse:collapse;width:100%;}th,td{border:1px solid #ccc;padding:5px 8px;}th{background:#f5f5f5;font-weight:900;text-align:center;}
      @media print{body{padding:0;}@page{margin:8mm;}}</style></head><body>`);
    win.document.write(previewPrintRef.current.innerHTML);
    win.document.write('</body></html>');
    win.document.close(); win.focus();
    setTimeout(() => win.print(), 500);
  };

  const handleHistPdf = async () => {
    if (!previewPrintRef.current || !previewStmt) return;
    const html2canvas = (await import('html2canvas')).default;
    const jsPDF = (await import('jspdf')).default;
    const canvas = await html2canvas(previewPrintRef.current, { scale: 2, useCORS: true });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth(), pageH = pdf.internal.pageSize.getHeight();
    const imgW = pageW - 20, imgH = canvas.height * imgW / canvas.width;
    pdf.addImage(imgData, 'PNG', 10, imgH < pageH ? (pageH - imgH) / 2 : 10, imgW, imgH);
    pdf.save(`세금계산서_${previewClient?.name}_${previewStmt.tradeDate.slice(0, 7)}.pdf`);
  };

  const sup = companyInfo;

  const TaxInvoicePreview = ({ stmt, clientName, buyerInfo }: {
    stmt: IssuedStatement;
    clientName?: string;
    buyerInfo?: typeof taxBuyerInfo;
  }) => {
    const taxable = stmt.items.filter(i => !i.isTaxExempt);
    const exempt = stmt.items.filter(i => i.isTaxExempt);
    const ts = taxable.reduce((s, i) => s + i.supply, 0);
    const ta = taxable.reduce((s, i) => s + i.tax, 0);
    const es = exempt.reduce((s, i) => s + i.supply, 0);
    const total = ts + ta + es;
    return (
      <div className="wrap border-2 border-black" style={{fontFamily:"'Malgun Gothic','맑은 고딕',sans-serif",minWidth:600,fontSize:'11px'}}>
        <div className="flex items-center justify-between border-b-2 border-black px-4 py-3">
          <h1 style={{fontSize:'20px',fontWeight:900,letterSpacing:'6px'}}>세 금 계 산 서</h1>
          <div className="text-right" style={{fontSize:'10px',color:'#666'}}>
            <div>거래처: {clientName}</div>
            <div>거래일: {stmt.tradeDate}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 border-b border-black">
          <div className="p-3 border-r border-black">
            <h3 style={{fontSize:'10px',fontWeight:900,marginBottom:'6px',paddingBottom:'4px',borderBottom:'1px solid #eee',color:'#444'}}>공 급 자</h3>
            {[['등록번호', sup?.bizNo||''], ['상    호', sup?.name||''], ['대 표 자', sup?.ceoName||''], ['사업장주소', sup?.address||''], ['업    태', sup?.bizType||''], ['종    목', sup?.bizItem||'']].map(([label, value]) => (
              <div key={label} style={{display:'flex',gap:'8px',marginBottom:'3px',fontSize:'10px'}}>
                <span style={{color:'#666',width:'60px',flexShrink:0}}>{label}</span>
                <span style={{fontWeight:700}}>{value}</span>
              </div>
            ))}
          </div>
          <div className="p-3">
            <h3 style={{fontSize:'10px',fontWeight:900,marginBottom:'6px',paddingBottom:'4px',borderBottom:'1px solid #eee',color:'#444'}}>공급받는자</h3>
            {[['등록번호', buyerInfo?.bizNo||''], ['상    호', clientName||''], ['대 표 자', buyerInfo?.ceoName||''], ['사업장주소', buyerInfo?.address||''], ['업    태', buyerInfo?.bizType||''], ['종    목', buyerInfo?.bizItem||'']].map(([label, value]) => (
              <div key={label} style={{display:'flex',gap:'8px',marginBottom:'3px',fontSize:'10px'}}>
                <span style={{color:'#666',width:'60px',flexShrink:0}}>{label}</span>
                <span style={{fontWeight:700}}>{value}</span>
              </div>
            ))}
          </div>
        </div>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:'11px'}}>
          <thead>
            <tr>{['품목','규격','수량','공급가액','세액','합계'].map(h => (
              <th key={h} style={{border:'1px solid #ccc',background:'#f5f5f5',padding:'6px 8px',fontWeight:900,textAlign:'center'}}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {taxable.length > 0 && (<>
              <tr><td colSpan={6} style={{padding:'4px 8px',background:'#dbeafe',fontWeight:900,color:'#1d4ed8',border:'1px solid #ccc',fontSize:'10px'}}>▶ 과세 품목</td></tr>
              {taxable.map((item, i) => (
                <tr key={i}>
                  <td style={{border:'1px solid #ccc',padding:'5px 8px',fontWeight:700}}>{item.name}</td>
                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'center'}}>{item.spec}</td>
                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right'}}>{fmt(item.qty)}</td>
                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right'}}>{fmt(item.supply)}</td>
                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right'}}>{fmt(item.tax)}</td>
                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900}}>{fmt(item.total)}</td>
                </tr>
              ))}
              <tr style={{background:'#eff6ff'}}>
                <td colSpan={3} style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900,color:'#1d4ed8'}}>과세 소계</td>
                <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900,color:'#1d4ed8'}}>{fmt(ts)}</td>
                <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900,color:'#1d4ed8'}}>{fmt(ta)}</td>
                <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900,color:'#1d4ed8'}}>{fmt(ts+ta)}</td>
              </tr>
            </>)}
            {exempt.length > 0 && (<>
              <tr><td colSpan={6} style={{padding:'4px 8px',background:'#e0e7ff',fontWeight:900,color:'#4338ca',border:'1px solid #ccc',fontSize:'10px'}}>▶ 면세 품목</td></tr>
              {exempt.map((item, i) => (
                <tr key={i}>
                  <td style={{border:'1px solid #ccc',padding:'5px 8px',fontWeight:700}}>{item.name}</td>
                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'center'}}>{item.spec}</td>
                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right'}}>{fmt(item.qty)}</td>
                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right'}}>{fmt(item.supply)}</td>
                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'center',color:'#666'}}>면세</td>
                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900}}>{fmt(item.supply)}</td>
                </tr>
              ))}
              <tr style={{background:'#eef2ff'}}>
                <td colSpan={3} style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900,color:'#4338ca'}}>면세 소계</td>
                <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900,color:'#4338ca'}}>{fmt(es)}</td>
                <td style={{border:'1px solid #ccc',padding:'5px 8px'}}/>
                <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900,color:'#4338ca'}}>{fmt(es)}</td>
              </tr>
            </>)}
            <tr style={{background:'#f1f5f9'}}>
              <td colSpan={3} style={{border:'1px solid #ccc',padding:'7px 8px',textAlign:'right',fontWeight:900,fontSize:'12px'}}>합 계</td>
              <td style={{border:'1px solid #ccc',padding:'7px 8px',textAlign:'right',fontWeight:900}}>{fmt(ts+es)}</td>
              <td style={{border:'1px solid #ccc',padding:'7px 8px',textAlign:'right',fontWeight:900}}>{fmt(ta)}</td>
              <td style={{border:'1px solid #ccc',padding:'7px 8px',textAlign:'right',fontWeight:900,color:'#059669',fontSize:'13px'}}>{fmt(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 탭 헤더 */}
      <div className="flex bg-white rounded-2xl border border-slate-200 p-1 gap-1 self-start shadow-sm">
        {([
          { id: 'issue' as const, icon: Receipt, label: '발행' },
          { id: 'history' as const, icon: Eye, label: '조회' },
        ]).map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-black transition-all ${activeTab === t.id ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
            <t.icon size={14}/>{t.label}
          </button>
        ))}
      </div>

      {/* ── 발행 탭 ── */}
      {activeTab === 'issue' && (
        <div className="flex gap-4 items-start">
          {/* 좌측: 거래처 + 선택 요약 */}
          <div className="w-64 shrink-0 flex flex-col gap-3">
            <div className="bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden" style={{maxHeight:280}}>
              <div className="px-3 pt-3 pb-2 border-b border-slate-100">
                <div className="relative">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none"/>
                  <input type="text" placeholder="거래처 검색..." value={taxClientSearch}
                    onChange={e => setTaxClientSearch(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-7 pr-2 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-emerald-300"/>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
                {taxClients.map(c => (
                  <button key={c.id} onClick={() => { setTaxClientId(c.id); setTaxStmtIds([]); }}
                    className={`w-full text-left px-3 py-2.5 transition-all hover:bg-emerald-50 ${taxClientId === c.id ? 'bg-emerald-50 border-r-2 border-emerald-500' : ''}`}>
                    <span className={`text-xs font-black ${taxClientId === c.id ? 'text-emerald-700' : 'text-slate-700'}`}>{c.name}</span>
                  </button>
                ))}
              </div>
            </div>

          </div>

          {/* 우측: 전표 목록 + 미리보기 */}
          <div className="flex-1 flex flex-col gap-3 min-w-0">
            {!taxClientId ? (
              <div className="flex flex-col items-center justify-center h-full bg-white rounded-2xl border border-dashed border-slate-200 py-20">
                <FileText size={36} className="text-slate-200 mb-3"/>
                <p className="text-slate-400 text-sm font-bold">거래처를 선택하세요</p>
              </div>
            ) : clientStmts.length === 0 ? (
              <div className="bg-white rounded-2xl border border-dashed border-slate-200 py-12 text-center text-slate-400 text-sm font-bold">발행된 전표가 없습니다</div>
            ) : (<>
              {/* 공급받는자 정보 */}
              <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">공급받는자 정보 (선택)</p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { key: 'bizNo', label: '사업자번호', placeholder: '000-00-00000' },
                    { key: 'ceoName', label: '대표자명', placeholder: '홍길동' },
                    { key: 'bizType', label: '업태', placeholder: '제조업' },
                    { key: 'bizItem', label: '종목', placeholder: '식품' },
                    { key: 'address', label: '주소', placeholder: '사업장 주소' },
                  ].map(f => (
                    <div key={f.key}>
                      <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">{f.label}</label>
                      <input type="text" placeholder={f.placeholder}
                        value={(taxBuyerInfo as any)[f.key]}
                        onChange={e => setTaxBuyerInfo(prev => ({ ...prev, [f.key]: e.target.value }))}
                        className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-emerald-300"/>
                    </div>
                  ))}
                </div>
              </div>

              {/* 월별 전표 선택 */}
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                {months.map(ym => {
                  const stmts = byMonth.get(ym)!;
                  const allSel = stmts.every(s => taxStmtIds.includes(s.id));
                  const someSel = stmts.some(s => taxStmtIds.includes(s.id));
                  return (
                    <div key={ym}>
                      <div className="flex items-center gap-3 px-4 py-2 bg-slate-50 border-b border-slate-100 sticky top-0">
                        <button onClick={() => toggleMonth(ym)}
                          className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${allSel ? 'bg-emerald-600 border-emerald-600' : someSel ? 'bg-emerald-200 border-emerald-400' : 'border-slate-300'}`}>
                          {(allSel || someSel) && <CheckSquare size={10} className="text-white"/>}
                        </button>
                        <span className="text-[11px] font-black text-slate-700">{ym.replace('-', '년 ')}월</span>
                        <span className="text-[10px] text-slate-400">{stmts.length}건</span>
                        <span className="ml-auto text-[11px] font-black text-slate-600">{fmt(stmts.reduce((s, r) => s + r.totalAmount, 0))}원</span>
                      </div>
                      {stmts.map(s => {
                        const isSel = taxStmtIds.includes(s.id);
                        const isIssued = !!s.taxIssuedAt;
                        return (
                          <button key={s.id} onClick={() => toggleStmt(s.id)}
                            className={`w-full flex items-center gap-3 px-4 py-2.5 border-b border-slate-50 text-left transition-all ${isSel ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}>
                            <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all ${isSel ? 'bg-emerald-600 border-emerald-600' : 'border-slate-300'}`}>
                              {isSel && <CheckSquare size={10} className="text-white"/>}
                            </div>
                            <span className="text-xs font-black text-slate-700">{s.tradeDate}</span>
                            <span className="text-[10px] text-slate-400 font-mono">{s.docNo}</span>
                            <span className="text-[10px] text-slate-400 flex-1 truncate">
                              {s.items.slice(0,2).map(i=>i.name).join(', ')}{s.items.length>2?` 외 ${s.items.length-2}건`:''}
                            </span>
                            {isIssued && <span className="text-[9px] font-black bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full shrink-0">발행</span>}
                            <span className={`text-xs font-black shrink-0 ${isSel ? 'text-emerald-700' : 'text-slate-700'}`}>{fmt(s.totalAmount)}원</span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>

              {/* 미리보기 */}
              {taxStmtIds.length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">세금계산서 미리보기</span>
                      <span className="text-[11px] font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">{taxStmtIds.length}건</span>
                    </div>
                    <div className="flex gap-1.5">
                      <button onClick={handleTaxIssue}
                        className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[11px] font-black hover:bg-emerald-700">
                        <Check size={11}/>발행
                      </button>
                      <button onClick={handleTaxPdf}
                        className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-[11px] font-black hover:bg-blue-700">
                        <Download size={11}/>PDF
                      </button>
                      <button onClick={handleTaxPrint}
                        className="flex items-center gap-1 px-3 py-1.5 bg-slate-600 text-white rounded-lg text-[11px] font-black hover:bg-slate-700">
                        <Printer size={11}/>인쇄
                      </button>
                    </div>
                  </div>
                  <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap gap-4">
                    {mergedItems.taxable.length > 0 && (
                      <div className="flex items-center gap-3 bg-blue-50 border border-blue-100 rounded-xl px-4 py-2.5">
                        <span className="text-[11px] font-black text-blue-600">과세</span>
                        <span className="text-xs text-slate-600">공급가 <b className="text-slate-900">{fmt(taxSupply)}</b></span>
                        <span className="text-xs text-slate-600">세액 <b className="text-slate-900">{fmt(taxAmt)}</b></span>
                        <span className="text-sm font-black text-blue-700">{fmt(taxSupply+taxAmt)}원</span>
                      </div>
                    )}
                    {mergedItems.exempt.length > 0 && (
                      <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-2.5">
                        <span className="text-[11px] font-black text-indigo-600">면세</span>
                        <span className="text-xs text-slate-600">공급가 <b className="text-slate-900">{fmt(exemptSup)}</b></span>
                        <span className="text-sm font-black text-indigo-700">{fmt(exemptSup)}원</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-2.5 ml-auto">
                      <span className="text-[11px] font-black text-emerald-600">합계</span>
                      <span className="text-lg font-black text-emerald-700">{fmt(grandTotal)}원</span>
                    </div>
                  </div>
                  <div className="p-4 overflow-x-auto">
                    <div ref={taxPrintRef}>
                      <div className="wrap border-2 border-black" style={{fontFamily:"'Malgun Gothic','맑은 고딕',sans-serif",minWidth:640,fontSize:'11px'}}>
                        <div className="flex items-center justify-between border-b-2 border-black px-4 py-3">
                          <h1 style={{fontSize:'22px',fontWeight:900,letterSpacing:'6px'}}>세 금 계 산 서</h1>
                          <div className="text-right" style={{fontSize:'10px',color:'#666'}}>
                            <div>거래처: {selectedClient?.name}</div>
                            <div>발행기간: {tradeMonth}</div>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 border-b border-black">
                          <div className="p-3 border-r border-black">
                            <h3 style={{fontSize:'10px',fontWeight:900,marginBottom:'6px',paddingBottom:'4px',borderBottom:'1px solid #eee',color:'#444'}}>공 급 자</h3>
                            {[['등록번호', sup?.bizNo||''], ['상    호', sup?.name||''], ['대 표 자', sup?.ceoName||''], ['사업장주소', sup?.address||''], ['업    태', sup?.bizType||''], ['종    목', sup?.bizItem||'']].map(([label, value]) => (
                              <div key={label} style={{display:'flex',gap:'8px',marginBottom:'3px',fontSize:'10px'}}>
                                <span style={{color:'#666',width:'60px',flexShrink:0}}>{label}</span>
                                <span style={{fontWeight:700}}>{value}</span>
                              </div>
                            ))}
                          </div>
                          <div className="p-3">
                            <h3 style={{fontSize:'10px',fontWeight:900,marginBottom:'6px',paddingBottom:'4px',borderBottom:'1px solid #eee',color:'#444'}}>공급받는자</h3>
                            {[['등록번호', taxBuyerInfo.bizNo||''], ['상    호', selectedClient?.name||''], ['대 표 자', taxBuyerInfo.ceoName||''], ['사업장주소', taxBuyerInfo.address||''], ['업    태', taxBuyerInfo.bizType||''], ['종    목', taxBuyerInfo.bizItem||'']].map(([label, value]) => (
                              <div key={label} style={{display:'flex',gap:'8px',marginBottom:'3px',fontSize:'10px'}}>
                                <span style={{color:'#666',width:'60px',flexShrink:0}}>{label}</span>
                                <span style={{fontWeight:700}}>{value}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <table style={{width:'100%',borderCollapse:'collapse',fontSize:'11px'}}>
                          <thead>
                            <tr>{['품목','규격','수량','공급가액','세액','합계'].map(h => (
                              <th key={h} style={{border:'1px solid #ccc',background:'#f5f5f5',padding:'6px 8px',fontWeight:900,textAlign:'center'}}>{h}</th>
                            ))}</tr>
                          </thead>
                          <tbody>
                            {mergedItems.taxable.length > 0 && (<>
                              <tr><td colSpan={6} style={{padding:'4px 8px',background:'#dbeafe',fontWeight:900,color:'#1d4ed8',border:'1px solid #ccc',fontSize:'10px'}}>▶ 과세 품목</td></tr>
                              {mergedItems.taxable.map((item, i) => (
                                <tr key={i}>
                                  <td style={{border:'1px solid #ccc',padding:'5px 8px',fontWeight:700}}>{item.name}</td>
                                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'center'}}>{item.spec}</td>
                                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right'}}>{fmt(item.qty)}</td>
                                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right'}}>{fmt(item.supply)}</td>
                                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right'}}>{fmt(item.tax)}</td>
                                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900}}>{fmt(item.total)}</td>
                                </tr>
                              ))}
                              <tr style={{background:'#eff6ff'}}>
                                <td colSpan={3} style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900,color:'#1d4ed8'}}>과세 소계</td>
                                <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900,color:'#1d4ed8'}}>{fmt(taxSupply)}</td>
                                <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900,color:'#1d4ed8'}}>{fmt(taxAmt)}</td>
                                <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900,color:'#1d4ed8'}}>{fmt(taxSupply+taxAmt)}</td>
                              </tr>
                            </>)}
                            {mergedItems.exempt.length > 0 && (<>
                              <tr><td colSpan={6} style={{padding:'4px 8px',background:'#e0e7ff',fontWeight:900,color:'#4338ca',border:'1px solid #ccc',fontSize:'10px'}}>▶ 면세 품목</td></tr>
                              {mergedItems.exempt.map((item, i) => (
                                <tr key={i}>
                                  <td style={{border:'1px solid #ccc',padding:'5px 8px',fontWeight:700}}>{item.name}</td>
                                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'center'}}>{item.spec}</td>
                                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right'}}>{fmt(item.qty)}</td>
                                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right'}}>{fmt(item.supply)}</td>
                                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'center',color:'#666'}}>면세</td>
                                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900}}>{fmt(item.supply)}</td>
                                </tr>
                              ))}
                              <tr style={{background:'#eef2ff'}}>
                                <td colSpan={3} style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900,color:'#4338ca'}}>면세 소계</td>
                                <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900,color:'#4338ca'}}>{fmt(exemptSup)}</td>
                                <td style={{border:'1px solid #ccc',padding:'5px 8px'}}/>
                                <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900,color:'#4338ca'}}>{fmt(exemptSup)}</td>
                              </tr>
                            </>)}
                            <tr style={{background:'#f1f5f9'}}>
                              <td colSpan={3} style={{border:'1px solid #ccc',padding:'7px 8px',textAlign:'right',fontWeight:900,fontSize:'12px'}}>합 계</td>
                              <td style={{border:'1px solid #ccc',padding:'7px 8px',textAlign:'right',fontWeight:900}}>{fmt(taxSupply+exemptSup)}</td>
                              <td style={{border:'1px solid #ccc',padding:'7px 8px',textAlign:'right',fontWeight:900}}>{fmt(taxAmt)}</td>
                              <td style={{border:'1px solid #ccc',padding:'7px 8px',textAlign:'right',fontWeight:900,color:'#059669',fontSize:'13px'}}>{fmt(grandTotal)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>)}
          </div>
        </div>
      )}

      {/* ── 조회 탭 ── */}
      {activeTab === 'history' && (
        <div className="flex gap-4 items-start">
          {/* 좌측: 거래처 필터 */}
          <div className="w-56 shrink-0 flex flex-col gap-3 sticky top-0">
            <div className="bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden" style={{maxHeight:400}}>
              <div className="px-3 pt-3 pb-2 border-b border-slate-100">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">발행 거래처</p>
                <div className="relative">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none"/>
                  <input type="text" placeholder="거래처 검색..." value={histClientSearch}
                    onChange={e => setHistClientSearch(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-7 pr-2 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-emerald-300"/>
                </div>
              </div>
              <div className="overflow-y-auto divide-y divide-slate-50">
                <button onClick={() => { setHistClientId(''); setHistPreviewId(null); }}
                  className={`w-full text-left px-3 py-2.5 transition-all hover:bg-emerald-50 ${!histClientId ? 'bg-emerald-50 border-r-2 border-emerald-500' : ''}`}>
                  <span className={`text-xs font-black ${!histClientId ? 'text-emerald-700' : 'text-slate-500'}`}>전체 거래처</span>
                </button>
                {issuedClients.map(c => (
                  <button key={c.id} onClick={() => { setHistClientId(c.id); setHistPreviewId(null); }}
                    className={`w-full text-left px-3 py-2.5 transition-all hover:bg-emerald-50 ${histClientId === c.id ? 'bg-emerald-50 border-r-2 border-emerald-500' : ''}`}>
                    <span className={`text-xs font-black ${histClientId === c.id ? 'text-emerald-700' : 'text-slate-700'}`}>{c.name}</span>
                  </button>
                ))}
                {issuedClients.length === 0 && (
                  <p className="px-3 py-4 text-[11px] text-slate-400 text-center">발행된 세금계산서 없음</p>
                )}
              </div>
            </div>
            {/* 요약 */}
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 space-y-1">
              <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest">발행 현황</p>
              <p className="text-xs text-slate-600">총 <b>{histStmts.length}</b>건</p>
              <p className="text-sm font-black text-amber-700">{fmt(histStmts.reduce((s, r) => s + r.totalAmount, 0))}원</p>
            </div>
          </div>

          {/* 우측: 발행 목록 + 상세 */}
          <div className="flex-1 flex gap-4 min-w-0">
            {/* 목록 */}
            <div className="flex-1 flex flex-col gap-2">
              {histStmts.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full bg-white rounded-2xl border border-dashed border-slate-200 py-20">
                  <Receipt size={36} className="text-slate-200 mb-3"/>
                  <p className="text-slate-400 text-sm font-bold">발행된 세금계산서가 없습니다</p>
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 grid grid-cols-[1fr_80px_80px_100px_80px] gap-3">
                    <span className="text-[10px] font-black text-slate-400 uppercase">거래처 / 전표</span>
                    <span className="text-[10px] font-black text-slate-400 uppercase text-center">거래일</span>
                    <span className="text-[10px] font-black text-slate-400 uppercase text-center">발행일</span>
                    <span className="text-[10px] font-black text-slate-400 uppercase text-right">금액</span>
                    <span className="text-[10px] font-black text-slate-400 uppercase text-center">보기</span>
                  </div>
                  {histStmts.map(s => {
                    const c = clients.find(cl => cl.id === s.clientId);
                    const isSelected = histPreviewId === s.id;
                    return (
                      <div key={s.id}
                        className={`grid grid-cols-[1fr_80px_80px_100px_80px] gap-3 items-center px-4 py-3 border-b border-slate-50 transition-all ${isSelected ? 'bg-amber-50' : 'hover:bg-slate-50'}`}>
                        <div>
                          <div className="flex items-center gap-2">
                            <Building2 size={11} className="text-slate-400 shrink-0"/>
                            <span className="text-xs font-black text-slate-800">{c?.name ?? '-'}</span>
                            <span className="text-[9px] font-black bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full">발행완료</span>
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5 ml-4">{s.docNo} · {s.items.slice(0,2).map(i=>i.name).join(', ')}{s.items.length>2?` 외 ${s.items.length-2}건`:''}</div>
                        </div>
                        <span className="text-[11px] text-slate-600 text-center">{s.tradeDate.slice(5)}</span>
                        <span className="text-[11px] text-slate-600 text-center">{s.taxIssuedAt ? s.taxIssuedAt.slice(0, 10) : '-'}</span>
                        <span className="text-xs font-black text-slate-800 text-right">{fmt(s.totalAmount)}</span>
                        <div className="flex justify-center">
                          <button onClick={() => setHistPreviewId(isSelected ? null : s.id)}
                            className={`p-1.5 rounded-lg transition-all ${isSelected ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                            <Eye size={13}/>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 상세 미리보기 */}
            {previewStmt && (
              <div className="w-[480px] shrink-0 flex flex-col gap-3">
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">세금계산서 미리보기</span>
                    <div className="flex gap-1.5">
                      <button onClick={handleHistPdf}
                        className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-600 text-white rounded-lg text-[11px] font-black hover:bg-blue-700">
                        <Download size={10}/>PDF
                      </button>
                      <button onClick={handleHistPrint}
                        className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-600 text-white rounded-lg text-[11px] font-black hover:bg-slate-700">
                        <Printer size={10}/>인쇄
                      </button>
                      <button onClick={() => setHistPreviewId(null)}
                        className="p-1.5 bg-slate-100 text-slate-500 rounded-lg hover:bg-slate-200">
                        <X size={13}/>
                      </button>
                    </div>
                  </div>
                  <div className="p-4 overflow-x-auto">
                    <div ref={previewPrintRef}>
                      <TaxInvoicePreview stmt={previewStmt} clientName={previewClient?.name} />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default TaxStatement;
