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

  it('옛 태백식품 설정에는 거래명세서 계좌를 채워 보여준다', () => {
    render(<StatementCompanyDialog
      initial={{ name: '태백식품', ceoName: '임기주', bizNo: '139-04-37157', bizType: '제조 도소매', bizItem: '참기름 외', address: '안산' }}
      onClose={() => {}}/>);

    expect(screen.getByLabelText('계좌번호')).toHaveValue('농협 351-0526-3164-13 ; 임기주(태백식품)');
  });
});
