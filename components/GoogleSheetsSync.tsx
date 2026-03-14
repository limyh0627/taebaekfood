
import React, { useState } from 'react';
import { X, Link, RefreshCw, AlertCircle, FileSpreadsheet } from 'lucide-react';

interface GoogleSheetsSyncProps {
  onSync: (_data: { clients: any[], products: any[] }) => void;
  onClose: () => void;
}

const GoogleSheetsSync: React.FC<GoogleSheetsSyncProps> = ({ onSync, onClose }) => {
  const [sheetId, setSheetId] = useState(localStorage.getItem('gsheet_id') || '');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const fetchSheetData = async (tabName: string) => {
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=${tabName}&headers=1`;
    const response = await fetch(url);
    const text = await response.text();
    const jsonData = JSON.parse(text.substring(47, text.length - 2));
    
    const columns = jsonData.table.cols.map((col: any) => (col.label || '').trim());
    const rows = jsonData.table.rows.map((row: any) => {
      const obj: any = {};
      row.c.forEach((cell: any, idx: number) => {
        if (columns[idx]) {
          obj[columns[idx]] = cell ? (cell.v ?? '') : '';
        }
      });
      return obj;
    });
    return rows;
  };

  const safeString = (val: any, fallback: string = '') => {
    if (val === undefined || val === null) return fallback;
    return String(val).trim();
  };

  const getFuzzyValue = (obj: any, possibleKeys: string[]) => {
    const objKeys = Object.keys(obj);
    for (const pKey of possibleKeys) {
      const normalizedPKey = pKey.toLowerCase().replace(/\s/g, '');
      const foundKey = objKeys.find(k => 
        k.toLowerCase().replace(/\s/g, '') === normalizedPKey
      );
      if (foundKey && obj[foundKey] !== undefined && obj[foundKey] !== null) {
        return obj[foundKey];
      }
    }
    return undefined;
  };

  const handleSync = async () => {
    if (!sheetId) {
      setErrorMessage('시트 ID를 입력해주세요.');
      setStatus('error');
      return;
    }

    setStatus('loading');
    setErrorMessage('');

    try {
      const clientsData = await fetchSheetData('Clients');
      const productsData = await fetchSheetData('Products');
      const submaterialData = await fetchSheetData('Submaterials').catch(() => []);

      // 부자재 조회를 위한 맵 생성
      const subLookup = new Map<string, any>();
      const mappedSubs = submaterialData
        .map((s: any) => {
          const sub = {
            id: safeString(getFuzzyValue(s, ['ID', '아이디', 'id', '코드'])),
            name: safeString(getFuzzyValue(s, ['Name', '품목명', '이름', '부자재명']), '부자재 없음'),
            category: safeString(getFuzzyValue(s, ['Category', '카테고리', '분류']), '부자재'),
            price: Number(getFuzzyValue(s, ['Price', '가격', '단가', '금액']) || 0),
            stock: Number(getFuzzyValue(s, ['Stock', '재고', '현재고', '수량']) || 0),
            minStock: Number(getFuzzyValue(s, ['MinStock', '최소재고', '안전재고', '알림수량']) || 10),
            unit: safeString(getFuzzyValue(s, ['Unit', '단위']), '개'),
            submaterials: []
          };
          if (sub.id) {
            subLookup.set(sub.id, sub);
            subLookup.set(sub.name, sub);
          }
          return sub;
        })
        .filter((s: any) => s.id !== '');

      const bomKeys = {
        label: ['Label', '라벨'],
        tape: ['Tape', '테이프'],
        cap: ['Cap', '마개', '뚜껑'],
        box: ['Box', '박스', 'BOX'],
        container: ['Container', '용기', '병']
      };

      const mappedProducts = productsData
        .map((p: any) => {
          const id = safeString(getFuzzyValue(p, ['ID', '아이디', 'id', '코드']));
          const name = safeString(getFuzzyValue(p, ['Name', '품목명', '이름', '상품명', '제품명']), '상품명 없음');
          
          // BOM 구성 추출
          const submaterials: any[] = [];
          Object.values(bomKeys).forEach(keys => {
            const val = getFuzzyValue(p, keys);
            if (val) {
              const subNameOrId = String(val).trim();
              const foundSub = subLookup.get(subNameOrId);
              if (foundSub) {
                submaterials.push({
                  id: foundSub.id,
                  name: foundSub.name,
                  stock: 1,
                  unit: foundSub.unit || '개'
                });
              }
            }
          });

          return {
            id,
            name,
            category: '완제품',
            price: Number(getFuzzyValue(p, ['Price', '가격', '단가', '금액']) || 0),
            stock: Number(getFuzzyValue(p, ['Stock', '재고', '현재고', '수량']) || 0),
            minStock: Number(getFuzzyValue(p, ['MinStock', '최소재고', '안전재고', '알림수량']) || 10),
            unit: safeString(getFuzzyValue(p, ['Unit', '단위']), '개'),
            clientId: safeString(getFuzzyValue(p, ['ClientID', '거래처ID', '거래처코드', 'Client'])),
            submaterials: submaterials
          };
        })
        .filter((p: any) => p.id !== '');

      const allProducts = [...mappedProducts, ...mappedSubs];

      const mappedClients = clientsData
        .map((c: any) => {
          const id = safeString(getFuzzyValue(c, ['ID', '아이디', 'id', '코드']));
          const name = safeString(getFuzzyValue(c, ['Name', '이름', '거래처', '상호', '고객명', '업체명', '거래처명']), '이름 없음');
          const productIdsRaw = safeString(getFuzzyValue(c, [
            'AssociatedProductIDs', 
            '주문상품', 
            '상품ID', 
            '관련상품', 
            '취급품목',
            '주문가능품목'
          ]));
          
          const associatedProductIds = productIdsRaw 
            ? productIdsRaw.split(/[,,;]/).map(s => s.trim()).filter(s => s !== '')
            : [];

          // PRODUCTS 탭에서 이 거래처 ID를 가진 품목들 추가
          const productsForThisClient = allProducts
            .filter((p: any) => p.clientId === id)
            .map((p: any) => p.id);
          
          // 중복 제거 합치기
          const combinedIds = Array.from(new Set([...associatedProductIds, ...productsForThisClient]));

          return {
            id,
            name,
            email: safeString(getFuzzyValue(c, ['Email', '이메일', 'mail', '메일'])),
            phone: safeString(getFuzzyValue(c, ['Phone', '전화번호', '연락처', 'tel', '전화'])),
            type: safeString(getFuzzyValue(c, ['Type', '유형', '구분', '채널']), '일반'),
            associatedProductIds: combinedIds,
            productSettings: []
          };
        })
        .filter((c: any) => c.id !== '');

      localStorage.setItem('gsheet_id', sheetId);
      onSync({ clients: mappedClients, products: allProducts });
      setStatus('success');
      setTimeout(onClose, 1500);
    } catch (err) {
      console.error(err);
      setStatus('error');
      setErrorMessage('데이터를 불러오지 못했습니다. 헤더명과 탭 이름을 확인하세요.');
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={onClose} />
      <div className="relative bg-white w-full max-w-lg rounded-3xl shadow-2xl p-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
             <div className="p-2 bg-emerald-100 text-emerald-600 rounded-xl">
                <FileSpreadsheet size={24} />
             </div>
             <h3 className="text-xl font-bold">구글 시트 동기화</h3>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:bg-slate-50 rounded-full">
            <X size={20} />
          </button>
        </div>
        
        <p className="text-sm text-slate-500 mb-6">
          시트의 탭 이름은 <b>Clients</b>, <b>Products</b>, <b>Submaterials</b>로 설정해주세요.<br/>
          한글 헤더(이름, 가격 등)도 자동으로 매핑됩니다.
        </p>

        <div className="space-y-4">
          <div className="relative">
            <Link className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input 
              type="text" 
              value={sheetId}
              onChange={(e) => setSheetId(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-12 pr-4 py-4 text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
              placeholder="Google Spreadsheet ID 입력"
            />
          </div>
          <button 
            onClick={handleSync}
            disabled={status === 'loading'}
            className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold shadow-xl flex items-center justify-center space-x-2 hover:bg-emerald-700 transition-all active:scale-95"
          >
            {status === 'loading' ? <RefreshCw size={20} className="animate-spin" /> : <RefreshCw size={20} />}
            <span>데이터 동기화 시작</span>
          </button>
        </div>

        {status === 'error' && (
          <div className="mt-4 p-4 bg-rose-50 border border-rose-100 text-rose-600 rounded-xl text-xs font-medium flex items-center">
            <AlertCircle size={16} className="mr-2 shrink-0" />
            {errorMessage}
          </div>
        )}
      </div>
    </div>
  );
};

export default GoogleSheetsSync;
