/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import StatementCompanyDialog from './StatementCompanyDialog';

describe('전표 회사정보 설정 창', () => {
  it('현재 정보를 복사해 편집하고 저장값을 부모에 한 번 전달한다', () => {
    const save = vi.fn();
    const close = vi.fn();
    render(<StatementCompanyDialog
      initial={{ name: '태백식품', ceoName: '임', bizNo: '1', bizType: '제조', bizItem: '식품', address: '옛 주소', phone: '1' }}
      onSave={save} onClose={close}/>);

    fireEvent.change(screen.getByLabelText('사업장 주소'), { target: { value: '새 주소' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: '태백식품', address: '새 주소' }));
    expect(save).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
