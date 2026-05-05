import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  X, Check, Camera, QrCode, RefreshCw, Loader2,
  AlertCircle, ChevronDown, PackageCheck, Zap,
} from 'lucide-react';
import jsQR from 'jsqr';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../src/shared/firebase';
import { addItem, updateItem } from '../src/shared/services/firebaseService';
import { Product, PendingReceipt, QrMapping } from '../src/shared/types';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY ?? '';

interface InboundScanProps {
  submaterials: Product[];
  confirmedOrders: { id: string; quantity: number }[];
  qrMappings: QrMapping[];
  currentUser: { id: string; name: string };
  onUpdateSubmaterial: (id: string, data: Partial<Product>) => void;
  onFinishConfirmedOrder: (id: string) => void;
}

type ScanState = 'scanning' | 'captured' | 'gemini_loading' | 'confirming' | 'done';

interface ConfirmItem {
  submaterialId: string;
  name: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  supplierName: string;
  route: 'order_match' | 'pre_inbound'; // 발주매칭 or 선입고
  confirmedOrderId?: string;
  confirmedQty?: number;
}

const qrCache = new Map<string, QrMapping>();

const InboundScan: React.FC<InboundScanProps> = ({
  submaterials,
  confirmedOrders,
  qrMappings,
  currentUser,
  onUpdateSubmaterial,
  onFinishConfirmedOrder,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [scanState, setScanState] = useState<ScanState>('scanning');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [confirmItems, setConfirmItems] = useState<ConfirmItem[]>([]);
  const [mappingModal, setMappingModal] = useState<{ qrValue: string } | null>(null);
  const [mappingSearch, setMappingSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [geminiError, setGeminiError] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState('');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');

  // QR 캐시 동기화
  useEffect(() => {
    qrMappings.forEach(m => qrCache.set(m.qrValue, m));
  }, [qrMappings]);

  // 카메라 시작
  const startCamera = useCallback(async (facing: 'environment' | 'user' = 'environment') => {
    try {
      stream?.getTracks().forEach(t => t.stop());
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      setStream(s);
      setScanState('scanning');
      setCapturedImage(null);
      setCapturedFile(null);
      setGeminiError(null);
    } catch {
      alert('카메라 접근 권한이 필요합니다.');
    }
  }, [stream]);

  useEffect(() => {
    startCamera();
    return () => { stream?.getTracks().forEach(t => t.stop()); };
  }, []);

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream]);

  // QR 스캔 루프
  useEffect(() => {
    if (scanState !== 'scanning') {
      if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);
      return;
    }
    scanIntervalRef.current = setInterval(() => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code?.data) {
        clearInterval(scanIntervalRef.current!);
        handleQrValue(code.data);
      }
    }, 300);
    return () => { if (scanIntervalRef.current) clearInterval(scanIntervalRef.current); };
  }, [scanState, qrMappings, submaterials, confirmedOrders]);

  // 품목 → 발주 매칭 라우팅
  const routeItem = useCallback((sub: Product): ConfirmItem => {
    const match = confirmedOrders.find(c => c.id === sub.id);
    return {
      submaterialId: sub.id,
      name: sub.name,
      unit: sub.unit,
      quantity: match ? String(match.quantity) : '',
      unitPrice: sub.cost ? String(sub.cost) : '',
      supplierName: '',
      route: match ? 'order_match' : 'pre_inbound',
      confirmedOrderId: match?.id,
      confirmedQty: match?.quantity,
    };
  }, [confirmedOrders]);

  const handleQrValue = useCallback((qrValue: string) => {
    const mapping = qrCache.get(qrValue) ?? qrMappings.find(m => m.qrValue === qrValue);
    if (mapping) {
      const sub = submaterials.find(s => s.id === mapping.submaterialId);
      if (sub) {
        setScanState('confirming');
        setConfirmItems([routeItem(sub)]);
        return;
      }
    }
    setMappingModal({ qrValue });
  }, [qrMappings, submaterials, routeItem]);

  // 사진 촬영
  const capturePhoto = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(blob => {
      if (!blob) return;
      const file = new File([blob], `scan_${Date.now()}.jpg`, { type: 'image/jpeg' });
      setCapturedFile(file);
      setCapturedImage(canvas.toDataURL('image/jpeg'));
      setScanState('captured');
    }, 'image/jpeg', 0.85);
  }, []);

  // Gemini OCR
  const parseWithGemini = useCallback(async () => {
    if (!capturedImage || !GEMINI_API_KEY) {
      setGeminiError('Gemini API 키가 없습니다.');
      return;
    }
    setScanState('gemini_loading');
    setGeminiError(null);
    try {
      const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const subList = submaterials.map(s => s.name).join(', ');
      const base64 = capturedImage.split(',')[1];
      const prompt = `이 사진은 식품 회사의 납품서 또는 포장 박스입니다.
다음 품목 목록 중 사진에 보이는 품목을 찾아 JSON으로만 응답해주세요.
품목 목록: ${subList}

응답 형식 (JSON 배열만):
[{"name":"품목명","quantity":수량,"unit":"단위","unitPrice":단가,"supplier":"거래처명"}]

품목명은 반드시 위 목록의 이름과 정확히 일치해야 합니다. 거래처명이 안 보이면 supplier는 빈 문자열.`;

      const result = await model.generateContent([
        prompt,
        { inlineData: { mimeType: 'image/jpeg', data: base64 } },
      ]);
      const text = result.response.text().trim();
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('파싱 실패');
      const parsed = JSON.parse(jsonMatch[0]) as { name: string; quantity: number; unit: string; unitPrice?: number; supplier?: string }[];

      const items: ConfirmItem[] = parsed.map(p => {
        const sub = submaterials.find(s => s.name === p.name);
        if (!sub) return null;
        const base = routeItem(sub);
        return {
          ...base,
          quantity: p.quantity ? String(p.quantity) : base.quantity,
          unitPrice: p.unitPrice ? String(p.unitPrice) : base.unitPrice,
          supplierName: p.supplier || '',
        };
      }).filter(Boolean) as ConfirmItem[];

      if (items.length === 0) throw new Error('품목을 인식하지 못했습니다. 직접 선택해주세요.');
      setConfirmItems(items);
      setScanState('confirming');
    } catch (e: any) {
      setGeminiError(e.message ?? 'AI 인식 실패');
      setScanState('captured');
    }
  }, [capturedImage, submaterials, routeItem]);

  // 입고 확정 저장
  const confirmSave = async () => {
    const invalid = confirmItems.find(i => !i.quantity || isNaN(Number(i.quantity)));
    if (invalid) { alert(`"${invalid.name}" 수량을 입력해주세요.`); return; }
    setSaving(true);
    try {
      let photoUrl: string | undefined;
      if (capturedFile) {
        const storageRef = ref(storage, `inbound/${Date.now()}_${capturedFile.name}`);
        await uploadBytes(storageRef, capturedFile);
        photoUrl = await getDownloadURL(storageRef);
      }

      for (const item of confirmItems) {
        const sub = submaterials.find(s => s.id === item.submaterialId);
        if (!sub) continue;
        const qty = Number(item.quantity);

        // 재고 반영 (공통)
        onUpdateSubmaterial(sub.id, { stock: (sub.stock ?? 0) + qty });

        if (item.route === 'order_match' && item.confirmedOrderId) {
          // 발주 매칭 → 입고 완료 처리
          onFinishConfirmedOrder(item.confirmedOrderId);
        } else {
          // 선입고 → pendingReceipts 저장
          const receipt: Omit<PendingReceipt, 'id'> = {
            supplierName: item.supplierName,
            items: [{ submaterialId: sub.id, name: sub.name, quantity: qty, unit: sub.unit, unitPrice: item.unitPrice ? Number(item.unitPrice) : undefined }],
            totalAmount: qty * (item.unitPrice ? Number(item.unitPrice) : 0),
            photoUrl,
            registeredBy: currentUser.name,
            registeredAt: new Date().toISOString(),
            status: 'pending_voucher',
          };
          await addItem('pendingReceipts', receipt);
        }
      }

      const orderCount = confirmItems.filter(i => i.route === 'order_match').length;
      const preCount = confirmItems.filter(i => i.route === 'pre_inbound').length;
      let msg = '입고 처리 완료 ✓';
      if (orderCount > 0) msg += `\n발주 매칭 ${orderCount}건 입고완료`;
      if (preCount > 0) msg += `\n선입고 ${preCount}건 등록 (전표 대기)`;
      setDoneMessage(msg);
      setScanState('done');
    } catch {
      alert('저장 중 오류가 발생했습니다.');
      setSaving(false);
    } finally {
      setSaving(false);
    }
  };

  // QR 매핑 저장 후 확인 단계로
  const saveMappingAndRoute = async (sub: Product) => {
    if (!mappingModal) return;
    const mapping: Omit<QrMapping, 'id'> = {
      qrValue: mappingModal.qrValue,
      submaterialId: sub.id,
      submaterialName: sub.name,
      createdAt: new Date().toISOString(),
    };
    await addItem('qrMappings', mapping);
    qrCache.set(mappingModal.qrValue, { ...mapping, id: '' });
    setMappingModal(null);
    setScanState('confirming');
    setConfirmItems([routeItem(sub)]);
  };

  const resetScan = () => {
    setScanState('scanning');
    setCapturedImage(null);
    setCapturedFile(null);
    setConfirmItems([]);
    setGeminiError(null);
    setDoneMessage('');
  };

  const updateItem_ = (idx: number, field: keyof ConfirmItem, value: string) => {
    setConfirmItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it));
  };

  const filteredSubs = submaterials.filter(s =>
    !mappingSearch || s.name.toLowerCase().includes(mappingSearch.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-40 bg-black flex flex-col">
      {/* 상단 바 */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <div className="flex items-center gap-2">
          <Zap size={18} className="text-teal-400" />
          <span className="text-white font-black text-sm">입고 스캔</span>
        </div>
        <div className="flex items-center gap-2">
          {scanState === 'scanning' && (
            <button
              onClick={() => { const next = facingMode === 'environment' ? 'user' : 'environment'; setFacingMode(next); startCamera(next); }}
              className="p-2 text-white/60 hover:text-white"
            >
              <RefreshCw size={18} />
            </button>
          )}
        </div>
      </div>

      {/* 카메라 / 내용 영역 */}
      <div className="flex-1 relative overflow-hidden">
        {/* 카메라 비디오 */}
        {(scanState === 'scanning' || scanState === 'captured' || scanState === 'gemini_loading') && (
          <>
            <video ref={videoRef} autoPlay playsInline muted className={`w-full h-full object-cover ${scanState !== 'scanning' ? 'opacity-30' : ''}`} />
            <canvas ref={canvasRef} className="hidden" />
          </>
        )}

        {/* 스캔 가이드 */}
        {scanState === 'scanning' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none gap-6">
            <div className="w-60 h-60 border-2 border-teal-400 rounded-2xl relative">
              <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-teal-400 rounded-tl-lg" />
              <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-teal-400 rounded-tr-lg" />
              <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-teal-400 rounded-bl-lg" />
              <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-teal-400 rounded-br-lg" />
              <div className="absolute inset-0 flex items-center justify-center">
                <QrCode size={36} className="text-teal-400/50" />
              </div>
            </div>
            <div className="bg-black/50 rounded-full px-4 py-1.5 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
              <span className="text-white text-xs font-bold">QR 자동 감지 중</span>
            </div>
          </div>
        )}

        {/* 촬영된 이미지 오버레이 */}
        {(scanState === 'captured' || scanState === 'gemini_loading') && capturedImage && (
          <div className="absolute inset-0">
            <img src={capturedImage} alt="captured" className="w-full h-full object-cover opacity-40" />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6">
              {scanState === 'gemini_loading' ? (
                <div className="bg-black/70 rounded-2xl p-6 text-center space-y-3">
                  <Loader2 size={32} className="text-teal-400 animate-spin mx-auto" />
                  <p className="text-white font-black">AI 분석 중...</p>
                  <p className="text-white/60 text-xs">품목과 수량을 인식하고 있습니다</p>
                </div>
              ) : (
                <div className="w-full space-y-3">
                  {geminiError && (
                    <div className="bg-rose-900/70 rounded-xl px-4 py-3 flex items-center gap-2">
                      <AlertCircle size={16} className="text-rose-300 shrink-0" />
                      <p className="text-rose-200 text-xs">{geminiError}</p>
                    </div>
                  )}
                  <button onClick={parseWithGemini} className="w-full py-4 bg-teal-500 hover:bg-teal-600 rounded-2xl font-black text-white text-sm flex items-center justify-center gap-2 shadow-lg">
                    <RefreshCw size={16} /> AI로 품목 인식
                  </button>
                  <button onClick={resetScan} className="w-full py-3 border border-white/30 rounded-2xl text-white text-sm font-bold">
                    다시 촬영
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 확인 화면 */}
        {scanState === 'confirming' && (
          <div className="absolute inset-0 bg-slate-900 overflow-y-auto">
            <div className="p-4 space-y-4 pb-8">
              <p className="text-white/60 text-xs font-bold uppercase tracking-widest">입고 확인</p>

              {confirmItems.map((item, idx) => (
                <div key={idx} className={`rounded-2xl p-4 space-y-3 border ${item.route === 'order_match' ? 'bg-emerald-900/30 border-emerald-500/30' : 'bg-amber-900/30 border-amber-500/30'}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-white font-black text-base">{item.name}</p>
                    <span className={`text-[10px] font-black px-2 py-1 rounded-full ${item.route === 'order_match' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
                      {item.route === 'order_match' ? `발주 매칭 (${item.confirmedQty?.toLocaleString()} ${item.unit})` : '선입고'}
                    </span>
                  </div>

                  {item.route === 'pre_inbound' && (
                    <div>
                      <p className="text-white/50 text-[10px] mb-1">거래처</p>
                      <input
                        value={item.supplierName}
                        onChange={e => updateItem_(idx, 'supplierName', e.target.value)}
                        placeholder="거래처명 (선택)"
                        className="w-full bg-white/10 border border-white/20 rounded-xl px-3 py-2 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-teal-400"
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-white/50 text-[10px] mb-1">입고 수량</p>
                      <div className="flex items-center bg-white/10 border border-white/20 rounded-xl overflow-hidden">
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={e => updateItem_(idx, 'quantity', e.target.value)}
                          className="flex-1 bg-transparent px-3 py-2 text-white text-sm text-right focus:outline-none"
                          placeholder="0"
                        />
                        <span className="px-3 text-white/50 text-xs">{item.unit}</span>
                      </div>
                    </div>
                    <div>
                      <p className="text-white/50 text-[10px] mb-1">단가 (원)</p>
                      <input
                        type="number"
                        value={item.unitPrice}
                        onChange={e => updateItem_(idx, 'unitPrice', e.target.value)}
                        className="w-full bg-white/10 border border-white/20 rounded-xl px-3 py-2 text-white text-sm text-right focus:outline-none"
                        placeholder="0"
                      />
                    </div>
                  </div>
                </div>
              ))}

              <button
                onClick={confirmSave}
                disabled={saving}
                className="w-full flex items-center justify-center gap-2 py-4 bg-teal-500 hover:bg-teal-600 disabled:opacity-60 rounded-2xl font-black text-white text-sm shadow-lg"
              >
                {saving ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
                입고 완료
              </button>
              <button onClick={resetScan} className="w-full py-3 text-white/50 text-sm">취소하고 다시 스캔</button>
            </div>
          </div>
        )}

        {/* 완료 화면 */}
        {scanState === 'done' && (
          <div className="absolute inset-0 bg-slate-900 flex flex-col items-center justify-center p-6 gap-6">
            <div className="w-20 h-20 rounded-full bg-teal-500/20 flex items-center justify-center">
              <PackageCheck size={40} className="text-teal-400" />
            </div>
            <div className="text-center space-y-2">
              {doneMessage.split('\n').map((line, i) => (
                <p key={i} className={i === 0 ? 'text-white font-black text-xl' : 'text-white/60 text-sm'}>{line}</p>
              ))}
            </div>
            <button
              onClick={resetScan}
              className="w-full max-w-xs py-4 bg-teal-500 hover:bg-teal-600 rounded-2xl font-black text-white text-sm flex items-center justify-center gap-2"
            >
              <QrCode size={18} /> 다음 품목 스캔
            </button>
          </div>
        )}
      </div>

      {/* 하단: 촬영 버튼 */}
      {scanState === 'scanning' && (
        <div className="shrink-0 pb-8 pt-4 px-6 flex items-center justify-center gap-6" style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}>
          <button
            onClick={capturePhoto}
            className="w-16 h-16 rounded-full bg-white flex items-center justify-center shadow-2xl active:scale-95 transition-transform"
          >
            <Camera size={24} className="text-slate-800" />
          </button>
        </div>
      )}

      {/* QR 매핑 모달 */}
      {mappingModal && (
        <div className="absolute inset-0 z-50 bg-black/80 flex items-end">
          <div className="bg-white rounded-t-3xl w-full max-h-[75vh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-100">
              <div className="flex items-center justify-between mb-1">
                <p className="font-black text-slate-800">처음 보는 QR</p>
                <button onClick={() => { setMappingModal(null); resetScan(); }} className="p-1.5 text-slate-400">
                  <X size={18} />
                </button>
              </div>
              <p className="text-xs text-slate-400 break-all">{mappingModal.qrValue}</p>
              <p className="text-xs text-slate-500 mt-2">어떤 품목인가요? 한 번 선택하면 다음부터 자동 인식됩니다.</p>
            </div>
            <div className="px-4 py-2 border-b border-slate-100">
              <input
                value={mappingSearch}
                onChange={e => setMappingSearch(e.target.value)}
                placeholder="품목 검색..."
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                autoFocus
              />
            </div>
            <div className="overflow-y-auto flex-1 divide-y divide-slate-50">
              {filteredSubs.map(sub => (
                <button
                  key={sub.id}
                  onClick={() => saveMappingAndRoute(sub)}
                  className="w-full flex items-center justify-between px-5 py-3 hover:bg-teal-50 text-left transition-all"
                >
                  <span className="text-sm font-bold text-slate-700">{sub.name}</span>
                  <span className="text-xs text-slate-400">{sub.unit}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InboundScan;
