import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  RotateCcw, ScanLine, Building2, History,
  Camera, QrCode, X, Check, Plus, Trash2, ChevronDown,
  Loader2, AlertCircle, Link2, Image as ImageIcon,
  RefreshCw, Settings2,
} from 'lucide-react';
import jsQR from 'jsqr';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../src/shared/firebase';
import { addItem, updateItem, subscribeToCollection } from '../src/shared/services/firebaseService';
import {
  SubmaterialComponent, PendingReceipt, PendingReceiptItem, QrMapping,
  IssuedStatement, ReturnRequest, ReturnItem, ReturnReason,
  Product, Client, Order,
} from '../src/shared/types';
import PageHeader from './PageHeader';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY ?? '';
const qrMappingCache = new Map<string, QrMapping>();
const RETURN_REASONS: ReturnReason[] = ['품질불량', '오배송', '과잉재고', '기타'];

type MainTab = '입고' | '반품';
type InboundTab = '스캔' | '거래처별' | '이력';
type ReturnTab = '접수' | '이력';

interface ScanFormItem {
  submaterialId: string;
  name: string;
  quantity: string;
  unit: string;
  unitPrice: string;
}

interface ReceivingReturnsManagerProps {
  submaterials: SubmaterialComponent[];
  products: Product[];
  clients: Client[];
  orders: Order[];
  issuedStatements: IssuedStatement[];
  currentUser: { id: string; name: string };
  isAdmin: boolean;
  onUpdateSubmaterial: (id: string, data: Partial<SubmaterialComponent>) => void;
  onProcessReturn: (req: ReturnRequest) => Promise<void>;
}

const ReceivingReturnsManager: React.FC<ReceivingReturnsManagerProps> = ({
  submaterials,
  products,
  clients,
  orders,
  issuedStatements,
  currentUser,
  isAdmin,
  onUpdateSubmaterial,
  onProcessReturn,
}) => {
  // ── Tab state ──
  const [mainTab, setMainTab] = useState<MainTab>('입고');
  const [inboundTab, setInboundTab] = useState<InboundTab>('거래처별');
  const [returnTab, setReturnTab] = useState<ReturnTab>('접수');

  // ── Shared Firestore data ──
  const [pendingReceipts, setPendingReceipts] = useState<PendingReceipt[]>([]);
  const [returnRequests, setReturnRequests] = useState<ReturnRequest[]>([]);
  const [qrMappings, setQrMappings] = useState<QrMapping[]>([]);

  useEffect(() => {
    const u1 = subscribeToCollection<PendingReceipt>('pendingReceipts', setPendingReceipts);
    const u2 = subscribeToCollection<ReturnRequest>('returnRequests', setReturnRequests);
    const u3 = subscribeToCollection<QrMapping>('qrMappings', items => {
      setQrMappings(items);
      items.forEach(m => qrMappingCache.set(m.qrValue, m));
    });
    return () => { u1(); u2(); u3(); };
  }, []);

  // ── Camera refs ──
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Camera state ──
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [scanMode, setScanMode] = useState<'scanning' | 'captured'>('scanning');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [qrDetected, setQrDetected] = useState<string | null>(null);
  const [mappingModal, setMappingModal] = useState<{ qrValue: string } | null>(null);
  const [mappingSearch, setMappingSearch] = useState('');
  const [geminiLoading, setGeminiLoading] = useState(false);
  const [geminiError, setGeminiError] = useState<string | null>(null);

  // ── Scan inbound form ──
  const [scanSupplier, setScanSupplier] = useState('');
  const [scanItems, setScanItems] = useState<ScanFormItem[]>([]);
  const [scanNote, setScanNote] = useState('');
  const [scanSaving, setScanSaving] = useState(false);

  // ── Supplier-based inbound ──
  const [activeSupplier, setActiveSupplier] = useState<string | null>(null);
  const [supplierQtys, setSupplierQtys] = useState<Record<string, string>>({});
  const [supplierPrices, setSupplierPrices] = useState<Record<string, string>>({});
  const [supplierNote, setSupplierNote] = useState('');
  const [supplierExtraItems, setSupplierExtraItems] = useState<ScanFormItem[]>([]);
  const [supplierSaving, setSupplierSaving] = useState(false);
  // 로컬 제거 (Firestore 반영 전 즉시 숨김용)
  const [removedItemKeys, setRemovedItemKeys] = useState<Set<string>>(new Set());

  // ── 거래처-품목 설정 모달 ──
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [configClientId, setConfigClientId] = useState('');
  const [configSelectedSubIds, setConfigSelectedSubIds] = useState<string[]>([]);
  const [configSaving, setConfigSaving] = useState(false);
  const [configSearch, setConfigSearch] = useState('');

  // ── History filter ──
  const [historyMonth, setHistoryMonth] = useState(() => new Date().toISOString().slice(0, 7));

  // ── Returns form ──
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [selectedStatementId, setSelectedStatementId] = useState('');
  const [returnItems, setReturnItems] = useState<Partial<ReturnItem>[]>([]);
  const [returnNote, setReturnNote] = useState('');
  const [returnSaving, setReturnSaving] = useState(false);
  const [returnFilterMonth, setReturnFilterMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [clientSearch, setClientSearch] = useState('');
  const [showClientDropdown, setShowClientDropdown] = useState(false);

  // ══════════════════════════════════════════
  // Camera helpers
  // ══════════════════════════════════════════

  const closeCamera = useCallback(() => {
    cameraStream?.getTracks().forEach(t => t.stop());
    setCameraStream(null);
    setCameraOpen(false);
    setScanMode('scanning');
    setQrDetected(null);
  }, [cameraStream]);

  const openCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
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

  const handleQrDetected = useCallback((qrValue: string) => {
    const mapping = qrMappingCache.get(qrValue) ?? qrMappings.find(m => m.qrValue === qrValue);
    if (mapping) {
      const sub = submaterials.find(s => s.id === mapping.submaterialId);
      if (sub) {
        setScanItems(prev => [...prev, { submaterialId: sub.id, name: sub.name, quantity: '', unit: sub.unit, unitPrice: sub.cost?.toString() ?? '' }]);
        closeCamera();
      }
    } else {
      setMappingModal({ qrValue });
    }
  }, [qrMappings, submaterials, closeCamera]);

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
  }, [cameraOpen, scanMode, handleQrDetected]);

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
      const newItems: ScanFormItem[] = parsed.map(p => {
        const sub = submaterials.find(s => s.name === p.name);
        return {
          submaterialId: sub?.id ?? '',
          name: p.name,
          quantity: p.quantity?.toString() ?? '',
          unit: p.unit || sub?.unit || '',
          unitPrice: p.unitPrice?.toString() ?? sub?.cost?.toString() ?? '',
        };
      });
      if (parsed[0]?.supplier) setScanSupplier(parsed[0].supplier);
      setScanItems(prev => [...prev, ...newItems]);
      closeCamera();
    } catch {
      setGeminiError('AI 인식에 실패했습니다. 직접 입력해주세요.');
    } finally {
      setGeminiLoading(false);
    }
  }, [capturedImage, submaterials, closeCamera]);

  const saveMappingAndAdd = async (sub: SubmaterialComponent) => {
    if (!mappingModal) return;
    await addItem('qrMappings', {
      qrValue: mappingModal.qrValue,
      submaterialId: sub.id,
      submaterialName: sub.name,
      createdAt: new Date().toISOString(),
    });
    onUpdateSubmaterial(sub.id, { qrCode: mappingModal.qrValue });
    setScanItems(prev => [...prev, { submaterialId: sub.id, name: sub.name, quantity: '', unit: sub.unit, unitPrice: sub.cost?.toString() ?? '' }]);
    setMappingModal(null);
    closeCamera();
  };

  // ══════════════════════════════════════════
  // Scan inbound save
  // ══════════════════════════════════════════

  const saveScanInbound = async () => {
    if (!scanSupplier.trim()) { alert('거래처명을 입력해주세요.'); return; }
    if (scanItems.length === 0) { alert('품목을 추가해주세요.'); return; }
    const invalid = scanItems.find(i => !i.quantity || isNaN(Number(i.quantity)));
    if (invalid) { alert(`"${invalid.name}" 수량을 입력해주세요.`); return; }
    setScanSaving(true);
    try {
      let photoUrl: string | undefined;
      if (capturedFile) {
        const storageRef = ref(storage, `inbound/${Date.now()}_${capturedFile.name}`);
        await uploadBytes(storageRef, capturedFile);
        photoUrl = await getDownloadURL(storageRef);
      }
      const items: PendingReceiptItem[] = scanItems.map(i => ({
        submaterialId: i.submaterialId,
        name: i.name,
        quantity: Number(i.quantity),
        unit: i.unit,
        unitPrice: i.unitPrice ? Number(i.unitPrice) : undefined,
      }));
      const totalAmount = items.reduce((s, i) => s + i.quantity * (i.unitPrice ?? 0), 0);
      await addItem('pendingReceipts', {
        supplierName: scanSupplier,
        items,
        totalAmount,
        photoUrl,
        registeredBy: currentUser.name,
        registeredAt: new Date().toISOString(),
        status: 'pending_voucher',
        note: scanNote || undefined,
      } as Omit<PendingReceipt, 'id'>);
      for (const item of items) {
        if (!item.submaterialId) continue;
        const sub = submaterials.find(s => s.id === item.submaterialId);
        if (sub) onUpdateSubmaterial(sub.id, { stock: (sub.stock ?? 0) + item.quantity });
      }
      setScanSupplier('');
      setScanItems([]);
      setScanNote('');
      setCapturedImage(null);
      setCapturedFile(null);
      setInboundTab('이력');
    } finally {
      setScanSaving(false);
    }
  };

  // ══════════════════════════════════════════
  // Supplier-based inbound
  // ══════════════════════════════════════════

  const suppliers = clients.filter(c =>
    c.partnerType === '매입처' || c.partnerType === '매출+매입처'
  );

  // 거래처별 연결 품목
  // purchaseItems가 존재하면 그게 최종 목록 (X로 수동 관리한 상태)
  // purchaseItems가 없으면 products.supplierId 폴백
  const getSupplierLinkedItems = (client: Client): { name: string; sub: SubmaterialComponent | null }[] => {
    const seen = new Set<string>();
    const result: { name: string; sub: SubmaterialComponent | null }[] = [];

    const push = (name: string, sub: SubmaterialComponent | null) => {
      const key = sub?.id ?? name;
      if (seen.has(key)) return;
      seen.add(key);
      result.push({ name, sub });
    };

    if (client.purchaseItems && client.purchaseItems.length > 0) {
      // purchaseItems가 있으면 이것만 사용 (수동 설정이 우선)
      client.purchaseItems.forEach(pi => {
        const sub = submaterials.find(s => s.id === pi.id)
          ?? submaterials.find(s => s.name === pi.name)
          ?? null;
        push(sub?.name ?? pi.name, sub);
      });
    } else {
      // purchaseItems 미설정 → supplierId 폴백 (기존 데이터 호환)
      products
        .filter(p =>
          p.supplierId === client.id &&
          p.category !== '완제품'
        )
        .forEach(p => {
          const sub = submaterials.find(s => s.id === p.id)
            ?? submaterials.find(s => s.name === p.name)
            ?? null;
          push(p.name, sub);
        });
    }

    return result;
  };

  // supplierId로 연결된 품목이 있는 거래처 ID 집합 (partnerType 무관)
  const supplierClientIds = new Set(
    products
      .filter(p => p.supplierId && p.category !== '완제품')
      .map(p => p.supplierId!)
  );

  // 연결 품목이 하나라도 있는 거래처 — partnerType 설정 여부 무관하게 표시
  const suppliersWithItems = clients.filter(c =>
    getSupplierLinkedItems(c).length > 0 || supplierClientIds.has(c.id)
  );

  const openConfigModal = (clientId = '') => {
    setConfigClientId(clientId);
    if (clientId) {
      const client = clients.find(c => c.id === clientId);
      // 기존 purchaseItems + supplierId 방식 모두 선택된 상태로 초기화
      const existingIds = getSupplierLinkedItems(client!)
        .map(({ sub }) => sub?.id)
        .filter((id): id is string => !!id);
      setConfigSelectedSubIds(existingIds);
    } else {
      setConfigSelectedSubIds([]);
    }
    setConfigSearch('');
    setShowConfigModal(true);
  };

  const saveConfig = async () => {
    if (!configClientId) { alert('거래처를 선택해주세요.'); return; }
    if (configSelectedSubIds.length === 0) { alert('품목을 1개 이상 선택해주세요.'); return; }
    setConfigSaving(true);
    try {
      const purchaseItems = configSelectedSubIds.map(subId => {
        const sub = submaterials.find(s => s.id === subId)!;
        return { id: sub.id, name: sub.name };
      });
      await updateItem('clients', configClientId, { purchaseItems });
      setShowConfigModal(false);
    } finally {
      setConfigSaving(false);
    }
  };

  const toggleConfigSub = (subId: string) => {
    setConfigSelectedSubIds(prev =>
      prev.includes(subId) ? prev.filter(id => id !== subId) : [...prev, subId]
    );
  };

  const handleOpenSupplier = (client: Client) => {
    if (activeSupplier === client.id) {
      setActiveSupplier(null);
      return;
    }
    setActiveSupplier(client.id);
    const items = getSupplierLinkedItems(client);
    const qtys: Record<string, string> = {};
    const prices: Record<string, string> = {};
    items.forEach(({ sub }) => {
      if (sub) {
        qtys[sub.id] = '';
        prices[sub.id] = sub.cost?.toString() ?? '';
      }
    });
    setSupplierQtys(qtys);
    setSupplierPrices(prices);
    setSupplierNote('');
    setSupplierExtraItems([]);
    setRemovedItemKeys(new Set());
  };

  const saveSupplierInbound = async (client: Client) => {
    const linkedItems = getSupplierLinkedItems(client);
    const receiptItems: PendingReceiptItem[] = [];

    for (const { sub } of linkedItems) {
      if (!sub) continue;
      const qty = Number(supplierQtys[sub.id] ?? 0);
      if (qty <= 0) continue;
      receiptItems.push({
        submaterialId: sub.id,
        name: sub.name,
        quantity: qty,
        unit: sub.unit,
        unitPrice: supplierPrices[sub.id] ? Number(supplierPrices[sub.id]) : sub.cost,
      });
    }
    for (const extra of supplierExtraItems) {
      const qty = Number(extra.quantity);
      if (qty <= 0) continue;
      receiptItems.push({
        submaterialId: extra.submaterialId,
        name: extra.name,
        quantity: qty,
        unit: extra.unit,
        unitPrice: extra.unitPrice ? Number(extra.unitPrice) : undefined,
      });
    }

    if (receiptItems.length === 0) { alert('수량을 1개 이상 입력해주세요.'); return; }
    setSupplierSaving(true);
    try {
      const totalAmount = receiptItems.reduce((s, i) => s + i.quantity * (i.unitPrice ?? 0), 0);
      await addItem('pendingReceipts', {
        supplierName: client.name,
        items: receiptItems,
        totalAmount,
        registeredBy: currentUser.name,
        registeredAt: new Date().toISOString(),
        status: 'pending_voucher',
        note: supplierNote || undefined,
      } as Omit<PendingReceipt, 'id'>);
      for (const item of receiptItems) {
        if (!item.submaterialId) continue;
        const sub = submaterials.find(s => s.id === item.submaterialId);
        if (sub) onUpdateSubmaterial(sub.id, { stock: (sub.stock ?? 0) + item.quantity });
      }
      setActiveSupplier(null);
      setInboundTab('이력');
    } finally {
      setSupplierSaving(false);
    }
  };

  const removeLinkedItem = async (client: Client, key: string) => {
    // 즉시 로컬에서 숨김
    setRemovedItemKeys(prev => new Set([...prev, key]));
    // 현재 연결 품목에서 해당 항목 제외 후 purchaseItems 저장
    const remaining = getSupplierLinkedItems(client).filter(
      ({ name, sub }) => (sub?.id ?? name) !== key
    );
    await updateItem('clients', client.id, {
      purchaseItems: remaining.map(({ name, sub }) => ({ id: sub?.id ?? name, name: sub?.name ?? name })),
    });
  };

  // ══════════════════════════════════════════
  // Returns helpers
  // ══════════════════════════════════════════

  const sellableProducts = products.filter(p =>
    ['완제품', '향미유', '고춧가루'].includes(p.category as string)
  );

  const clientOrders = orders
    .filter(o => o.clientId === selectedClientId && o.status === 'DELIVERED')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 30);

  const clientStatements = issuedStatements
    .filter(s => s.clientId === selectedClientId && s.type === '매출')
    .sort((a, b) => b.tradeDate.localeCompare(a.tradeDate))
    .slice(0, 30);

  useEffect(() => {
    setSelectedOrderId('');
    setSelectedStatementId('');
    setReturnItems([]);
  }, [selectedClientId]);

  const handleSelectOrder = (orderId: string) => {
    setSelectedOrderId(orderId);
    if (!orderId) { setReturnItems([]); return; }
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    setReturnItems(order.items.map(i => ({
      productId: i.productId,
      name: i.name,
      quantity: 0,
      price: i.price,
      reason: '기타' as ReturnReason,
      isResellable: true,
    })));
  };

  const updateReturnItemField = <K extends keyof ReturnItem>(idx: number, key: K, val: ReturnItem[K]) => {
    setReturnItems(prev => prev.map((it, i) => (i === idx ? { ...it, [key]: val } : it)));
  };

  const handleReturnProductSelect = (idx: number, productId: string) => {
    const p = products.find(x => x.id === productId);
    setReturnItems(prev => prev.map((it, i) => i === idx ? { ...it, productId, name: p?.name ?? '', price: p?.price ?? 0 } : it));
  };

  const validReturnItems = returnItems.filter(
    (it): it is ReturnItem => !!it.productId && !!it.name && (it.quantity ?? 0) > 0
  );
  const returnTotalAmount = validReturnItems.reduce((sum, it) => sum + it.quantity * it.price, 0);

  const handleSelectReturnClient = (clientId: string, clientName: string) => {
    setSelectedClientId(clientId);
    setClientSearch(clientName);
    setShowClientDropdown(false);
  };

  const handleClientSearchChange = (text: string) => {
    setClientSearch(text);
    setShowClientDropdown(true);
    if (!text) setSelectedClientId('');
  };

  const handleReturnSubmit = async () => {
    const client = clients.find(c => c.id === selectedClientId);
    if (!client) { alert('거래처를 선택해주세요.'); return; }
    if (validReturnItems.length === 0) { alert('반품 품목을 1개 이상 입력해주세요.'); return; }
    setReturnSaving(true);
    try {
      await addItem('returnRequests', {
        clientId: selectedClientId,
        clientName: client.name,
        ...(selectedOrderId && { orderId: selectedOrderId }),
        ...(selectedStatementId && { linkedStatementId: selectedStatementId }),
        items: validReturnItems,
        totalAmount: returnTotalAmount,
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
        createdBy: currentUser.name,
        ...(returnNote && { note: returnNote }),
      });
      setSelectedClientId('');
      setClientSearch('');
      setReturnItems([]);
      setReturnNote('');
      setReturnTab('이력');
    } finally {
      setReturnSaving(false);
    }
  };

  const handleProcessReturn = async (req: ReturnRequest) => {
    if (!isAdmin) { alert('관리자만 반품 처리를 할 수 있습니다.'); return; }
    if (!window.confirm(`${req.clientName}의 반품을 처리하시겠습니까?\n재판매 가능 품목의 재고가 복귀됩니다.`)) return;
    setProcessingId(req.id);
    try {
      await onProcessReturn(req);
    } finally {
      setProcessingId(null);
    }
  };

  // ── Derived ──
  const pendingReturnCount = returnRequests.filter(r => r.status === 'pending').length;
  const filteredInboundHistory = pendingReceipts
    .filter(r => r.registeredAt.slice(0, 7) === historyMonth)
    .sort((a, b) => b.registeredAt.localeCompare(a.registeredAt));
  const filteredReturnHistory = returnRequests
    .filter(r => r.createdAt.slice(0, 7) === returnFilterMonth)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const filteredMappingResults = submaterials.filter(s =>
    !mappingSearch || s.name.toLowerCase().includes(mappingSearch.toLowerCase())
  );

  // ══════════════════════════════════════════
  // Render
  // ══════════════════════════════════════════

  return (
    <div className="space-y-4">
      <PageHeader title="입고 / 반품" subtitle="선입고 처리 · 거래처별 입고 · 반품 접수 및 처리" />

      {/* ── 메인 탭 ── */}
      <div className="flex bg-slate-100 rounded-xl p-1 gap-1 w-fit">
        {(['입고', '반품'] as MainTab[]).map(t => (
          <button
            key={t}
            onClick={() => setMainTab(t)}
            className={`px-5 py-2 rounded-lg text-sm font-black transition-all ${mainTab === t ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
          >
            {t}
            {t === '반품' && pendingReturnCount > 0 && (
              <span className="ml-1.5 bg-amber-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full">
                {pendingReturnCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════
          입고 탭
      ══════════════════════════════════════════ */}
      {mainTab === '입고' && (
        <div className="space-y-4">
          {/* 입고 서브탭 */}
          <div className="flex bg-slate-100 rounded-xl p-1 gap-1">
            {([
              { key: '스캔', label: '스캔 입고', Icon: ScanLine },
              { key: '거래처별', label: '거래처별', Icon: Building2 },
              { key: '이력', label: '입고 이력', Icon: History },
            ] as { key: InboundTab; label: string; Icon: React.ElementType }[]).map(({ key, label, Icon }) => (
              <button
                key={key}
                onClick={() => setInboundTab(key)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-black transition-all ${inboundTab === key ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>

          {/* ── 스캔 입고 ── */}
          {inboundTab === '스캔' && (
            <div className="space-y-4">
              <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm space-y-3">
                <p className="text-xs font-black text-slate-500 uppercase tracking-widest">거래처 정보</p>
                <input
                  value={scanSupplier}
                  onChange={e => setScanSupplier(e.target.value)}
                  placeholder="거래처명 입력"
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                />
              </div>

              <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm space-y-3">
                <p className="text-xs font-black text-slate-500 uppercase tracking-widest">품목 추가</p>
                <button
                  onClick={openCamera}
                  className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-teal-300 rounded-xl text-teal-600 hover:bg-teal-50 transition-all text-sm font-black"
                >
                  <Camera size={16} /> QR 스캔 또는 사진으로 추가
                </button>
                <button
                  onClick={() => {
                    const first = submaterials[0];
                    if (!first) return;
                    setScanItems(p => [...p, { submaterialId: first.id, name: first.name, quantity: '', unit: first.unit, unitPrice: first.cost?.toString() ?? '' }]);
                  }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 border border-slate-200 rounded-xl text-slate-500 hover:bg-slate-50 transition-all text-xs font-black"
                >
                  <Plus size={14} /> 직접 입력으로 추가
                </button>
              </div>

              {scanItems.length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm space-y-3">
                  <p className="text-xs font-black text-slate-500 uppercase tracking-widest">입고 품목 ({scanItems.length})</p>
                  {scanItems.map((item, idx) => (
                    <div key={idx} className="p-3 bg-slate-50 rounded-xl space-y-2">
                      <div className="flex items-center justify-between">
                        <select
                          value={item.submaterialId}
                          onChange={e => {
                            const sub = submaterials.find(s => s.id === e.target.value);
                            if (!sub) return;
                            setScanItems(p => p.map((it, i) => i === idx ? { ...it, submaterialId: sub.id, name: sub.name, unit: sub.unit, unitPrice: sub.cost?.toString() ?? '' } : it));
                          }}
                          className="flex-1 mr-2 px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-400"
                        >
                          {submaterials.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                        <button onClick={() => setScanItems(p => p.filter((_, i) => i !== idx))} className="p-1.5 text-slate-400 hover:text-rose-500 transition-colors">
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <p className="text-[10px] text-slate-400 mb-1">수량</p>
                          <input type="number" value={item.quantity} onChange={e => setScanItems(p => p.map((it, i) => i === idx ? { ...it, quantity: e.target.value } : it))} placeholder="0" className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-teal-400" />
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-400 mb-1">단위</p>
                          <input value={item.unit} onChange={e => setScanItems(p => p.map((it, i) => i === idx ? { ...it, unit: e.target.value } : it))} className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-400 mb-1">단가(원)</p>
                          <input type="number" value={item.unitPrice} onChange={e => setScanItems(p => p.map((it, i) => i === idx ? { ...it, unitPrice: e.target.value } : it))} placeholder="0" className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-teal-400" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
                <p className="text-xs font-black text-slate-500 uppercase tracking-widest mb-2">비고</p>
                <textarea value={scanNote} onChange={e => setScanNote(e.target.value)} placeholder="메모 (선택)" rows={2} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-teal-400" />
              </div>

              <button
                onClick={saveScanInbound}
                disabled={scanSaving}
                className="w-full flex items-center justify-center gap-2 py-3.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white rounded-xl font-black text-sm transition-all shadow-md"
              >
                {scanSaving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                선입고 처리 (재고 즉시 반영)
              </button>
            </div>
          )}

          {/* ── 거래처별 입고 ── */}
          {inboundTab === '거래처별' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-400">
                  {suppliersWithItems.length > 0 ? `${suppliersWithItems.length}개 거래처 연결됨` : '연결된 거래처 없음'}
                </p>
                <button
                  onClick={() => openConfigModal()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-50 text-teal-700 rounded-lg text-xs font-black hover:bg-teal-100 transition-colors"
                >
                  <Settings2 size={13} /> 거래처 품목 설정
                </button>
              </div>

              {suppliersWithItems.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center text-slate-400">
                  <Building2 size={32} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm font-bold">연결된 품목이 있는 거래처가 없습니다</p>
                  <p className="text-xs mt-1">우측 상단 "거래처 품목 설정"에서 거래처별 품목을 등록해주세요</p>
                </div>
              ) : suppliersWithItems.map(supplier => {
                const linkedItems = getSupplierLinkedItems(supplier);
                const isActive = activeSupplier === supplier.id;
                return (
                  <div key={supplier.id} className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
                    <button
                      className="w-full p-4 flex items-center gap-3 hover:bg-slate-50 transition-colors text-left"
                      onClick={() => handleOpenSupplier(supplier)}
                    >
                      <div className="w-10 h-10 rounded-xl bg-teal-100 flex items-center justify-center shrink-0">
                        <Building2 size={18} className="text-teal-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-black text-slate-800 text-sm">{supplier.name}</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {linkedItems.length > 0
                            ? `연결된 품목 ${linkedItems.length}개`
                            : '품목 미등록 — 직접 추가 가능'}
                        </p>
                      </div>
                      <ChevronDown
                        size={16}
                        className={`text-slate-400 shrink-0 transition-transform duration-200 ${isActive ? 'rotate-180' : ''}`}
                      />
                    </button>

                    {isActive && (
                      <div className="border-t border-slate-100 p-4 space-y-4">
                        {/* 연결된 품목 */}
                        {(() => {
                          const visibleItems = linkedItems.filter(
                            ({ name, sub }) => !removedItemKeys.has(sub?.id ?? name)
                          );
                          return visibleItems.length > 0 ? (
                            <div className="space-y-2">
                              <p className="text-xs font-black text-slate-500 uppercase tracking-widest">연결 품목</p>
                              {visibleItems.map(({ name, sub }, i) => {
                                const key = sub?.id ?? name;
                                return (
                                  <div key={i} className="flex items-center gap-2 bg-slate-50 rounded-xl p-3">
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-bold text-slate-700">{name}</p>
                                      {sub ? (
                                        <p className="text-xs text-slate-400">현재 재고: {(sub.stock ?? 0).toLocaleString()} {sub.unit}</p>
                                      ) : (
                                        <p className="text-xs text-amber-500">부자재와 연결되지 않음</p>
                                      )}
                                    </div>
                                    {sub && (
                                      <div className="flex items-center gap-2">
                                        <input
                                          type="number"
                                          min={0}
                                          placeholder="수량"
                                          value={supplierQtys[sub.id] ?? ''}
                                          onChange={e => setSupplierQtys(prev => ({ ...prev, [sub.id]: e.target.value }))}
                                          className="w-24 px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-teal-400"
                                        />
                                        <span className="text-xs text-slate-400 w-6 shrink-0">{sub.unit}</span>
                                      </div>
                                    )}
                                    <button
                                      onClick={() => removeLinkedItem(supplier, key)}
                                      className="p-1.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors shrink-0"
                                      title="목록에서 제거"
                                    >
                                      <X size={13} />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          ) : null;
                        })()}

                        {/* 추가 품목 직접 입력 */}
                        {supplierExtraItems.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs font-black text-slate-500 uppercase tracking-widest">추가 품목</p>
                            {supplierExtraItems.map((item, idx) => (
                              <div key={idx} className="flex items-center gap-2 bg-blue-50 rounded-xl p-3">
                                <select
                                  value={item.submaterialId}
                                  onChange={e => {
                                    const sub = submaterials.find(s => s.id === e.target.value);
                                    if (!sub) return;
                                    setSupplierExtraItems(p => p.map((it, i) => i === idx ? { ...it, submaterialId: sub.id, name: sub.name, unit: sub.unit, unitPrice: sub.cost?.toString() ?? '' } : it));
                                  }}
                                  className="flex-1 px-2 py-1.5 border border-blue-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-400"
                                >
                                  {submaterials.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                                <input
                                  type="number"
                                  min={0}
                                  placeholder="수량"
                                  value={item.quantity}
                                  onChange={e => setSupplierExtraItems(p => p.map((it, i) => i === idx ? { ...it, quantity: e.target.value } : it))}
                                  className="w-20 px-2 py-1.5 border border-blue-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-teal-400"
                                />
                                <span className="text-xs text-slate-400 w-8 shrink-0">{item.unit}</span>
                                <button onClick={() => setSupplierExtraItems(p => p.filter((_, i) => i !== idx))} className="p-1 text-slate-400 hover:text-rose-500 transition-colors">
                                  <X size={14} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        <button
                          onClick={() => {
                            const first = submaterials[0];
                            if (!first) return;
                            setSupplierExtraItems(p => [...p, { submaterialId: first.id, name: first.name, quantity: '', unit: first.unit, unitPrice: first.cost?.toString() ?? '' }]);
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 border border-dashed border-slate-300 text-slate-400 rounded-lg text-xs font-black hover:border-teal-400 hover:text-teal-600 transition-colors"
                        >
                          <Plus size={12} /> 추가 품목 입력
                        </button>

                        <div>
                          <p className="text-xs font-black text-slate-500 uppercase tracking-widest mb-1.5">비고</p>
                          <input
                            value={supplierNote}
                            onChange={e => setSupplierNote(e.target.value)}
                            placeholder="메모 (선택)"
                            className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                          />
                        </div>

                        <button
                          onClick={() => saveSupplierInbound(supplier)}
                          disabled={supplierSaving}
                          className="w-full flex items-center justify-center gap-2 py-3 bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white rounded-xl font-black text-sm transition-all"
                        >
                          {supplierSaving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                          선입고 처리 (재고 즉시 반영)
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── 입고 이력 ── */}
          {inboundTab === '이력' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 flex-wrap">
                <label className="text-xs font-black text-slate-500 uppercase tracking-wider">기간</label>
                <input
                  type="month"
                  value={historyMonth}
                  onChange={e => setHistoryMonth(e.target.value)}
                  className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                />
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-black">
                  전표 미작성 {filteredInboundHistory.filter(r => r.status === 'pending_voucher').length}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-black">
                  전표 연결됨 {filteredInboundHistory.filter(r => r.status === 'voucher_linked').length}
                </span>
              </div>

              {filteredInboundHistory.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center text-slate-400">
                  <History size={32} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">해당 월의 입고 이력이 없습니다</p>
                </div>
              ) : filteredInboundHistory.map(r => (
                <div key={r.id} className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-black text-slate-800 text-sm">{r.supplierName}</p>
                      <p className="text-xs text-slate-400">{r.registeredAt.slice(0, 10)} · {r.registeredBy}</p>
                    </div>
                    <span className={`px-2 py-1 rounded-lg text-[10px] font-black shrink-0 ${r.status === 'voucher_linked' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                      {r.status === 'voucher_linked' ? '✓ 전표 연결됨' : '전표 미작성'}
                    </span>
                  </div>
                  {r.items.map((item, i) => (
                    <div key={i} className="flex justify-between text-xs text-slate-600 bg-slate-50 rounded-lg px-3 py-1.5">
                      <span>{item.name}</span>
                      <span className="font-bold">{item.quantity.toLocaleString()} {item.unit}</span>
                    </div>
                  ))}
                  {r.totalAmount !== undefined && r.totalAmount > 0 && (
                    <p className="text-xs text-slate-400 pt-1 border-t border-slate-50">
                      합계 <span className="font-black text-slate-700">{r.totalAmount.toLocaleString()}원</span>
                    </p>
                  )}
                  {r.photoUrl && (
                    <a href={r.photoUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-teal-600 hover:underline">
                      <ImageIcon size={12} /> 첨부 사진 보기
                    </a>
                  )}
                  {r.note && (
                    <p className="text-xs text-slate-500 bg-amber-50 border border-amber-100 rounded-lg px-3 py-1.5">
                      비고: {r.note}
                    </p>
                  )}
                  {isAdmin && r.status === 'pending_voucher' && (
                    <button
                      onClick={async () => await updateItem('pendingReceipts', r.id, { status: 'voucher_linked' })}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-teal-300 text-teal-700 rounded-lg text-xs font-black hover:bg-teal-50 transition-all"
                    >
                      <Link2 size={12} /> 전표 연결 완료 처리
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════
          반품 탭
      ══════════════════════════════════════════ */}
      {mainTab === '반품' && (
        <div className="space-y-4">
          <div className="flex bg-slate-100 rounded-xl p-1 gap-1 w-fit">
            {(['접수', '이력'] as ReturnTab[]).map(t => (
              <button
                key={t}
                onClick={() => setReturnTab(t)}
                className={`px-4 py-2 rounded-lg text-sm font-black transition-all ${returnTab === t ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
              >
                {t}
                {t === '이력' && pendingReturnCount > 0 && (
                  <span className="ml-1.5 bg-amber-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full">
                    {pendingReturnCount}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ── 반품 접수 ── */}
          {returnTab === '접수' && (
            <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5 relative">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">거래처 *</label>
                  <div className="relative">
                    <input
                      value={clientSearch}
                      onChange={e => handleClientSearchChange(e.target.value)}
                      onFocus={() => setShowClientDropdown(true)}
                      onBlur={() => setTimeout(() => setShowClientDropdown(false), 150)}
                      placeholder="거래처 검색..."
                      className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${selectedClientId ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white'}`}
                    />
                    {showClientDropdown && (
                      <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-auto">
                        {clients.filter(c => !clientSearch || c.name.toLowerCase().includes(clientSearch.toLowerCase())).length === 0 ? (
                          <p className="px-3 py-2.5 text-xs text-slate-400">검색 결과 없음</p>
                        ) : clients
                          .filter(c => !clientSearch || c.name.toLowerCase().includes(clientSearch.toLowerCase()))
                          .map(c => (
                            <button
                              key={c.id}
                              onMouseDown={() => handleSelectReturnClient(c.id, c.name)}
                              className={`w-full px-3 py-2.5 text-left text-sm hover:bg-blue-50 transition-colors ${selectedClientId === c.id ? 'bg-blue-50 font-bold text-blue-700' : 'text-slate-700'}`}
                            >
                              {c.name}
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">원주문 (선택)</label>
                  <select
                    value={selectedOrderId}
                    onChange={e => handleSelectOrder(e.target.value)}
                    disabled={!selectedClientId}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-40"
                  >
                    <option value="">원주문 선택 (품목 자동 채움)</option>
                    {clientOrders.map(o => (
                      <option key={o.id} value={o.id}>
                        {o.createdAt.slice(0, 10)} — {o.items.map(i => i.name).join(', ').slice(0, 25)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">연결 전표 (선택)</label>
                  <select
                    value={selectedStatementId}
                    onChange={e => setSelectedStatementId(e.target.value)}
                    disabled={!selectedClientId}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-40"
                  >
                    <option value="">전표 선택 (미수금 차감)</option>
                    {clientStatements.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.tradeDate} — {s.docNo} (₩{s.totalAmount.toLocaleString()})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <label className="text-xs font-black text-slate-500 uppercase tracking-wider">반품 품목 *</label>
                <button
                  onClick={() => setReturnItems(prev => [...prev, { reason: '기타' as ReturnReason, isResellable: true, quantity: 0, price: 0 }])}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-black hover:bg-blue-100 transition-colors"
                >
                  <Plus size={13} /> 품목 추가
                </button>
              </div>

              {returnItems.length > 0 && (
                <div className="grid grid-cols-12 gap-2 px-2.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                  <div className="col-span-4">품목</div>
                  <div className="col-span-1 text-center">수량</div>
                  <div className="col-span-2 text-center">단가</div>
                  <div className="col-span-3">반품 사유</div>
                  <div className="col-span-2 text-center">재고 처리</div>
                </div>
              )}

              {returnItems.length === 0 ? (
                <p className="text-slate-400 text-sm py-6 text-center border-2 border-dashed border-slate-200 rounded-xl">
                  원주문을 선택하거나 품목을 직접 추가하세요
                </p>
              ) : (
                <div className="space-y-2">
                  {returnItems.map((it, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-center bg-slate-50 rounded-xl p-2.5">
                      <div className="col-span-4">
                        <select
                          value={it.productId ?? ''}
                          onChange={e => handleReturnProductSelect(idx, e.target.value)}
                          className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                        >
                          <option value="">품목 선택</option>
                          {sellableProducts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </div>
                      <div className="col-span-1">
                        <input type="number" min={1} placeholder="0" value={it.quantity || ''} onChange={e => updateReturnItemField(idx, 'quantity', Number(e.target.value))} className="w-full border border-slate-200 rounded-lg px-1 py-1.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-400" />
                      </div>
                      <div className="col-span-2">
                        <input type="number" min={0} placeholder="0" value={it.price || ''} onChange={e => updateReturnItemField(idx, 'price', Number(e.target.value))} className="w-full border border-slate-200 rounded-lg px-1 py-1.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-400" />
                      </div>
                      <div className="col-span-3">
                        <select value={it.reason ?? '기타'} onChange={e => updateReturnItemField(idx, 'reason', e.target.value as ReturnReason)} className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400">
                          {RETURN_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </div>
                      <div className="col-span-1 flex justify-center">
                        <button
                          onClick={() => updateReturnItemField(idx, 'isResellable', !it.isResellable)}
                          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-black transition-colors ${it.isResellable ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-red-100 text-red-600 hover:bg-red-200'}`}
                        >
                          {it.isResellable ? <><Check size={10} />재판매</> : <><X size={10} />폐기</>}
                        </button>
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <button onClick={() => setReturnItems(prev => prev.filter((_, i) => i !== idx))} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-black text-slate-500 uppercase tracking-wider">비고</label>
                <textarea value={returnNote} onChange={e => setReturnNote(e.target.value)} placeholder="반품 관련 메모 (선택)" rows={2} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                <div>
                  <p className="text-xs text-slate-400">총 반품금액</p>
                  <p className="text-xl font-black text-slate-800">₩{returnTotalAmount.toLocaleString()}</p>
                  {selectedStatementId && returnTotalAmount > 0 && (
                    <p className="text-xs text-emerald-600 mt-0.5">→ 선택된 전표에서 미수금 차감</p>
                  )}
                </div>
                <button
                  onClick={handleReturnSubmit}
                  disabled={returnSaving || !selectedClientId || validReturnItems.length === 0}
                  className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-black hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                >
                  <RotateCcw size={15} />
                  {returnSaving ? '저장 중...' : '반품 접수'}
                </button>
              </div>
            </div>
          )}

          {/* ── 반품 이력 ── */}
          {returnTab === '이력' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <label className="text-xs font-black text-slate-500 uppercase tracking-wider">기간</label>
                <input
                  type="month"
                  value={returnFilterMonth}
                  onChange={e => setReturnFilterMonth(e.target.value)}
                  className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-xs text-slate-400">{filteredReturnHistory.length}건</span>
              </div>

              {filteredReturnHistory.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center text-slate-400">
                  <RotateCcw size={32} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">해당 월의 반품 이력이 없습니다</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredReturnHistory.map(req => (
                    <ReturnCard
                      key={req.id}
                      req={req}
                      isAdmin={isAdmin}
                      isProcessing={processingId === req.id}
                      onProcess={() => handleProcessReturn(req)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════
          카메라 오버레이
      ══════════════════════════════════════════ */}
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

            {qrDetected && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                <div className="bg-white rounded-2xl p-5 mx-6 text-center space-y-2">
                  <QrCode size={32} className="text-teal-600 mx-auto" />
                  <p className="font-black text-slate-800">QR 감지됨</p>
                  <p className="text-xs text-slate-500 break-all">{qrDetected}</p>
                </div>
              </div>
            )}

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

      {/* ── 거래처 품목 설정 모달 ── */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end md:items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm max-h-[85vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <p className="font-black text-slate-800">거래처 품목 설정</p>
              <button onClick={() => setShowConfigModal(false)} className="p-2 text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-3 border-b border-slate-100">
              <div className="space-y-1.5">
                <label className="text-xs font-black text-slate-500 uppercase tracking-wider">거래처</label>
                <select
                  value={configClientId}
                  onChange={e => openConfigModal(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-400"
                >
                  <option value="">거래처 선택</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <input
                value={configSearch}
                onChange={e => setConfigSearch(e.target.value)}
                placeholder="부자재 검색..."
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
              />
            </div>

            <div className="overflow-auto flex-1 px-4 py-3 space-y-1">
              {submaterials
                .filter(s => !configSearch || s.name.toLowerCase().includes(configSearch.toLowerCase()))
                .map(sub => {
                  const checked = configSelectedSubIds.includes(sub.id);
                  return (
                    <button
                      key={sub.id}
                      onClick={() => toggleConfigSub(sub.id)}
                      className={`w-full flex items-center justify-between px-3 py-3 rounded-xl text-left transition-all ${checked ? 'bg-teal-50 border border-teal-200' : 'hover:bg-slate-50'}`}
                    >
                      <div>
                        <p className="text-sm font-bold text-slate-700">{sub.name}</p>
                        <p className="text-xs text-slate-400">현재 재고: {(sub.stock ?? 0).toLocaleString()} {sub.unit}</p>
                      </div>
                      {checked && <Check size={16} className="text-teal-600 shrink-0" />}
                    </button>
                  );
                })}
            </div>

            <div className="px-5 py-4 border-t border-slate-100 space-y-2">
              <p className="text-xs text-slate-400 text-center">{configSelectedSubIds.length}개 품목 선택됨</p>
              <button
                onClick={saveConfig}
                disabled={configSaving || !configClientId || configSelectedSubIds.length === 0}
                className="w-full flex items-center justify-center gap-2 py-3 bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white rounded-xl font-black text-sm transition-all"
              >
                {configSaving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                저장
              </button>
            </div>
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
    </div>
  );
};

// ── 반품 이력 카드 ──────────────────────────────────────────────────────────────

interface ReturnCardProps {
  req: ReturnRequest;
  isAdmin: boolean;
  isProcessing: boolean;
  onProcess: () => void;
}

const ReturnCard: React.FC<ReturnCardProps> = ({ req, isAdmin, isProcessing, onProcess }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
      <div
        className="p-4 flex items-center gap-4 cursor-pointer hover:bg-slate-50 transition-colors"
        onClick={() => setExpanded(p => !p)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-black text-slate-800 text-sm">{req.clientName}</p>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${req.status === 'processed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
              {req.status === 'processed' ? '처리완료' : '처리대기'}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            {req.createdAt.slice(0, 10)} · {req.items.length}개 품목 · ₩{req.totalAmount.toLocaleString()}
            {req.createdBy && <span> · 접수: {req.createdBy}</span>}
          </p>
        </div>

        {req.status === 'pending' && isAdmin && (
          <button
            onClick={e => { e.stopPropagation(); onProcess(); }}
            disabled={isProcessing}
            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-black hover:bg-blue-700 disabled:opacity-40 transition-colors shrink-0"
          >
            {isProcessing ? '처리 중...' : '처리'}
          </button>
        )}

        <ChevronDown
          size={16}
          className={`text-slate-400 shrink-0 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
        />
      </div>

      {expanded && (
        <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-2.5">
          {req.orderId && <p className="text-xs text-slate-400">원주문 ID: {req.orderId}</p>}
          {req.linkedStatementId && <p className="text-xs text-emerald-600">연결 전표: {req.linkedStatementId}</p>}

          <div className="space-y-1.5">
            {req.items.map((item, i) => (
              <div key={i} className="flex items-center justify-between text-xs bg-slate-50 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <span className="font-semibold text-slate-700">{item.name}</span>
                  <span className="text-slate-400">{item.quantity}개 × ₩{item.price.toLocaleString()}</span>
                  <span className="text-slate-400">· {item.reason}</span>
                </div>
                <span className={`ml-2 shrink-0 px-2 py-0.5 rounded-full text-[10px] font-black ${item.isResellable ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                  {item.isResellable ? '재판매' : '폐기'}
                </span>
              </div>
            ))}
          </div>

          {req.note && (
            <p className="text-xs text-slate-500 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              비고: {req.note}
            </p>
          )}
          {req.processedAt && (
            <p className="text-xs text-slate-400">
              처리일시: {req.processedAt.slice(0, 16).replace('T', ' ')}
              {req.processedBy && ` (${req.processedBy})`}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default ReceivingReturnsManager;
