// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ServiceTerms } from './ItemManager';
import type { AccountCode, AccountGroup, Item, PartnerItem } from '../src/shared/types';

const item = { id: 'fee', name: '임가공비', type: 'service' } as Item;
const groups = [{ id: 'expense', type: '비용' }, { id: 'revenue', type: '수익' }] as AccountGroup[];
const codes = [
  { id: 'ac-540', code: '540', name: '외주가공비', groupId: 'expense' },
  { id: 'ac-828', code: '828', name: '지급수수료', groupId: 'expense' },
  { id: 'ac-404', code: '404', name: '제품매출', groupId: 'revenue' },
  { id: 'ac-410', code: '410', name: '용역매출', groupId: 'revenue' },
] as AccountCode[];

describe('거래처별 용역 조건 입력', () => {
  it('매입 연결에 단가·과세·계정만 저장하고 매출 연결은 건드리지 않는다', async () => {
    const save = vi.fn(async (_value: PartnerItem) => {});
    render(<ServiceTerms item={item} partnerId="p1" direction="in" accountCodes={codes} accountGroups={groups} onSave={save} />);
    expect(screen.queryByRole('option', { name: /404/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('spinbutton', { name: '용역 단가' }), { target: { value: '11000' } });
    fireEvent.change(screen.getByRole('combobox', { name: '용역 과세 여부' }), { target: { value: '과세' } });
    fireEvent.change(screen.getByRole('combobox', { name: '용역 계정과목' }), { target: { value: '540' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toMatchObject({ itemId: 'fee', partnerId: 'p1', Direction: 'in', price: 11000,
      taxType: '과세', Account_Code: '540' });
  });
  it('매출 용역 조건은 매출 계정으로 저장한다', async () => {
    const save = vi.fn(async (_value: PartnerItem) => {});
    render(<ServiceTerms item={item} partnerId="p1" direction="out" accountCodes={codes} accountGroups={groups} onSave={save} />);
    expect(screen.queryByRole('option', { name: /540/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('spinbutton', { name: '용역 단가' }), { target: { value: '22000' } });
    fireEvent.change(screen.getByRole('combobox', { name: '용역 과세 여부' }), { target: { value: '면세' } });
    fireEvent.change(screen.getByRole('combobox', { name: '용역 계정과목' }), { target: { value: '410' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toMatchObject({ Direction: 'out', price: 22000, taxType: '면세', Account_Code: '410' });
  });
  it('필수 거래조건이 비면 앱 알림으로 안내하고 저장하지 않는다', async () => {
    const save = vi.fn();
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    try {
      render(<ServiceTerms item={item} partnerId="p1" direction="in" accountCodes={codes} accountGroups={groups} onSave={save} />);
      fireEvent.click(screen.getByRole('button', { name: '저장' }));
      await waitFor(() => expect(alert).toHaveBeenCalledWith('용역 단가, 과세 여부, 계정과목을 모두 선택해 주세요.'));
      expect(save).not.toHaveBeenCalled();
    } finally { alert.mockRestore(); }
  });
  it('저장 실패를 알리고 입력값을 유지해 재시도할 수 있다', async () => {
    const save = vi.fn(async (_value: PartnerItem) => { throw new Error('권한 없음'); });
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    try {
      render(<ServiceTerms item={item} partnerId="p1" direction="in" accountCodes={codes} accountGroups={groups} onSave={save} />);
      fireEvent.change(screen.getByRole('spinbutton', { name: '용역 단가' }), { target: { value: '11000' } });
      fireEvent.change(screen.getByRole('combobox', { name: '용역 과세 여부' }), { target: { value: '과세' } });
      fireEvent.change(screen.getByRole('combobox', { name: '용역 계정과목' }), { target: { value: '540' } });
      fireEvent.click(screen.getByRole('button', { name: '저장' }));
      await waitFor(() => expect(alert).toHaveBeenCalledWith(expect.stringContaining('권한 없음')));
      expect(screen.getByRole('spinbutton', { name: '용역 단가' })).toHaveValue(11000);
      expect(screen.getByRole('button', { name: '저장' })).toBeEnabled();
    } finally { alert.mockRestore(); }
  });
});
