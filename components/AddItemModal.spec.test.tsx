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

const item = { id: 'spec-item', name: '생들기름-캔', type: 'wip', category: '들기름', 품목: '생들기름', stock: 0, minStock: 10, unit: '개', spec: '350ml', cost: 190004 } as any;
describe('규격 숫자·단위 입력', () => {
  beforeEach(() => { getDoc.mockResolvedValue({ exists: () => false }); });
  it.each([['16.5kg', '16.5kg'], ['400g', '400g'], ['2L', '2L']])('단위 포함 %s를 붙여넣어도 단위를 중복하지 않는다', async (entered, expected) => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ProductModal companyId="taebaek" initialData={item} items={[]} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('예: 350'), { target: { value: entered } });
    fireEvent.click(screen.getByRole('button', { name: '수정 완료' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ spec: expected, cost: 190004, stock: 0 })));
  });
  it('박스 꼬리는 보존하고 유효하지 않은 단위 문자열은 받지 않는다', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ProductModal companyId="taebaek" initialData={{ ...item, spec: '350ml * 20' }} items={[]} onSave={onSave} onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('예: 350');
    fireEvent.change(input, { target: { value: '16.5kg' } });
    fireEvent.change(input, { target: { value: '16.5kgml' } });
    fireEvent.click(screen.getByRole('button', { name: '수정 완료' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ spec: '16.5kg * 20' })));
  });
});