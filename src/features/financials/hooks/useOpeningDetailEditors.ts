import { useEffect, useReducer, useRef } from 'react';
import type { CompanyId } from '../../../shared/types';
import { AR } from '../../../shared/autoJournal';
import type { OpeningPartnerCode } from '../../../shared/openingPartnerBalance';
import { createOpeningInventory, createOpeningPartnerBalance } from '../../../shared/services/firebaseService';
import { appNotice } from '../../../shared/components/appDialog';

interface PartnerDraft { partnerId: string; code: OpeningPartnerCode; amount: string }
interface InventoryDraft { itemId: string; quantity: string; value: string }
interface FormState<Draft> { draft: Draft; generation: object; execution: object | null }
interface Owner { companyId: CompanyId; partner: FormState<PartnerDraft>; inventory: FormState<InventoryDraft> }
interface Options {
    companyId: CompanyId;
    openingDate: string | null;
    openingReady: boolean;
    onInventoryApplied?: (companyId: CompanyId, date: string) => void;
}
const partnerDraft = (): PartnerDraft => ({ partnerId: '', code: AR, amount: '' });
const inventoryDraft = (): InventoryDraft => ({ itemId: '', quantity: '', value: '' });
const createOwner = (companyId: CompanyId): Owner => ({ companyId,
    partner: { draft: partnerDraft(), generation: {}, execution: null },
    inventory: { draft: inventoryDraft(), generation: {}, execution: null },
});

/** 두 폼의 저장 잠금을 분리하고 이전 회사·마운트의 응답을 새 입력에 반영하지 않는다. */
export function useOpeningDetailEditors(options: Options) {
    const [, repaint] = useReducer(value => value + 1, 0);
    const latest = useRef(options);
    latest.current = options;
    const owner = useRef(createOwner(options.companyId));
    if (owner.current.companyId !== options.companyId) owner.current = createOwner(options.companyId);
    const mount = useRef({ active: true, generation: {} });
    useEffect(() => {
        mount.current.active = true;
        repaint();
        return () => { mount.current.active = false; mount.current.generation = {}; };
    }, []);

    const captured = owner.current;
    const mounted = mount.current.generation;
    const visible = () => owner.current === captured && mount.current.active && mount.current.generation === mounted;
    const ready = () => visible() && latest.current.openingReady && !!latest.current.openingDate;
    const partnerCanSubmit = () => ready() && !captured.partner.execution && !!captured.partner.draft.partnerId && !!captured.partner.draft.amount;
    const inventoryCanSubmit = () => ready() && !captured.inventory.execution && !!captured.inventory.draft.itemId && !!captured.inventory.draft.quantity && !!captured.inventory.draft.value;

    const changePartner = <Key extends keyof PartnerDraft>(key: Key, value: PartnerDraft[Key]) => {
        if (!visible() || captured.partner.execution) return;
        const next = key === 'amount' ? value.replace(/[^\d,]/g, '') : value;
        if (captured.partner.draft[key] === next) return;
        captured.partner.draft = { ...captured.partner.draft, [key]: next };
        captured.partner.generation = {};
        repaint();
    };
    const changeInventory = (key: keyof InventoryDraft, value: string) => {
        if (!visible() || captured.inventory.execution) return;
        const next = key === 'quantity' ? value.replace(/[^\d.,]/g, '') : key === 'value' ? value.replace(/[^\d,]/g, '') : value;
        if (captured.inventory.draft[key] === next) return;
        captured.inventory.draft = { ...captured.inventory.draft, [key]: next };
        captured.inventory.generation = {};
        repaint();
    };
    const savePartner = async () => {
        if (!partnerCanSubmit()) return;
        const form = captured.partner, generation = form.generation, execution = {};
        const payload = { companyId: captured.companyId, date: latest.current.openingDate!, partnerId: form.draft.partnerId,
            code: form.draft.code, amount: Number(form.draft.amount.replaceAll(',', '')) };
        form.execution = execution;
        const own = () => visible() && form.generation === generation && form.execution === execution;
        const current = () => own() && latest.current.openingDate === payload.date;
        repaint();
        try {
            const result = await createOpeningPartnerBalance(payload.companyId, payload.date, payload.partnerId, payload.code, payload.amount);
            if (!current()) return;
            await appNotice(result === 'unchanged' ? '같은 기초 전표가 이미 저장되어 있습니다.' : '거래처별 기초 전표를 저장했습니다.');
            if (!current()) return;
            if (result === 'created') form.draft = { ...form.draft, amount: '' };
        } catch (error) { if (current()) await appNotice(String(error), '저장 실패'); }
        finally { if (own()) { form.execution = null; repaint(); } }
    };
    const saveInventory = async () => {
        if (!inventoryCanSubmit()) return;
        const form = captured.inventory, generation = form.generation, execution = {};
        const payload = { companyId: captured.companyId, date: latest.current.openingDate!, itemId: form.draft.itemId,
            quantity: Number(form.draft.quantity.replaceAll(',', '')), value: Number(form.draft.value.replaceAll(',', '')) };
        form.execution = execution;
        const own = () => visible() && form.generation === generation && form.execution === execution;
        const current = () => own() && latest.current.openingDate === payload.date;
        repaint();
        try {
            const result = await createOpeningInventory(payload.companyId, payload.date, payload.itemId, payload.quantity, payload.value);
            if (!current()) return;
            latest.current.onInventoryApplied?.(payload.companyId, payload.date);
            await appNotice(result === 'unchanged' ? '같은 기초 재고가 이미 저장돼 있습니다.' : '재고 수량·로트·원장과 기초 전표를 함께 저장했습니다.');
            if (!current()) return;
            if (result === 'created') form.draft = inventoryDraft();
        } catch (error) { if (current()) await appNotice(String(error), '기초 재고 저장 실패'); }
        finally { if (own()) { form.execution = null; repaint(); } }
    };
    return {
        partner: { draft: captured.partner.draft, change: changePartner, save: savePartner, saving: !!captured.partner.execution, canSubmit: partnerCanSubmit() },
        inventory: { draft: captured.inventory.draft, change: changeInventory, save: saveInventory, saving: !!captured.inventory.execution, canSubmit: inventoryCanSubmit() },
    };
}
