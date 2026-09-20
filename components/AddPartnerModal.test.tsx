/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AddPartnerModal from './AddPartnerModal';

describe('신규 거래처 주소', () => {
  it('주소 아래에서 상세주소를 입력해 거래처에 저장한다', () => {
    const save = vi.fn();
    render(<AddPartnerModal onClose={vi.fn()} onSave={save} />);

    fireEvent.change(screen.getByPlaceholderText('예: 태백물산'), { target: { value: '새 거래처' } });
    fireEvent.change(screen.getByLabelText('상세주소'), { target: { value: '가동 201호' } });
    fireEvent.click(screen.getByRole('button', { name: '등록 완료' }));

    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      name: '새 거래처',
      addressDetail: '가동 201호',
    }));
  });
});
