/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Item } from '../../../shared/types';
const mock = vi.hoisted(() => ({ upload: vi.fn(), url: vi.fn(), remove: vi.fn(), read: vi.fn() }));
vi.mock('firebase/firestore', () => ({ doc: (_db: unknown, _collection: string, id: string) => ({ id }), getDoc: mock.read }));
vi.mock('firebase/storage', () => ({ ref: (_storage: unknown, path: string) => ({ path }), uploadBytes: mock.upload, getDownloadURL: mock.url, deleteObject: mock.remove }));
vi.mock('../../../shared/firebase', () => ({ db: {}, storage: {} }));
import { useItemPhotoSave } from './useItemPhotoSave';
const item: Item = { id: 'i', name: '합성', type: 'product', stock: 0, minStock: 0, unit: '병', image: 'old-url', imagePath: 'companies/taebaek/items/i/old.jpg' };
const path = 'companies/taebaek/items/i/photo-uuid.png';
const input = () => ({ finalProduct: { ...item }, photoFile: new File(['photo'], 'new.png', { type: 'image/png' }), photoRemoved: false, bomDraft: [{ childId: 'child', qty: 2 }] });
beforeEach(() => { vi.resetAllMocks(); mock.upload.mockResolvedValue(undefined); mock.url.mockResolvedValue('new-url'); mock.remove.mockResolvedValue(undefined); mock.read.mockResolvedValue({ exists: () => false }); vi.stubGlobal('crypto', { randomUUID: () => 'uuid' }); vi.spyOn(window, 'alert').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });
it('업로드→품목 ACK→구사진 참조조회·삭제 순서와 busy 수명을 유지한다', async () => {
 const events: string[] = []; let finish!: () => void; mock.upload.mockImplementation(() => { events.push('upload'); return new Promise<void>(resolve => { finish = resolve; }); }); mock.read.mockImplementation(async () => { events.push('read'); return { exists: () => true, data: () => ({ imagePath: path }) }; }); mock.remove.mockImplementation(async () => { events.push('remove'); }); const save = vi.fn(async () => { events.push('save'); });
 const view = renderHook(() => useItemPhotoSave({ companyId: 'taebaek', initialData: item, onSave: save })); let pending!: Promise<boolean>; act(() => { pending = view.result.current.saveItemPhoto(input()); }); expect(view.result.current.saving).toBe(true); expect(view.result.current.savingRef.current).toBe(true); expect(save).not.toHaveBeenCalled(); let success = false; await act(async () => { finish(); success = await pending; });
 expect(success).toBe(true); expect(events).toEqual(['upload', 'save', 'read', 'remove']); expect(save).toHaveBeenCalledWith(expect.objectContaining({ image: 'new-url', imagePath: path, photoChanged: true, bomDraft: [{ childId: 'child', qty: 2 }] })); expect(mock.remove).toHaveBeenCalledWith({ path: item.imagePath }); expect(view.result.current.saving).toBe(false); expect(view.result.current.savingRef.current).toBe(false);
});
it.each(['referenced', 'unknown', 'absent'] as const)('저장 실패의 사진 상태 %s를 구분해 참조중·불확실 파일을 보존한다', async state => {
 if (state === 'unknown') mock.read.mockRejectedValue(Error('조회 실패')); else mock.read.mockResolvedValue({ exists: () => state === 'referenced', data: () => ({ imagePath: path }) });
 const view = renderHook(() => useItemPhotoSave({ companyId: 'taebaek', initialData: item, onSave: vi.fn(async () => { throw Error('저장 실패'); }) })); let success = true; await act(async () => { success = await view.result.current.saveItemPhoto(input()); }); expect(success).toBe(false); expect(view.result.current.saving).toBe(false); expect(view.result.current.savingRef.current).toBe(false);
 if (state === 'absent') expect(mock.remove).toHaveBeenCalledExactlyOnceWith({ path }); else { expect(mock.remove).not.toHaveBeenCalled(); expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('파일은 유지')); }
});
it('구사진을 다시 참조하는 경우 삭제하지 않는다', async () => {
 mock.read.mockResolvedValue({ exists: () => true, data: () => ({ imagePath: item.imagePath }) }); const view = renderHook(() => useItemPhotoSave({ companyId: 'taebaek', initialData: item, onSave: vi.fn() })); await act(async () => { await view.result.current.saveItemPhoto({ ...input(), photoFile: null, photoRemoved: true }); }); expect(mock.remove).not.toHaveBeenCalled();
});
