/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import ProductModal, { ItemEditorRecoveryList } from './AddItemModal';
import type { Item } from '../types';
import type { ItemEditorOpening, PendingItemEditorPlan } from '../src/features/items/infrastructure/itemEditorWrites';
import { ITEM_EDITOR_STAGES, type ItemEditorReference } from '../src/shared/itemEditorCommand';
import type { ItemEditorProgress, ItemEditorSaveResult } from '../src/features/items/application/itemEditorSave';
vi.mock('../src/shared/firebase', () => ({ db: {}, storage: {} }));
vi.mock('../src/shared/services/firebaseService', () => ({ fetchCollection: vi.fn(async () => []) }));
const upload = vi.fn();
vi.mock('firebase/storage', () => ({ ref: vi.fn(), uploadBytes: (...args: unknown[]) => upload(...args), getDownloadURL: vi.fn(), deleteObject: vi.fn() }));
const item: Item = { id: 'target', companyId: 'taebaek', name: '품목 초안', type: 'service', stock: 0, minStock: 0, unit: '건', image: '' };
const reference: ItemEditorReference = { companyId: 'taebaek', targetId: 'target', planId: 'plan' };
const opening = (): ItemEditorOpening => ({ companyId: 'taebaek', actorUid: 'tester', targetId: 'target', target: { ...item }, targetExpected: null, documents: { items: [{ id: 'target', data: { ...item } }], boms: [], formulas: [], links: [] }, graph: { schemaVersion: 1, items: { count: 1, digest: 'a'.repeat(64) }, boms: { count: 0, digest: 'a'.repeat(64) }, formulas: { count: 0, digest: 'a'.repeat(64) }, links: { count: 0, digest: 'a'.repeat(64) } } });
const pending = (): PendingItemEditorPlan => ({ version: 1, readable: true, actorUid: 'tester', reference, requestHash: 'b'.repeat(64), request: { version: 1, ...reference, graph: opening().graph, targetExpected: null, draft: { isNew: false, metadata: { name: item.name, type: item.type, image: 'https://example.invalid/retained.jpg' }, inPartnerIds: [], bomDraft: [], formulaRows: [], photoChanged: true } } });
const saved = async (_ref: unknown, progress: ItemEditorProgress): Promise<ItemEditorSaveResult> => {
    progress.confirmedStageIds = [...ITEM_EDITOR_STAGES];
    progress.terminalStatus = 'completed';
    return { progress, outcome: { status: 'saved' } };
};
const props = () => ({ companyId: 'taebaek' as const, initialData: item, onClose: vi.fn(), onSave: vi.fn(async (_input: unknown, progress: ItemEditorProgress) => saved(null, progress)), onCaptureItemEditorOpening: vi.fn(async () => opening()), onInspectItemEditor: vi.fn(saved), onContinueItemEditor: vi.fn(saved), onCancelItemEditor: vi.fn(async (_ref: unknown, progress: ItemEditorProgress): Promise<ItemEditorSaveResult> => {
        progress.confirmedStageIds = ['primary'];
        progress.terminalStatus = 'cancelled';
        return { progress, outcome: { status: 'cancelled', message: '품목 단계는 유지하고 남은 단계를 중단했습니다.' } };
    }) });
beforeEach(() => vi.clearAllMocks());
it('원본 capture 완료 전에는 폼과 저장 버튼이 없고 capture는 한 번뿐이다', async () => {
    let finish!: (value: ItemEditorOpening) => void;
    const p = props();
    p.onCaptureItemEditorOpening.mockImplementation(() => new Promise(resolve => {
        finish = resolve;
    }));
    const view = render(<ProductModal {...p}/>);
    expect(screen.queryByRole('button', { name: '수정 완료' })).toBeNull();
    await act(async () => finish(opening()));
    expect(await screen.findByRole('button', { name: '수정 완료' })).toBeEnabled();
    view.rerender(<ProductModal {...p} initialData={{ ...item, name: '구독 갱신' }}/>);
    expect(p.onCaptureItemEditorOpening).toHaveBeenCalledOnce();
});
it('선택 이후 원본이 바뀌면 초안을 최신값으로 바꾸지 않고 저장을 막는다', async () => {
    const p = props();
    p.onCaptureItemEditorOpening.mockResolvedValue({ ...opening(), target: { ...item, name: '다른 이름' } });
    render(<ProductModal {...p}/>);
    expect(await screen.findByText(/창을 닫고 최신 품목을 다시 열어/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '수정 완료' })).toBeNull();
    expect(p.onSave).not.toHaveBeenCalled();
});
it('필터 밖·삭제된 대상의 실제 요청은 목록에서 열고 File 없이 결과만 확인한다', async () => {
    const p = props(), plan = pending(), open = vi.fn();
    const list = render(<ItemEditorRecoveryList entries={[{ reference, pending: plan }]} onOpen={open}/>);
    fireEvent.click(screen.getByRole('button', { name: '상세·결과 확인' }));
    expect(open).toHaveBeenCalledWith({ reference, pending: plan });
    list.unmount();
    render(<ProductModal {...p} initialData={undefined} initialPending={plan}/>);
    fireEvent.click(screen.getByRole('button', { name: '결과 확인' }));
    expect(await screen.findByText(/모든 단계의 저장이 확인됐습니다/)).toBeInTheDocument();
    expect(p.onInspectItemEditor).toHaveBeenCalledWith(reference, expect.any(Object), expect.any(Function));
    expect(p.onSave).not.toHaveBeenCalled();
    expect(p.onCaptureItemEditorOpening).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(p.onClose).not.toHaveBeenCalled();
});
it('손상 원문도 실제 reference로 중단하며 완료분 유지 안내와 새로 열기를 남긴다', async () => {
    const p = props();
    render(<ProductModal {...p} initialData={undefined} initialReference={reference}/>);
    expect(screen.queryByRole('button', { name: '미완료 단계 이어하기' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '남은 단계 중단' }));
    expect(await screen.findByText(/품목 단계는 유지하고 남은 단계를 중단/)).toBeInTheDocument();
    expect(screen.getByText(/확인된 단계: 품목·박스 규격·구성품/)).toBeInTheDocument();
    expect(p.onSave).not.toHaveBeenCalled();
});
it('실제 요청이 없으면 복구 목록과 버튼을 표시하지 않는다', () => {
    const view = render(<ItemEditorRecoveryList entries={[]} onOpen={vi.fn()}/>);
    expect(view.container).toBeEmptyDOMElement();
});
it.each([[undefined, 1], [null, 1], [0, 0]])('열 때 원본 BOM 수량 %s는 정본 기본값 %s를 보존한다', async (quantity, expected) => {
    const p = props(), selected: Item = { ...item, type: 'product', 품목: '서류용품목' };
    const raw = opening();
    raw.target = { ...selected };
    raw.documents.items = [{ id: selected.id, data: { ...selected } }, { id: 'child', data: { id: 'child', companyId: 'taebaek', name: '원본 자식', type: 'submaterial', stock: 0, minStock: 0, unit: '개', image: '' } }];
    raw.documents.boms = [{ id: 'bom', data: { parent_id: selected.id, child_id: 'child', ...(quantity === undefined ? {} : { quantity }) } }];
    p.onCaptureItemEditorOpening.mockResolvedValue(raw);
    render(<ProductModal {...p} initialData={selected} allSubmaterials={[{ ...selected, id: 'child', name: '화면의 옛 자식' }]}/>);
    await screen.findByText('원본 자식');
    expect(screen.queryByText('화면의 옛 자식')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '수정 완료' }));
    await waitFor(() => expect(p.onSave).toHaveBeenCalledWith(expect.objectContaining({ draft: expect.objectContaining({ bomDraft: [{ childId: 'child', qty: expected }] }) }), expect.any(Object), expect.any(Function)));
});

it('다른 사본의 실제 상태는 안내하되 현재 품목 단계 완료나 이어하기로 승격하지 않는다',async()=>{
 const p=props();const inspect=vi.fn(async(_ref:ItemEditorReference,progress:ItemEditorProgress)=>({progress,copyMismatch:true as const,observedServerStatus:'active' as const,outcome:{status:'rejected' as const,message:'다른 원문은 일부 단계가 완료된 진행 중 요청입니다.',nextAction:'남은 단계를 중단한 뒤 이 기기 사본을 정리해 주세요.'}}));render(<ProductModal {...p} initialPending={pending()} onInspectItemEditor={inspect}/>);fireEvent.click(screen.getByRole('button',{name:'결과 확인'}));expect(await screen.findByText(/다른 원문은 일부 단계/)).toBeInTheDocument();expect(screen.getByText(/창을 닫고 품목 목록의 저장 결과 확인/)).toBeInTheDocument();expect(screen.queryByRole('button',{name:'미완료 단계 이어하기'})).toBeNull();expect(screen.getByRole('button',{name:'남은 단계 중단'})).toBeEnabled();expect(screen.queryByText(/모든 단계의 저장이 확인/)).toBeNull();expect(inspect.mock.calls[0][1].confirmedStageIds).toEqual([]);expect(p.onClose).not.toHaveBeenCalled();expect(p.onSave).not.toHaveBeenCalled();
});
it('명시 사본 정리는 관측 원문과 정확 요청만 전달하고 품목·사진 저장 완료로 처리하지 않는다',async()=>{
 const p=props(),raw='{ \"observed\": \"original\" }';const discard=vi.fn(async()=>({status:'cleared' as const,message:'이 기기 사본만 정리했습니다. 이미 완료된 품목과 사진은 유지됩니다.'}));render(<ProductModal {...p} initialPending={pending()} initialObservedLocalText={raw} onDiscardItemEditorCopy={discard}/>);fireEvent.click(screen.getByRole('button',{name:'이 기기 사본 정리'}));expect(await screen.findByText(/이 기기 사본만 정리했습니다/)).toBeInTheDocument();expect(discard).toHaveBeenCalledWith(reference,raw,expect.any(Function));expect(screen.queryByRole('button',{name:'이 기기 사본 정리'})).toBeNull();expect(p.onClose).not.toHaveBeenCalled();expect(p.onSave).not.toHaveBeenCalled();expect(p.onContinueItemEditor).not.toHaveBeenCalled();expect(upload).not.toHaveBeenCalled();expect(screen.queryByText(/모든 단계의 저장이 확인/)).toBeNull();
});
it('관측 원문 없는 손상 참조는 사본 정리 없이 실제 결과 확인과 남은 단계 중단만 제공한다',()=>{
 const p=props(),discard=vi.fn();render(<ProductModal {...p} initialReference={reference} onDiscardItemEditorCopy={discard}/>);expect(screen.getByRole('button',{name:'결과 확인'})).toBeEnabled();expect(screen.getByRole('button',{name:'남은 단계 중단'})).toBeEnabled();expect(screen.queryByRole('button',{name:'이 기기 사본 정리'})).toBeNull();expect(screen.queryByRole('button',{name:'미완료 단계 이어하기'})).toBeNull();expect(discard).not.toHaveBeenCalled();
});
it('서버 미종결이나 관측 이후 사본 변경으로 정리가 막히면 원문과 복구 버튼을 유지한다',async()=>{
 const p=props(),discard=vi.fn(async()=>({status:'blocked' as const,message:'관측 후 사본이 바뀌어 정리하지 않았습니다.'}));render(<ProductModal {...p} initialReference={reference} initialObservedLocalText='old-observed' onDiscardItemEditorCopy={discard}/>);fireEvent.click(screen.getByRole('button',{name:'이 기기 사본 정리'}));expect(await screen.findByText(/사본이 바뀌어 정리하지/)).toBeInTheDocument();expect(screen.getByRole('button',{name:'이 기기 사본 정리'})).toBeEnabled();expect(screen.getByRole('button',{name:'결과 확인'})).toBeEnabled();expect(p.onClose).not.toHaveBeenCalled();
});
