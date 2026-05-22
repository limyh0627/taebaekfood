import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  RotateCcw, ScanLine, Building2, History, Truck,
  Camera, QrCode, X, Check, Plus, Trash2, ChevronDown,
  Loader2, AlertCircle, Link2, Image as ImageIcon,
  RefreshCw, Settings2, FileText,
} from 'lucide-react';
import jsQR from 'jsqr';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../src/shared/firebase';
import { addItem, updateItem, deleteItem, subscribeToCollection } from '../src/shared/services/firebaseService';
import {
  SubmaterialComponent, PendingReceipt, PendingReceiptItem, QrMapping,
  IssuedStatement, IssuedStatementItem, ReturnRequest, ReturnItem, ReturnReason,
  Product, Client, Order,
} from '../src/shared/types';
import PageHeader from './PageHeader';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY ?? '';
const qrMappingCache = new Map<string, QrMapping>();
const RETURN_REASONS: ReturnReason[] = ['품질불량', '오배송', '과잉재고', '기타'];

type MainTab = '입고' | '반품';
type InboundTab = '스캔' | '거래처별' | '이력';
type ReturnTab = '받기' | '보내기' | '이력';

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
  productSuppliers: import('../src/shared/types').PartnerItem[];
  orders: Order[];
  issuedStatements: IssuedStatement[];
  currentUser: { id: string; name: string };
  isAdmin: boolean;
  onUpdateSubmaterial: (id: string, data: Partial<SubmaterialComponent>) => void;
  onProcessReturn: (req: ReturnRequest) => Promise<void>;
  initialTab?: MainTab;
}

const ReceivingReturnsManager: React.FC<ReceivingReturnsManagerProps> = ({
  submaterials,
  products,
  clients,
  productSuppliers,
  orders,
  issuedStatements,
  currentUser,
  isAdmin,
  onUpdateSubmaterial,
  onProcessReturn,
  initialTab = '입고',
}) => {
  // ── Tab state ──
  const [mainTab, setMainTab] = useState<MainTab>(initialTab);
  const [inboundTab, setInboundTab] = useState<InboundTab>('거래처별');
  const [returnTab, setReturnTab] = useState<ReturnTab>('받기');

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
  const [scanSupplierId, setScanSupplierId] = useState('');
  const [scanSupplierSearch, setScanSupplierSearch] = useState('');
  const [showScanSupplierDropdown, setShowScanSupplierDropdown] = useState(false);
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
  const [configSelectedIds, setConfigSelectedIds] = useState<string[]>([]);
  const [configSaving, setConfigSaving] = useState(false);
  const [configSearch, setConfigSearch] = useState('');
  const [configClientSearch, setConfigClientSearch] = useState('');
  const [showConfigClientDropdown, setShowConfigClientDropdown] = useState(false);


  // ── 전표 발행 모달 ──
  interface StatementDraftItem { name: string; qty: string; price: string; unit: string; isTaxExempt: boolean; }
  interface StatementDraft {
    receipt: PendingReceipt;
    clientId: string;
    tradeDate: string;
    items: StatementDraftItem[];
  }
  const [statementDraft, setStatementDraft] = useState<StatementDraft | null>(null);
  const [statementSaving, setStatementSaving] = useState(false);

  // ── Returns form ──
  const [returnClientId, setReturnClientId] = useState('');
  const [returnClientSearch, setReturnClientSearch] = useState('');
  const [showReturnClientDropdown, setShowReturnClientDropdown] = useState(false);
  const [returnItems, setReturnItems] = useState<{ productId: string; name: string; qty: string; unit: string }[]>([]);
  const [returnItemSearch, setReturnItemSearch] = useState('');
  const [returnNote, setReturnNote] = useState('');
  const [returnSaving, setReturnSaving] = useState(false);
  const [returnFilterMonth, setReturnFilterMonth] = useState(() => new Date().toISOString().slice(0, 7));

  // ── 매입 반품 (보내기) state ──
  const [prSupplierId, setPrSupplierId] = useState('');
  const [prSupplierSearch, setPrSupplierSearch] = useState('');
  const [showPrSupplierDropdown, setShowPrSupplierDropdown] = useState(false);
  const [prItems, setPrItems] = useState<{ itemId: string; name: string; qty: string; unit: string }[]>([]);
  const [prItemSearch, setPrItemSearch] = useState('');
  const [prNote, setPrNote] = useState('');
  const [prSaving, setPrSaving] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

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
      if (parsed[0]?.supplier) { setScanSupplierSearch(parsed[0].supplier); setShowScanSupplierDropdown(true); }
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
    const supplier = clients.find(c => c.id === scanSupplierId);
    if (!supplier) { alert('거래처를 선택해주세요.'); return; }
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
        supplierName: supplier.name,
        supplierId: supplier.id,
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
      setScanSupplierId('');
      setScanSupplierSearch('');
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
  // sub가 없으면 Product(향미유/고춧가루 등)에서도 검색
  const getSupplierLinkedItems = (client: Client): { name: string; sub: SubmaterialComponent | null; product: Product | null }[] => {
    const seen = new Set<string>();
    const result: { name: string; sub: SubmaterialComponent | null; product: Product | null }[] = [];

    const push = (name: string, sub: SubmaterialComponent | null, product: Product | null) => {
      const key = sub?.id ?? product?.id ?? name;
      if (seen.has(key)) return;
      seen.add(key);
      result.push({ name, sub, product });
    };

    if (client.purchaseItems && client.purchaseItems.length > 0) {
      // purchaseItems가 있으면 이것만 사용 (수동 설정이 우선)
      client.purchaseItems.forEach(pi => {
        const sub = submaterials.find(s => s.id === pi.id)
          ?? submaterials.find(s => s.name === pi.name)
          ?? null;
        const product = sub ? null : (
          products.find(p => p.id === pi.id)
          ?? products.find(p => p.name === pi.name)
          ?? null
        );
        push(sub?.name ?? product?.name ?? pi.name, sub, product);
      });
    } else {
      // purchaseItems 미설정 → partner_item(Direction=in) 우선, supplierId 폴백
      const supplierItemIds = new Set(
        productSuppliers
          .filter(ps => (ps.Partner_ID ?? ps.supplierId) === client.id)
          .map(ps => ps.Item_ID ?? ps.productId)
          .filter((id): id is string => !!id)
      );
      const allItems = [
        ...submaterials.filter(s => supplierItemIds.has(s.id)),
        ...products.filter(p => p.category !== '완제품' && (supplierItemIds.has(p.id) || p.supplierId === client.id)),
      ];
      allItems.forEach(p => {
        const sub = submaterials.find(s => s.id === p.id) ?? null;
        const prod = sub ? null : (products.find(pr => pr.id === p.id) ?? null);
        push(p.name, sub, prod);
      });
    }

    return result;
  };

  // partner_item(in) 또는 supplierId로 연결된 거래처 ID 집합 (partnerType 무관)
  const supplierClientIds = new Set([
    ...productSuppliers.map(ps => ps.Partner_ID ?? ps.supplierId).filter((id): id is string => !!id),
    ...products.filter(p => p.supplierId && p.category !== '완제품').map(p => p.supplierId!),
  ]);

  // 연결 품목이 하나라도 있는 거래처 — partnerType 설정 여부 무관하게 표시
  const suppliersWithItems = clients.filter(c =>
    getSupplierLinkedItems(c).length > 0 || supplierClientIds.has(c.id)
  );

  const openConfigModal = (clientId = '') => {
    setConfigClientId(clientId);
    if (clientId) {
      const client = clients.find(c => c.id === clientId);
      const existingIds = getSupplierLinkedItems(client!)
        .map(({ sub, product }) => sub?.id ?? product?.id)
        .filter((id): id is string => !!id);
      setConfigSelectedIds(existingIds);
    } else {
      setConfigSelectedIds([]);
    }
    setConfigSearch('');
    setShowConfigModal(true);
  };

  const saveConfig = async () => {
    if (!configClientId) { alert('거래처를 선택해주세요.'); return; }
    if (configSelectedIds.length === 0) { alert('품목을 1개 이상 선택해주세요.'); return; }
    setConfigSaving(true);
    try {
      const purchaseItems = configSelectedIds.map(id => {
        const sub = submaterials.find(s => s.id === id);
        if (sub) return { id: sub.id, name: sub.name };
        const product = products.find(p => p.id === id);
        if (product) return { id: product.id, name: product.name };
        return { id, name: id };
      });

      // partners 문서에 purchaseItems 저장
      await updateItem('partners', configClientId, { purchaseItems });

      // partner_item 동기화 (Direction='in')
      // 이 거래처의 기존 매입 항목
      const existing = productSuppliers.filter(
        ps => (ps.Partner_ID ?? ps.supplierId) === configClientId
      );
      const existingItemIds = new Set(existing.map(ps => ps.Item_ID ?? ps.productId).filter(Boolean) as string[]);

      // 새로 추가할 항목
      const toAdd = configSelectedIds.filter(id => !existingItemIds.has(id));
      // 제거할 항목 (선택에서 빠진 기존 항목)
      const toRemove = existing.filter(ps => {
        const itemId = ps.Item_ID ?? ps.productId;
        return itemId && !configSelectedIds.includes(itemId);
      });

      await Promise.all([
        ...toAdd.map(itemId =>
          addItem('partner_item', {
            id: `${itemId}_${configClientId}_in`,
            Partner_ID: configClientId,
            Item_ID: itemId,
            Direction: 'in' as const,
          })
        ),
        ...toRemove.map(ps => deleteItem('partner_item', ps.id)),
      ]);

      setShowConfigModal(false);
    } catch (e) {
      console.error('거래처 품목 설정 저장 실패:', e);
      alert('저장 중 오류가 발생했습니다: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setConfigSaving(false);
    }
  };

  const toggleConfigItem = (id: string) => {
    setConfigSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
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
    items.forEach(({ sub, product }) => {
      const key = sub?.id ?? product?.id;
      if (key) {
        qtys[key] = '';
        prices[key] = (sub?.cost ?? product?.cost ?? product?.price ?? 0).toString();
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

    for (const { sub, product } of linkedItems) {
      const itemId = sub?.id ?? product?.id;
      if (!itemId) continue;
      const qty = Number(supplierQtys[itemId] ?? 0);
      if (qty <= 0) continue;
      const unit = sub?.unit ?? product?.unit ?? '';
      const price = supplierPrices[itemId] ? Number(supplierPrices[itemId]) : (sub?.cost ?? product?.cost ?? product?.price);
      receiptItems.push({
        submaterialId: itemId,
        name: sub?.name ?? product?.name ?? '',
        quantity: qty,
        unit,
        unitPrice: price,
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
        if (sub) {
          onUpdateSubmaterial(sub.id, { stock: (sub.stock ?? 0) + item.quantity });
        } else {
          const product = products.find(p => p.id === item.submaterialId);
          if (product) {
            await updateItem('items', product.id, { stock: (product.stock ?? 0) + item.quantity });
          }
        }
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
      ({ name, sub, product }) => (sub?.id ?? product?.id ?? name) !== key
    );
    await updateItem('partners', client.id, {
      purchaseItems: remaining.map(({ name, sub, product }) => ({
        id: sub?.id ?? product?.id ?? name,
        name: sub?.name ?? product?.name ?? name,
      })),
    });
  };

  // ══════════════════════════════════════════
  // 전표 발행 helpers
  // ══════════════════════════════════════════

  const openStatementModal = (receipt: PendingReceipt) => {
    const matchedClient = clients.find(c =>
      c.name === receipt.supplierName ||
      c.name.includes(receipt.supplierName) ||
      receipt.supplierName.includes(c.name)
    );
    setStatementDraft({
      receipt,
      clientId: matchedClient?.id ?? '',
      tradeDate: receipt.registeredAt.slice(0, 10),
      items: receipt.items.map(item => ({
        name: item.name,
        qty: item.quantity.toString(),
        price: (item.unitPrice ?? 0).toString(),
        unit: item.unit,
        isTaxExempt: false,
      })),
    });
  };

  const saveStatement = async () => {
    if (!statementDraft) return;
    const client = clients.find(c => c.id === statementDraft.clientId);
    if (!client) { alert('거래처를 선택해주세요.'); return; }
    const validItems = statementDraft.items.filter(i => Number(i.qty) > 0);
    if (validItems.length === 0) { alert('수량을 1개 이상 입력해주세요.'); return; }

    setStatementSaving(true);
    try {
      const stmtItems: IssuedStatementItem[] = validItems.map(i => {
        const qty = Number(i.qty);
        const price = Number(i.price);
        const supply = qty * price;
        const tax = i.isTaxExempt ? 0 : Math.round(supply * 0.1);
        return { name: i.name, spec: i.unit, qty, price, supply, tax, total: supply + tax, isTaxExempt: i.isTaxExempt };
      });
      const totalSupply = stmtItems.reduce((s, i) => s + i.supply, 0);
      const totalTax = stmtItems.reduce((s, i) => s + i.tax, 0);
      const docNo = `${statementDraft.tradeDate.slice(0, 7)}-${String(issuedStatements.length + 1).padStart(4, '0')}`;

      const stmtId = await addItem('issuedStatements', {
        issuedAt: new Date().toISOString(),
        tradeDate: statementDraft.tradeDate,
        type: '매입' as const,
        clientId: client.id,
        clientName: client.name,
        orderId: statementDraft.receipt.id,
        docNo,
        totalSupply,
        totalTax,
        totalAmount: totalSupply + totalTax,
        items: stmtItems,
      } as Omit<IssuedStatement, 'id'>);

      await updateItem('pendingReceipts', statementDraft.receipt.id, {
        status: 'voucher_linked',
        linkedStatementId: stmtId,
      });
      setStatementDraft(null);
    } finally {
      setStatementSaving(false);
    }
  };

  // ══════════════════════════════════════════
  // Returns helpers
  // ══════════════════════════════════════════

  const sellableProducts = products.filter(p =>
    ['완제품', '향미유', '고춧가루', 'product', 'wip', 'giftset'].includes(p.category as string)
  );

  useEffect(() => {
    if (!returnClientId) { setReturnItems([]); return; }
    // 거래처에 연결된 품목(clientIds 기반) 우선 표시
    const linked = sellableProducts
      .filter(p => p.clientIds?.includes(returnClientId))
      .map(p => ({ productId: p.id, name: p.name, qty: '', unit: p.unit }));
    if (linked.length > 0) {
      setReturnItems(linked);
      return;
    }
    // 연결 품목 없으면 최근 주문 이력으로 fallback
    const clientOrders = orders
      .filter(o => o.clientId === returnClientId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const seen = new Set<string>();
    const preItems: { productId: string; name: string; qty: string; unit: string }[] = [];
    for (const order of clientOrders) {
      for (const item of order.items) {
        if (!item.productId || seen.has(item.productId)) continue;
        const product = sellableProducts.find(p => p.id === item.productId);
        if (!product) continue;
        seen.add(item.productId);
        preItems.push({ productId: item.productId, name: item.name, qty: '', unit: product.unit });
      }
    }
    setReturnItems(preItems);
  }, [returnClientId]);

  const handleSelectReturnClient = (id: string, name: string) => {
    setReturnClientId(id);
    setReturnClientSearch(name);
    setShowReturnClientDropdown(false);
    setReturnItemSearch('');
  };

  const addReturnItem = (productId: string) => {
    if (returnItems.some(i => i.productId === productId)) return;
    const p = sellableProducts.find(x => x.id === productId);
    if (!p) return;
    setReturnItems(prev => [...prev, { productId: p.id, name: p.name, qty: '', unit: p.unit }]);
  };

  const handleReturnSubmit = async () => {
    const client = clients.find(c => c.id === returnClientId);
    if (!client) { alert('거래처를 선택해주세요.'); return; }
    const items: ReturnItem[] = returnItems
      .filter(i => Number(i.qty) > 0)
      .map(i => ({
        productId: i.productId,
        name: i.name,
        quantity: Number(i.qty),
        price: 0,
        reason: '기타' as ReturnReason,
        isResellable: true,
      }));
    if (items.length === 0) { alert('반품 수량을 1개 이상 입력해주세요.'); return; }
    setReturnSaving(true);
    try {
      await addItem('returnRequests', {
        clientId: returnClientId,
        clientName: client.name,
        items,
        totalAmount: 0,
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
        createdBy: currentUser.name,
        ...(returnNote && { note: returnNote }),
      });
      setReturnClientId('');
      setReturnClientSearch('');
      setReturnItems([]);
      setReturnNote('');
      setReturnTab('이력');
    } finally {
      setReturnSaving(false);
    }
  };

  const handlePurchaseReturnSubmit = async () => {
    const supplier = clients.find(c => c.id === prSupplierId);
    if (!supplier) { alert('거래처를 선택해주세요.'); return; }
    const items: ReturnItem[] = prItems
      .filter(i => Number(i.qty) > 0)
      .map(i => ({
        productId: i.itemId,
        name: i.name,
        quantity: Number(i.qty),
        price: 0,
        reason: '기타' as ReturnReason,
        isResellable: false,
      }));
    if (items.length === 0) { alert('반품 수량을 1개 이상 입력해주세요.'); return; }
    setPrSaving(true);
    try {
      await addItem('returnRequests', {
        clientId: prSupplierId,
        clientName: supplier.name,
        items,
        totalAmount: 0,
        status: 'pending' as const,
        returnType: '매입' as const,
        createdAt: new Date().toISOString(),
        createdBy: currentUser.name,
        ...(prNote && { note: prNote }),
      });
      setPrSupplierId('');
      setPrSupplierSearch('');
      setPrItems([]);
      setPrNote('');
      setReturnTab('이력');
    } finally {
      setPrSaving(false);
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
  const pendingReturnCount = returnRequests.filter(r => r.status === 'pending' && r.returnType !== '매입').length;
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
      <PageHeader
        title="입고 / 반품"
        subtitle="선입고 처리 · 거래처별 입고 · 반품 접수 및 처리"
        right={
          <button
            onClick={() => {
              if (mainTab === '입고' && inboundTab === '스캔') {
                setInboundTab('거래처별');
              } else {
                setMainTab('입고');
                setInboundTab('스캔');
              }
            }}
            className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-black transition-all shadow-sm ${
              mainTab === '입고' && inboundTab === '스캔'
                ? 'bg-teal-600 text-white'
                : 'bg-teal-50 text-teal-700 hover:bg-teal-100'
            }`}
          >
            <ScanLine size={15} />
            <span>스캔 입고</span>
          </button>
        }
      />

      {/* ══════════════════════════════════════════
          입고 탭
      ══════════════════════════════════════════ */}
      {mainTab === '입고' && (
        <div className="space-y-4">

          {/* ── 스캔 입고 ── */}
          {inboundTab === '스캔' && (
            <div className="space-y-4">
              <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm space-y-3">
                <p className="text-xs font-black text-slate-500 uppercase tracking-widest">거래처 *</p>
                <div className="relative">
                  <input
                    value={scanSupplierSearch}
                    onChange={e => { setScanSupplierSearch(e.target.value); setShowScanSupplierDropdown(true); if (!e.target.value) setScanSupplierId(''); }}
                    onFocus={() => setShowScanSupplierDropdown(true)}
                    onBlur={() => setTimeout(() => setShowScanSupplierDropdown(false), 150)}
                    placeholder="거래처 검색..."
                    className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 ${scanSupplierId ? 'border-teal-300 bg-teal-50' : 'border-slate-200'}`}
                  />
                  {showScanSupplierDropdown && (
                    <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-52 overflow-auto">
                      {suppliers
                        .filter(c => !scanSupplierSearch || c.name.toLowerCase().includes(scanSupplierSearch.toLowerCase()))
                        .map(c => (
                          <button
                            key={c.id}
                            onMouseDown={() => { setScanSupplierId(c.id); setScanSupplierSearch(c.name); setShowScanSupplierDropdown(false); }}
                            className={`w-full px-3 py-2.5 text-left text-sm hover:bg-teal-50 transition-colors ${scanSupplierId === c.id ? 'bg-teal-50 font-bold text-teal-700' : 'text-slate-700'}`}
                          >
                            {c.name}
                          </button>
                        ))}
                      {suppliers.filter(c => !scanSupplierSearch || c.name.toLowerCase().includes(scanSupplierSearch.toLowerCase())).length === 0 && (
                        <p className="px-3 py-2.5 text-sm text-slate-400">검색 결과 없음</p>
                      )}
                    </div>
                  )}
                </div>
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
                disabled={scanSaving || !scanSupplierId}
                className="w-full flex items-center justify-center gap-2 py-3.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white rounded-xl font-black text-sm transition-all shadow-md"
              >
                {scanSaving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                선입고 처리 (재고 즉시 반영)
              </button>
            </div>
          )}

          {/* ── 거래처별 입고 ── */}
          {inboundTab !== '스캔' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-400">
                  {suppliers.length > 0 ? `${suppliers.length}개 매입거래처` : '매입거래처 없음'}
                </p>
                <button
                  onClick={() => openConfigModal()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-50 text-teal-700 rounded-lg text-xs font-black hover:bg-teal-100 transition-colors"
                >
                  <Settings2 size={13} /> 거래처 품목 설정
                </button>
              </div>

              {suppliers.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center text-slate-400">
                  <Building2 size={32} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm font-bold">매입거래처가 없습니다</p>
                  <p className="text-xs mt-1">거래처 관리에서 매입처를 등록해주세요</p>
                </div>
              ) : suppliers.map(supplier => {
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
                              {visibleItems.map(({ name, sub, product }, i) => {
                                const itemId = sub?.id ?? product?.id;
                                const key = itemId ?? name;
                                const unit = sub?.unit ?? product?.unit ?? '';
                                const stock = sub?.stock ?? product?.stock ?? 0;
                                const isLinked = !!itemId;
                                return (
                                  <div key={i} className="flex items-center gap-2 bg-slate-50 rounded-xl p-3">
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-bold text-slate-700">{name}</p>
                                      {isLinked ? (
                                        <p className="text-xs text-slate-400">현재 재고: {stock.toLocaleString()} {unit}</p>
                                      ) : (
                                        <p className="text-xs text-amber-500">품목과 연결되지 않음</p>
                                      )}
                                    </div>
                                    {isLinked && itemId && (
                                      <div className="flex items-center gap-2">
                                        <input
                                          type="number"
                                          min={0}
                                          placeholder="수량"
                                          value={supplierQtys[itemId] ?? ''}
                                          onChange={e => setSupplierQtys(prev => ({ ...prev, [itemId]: e.target.value }))}
                                          className="w-24 px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-teal-400"
                                        />
                                        <span className="text-xs text-slate-400 w-6 shrink-0">{unit}</span>
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

        </div>
      )}

      {/* ══════════════════════════════════════════
          반품 탭
      ══════════════════════════════════════════ */}
      {mainTab === '반품' && (
        <div className="space-y-4">
          <div className="flex bg-slate-100 rounded-xl p-1 gap-1 w-fit">
            <button
              onClick={() => setReturnTab('받기')}
              className={`px-4 py-2 rounded-lg text-sm font-black transition-all flex items-center gap-1.5 ${returnTab === '받기' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
            >
              <RotateCcw size={13} />
              받은 반품
              {pendingReturnCount > 0 && (
                <span className="bg-amber-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full">
                  {pendingReturnCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setReturnTab('보내기')}
              className={`px-4 py-2 rounded-lg text-sm font-black transition-all flex items-center gap-1.5 ${returnTab === '보내기' ? 'bg-white text-orange-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
            >
              <Truck size={13} />
              보낸 반품
            </button>
            <button
              onClick={() => setReturnTab('이력')}
              className={`px-4 py-2 rounded-lg text-sm font-black transition-all flex items-center gap-1.5 ${returnTab === '이력' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
            >
              <History size={13} />
              이력
            </button>
          </div>

          {/* ── 받은 반품 (매출처가 우리에게 돌려보내는 것) ── */}
          {returnTab === '받기' && (
            <div className="space-y-3">
              {/* 거래처 검색 */}
              <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm space-y-2">
                <p className="text-xs font-black text-slate-500 uppercase tracking-widest">거래처 *</p>
                <div className="relative">
                  <input
                    value={returnClientSearch}
                    onChange={e => { setReturnClientSearch(e.target.value); setShowReturnClientDropdown(true); if (!e.target.value) { setReturnClientId(''); } }}
                    onFocus={() => setShowReturnClientDropdown(true)}
                    onBlur={() => setTimeout(() => setShowReturnClientDropdown(false), 150)}
                    placeholder="거래처 검색..."
                    className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${returnClientId ? 'border-blue-300 bg-blue-50' : 'border-slate-200'}`}
                  />
                  {showReturnClientDropdown && (
                    <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-52 overflow-auto">
                      {clients
                        .filter(c => !c.partnerType || c.partnerType === '매출처' || c.partnerType === '매출+매입처')
                        .filter(c => !returnClientSearch || c.name.toLowerCase().includes(returnClientSearch.toLowerCase()))
                        .map(c => (
                          <button
                            key={c.id}
                            onMouseDown={() => handleSelectReturnClient(c.id, c.name)}
                            className={`w-full px-3 py-2.5 text-left text-sm hover:bg-blue-50 transition-colors ${returnClientId === c.id ? 'bg-blue-50 font-bold text-blue-700' : 'text-slate-700'}`}
                          >
                            {c.name}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              </div>

              {/* 품목 목록 */}
              {returnClientId && (
                <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-black text-slate-500 uppercase tracking-widest">반품 품목</p>
                    <span className="text-xs text-slate-400">{returnItems.filter(i => Number(i.qty) > 0).length}개 입력됨</span>
                  </div>

                  {returnItems.length === 0 ? (
                    <p className="text-xs text-slate-400 py-4 text-center">이 거래처의 주문 이력이 없습니다. 아래에서 품목을 추가하세요.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {returnItems.map((item, idx) => (
                        <div key={item.productId} className="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-slate-700">{item.name}</p>
                            <p className="text-xs text-slate-400">{item.unit}</p>
                          </div>
                          <input
                            type="number"
                            min={0}
                            placeholder="0"
                            value={item.qty}
                            onChange={e => setReturnItems(prev => prev.map((it, i) => i === idx ? { ...it, qty: e.target.value } : it))}
                            className="w-24 px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400"
                          />
                          <span className="text-xs text-slate-400 w-8 shrink-0">{item.unit}</span>
                          <button onClick={() => setReturnItems(prev => prev.filter((_, i) => i !== idx))} className="p-1 text-slate-300 hover:text-rose-500 transition-colors">
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 품목 검색 추가 */}
                  <div className="relative">
                    <input
                      type="text"
                      value={returnItemSearch}
                      onChange={e => setReturnItemSearch(e.target.value)}
                      onBlur={() => setTimeout(() => setReturnItemSearch(''), 150)}
                      placeholder="+ 품목 검색하여 추가..."
                      className="w-full border border-dashed border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-500 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                    {returnItemSearch && (
                      <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-auto">
                        {sellableProducts
                          .filter(p => !returnItems.some(i => i.productId === p.id))
                          .filter(p => p.name.toLowerCase().includes(returnItemSearch.toLowerCase()))
                          .map(p => (
                            <button
                              key={p.id}
                              onMouseDown={() => { addReturnItem(p.id); setReturnItemSearch(''); }}
                              className="w-full px-3 py-2.5 text-left text-sm hover:bg-blue-50 transition-colors text-slate-700"
                            >
                              {p.name}
                            </button>
                          ))}
                        {sellableProducts.filter(p => !returnItems.some(i => i.productId === p.id) && p.name.toLowerCase().includes(returnItemSearch.toLowerCase())).length === 0 && (
                          <p className="px-3 py-3 text-xs text-slate-400 text-center">검색 결과 없음</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 비고 */}
              <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
                <p className="text-xs font-black text-slate-500 uppercase tracking-widest mb-2">비고</p>
                <textarea
                  value={returnNote}
                  onChange={e => setReturnNote(e.target.value)}
                  placeholder="반품 관련 메모 (선택)"
                  rows={2}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>

              <button
                onClick={handleReturnSubmit}
                disabled={returnSaving || !returnClientId}
                className="w-full flex items-center justify-center gap-2 py-3.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-xl font-black text-sm transition-all shadow-md"
              >
                {returnSaving ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
                반품 접수 (관리자 확인 후 전표 발행)
              </button>
            </div>
          )}

          {/* ── 보낸 반품 (우리가 매입처에 돌려보내는 것) ── */}
          {returnTab === '보내기' && (
            <div className="space-y-3">
              <div className="bg-orange-50 border border-orange-100 rounded-2xl px-4 py-2.5 text-xs text-orange-700 font-bold">
                우리가 공급처(매입처)에 재료·부자재를 반품 보낼 때 기록합니다
              </div>

              {/* 거래처 (매입처) */}
              <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm space-y-2">
                <p className="text-xs font-black text-slate-500 uppercase tracking-widest">공급처 *</p>
                <div className="relative">
                  <input
                    value={prSupplierSearch}
                    onChange={e => { setPrSupplierSearch(e.target.value); setShowPrSupplierDropdown(true); if (!e.target.value) setPrSupplierId(''); }}
                    onFocus={() => setShowPrSupplierDropdown(true)}
                    onBlur={() => setTimeout(() => setShowPrSupplierDropdown(false), 150)}
                    placeholder="공급처 검색..."
                    className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 ${prSupplierId ? 'border-orange-300 bg-orange-50' : 'border-slate-200'}`}
                  />
                  {showPrSupplierDropdown && (
                    <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-52 overflow-auto">
                      {suppliers
                        .filter(c => !prSupplierSearch || c.name.toLowerCase().includes(prSupplierSearch.toLowerCase()))
                        .map(c => (
                          <button
                            key={c.id}
                            onMouseDown={() => { setPrSupplierId(c.id); setPrSupplierSearch(c.name); setShowPrSupplierDropdown(false); setPrItems([]); }}
                            className={`w-full px-3 py-2.5 text-left text-sm hover:bg-orange-50 transition-colors ${prSupplierId === c.id ? 'bg-orange-50 font-bold text-orange-700' : 'text-slate-700'}`}
                          >
                            {c.name}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              </div>

              {/* 품목 */}
              {prSupplierId && (
                <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-black text-slate-500 uppercase tracking-widest">반품 품목</p>
                    <span className="text-xs text-slate-400">{prItems.filter(i => Number(i.qty) > 0).length}개 입력됨</span>
                  </div>

                  {prItems.length === 0 ? (
                    <p className="text-xs text-slate-400 py-4 text-center">아래에서 품목을 검색해 추가하세요</p>
                  ) : (
                    <div className="space-y-1.5">
                      {prItems.map((item, idx) => (
                        <div key={item.itemId} className="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-slate-700">{item.name}</p>
                            <p className="text-xs text-slate-400">{item.unit}</p>
                          </div>
                          <input
                            type="number"
                            min={0}
                            placeholder="0"
                            value={item.qty}
                            onChange={e => setPrItems(prev => prev.map((it, i) => i === idx ? { ...it, qty: e.target.value } : it))}
                            className="w-24 px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-orange-400"
                          />
                          <span className="text-xs text-slate-400 w-8 shrink-0">{item.unit}</span>
                          <button onClick={() => setPrItems(prev => prev.filter((_, i) => i !== idx))} className="p-1 text-slate-300 hover:text-rose-500 transition-colors">
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="relative">
                    <input
                      type="text"
                      value={prItemSearch}
                      onChange={e => setPrItemSearch(e.target.value)}
                      onBlur={() => setTimeout(() => setPrItemSearch(''), 150)}
                      placeholder="+ 품목 검색하여 추가..."
                      className="w-full border border-dashed border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-500 bg-white focus:outline-none focus:ring-2 focus:ring-orange-400"
                    />
                    {prItemSearch && (
                      <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-auto">
                        {submaterials
                          .filter(s => !prItems.some(i => i.itemId === s.id) && s.name.toLowerCase().includes(prItemSearch.toLowerCase()))
                          .map(s => (
                            <button
                              key={s.id}
                              onMouseDown={() => { setPrItems(prev => [...prev, { itemId: s.id, name: s.name, qty: '', unit: s.unit }]); setPrItemSearch(''); }}
                              className="w-full px-3 py-2.5 text-left text-sm hover:bg-orange-50 transition-colors text-slate-700"
                            >
                              {s.name}
                            </button>
                          ))}
                        {submaterials.filter(s => !prItems.some(i => i.itemId === s.id) && s.name.toLowerCase().includes(prItemSearch.toLowerCase())).length === 0 && (
                          <p className="px-3 py-3 text-xs text-slate-400 text-center">검색 결과 없음</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 비고 */}
              <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
                <p className="text-xs font-black text-slate-500 uppercase tracking-widest mb-2">비고</p>
                <textarea
                  value={prNote}
                  onChange={e => setPrNote(e.target.value)}
                  placeholder="반품 사유, 메모 (선택)"
                  rows={2}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-400"
                />
              </div>

              <button
                onClick={handlePurchaseReturnSubmit}
                disabled={prSaving || !prSupplierId}
                className="w-full flex items-center justify-center gap-2 py-3.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-60 text-white rounded-xl font-black text-sm transition-all shadow-md"
              >
                {prSaving ? <Loader2 size={16} className="animate-spin" /> : <Truck size={16} />}
                반품 발송 접수 (관리자 확인 후 처리)
              </button>
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
                    <div key={req.id}>
                      <div className="flex items-center gap-2 mb-1.5 px-1">
                        {req.returnType === '매입' ? (
                          <span className="flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">
                            <Truck size={10} /> 보낸 반품
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                            <RotateCcw size={10} /> 받은 반품
                          </span>
                        )}
                      </div>
                      <ReturnCard
                        req={req}
                        isAdmin={isAdmin}
                        isProcessing={processingId === req.id}
                        onProcess={() => handleProcessReturn(req)}
                      />
                    </div>
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
              <button onClick={() => { setShowConfigModal(false); setConfigClientSearch(''); setShowConfigClientDropdown(false); }} className="p-2 text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-3 border-b border-slate-100">
              <div className="space-y-1.5">
                <label className="text-xs font-black text-slate-500 uppercase tracking-wider">거래처</label>
                <div className="relative">
                  <input
                    value={configClientSearch}
                    onChange={e => { setConfigClientSearch(e.target.value); setShowConfigClientDropdown(true); }}
                    onFocus={() => setShowConfigClientDropdown(true)}
                    placeholder="거래처 검색..."
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-400"
                  />
                  {configClientId && !showConfigClientDropdown && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black text-teal-600 bg-teal-50 px-2 py-0.5 rounded-full pointer-events-none">선택됨</span>
                  )}
                  {showConfigClientDropdown && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                      {clients
                        .filter(c => !configClientSearch.trim() || c.name.includes(configClientSearch))
                        .map(c => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => { openConfigModal(c.id); setConfigClientSearch(c.name); setShowConfigClientDropdown(false); }}
                            className={`w-full text-left px-3 py-2.5 text-sm hover:bg-teal-50 transition-colors ${configClientId === c.id ? 'bg-teal-50 font-black text-teal-700' : 'text-slate-700'}`}
                          >{c.name}</button>
                        ))}
                      {clients.filter(c => !configClientSearch.trim() || c.name.includes(configClientSearch)).length === 0 && (
                        <p className="px-3 py-3 text-sm text-slate-400 text-center">검색 결과 없음</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <input
                value={configSearch}
                onChange={e => setConfigSearch(e.target.value)}
                placeholder="품목 검색..."
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
              />
            </div>

            <div className="overflow-auto flex-1 px-4 py-3 space-y-1">
              {/* 부자재 */}
              {submaterials
                .filter(s => !configSearch || s.name.toLowerCase().includes(configSearch.toLowerCase()))
                .map(sub => {
                  const checked = configSelectedIds.includes(sub.id);
                  return (
                    <button
                      key={sub.id}
                      onClick={() => toggleConfigItem(sub.id)}
                      className={`w-full flex items-center justify-between px-3 py-3 rounded-xl text-left transition-all ${checked ? 'bg-teal-50 border border-teal-200' : 'hover:bg-slate-50'}`}
                    >
                      <div>
                        <p className="text-sm font-bold text-slate-700">{sub.name}</p>
                        <p className="text-xs text-slate-400">부자재 · 재고: {(sub.stock ?? 0).toLocaleString()} {sub.unit}</p>
                      </div>
                      {checked && <Check size={16} className="text-teal-600 shrink-0" />}
                    </button>
                  );
                })}
              {/* 상품 (향미유/고춧가루 등 완제품 제외, 부자재 섹션 중복 제거) */}
              {products
                .filter(p => {
                  const subIds = new Set(submaterials.map(s => s.id));
                  return p.category !== '완제품' &&
                    p.category !== 'product' &&
                    !subIds.has(p.id) &&
                    (!configSearch || p.name.toLowerCase().includes(configSearch.toLowerCase()));
                })
                .map(product => {
                  const checked = configSelectedIds.includes(product.id);
                  return (
                    <button
                      key={product.id}
                      onClick={() => toggleConfigItem(product.id)}
                      className={`w-full flex items-center justify-between px-3 py-3 rounded-xl text-left transition-all ${checked ? 'bg-blue-50 border border-blue-200' : 'hover:bg-slate-50'}`}
                    >
                      <div>
                        <p className="text-sm font-bold text-slate-700">{product.name}</p>
                        <p className="text-xs text-slate-400">{product.category} · 재고: {(product.stock ?? 0).toLocaleString()} {product.unit}</p>
                      </div>
                      {checked && <Check size={16} className="text-blue-600 shrink-0" />}
                    </button>
                  );
                })}
            </div>

            <div className="px-5 py-4 border-t border-slate-100 space-y-2">
              <p className="text-xs text-slate-400 text-center">{configSelectedIds.length}개 품목 선택됨</p>
              <button
                onClick={saveConfig}
                disabled={configSaving || !configClientId || configSelectedIds.length === 0}
                className="w-full flex items-center justify-center gap-2 py-3 bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white rounded-xl font-black text-sm transition-all"
              >
                {configSaving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 전표 발행 모달 ── */}
      {statementDraft && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end md:items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <p className="font-black text-slate-800">매입 전표 발행</p>
                <p className="text-xs text-slate-400 mt-0.5">{statementDraft.receipt.supplierName} · {statementDraft.receipt.registeredAt.slice(0, 10)} 선입고</p>
              </div>
              <button onClick={() => setStatementDraft(null)} className="p-2 text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>

            <div className="overflow-auto flex-1 px-5 py-4 space-y-4">
              {/* 거래처 선택 */}
              <div className="space-y-1.5">
                <label className="text-xs font-black text-slate-500 uppercase tracking-wider">거래처 (매입처) *</label>
                <select
                  value={statementDraft.clientId}
                  onChange={e => setStatementDraft(d => d ? { ...d, clientId: e.target.value } : null)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-rose-400"
                >
                  <option value="">거래처 선택</option>
                  {clients
                    .filter(c => c.partnerType === '매입처' || c.partnerType === '매출+매입처' || !c.partnerType)
                    .map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              {/* 거래일자 */}
              <div className="space-y-1.5">
                <label className="text-xs font-black text-slate-500 uppercase tracking-wider">거래일자 *</label>
                <input
                  type="date"
                  value={statementDraft.tradeDate}
                  onChange={e => setStatementDraft(d => d ? { ...d, tradeDate: e.target.value } : null)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
                />
              </div>

              {/* 품목 목록 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">품목</label>
                  <button
                    onClick={() => setStatementDraft(d => d ? { ...d, items: [...d.items, { name: '', qty: '', price: '', unit: '', isTaxExempt: false }] } : null)}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-rose-600 border border-rose-200 rounded-lg hover:bg-rose-50"
                  >
                    <Plus size={11} /> 품목 추가
                  </button>
                </div>

                <div className="grid grid-cols-12 gap-1 px-1 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                  <div className="col-span-4">품목명</div>
                  <div className="col-span-2 text-center">수량</div>
                  <div className="col-span-1 text-center">단위</div>
                  <div className="col-span-3 text-center">단가(원)</div>
                  <div className="col-span-1 text-center">면세</div>
                  <div className="col-span-1" />
                </div>

                {statementDraft.items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-1 items-center bg-slate-50 rounded-xl p-2">
                    <div className="col-span-4">
                      <input
                        value={item.name}
                        onChange={e => setStatementDraft(d => d ? { ...d, items: d.items.map((it, i) => i === idx ? { ...it, name: e.target.value } : it) } : null)}
                        placeholder="품목명"
                        className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-rose-400"
                      />
                    </div>
                    <div className="col-span-2">
                      <input
                        type="number" min={0}
                        value={item.qty}
                        onChange={e => setStatementDraft(d => d ? { ...d, items: d.items.map((it, i) => i === idx ? { ...it, qty: e.target.value } : it) } : null)}
                        placeholder="0"
                        className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs text-center focus:outline-none focus:ring-1 focus:ring-rose-400"
                      />
                    </div>
                    <div className="col-span-1">
                      <input
                        value={item.unit}
                        onChange={e => setStatementDraft(d => d ? { ...d, items: d.items.map((it, i) => i === idx ? { ...it, unit: e.target.value } : it) } : null)}
                        placeholder="개"
                        className="w-full px-1 py-1.5 border border-slate-200 rounded-lg text-xs text-center focus:outline-none focus:ring-1 focus:ring-rose-400"
                      />
                    </div>
                    <div className="col-span-3">
                      <input
                        type="number" min={0}
                        value={item.price}
                        onChange={e => setStatementDraft(d => d ? { ...d, items: d.items.map((it, i) => i === idx ? { ...it, price: e.target.value } : it) } : null)}
                        placeholder="0"
                        className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs text-right focus:outline-none focus:ring-1 focus:ring-rose-400"
                      />
                    </div>
                    <div className="col-span-1 flex justify-center">
                      <button
                        onClick={() => setStatementDraft(d => d ? { ...d, items: d.items.map((it, i) => i === idx ? { ...it, isTaxExempt: !it.isTaxExempt } : it) } : null)}
                        className={`px-1.5 py-1 rounded text-[10px] font-black transition-colors ${item.isTaxExempt ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-400'}`}
                      >
                        {item.isTaxExempt ? '면세' : '과세'}
                      </button>
                    </div>
                    <div className="col-span-1 flex justify-center">
                      <button onClick={() => setStatementDraft(d => d ? { ...d, items: d.items.filter((_, i) => i !== idx) } : null)} className="p-1 text-slate-300 hover:text-rose-500">
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* 합계 미리보기 */}
              {(() => {
                const supply = statementDraft.items.reduce((s, i) => s + Number(i.qty || 0) * Number(i.price || 0), 0);
                const tax = statementDraft.items.reduce((s, i) => {
                  const amt = Number(i.qty || 0) * Number(i.price || 0);
                  return s + (i.isTaxExempt ? 0 : Math.round(amt * 0.1));
                }, 0);
                return (
                  <div className="bg-rose-50 rounded-xl px-4 py-3 space-y-1">
                    <div className="flex justify-between text-xs text-slate-500">
                      <span>공급가액</span><span className="font-bold">{supply.toLocaleString()}원</span>
                    </div>
                    <div className="flex justify-between text-xs text-slate-500">
                      <span>세액</span><span className="font-bold">{tax.toLocaleString()}원</span>
                    </div>
                    <div className="flex justify-between text-sm font-black text-slate-800 border-t border-rose-200 pt-1 mt-1">
                      <span>합계</span><span>{(supply + tax).toLocaleString()}원</span>
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="px-5 py-4 border-t border-slate-100">
              <button
                onClick={saveStatement}
                disabled={statementSaving || !statementDraft.clientId}
                className="w-full flex items-center justify-center gap-2 py-3 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white rounded-xl font-black text-sm transition-all"
              >
                {statementSaving ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
                {statementSaving ? '발행 중...' : '전표 발행 (재고 반영 완료)'}
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
