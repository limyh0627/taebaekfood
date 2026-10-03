/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

describe('품목 사진 저장', () => {
  beforeEach(() => {
    uploadBytes.mockReset().mockResolvedValue({});
    getDownloadURL.mockReset().mockResolvedValue('https://new.example/photo');
    deleteObject.mockReset().mockResolvedValue(undefined);
    getDoc.mockReset().mockResolvedValue({ exists: () => false });
    vi.stubGlobal('crypto', { randomUUID: () => 'photo-uuid' });
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:preview', revokeObjectURL: vi.fn() });
  });

  it('교체 사진을 저장한 뒤 기존 자기 회사 파일만 삭제한다', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ imagePath: 'companies/taebaek/items/item-1/photo-photo-uuid.png' }) });
    render(<ProductModal companyId="taebaek" initialData={baseItem} items={[]} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('품목 사진 선택'), { target: { files: [new File(['photo'], 'new.png', { type: 'image/png' })] } });
    fireEvent.click(screen.getByRole('button', { name: '수정 완료' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ image: 'https://new.example/photo', imagePath: 'companies/taebaek/items/item-1/photo-photo-uuid.png' })));
    await waitFor(() => expect(deleteObject).toHaveBeenCalledWith({ path: baseItem.imagePath }));
  });

  it('품목 저장에 실패하면 새 파일을 삭제하고 기존 사진을 유지한다', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('품목 저장 실패'));
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<ProductModal companyId="taebaek" initialData={baseItem} items={[]} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('품목 사진 선택'), { target: { files: [new File(['photo'], 'new.png', { type: 'image/png' })] } });
    fireEvent.click(screen.getByRole('button', { name: '수정 완료' }));
    await waitFor(() => expect(deleteObject).toHaveBeenCalledWith({ path: 'companies/taebaek/items/item-1/photo-photo-uuid.png' }));
    expect(deleteObject).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith('품목 저장 실패');
  });

  it('품목 쓰기 이후 후속 처리만 실패하면 저장된 사진을 지우지 않는다', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('후속 처리 실패'));
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ imagePath: 'companies/taebaek/items/item-1/photo-photo-uuid.png' }) });
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<ProductModal companyId="taebaek" initialData={baseItem} items={[]} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('품목 사진 선택'), { target: { files: [new File(['photo'], 'new.png', { type: 'image/png' })] } });
    fireEvent.click(screen.getByRole('button', { name: '수정 완료' }));
    await waitFor(() => expect(getDoc).toHaveBeenCalled());
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it('사진을 건드리지 않은 편집은 사진 변경으로 표시하지 않는다', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ProductModal companyId="taebaek" initialData={baseItem} items={[]} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '수정 완료' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ photoChanged: false })));
    expect(uploadBytes).not.toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it('사진 삭제는 빈 참조를 저장한 뒤 구 파일을 삭제한다', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ imagePath: '' }) });
    render(<ProductModal companyId="taebaek" initialData={baseItem} items={[]} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '사진 삭제' }));
    fireEvent.click(screen.getByRole('button', { name: '수정 완료' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ image: '', imagePath: '', photoChanged: true })));
    await waitFor(() => expect(deleteObject).toHaveBeenCalledWith({ path: baseItem.imagePath }));
  });

  it('다른 편집자가 구 사진을 다시 참조하면 그 파일은 삭제하지 않는다', async () => {
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ imagePath: baseItem.imagePath }) });
    render(<ProductModal companyId="taebaek" initialData={baseItem} items={[]} onSave={vi.fn().mockResolvedValue(undefined)} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '사진 삭제' }));
    fireEvent.click(screen.getByRole('button', { name: '수정 완료' }));
    await waitFor(() => expect(getDoc).toHaveBeenCalled());
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it('파일 업로드 중에는 배경과 닫기 버튼으로 편집창을 닫지 않는다', async () => {
    let completeUpload!: () => void;
    uploadBytes.mockReturnValue(new Promise<void>(resolve => { completeUpload = resolve; }));
    const onClose = vi.fn();
    render(<ProductModal companyId="taebaek" initialData={baseItem} items={[]} onSave={vi.fn()} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('품목 사진 선택'), { target: { files: [new File(['photo'], 'new.png', { type: 'image/png' })] } });
    fireEvent.click(screen.getByRole('button', { name: '수정 완료' }));
    await waitFor(() => expect(uploadBytes).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '품목 정보 수정 닫기' }));
    expect(onClose).not.toHaveBeenCalled();
    completeUpload();
  });
});
