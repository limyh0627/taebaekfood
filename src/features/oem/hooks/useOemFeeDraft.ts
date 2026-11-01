import { useEffect, useRef, useState } from 'react';
import { today } from '../../../shared/day';
import type { CompanyId, Item, PurchaseOrder } from '../../../shared/types';
import type { OrderUnitInputs } from '../../../shared/orderUnits';
import { processingFee } from '../../admin/oem';
import { OEM_DEFAULT_FEE_PER_KG } from '../../admin/oemEngine';
import { reconcileOemBatch } from '../../admin/oemReconciliation';
export interface OemFeeDraftOptions {
    po: PurchaseOrder;
    items: Item[];
    companyId: CompanyId;
    busy: boolean;
    orderUnitInputs?: OrderUnitInputs;
    onClose: () => void;
    onSubmit: (value: {
        unitPricePerKg: number;
        date: string;
    }) => void;
}
/** 부모의 저장 수명은 유지하고, 현재 회사·발주의 작성값과 입력 잠금만 소유한다. */
export function useOemFeeDraft(options: OemFeeDraftOptions) {
    const { po, items, companyId, busy, orderUnitInputs } = options;
    const [, paint] = useState(0), latest = useRef(options);
    latest.current = options;
    const owner = useRef({ companyId, poId: po.id, date: today(), fee: String(po.oemFeePerKg ?? OEM_DEFAULT_FEE_PER_KG) });
    if (owner.current.companyId !== companyId || owner.current.poId !== po.id)
        owner.current = { companyId, poId: po.id, date: today(), fee: String(po.oemFeePerKg ?? OEM_DEFAULT_FEE_PER_KG) };
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const captured = owner.current;
    const current = () => mounted.current && owner.current === captured && latest.current.companyId === companyId && latest.current.po.id === po.id;
    const editable = () => current() && !latest.current.busy;
    const setDate = (value: string) => { if (!editable())
        return; captured.date = value; paint(n => n + 1); };
    const setFee = (value: string) => { if (!editable())
        return; captured.fee = value; paint(n => n + 1); };
    const date = captured.date, fee = captured.fee;
    const kg = po.oemReceivedKg ?? 0;
    const money = processingFee(kg, Number(fee) || 0);
    const reconciliation = reconcileOemBatch(po, items, companyId, orderUnitInputs);
    const canSubmit = !(busy || kg <= 0);
    const submit = () => { if (!editable() || (latest.current.po.oemReceivedKg ?? 0) <= 0)
        return; options.onSubmit({ unitPricePerKg: Number(fee) || 0, date }); };
    const close = () => { if (editable())
        options.onClose(); };
    return { date, fee, setDate, setFee, kg, money, reconciliation, canSubmit, submit, close };
}
