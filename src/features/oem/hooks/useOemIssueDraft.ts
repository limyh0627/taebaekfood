import { useEffect, useRef, useState, type SetStateAction } from 'react';
import { captureOemCostEvidence } from '../../admin/oemCostEvidence';
import { rawHolderByName } from '../../../shared/rawHolder';
import { today } from '../../../shared/day';
import type { CompanyId, Item, Partner } from '../../../shared/types';
import type { IssueInput } from '../domain/oemManager';
export interface OemIssueDraftOptions {
    companyId: CompanyId;
    partners: Partner[];
    rawItems: Item[];
    rawStockKg: (material: string) => number;
    busy: boolean;
    onClose: () => void;
    onSubmit: (value: IssueInput) => void;
}
type Draft = {
    partnerId: string;
    date: string;
    rows: {
        material: string;
        kg: string;
        supplyAmount?: string;
    }[];
    note: string;
    packagingSupply: string;
    packagingConfirmed: boolean;
};
/** 조회 근거와 분리해 현재 회사 작성값·계산·명시 송신만 소유한다. */
export function useOemIssueDraft(options: OemIssueDraftOptions) {
    const { companyId, partners, rawItems, rawStockKg, busy } = options;
    const [, paint] = useState(0), latest = useRef(options);
    latest.current = options;
    const owner = useRef({ companyId, values: {} as Draft });
    if (owner.current.companyId !== companyId)
        owner.current = { companyId, values: {} as Draft };
    const captured = owner.current, mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const current = () => mounted.current && owner.current === captured && latest.current.companyId === companyId;
    const editable = () => current() && !latest.current.busy;
    function field<K extends keyof Draft>(key: K, initial: () => Draft[K]): [
        Draft[K],
        (value: SetStateAction<Draft[K]>) => void
    ] { if (!Object.prototype.hasOwnProperty.call(captured.values, key))
        captured.values[key] = initial(); return [captured.values[key], value => { if (!editable())
            return; captured.values[key] = typeof value === 'function' ? (value as (old: Draft[K]) => Draft[K])(captured.values[key]) : value; paint(n => n + 1); }]; }
    const [partnerId, setPartnerId] = field('partnerId', () => '');
    const [date, setDate] = field('date', () => today());
    const [rows, setRows] = field('rows', () => [{ material: '', kg: '' }]);
    const [note, setNote] = field('note', () => '');
    const [packagingSupply, setPackagingSupply] = field('packagingSupply', () => '');
    const [packagingConfirmed, setPackagingConfirmed] = field('packagingConfirmed', () => false);
    const costRows = rows.filter(row => row.material && Number(row.kg) > 0).map(row => ({ rawItemId: rawHolderByName(rawItems, row.material, companyId)?.id, kg: Number(row.kg), supplyAmount: row.supplyAmount ?? '' }));
    const costStatus = captureOemCostEvidence(companyId, costRows, packagingSupply, packagingConfirmed, new Date().toISOString());
    const partner = partners.find(p => p.id === partnerId);
    const sent = rows.filter(r => r.material && Number(r.kg) > 0).map(r => ({ material: r.material, kg: Number(r.kg) }));
    const shortage = sent.filter(s => s.kg > rawStockKg(s.material));
    const canSave = !!partnerId && sent.length > 0 && !busy;
    const submit = () => { if (!editable() || !canSave)
        return; options.onSubmit({ jobId: `oem-${crypto.randomUUID()}`, oemPartnerId: partnerId, partnerName: partner?.name ?? '', sent, date, note: note.trim() || undefined, ...(costStatus.evidence ? { oemCostEvidence: costStatus.evidence } : {}) }); };
    const close = () => { if (editable())
        options.onClose(); };
    return { partnerId, setPartnerId, date, setDate, rows, setRows, note, setNote, packagingSupply, setPackagingSupply, packagingConfirmed, setPackagingConfirmed, costRows, costStatus, partner, sent, shortage, canSave, submit, close };
}
