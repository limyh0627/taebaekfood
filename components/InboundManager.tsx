import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  PackageCheck,
  Camera,
  QrCode,
  History,
  X,
  Check,
  Plus,
  Trash2,
  RefreshCw,
  ChevronDown,
  Loader2,
  AlertCircle,
  Link2,
  Image as ImageIcon,
} from 'lucide-react';
import jsQR from 'jsqr';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../src/shared/firebase';
import { addItem, updateItem, subscribeToCollection } from '../src/shared/services/firebaseService';
import { SubmaterialComponent, PendingReceipt, PendingReceiptItem, QrMapping, IssuedStatement } from '../src/shared/types';
import PageHeader from './PageHeader';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY ?? '';

interface InboundManagerProps {
  submaterials: SubmaterialComponent[];
  issuedStatements: IssuedStatement[];
  currentUser: { id: string; name: string };
  isAdmin: boolean;
  onUpdateSubmaterial: (id: string, data: Partial<SubmaterialComponent>) => void;
  embedded?: boolean; // 재고관리 내 탭으로 삽입될 때 true
}

type Tab = 'waiting' | 'temporary' | 'history';

// ── QR 매핑 캐시 (컴포넌트 생명주기 동안 유지) ──
const qrMappingCache = new Map<string, QrMapping>();

const InboundManager: React.FC<InboundManagerProps> = ({
  submaterials,
  issuedStatements,
  currentUser,
  isAdmin,
  onUpdateSubmaterial,
  embedded = false,
}) => {
  const [tab, setTab] = useState<Tab>(embedded ? 'temporary' : 'waiting');
  const [pendingReceipts, setPendingReceipts] = useState<PendingReceipt[]>([]);
  const [qrMappings, setQrMappings] = useState<QrMapping[]>([]);

  // 카메라 / QR 상태
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [scanMode, setScanMode] = useState<'scanning' | 'captured'>('scanning');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [qrDetected, setQrDetected] = useState<string | null>(null);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 임시 입고 폼
  const [tempForm, setTempForm] = useState<{
    partnerName: string;
    items: { submaterialId: string; name: string; quantity: string; unit: string; unitPrice: string }[];
    note: string;
  }>({ partnerName: '', items: [], note: '' });

  // QR 매핑 모달
  const [mappingModal, setMappingModal] = useState<{ qrValue: string } | null>(null);
  const [mappingSearch, setMappingSearch] = useState('');

  // Gemini 파싱
  const [geminiLoading, setGeminiLoading] = useState(false);
  const [geminiError, setGeminiError] = useState<string | null>(null);

  // 입고 확인 모달 (입고대기 탭)
  const [confirmingStatement, setConfirmingStatement] = useState<IssuedStatement | null>(null);
  const [confirmPhoto, setConfirmPhoto] = useState<File | null>(null);
  const [confirmPhotoPreview, setConfirmPhotoPreview] = useState<string | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  // 저장 로딩
  const [saveLoading, setSaveLoading] = useState(false);

  // ── Firestore 구독 ──
  useEffect(() => {
    const unsub1 = subscribeToCollection<PendingReceipt>('pendingReceipts', setPendingReceipts);
    const unsub2 = subscribeToCollection<QrMapping>('qrMappings', (items) => {
      setQrMappings(items);
      items.forEach(m => qrMappingCache.set(m.qrValue, m));
    });
    return () => { unsub1(); unsub2(); };
  }, []);

  // ── 입고대기 목록: 매입 전표 중 receivedAt 없는 것 ──
  const waitingStatements = issuedStatements.filter(
    s => s.type === '매입' && !s.receivedAt
  );

  // ── 카메라 열기 ──
  const openCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      setCameraStream(stream);
      setCameraOpen(true);
      setScanMode('scanning');
      setQrDetected(null);
      setCapturedImage(null);
      setCapturedFile(null);
      setGeminiError(null);
    } catch {
      alert('카메라 접근 권한이 필요합니다.');
    }
  }, []);

  useEffect(() => {
    if (cameraOpen && videoRef.current && cameraStream) {
      videoRef.current.srcObject = cameraStream;
    }
  }, [cameraOpen, cameraStream]);

  // ── QR 스캔 루프 ──
  useEffect(() => {
    if (!cameraOpen || scanMode !== 'scanning') {
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
        setQrDetected(code.data);
        setScanMode('captured');
        handleQrDetected(code.data);
      }
    }, 400);
    return () => { if (scanIntervalRef.current) clearInterval(scanIntervalRef.current); };
  }, [cameraOpen, scanMode]);

  // ── QR 감지 처리 ──
  const handleQrDetected = useCallback((qrValue: string) => {
    const mapping = qrMappingCache.get(qrValue) ?? qrMappings.find(m => m.qrValue === qrValue);
    if (mapping) {
      const sub = submaterials.find(s => s.id === mapping.submaterialId);
      if (sub) {
        setTempForm(prev => ({
          ...prev,
          items: [...prev.items, { submaterialId: sub.id, name: sub.name, quantity: '', unit: sub.unit, unitPrice: sub.cost?.toString() ?? '' }],
        }));
        closeCamera();
      }
    } else {
      setMappingModal({ qrValue });
    }
  }, [qrMappings, submaterials]);

  // ── QR 매핑 저장 ──
  const saveMappingAndAdd = async (sub: SubmaterialComponent) => {
    if (!mappingModal) return;
    const mapping: Omit<QrMapping, 'id'> = {
      qrValue: mappingModal.qrValue,
      submaterialId: sub.id,
      submaterialName: sub.name,
      createdAt: new Date().toISOString(),
    };
    await addItem('qrMappings', mapping);
    onUpdateSubmaterial(sub.id, { qrCode: mappingModal.qrValue });
    setTempForm(prev => ({
      ...prev,
      items: [...prev.items, { submaterialId: sub.id, name: sub.name, quantity: '', unit: sub.unit, unitPrice: sub.cost?.toString() ?? '' }],
    }));
    setMappingModal(null);
    closeCamera();
  };

  // ── 사진 촬영 ──
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
      const file = new File([blob], `inbound_${Date.now()}.jpg`, { type: 'image/jpeg' });
      setCapturedFile(file);
      setCapturedImage(canvas.toDataURL('image/jpeg'));
      setScanMode('captured');
    }, 'image/jpeg', 0.85);
  }, []);

  // ── Gemini OCR ──
  const parseWithGemini = useCallback(async () => {
    if (!capturedImage) return;
    if (!GEMINI_API_KEY) { setGeminiError('VITE_GEMINI_API_KEY가 설정되지 않았습니다.'); return; }
    setGeminiLoading(true);
    setGeminiError(null);
    try {
      const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const subList = submaterials.map(s => s.name).join(', ');
      const base64 = capturedImage.split(',')[1];
      const prompt = `이 사진은 식품 회사의 매입 전표 또는 납품서입니다.
다음 품목 목록 중 사진에 보이는 품목을 찾아 JSON으로 응답해주세요.
품목 목록: ${subList}

응답 형식 (JSON 배열만, 설명 없이):
[{"name":"품목명","quantity":수량,"unit":"단위","unitPrice":단가}]

품목명은 반드시 위 품목 목록에 있는 이름과 정확히 일치해야 합니다.
거래처명이 보이면 "supplier" 필드도 추가해주세요.`;

      const result = await model.generateContent([
        prompt,
        { inlineData: { mimeType: 'image/jpeg', data: base64 } },
      ]);
      const text = result.response.text().trim();
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('파싱 실패');
      const parsed = JSON.parse(jsonMatch[0]) as { name: string; quantity: number; unit: string; unitPrice?: number; supplier?: string }[];

      const newItems = parsed.map(p => {
        const sub = submaterials.find(s => s.name === p.name);
        return {
          submaterialId: sub?.id ?? '',
          name: p.name,
          quantity: p.quantity?.toString() ?? '',
          unit: p.unit || sub?.unit || '',
          unitPrice: p.unitPrice?.toString() ?? sub?.cost?.toString() ?? '',
        };
      });
      if (parsed[0]?.supplier) setTempForm(prev => ({ ...prev, partnerName: parsed[0].supplier!, items: [...prev.items, ...newItems] }));
      else setTempForm(prev => ({ ...prev, items: [...prev.items, ...newItems] }));
      closeCamera();
    } catch (e) {
      setGeminiError('AI 인식에 실패했습니다. 직접 입력해주세요.');
    } finally {
      setGeminiLoading(false);
    }
  }, [capturedImage, submaterials]);

  // ── 카메라 닫기 ──
  const closeCamera = useCallback(() => {
    cameraStream?.getTracks().forEach(t => t.stop());
    setCameraStream(null);
    setCameraOpen(false);
    setScanMode('scanning');
    setQrDetected(null);
  }, [cameraStream]);

  // ── 임시 입고 저장 ──
  const saveTempReceipt = async () => {
    if (!tempForm.partnerName.trim()) { alert('거래처명을 입력해주세요.'); return; }
    if (tempForm.items.length === 0) { alert('품목을 추가해주세요.'); return; }
    const invalidItem = tempForm.items.find(i => !i.quantity || isNaN(Number(i.quantity)));
    if (invalidItem) { alert(`"${invalidItem.name}" 수량을 입력해주세요.`); return; }
    setSaveLoading(true);
    try {
      let photoUrl: string | undefined;
      if (capturedFile) {
        const storageRef = ref(storage, `inbound/${Date.now()}_${capturedFile.name}`);
        await uploadBytes(storageRef, capturedFile);
        photoUrl = await getDownloadURL(storageRef);
      }
      const items: PendingReceiptItem[] = tempForm.items.map(i => ({
        submaterialId: i.submaterialId,
        name: i.name,
        quantity: Number(i.quantity),
        unit: i.unit,
        unitPrice: i.unitPrice ? Number(i.unitPrice) : undefined,
      }));
      const totalAmount = items.reduce((sum, i) => sum + (i.quantity * (i.unitPrice ?? 0)), 0);
      const receipt: Omit<PendingReceipt, 'id'> = {
        partnerName: tempForm.partnerName,
        items,
        totalAmount,
        photoUrl,
        registeredBy: currentUser.name,
        registeredAt: new Date().toISOString(),
        status: 'pending_voucher',
        note: tempForm.note || undefined,
      };
      await addItem('pendingReceipts', receipt);
      // 재고 즉시 반영
      for (const item of items) {
        if (!item.submaterialId) continue;
        const sub = submaterials.find(s => s.id === item.submaterialId);
        if (sub) onUpdateSubmaterial(sub.id, { stock: (sub.stock ?? 0) + item.quantity });
      }
      setTempForm({ partnerName: '', items: [], note: '' });
      setCapturedImage(null);
      setCapturedFile(null);
      setTab('history');
      alert('임시 입고가 등록되었습니다. 재고가 즉시 반영되었습니다.');
    } catch {
      alert('저장 중 오류가 발생했습니다.');
    } finally {
      setSaveLoading(false);
    }
  };

  // ── 입고대기 확인 처리 ──
  const confirmReceipt = async () => {
    if (!confirmingStatement) return;
    setConfirmLoading(true);
    try {
      let photoUrl: string | undefined;
      if (confirmPhoto) {
        const storageRef = ref(storage, `inbound/confirm_${Date.now()}_${confirmPhoto.name}`);
        await uploadBytes(storageRef, confirmPhoto);
        photoUrl = await getDownloadURL(storageRef);
      }
      const updateData: Record<string, unknown> = { receivedAt: new Date().toISOString() };
      if (photoUrl) updateData.receiptPhotoUrl = photoUrl;
      await updateItem('issuedStatements', confirmingStatement.id, updateData);
      setConfirmingStatement(null);
      setConfirmPhoto(null);
      setConfirmPhotoPreview(null);
      alert('입고 확인이 완료되었습니다.');
    } catch {
      alert('처리 중 오류가 발생했습니다.');
    } finally {
      setConfirmLoading(false);
    }
  };

  const filteredMappingResults = submaterials.filter(s =>
    !mappingSearch || s.name.toLowerCase().includes(mappingSearch.toLowerCase())
  );

  // ── 렌더 ──
  const visibleTabs = embedded
    ? ([{ key: 'temporary', label: '임시입고', count: undefined }, { key: 'history', label: '입고이력', count: pendingReceipts.length }] as { key: Tab; label: string; count?: number }[])
    : ([{ key: 'waiting', label: '입고대기', count: waitingStatements.length }, { key: 'temporary', label: '임시입고', count: undefined }, { key: 'history', label: '이력', count: pendingReceipts.length }] as { key: Tab; label: string; count?: number }[]);

  return (
    <div className={`flex flex-col space-y-4 ${embedded ? '' : 'h-full animate-in slide-in-from-right-4 duration-500'}`}>
      {!embedded && <PageHeader title="입고 관리" subtitle="입고대기 확인 · 임시입고 등록 · 이력 조회" />}

      {/* 탭 */}
      <div className={`flex bg-slate-100 rounded-xl p-1 gap-1 ${embedded ? '' : 'mx-1'}`}>
        {visibleTabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-black transition-all ${tab === t.key ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-black ${tab === t.key ? 'bg-teal-100 text-teal-700' : 'bg-slate-200 text-slate-500'}`}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── 탭 1: 입고대기 ── */}
      {tab === 'waiting' && (
        <div className="flex-1 overflow-auto space-y-3 px-1">
          {waitingStatements.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-300">
              <PackageCheck size={40} strokeWidth={1.5} className="mb-2" />
              <p className="text-sm font-bold text-slate-400">입고 대기 중인 전표가 없습니다</p>
            </div>
          ) : waitingStatements.map(stmt => (
            <div key={stmt.id} className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-black text-slate-800 text-sm">{stmt.clientName}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{stmt.tradeDate} · 전표 {stmt.docNo}</p>
                </div>
                <span className="px-2 py-1 bg-amber-50 text-amber-700 rounded-lg text-[10px] font-black">입고대기</span>
              </div>
              <div className="space-y-1">
                {stmt.items.map((item, i) => (
                  <div key={i} className="flex justify-between text-xs text-slate-600">
                    <span>{item.name}</span>
                    <span className="font-bold">{item.qty?.toLocaleString()}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-slate-50">
                <p className="text-xs text-slate-400">합계 <span className="font-black text-slate-700">{stmt.totalAmount.toLocaleString()}원</span></p>
                <button
                  onClick={() => setConfirmingStatement(stmt)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-black transition-all shadow-sm"
                >
                  <Check size={13} /> 입고 확인
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── 탭 2: 임시입고 ── */}
      {tab === 'temporary' && (
        <div className="flex-1 overflow-auto space-y-4 px-1 pb-4">
          {/* 거래처 */}
          <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm space-y-3">
            <p className="text-xs font-black text-slate-500 uppercase tracking-widest">거래처 정보</p>
            <input
              value={tempForm.partnerName}
              onChange={e => setTempForm(p => ({ ...p, partnerName: e.target.value }))}
              placeholder="거래처명 입력"
              className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
            />
          </div>

          {/* 카메라 버튼 */}
          <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm space-y-3">
            <p className="text-xs font-black text-slate-500 uppercase tracking-widest">품목 추가</p>
            <button
              onClick={openCamera}
              className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-teal-300 rounded-xl text-teal-600 hover:bg-teal-50 transition-all text-sm font-black"
            >
              <Camera size={16} /> QR 스캔 또는 사진으로 추가
            </button>
            {/* 품목 직접 추가 */}
            <button
              onClick={() => {
                const first = submaterials[0];
                if (!first) return;
                setTempForm(p => ({ ...p, items: [...p.items, { submaterialId: first.id, name: first.name, quantity: '', unit: first.unit, unitPrice: first.cost?.toString() ?? '' }] }));
              }}
              className="w-full flex items-center justify-center gap-2 py-2.5 border border-slate-200 rounded-xl text-slate-500 hover:bg-slate-50 transition-all text-xs font-black"
            >
              <Plus size={14} /> 직접 입력으로 추가
            </button>
          </div>

          {/* 품목 리스트 */}
          {tempForm.items.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm space-y-3">
              <p className="text-xs font-black text-slate-500 uppercase tracking-widest">입고 품목 ({tempForm.items.length})</p>
              {tempForm.items.map((item, idx) => (
                <div key={idx} className="p-3 bg-slate-50 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="relative flex-1 mr-2">
                      <select
                        value={item.submaterialId}
                        onChange={e => {
                          const sub = submaterials.find(s => s.id === e.target.value);
                          if (!sub) return;
                          setTempForm(p => ({ ...p, items: p.items.map((it, i) => i === idx ? { ...it, submaterialId: sub.id, name: sub.name, unit: sub.unit, unitPrice: sub.cost?.toString() ?? '' } : it) }));
                        }}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-400 appearance-none pr-8"
                      >
                        {submaterials.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                      <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    </div>
                    <button onClick={() => setTempForm(p => ({ ...p, items: p.items.filter((_, i) => i !== idx) }))} className="p-1.5 text-slate-400 hover:text-rose-500 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <p className="text-[10px] text-slate-400 mb-1">수량</p>
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={e => setTempForm(p => ({ ...p, items: p.items.map((it, i) => i === idx ? { ...it, quantity: e.target.value } : it) }))}
                        placeholder="0"
                        className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-teal-400"
                      />
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-400 mb-1">단위</p>
                      <input
                        value={item.unit}
                        onChange={e => setTempForm(p => ({ ...p, items: p.items.map((it, i) => i === idx ? { ...it, unit: e.target.value } : it) }))}
                        className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                      />
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-400 mb-1">단가(원)</p>
                      <input
                        type="number"
                        value={item.unitPrice}
                        onChange={e => setTempForm(p => ({ ...p, items: p.items.map((it, i) => i === idx ? { ...it, unitPrice: e.target.value } : it) }))}
                        placeholder="0"
                        className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-teal-400"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 비고 */}
          <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
            <p className="text-xs font-black text-slate-500 uppercase tracking-widest mb-2">비고</p>
            <textarea
              value={tempForm.note}
              onChange={e => setTempForm(p => ({ ...p, note: e.target.value }))}
              placeholder="메모 (선택)"
              rows={2}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-teal-400"
            />
          </div>

          <button
            onClick={saveTempReceipt}
            disabled={saveLoading}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white rounded-xl font-black text-sm transition-all shadow-md"
          >
            {saveLoading ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            임시 입고 등록 (재고 즉시 반영)
          </button>
        </div>
      )}

      {/* ── 탭 3: 이력 ── */}
      {tab === 'history' && (
        <div className="flex-1 overflow-auto space-y-3 px-1">
          {pendingReceipts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-300">
              <History size={40} strokeWidth={1.5} className="mb-2" />
              <p className="text-sm font-bold text-slate-400">등록된 임시 입고 내역이 없습니다</p>
            </div>
          ) : [...pendingReceipts].sort((a, b) => b.registeredAt.localeCompare(a.registeredAt)).map(r => (
            <div key={r.id} className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-black text-slate-800 text-sm">{r.partnerName}</p>
                  <p className="text-xs text-slate-400">{r.registeredAt.slice(0, 10)} · {r.registeredBy}</p>
                </div>
                <span className={`px-2 py-1 rounded-lg text-[10px] font-black ${r.status === 'voucher_linked' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                  {r.status === 'voucher_linked' ? '전표연결완료' : '전표작성 전'}
                </span>
              </div>
              {r.items.map((item, i) => (
                <div key={i} className="flex justify-between text-xs text-slate-600">
                  <span>{item.name}</span>
                  <span className="font-bold">{item.quantity.toLocaleString()} {item.unit}</span>
                </div>
              ))}
              {r.totalAmount !== undefined && r.totalAmount > 0 && (
                <p className="text-xs text-slate-400 pt-1 border-t border-slate-50">합계 <span className="font-black text-slate-700">{r.totalAmount.toLocaleString()}원</span></p>
              )}
              {r.photoUrl && (
                <a href={r.photoUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-teal-600 hover:underline">
                  <ImageIcon size={12} /> 첨부 사진 보기
                </a>
              )}
              {isAdmin && r.status === 'pending_voucher' && (
                <button
                  onClick={async () => {
                    await updateItem('pendingReceipts', r.id, { status: 'voucher_linked' });
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-teal-300 text-teal-700 rounded-lg text-xs font-black hover:bg-teal-50 transition-all"
                >
                  <Link2 size={12} /> 전표 연결 완료 처리
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── 카메라 오버레이 ── */}
      {cameraOpen && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <div className="flex items-center justify-between px-4 pt-safe pt-4 pb-3">
            <button onClick={closeCamera} className="p-2 text-white hover:text-slate-300">
              <X size={24} />
            </button>
            <p className="text-white font-black text-sm">
              {scanMode === 'scanning' ? 'QR을 화면에 맞추거나 사진을 촬영하세요' : 'AI 인식 또는 다시 촬영'}
            </p>
            <div className="w-10" />
          </div>

          <div className="flex-1 relative overflow-hidden">
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            <canvas ref={canvasRef} className="hidden" />

            {/* QR 스캔 가이드 */}
            {scanMode === 'scanning' && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-56 h-56 border-2 border-white rounded-2xl opacity-60" />
                <div className="absolute bottom-8 left-0 right-0 flex justify-center">
                  <div className="flex items-center gap-1.5 bg-black/50 rounded-full px-3 py-1.5">
                    <QrCode size={12} className="text-teal-400" />
                    <span className="text-white text-xs font-bold">QR 자동 감지 중...</span>
                  </div>
                </div>
              </div>
            )}

            {/* QR 감지됨 */}
            {qrDetected && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                <div className="bg-white rounded-2xl p-5 mx-6 text-center space-y-2">
                  <QrCode size={32} className="text-teal-600 mx-auto" />
                  <p className="font-black text-slate-800">QR 감지됨</p>
                  <p className="text-xs text-slate-500 break-all">{qrDetected}</p>
                </div>
              </div>
            )}

            {/* 촬영된 이미지 미리보기 */}
            {capturedImage && !qrDetected && (
              <div className="absolute inset-0">
                <img src={capturedImage} alt="captured" className="w-full h-full object-cover" />
              </div>
            )}
          </div>

          <div className="pb-safe pb-6 pt-4 px-6 space-y-3">
            {scanMode === 'scanning' ? (
              <button onClick={capturePhoto} className="w-full py-4 bg-white rounded-2xl font-black text-slate-800 text-sm flex items-center justify-center gap-2 shadow-lg">
                <Camera size={18} /> 사진 촬영 (AI 인식)
              </button>
            ) : capturedImage && !qrDetected ? (
              <>
                {geminiError && (
                  <div className="flex items-center gap-2 bg-rose-900/50 rounded-xl px-3 py-2">
                    <AlertCircle size={14} className="text-rose-300" />
                    <p className="text-rose-200 text-xs">{geminiError}</p>
                  </div>
                )}
                <button
                  onClick={parseWithGemini}
                  disabled={geminiLoading}
                  className="w-full py-4 bg-teal-500 hover:bg-teal-600 disabled:opacity-60 rounded-2xl font-black text-white text-sm flex items-center justify-center gap-2 shadow-lg"
                >
                  {geminiLoading ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
                  {geminiLoading ? 'AI 분석 중...' : 'AI로 전표 인식'}
                </button>
                <button
                  onClick={() => { setScanMode('scanning'); setCapturedImage(null); setCapturedFile(null); setGeminiError(null); }}
                  className="w-full py-3 border border-white/30 rounded-2xl font-black text-white text-sm"
                >
                  다시 촬영
                </button>
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* ── QR 매핑 모달 ── */}
      {mappingModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end md:items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm max-h-[80vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <p className="font-black text-slate-800">처음 보는 QR입니다</p>
                <p className="text-xs text-slate-400 mt-0.5 break-all">{mappingModal.qrValue}</p>
              </div>
              <button onClick={() => { setMappingModal(null); closeCamera(); }} className="p-2 text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <p className="px-5 py-3 text-xs text-slate-500">어떤 품목인가요? 선택하면 다음부터 자동 인식됩니다.</p>
            <div className="px-4 pb-2">
              <input
                value={mappingSearch}
                onChange={e => setMappingSearch(e.target.value)}
                placeholder="품목 검색..."
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
              />
            </div>
            <div className="overflow-auto flex-1 px-4 pb-4 space-y-1">
              {filteredMappingResults.map(sub => (
                <button
                  key={sub.id}
                  onClick={() => saveMappingAndAdd(sub)}
                  className="w-full flex items-center justify-between px-3 py-3 rounded-xl hover:bg-teal-50 text-left transition-all"
                >
                  <span className="text-sm font-bold text-slate-700">{sub.name}</span>
                  <span className="text-xs text-slate-400">{sub.unit}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── 입고 확인 모달 ── */}
      {confirmingStatement && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end md:items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl space-y-4 p-5">
            <div className="flex items-center justify-between">
              <p className="font-black text-slate-800">입고 확인</p>
              <button onClick={() => { setConfirmingStatement(null); setConfirmPhoto(null); setConfirmPhotoPreview(null); }} className="p-1.5 text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <div className="bg-slate-50 rounded-xl p-3 space-y-1">
              <p className="text-sm font-bold text-slate-700">{confirmingStatement.clientName}</p>
              <p className="text-xs text-slate-400">{confirmingStatement.tradeDate}</p>
              {confirmingStatement.items.map((item, i) => (
                <div key={i} className="flex justify-between text-xs text-slate-600">
                  <span>{item.name}</span>
                  <span className="font-bold">{item.qty?.toLocaleString()}</span>
                </div>
              ))}
            </div>
            <div>
              <p className="text-xs font-black text-slate-500 mb-2">사진 첨부 (선택)</p>
              {confirmPhotoPreview ? (
                <div className="relative">
                  <img src={confirmPhotoPreview} alt="preview" className="w-full h-40 object-cover rounded-xl" />
                  <button onClick={() => { setConfirmPhoto(null); setConfirmPhotoPreview(null); }} className="absolute top-2 right-2 p-1 bg-black/50 rounded-full text-white">
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <label className="flex items-center justify-center gap-2 py-3 border-2 border-dashed border-slate-200 rounded-xl text-slate-400 hover:border-teal-300 hover:text-teal-500 cursor-pointer transition-all text-xs font-bold">
                  <ImageIcon size={16} /> 사진 선택
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setConfirmPhoto(file);
                    setConfirmPhotoPreview(URL.createObjectURL(file));
                  }} />
                </label>
              )}
            </div>
            <button
              onClick={confirmReceipt}
              disabled={confirmLoading}
              className="w-full flex items-center justify-center gap-2 py-3.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white rounded-xl font-black text-sm transition-all shadow-md"
            >
              {confirmLoading ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
              입고 확인 완료
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default InboundManager;
