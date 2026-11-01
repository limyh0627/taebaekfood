import { useRef, useState, type SetStateAction } from 'react';
import { captureOemCostEvidence } from '../../admin/oemCostEvidence';
import { today } from '../../../shared/day';
import type { Item, PurchaseOrder, CompanyId } from '../../../shared/types';
import { sentKg, batchLoss, processingFee } from '../../admin/oem';
import { itemKg, OEM_DEFAULT_FEE_PER_KG } from '../../admin/oemEngine';
import type { OrderUnitInputs } from '../../../shared/orderUnits';
import type { ReceiveInput } from '../domain/oemManager';
export interface OemReceiptDraftOptions {
    companyId: CompanyId;
    po: PurchaseOrder;
    oemItems: Item[];
    busy: boolean;
    pendingReceipt: ReceiveInput | null;
    pendingError?: string;
    orderUnitInputs?: OrderUnitInputs;
}
type Draft = {
    date: string;
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
    const { companyId, po, oemItems, busy, pendingReceipt, pendingError, orderUnitInputs } = options;
    const [, paint] = useState(0), latest = useRef(options);
    latest.current = options;
    const owner = useRef({ companyId, poId: po.id, values: {} as Draft, capturedAt: new Date().toISOString() });
    if (owner.current.companyId !== companyId || owner.current.poId !== po.id)
        owner.current = { companyId, poId: po.id, values: {} as Draft, capturedAt: new Date().toISOString() };
    const state = owner.current;
    const current = () => owner.current === state && latest.current.companyId === companyId && latest.current.po.id === po.id;
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
    const [packagingSupply, setPackagingSupply] = field('packagingSupply', () => '');
    const [packagingConfirmed, setPackagingConfirmed] = field('packagingConfirmed', () => false);
    const capturedAt = { current: state.capturedAt };
    const sentRows = po.oemSent ?? [];
    const canCaptureEvidence = !po.oemCostEvidence && sentRows.length > 0 && sentRows.every(row => !!row.rawItemId && Number.isFinite(row.kg) && row.kg > 0);
    const receiptCost: ReturnType<typeof captureOemCostEvidence> = canCaptureEvidence ? captureOemCostEvidence(companyId, sentRows.map((row, i) => ({ rawItemId: row.rawItemId, kg: row.kg, supplyAmount: rawAmounts[i] ?? '' })), packagingSupply, packagingConfirmed, capturedAt.current) : { status: 'empty' as const };
    const [fee, setFee] = field('fee', () => String(po.oemFeePerKg ?? OEM_DEFAULT_FEE_PER_KG));
    // 임가공 품목이 여러 개면 처음부터 각 행으로 띄운다 — 돌아온 것만 수량 입력(빈 행은 저장 시 무시).
    const [rows, setRows] = field('rows', () => oemItems.length > 0 ? oemItems.map(it => ({ itemId: it.id, qty: '' })) : [{ itemId: '', qty: '' }]);
    // 벌크(포장 안 하고 온 몫) — kg으로 받아 원료 로트에 그대로 쌓는다. 소분 품목이 여기서 빼간다.
    const [bulkRows, setBulkRows] = field('bulkRows', () => [{ material: '', kg: '' }]);
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
    const canSave = (!!pendingReceipt || returns.length > 0 || bulk.length > 0) && !busy && !pendingError;
    const payload = () => ({ returns, bulk, unitPricePerKg: Number(fee) || 0, date, ...(receiptCost.evidence ? { oemCostEvidence: receiptCost.evidence } : {}) });
    return { date, setDate, rawAmounts, setRawAmounts, packagingSupply, setPackagingSupply, packagingConfirmed, setPackagingConfirmed, receiptCost, canCaptureEvidence, sentRows, fee, setFee, rows, setRows, bulkRows, setBulkRows, bulkKg, receivedKg, s, loss, money, canSave, payload, isCurrent: current };
}
