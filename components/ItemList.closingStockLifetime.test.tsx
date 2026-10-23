/** @vitest-environment jsdom */
import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import ItemList from './ItemList';
import { appConfirm } from '../src/shared/components/appDialog';
import type { Item } from '../src/shared/types';
const memory = vi.hoisted(() => ({ item: null as any, writes: 0, lose: false, fail: false, uid: 'u', companyId: 'taebaek', beforeRead: null as null | (() => void), readWait: null as Promise<void> | null }));
vi.mock('../src/shared/firebase', () => ({ db: {}, storage: {}, functions: {}, authReady: Promise.resolve(), auth: { get currentUser() { return { uid: memory.uid, getIdTokenResult: async () => ({ claims: { companyId: memory.companyId } }) }; } } }));
vi.mock('../src/shared/services/firebaseService', () => ({ fetchCollection: vi.fn().mockResolvedValue([]), subscribeToCollection: vi.fn(() => () => { }), addItem: vi.fn() }));
vi.mock('../src/shared/components/appDialog', () => ({ appConfirm: vi.fn().mockResolvedValue(true) }));
vi.mock('firebase/firestore', async (importOriginal) => ({ ...await importOriginal<typeof import('firebase/firestore')>(), doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }), runTransaction: async (_db: unknown, fn: any) => {
        let patch: any;
        const result = await fn({ get: async () => { const wait = memory.readWait; memory.readWait = null; if (wait)
                await wait; memory.beforeRead?.(); return { exists: () => true, data: () => JSON.parse(JSON.stringify(memory.item)) }; }, update: (_ref: unknown, data: any) => { if (memory.fail)
                throw Error('쓰기 실패'); patch = data; } });
        if (patch) {
            memory.item = { ...memory.item, ...patch };
            memory.writes++;
            if (memory.lose) {
                memory.lose = false;
                throw Error('응답 유실');
            }
        }
        return result;
    } }));
const product = { id: 'p', companyId: 'taebaek', name: '실사제품', type: 'product', unit: '개', spec: '1kg', stock: 3, minStock: 0, lots: [{ id: 'l', qtyIn: 3, qtyRemaining: 3, unitKg: 1, kgIn: 3, kgRemaining: 3, status: 'active' }] } as Item;
function element(companyId: 'taebaek' | 'punghoe' = 'taebaek', item: Item = product, rawWrite = vi.fn()) {
    return <ItemList companyId={companyId} items={[item]} orderRequests={[]} confirmedOrders={[]} inboundPartners={[]} rawMaterialLedger={[]} partners={[]} isAdmin currentUser={{ id: 'employee', name: '관리자' }} onUpdateItem={vi.fn()} onAddItem={vi.fn()} onAddOrderRequest={vi.fn()} onRemoveOrderRequest={vi.fn()} onUpdateOrderRequestQty={vi.fn()} onToggleConfirmRequestQty={vi.fn()} onConfirmRequest={vi.fn()} onConfirmRequests={vi.fn()} onBulkAddConfirmedOrders={vi.fn()} onConfirmAllRequests={vi.fn()} onFinishConfirmedOrder={vi.fn()} onUpdateConfirmedQty={vi.fn()} onRemoveConfirmedOrder={vi.fn()} onEditProduct={vi.fn()} onDeleteItem={vi.fn()} onAddAdjustmentRequest={vi.fn()} onAddRawMaterialEntry={rawWrite} onDeleteRawMaterialEntry={vi.fn()}/>;
}
function view() { return render(element()); }
async function open() { fireEvent.click(screen.getAllByText('실사제품')[0]); fireEvent.click(await screen.findByRole('button', { name: '실사 반영' })); return screen.findByRole('heading', { name: '재고 실사' }); }
beforeEach(() => { localStorage.clear(); memory.item = JSON.parse(JSON.stringify(product)); memory.writes = 0; memory.lose = false; memory.fail = false; memory.uid = 'u'; memory.companyId = 'taebaek'; memory.beforeRead = null; memory.readWait = null; });
async function closing() { fireEvent.click(screen.getAllByRole('button', { name: '재고 현황' }).at(-1)!); return screen.findByRole('dialog', { name: '재고 현황' }); }
it('재고현황 zero 확인중 렌더없이 UID가 바뀌면 저장을 시작하지 않는다', async () => {
    view();
    const dialog = await closing();
    let finish!: (yes: boolean) => void;
    vi.mocked(appConfirm).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.click(within(dialog).getByTitle('재고 0으로'));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    memory.uid = 'other';
    finish(true);
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(memory.writes).toBe(0);
});
it('직접 실사 실패는 입력과 처리결과 안내를 보존한다', async () => {
    view();
    const dialog = await closing();
    fireEvent.click(within(dialog).getByTitle(/눌러서 실사 수정/));
    const input = dialog.querySelector('input[inputmode="decimal"]')!;
    fireEvent.change(input, { target: { value: '5' } });
    memory.fail = true;
    fireEvent.blur(input);
    await screen.findByText(/쓰기 실패/);
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue('5');
});
it('이미 보관된 실사는 zero 새적용 대신 기존 결과확인 모달로 이동한다', async () => {
    const request = { version: 1, operationId: 'existing', companyId: 'taebaek', uid: 'u', itemId: 'p', itemName: '실사제품', targetQty: 7, minStock: 0, unitKg: 1, capturedAt: '2026-10-20T00:00:00.000Z', state: 'prepared' };
    localStorage.setItem('product-stocktake:taebaek:u:p', JSON.stringify(request));
    view();
    const dialog = await closing();
    fireEvent.click(within(dialog).getByTitle('재고 0으로'));
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(memory.writes).toBe(0);
    expect(await screen.findByText(/보존된 최초 실사 7/)).toBeInTheDocument();
});
it('zero 확인을 취소하면 실패안내와 추가편집 없이 저장0이다', async () => {
    view();
    const dialog = await closing();
    vi.mocked(appConfirm).mockResolvedValueOnce(false);
    fireEvent.click(within(dialog).getByTitle('재고 0으로'));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(memory.writes).toBe(0);
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(dialog.querySelector('input[inputmode="decimal"]')).toBeNull();
});
it('직접 입력 ESC는 저장 없이 편집을 취소한다', async () => {
    view();
    const dialog = await closing();
    fireEvent.click(within(dialog).getByTitle(/눌러서 실사 수정/));
    const input = dialog.querySelector('input[inputmode="decimal"]')!;
    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);
    expect(memory.writes).toBe(0);
    expect(dialog.querySelector('input[inputmode="decimal"]')).toBeNull();
});
it('직접실사 실패의 명시 결과확인은 새적용 없이 기존모달을 연다', async () => {
    view();
    const dialog = await closing();
    fireEvent.click(within(dialog).getByTitle(/눌러서 실사 수정/));
    const input = dialog.querySelector('input[inputmode="decimal"]')!;
    fireEvent.change(input, { target: { value: '5' } });
    memory.fail = true;
    fireEvent.blur(input);
    await screen.findByText(/쓰기 실패/);
    fireEvent.click(within(dialog).getByRole('button', { name: '실사 결과 확인' }));
    expect(screen.queryByRole('dialog', { name: '재고 현황' })).toBeNull();
    expect(await screen.findByText(/보존된 최초 실사 5/)).toBeInTheDocument();
    expect(memory.writes).toBe(0);
});
it('원료 zero의 내부 확인을 취소해도 실패로 표시하지 않는다', async () => {
    const raw = { ...product, subtype: '벌크', name: '합성원료', unit: 'kg' } as Item, write = vi.fn().mockResolvedValue({ ok: true, appliedKg: 0 });
    render(element('taebaek', raw, write));
    const dialog = await closing();
    vi.mocked(appConfirm).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    fireEvent.click(within(dialog).getByTitle('재고 0으로'));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(write).not.toHaveBeenCalled();
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(dialog.querySelector('input[inputmode="decimal"]')).toBeNull();
});
