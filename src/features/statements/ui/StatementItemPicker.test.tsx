/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Item, PartnerItem } from '../../../../types';
import StatementItemPicker from './StatementItemPicker';

const item = { id: 'item-1', name: '기장료', spec: '' } as Item;
const pc = { id: 'pi-1', itemId: 'item-1', partnerId: 'partner-1', taxType: '면세' } as PartnerItem;
const base = {
  rows: [{ product: item, pc }], search: '', quantities: {}, priceEdits: {}, priceSaveState: {},
  linkedItemIds: new Set(['item-1']), onSearchChange: vi.fn(), onToggleItem: vi.fn(),
  onQuantityChange: vi.fn(), onPriceChange: vi.fn(), onSavePrice: vi.fn(), onSetTax: vi.fn(),
  onClose: vi.fn(), onConfirm: vi.fn(),
};

describe('전표 품목 선택 과세유형', () => {
  it('버튼 순환 대신 미설정·과세·면세 중 직접 고른다', () => {
    const onSetTax = vi.fn();
    render(<StatementItemPicker {...base} onSetTax={onSetTax} />);
    const select = screen.getByRole('combobox', { name: '기장료 과세유형' });
    expect(select).toHaveValue('면세');
    fireEvent.change(select, { target: { value: '과세' } });
    expect(onSetTax).toHaveBeenCalledWith(pc, '과세');
    fireEvent.change(select, { target: { value: '' } });
    expect(onSetTax).toHaveBeenCalledWith(pc, null);
  });

  it('미연결 품목은 연결 전까지 단가 저장 버튼을 보여주지 않는다', () => {
    render(<StatementItemPicker {...base} linkedItemIds={new Set()} />);
    expect(screen.getByText('미연결')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '저장' })).not.toBeInTheDocument();
  });
});
