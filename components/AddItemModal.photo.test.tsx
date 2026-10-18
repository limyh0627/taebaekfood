/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import ProductModal from './AddItemModal';
import type { Item } from '../types';
import type { ItemEditorOpening, ItemEditorSaveInput } from '../src/features/items/infrastructure/itemEditorWrites';
import type { ItemEditorProgress, ItemEditorSaveResult } from '../src/features/items/application/itemEditorSave';
import { ITEM_EDITOR_STAGES } from '../src/shared/itemEditorCommand';
const uploadBytes = vi.fn(), getDownloadURL = vi.fn(), deleteObject = vi.fn(), getDoc = vi.fn();
vi.mock('firebase/firestore', async (importOriginal) => ({ ...await importOriginal<typeof import('firebase/firestore')>(), doc: (_db: unknown, _collection: string, id: string) => ({ id }), getDoc: (...args: unknown[]) => getDoc(...args) }));
vi.mock('firebase/storage', () => ({ ref: (_storage: unknown, path: string) => ({ path }), uploadBytes: (...args: unknown[]) => uploadBytes(...args), getDownloadURL: (...args: unknown[]) => getDownloadURL(...args), deleteObject: (...args: unknown[]) => deleteObject(...args) }));
vi.mock('../src/shared/firebase', () => ({ db: {}, storage: {} }));
vi.mock('../src/shared/services/firebaseService', () => ({ fetchCollection: vi.fn(async () => []) }));
const item: Item = { id: 'item-1', companyId: 'taebaek', name: '사진 시험 품목', type: 'service', stock: 0, minStock: 0, unit: '건', image: 'https://old.example/photo', imagePath: 'companies/taebaek/items/item-1/photo-old.jpg' };
const opening: ItemEditorOpening = { companyId: 'taebaek', actorUid: 'tester', targetId: item.id, target: { ...item }, targetExpected: null, documents: { items: [{ id: item.id, data: { ...item } }], boms: [], formulas: [], links: [] }, graph: { schemaVersion: 1, items: { count: 1, digest: 'a'.repeat(64) }, boms: { count: 0, digest: 'a'.repeat(64) }, formulas: { count: 0, digest: 'a'.repeat(64) }, links: { count: 0, digest: 'a'.repeat(64) } } };
const saved = async (_input: ItemEditorSaveInput, progress: ItemEditorProgress): Promise<ItemEditorSaveResult> => {
    progress.confirmedStageIds = [...ITEM_EDITOR_STAGES];
    return { progress, outcome: { status: 'saved' } };
};
const props = () => ({ companyId: 'taebaek' as const, initialData: item, items: [], onClose: vi.fn(), onSave: vi.fn(saved), onCaptureItemEditorOpening: vi.fn(async () => opening), onInspectItemEditor: vi.fn(async (_ref: unknown, progress: ItemEditorProgress): Promise<ItemEditorSaveResult> => ({ progress, outcome: { status: 'unknown', message: '결과 미확인', nextAction: '다시 확인' } })), onContinueItemEditor: vi.fn(async (_ref: unknown, progress: ItemEditorProgress): Promise<ItemEditorSaveResult> => ({ progress, outcome: { status: 'unknown', message: '결과 미확인', nextAction: '다시 확인' } })), onCancelItemEditor: vi.fn(async (_ref: unknown, progress: ItemEditorProgress): Promise<ItemEditorSaveResult> => ({ progress, outcome: { status: 'cancelled', message: '남은 단계 중단' } })) });
beforeEach(() => {
    vi.clearAllMocks();
    uploadBytes.mockResolvedValue({});
    getDownloadURL.mockResolvedValue('https://new.example/photo');
    deleteObject.mockResolvedValue(undefined);
    getDoc.mockResolvedValue({ exists: () => false });
    vi.stubGlobal('crypto', { randomUUID: () => 'photo-uuid' });
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:preview', revokeObjectURL: vi.fn() });
});
const choosePhoto = () => fireEvent.change(screen.getByLabelText('품목 사진 선택'), { target: { files: [new File(['photo'], 'new.png', { type: 'image/png' })] } });
it('다섯 단계 ACK 뒤에만 닫고 고정 사진 URL·path를 typed 초안으로 전달한다', async () => {
    const p = props();
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ imagePath: 'new-path' }) });
    render(<ProductModal {...p}/>);
    await screen.findByRole('button', { name: '수정 완료' });
    choosePhoto();
    fireEvent.click(screen.getByRole('button', { name: '수정 완료' }));
    await waitFor(() => expect(p.onClose).toHaveBeenCalledOnce());
    expect(p.onSave.mock.calls[0][0]).toMatchObject({ opening, draft: { metadata: { image: 'https://new.example/photo', imagePath: 'companies/taebaek/items/item-1/photo-photo-uuid.png' }, photoChanged: true } });
    expect(deleteObject).toHaveBeenCalledExactlyOnceWith({ path: item.imagePath });
});
it('미확정 요청은 사진을 삭제·재업로드하지 않고 정확한 reference로 결과 확인한다', async () => {
    const p = props();
    p.onSave.mockImplementation(async (_input, progress) => {
        progress.reference = { companyId: 'taebaek', targetId: item.id, planId: 'plan' };
        progress.durableVersion = 1;
        progress.unknownStageId = 'primary';
        return { progress, outcome: { status: 'unknown', message: '응답 미확인', nextAction: '결과 확인' } };
    });
    render(<ProductModal {...p}/>);
    await screen.findByRole('button', { name: '수정 완료' });
    choosePhoto();
    fireEvent.click(screen.getByRole('button', { name: '수정 완료' }));
    fireEvent.click(await screen.findByRole('button', { name: '결과 확인' }));
    await waitFor(() => expect(p.onInspectItemEditor).toHaveBeenCalledOnce());
    expect(uploadBytes).toHaveBeenCalledOnce();
    expect(p.onSave).toHaveBeenCalledOnce();
    expect(deleteObject).not.toHaveBeenCalled();
    expect(p.onClose).not.toHaveBeenCalled();
});
it('전송 전 검증 거절은 입력을 다시 고칠 수 있고 같은 업로드 경로를 재사용한다', async () => {
    const p = props();
    p.onSave.mockImplementationOnce(async (_input, progress) => ({ progress, outcome: { status: 'rejected', message: '입력을 확인해 주세요.', nextAction: '수정 후 다시 저장' } }));
    render(<ProductModal {...p}/>);
    await screen.findByRole('button', { name: '수정 완료' });
    choosePhoto();
    fireEvent.click(screen.getByRole('button', { name: '수정 완료' }));
    await screen.findByText(/입력을 확인/);
    fireEvent.change(screen.getByPlaceholderText('예: 프리미엄 참기름 (300ml)'), { target: { value: '수정한 이름' } });
    fireEvent.click(screen.getByRole('button', { name: '수정 완료' }));
    await waitFor(() => expect(p.onClose).toHaveBeenCalledOnce());
    expect(uploadBytes).toHaveBeenCalledOnce();
    expect(p.onSave).toHaveBeenCalledTimes(2);
});
it('저장 ACK 대기 중에는 중복 저장·창 닫기를 허용하지 않는다', async () => {
    let finish!: (result: ItemEditorSaveResult) => void;
    const p = props();
    p.onSave.mockImplementation((_input, progress) => new Promise(resolve => {
        finish = result => resolve({ ...result, progress });
    }));
    render(<ProductModal {...p}/>);
    await screen.findByRole('button', { name: '수정 완료' });
    fireEvent.click(screen.getByRole('button', { name: '수정 완료' }));
    await screen.findByRole('button', { name: '저장 중…' });
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(p.onClose).not.toHaveBeenCalled();
    const progress = p.onSave.mock.calls[0][1];
    progress.confirmedStageIds = [...ITEM_EDITOR_STAGES];
    await act(async () => finish({ progress, outcome: { status: 'saved' } }));
    await waitFor(() => expect(p.onClose).toHaveBeenCalledOnce());
    expect(p.onSave).toHaveBeenCalledOnce();
});
it('실제 요청을 중단하면 이어하기 버튼을 모두 없애고 확인된 단계와 닫기만 남긴다', async () => {
    const p = props();
    p.onSave.mockImplementation(async (_input, progress) => {
        progress.reference = { companyId: 'taebaek', targetId: item.id, planId: 'plan' };
        progress.durableVersion = 1;
        progress.confirmedStageIds = ['primary'];
        return { progress, outcome: { status: 'partial', reason: 'followup-unconfirmed', committedIds: [item.id], unconfirmedIds: [], message: '품목 단계 완료, 후속 단계 확인 필요', nextAction: '결과 확인' } };
    });
    p.onCancelItemEditor.mockImplementation(async (_ref, progress) => {
        progress.terminalStatus = 'cancelled';
        return { progress, outcome: { status: 'cancelled', message: '완료된 품목 단계는 유지했습니다.', nextAction: '창을 닫고 현재 자료를 다시 열어 주세요.' } };
    });
    render(<ProductModal {...p}/>);
    fireEvent.click(await screen.findByRole('button', { name: '수정 완료' }));
    expect(await screen.findByRole('button', { name: '미완료 단계 이어하기' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '수정 완료' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '남은 단계 중단' }));
    await screen.findByText(/완료된 품목 단계는 유지/);
    expect(screen.queryByRole('button', { name: '미완료 단계 이어하기' })).toBeNull();
    expect(screen.queryByRole('button', { name: '수정 완료' })).toBeNull();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByText(/확인된 단계: 품목·박스 규격·구성품/)).toBeInTheDocument();
    expect(p.onSave).toHaveBeenCalledOnce();
});
