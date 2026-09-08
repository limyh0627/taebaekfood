/** @vitest-environment jsdom */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import TradeStatement from './TradeStatement';
import type { IssuedStatement, Item, Partner, PartnerItem } from '../src/shared/types';

// 운영 DB에 닿지 않고 저장 콜백의 완료·실패에 따른 화면 동작을 검증한다.
vi.mock('../src/shared/services/firebaseService', () => ({ fetchCollection: vi.fn(async () => []) }));
vi.mock('../src/features/admin/useVoucherLedger', () => ({
  useVoucherLedger: ({ issuedStatements }: { issuedStatements: IssuedStatement[] }) => ({
    mergedStatements: issuedStatements, journalBySource: new Map(), partnerBalances: new Map(),
    getBalance: () => 0, canSettle: () => false, isVouchered: () => false,
    isFetchingHistory: false, forgetStatement: vi.fn(),
  }),
}));
vi.mock('./CashLedger', () => ({ AccountModal: () => null }));
vi.mock('./voucher/VoucherComposer', () => ({ default: () => null }));

const item = { id: 'loose', name: '같은 이름', spec: '300ml', type: 'product' } as Item;
const partner = { id: 'partner', name: '진단 거래처', role: '매입' } as unknown as Partner;
const price = { id: 'pi', itemId: item.id, partnerId: partner.id, Direction: 'in', price: 6000,
  taxType: '과세', Account_Code: '500' } as PartnerItem;
const pendingInvoice = { partnerId: partner.id, partnerName: partner.name,
  items: [{ itemId: item.id, name: item.name, spec: item.spec!, qty: 1, price: 6000 }] };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

function setup(onAddIssuedStatement = vi.fn(async (_s: IssuedStatement) => {}),
  onUpsertPartnerItem = vi.fn(async (_p: PartnerItem) => {}),
  extra: Partial<React.ComponentProps<typeof TradeStatement>> = {}) {
  render(<TradeStatement orders={[]} allItems={[{ ...item, id: 'box' }, item]}
    partners={[partner]} partnerItems={[price]} issuedStatements={[]}
    pendingInvoice={pendingInvoice} onAddIssuedStatement={onAddIssuedStatement}
    onUpsertPartnerItem={onUpsertPartnerItem} {...extra} />);
  return { onAddIssuedStatement, onUpsertPartnerItem };
}

beforeEach(() => {
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('전표와 거래처 단가의 저장 완료', () => {
  it('기존 전표 수정도 ID와 과세 변경을 보존하고 단가 저장 완료까지 기다린다', async () => {
    const gate = deferred();
    const upsert = vi.fn((_p: PartnerItem) => gate.promise);
    const update = vi.fn(async (_id: string, _data: Partial<IssuedStatement>) => {});
    const stmt = { id: 'existing', docNo: '260908-99', partnerId: partner.id, partnerName: partner.name,
      tradeDate: '2026-09-08', issuedAt: '2026-09-08T00:00:00Z', type: '매입', orderId: '',
      totalSupply: 5455, totalTax: 545, totalAmount: 6000,
      items: [{ itemId: item.id, name: item.name, spec: item.spec, qty: 1, price: 6000,
        supply: 5455, tax: 545, total: 6000, isTaxExempt: false, accountCode: '500' }],
    } as IssuedStatement;
    setup(undefined, upsert, { pendingInvoice: null, issuedStatements: [stmt], focusDocNo: stmt.docNo,
      onUpdateIssuedStatement: update });
    fireEvent.click((await screen.findAllByText(stmt.partnerName)).find(el => el.closest('tr'))!);
    await waitFor(() => expect(document.querySelector('fieldset')).not.toBeNull());
    const modal = within(document.querySelector('fieldset')!);
    fireEvent.click(modal.getByRole('button', { name: '수정' }));
    fireEvent.click(modal.getByRole('button', { name: '545' }));
    fireEvent.click(modal.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][1].items?.[0]).toMatchObject({ itemId: 'loose', isTaxExempt: true });
    expect(upsert.mock.calls[0][0]).toMatchObject({ itemId: 'loose', taxType: '면세' });
    expect(modal.getByRole('button', { name: '저장 중…' })).toBeDisabled();
    await act(async () => { gate.resolve(); await gate.promise; });
    await waitFor(() => expect(document.querySelector('fieldset')).toBeNull());
  });

  it('단가 저장이 끝날 때까지 창과 입력을 잠그고, 선택한 ID를 보존한다', async () => {
    const gate = deferred();
    const upsert = vi.fn((_p: PartnerItem) => gate.promise);
    const { onAddIssuedStatement } = setup(undefined, upsert);
    fireEvent.click(await screen.findByRole('button', { name: '저장' }));
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    expect(onAddIssuedStatement.mock.calls[0][0].items[0].itemId).toBe('loose');
    expect(upsert.mock.calls[0][0]).toMatchObject({ itemId: 'loose', price: 6000, taxType: '과세' });
    expect(screen.getByRole('button', { name: '저장 중…' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '저장 중…' }));
    expect(onAddIssuedStatement).toHaveBeenCalledTimes(1);
    await act(async () => { gate.resolve(); await gate.promise; });
    await waitFor(() => expect(screen.queryByRole('button', { name: '새 전표' })).not.toBeInTheDocument());
  });

  it('단가 저장 실패 후 다시 저장해도 같은 전표 ID와 번호를 쓴다', async () => {
    const upsert = vi.fn(async (_p: PartnerItem) => {});
    upsert.mockRejectedValueOnce(new Error('단가 저장 실패'));
    const { onAddIssuedStatement } = setup(undefined, upsert);
    fireEvent.click(await screen.findByRole('button', { name: '저장' }));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('입력 내용은 유지됩니다')));
    expect(screen.getByRole('button', { name: '새 전표' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(onAddIssuedStatement).toHaveBeenCalledTimes(2));
    const [first, second] = onAddIssuedStatement.mock.calls.map(c => c[0]);
    expect(second.id).toBe(first.id);
    expect(second.docNo).toBe(first.docNo);
    await waitFor(() => expect(screen.queryByRole('button', { name: '새 전표' })).not.toBeInTheDocument());
  });

  it('전표 저장이 실패하면 단가를 쓰지 않고 입력창을 유지한다', async () => {
    const save = vi.fn(async (_s: IssuedStatement) => { throw new Error('전표 저장 실패'); });
    const { onUpsertPartnerItem } = setup(save);
    fireEvent.click(await screen.findByRole('button', { name: '저장' }));
    await waitFor(() => expect(window.alert).toHaveBeenCalled());
    expect(onUpsertPartnerItem).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '새 전표' })).toBeInTheDocument();
  });
});
