/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ProductionWorkDocumentEditor, { type ProductionWorkDocumentEditorProps } from './ProductionWorkDocumentEditor';
import { newProductionWorkDocument } from '../domain/productionWorkDocument';

vi.mock('../../../shared/components/appDialog', () => ({
  appConfirm: vi.fn().mockResolvedValue(true), appNotice: vi.fn().mockResolvedValue(undefined),
}));
const document = newProductionWorkDocument('taebaek', '2026-09-22', 'employee', '2026-09-27T00:00:00Z');

describe('직원 생산작업일지 작성', () => {
  it('직원도 수동 행·이름을 보완하고 문서 리비전과 함께 저장한다', async () => {
    const save = vi.fn<ProductionWorkDocumentEditorProps['onSave']>(async (doc, lines, _expectedRevision) => ({ document: { ...doc, revision: 1 }, lines }));
    render(<ProductionWorkDocumentEditor initialDocument={document} initialLines={[]} loadEvidence={async () => []} onSave={save} />);
    fireEvent.click(screen.getByRole('button', { name: '행 추가' }));
    fireEvent.change(screen.getByLabelText('1행 품목명'), { target: { value: '수동 보완 품목' } });
    fireEvent.change(screen.getByLabelText('작성 이름'), { target: { value: '직원' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0].preparedByName).toBe('직원');
    expect(save.mock.calls[0][1][0].itemNameSnapshot).toBe('수동 보완 품목');
    expect(save.mock.calls[0][2]).toBe(0);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('저장 버전 1'));
  });
  it('저장 충돌 시 입력 내용을 유지하고 성공으로 표시하지 않는다', async () => {
    const save = vi.fn().mockRejectedValue(new Error('다른 직원이 먼저 저장했습니다.'));
    render(<ProductionWorkDocumentEditor initialDocument={document} initialLines={[]} loadEvidence={async () => []} onSave={save} />);
    fireEvent.change(screen.getByLabelText('특이사항'), { target: { value: '보존할 내용' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect((screen.getByLabelText('특이사항') as HTMLTextAreaElement).value).toBe('보존할 내용');
    expect(screen.getByRole('status').textContent).toContain('저장하지 않은 변경 있음');
  });
  it('같은 생산의 원료 행을 추가하면 생산량을 공유하고 원료 칸은 따로 받는다', async () => {
    const save = vi.fn<ProductionWorkDocumentEditorProps['onSave']>(async (doc, lines, _revision) => ({ document: doc, lines }));
    render(<ProductionWorkDocumentEditor initialDocument={document} initialLines={[]} loadEvidence={async () => []} onSave={save} />);
    fireEvent.click(screen.getByRole('button', { name: '행 추가' }));
    fireEvent.change(screen.getByLabelText('1행 생산량'), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: '원료 행 추가' }));
    expect(screen.queryByLabelText('2행 생산량')).toBeNull();
    fireEvent.change(screen.getByLabelText('1행 생산량'), { target: { value: '990' } });
    fireEvent.change(screen.getByLabelText('2행 원료명'), { target: { value: '두 번째 원료' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const rows = save.mock.calls[0][1];
    expect(rows.map(row => row.productionQty)).toEqual([990, 990]);
    expect(rows[1].batchKey).toBe(rows[0].batchKey);
    expect(rows[0].rawNameSnapshot).toBe('');
    expect(rows[1].rawNameSnapshot).toBe('두 번째 원료');
  });
});
