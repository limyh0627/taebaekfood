import type { PartnerItem } from '../src/shared/types';
/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProductModal from './AddItemModal';
const uploadBytes = vi.fn();
const getDownloadURL = vi.fn();
const deleteObject = vi.fn();
const getDoc = vi.fn();
vi.mock('firebase/firestore', async (importOriginal) => ({ ...await importOriginal<typeof import('firebase/firestore')>(), doc: (_db: unknown, _collection: string, id: string) => ({ id }), getDoc: (...args: unknown[]) => getDoc(...args) }));
vi.mock('firebase/storage', () => ({ ref: (_storage: unknown, path: string) => ({ path }), uploadBytes: (...args: unknown[]) => uploadBytes(...args), getDownloadURL: (...args: unknown[]) => getDownloadURL(...args), deleteObject: (...args: unknown[]) => deleteObject(...args) }));
vi.mock('../src/shared/firebase', () => ({ db: {}, storage: {} }));
vi.mock('../src/shared/services/firebaseService', () => ({ fetchCollection: vi.fn(async () => []) }));
const baseItem = { id: 'item-1', name: '사진 시험 품목', type: 'service', category: 'service', stock: 0, minStock: 0, unit: '건', image: 'https://old.example/photo', imagePath: 'companies/taebaek/items/item-1/photo-old.jpg' } as any;
import type { ItemEditorProgress, ItemEditorSaveResult } from '../src/features/items/application/itemEditorSave';
const saved = async (_product: unknown, progress: ItemEditorProgress): Promise<ItemEditorSaveResult> => {
    progress.confirmedStageIds.push('primary');
    return { outcome: { status: 'saved' }, progress };
};
beforeEach(() => {
    vi.resetAllMocks();
    uploadBytes.mockResolvedValue({});
    getDownloadURL.mockResolvedValue('https://new.example/photo');
    deleteObject.mockResolvedValue(undefined);
    getDoc.mockResolvedValue({ exists: () => false });
    vi.stubGlobal('crypto', { randomUUID: () => 'photo-uuid' });
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:preview', revokeObjectURL: vi.fn() });
});
const choosePhoto = () => fireEvent.change(screen.getByLabelText('품목 사진 선택'), { target: { files: [new File(['photo'], 'new.png', { type: 'image/png' })] } });
it('전체 저장 ACK 뒤에만 닫고 구사진 참조를 확인한다', async () => {
    const save = vi.fn(saved), close = vi.fn();
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ imagePath: 'new-path' }) });
    render(<ProductModal companyId="taebaek" initialData={baseItem} items={[]} onSave={save} onClose={close}/>);
    choosePhoto();
    fireEvent.click(screen.getByRole('button', { name: '수정 완료' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0]).toMatchObject({ image: 'https://new.example/photo', photoChanged: true });
    expect(deleteObject).toHaveBeenCalledExactlyOnceWith({ path: baseItem.imagePath });
});
it('미확정은 최초 사진과 초안을 유지하고 현재 문서가 없어도 삭제·재전송하지 않는다', async () => {
    const save = vi.fn(async (_p: unknown, progress: ItemEditorProgress): Promise<ItemEditorSaveResult> => ({ outcome: { status: 'unknown', message: '응답 미확인', nextAction: '현재 품목 확인' }, progress })), close = vi.fn();
    render(<ProductModal companyId="taebaek" initialData={baseItem} items={[]} onSave={save} onClose={close}/>);
    choosePhoto();
    fireEvent.click(screen.getByRole('button', { name: '수정 완료' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('응답 미확인'));
    expect(screen.getByRole('button', { name: '미완료 단계 이어하기' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '품목 정보 수정 닫기' }));
    expect(close).not.toHaveBeenCalled();
    expect(uploadBytes).toHaveBeenCalledOnce();
    expect(getDoc).not.toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
});
it('주업무 ACK 뒤 원가 미확정이면 관계 저장을 시작하지 않고 폼을 잠근다', async () => {
    const save = vi.fn(async (_p: unknown, progress: ItemEditorProgress): Promise<ItemEditorSaveResult> => {
        progress.confirmedStageIds.push('primary');
        progress.unknownStageId = 'cost';
        return { outcome: { status: 'partial', reason: 'followup-unconfirmed', committedIds: [progress.itemId], unconfirmedIds: [], message: '원가 결과 미확인', nextAction: '원가 확인 필요' }, progress };
    }), upsert = vi.fn(async () => {
    }), close = vi.fn();
    render(<ProductModal companyId="taebaek" initialData={baseItem} items={[]} onSave={save} onClose={close} onUpsertPartnerItem={upsert} partnerItems={[{ id: 'pi', itemId: baseItem.id, partnerId: 'partner', Direction: 'in' }]}/>);
    fireEvent.click(screen.getByRole('button', { name: '수정 완료' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('원가 결과 미확인'));
    expect(upsert).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue(baseItem.name).closest('fieldset')).toBeDisabled();
});
it('매입 연결 후속 ACK까지 전체 busy와 닫기 차단을 유지한다', async () => {
    let finish!: () => void;
    const relation = vi.fn((_row: PartnerItem) => new Promise<void>(resolve => finish = resolve)), close = vi.fn();
    render(<ProductModal companyId="taebaek" initialData={baseItem} items={[]} onSave={saved} onClose={close} onUpsertPartnerItem={relation} partnerItems={[{ id: 'pi', itemId: baseItem.id, partnerId: 'partner', Direction: 'in', price: 100, taxType: '과세' }]}/>);
    fireEvent.click(screen.getByRole('button', { name: '수정 완료' }));
    await waitFor(() => expect(relation).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: '저장 중…' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '품목 정보 수정 닫기' }));
    expect(close).not.toHaveBeenCalled();
    await act(async () => finish());
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(relation.mock.calls[0][0]).toMatchObject({ price: 100, taxType: '과세' });
});
it('전송 전 거절은 폼 수정 후 같은 사진 UUID를 재사용해 명시적으로 저장한다', async () => {
    const save = vi.fn(saved).mockImplementationOnce(async (_p, progress) => ({ outcome: { status: 'rejected', message: '입력 사전 확인 실패' }, progress })), close = vi.fn();
    render(<ProductModal companyId="taebaek" initialData={baseItem} items={[]} onSave={save} onClose={close}/>);
    choosePhoto();
    fireEvent.click(screen.getByRole('button', { name: '수정 완료' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('사전 확인 실패'));
    expect(screen.getByDisplayValue(baseItem.name).closest('fieldset')).not.toBeDisabled();
    fireEvent.change(screen.getByDisplayValue(baseItem.name), { target: { value: '수정된 이름' } });
    fireEvent.click(screen.getByRole('button', { name: '수정 완료' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(uploadBytes).toHaveBeenCalledOnce();
    expect(save.mock.calls[1][0]).toMatchObject({ name: '수정된 이름', imagePath: 'companies/taebaek/items/item-1/photo-photo-uuid.png' });
});
it('사진을 건드리지 않은 저장은 사진 변경으로 표시하지 않는다', async () => {
    const save = vi.fn(saved);
    render(<ProductModal companyId="taebaek" initialData={baseItem} items={[]} onSave={save} onClose={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button', { name: '수정 완료' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0]).toMatchObject({ photoChanged: false });
    expect(uploadBytes).not.toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
});
