
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
  Settings,
  Database,
  AlertTriangle,
  Download,
  Eye,
  Play,
  Package
} from 'lucide-react';
import { collection, getDocs, doc, updateDoc, addDoc } from 'firebase/firestore';
import { db } from '../src/firebase';
import { Client, Product } from '../types';

interface DatabaseViewProps {
  onSync: (data: { clients: Client[], products: Product[] }) => void;
}

type MigrationStatus = 'idle' | 'running' | 'done' | 'error';

interface ConsolidationPreviewItem {
  productId: string;
  productName: string;
  currentStock: number;
  displaySize: string;
  weightInKg: number;
  packageType: string;
  totalKg: number;
  labelId?: string;
  labelName?: string;
  containerTypeId?: string;
  containerName?: string;
  clients: Array<{ clientId: string; clientName: string; boxTypeId?: string; qtyPerBox?: number; price?: number }>;
  warning?: string;
}

interface MigrationResult {
  total: number;
  updated: number;
  skipped: number;
  errors: string[];
}

// 볶음참깨 통합 대상 필터
const isConsolidationTarget = (name: string) =>
  name.includes('볶음참깨') &&
  !name.includes('가루') &&
  !name.startsWith('참+') &&
  !name.startsWith('참2+') &&
  !name.startsWith('참기름+');

// 품목명에서 포장 규격 자동 감지
const detectSizeFromName = (name: string): { displaySize: string; weightInKg: number; packageType: string; warning?: string } => {
  if (name.includes('하남대') || name.includes('140g') || name.includes('140G'))
    return { displaySize: '140g', weightInKg: 0.14, packageType: '병' };
  if (name.includes('500g') || name.includes('500G'))
    return { displaySize: '500g', weightInKg: 0.5, packageType: '실링' };
  if (name.includes('400G') || name.includes('400g'))
    return { displaySize: '400g', weightInKg: 0.4, packageType: '박스' };
  if (name.includes('200G') || name.includes('200g'))
    return { displaySize: '200g', weightInKg: 0.2, packageType: '박스' };
  if (name.includes('벌크'))
    return { displaySize: '20kg', weightInKg: 20, packageType: '벌크' };
  if (name.includes('스마트'))
    return { displaySize: '1kg', weightInKg: 1.0, packageType: '박스' };
  // 낱개, /모란, /반석 등 → 기본 1kg
  return { displaySize: '1kg', weightInKg: 1.0, packageType: '박스' };
};

const DatabaseView: React.FC<DatabaseViewProps> = ({ onSync }) => {
  const [activeTab, setActiveTab] = useState<'migration' | 'sync' | 'script' | 'consolidate'>('migration');
  const [migrationStatus, setMigrationStatus] = useState<MigrationStatus>('idle');
  const [migrationResult, setMigrationResult] = useState<MigrationResult | null>(null);
  const [sheetId, setSheetId] = useState(localStorage.getItem('gsheet_id') || '');
  const [appsScriptUrl, setAppsScriptUrl] = useState(localStorage.getItem('apps_script_url') || '');
  const [syncStatus, setSyncStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  // 볶음참깨 통합 상태
  const [backupStatus, setBackupStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [backupCount, setBackupCount] = useState(0);
  const [previewStatus, setPreviewStatus] = useState<'idle' | 'loading' | 'done'>('idle');
  const [previewData, setPreviewData] = useState<ConsolidationPreviewItem[] | null>(null);
  const [execStatus, setExecStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [execLog, setExecLog] = useState<string[]>([]);

  const runMigration = async () => {
    if (migrationStatus === 'running') return;
    setMigrationStatus('running');
    setMigrationResult(null);

    const result: MigrationResult = { total: 0, updated: 0, skipped: 0, errors: [] };

    try {
      const snapshot = await getDocs(collection(db, 'products'));
      result.total = snapshot.size;

      for (const docSnap of snapshot.docs) {
        const data = docSnap.data() as Product;
        try {
          if (data.category === '완제품' && !data.itemType) {
            await updateDoc(doc(db, 'products', docSnap.id), {
              itemType: 'FINISHED',
              finishedStock: data.stock ?? 0,
            });
            result.updated++;
          } else {
            // 향미유, 고춧가루, 부자재 등은 모두 건드리지 않음
            result.skipped++;
          }
        } catch (e: any) {
          result.errors.push(`${data.name ?? docSnap.id}: ${e.message}`);
        }
      }

      setMigrationResult(result);
      setMigrationStatus('done');
    } catch (e: any) {
      result.errors.push(e.message);
      setMigrationResult(result);
      setMigrationStatus('error');
    }
  };

  // ── item_customer → partner_item 포장설정 마이그레이션 ──────────────────
  const [icMigStatus, setIcMigStatus] = useState<'idle'|'running'|'done'|'error'>('idle');
  const [icMigLog, setIcMigLog] = useState<string[]>([]);

  const migrateItemCustomerToPartnerItem = async () => {
    if (icMigStatus === 'running') return;
    setIcMigStatus('running');
    setIcMigLog(['시작...']);
    const log = (msg: string) => setIcMigLog(prev => [...prev, msg]);

    try {
      const { getDocs: gd, collection: col, writeBatch: wb, doc: d, setDoc: sd, getDoc: gdoc } = await import('firebase/firestore');

      // 1. item_customer 전체 읽기
      const icSnap = await gd(col(db, 'item_customer'));
      const ics = icSnap.docs.map(dd => ({ id: dd.id, ...dd.data() })) as any[];
      log(`item_customer: ${ics.length}건`);

      // 2. partner_item 전체 읽기 (Direction='out')
      const piSnap = await gd(col(db, 'partner_item'));
      const partnerItems = piSnap.docs.map(dd => ({ id: dd.id, ...dd.data() })) as any[];
      log(`partner_item: ${partnerItems.length}건`);

      const batch = wb(db);
      let updated = 0;
      let created = 0;

      for (const ic of ics) {
        const itemId = ic.item_id;
        const customerId = ic.customer_id;
        if (!itemId || !customerId) { log(`skip: item_id/customer_id 없음 (${ic.id})`); continue; }

        const packFields: Record<string, any> = {};
        if (ic.qty_per_box !== undefined)    packFields.qty_per_box     = ic.qty_per_box;
        if (ic.displaySize !== undefined)    packFields.displaySize     = ic.displaySize;
        if (ic.packageType !== undefined)    packFields.packageType     = ic.packageType;
        if (ic.containerTypeId !== undefined) packFields.containerTypeId = ic.containerTypeId;
        if (ic.labelId !== undefined)        packFields.labelId         = ic.labelId;
        if (ic.tapeTypeId !== undefined)     packFields.tapeTypeId      = ic.tapeTypeId;
        if (ic.weightInKg !== undefined)     packFields.weightInKg      = ic.weightInKg;
        if (ic.price !== undefined)          packFields.Standard_Price  = ic.price;

        // 기존 partner_item 찾기
        const existing = partnerItems.find(
          (pi: any) => pi.Item_ID === itemId && pi.Partner_ID === customerId && pi.Direction === 'out'
        );

        if (existing) {
          batch.update(d(db, 'partner_item', existing.id), packFields);
          updated++;
          log(`update: ${itemId} ↔ ${customerId}`);
        } else {
          const newId = `${itemId}_${customerId}_out`;
          batch.set(d(db, 'partner_item', newId), {
            id: newId, Item_ID: itemId, Partner_ID: customerId, Direction: 'out',
            item_id: itemId, customer_id: customerId,
            ...packFields,
          });
          created++;
          log(`create: ${itemId} ↔ ${customerId}`);
        }
      }

      await batch.commit();
      log(`완료 — 업데이트 ${updated}건, 신규 ${created}건`);
      setIcMigStatus('done');
    } catch (e: any) {
      log(`오류: ${e.message}`);
      setIcMigStatus('error');
    }
  };

  // ── items category 한국어 → 영문 마이그레이션 ────────────────────────────
  const [catMigStatus, setCatMigStatus] = useState<'idle'|'running'|'done'|'error'>('idle');
  const [catMigLog, setCatMigLog] = useState<string[]>([]);

  const migrateCategoryValues = async () => {
    if (catMigStatus === 'running') return;
    if (!window.confirm('items 컬렉션의 category 값을 영문으로 변환합니다. 계속하시겠습니까?')) return;
    setCatMigStatus('running');
    setCatMigLog(['시작...']);
    const log = (msg: string) => setCatMigLog(prev => [...prev, msg]);

    const MAP: Record<string, string> = {
      '완제품': 'product', '향미유': 'product', '고춧가루': 'product',
      '용기': 'container', '마개': 'cap', '테이프': 'tape', '박스': 'box', '라벨': 'label',
    };
    // 향미유/고춧가루는 subtype도 설정
    const SUBTYPE: Record<string, string> = { '향미유': '향미유', '고춧가루': '고춧가루' };

    try {
      const { getDocs: gd, collection: col, writeBatch: wb, doc: d } = await import('firebase/firestore');
      const snap = await gd(col(db, 'items'));
      log(`items 전체: ${snap.size}건`);

      const batch = wb(db);
      let updated = 0, skipped = 0;

      for (const docSnap of snap.docs) {
        const data = docSnap.data() as any;
        const oldCat = data.category as string;
        const newCat = MAP[oldCat];
        if (!newCat) { skipped++; continue; }

        const update: Record<string, any> = { category: newCat };
        if (SUBTYPE[oldCat]) update.subtype = SUBTYPE[oldCat];
        batch.update(d(db, 'items', docSnap.id), update);
        updated++;
        log(`[${docSnap.id}] ${oldCat} → ${newCat}${SUBTYPE[oldCat] ? ` (subtype: ${SUBTYPE[oldCat]})` : ''}`);
      }

      await batch.commit();
      log(`완료 — 변환 ${updated}건, 스킵 ${skipped}건`);
      setCatMigStatus('done');
    } catch (e: any) {
      log(`오류: ${e.message}`);
      setCatMigStatus('error');
    }
  };

  // ── item_bom → item_formula 컬렉션 이관 ─────────────────────────────────
  const [formulaMigStatus, setFormulaMigStatus] = useState<'idle'|'running'|'done'|'error'>('idle');
  const [formulaMigLog, setFormulaMigLog] = useState<string[]>([]);

  const migrateItemBomToFormula = async () => {
    if (formulaMigStatus === 'running') return;
    if (!window.confirm('item_bom 컬렉션 데이터를 item_formula로 이관합니다. 계속하시겠습니까?')) return;
    setFormulaMigStatus('running');
    setFormulaMigLog(['시작...']);
    const log = (msg: string) => setFormulaMigLog(prev => [...prev, msg]);

    try {
      const { getDocs: gd, collection: col, writeBatch: wb, doc: d } = await import('firebase/firestore');
      const srcSnap = await gd(col(db, 'item_bom'));
      log(`item_bom 전체: ${srcSnap.size}건`);

      const batch = wb(db);
      for (const docSnap of srcSnap.docs) {
        const data = docSnap.data();
        const newId = docSnap.id.replace(/^bom-/, 'formula-');
        batch.set(d(db, 'item_formula', newId), data);
        log(`[${newId}] parent_key: ${data.parent_key}`);
      }

      await batch.commit();
      log(`완료 — ${srcSnap.size}건 이관`);
      setFormulaMigStatus('done');
    } catch (e: any) {
      log(`오류: ${e.message}`);
      setFormulaMigStatus('error');
    }
  };

  // ── 볶음참깨 통합: 1단계 백업 ───────────────────────────────────────────
  const downloadBackup = async () => {
    setBackupStatus('running');
    try {
      const allProductsSnap = await getDocs(collection(db, 'products'));
      const allProducts = allProductsSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
      const targets = allProducts.filter(p => isConsolidationTarget(p.name || ''));

      const allPCSnap = await getDocs(collection(db, 'productClients'));
      const targetIds = new Set(targets.map(p => p.id));
      const relatedPCs = allPCSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter((pc: any) => targetIds.has(pc.productId));

      const backup = {
        timestamp: new Date().toISOString(),
        description: '볶음참깨 통합 마이그레이션 전 백업',
        products: targets,
        productClients: relatedPCs,
      };

      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `볶음참깨_백업_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setBackupCount(targets.length);
      setBackupStatus('done');
    } catch (e: any) {
      console.error(e);
      setBackupStatus('error');
    }
  };

  // ── 볶음참깨 통합: 2단계 미리보기 ──────────────────────────────────────
  const loadPreview = async () => {
    setPreviewStatus('loading');
    try {
      const allProductsSnap = await getDocs(collection(db, 'products'));
      const allProducts = allProductsSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
      const targets = allProducts.filter(p => isConsolidationTarget(p.name || '') && !p.archived);

      const allPCSnap = await getDocs(collection(db, 'productClients'));
      const allPCs = allPCSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

      const allClientsSnap = await getDocs(collection(db, 'clients'));
      const clientMap = new Map(allClientsSnap.docs.map(d => [d.id, (d.data() as any).name || d.id]));

      const items: ConsolidationPreviewItem[] = targets.map(p => {
        const sizeInfo = detectSizeFromName(p.name);
        const currentStock = p.finishedStock ?? p.stock ?? 0;
        const pcs = allPCs.filter(pc => pc.productId === p.id);
        const labelSub     = (p.submaterials || []).find((s: any) => s.category === '라벨');
        const containerSub = (p.submaterials || []).find((s: any) => s.category === '용기');

        return {
          productId: p.id,
          productName: p.name,
          currentStock,
          displaySize: sizeInfo.displaySize,
          weightInKg: sizeInfo.weightInKg,
          packageType: sizeInfo.packageType,
          totalKg: currentStock * sizeInfo.weightInKg,
          labelId: labelSub?.id,
          labelName: labelSub?.name,
          containerTypeId: containerSub?.id,
          containerName: containerSub?.name,
          clients: pcs.map(pc => ({
            clientId: pc.clientId,
            clientName: clientMap.get(pc.clientId) || pc.clientId,
            boxTypeId: pc.boxTypeId,
            qtyPerBox: pc.qtyPerBox,
            price: pc.price,
          })),
          warning: sizeInfo.warning,
        };
      });

      setPreviewData(items);
      setPreviewStatus('done');
    } catch (e: any) {
      console.error(e);
      setPreviewStatus('idle');
    }
  };

  // ── 볶음참깨 통합: 3단계 실행 ───────────────────────────────────────────
  const executeConsolidation = async () => {
    if (!previewData || previewData.length === 0) return;
    setExecStatus('running');
    const log: string[] = [];

    try {
      const totalKg = previewData.reduce((sum, item) => sum + item.totalKg, 0);
      log.push(`총 재고 합산: ${totalKg.toFixed(2)}kg`);

      // 투명 테이프 부자재 ID 조회
      const subSnap = await getDocs(collection(db, 'submaterials'));
      const allSubs = subSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
      const transparentTapeId = allSubs.find((s: any) => s.category === '테이프' && s.name?.includes('투명'))?.id ?? '';

      // 1. 통합 품목 생성
      const newProductRef = await addDoc(collection(db, 'products'), {
        name: '볶음참깨',
        품목: '시골향볶음참깨',
        category: '완제품',
        itemType: 'FINISHED',
        isRawMaterial: true,
        rawMaterialName: '볶음참깨',
        unit: 'kg',
        stock: 0,
        finishedStock: totalKg,
        minStock: 0,
        price: 0,
        image: '',
        createdAt: new Date().toISOString(),
      });
      log.push(`통합 품목 생성 완료 (ID: ${newProductRef.id})`);

      // 2. item_customer 레코드 생성
      let icCount = 0;
      for (const item of previewData) {
        for (const client of item.clients) {
          await addDoc(collection(db, 'item_customer'), {
            item_id: newProductRef.id,
            customer_id: client.clientId,
            displaySize: item.displaySize,
            weightInKg: item.weightInKg,
            packageType: item.packageType,
            qty_per_box: client.qtyPerBox ?? 1,
            box_type_id: client.boxTypeId ?? '',
            labelId: item.labelId ?? '',
            containerTypeId: item.containerTypeId ?? '',
            tapeTypeId: transparentTapeId,
            price: client.price ?? 0,
            isSmartStore: item.productName.includes('스마트'),
            createdAt: new Date().toISOString(),
            migratedFrom: item.productId,
          });
          icCount++;
        }
        // 거래처 없는 품목도 item_customer 1건 생성 (규격 정보 보존)
        if (item.clients.length === 0) {
          await addDoc(collection(db, 'item_customer'), {
            item_id: newProductRef.id,
            customer_id: '',
            displaySize: item.displaySize,
            weightInKg: item.weightInKg,
            packageType: item.packageType,
            qty_per_box: 1,
            box_type_id: '',
            labelId: item.labelId ?? '',
            containerTypeId: item.containerTypeId ?? '',
            tapeTypeId: transparentTapeId,
            price: 0,
            isSmartStore: item.productName.includes('스마트'),
            createdAt: new Date().toISOString(),
            migratedFrom: item.productId,
          });
          icCount++;
        }
      }
      log.push(`거래처 포장 설정 생성: ${icCount}건`);

      // 3. 새 품목에 productClients + clientIds 복사 (기존 주문 흐름 유지)
      const allClientIds = Array.from(new Set(previewData.flatMap(item => item.clients.map(c => c.clientId)).filter(Boolean)));
      for (const item of previewData) {
        for (const client of item.clients) {
          const pcId = `${newProductRef.id}_${client.clientId}`;
          await import('firebase/firestore').then(({ setDoc, doc: fDoc }) =>
            setDoc(fDoc(db, 'productClients', pcId), {
              productId: newProductRef.id,
              clientId: client.clientId,
              qtyPerBox: client.qtyPerBox ?? 1,
              boxTypeId: client.boxTypeId ?? '',
              price: client.price ?? 0,
            }, { merge: true })
          );
        }
      }
      await updateDoc(doc(db, 'products', newProductRef.id), { clientIds: allClientIds });
      log.push(`거래처 연결 복사: ${allClientIds.length}개 거래처`);

      // 4. 구 품목 아카이브 (삭제하지 않고 숨김 처리)
      for (const item of previewData) {
        await updateDoc(doc(db, 'products', item.productId), {
          archived: true,
          archivedAt: new Date().toISOString(),
          archivedReason: `볶음참깨 통합 → ${newProductRef.id}`,
        });
      }
      log.push(`구 품목 아카이브 처리: ${previewData.length}건 (삭제 아님, 백업 JSON으로 복구 가능)`);

      setExecLog(log);
      setExecStatus('done');
    } catch (e: any) {
      log.push(`오류: ${e.message}`);
      setExecLog(log);
      setExecStatus('error');
    }
  };

  // ── 거래처 연결 복구 (이미 실행된 통합 품목용) ─────────────────────────
  const repairClientLinks = async () => {
    try {
      const allProductsSnap = await getDocs(collection(db, 'products'));
      const allProducts = allProductsSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

      // 통합된 새 품목
      const target = allProducts.find((p: any) => p.name === '볶음참깨' && p.isRawMaterial && !p.archived);
      if (!target) { alert('통합된 볶음참깨 품목을 찾을 수 없습니다.'); return; }

      // 아카이브된 구 품목들
      const archivedProducts = allProducts.filter((p: any) =>
        p.archived && (p.archivedReason ?? '').includes(target.id)
      );

      // 1. 구 품목 clientIds 전부 수집
      const fromClientIds = new Set<string>(
        archivedProducts.flatMap((p: any) => p.clientIds ?? [])
      );

      // 2. item_customer에서 거래처 + 포장 설정 수집
      const icSnap = await getDocs(collection(db, 'item_customer'));
      const ics = icSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
      const linkedIcs = ics.filter((ic: any) => ic.item_id === target.id && ic.customer_id);
      const icClientIds = new Set(linkedIcs.map((ic: any) => ic.customer_id));

      // 3. 합산 (포장 설정 있는 것 + clientIds에만 있던 것)
      const allClientIds = Array.from(new Set([...fromClientIds, ...icClientIds])).filter(Boolean);

      const { setDoc, doc: fDoc } = await import('firebase/firestore');

      // 포장 설정 있는 거래처 → productClients (설정 포함)
      for (const ic of linkedIcs) {
        const pcId = `${target.id}_${ic.customer_id}`;
        await setDoc(fDoc(db, 'productClients', pcId), {
          productId: target.id,
          clientId: ic.customer_id,
          qtyPerBox: ic.qty_per_box ?? 1,
          boxTypeId: ic.box_type_id ?? '',
          price: ic.price ?? 0,
        }, { merge: true });
      }

      // clientIds에만 있던 거래처 → productClients (기본값으로 생성)
      for (const clientId of fromClientIds) {
        if (!icClientIds.has(clientId)) {
          const pcId = `${target.id}_${clientId}`;
          await setDoc(fDoc(db, 'productClients', pcId), {
            productId: target.id,
            clientId,
          }, { merge: true });
        }
      }

      // clientIds + 품목 필드 업데이트 (생산판매기록부 연동용)
      await updateDoc(doc(db, 'products', target.id), {
        clientIds: allClientIds,
        품목: '시골향볶음참깨',
      });

      alert(`거래처 연결 복구 완료!\n${allClientIds.length}개 거래처 연결 (포장설정 ${linkedIcs.length}개 + 연결만 ${fromClientIds.size - linkedIcs.filter((ic:any) => fromClientIds.has(ic.customer_id)).length}개)\n앱을 새로고침하세요.`);
    } catch (e: any) {
      alert(`복구 실패: ${e.message}`);
    }
  };

  // ── 용기/라벨/테이프 데이터 복구 (기존 item_customer에 containerTypeId, labelId, tapeTypeId 채우기) ──
  const repairContainerData = async () => {
    try {
      const allProductsSnap = await getDocs(collection(db, 'products'));
      const allProducts = allProductsSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

      const archivedMap = new Map<string, any>(
        allProducts.filter((p: any) => p.archived).map((p: any) => [p.id, p])
      );

      // 투명 테이프 부자재 찾기
      const subSnap = await getDocs(collection(db, 'submaterials'));
      const allSubs = subSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
      const transparentTape = allSubs.find((s: any) => s.category === '테이프' && s.name?.includes('투명'));

      const icSnap = await getDocs(collection(db, 'item_customer'));
      const ics = icSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

      const { updateDoc, doc: fDoc } = await import('firebase/firestore');
      let updated = 0;

      for (const ic of ics) {
        const patch: Record<string, string> = {};

        if (ic.migratedFrom) {
          const archived = archivedMap.get(ic.migratedFrom);
          if (archived) {
            const containerSub = (archived.submaterials || []).find((s: any) => s.category === '용기');
            const labelSub     = (archived.submaterials || []).find((s: any) => s.category === '라벨');
            if (containerSub?.id && !ic.containerTypeId) patch.containerTypeId = containerSub.id;
            if (labelSub?.id && !ic.labelId)             patch.labelId = labelSub.id;
          }
        }

        // 모든 item_customer 레코드에 투명 테이프 적용
        if (transparentTape?.id && !ic.tapeTypeId) patch.tapeTypeId = transparentTape.id;

        if (Object.keys(patch).length > 0) {
          await updateDoc(fDoc(db, 'item_customer', ic.id), patch);
          updated++;
        }
      }

      alert(`용기/라벨/테이프 복구 완료: ${updated}건 업데이트\n앱을 새로고침하세요.`);
    } catch (e: any) {
      alert(`복구 실패: ${e.message}`);
    }
  };

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
           <button onClick={() => setActiveTab('migration')} className={`px-5 py-2.5 rounded-xl text-xs font-black transition-all flex items-center space-x-2 ${activeTab === 'migration' ? 'bg-white text-violet-600 shadow-sm' : 'text-slate-500'}`}><Database size={14} /><span>DB 마이그레이션</span></button>
           <button onClick={() => setActiveTab('sync')} className={`px-5 py-2.5 rounded-xl text-xs font-black transition-all flex items-center space-x-2 ${activeTab === 'sync' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}><RefreshCw size={14} /><span>동기화 제어</span></button>
           <button onClick={() => setActiveTab('script')} className={`px-5 py-2.5 rounded-xl text-xs font-black transition-all flex items-center space-x-2 ${activeTab === 'script' ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-500'}`}><Terminal size={14} /><span>스크립트 설정</span></button>
           <button onClick={() => setActiveTab('consolidate')} className={`px-5 py-2.5 rounded-xl text-xs font-black transition-all flex items-center space-x-2 ${activeTab === 'consolidate' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500'}`}><Package size={14} /><span>품목 통합</span></button>
        </div>
      </div>

      <div className="flex-1 bg-white rounded-[40px] border border-slate-100 shadow-sm overflow-hidden flex flex-col min-h-0">
        {activeTab === 'migration' ? (
          <div className="flex-1 overflow-y-auto custom-scrollbar p-8 space-y-6">
            <div className="bg-violet-50 border border-violet-100 p-6 rounded-3xl space-y-3">
              <div className="flex items-center gap-3">
                <Database size={20} className="text-violet-600" />
                <h4 className="text-sm font-black text-violet-900">품목 구조 마이그레이션</h4>
              </div>
              <p className="text-xs text-violet-700 font-medium leading-relaxed">
                Firebase <code className="bg-violet-100 px-1 rounded">products</code> 컬렉션의 기존 품목에 새 필드를 추가합니다.<br />
                <b>완제품</b> → <code className="bg-violet-100 px-1 rounded">itemType: FINISHED</code> + <code className="bg-violet-100 px-1 rounded">finishedStock</code> 추가<br />
                향미유·고춧가루·부자재 등 나머지 품목은 <b>변경 없이 그대로 유지</b>됩니다.<br />
                이미 <code className="bg-violet-100 px-1 rounded">itemType</code>이 있는 항목은 건너뜁니다. <b>productClients(거래처-제품 매핑)는 절대 변경하지 않습니다.</b>
              </p>
            </div>

            {migrationStatus === 'idle' && (
              <button
                onClick={runMigration}
                className="w-full py-4 bg-violet-600 hover:bg-violet-700 text-white font-black rounded-2xl transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                <Database size={18} /> 마이그레이션 실행
              </button>
            )}

            {migrationStatus === 'running' && (
              <div className="flex items-center justify-center gap-3 py-8 text-violet-600 font-black">
                <RefreshCw size={20} className="animate-spin" /> Firebase 업데이트 중...
              </div>
            )}

            {migrationResult && migrationStatus === 'done' && (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-slate-50 rounded-2xl p-4 text-center">
                    <p className="text-2xl font-black text-slate-800">{migrationResult.total}</p>
                    <p className="text-xs text-slate-400 font-bold mt-1">전체 품목</p>
                  </div>
                  <div className="bg-emerald-50 rounded-2xl p-4 text-center">
                    <p className="text-2xl font-black text-emerald-700">{migrationResult.updated}</p>
                    <p className="text-xs text-emerald-500 font-bold mt-1">업데이트 완료</p>
                  </div>
                  <div className="bg-slate-50 rounded-2xl p-4 text-center">
                    <p className="text-2xl font-black text-slate-500">{migrationResult.skipped}</p>
                    <p className="text-xs text-slate-400 font-bold mt-1">건너뜀 (기존 유지)</p>
                  </div>
                </div>
                {migrationResult.errors.length > 0 && (
                  <div className="bg-rose-50 border border-rose-100 p-4 rounded-2xl space-y-1">
                    <div className="flex items-center gap-2 text-rose-700 font-black text-sm"><AlertTriangle size={14} /> 오류 발생 항목</div>
                    {migrationResult.errors.map((e, i) => (
                      <p key={i} className="text-xs text-rose-600 font-medium pl-4">{e}</p>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2 text-emerald-600 font-black text-sm">
                  <CheckCircle2 size={16} /> 마이그레이션 완료 — productClients는 변경 없이 보존됨
                </div>
                <button
                  onClick={() => { setMigrationStatus('idle'); setMigrationResult(null); }}
                  className="text-xs text-slate-400 hover:text-slate-600 font-bold underline"
                >
                  다시 실행
                </button>
              </div>
            )}

            {migrationStatus === 'error' && (
              <div className="bg-rose-50 border border-rose-100 p-4 rounded-2xl">
                <div className="flex items-center gap-2 text-rose-700 font-black text-sm mb-2"><AlertTriangle size={14} /> 마이그레이션 실패</div>
                {migrationResult?.errors.map((e, i) => (
                  <p key={i} className="text-xs text-rose-600 font-medium">{e}</p>
                ))}
                <button
                  onClick={() => { setMigrationStatus('idle'); setMigrationResult(null); }}
                  className="mt-3 text-xs text-slate-400 hover:text-slate-600 font-bold underline"
                >
                  다시 시도
                </button>
              </div>
            )}

            {/* ── item_customer → partner_item 포장설정 마이그레이션 ── */}
            <div className="border-t border-slate-100 pt-6">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-black text-slate-700">포장설정 마이그레이션</p>
                  <p className="text-xs text-slate-400 mt-0.5">item_customer의 포장 데이터(qty_per_box, displaySize, 용기/라벨/테이프 등)를 partner_item으로 복사합니다.</p>
                </div>
                <button
                  onClick={migrateItemCustomerToPartnerItem}
                  disabled={icMigStatus === 'running'}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 text-white text-xs font-black hover:bg-amber-700 disabled:opacity-50 transition-all"
                >
                  {icMigStatus === 'running' ? '실행 중...' : '실행'}
                </button>
              </div>
              {icMigLog.length > 0 && (
                <div className="bg-slate-900 rounded-xl p-3 max-h-40 overflow-y-auto">
                  {icMigLog.map((line, i) => (
                    <p key={i} className={`text-[11px] font-mono ${icMigStatus === 'error' && i === icMigLog.length - 1 ? 'text-rose-400' : icMigStatus === 'done' && i === icMigLog.length - 1 ? 'text-emerald-400' : 'text-slate-300'}`}>{line}</p>
                  ))}
                </div>
              )}
            </div>

            {/* ── category 한국어 → 영문 마이그레이션 ── */}
            <div className="border-t border-slate-100 pt-6">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-black text-slate-700">품목 category 영문화</p>
                  <p className="text-xs text-slate-400 mt-0.5">완제품→product, 향미유/고춧가루→product(+subtype), 용기→container, 마개→cap, 테이프→tape, 박스→box, 라벨→label</p>
                </div>
                <button
                  onClick={migrateCategoryValues}
                  disabled={catMigStatus === 'running' || catMigStatus === 'done'}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 text-white text-xs font-black hover:bg-violet-700 disabled:opacity-50 transition-all"
                >
                  {catMigStatus === 'running' ? '실행 중...' : catMigStatus === 'done' ? '완료' : '실행'}
                </button>
              </div>
              {catMigLog.length > 0 && (
                <div className="bg-slate-900 rounded-xl p-3 max-h-40 overflow-y-auto">
                  {catMigLog.map((line, i) => (
                    <p key={i} className={`text-[11px] font-mono ${catMigStatus === 'error' && i === catMigLog.length - 1 ? 'text-rose-400' : catMigStatus === 'done' && i === catMigLog.length - 1 ? 'text-emerald-400' : 'text-slate-300'}`}>{line}</p>
                  ))}
                </div>
              )}
            </div>

            {/* ── item_bom → item_formula 이관 ── */}
            <div className="border-t border-slate-100 pt-6">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-black text-slate-700">item_bom → item_formula 이관</p>
                  <p className="text-xs text-slate-400 mt-0.5">기존 원료 배합비 컬렉션(item_bom)을 item_formula로 복사합니다</p>
                </div>
                <button
                  onClick={migrateItemBomToFormula}
                  disabled={formulaMigStatus === 'running' || formulaMigStatus === 'done'}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 text-white text-xs font-black hover:bg-amber-700 disabled:opacity-50 transition-all"
                >
                  {formulaMigStatus === 'running' ? '실행 중...' : formulaMigStatus === 'done' ? '완료' : '실행'}
                </button>
              </div>
              {formulaMigLog.length > 0 && (
                <div className="bg-slate-900 rounded-xl p-3 max-h-40 overflow-y-auto">
                  {formulaMigLog.map((line, i) => (
                    <p key={i} className={`text-[11px] font-mono ${formulaMigStatus === 'error' && i === formulaMigLog.length - 1 ? 'text-rose-400' : formulaMigStatus === 'done' && i === formulaMigLog.length - 1 ? 'text-emerald-400' : 'text-slate-300'}`}>{line}</p>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : activeTab === 'sync' ? (
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
        ) : activeTab === 'consolidate' ? (
          <div className="flex-1 overflow-y-auto custom-scrollbar p-8 space-y-6">
            {/* 긴급 복구 */}
            <div className="bg-rose-50 border border-rose-200 p-5 rounded-3xl flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-black text-rose-800">거래처 연결 복구</p>
                <p className="text-xs text-rose-600 font-medium mt-0.5">이미 통합을 실행했는데 거래처 연결이 빠졌을 때 사용하세요.</p>
              </div>
              <button
                onClick={repairClientLinks}
                className="shrink-0 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-black rounded-xl text-xs transition-all active:scale-95"
              >
                지금 복구
              </button>
            </div>

            {/* 용기/라벨 데이터 복구 */}
            <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-2xl p-4 gap-4">
              <div>
                <p className="text-sm font-black text-amber-800">용기/라벨 데이터 복구</p>
                <p className="text-xs text-amber-600 font-medium mt-0.5">거래처별 포장 설정에 용기·라벨 정보가 없을 때 아카이브에서 자동 복원합니다.</p>
              </div>
              <button
                onClick={repairContainerData}
                className="shrink-0 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-black rounded-xl text-xs transition-all active:scale-95"
              >
                지금 복구
              </button>
            </div>

            {/* 안내 */}
            <div className="bg-emerald-50 border border-emerald-100 p-6 rounded-3xl space-y-2">
              <div className="flex items-center gap-3">
                <Package size={20} className="text-emerald-600" />
                <h4 className="text-sm font-black text-emerald-900">볶음참깨 품목 통합 (1단계)</h4>
              </div>
              <p className="text-xs text-emerald-700 font-medium leading-relaxed">
                분산된 볶음참깨 품목들을 하나로 통합하고 거래처별 포장 설정을 <code className="bg-emerald-100 px-1 rounded">item_customer</code>로 이동합니다.<br />
                <b>순서: ① 백업 다운로드 → ② 미리보기 확인 → ③ 통합 실행</b>
              </p>
            </div>

            {/* 1단계: 백업 */}
            <div className="border border-slate-200 rounded-3xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-black text-slate-800">① 백업 다운로드</p>
                  <p className="text-xs text-slate-400 font-medium mt-0.5">통합 대상 품목과 거래처 설정을 JSON으로 저장합니다.</p>
                </div>
                {backupStatus === 'done' && (
                  <span className="flex items-center gap-1 text-xs text-emerald-600 font-black"><CheckCircle2 size={14} /> {backupCount}개 품목 백업 완료</span>
                )}
              </div>
              <button
                onClick={downloadBackup}
                disabled={backupStatus === 'running'}
                className="w-full py-3 bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white font-black rounded-2xl transition-all active:scale-95 flex items-center justify-center gap-2 text-sm"
              >
                {backupStatus === 'running' ? <RefreshCw size={16} className="animate-spin" /> : <Download size={16} />}
                {backupStatus === 'running' ? '백업 중...' : backupStatus === 'done' ? '다시 다운로드' : '백업 JSON 다운로드'}
              </button>
              {backupStatus === 'error' && <p className="text-xs text-rose-500 font-bold">백업 실패 — 콘솔 확인</p>}
            </div>

            {/* 2단계: 미리보기 */}
            <div className="border border-slate-200 rounded-3xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-black text-slate-800">② 통합 미리보기</p>
                  <p className="text-xs text-slate-400 font-medium mt-0.5">감지된 품목과 자동 분류된 포장 규격을 확인하세요.</p>
                </div>
                <button
                  onClick={loadPreview}
                  disabled={previewStatus === 'loading'}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black rounded-xl text-xs flex items-center gap-1.5 transition-all"
                >
                  {previewStatus === 'loading' ? <RefreshCw size={12} className="animate-spin" /> : <Eye size={12} />}
                  {previewStatus === 'loading' ? '조회 중...' : '미리보기'}
                </button>
              </div>

              {previewData && previewData.length > 0 && (
                <div className="space-y-3">
                  {/* 경고 항목 */}
                  {previewData.some(i => i.warning) && (
                    <div className="bg-amber-50 border border-amber-100 p-3 rounded-2xl space-y-1">
                      <div className="flex items-center gap-1.5 text-amber-700 font-black text-xs"><AlertTriangle size={12} /> 확인 필요 항목</div>
                      {previewData.filter(i => i.warning).map(i => (
                        <p key={i.productId} className="text-xs text-amber-600 font-medium pl-4">
                          {i.productName}: {i.warning}
                        </p>
                      ))}
                    </div>
                  )}

                  {/* 미리보기 테이블 */}
                  <div className="overflow-x-auto rounded-2xl border border-slate-100">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="text-left px-4 py-3 font-black text-slate-500">품목명</th>
                          <th className="text-right px-4 py-3 font-black text-slate-500">현재재고</th>
                          <th className="text-center px-4 py-3 font-black text-slate-500">용량</th>
                          <th className="text-center px-4 py-3 font-black text-slate-500">포장</th>
                          <th className="text-right px-4 py-3 font-black text-slate-500">환산(kg)</th>
                          <th className="text-left px-4 py-3 font-black text-slate-500">라벨</th>
                          <th className="text-left px-4 py-3 font-black text-slate-500">거래처</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewData.map(item => (
                          <tr key={item.productId} className={`border-t border-slate-100 ${item.warning ? 'bg-amber-50/50' : ''}`}>
                            <td className="px-4 py-3 font-bold text-slate-700">{item.productName}</td>
                            <td className="px-4 py-3 text-right text-slate-500">{item.currentStock}</td>
                            <td className="px-4 py-3 text-center font-black text-emerald-700">{item.displaySize}</td>
                            <td className="px-4 py-3 text-center text-slate-500">{item.packageType}</td>
                            <td className="px-4 py-3 text-right font-bold text-slate-700">{item.totalKg.toFixed(2)}</td>
                            <td className="px-4 py-3 text-slate-400">{item.labelName || '무라벨'}</td>
                            <td className="px-4 py-3 text-slate-500">
                              {item.clients.length > 0
                                ? item.clients.map(c => c.clientName).join(', ')
                                : <span className="text-slate-300">없음</span>}
                            </td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-emerald-200 bg-emerald-50">
                          <td className="px-4 py-3 font-black text-emerald-800" colSpan={4}>합계 (통합 품목 초기 재고)</td>
                          <td className="px-4 py-3 text-right font-black text-emerald-800">
                            {previewData.reduce((s, i) => s + i.totalKg, 0).toFixed(2)} kg
                          </td>
                          <td colSpan={2} />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* 3단계: 실행 */}
            <div className="border border-slate-200 rounded-3xl p-6 space-y-4">
              <div>
                <p className="text-sm font-black text-slate-800">③ 통합 실행</p>
                <p className="text-xs text-slate-400 font-medium mt-0.5">
                  백업 완료 + 미리보기 확인 후 실행하세요. 구 품목은 삭제되지 않고 아카이브 처리됩니다.
                </p>
              </div>

              {execStatus === 'idle' && (
                <button
                  onClick={executeConsolidation}
                  disabled={backupStatus !== 'done' || !previewData || previewData.length === 0}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black rounded-2xl transition-all active:scale-95 flex items-center justify-center gap-2 text-sm"
                >
                  <Play size={16} /> 볶음참깨 통합 실행
                </button>
              )}
              {backupStatus !== 'done' && execStatus === 'idle' && (
                <p className="text-xs text-amber-600 font-bold text-center">① 백업을 먼저 완료해야 실행 버튼이 활성화됩니다.</p>
              )}

              {execStatus === 'running' && (
                <div className="flex items-center justify-center gap-3 py-6 text-emerald-600 font-black text-sm">
                  <RefreshCw size={18} className="animate-spin" /> Firestore 업데이트 중...
                </div>
              )}

              {(execStatus === 'done' || execStatus === 'error') && execLog.length > 0 && (
                <div className={`p-4 rounded-2xl space-y-1.5 ${execStatus === 'done' ? 'bg-emerald-50 border border-emerald-100' : 'bg-rose-50 border border-rose-100'}`}>
                  <div className={`flex items-center gap-2 font-black text-sm ${execStatus === 'done' ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {execStatus === 'done' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                    {execStatus === 'done' ? '통합 완료' : '오류 발생'}
                  </div>
                  {execLog.map((line, i) => (
                    <p key={i} className={`text-xs font-medium pl-5 ${execStatus === 'done' ? 'text-emerald-600' : 'text-rose-600'}`}>{line}</p>
                  ))}
                  {execStatus === 'done' && (
                    <p className="text-xs text-slate-400 font-medium pl-5 pt-1">
                      ※ 품목 목록에서 아카이브된 구 품목이 보이면 새로고침하세요.
                    </p>
                  )}
                </div>
              )}
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
        ) }
      </div>
    </div>
  );
};

export default DatabaseView;
