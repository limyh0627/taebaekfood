import {normalizeOemFeeTermsV2, buildOemFeeSnapshotV2, buildOemFeePlanV2, type OemFeeRateV2, type OemFeeTermsRowV2} from '../../../shared/oemFeePlan';
import type {OemReceiptTermsV2} from '../../../shared/partnerEditCommand';
import { useEffect, useRef, useState, type SetStateAction } from 'react';
import { captureOemCostEvidence } from '../../admin/oemCostEvidence';
import { today } from '../../../shared/day';
import type { Item, PurchaseOrder, CompanyId } from '../../../shared/types';
import { sentKg, batchLoss, processingFee } from '../../admin/oem';
import { itemKg, OEM_DEFAULT_FEE_PER_KG } from '../../admin/oemEngine';
import {orderStockUnitInputs, type OrderUnitInputs} from '../../../shared/orderUnits';
import type { ReceiveInput } from '../domain/oemManager';
export interface OemReceiptDraftOptions {
    companyId: CompanyId;
    actorUid?: string;
    preset?: OemReceiptTermsV2;
    po: PurchaseOrder;
    oemItems: Item[];
    busy: boolean;
    pendingReceipt: ReceiveInput | null;
    pendingError?: string;
    orderUnitInputs?: OrderUnitInputs;
}
type Draft = {
    date: string;
    terms: Record<string, OemFeeTermsRowV2 | undefined>;
    termsConfirmed: boolean;
    nonDuplicatePackagingConfirmed: boolean;
    bulkTaxExempt: boolean;
    rawAmounts: string[];
    packagingSupply: string;
    packagingConfirmed: boolean;
    fee: string;
    rows: {
        itemId: string;
        qty: string;
    }[];
    bulkRows: {
        material: string;
        kg: string;
    }[];
};
/** 작성 상태와 payload 계산을 함께 보관하며 처리 중 입력은 최초 값으로 고정한다. */
export function useOemReceiptDraft(options: OemReceiptDraftOptions) {
    const { companyId, actorUid, preset, po, oemItems, busy, pendingReceipt, pendingError, orderUnitInputs } = options;
    const [, paint] = useState(0), latest = useRef(options);
    latest.current = options;
    const owner = useRef({ companyId, actorUid, poId: po.id, values: {} as Draft, capturedAt: new Date().toISOString() });
    if (owner.current.companyId !== companyId || owner.current.actorUid !== actorUid || owner.current.poId !== po.id)
        owner.current = { companyId, actorUid, poId: po.id, values: {} as Draft, capturedAt: new Date().toISOString() };
    const state = owner.current;
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const current = () => mounted.current && owner.current === state && latest.current.companyId === companyId && latest.current.actorUid === actorUid && latest.current.po.id === po.id;
    function field<K extends keyof Draft>(key: K, initial: () => Draft[K]): [
        Draft[K],
        (value: SetStateAction<Draft[K]>) => void
    ] {
        if (!Object.prototype.hasOwnProperty.call(state.values, key))
            state.values[key] = initial();
        return [state.values[key], value => { if (!current() || latest.current.busy)
                return; state.values[key] = typeof value === 'function' ? (value as (old: Draft[K]) => Draft[K])(state.values[key]) : value; paint(n => n + 1); }];
    }
    const [date, setDate] = field('date', () => today());
    const [rawAmounts, setRawAmounts] = field('rawAmounts', () => (po.oemSent ?? []).map(() => ''));
    const [packagingSupplyRaw, setPackagingSupplyRaw] = field('packagingSupply', () => '');
    const packagingSupply = packagingSupplyRaw;
    const [packagingConfirmedRaw, setPackagingConfirmedRaw] = field('packagingConfirmed', () => false);
    const packagingConfirmed = packagingConfirmedRaw;
    const capturedAt = { current: state.capturedAt };
    const sentRows = po.oemSent ?? [];
    const canCaptureEvidence = !po.oemCostEvidence && sentRows.length > 0 && sentRows.every(row => !!row.rawItemId && Number.isFinite(row.kg) && row.kg > 0);
    const receiptCost: ReturnType<typeof captureOemCostEvidence> = canCaptureEvidence ? captureOemCostEvidence(companyId, sentRows.map((row, i) => ({ rawItemId: row.rawItemId, kg: row.kg, supplyAmount: rawAmounts[i] ?? '' })), packagingSupply, packagingConfirmed, capturedAt.current) : { status: 'empty' as const };
    const [feeRaw, setFeeRaw] = field('fee', () => String(po.oemFeePerKg ?? OEM_DEFAULT_FEE_PER_KG));
    const fee = feeRaw;
    // 실제 돌아온 품목만 선택하며 빈 행은 저장하지 않는다.
    const [rowsRaw, setRowsRaw] = field('rows', () => [{ itemId: '', qty: '' }]);
    const rows = rowsRaw;
    const [terms, setTerms] = field('terms', () => Object.fromEntries(rows.map(row => [row.itemId, preset?.rows.find(term => term.itemId === row.itemId)])));
    const [termsConfirmed, setTermsConfirmed] = field('termsConfirmed', () => false);
    const [nonDuplicatePackagingConfirmed, setNonDuplicatePackagingConfirmed] = field('nonDuplicatePackagingConfirmed', () => false);
    const [bulkTaxExemptRaw, setBulkTaxExemptRaw] = field('bulkTaxExempt', () => false);
    const bulkTaxExempt = bulkTaxExemptRaw;
    const setPackagingSupply=(value:SetStateAction<string>)=>{setPackagingSupplyRaw(value);setNonDuplicatePackagingConfirmed(false);};
    const setPackagingConfirmed=(value:SetStateAction<boolean>)=>{setPackagingConfirmedRaw(value);setNonDuplicatePackagingConfirmed(false);};
    const setRows = (update: SetStateAction<Draft['rows']>) => {
        const next = typeof update === 'function' ? update(rows) : update;
        if (!current() || latest.current.busy) return;
        const added = next.filter(row => row.itemId && !rows.some(old => old.itemId === row.itemId));
        if (added.length) setTerms(old => { const copy = {...old}; for (const row of added) if (!Object.prototype.hasOwnProperty.call(copy,row.itemId)) copy[row.itemId] = latest.current.preset?.rows.find(term => term.itemId === row.itemId); return copy; });
        setTermsConfirmed(false); setNonDuplicatePackagingConfirmed(false); setRowsRaw(next);
    };
    const setRate = (itemId:string, key:'processing'|'vendorPackaging', rate:OemFeeRateV2) => { setTerms(old => old[itemId] ? ({...old, [itemId]: {...old[itemId]!, [key]:rate}}) : old); setTermsConfirmed(false); setNonDuplicatePackagingConfirmed(false); };
    // 벌크(포장 안 하고 온 몫) — kg으로 받아 원료 로트에 그대로 쌓는다. 소분 품목이 여기서 빼간다.
    const [bulkRowsRaw, setBulkRowsRaw] = field('bulkRows', () => [{ material: '', kg: '' }]);
    const bulkRows = bulkRowsRaw;
    // 확인 후 벌크 원문이 바뀌면 같은 확인으로 송신하지 않는다.
    const setBulkRows=(value:SetStateAction<Draft['bulkRows']>)=>{if(!current() || latest.current.busy)return;setBulkRowsRaw(value);setTermsConfirmed(false);};
    const setFee=(value:SetStateAction<string>)=>{if(!current() || latest.current.busy)return;setFeeRaw(value);setTermsConfirmed(false);};
    const setBulkTaxExempt=(value:SetStateAction<boolean>)=>{if(!current() || latest.current.busy)return;setBulkTaxExemptRaw(value);setTermsConfirmed(false);};
    const returns = rows.filter(r => r.itemId && Number(r.qty) > 0).map(r => ({ itemId: r.itemId, qty: Number(r.qty) }));
    const bulk = bulkRows.filter(b => b.material && Number(b.kg) > 0).map(b => ({ material: b.material, kg: Number(b.kg) }));
    const packedKg = returns.reduce((a, r) => {
        const it = oemItems.find(i => i.id === r.itemId);
        return a + (it ? itemKg(it, orderUnitInputs) * r.qty : 0);
    }, 0);
    const bulkKg = bulk.reduce((a, b) => a + b.kg, 0);
    const receivedKg = packedKg + bulkKg;
    const s = sentKg(po.oemSent);
    const loss = batchLoss(po.oemSent, receivedKg);
    const money = processingFee(receivedKg, Number(fee) || 0);
    const partnerId = po.oemPartnerId ?? po.partnerId ?? '';
    const selectedTerms = returns.map(row => terms[row.itemId]);
    const duplicateItems = new Set(returns.map(row=>row.itemId)).size !== returns.length;
    const evidence = po.oemCostEvidence ?? receiptCost.evidence;
    const needsPackagingConfirmation = (evidence?.packaging?.supplyAmount ?? 0) > 0 && selectedTerms.some(row => (row?.vendorPackaging.grossUnitPrice ?? 0) > 0);
    let feeTermsV2: ReturnType<typeof normalizeOemFeeTermsV2> | undefined, previewPlan: ReturnType<typeof buildOemFeePlanV2> | undefined, termsError = '';
    try {
      if (duplicateItems) throw Error('같은 품목은 한 행에 합쳐 입력해 주세요.');
      if (selectedTerms.some(row => !row)) throw Error('선택한 품목의 가공비와 업체부자재 조건을 거래처 조건에서 설정해 주세요.');
      if (bulk.length && (!fee.trim() || !Number.isFinite(Number(fee)))) throw Error('벌크 가공단가를 입력해 주세요.');
      feeTermsV2 = normalizeOemFeeTermsV2({version:2,companyId,partnerId,rows:selectedTerms,...(bulk.length?{bulk:{grossUnitPrice:Number(fee),taxExempt:bulkTaxExempt}}:{}),...(needsPackagingConfirmation && nonDuplicatePackagingConfirmed ? {nonDuplicatePackagingConfirmed:true}:{})});
      const productInputs = returns.map(row => { const item=oemItems.find(value=>value.id===row.itemId); if(!item) throw Error('입고 품목을 확인해 주세요.'); return {itemId:item.id,name:item.name,spec:item.spec??'',itemUnit:item.unit??'',receivedQty:row.qty,unitKg:itemKg(item,orderUnitInputs),components:orderStockUnitInputs(orderUnitInputs).bom.of(item.id)}; });
      const preview=buildOemFeeSnapshotV2(feeTermsV2,productInputs,[]);
      previewPlan=buildOemFeePlanV2({rows:preview.rows,bulk:bulk.map(row=>({...row,...feeTermsV2!.bulk!})),accountCode:'540'});
      if (!termsConfirmed) throw Error('품목별 요율과 과세 조건을 확인해 주세요.');
      if (needsPackagingConfirmation && !nonDuplicatePackagingConfirmed) throw Error('기존 부자재 원가와 업체 청구가 별도 비용인지 확인해 주세요.');
    } catch(e) { termsError = (e as Error).message; }
    const canSave = (!!pendingReceipt || (returns.length > 0 || bulk.length > 0) && !termsError) && !busy && !pendingError;
    const payload = () => ({ returns, bulk, unitPricePerKg: Number(fee) || 0, date, ...(feeTermsV2 ? {feeTermsV2} : {}), ...(receiptCost.evidence ? { oemCostEvidence: receiptCost.evidence } : {}) });
    return { date, setDate, rawAmounts, setRawAmounts, packagingSupply, setPackagingSupply, packagingConfirmed, setPackagingConfirmed, receiptCost, canCaptureEvidence, sentRows, fee, setFee, rows, setRows, bulkRows, setBulkRows, bulkKg, receivedKg, s, loss, money, terms, setRate, termsConfirmed, setTermsConfirmed, nonDuplicatePackagingConfirmed, setNonDuplicatePackagingConfirmed, needsPackagingConfirmation, bulkTaxExempt, setBulkTaxExempt, previewPlan, termsError, canSave, payload, isCurrent: current };
}
