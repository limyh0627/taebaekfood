import { useEffect, useReducer, useRef } from 'react';
import { auth } from '../../../shared/firebase';
import type { CashEntry, CompanyId, Partner } from '../../../shared/types';
import { today } from '../../../shared/day';
import { loanBalance, loanOpeningPrincipalForBalance, type LoanContract } from '../../../shared/loanLedger';
import { createLoanWithOpening, updateLoanOpening } from '../../../shared/services/firebaseService';
import { appConfirm, appNotice } from '../../../shared/components/appDialog';
import { changeMoneyInput, formatMoneyInput, parseMoneyInput } from '../../../shared/moneyInput';
export interface LoanCreateDraft {
    id: string;
    createdAt: string;
    name: string;
    lenderName: string;
    partnerId: string;
    accountCode: '260' | '293';
    openingDate: string;
    openingPrincipal: string;
    maturityDate: string;
}
interface EditDraft {
    date: string;
    balance: string;
    opening: string;
    basis: 'current' | 'opening';
}
interface EditorScope {
    companyId: CompanyId;
    actorUid: string;
    form: object;
    lock: object | null;
    showCreate: boolean;
    create: LoanCreateDraft;
    original: LoanContract | null;
    edit: EditDraft;
    errors: Record<string, string>;
    acknowledged: boolean;
}
export interface LoanOpeningEditorOptions {
    companyId: CompanyId;
    selectedId: string;
    cashEntries: CashEntry[];
    refresh: (isCurrent: () => boolean) => Promise<unknown>;
    onCreated: (id: string) => void;
}
const emptyCreate = (): LoanCreateDraft => ({ id: '', createdAt: '', name: '', lenderName: '', partnerId: '', accountCode: '293', openingDate: today(), openingPrincipal: '0', maturityDate: '' });
const emptyEdit = (): EditDraft => ({ date: '', balance: '', opening: '', basis: 'current' });
const makeScope = (companyId: CompanyId, actorUid: string): EditorScope => ({ companyId, actorUid, form: {}, lock: null, showCreate: false, create: emptyCreate(), original: null, edit: emptyEdit(), errors: {}, acknowledged: false });
const won = (amount: number) => `${Math.round(amount).toLocaleString('ko-KR')}원`;
/** 금액 계산은 기존 공용식을 쓰고, 확인·저장 응답의 소유권만 이 폼에 묶는다. */
export function useLoanOpeningEditor(options: LoanOpeningEditorOptions) {
    const [, repaint] = useReducer(value => value + 1, 0);
    const mounted = useRef(true), latest = useRef(options);
    latest.current = options;
    const owner = useRef<EditorScope | null>(null);
    const uid = auth.currentUser?.uid ?? '';
    if (!owner.current || owner.current.companyId !== options.companyId || owner.current.actorUid !== uid)
        owner.current = makeScope(options.companyId, uid);
    const state = owner.current;
    if (state.original && state.original.id !== options.selectedId) {
        state.original = null;
        state.lock = null;
        state.form = {};
        state.errors = {};
        state.acknowledged = false;
    }
    const current = (captured: EditorScope) => mounted.current && owner.current === captured
        && latest.current.companyId === captured.companyId && (auth.currentUser?.uid ?? '') === captured.actorUid;
    useEffect(() => {
        mounted.current = true;
        if (!owner.current) {
            owner.current = makeScope(latest.current.companyId, auth.currentUser?.uid ?? '');
            repaint();
        }
        const stop = auth.onAuthStateChanged?.(user => {
            const actorUid = user?.uid ?? '';
            if (owner.current?.actorUid !== actorUid) {
                owner.current = makeScope(latest.current.companyId, actorUid);
                repaint();
            }
        });
        return () => { mounted.current = false; owner.current = null; stop?.(); };
    }, []);
    const writable = () => current(state) && !state.lock && !state.acknowledged;
    const preview = () => {
        let target = Number(state.edit.balance), principal: number | undefined, error = '';
        if (state.original) {
            if (state.edit.basis === 'opening')
                target = loanBalance({ ...state.original, openingDate: state.edit.date, openingPrincipal: Number(state.edit.opening) }, options.cashEntries);
            try {
                if ((state.edit.basis === 'opening' ? state.edit.opening : state.edit.balance) === '')
                    throw Error('원금 잔액을 입력하세요.');
                principal = loanOpeningPrincipalForBalance(state.original, options.cashEntries, state.edit.date, target);
            }
            catch (failure) {
                error = failure instanceof Error ? failure.message : String(failure);
            }
        }
        return { principal, target, error,
            openingValue: state.edit.basis === 'opening' ? state.edit.opening : principal === undefined ? '' : String(principal),
            balanceValue: state.edit.basis === 'current' ? state.edit.balance : state.edit.opening === '' ? '' : String(target) };
    };
    const changeCreate = <K extends keyof LoanCreateDraft>(key: K, value: LoanCreateDraft[K]) => {
        if (!writable())
            return;
        state.create[key] = value;
        if (key === 'lenderName')
            state.create.partnerId = '';
        repaint();
    };
    const amount = (input: HTMLInputElement, key: string, previous: string, set: (value: string) => void) => {
        if (!writable()) {
            input.value = formatMoneyInput(previous);
            return;
        }
        if (!/^[0-9,]*$/.test(input.value)) {
            input.value = formatMoneyInput(previous);
            state.errors[key] = '금액은 0원 이상의 정수만 입력하세요. 소수와 음수는 사용할 수 없습니다.';
            repaint();
            return;
        }
        state.errors[key] = '';
        changeMoneyInput(input, set);
    };
    const changeEdit = (key: 'date' | 'balance' | 'opening', value: string) => {
        if (!writable())
            return;
        if (key === 'date') {
            state.edit.balance = String(preview().target);
            state.edit.basis = 'current';
            state.errors.opening = '';
        }
        if (key === 'balance') {
            state.edit.basis = 'current';
            state.errors.opening = '';
        }
        if (key === 'opening')
            state.edit.basis = 'opening';
        state.edit[key] = value;
        repaint();
    };
    const close = () => {
        if (!current(state) || state.lock)
            return;
        state.showCreate = false;
        state.original = null;
        state.form = {};
        state.errors = {};
        state.acknowledged = false;
        repaint();
    };
    const submit = async (kind: 'create' | 'edit') => {
        if (!current(state) || state.lock || (kind === 'create' ? !state.showCreate : !state.original))
            return;
        const form = state.form, lock = {}, original = state.original, value = preview();
        state.lock = lock;
        repaint();
        const owns = () => current(state) && state.form === form && state.lock === lock;
        try {
            if (!state.acknowledged) {
                if (kind === 'create') {
                    const d = state.create, amount = parseMoneyInput(d.openingPrincipal);
                    if (state.errors.openingPrincipal)
                        return;
                    if (!d.name.trim() || !d.lenderName.trim() || !d.openingDate || !Number.isFinite(amount) || amount < 0) {
                        await appNotice('대출명·금융기관·시작일·0원 이상의 시작 원금을 입력하세요.');
                        return;
                    }
                    const payload: LoanContract = { id: d.id, companyId: state.companyId, name: d.name.trim(), lenderName: d.lenderName.trim(),
                        ...(d.partnerId ? { partnerId: d.partnerId } : {}), accountCode: d.accountCode, openingDate: d.openingDate, openingPrincipal: amount,
                        ...(d.maturityDate ? { maturityDate: d.maturityDate } : {}), createdAt: d.createdAt };
                    if (!await appConfirm({ title: '대출 등록', message: `${payload.name}의 ${payload.openingDate} 시작 원금 ${won(amount)}을 등록할까요?${amount ? ' 회계 기초일과 같으면 대출부채 기초 전표도 함께 발행합니다.' : ' 실제 차입액은 등록 후 차입 전표로 기록하세요.'}`, confirmText: '등록' }))
                        return;
                    if (!owns())
                        return;
                    await createLoanWithOpening(state.companyId, payload);
                }
                else {
                    if (!original || state.errors.balance || state.errors.opening || value.principal === undefined)
                        return;
                    const date = state.edit.date, target = value.target;
                    if (!await appConfirm({ title: '대출 시작일·잔액 수정', message: `${original.name}의 시작일을 ${date}, 시작일 원금을 ${won(value.principal)}, 현재 원금 잔액을 ${won(target)}으로 수정할까요?`, confirmText: '저장' }))
                        return;
                    if (!owns())
                        return;
                    await updateLoanOpening(state.companyId, original, date, target);
                }
                if (!owns())
                    return;
                state.acknowledged = true;
            }
            try {
                await latest.current.refresh(owns);
            }
            catch (failure) {
                if (owns())
                    await appNotice(`대출 저장은 완료됐지만 목록을 새로 불러오지 못했습니다. 저장을 다시 보내지 않고 목록을 다시 확인합니다. ${String(failure)}`, '목록 조회 실패');
                return;
            }
            if (!owns())
                return;
            if (kind === 'create') {
                state.showCreate = false;
                latest.current.onCreated(state.create.id);
                state.create = { ...state.create, name: '', openingPrincipal: '0', id: '', createdAt: '' };
            }
            else
                state.original = null;
            state.errors = {};
            state.acknowledged = false;
        }
        catch (failure) {
            if (owns())
                await appNotice(`대출 ${kind === 'create' ? '등록' : '수정'} 결과를 확인하지 못했습니다. 입력을 보존했습니다. ${String(failure)}`, '처리 결과 확인 필요');
        }
        finally {
            if (owns()) {
                state.lock = null;
                repaint();
            }
        }
    };
    return {
        isBusy: () => current(state) && !!state.lock,
        create: {
            opened: state.showCreate, draft: state.create, errors: state.errors,
            saving: !!state.lock && state.showCreate, locked: !!state.lock || state.acknowledged,
            open: () => {
                if (!current(state) || state.lock) return;
                state.form = {};
                state.errors = {};
                state.acknowledged = false;
                state.original = null;
                state.showCreate = true;
                state.create = { ...state.create, id: `loan-${crypto.randomUUID()}`, createdAt: new Date().toISOString() };
                repaint();
            },
            change: changeCreate, close, submit: () => submit('create'),
            selectPartner: (id: string, partners: Partner[]) => {
                if (!writable()) return;
                state.create.partnerId = id;
                const partner = partners.find(row => row.id === id);
                if (partner) state.create.lenderName = partner.name;
                repaint();
            },
            changeAmount: (input: HTMLInputElement) => amount(input, 'openingPrincipal', state.create.openingPrincipal, value => changeCreate('openingPrincipal', value))
        },
        edit: {
            original: state.original, draft: state.edit, errors: state.errors, preview: preview(),
            saving: !!state.lock && !!state.original, locked: !!state.lock || state.acknowledged,
            open: (loan: LoanContract) => {
                if (!current(state) || state.lock) return;
                state.form = {};
                state.showCreate = false;
                state.original = { ...loan };
                state.edit = {
                    date: loan.openingDate, balance: String(loanBalance(loan, latest.current.cashEntries)),
                    opening: String(loan.openingPrincipal), basis: 'current'
                };
                state.errors = {};
                state.acknowledged = false;
                repaint();
            },
            change: changeEdit, close, submit: () => submit('edit'),
            changeAmount: (key: 'balance' | 'opening', input: HTMLInputElement) => amount(input, key, key === 'balance' ? preview().balanceValue : preview().openingValue, value => changeEdit(key, value))
        }
    };
}
