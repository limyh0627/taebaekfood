import {ITEM_EDITOR_STAGES} from '../../../shared/itemEditorCommand';
/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Item } from '../../../shared/types';
import { createItemEditorProgress, type ItemEditorProgress, type ItemEditorSaveResult } from '../application/itemEditorSave';
const mock = vi.hoisted(() => ({ upload: vi.fn(), url: vi.fn(), remove: vi.fn(), read: vi.fn() }));
vi.mock('firebase/firestore', () => ({ doc: (_db: unknown, _collection: string, id: string) => ({ id }), getDoc: mock.read }));
vi.mock('firebase/storage', () => ({ ref: (_storage: unknown, path: string) => ({ path }), uploadBytes: mock.upload, getDownloadURL: mock.url, deleteObject: mock.remove }));
vi.mock('../../../shared/firebase', () => ({ db: {}, storage: {} }));
import { useItemPhotoSave, type ItemPhotoProduct } from './useItemPhotoSave';
const item: Item = { id: 'i', name: '합성', type: 'product', stock: 0, minStock: 0, unit: '병', image: 'old-url', imagePath: 'companies/taebaek/items/i/old.jpg' };
const input = () => ({ finalProduct: { ...item }, photoFile: new File(['photo'], 'new.png', { type: 'image/png' }), photoRemoved: false, bomDraft: [{ childId: 'child', qty: 2 }], progress: createItemEditorProgress(item.id), isCurrent: () => true });
const saved = async (_product: ItemPhotoProduct, progress: ItemEditorProgress): Promise<ItemEditorSaveResult> => {
    progress.confirmedStageIds.push(...ITEM_EDITOR_STAGES);
    return { outcome: { status: 'saved' }, progress };
};
beforeEach(() => {
    vi.resetAllMocks();
    mock.upload.mockResolvedValue(undefined);
    mock.url.mockResolvedValue('new-url');
    mock.remove.mockResolvedValue(undefined);
    mock.read.mockResolvedValue({ exists: () => false });
    vi.stubGlobal('crypto', { randomUUID: () => 'uuid' });
});
it('전체 ACK까지 busy를 유지하고 확정 후 구사진 참조를 확인한다', async () => {
    let finish!: () => void;
    const save = vi.fn(async (p: ItemPhotoProduct, progress: ItemEditorProgress) => {
        await new Promise<void>(resolve => finish = resolve);
        return saved(p, progress);
    });
    mock.read.mockResolvedValue({ exists: () => true, data: () => ({ imagePath: 'new-path' }) });
    const view = renderHook(() => useItemPhotoSave({ companyId: 'taebaek', initialData: item, onSave: save }));
    let task!: Promise<ItemEditorSaveResult>;
    act(() => {
        task = view.result.current.saveItemPhoto(input());
    });
    await act(async () => {
    });
    expect(view.result.current.saving).toBe(true);
    expect(mock.remove).not.toHaveBeenCalled();
    await act(async () => {
        finish();
        await task;
    });
    expect(mock.remove).toHaveBeenCalledExactlyOnceWith({ path: item.imagePath });
    expect(view.result.current.saving).toBe(false);
});
it('원격 결과 미확정은 현재 문서가 없어도 새사진을 삭제하거나 다시 전송하지 않는다', async () => {
    const save = vi.fn(async (_p: ItemPhotoProduct, progress: ItemEditorProgress): Promise<ItemEditorSaveResult> => ({ outcome: { status: 'unknown', message: '응답 미확인', nextAction: '현재 품목 확인' }, progress }));
    const view = renderHook(() => useItemPhotoSave({ companyId: 'taebaek', onSave: save })), submission = input();
    await act(async () => {
        await view.result.current.saveItemPhoto(submission);
        await view.result.current.saveItemPhoto(submission);
    });
    expect(save).toHaveBeenCalledOnce();
    expect(mock.upload).toHaveBeenCalledOnce();
    expect(mock.read).not.toHaveBeenCalled();
    expect(mock.remove).not.toHaveBeenCalled();
});
it('업로드 ACK 뒤 URL 준비 실패는 동일 UUID 경로를 재사용한다', async () => {
    mock.url.mockRejectedValueOnce(Error('일시 URL 실패')).mockResolvedValue('new-url');
    const view = renderHook(() => useItemPhotoSave({ companyId: 'taebaek', onSave: saved })), submission = input();
    await act(async () => {
        expect((await view.result.current.saveItemPhoto(submission)).outcome.status).toBe('rejected');
    });
    await act(async () => {
        await view.result.current.saveItemPhoto(submission);
    });
    expect(mock.upload).toHaveBeenCalledOnce();
    expect(mock.url).toHaveBeenCalledTimes(2);
    expect(mock.remove).not.toHaveBeenCalled();
});
it('업로드 대기 중 scope가 바뀌면 품목·후속 저장과 파일 삭제를 시작하지 않는다', async () => {
    let finish!: () => void, current = true;
    mock.upload.mockImplementation(() => new Promise<void>(resolve => finish = resolve));
    const save = vi.fn(saved), view = renderHook(() => useItemPhotoSave({ companyId: 'taebaek', onSave: save }));
    let task!: Promise<ItemEditorSaveResult>;
    act(() => {
        task = view.result.current.saveItemPhoto({ ...input(), isCurrent: () => current });
    });
    current = false;
    await act(async () => {
        finish();
        await task;
    });
    expect(save).not.toHaveBeenCalled();
    expect(mock.remove).not.toHaveBeenCalled();
});
it('같은 파일과 품목이라도 회사·계정 세션 변경 뒤 옛 경로를 재사용하지 않는다', async () => {
    const save = vi.fn(saved), submission = input(), view = renderHook((props: {
        companyId: 'taebaek' | 'punghoe';
        scopeKey: string;
    }) => useItemPhotoSave({ ...props, onSave: save }), { initialProps: { companyId: 'taebaek', scopeKey: 'actor1' } });
    await act(async () => {
        await view.result.current.saveItemPhoto(submission);
    });
    view.rerender({ companyId: 'punghoe', scopeKey: 'actor2' });
    await act(async () => {
        await view.result.current.saveItemPhoto({ ...submission, progress: createItemEditorProgress('i') });
    });
    expect(mock.upload).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0].imagePath).toBe('companies/punghoe/items/i/photo-uuid.png');
});
it.each(['throw', 'invalid'] as const)('런타임 %s 결과도 최초 사진과 미확정 표식을 보존하여 재전송하지 않는다', async (kind) => {
    const save = kind === 'throw' ? vi.fn().mockRejectedValue(Error('응답 예외')) : vi.fn().mockResolvedValue(undefined), view = renderHook(() => useItemPhotoSave({ companyId: 'taebaek', onSave: save })), submission = input();
    await act(async () => {
        expect((await view.result.current.saveItemPhoto(submission)).outcome.status).toBe('unknown');
    });
    await act(async () => {
        await view.result.current.saveItemPhoto(submission);
    });
    expect(submission.progress.unknownStageId).toBe('save-result');
    expect(save).toHaveBeenCalledOnce();
    expect(mock.upload).toHaveBeenCalledOnce();
    expect(mock.remove).not.toHaveBeenCalled();
});
it('품목 단계만 ACK한 응답을 전체 저장 성공으로 처리하거나 구사진을 삭제하지 않는다',async()=>{
 const save=vi.fn(async(_product:ItemPhotoProduct,progress:ItemEditorProgress):Promise<ItemEditorSaveResult>=>{progress.confirmedStageIds=['primary'];return {progress,outcome:{status:'saved'}};});
 const view=renderHook(()=>useItemPhotoSave({companyId:'taebaek',initialData:item,onSave:save}));let result:ItemEditorSaveResult|undefined;
 await act(async()=>{result=await view.result.current.saveItemPhoto(input());});
 expect(result?.outcome.status).toBe('unknown');expect(result?.progress.unknownStageId).toBe('save-result');expect(mock.read).not.toHaveBeenCalled();expect(mock.remove).not.toHaveBeenCalled();
});
