
import React, { useState } from 'react';
import { 
  RefreshCw, 
  Link as LinkIcon,
  CheckCircle2,
  Save,
  UploadCloud,
  Copy,
  Terminal,
  ShieldAlert,
  Settings
} from 'lucide-react';
import { Client, Product } from '../types';

interface DatabaseViewProps {
  onSync: (data: { clients: Client[], products: Product[] }) => void;
}

const DatabaseView: React.FC<DatabaseViewProps> = ({ onSync: _onSync }) => {
  return (
    <div className="flex items-center justify-center h-64 text-slate-300 font-bold text-lg">
      준비 중
    </div>
  );
  const [activeTab, setActiveTab] = useState<'sync' | 'script'>('sync');
  const [sheetId, setSheetId] = useState(localStorage.getItem('gsheet_id') || '');
  const [appsScriptUrl, setAppsScriptUrl] = useState(localStorage.getItem('apps_script_url') || '');
  const [syncStatus, setSyncStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  const appsScriptCode = `
function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  if (data.action === 'update_all') {
    var clientSheet = ss.getSheetByName('Clients') || ss.insertSheet('Clients');
    clientSheet.clearContents();
    clientSheet.appendRow(['ID', 'Name', 'Email', 'Phone', 'Type', 'AssociatedProductIDs']);
    data.clients.forEach(function(c) {
      clientSheet.appendRow([c.id, c.name, c.email, c.phone, c.type, (c.associatedProductIds || []).join(',')]);
    });
    
    var productSheet = ss.getSheetByName('Products') || ss.insertSheet('Products');
    productSheet.clearContents();
    productSheet.appendRow(['ID', 'Name', 'OIL', 'Category', 'Stock', 'MinStock', 'Price', 'ClientID']);
    data.products.filter(function(p) { return p.category === '완제품'; }).forEach(function(p) {
      productSheet.appendRow([p.id, p.name, p.oil || '', p.category, p.stock, p.minStock, p.price, p.clientIds?.join(',') || '']);
    });

    var subSheet = ss.getSheetByName('Submaterials') || ss.insertSheet('Submaterials');
    subSheet.clearContents();
    subSheet.appendRow(['ID', 'Name', 'Category', 'Stock', 'MinStock', 'Price']);
    data.products.filter(function(p) { return p.category !== '완제품'; }).forEach(function(p) {
      subSheet.appendRow([p.id, p.name, p.category, p.stock, p.minStock, p.price]);
    });
    return ContentService.createTextOutput("Success");
  }
}
  `.trim();

  const handleSync = async () => {
    if (!sheetId) {
      setErrorDetail('구글 시트 ID를 입력해주세요.');
      setSyncStatus('error');
      return;
    }
    
    setSyncStatus('loading');
    setErrorDetail(null);

    const getVal = (obj: any, keys: string[]) => {
      for (const k of keys) {
        const found = Object.keys(obj).find(ok => ok.toLowerCase().replace(/\s/g, '') === k.toLowerCase().replace(/\s/g, ''));
        if (found) return obj[found];
      }
      return undefined;
    };

    try {
      // 1. Submaterials 탭 먼저 로드 (BOM 구성을 위해)
      let mappedSubs: Product[] = [];
      try {
        const subUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=Submaterials&headers=1`;
        const sRes = await fetch(subUrl);
        const sText = await sRes.text();
        const sJson = JSON.parse(sText.substring(47, sText.length - 2));
        
        const subCols = sJson.table.cols.map((col: any) => (col.label || '').trim());
        const subRows = sJson.table.rows.map((row: any) => {
          const obj: any = {};
          row.c.forEach((cell: any, idx: number) => {
            if (subCols[idx]) obj[subCols[idx]] = cell ? (cell.v ?? '') : '';
          });
          return obj;
        });

        mappedSubs = subRows.map((s: any, index: number) => ({
          id: String(getVal(s, ['ID', '아이디', '코드']) || `s-${index}`),
          name: String(getVal(s, ['Name', '품목명', '이름', '부자재명']) || '부자재 없음'),
          category: String(getVal(s, ['Category', '카테고리', '분류']) || '부자재'),
          stock: Number(getVal(s, ['Stock', '재고', '수량']) || 0),
          minStock: Number(getVal(s, ['MinStock', '최소재고', '안전재고']) || 10),
          price: Number(getVal(s, ['Price', '가격', '단가']) || 0),
          unit: String(getVal(s, ['Unit', '단위']) || '개'),
          image: '',
          submaterials: []
        }));
      } catch {
        console.warn('Submaterials 탭 로드 실패');
      }

      // 부자재 조회를 위한 맵 생성 (ID 및 이름 기준)
      const subLookup = new Map<string, Product>();
      mappedSubs.forEach(s => {
        subLookup.set(s.id, s);
        subLookup.set(s.name, s);
      });

      // 2. Products 탭 로드
      const testUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=Products&headers=1`;
      const response = await fetch(testUrl);
      
      if (response.status === 404) {
        throw new Error('시트를 찾을 수 없습니다. ID가 정확한지 확인하세요.');
      }
      if (response.status === 403) {
        throw new Error('접근 권한이 없습니다. 시트 [공유] 설정에서 [링크가 있는 모든 사용자]로 변경하세요.');
      }

      const text = await response.text();
      
      // 데이터 파싱
      if (!text.includes('google.visualization.Query.setResponse')) {
        throw new Error('데이터 형식이 올바르지 않습니다. 탭 이름이 [Products]인지 확인하세요.');
      }

      const jsonData = JSON.parse(text.substring(47, text.length - 2));
      
      if (jsonData.status === 'error') {
        throw new Error(`구글 시트 에러: ${jsonData.errors[0].message}. 탭 이름 [Products]가 있는지 확인하세요.`);
      }

      const productCols = jsonData.table.cols.map((col: any) => (col.label || '').trim());
      const productRows = jsonData.table.rows.map((row: any) => {
        const obj: any = {};
        row.c.forEach((cell: any, idx: number) => {
          if (productCols[idx]) obj[productCols[idx]] = cell ? (cell.v ?? '') : '';
        });
        return obj;
      });

      const bomKeys = {
        label: ['Label', '라벨'],
        tape: ['Tape', '테이프'],
        cap: ['Cap', '마개', '뚜껑'],
        box: ['Box', '박스', 'BOX'],
        container: ['Container', '용기', '병']
      };

      const mappedProducts: Product[] = productRows.map((p: any, index: number) => {
        const productId = String(getVal(p, ['ID', '아이디', '코드']) || `p-${index}`);
        const productName = String(getVal(p, ['Name', '품목명', '이름', '상품명', '제품명']) || '이름 없음');
        
        // BOM (부자재) 구성 추출
        const submaterials: any[] = [];
        Object.values(bomKeys).forEach(keys => {
          const val = getVal(p, keys);
          if (val && String(val).trim() !== '') {
            const subNameOrId = String(val).trim();
            let foundSub = subLookup.get(subNameOrId);
            
            // 만약 Submaterials 탭에 없으면 임시 부자재 객체 생성
            if (!foundSub) {
              const newSubId = `s-auto-${subNameOrId.replace(/\s/g, '-')}`;
              foundSub = {
                id: newSubId,
                name: subNameOrId,
                category: '부자재',
                stock: 0,
                minStock: 10,
                price: 0,
                unit: '개',
                image: '',
                submaterials: []
              };
              subLookup.set(subNameOrId, foundSub);
              mappedSubs.push(foundSub); // 전체 목록에도 추가하여 나중에 저장되게 함
            }

            const categoryMap: Record<string, string> = {
              label: '라벨',
              tape: '테이프',
              cap: '마개',
              box: '박스',
              container: '용기'
            };
            const internalKey = Object.keys(bomKeys).find(k => (bomKeys as any)[k] === keys) || '';
            
            submaterials.push({
              id: foundSub.id,
              name: foundSub.name,
              category: categoryMap[internalKey] || '부자재',
              stock: 1, // 기본 소요량 1
              unit: foundSub.unit || '개'
            });
          }
        });

        return {
          id: productId,
          name: productName,
          oil: String(getVal(p, ['OIL', '원유', '기름']) || ''),
          category: '완제품',
          stock: Number(getVal(p, ['Stock', '재고', '수량']) || 0),
          minStock: Number(getVal(p, ['MinStock', '최소재고', '안전재고']) || 10),
          price: Number(getVal(p, ['Price', '가격', '단가']) || 0),
          clientId: String(getVal(p, ['ClientID', '거래처ID', '거래처코드', 'Client']) || ''),
          unit: '개',
          image: '',
          submaterials: submaterials
        };
      });

      // 부자재 목록도 전체 제품 목록에 추가
      mappedProducts.push(...mappedSubs);

      // Clients 탭도 시도
      let mappedClients: Client[] = [];
      try {
        const clientUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=Clients&headers=1`;
        const cRes = await fetch(clientUrl);
        const cText = await cRes.text();
        const cJson = JSON.parse(cText.substring(47, cText.length - 2));
        
        const clientCols = cJson.table.cols.map((col: any) => (col.label || '').trim());
        const clientRows = cJson.table.rows.map((row: any) => {
          const obj: any = {};
          row.c.forEach((cell: any, idx: number) => {
            if (clientCols[idx]) obj[clientCols[idx]] = cell ? (cell.v ?? '') : '';
          });
          return obj;
        });

        mappedClients = clientRows.map((c: any) => {
          const id = String(getVal(c, ['ID', '아이디', '코드']) || '');
          const rawAssociated = String(getVal(c, ['AssociatedProductIDs', '주문상품', '상품ID', '관련상품', '취급품목', '주문가능품목']) || '');
          const associatedProductIds = rawAssociated ? rawAssociated.split(',').map((s: any) => s.trim()).filter(Boolean) : [];

          // PRODUCTS 탭에서 이 거래처 ID를 가진 품목들 추가
          const productsForThisClient = mappedProducts
            .filter(p => p.clientIds?.includes(id))
            .map(p => p.id);
          
          // 중복 제거 합치기
          const combinedIds = Array.from(new Set([...associatedProductIds, ...productsForThisClient]));

          return {
            id,
            name: String(getVal(c, ['Name', '이름', '거래처', '상호', '업체명']) || '이름 없음'),
            email: String(getVal(c, ['Email', '이메일', '메일']) || ''),
            phone: String(getVal(c, ['Phone', '전화번호', '연락처']) || ''),
            type: (getVal(c, ['Type', '유형', '구분']) || '일반') as any,
            associatedProductIds: combinedIds,
            productSettings: []
          };
        }).filter((c: any) => c.id !== '');
      } catch {
        console.warn('Clients 탭 로드 실패, 무시하고 진행합니다.');
      }

      onSync({ clients: mappedClients, products: mappedProducts });
      
      localStorage.setItem('gsheet_id', sheetId);
      setSyncStatus('success');
      setTimeout(() => setSyncStatus('idle'), 2000);
    } catch (e: any) {
      setSyncStatus('error');
      setErrorDetail(e.message || '데이터를 가져오는 중 알 수 없는 오류가 발생했습니다.');
    }
  };

  const pushToGoogleSheet = async () => {
    if (!appsScriptUrl) {
      alert('스크립트 URL이 필요합니다.');
      return;
    }
    setSyncStatus('loading');
    try {
      const clients = JSON.parse(localStorage.getItem('tb_clients') || '[]');
      const products = JSON.parse(localStorage.getItem('tb_products') || '[]');

      await fetch(appsScriptUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_all',
          clients: clients,
          products: products
        })
      });
      setSyncStatus('success');
      alert('성공적으로 전송했습니다. 시트를 확인하세요!');
      setTimeout(() => setSyncStatus('idle'), 3000);
    } catch {
      setSyncStatus('error');
      setErrorDetail('저장 실패: 네트워크 연결이나 스크립트 설정을 확인하세요.');
    }
  };

  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-500 h-full flex flex-col">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-3xl font-black text-slate-900">데이터 동기화 센터</h2>
          <p className="text-slate-500 mt-1 font-medium">시트와 앱의 연결 상태를 진단하고 복구하세요.</p>
        </div>
        <div className="flex bg-slate-200/50 p-1.5 rounded-2xl border border-slate-200">
           <button onClick={() => setActiveTab('sync')} className={`px-5 py-2.5 rounded-xl text-xs font-black transition-all flex items-center space-x-2 ${activeTab === 'sync' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}><RefreshCw size={14} /><span>동기화 제어</span></button>
           <button onClick={() => setActiveTab('script')} className={`px-5 py-2.5 rounded-xl text-xs font-black transition-all flex items-center space-x-2 ${activeTab === 'script' ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-500'}`}><Terminal size={14} /><span>스크립트 설정</span></button>
        </div>
      </div>

      <div className="flex-1 bg-white rounded-[40px] border border-slate-100 shadow-sm overflow-hidden flex flex-col min-h-0">
        {activeTab === 'sync' ? (
          <div className="flex-1 overflow-y-auto custom-scrollbar p-8 space-y-10">
            {/* 연결 진단 영역 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-4">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center"><LinkIcon size={14} className="mr-2" /> 1. 구글 시트 ID (읽기 경로)</label>
                <div className="flex space-x-2">
                  <input type="text" value={sheetId} onChange={(e) => setSheetId(e.target.value)} placeholder="Sheet ID..." className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 text-sm font-bold outline-none focus:ring-4 focus:ring-indigo-500/10" />
                  <button onClick={handleSync} className="bg-indigo-600 text-white px-6 py-4 rounded-2xl font-black hover:bg-indigo-700 active:scale-95">불러오기</button>
                </div>
              </div>
              <div className="space-y-4">
                <label className="text-[10px] font-black text-rose-400 uppercase tracking-widest flex items-center"><UploadCloud size={14} className="mr-2" /> 2. Apps Script URL (쓰기 경로)</label>
                <input type="text" value={appsScriptUrl} onChange={(e) => setAppsScriptUrl(e.target.value)} placeholder="Web App URL..." className="w-full bg-rose-50/30 border border-rose-100 rounded-2xl px-6 py-4 text-sm font-bold outline-none" />
              </div>
            </div>

            {/* 에러 피드백 */}
            {syncStatus === 'error' && (
              <div className="bg-rose-50 border border-rose-100 p-6 rounded-3xl flex items-start space-x-4 animate-in slide-in-from-top-2">
                <ShieldAlert size={24} className="text-rose-500 shrink-0 mt-1" />
                <div className="space-y-2">
                  <p className="text-sm font-black text-rose-900">데이터를 가져올 수 없습니다!</p>
                  <p className="text-xs text-rose-700 font-bold leading-relaxed">{errorDetail}</p>
                  <div className="pt-2 flex flex-wrap gap-2">
                    <div className="bg-white border border-rose-100 px-3 py-1.5 rounded-xl text-[10px] font-black text-rose-500 uppercase">공유 설정 확인 요망</div>
                    <div className="bg-white border border-rose-100 px-3 py-1.5 rounded-xl text-[10px] font-black text-rose-500 uppercase">탭 이름 (Products) 확인</div>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-indigo-900 text-white p-10 rounded-[40px] relative overflow-hidden shadow-2xl">
               <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full translate-x-32 -translate-y-32 blur-3xl" />
               <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-8">
                  <div className="space-y-4 text-center md:text-left">
                     <div className="flex items-center justify-center md:justify-start space-x-3">
                        <CheckCircle2 size={32} className="text-emerald-400" />
                        <h4 className="text-2xl font-black text-white">시트로 변경사항 내보내기</h4>
                     </div>
                     <p className="text-indigo-200 font-medium max-w-md">앱에서 수정한 정보(택배 여부 등)를 구글 시트 원본에 즉시 저장합니다.</p>
                  </div>
                  <button 
                    onClick={pushToGoogleSheet}
                    disabled={syncStatus === 'loading'}
                    className="bg-white text-indigo-900 px-10 py-5 rounded-[24px] font-black text-lg shadow-xl hover:bg-indigo-50 active:scale-95 transition-all flex items-center justify-center space-x-3 min-w-[240px]"
                  >
                    {syncStatus === 'loading' ? <RefreshCw size={24} className="animate-spin" /> : <Save size={24} />}
                    <span>지금 시트에 저장</span>
                  </button>
               </div>
            </div>

            {/* 체크리스트 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
               <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100">
                  <Settings size={20} className="text-slate-400 mb-3" />
                  <p className="text-xs font-black text-slate-800 mb-1">탭 이름 확인</p>
                  <p className="text-[10px] text-slate-400 font-bold">시트 하단 이름이 &apos;Products&apos;, &apos;Clients&apos;, &apos;Submaterials&apos;여야 합니다.</p>
               </div>
               <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100">
                  <ShieldAlert size={20} className="text-slate-400 mb-3" />
                  <p className="text-xs font-black text-slate-800 mb-1">공유 권한 확인</p>
                  <p className="text-[10px] text-slate-400 font-bold">공유 버튼 클릭 후 &apos;링크가 있는 모든 사용자&apos;가 &apos;뷰어&apos; 이상이어야 합니다.</p>
               </div>
               <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100">
                  <Terminal size={20} className="text-slate-400 mb-3" />
                  <p className="text-xs font-black text-slate-800 mb-1">스크립트 배포</p>
                  <p className="text-[10px] text-slate-400 font-bold">쓰기 기능을 위해선 Apps Script를 &apos;웹 앱&apos;으로 새 배포해야 합니다.</p>
               </div>
            </div>
          </div>
        ) : (
          <div className="p-10 space-y-8 overflow-y-auto custom-scrollbar">
            <div className="bg-rose-50 border border-rose-100 p-8 rounded-[32px] space-y-6">
               <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 bg-rose-600 text-white rounded-2xl flex items-center justify-center"><Terminal size={24} /></div>
                  <h4 className="text-xl font-black text-rose-900">구글 시트 쓰기 권한 설정</h4>
               </div>
               <div className="space-y-4 text-sm font-bold text-rose-800 leading-relaxed">
                  <p>1. 구글 시트 상단 메뉴 <b>[확장 프로그램 {'>'} Apps Script]</b> 클릭</p>
                  <p>2. 아래 코드 복사 후 기존 내용 지우고 붙여넣기</p>
                  <div className="relative group">
                    <pre className="bg-slate-900 text-slate-100 p-6 rounded-2xl overflow-x-auto text-xs font-mono shadow-inner border border-slate-800">
                      {appsScriptCode}
                    </pre>
                    <button onClick={() => { navigator.clipboard.writeText(appsScriptCode); alert('복사되었습니다!'); }} className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-all flex items-center space-x-1"><Copy size={16} /><span>복사</span></button>
                  </div>
                  <p>3. <b>[배포 {'>'} 새 배포]</b> -{'>'} 유형: <b>웹 앱</b> -{'>'} 액세스 권한: <b>모든 사용자</b> 설정 후 배포</p>
               </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DatabaseView;
