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
    fireEvent.change(screen.getByLabelText('기본 배송방식'), { target: { value: '수령' } });
    fireEvent.click(screen.getByRole('button', { name: '등록 완료' }));

    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      name: '새 거래처',
      addressDetail: '가동 201호',
    }));
  });
});

for (const role of ['매출처','매출+매입처']) it(role+' 신규 등록은 배송방식을 직접 선택해야 한다',()=>{
 const save=vi.fn();render(<AddPartnerModal onClose={vi.fn()} onSave={save}/>);
 fireEvent.change(screen.getByPlaceholderText('예: 태백물산'),{target:{value:'가상 거래처'}});
 fireEvent.click(screen.getByRole('button',{name:role}));
 expect(screen.getByLabelText('기본 배송방식')).toHaveValue('');
 fireEvent.click(screen.getByRole('button',{name:'등록 완료'}));expect(save).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toHaveTextContent('기본 배송방식을 선택해 주세요.');
 fireEvent.change(screen.getByLabelText('기본 배송방식'),{target:{value:'화물'}});
 fireEvent.click(screen.getByRole('button',{name:'등록 완료'}));expect(save).toHaveBeenCalledWith(expect.objectContaining({defaultShipMethod:'화물',partnerType:role}));
});
for(const role of ['매입처','금융기관']) it(role+' 신규 등록은 배송방식이 필요 없다',()=>{
 const save=vi.fn();render(<AddPartnerModal onClose={vi.fn()} onSave={save}/>);
 fireEvent.change(screen.getByPlaceholderText('예: 태백물산'),{target:{value:'가상 거래처'}});
 fireEvent.click(screen.getByRole('button',{name:role}));expect(screen.queryByLabelText('기본 배송방식')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'등록 완료'}));expect(save).toHaveBeenCalledOnce();expect(save.mock.calls[0][0]).not.toHaveProperty('defaultShipMethod');
});
