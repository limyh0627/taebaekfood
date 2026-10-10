/** @vitest-environment jsdom */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import TradeStatement, { VoucherDateChip } from './TradeStatement';
import type { IssuedStatement, Item, Partner, PartnerItem, Settlement } from '../src/shared/types';
import { appConfirm } from '../src/shared/components/appDialog';
import { OrderStatus, type Order } from '../src/shared/types';

const issueMocks=vi.hoisted(()=>({payment:vi.fn(),print:vi.fn()}));
vi.mock('../src/features/statements/infrastructure/statementPrint',async(importOriginal)=>({...await importOriginal<typeof import('../src/features/statements/infrastructure/statementPrint')>(),printStatementViaIframe:issueMocks.print}));
vi.mock('../src/features/statements/infrastructure/issueTradeStatementCommand',async(importOriginal)=>({...await importOriginal<typeof import('../src/features/statements/infrastructure/issueTradeStatementCommand')>(),recordPartnerPayment:issueMocks.payment}));
vi.mock('../src/shared/firebase',()=>({auth:{currentUser:{uid:'test-uid'}},db:{}}));

// 운영 DB에 닿지 않고 저장 콜백의 완료·실패에 따른 화면 동작을 검증한다.
vi.mock('../src/shared/services/firebaseService', () => ({ fetchCollection: vi.fn(async () => []) }));
vi.mock('../src/features/admin/useVoucherLedger', () => ({
  useVoucherLedger: ({ issuedStatements }: { issuedStatements: IssuedStatement[] }) => ({
    mergedStatements: issuedStatements, journalBySource: new Map(), partnerBalances: new Map(), partnerJournals: [],
    getBalance: (statement:IssuedStatement) => statement.totalAmount, canSettle: () => false, isVouchered: () => false,
    isFetchingHistory: false, forgetStatement: vi.fn(),
  }),
}));
vi.mock('./CashLedger', () => ({ AccountModal: () => null }));
vi.mock('./voucher/VoucherComposer', () => ({ default: () => null }));
vi.mock('../src/shared/components/appDialog', () => ({
  appConfirm: vi.fn(async () => true),
  appPrompt: vi.fn(async () => null),
  appNotice: vi.fn(async () => {}),
}));

const item = { id: 'loose', name: '같은 이름', spec: '300ml', type: 'product' } as Item;
const partner = { id: 'partner', name: '진단 거래처', role: '매입' } as unknown as Partner;
const price = { id: 'pi', itemId: item.id, partnerId: partner.id, Direction: 'in', price: 6000,
  taxType: '과세', Account_Code: '500' } as PartnerItem;
const pendingInvoice = { partnerId: partner.id, partnerName: partner.name,
  items: [{ itemId: item.id, name: item.name, spec: item.spec!, qty: 1, price: 6000 }] };

describe('주문 전표 제외 기록', () => {
  const order = { id: 'excluded-order', partnerId: partner.id, partnerName: partner.name,
    status: OrderStatus.PENDING, createdAt: new Date().toISOString(),
    items: [{ itemId: item.id, name: item.name, quantity: 1, price: 1000 }] } as Order;
  function openSale(extra: Partial<React.ComponentProps<typeof TradeStatement>>) {
    setup(undefined, undefined, { pendingInvoice: null, orders: [order], ...extra });
    fireEvent.click(screen.getByRole('button', { name: '거래명세서' }));
    fireEvent.click(screen.getByRole('button', { name: '매출전표' }));
  }
  it('신규 제외는 필수 사유와 현재 사용자 ID를 함께 저장한다', async () => {
    const update = vi.fn(async () => {});
    openSale({ onUpdateOrder: update, currentUserId: 'employee-17' });
    fireEvent.click(screen.getByRole('button', { name: '전표 제외' }));
    const save = screen.getByRole('button', { name: '제외 저장' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('예: 샘플 제공, 무상 출고, 전표 발행하지 않기로 협의'), { target: { value: '   ' } });
    expect(save).toBeDisabled();
    expect(update).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText('예: 샘플 제공, 무상 출고, 전표 발행하지 않기로 협의'), { target: { value: '  샘플 제공  ' } });
    fireEvent.click(save);
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update.mock.calls[0]).toEqual([order.id, {
      accountingExcluded: true, accountingExclusionReason: '샘플 제공',
      accountingExcludedAt: expect.any(String), accountingExcludedBy: 'employee-17',
    }]);
  });
  it('복구는 제외 플래그와 사유·시각·작성자를 모두 비운다', async () => {
    const update = vi.fn(async () => {});
    openSale({ onUpdateOrder: update, orders: [{ ...order, accountingExcluded: true,
      accountingExclusionReason: '샘플 제공', accountingExcludedAt: '2026-10-01T00:00:00Z', accountingExcludedBy: 'old-user' }] });
    fireEvent.click(screen.getByRole('button', { name: '복구' }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update.mock.calls[0]).toEqual([order.id, { accountingExcluded: false,
      accountingExclusionReason: '', accountingExcludedAt: '', accountingExcludedBy: '' }]);
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

function setup(onAddIssuedStatement = vi.fn(async (_s: IssuedStatement) => {}),
  onUpsertPartnerItem = vi.fn(async (_p: PartnerItem) => {}),
  extra: Partial<React.ComponentProps<typeof TradeStatement>> = {}) {
  /*  발행은 이제 **명령 하나**로 나간다(설계 §2, 3단계). 시험은 옛 통로를 그 위에 태워
      `onAddIssuedStatement` 에 대한 검사 뜻을 그대로 지킨다 — 전표가 저장됐나, 실패하면
      어떻게 되나. 저장이 엎어지는 상황도 그대로 만들어진다(아래 throw 가 그대로 올라온다). */
  const onApplyStatement = vi.fn(async ({ statement }: { statement: IssuedStatement }) => {
    await onAddIssuedStatement(statement);
    return 'applied' as const;
  });
  render(<TradeStatement orders={[]} allItems={[{ ...item, id: 'box' }, item]}
    partners={[partner]} partnerItems={[price]} issuedStatements={[]}
    pendingInvoice={pendingInvoice} onAddIssuedStatement={onAddIssuedStatement}
    onApplyStatement={onApplyStatement}
    onUpsertPartnerItem={onUpsertPartnerItem} {...extra} />);
  return { onAddIssuedStatement, onUpsertPartnerItem, onApplyStatement };
}

beforeEach(() => {
  issueMocks.payment.mockResolvedValue(undefined);
  localStorage.clear();
  vi.clearAllMocks();
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  vi.mocked(appConfirm).mockResolvedValue(true);
});

describe('전표 목록 화면 구성', () => {
  it('입고 화면에서는 목록을 펼치지 않고 같은 발행 모달만 열어 저장 후 닫는다', async () => {
    const close = vi.fn();
    const { onApplyStatement } = setup(undefined, undefined, { composerOnly: true, onComposerClose: close, pendingInvoice: { ...pendingInvoice, poIds: ['po-existing'] } });
    expect(screen.queryByRole('heading', { name: '검색조건' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '매입 전표 작성' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(onApplyStatement).toHaveBeenCalledOnce());
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
  });
  it('주문 목록과 같은 검색조건·거래유형·조회 결과 순서로 구성한다', () => {
    setup(undefined, undefined, { pendingInvoice: null });

    expect(screen.getByRole('heading', { name: '검색조건' })).toBeInTheDocument();
    const kindTabs = screen.getByRole('tablist', { name: '전표 거래유형 선택' });
    expect(within(kindTabs).getAllByRole('tab')).toHaveLength(6);
    expect(screen.getByText(/조회 결과/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /초기화/ })).toBeInTheDocument();
  });
});

describe('전표와 거래처 단가의 저장 완료', () => {
  it('과거 전표의 미연결 품목은 현재 단가를 덮지 않고 이번 전표에만 저장한다', async () => {
    const old = { id: 'historical', docNo: '260908-98', partnerId: partner.id, partnerName: partner.name,
      tradeDate: '2026-09-08', issuedAt: '2026-09-08T00:00:00Z', type: '매입', orderId: '',
      totalSupply: 5455, totalTax: 545, totalAmount: 6000,
      items: [{ itemId: item.id, name: item.name, spec: item.spec, qty: 1, price: 6000,
        supply: 5455, tax: 545, total: 6000, isTaxExempt: false, accountCode: '500' }],
    } as IssuedStatement;
    const newer = { ...old, id: 'newer', docNo: '260924-01', tradeDate: '2026-09-24' };
    const update = vi.fn(async (_id: string, _data: Partial<IssuedStatement>) => {});
    const { onUpsertPartnerItem } = setup(undefined, undefined, {
      pendingInvoice: null, partnerItems: [], issuedStatements: [old, newer], focusDocNo: old.docNo,
      onUpdateIssuedStatement: update,
    });
    fireEvent.click((await screen.findAllByText(old.partnerName)).find(el => el.closest('tr'))!);
    await waitFor(() => expect(document.querySelector('fieldset')).not.toBeNull());
    const modal = within(document.querySelector('fieldset')!);
    fireEvent.click(modal.getByRole('button', { name: '수정' }));
    fireEvent.click(modal.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(appConfirm).toHaveBeenCalledWith(expect.stringContaining('과거 전표를 수정 중입니다'));
    expect(onUpsertPartnerItem).not.toHaveBeenCalled();
    expect(update.mock.calls[0][1].items?.[0]).toMatchObject({ itemId: item.id, price: 6000 });
  });

  it('매입전표 발행 때 거절하면 전표만 저장하고 입고대기는 만들지 않는다', async () => {
    vi.mocked(appConfirm).mockResolvedValue(false);
    const { onAddIssuedStatement, onApplyStatement } = setup();

    fireEvent.click(await screen.findByRole('button', { name: '저장' }));

    await waitFor(() => expect(onAddIssuedStatement).toHaveBeenCalledTimes(1));
    expect(onApplyStatement).toHaveBeenCalledWith(expect.objectContaining({ poIds: [], newPoItems: [] }));
    expect(appConfirm).toHaveBeenCalledWith(expect.stringContaining('입고대기에 등록할까요?'));
  });

  it('기존 입고대기에서 발행하면 추가 질문 없이 기존 발주만 연결한다', async () => {
    const { onApplyStatement } = setup(undefined, undefined, {
      pendingInvoice: { ...pendingInvoice, poIds: ['existing-inbound-po'] },
    });
    fireEvent.click(await screen.findByRole('button', { name: '저장' }));
    await waitFor(() => expect(onApplyStatement).toHaveBeenCalledTimes(1));
    expect(appConfirm).not.toHaveBeenCalled();
    expect(onApplyStatement).toHaveBeenCalledWith(expect.objectContaining({
      poIds: ['existing-inbound-po'], newPoItems: [],
    }));
  });

  it('비용성 매입만 있으면 입고대기를 묻지 않는다', async () => {
    const 비용품목 = { ...item, type: 'service' } as Item;
    const { onApplyStatement } = setup(undefined, undefined, { allItems: [비용품목] });

    fireEvent.click(await screen.findByRole('button', { name: '저장' }));

    await waitFor(() => expect(onApplyStatement).toHaveBeenCalledTimes(1));
    expect(appConfirm).not.toHaveBeenCalled();
    expect(onApplyStatement).toHaveBeenCalledWith(expect.objectContaining({ poIds: [], newPoItems: [] }));
  });

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

  it('전표 발행 뒤 단가 저장이 실패하면 발행 완료를 알리고 재발행을 유도하지 않는다', async () => {
    const upsert = vi.fn(async (_p: PartnerItem) => {});
    upsert.mockRejectedValueOnce(new Error('단가 저장 실패'));
    const { onAddIssuedStatement } = setup(undefined, upsert);
    fireEvent.click(await screen.findByRole('button', { name: '저장' }));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('발행은 완료됐지만 거래처 단가 동기화에 실패했습니다')));
    expect(onAddIssuedStatement).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('button', { name: '새 전표' })).not.toBeInTheDocument());
  });

  it('권한 거부를 로그인 만료로 오진하거나 새로고침을 안내하지 않는다', async () => {
    const save = vi.fn(async (_s: IssuedStatement) => {
      throw { code: 'permission-denied', message: 'Missing or insufficient permissions.' };
    });
    setup(save);
    fireEvent.click(await screen.findByRole('button', { name: '저장' }));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('전표 저장 권한이 거부됐습니다')));
    expect(window.alert).not.toHaveBeenCalledWith(expect.stringContaining('로그인이 풀려서'));
    expect(screen.getByRole('button', { name: '새 전표' })).toBeInTheDocument();
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

describe('자금 전표 수정 저장 순서', () => {
  const cash = {
    id: 'cash-edit-test', companyId: 'taebaek', date: '2026-09-24', createdAt: '2026-09-24T09:00:00+09:00',
    dir: '입금', amount: 5000, cashAccountId: 'bank', accountCode: '811',
    partnerId: partner.id, partnerName: partner.name, note: '수정 시험 자금',
  } as const;
  it('편집 성공 후 승인된 FIFO 매칭을 한 번의 원자 배분 콜백으로 전달한다', async () => {
    const source = cash;
    const save = vi.fn(async () => {}), match = vi.fn(async () => {}), oldAdd = vi.fn();
    const stmt = { id: 'fifo-statement', companyId: 'taebaek', partnerId: partner.id, partnerName: partner.name,
      docNo: '260924-01', type: '매출', tradeDate: '2026-09-24', totalAmount: 10000,
      items:[{name:'매출',qty:1,price:10000,supply:10000,tax:0,total:10000,isTaxExempt:true,accountCode:'108'}] } as IssuedStatement;
    setup(undefined, undefined, { pendingInvoice: null, cashEntries: [source], issuedStatements: [stmt],
      onUpdateCashEntry: save, onMatchCashAllocations: match, onAddSettlement: oldAdd,
      accountCodes: [{ id: 'ar', code: '108', name: '외상매출금' }] as React.ComponentProps<typeof TradeStatement>['accountCodes'] });
    fireEvent.click(screen.getByRole('button', { name: 'ALL' }));
    fireEvent.click(await screen.findByText('수정 시험 자금', { selector: 'td' }));
    const dialog = screen.getByRole('dialog', { name: '자금 전표 수정' });
    fireEvent.change(within(dialog).getAllByRole('combobox').find(input => input.tagName === 'SELECT')!, { target: { value: '108' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(match).toHaveBeenCalledTimes(1));
    expect(match).toHaveBeenCalledWith(expect.objectContaining({ id: source.id, amount: 5000 }), [{ statementId: stmt.id, amount: 5000 }]);
    expect(oldAdd).not.toHaveBeenCalled();
  });

  it('DB 저장 완료 전에는 수정창을 닫지 않고, 실패해도 열린 채로 남는다', async () => {
    const gate = deferred();
    const save = vi.fn(async () => gate.promise);
    setup(undefined, undefined, { pendingInvoice: null, cashEntries: [cash], onUpdateCashEntry: save });
    // 기본 조회 기간은 실행 당일이라 고정된 9/24 시험 전표를 보려면 전체 기간으로 바꾼다.
    fireEvent.click(screen.getByRole('button', { name: 'ALL' }));
    fireEvent.click(await screen.findByText('진단 거래처', { selector: 'td' }));
    const dialog = screen.getByRole('dialog', { name: '자금 전표 수정' });
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    expect(save).toHaveBeenCalledTimes(1);
    expect(dialog).toBeInTheDocument();
    await act(async () => { gate.resolve(); await gate.promise; });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '자금 전표 수정' })).not.toBeInTheDocument());
  });

  it('DB 저장이 실패하면 오류를 알리고 수정창을 유지한다', async () => {
    const save = vi.fn(async () => { throw new Error('시험 실패'); });
    setup(undefined, undefined, { pendingInvoice: null, cashEntries: [cash], onUpdateCashEntry: save });
    fireEvent.click(screen.getByRole('button', { name: 'ALL' }));
    fireEvent.click(await screen.findByText('진단 거래처', { selector: 'td' }));
    const dialog = screen.getByRole('dialog', { name: '자금 전표 수정' });
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('시험 실패')));
    expect(dialog).toBeInTheDocument();
  });

  it('원자 현금 저장이 실패하면 별도 정산 쓰기 없이 원문과 수정창을 보존한다', async () => {
    const updateCash = vi.fn(async () => { throw new Error('자금 쓰기 실패'); });
    const updateSettlement = vi.fn(async (_id: string, _patch: Partial<Settlement>) => {});
    const settlement = { id: 'linked', cashEntryId: cash.id, statementId: 'stmt-linked', amount: 5000, createdAt: '' };
    const stmt = { id: 'stmt-linked', partnerId: partner.id, partnerName: partner.name,
      docNo: '260924-01', type: '매출', tradeDate: '2026-09-24', totalAmount: 10000 } as IssuedStatement;
    setup(undefined, undefined, { pendingInvoice: null, cashEntries: [cash], settlements: [settlement],
      issuedStatements: [stmt], onUpdateCashEntry: updateCash, onUpdateSettlement: updateSettlement });
    fireEvent.click(screen.getByRole('button', { name: 'ALL' }));
    fireEvent.click(await screen.findByText('수정 시험 자금', { selector: 'td' }));
    const dialog = screen.getByRole('dialog', { name: '자금 전표 수정' });
    fireEvent.change(within(dialog).getAllByRole('textbox')[0], { target: { value: '6000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(updateCash).toHaveBeenCalledTimes(1));
    expect(updateSettlement).not.toHaveBeenCalled();
    expect(updateCash).toHaveBeenCalledWith(cash.id, expect.objectContaining({ amount: 6000 }), cash, undefined, undefined);
    expect(updateCash).toHaveBeenCalledTimes(1);
    expect(dialog).toBeInTheDocument();
  });
});


describe('전표 날짜 명시 확정', () => {
  it('달력 월 탐색 change와 blur는 확인이나 저장을 하지 않는다', () => {
    const apply = vi.fn(); render(<VoucherDateChip value="2026-10-06" onApply={apply} />);
    const input = screen.getByLabelText('전표일자');
    fireEvent.change(input, {target:{value:'2026-09-06'}}); fireEvent.blur(input);
    expect(apply).not.toHaveBeenCalled(); expect(appConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'취소'}));
    expect(input).toHaveValue('2026-10-06'); expect(apply).not.toHaveBeenCalled();
  });
  it('적용을 눌러야 확정 경로를 호출하고 완료 전 중복 적용을 막는다', async () => {
    const pending = deferred(), apply = vi.fn(() => pending.promise);
    render(<VoucherDateChip value="2026-10-06" onApply={apply} />);
    fireEvent.change(screen.getByLabelText('전표일자'),{target:{value:'2026-09-15'}});
    fireEvent.click(screen.getByRole('button',{name:'날짜 적용'}));
    expect(apply).toHaveBeenCalledExactlyOnceWith('2026-09-15');
    expect(screen.getByRole('button',{name:'날짜 적용'})).toBeDisabled();
    await act(async()=>pending.resolve());
    expect(screen.queryByRole('button',{name:'날짜 적용'})).not.toBeInTheDocument();
  });
});

it('실제 전표 날짜셀은 월 탐색을 저장하지 않고 적용 뒤 기존 월변경 확인과 writer를 실행한다', async () => {
  const update = vi.fn(async (_id: string, _patch: Partial<IssuedStatement>) => {});
  const stmt = {id:'date-statement',docNo:'261006-01',partnerId:partner.id,partnerName:partner.name,
    tradeDate:'2026-10-06',issuedAt:'2026-10-06T00:00:00Z',type:'매입',totalSupply:100,totalTax:0,totalAmount:100,
    items:[{itemId:item.id,name:item.name,qty:1,price:100,supply:100,tax:0,total:100,isTaxExempt:true,accountCode:'500'}]} as IssuedStatement;
  setup(undefined,undefined,{pendingInvoice:null,issuedStatements:[stmt],onUpdateIssuedStatement:update});
  fireEvent.click(screen.getByRole('button',{name:'ALL'}));
  const input = (await screen.findAllByLabelText('전표일자'))[0];
  fireEvent.change(input,{target:{value:'2026-09-06'}});fireEvent.blur(input);
  expect(appConfirm).not.toHaveBeenCalled();expect(update).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'날짜 적용'}));
  await waitFor(()=>expect(update).toHaveBeenCalled());
  expect(appConfirm).toHaveBeenCalledWith(expect.stringContaining('부가세 신고 달과 월 마감'));
  expect(update.mock.calls[0][0]).toBe(stmt.id);
});

it('날짜 저장 실패는 초안을 보존하고 외부 날짜 갱신은 초안을 초기화한다', async () => {
  const apply = vi.fn(async () => {throw new Error('저장 실패');});
  const view=render(<VoucherDateChip value="2026-10-06" onApply={apply} />);
  const input=screen.getByLabelText('전표일자');
  fireEvent.change(input,{target:{value:'2026-09-06'}});
  fireEvent.click(screen.getByRole('button',{name:'날짜 적용'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'날짜 적용'})).not.toBeDisabled());
  expect(input).toHaveValue('2026-09-06');expect(apply).toHaveBeenCalledOnce();
  view.rerender(<VoucherDateChip value="2026-10-10" onApply={apply} />);
  expect(input).toHaveValue('2026-10-10');
  expect(screen.queryByRole('button',{name:'날짜 적용'})).not.toBeInTheDocument();
});

it('저장 대기 중 갱신된 외부 날짜를 늦은 완료가 이전 날짜로 되돌리지 않는다', async () => {
  const pending=deferred(),apply=vi.fn(()=>pending.promise);
  const view=render(<VoucherDateChip value="2026-10-06" onApply={apply} />);
  fireEvent.change(screen.getByLabelText('전표일자'),{target:{value:'2026-09-06'}});
  fireEvent.click(screen.getByRole('button',{name:'날짜 적용'}));
  view.rerender(<VoucherDateChip value="2026-09-06" onApply={apply} />);
  await act(async()=>pending.resolve());
  expect(screen.getByLabelText('전표일자')).toHaveValue('2026-09-06');
  expect(screen.queryByRole('button',{name:'날짜 적용'})).not.toBeInTheDocument();
  expect(apply).toHaveBeenCalledOnce();
});


it('응답 유실 뒤 다시 열면 이전 주요 발행 원문을 재시도한다', async () => {
  const apply=vi.fn().mockRejectedValueOnce(new Error('응답 유실')).mockResolvedValue('duplicate');
  const first=render(<TradeStatement orders={[]} allItems={[item]} partners={[partner]} partnerItems={[price]} issuedStatements={[]} pendingInvoice={{...pendingInvoice,poIds:['po-original']}} onApplyStatement={apply} composerOnly/>);
  fireEvent.click(screen.getByRole('button',{name:'저장'}));
  await waitFor(()=>expect(apply).toHaveBeenCalledOnce());
  const original=apply.mock.calls[0][0];
  const close=await screen.findByRole('button',{name:'작성창 닫기'});await waitFor(()=>expect(close).not.toBeDisabled());fireEvent.click(close);
  expect(screen.queryByRole('dialog',{name:'매입 전표 작성'})).not.toBeInTheDocument();
  first.unmount();
  setup(undefined,undefined,{pendingInvoice:null,composerOnly:true,onApplyStatement:apply});
  fireEvent.click(await screen.findByRole('button',{name:'이전 전표 재시도'}));
  await waitFor(()=>expect(apply).toHaveBeenCalledTimes(2));
  expect(apply.mock.calls[1][0]).toEqual(original);
});


it('전표 발행 뒤 지급 응답 유실도 재열기에서 같은 전표와 지급 원문으로 재시도한다',async()=>{
 const apply=vi.fn().mockResolvedValue('duplicate');issueMocks.payment.mockRejectedValueOnce(new Error('지급 응답 유실')).mockResolvedValue(undefined);
 const accounts=[{id:'bank',companyId:'taebaek' as const,name:'은행',type:'통장' as const,active:true,openingBalance:0,openingDate:'2026-01-01',createdAt:''}];
 const view=render(<TradeStatement orders={[]} allItems={[item]} partners={[partner]} partnerItems={[price]} issuedStatements={[]} pendingInvoice={pendingInvoice} onApplyStatement={apply} composerOnly cashAccounts={accounts}/>);
 fireEvent.click(screen.getByLabelText('지불도 함께'));fireEvent.click(screen.getByRole('button',{name:'저장'}));
 await waitFor(()=>expect(issueMocks.payment).toHaveBeenCalledOnce());const original=issueMocks.payment.mock.calls[0];const body=apply.mock.calls[0][0];view.unmount();
 setup(undefined,undefined,{pendingInvoice:null,composerOnly:true,onApplyStatement:apply,cashAccounts:accounts});
 fireEvent.click(await screen.findByRole('button',{name:'이전 전표 재시도'}));await waitFor(()=>expect(issueMocks.payment).toHaveBeenCalledTimes(2));
 expect(apply.mock.calls[1][0]).toEqual(body);expect(issueMocks.payment.mock.calls[1]).toEqual(original);
 await waitFor(()=>expect(screen.queryByRole('button',{name:'이전 전표 재시도'})).not.toBeInTheDocument());
});


it('최초 발행 늦은 완료는 다른 창의 저장 원문을 지우지 않는다',async()=>{
 const gate=deferred();const apply=vi.fn(async()=>{await gate.promise;return 'applied' as const;});
 setup(undefined,undefined,{composerOnly:true,onApplyStatement:apply,pendingInvoice:{...pendingInvoice,poIds:['po-original']}});
 fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(apply).toHaveBeenCalledOnce());
 const key='trade-statement-issue:taebaek:test-uid',first=JSON.parse(localStorage.getItem(key)!);
 const other={...first,input:{...first.input,command:{...first.input.command,operationId:'other-operation',statementId:'other-statement'},statement:{...first.input.statement,id:'other-statement'}}};
 const encoded=JSON.stringify(other);localStorage.setItem(key,encoded);
 await act(async()=>{gate.resolve();await gate.promise;});await waitFor(()=>expect(screen.queryByRole('dialog',{name:'매입 전표 작성'})).not.toBeInTheDocument());
 expect(localStorage.getItem(key)).toBe(encoded);
});


it('최초 명확한 송신 전 거절만 원문 대기를 해제해 입력 수정을 허용한다',async()=>{
 const apply=vi.fn(async(input:{command:{operationId:string}})=>{throw Object.assign(new Error('송신 전 회사 확인 실패'),{details:{operationStatus:'rejected',version:1,financialWrites:false,companyId:'taebaek',operationId:input.command.operationId}});});
 setup(undefined,undefined,{composerOnly:true,onApplyStatement:apply});fireEvent.click(screen.getByRole('button',{name:'저장'}));
 await waitFor(()=>expect(apply).toHaveBeenCalledOnce());await waitFor(()=>expect(screen.queryByRole('button',{name:'이전 전표 재시도'})).not.toBeInTheDocument());
 expect(localStorage.getItem('trade-statement-issue:taebaek:test-uid')).toBeNull();expect(screen.getByRole('button',{name:'저장'})).not.toBeDisabled();
});

it('신규 원료 매입은 거래2포/확인40kg와 원가1000을 저장하고 unknown 재열기에도 원문을 보존한다', async () => {
 const raw: Item = {...item,id:'raw-20kg',name:'원료 20kg포',spec:'20kg',type:'raw',subtype:'벌크',unit:'포',cost:80};
 const rawPrice: PartnerItem = {...price,id:'raw-price',itemId:raw.id,price:22000};
 const callback = vi.fn<NonNullable<React.ComponentProps<typeof TradeStatement>['onApplyStatement']>>()
   .mockRejectedValueOnce(new Error('응답 유실')).mockResolvedValueOnce('duplicate');
 const props={orders:[],allItems:[raw],partners:[partner],partnerItems:[rawPrice],issuedStatements:[],composerOnly:true,
 pendingInvoice:{partnerId:partner.id,partnerName:partner.name,items:[{itemId:raw.id,name:raw.name,spec:raw.spec!,qty:2,price:22000}]},onApplyStatement:callback};
 const view=render(<TradeStatement {...props}/>);
 fireEvent.change(await screen.findByLabelText('1행 원가 기준 수량 kg'),{target:{value:'40'}});
 expect(screen.getByText('거래 수량 (포)')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(callback).toHaveBeenCalledOnce());
 const sent=structuredClone(callback.mock.calls[0][0]);
 expect(sent.statement.items[0]).toMatchObject({qty:2,price:22000,supply:40000,total:44000,purchaseQuantityKg:40});
 expect(sent.costUpdates).toEqual([{itemId:raw.id,price:1000,beforeCost:80,sourceLineIndex:0}]);
 expect(sent.newPoItems[0]).toMatchObject({quantity:2,unit:'포'});
 view.unmount();render(<TradeStatement {...props}/>);
 fireEvent.click(await screen.findByRole('button',{name:'이전 전표 재시도'}));await waitFor(()=>expect(callback).toHaveBeenCalledTimes(2));
 expect(callback.mock.calls[1][0]).toEqual(sent);
});


it('신규 벌크 매입은 kg를 확인하지 않아도 정상 발행하며 원가 갱신만 하지 않는다', async () => {
 const raw: Item = {...item,id:'raw-unknown-kg',name:'원료 20kg포',spec:'20kg',type:'raw',subtype:'벌크',unit:'포',cost:80};
 const rawPrice={...price,itemId:raw.id,price:22000};
 const apply=vi.fn<NonNullable<React.ComponentProps<typeof TradeStatement>['onApplyStatement']>>().mockResolvedValue('applied');
 const updateCost=vi.fn(),upsertPrice=vi.fn();
 render(<TradeStatement orders={[]} allItems={[raw]} partners={[partner]} partnerItems={[rawPrice]} issuedStatements={[]}
   pendingInvoice={{partnerId:partner.id,partnerName:partner.name,items:[{itemId:raw.id,name:raw.name,spec:raw.spec!,qty:2,price:22000}]}} onApplyStatement={apply} onUpdateItemCost={updateCost} onUpsertPartnerItem={upsertPrice} composerOnly/>);
 expect(await screen.findByLabelText('1행 원가 기준 수량 kg')).toHaveValue('');
 fireEvent.click(screen.getByRole('button',{name:'저장'}));
 await waitFor(()=>expect(apply).toHaveBeenCalledOnce());
 const sent=apply.mock.calls[0][0];
 expect(sent.costUpdates).toEqual([]);
 expect(sent.statement.items[0]).toMatchObject({qty:2,price:22000,supply:40000,total:44000});
 expect(sent.statement.items[0].purchaseQuantityKg).toBeUndefined();
 expect(sent.newPoItems[0]).toMatchObject({quantity:2,unit:'포'});
 await waitFor(()=>expect(upsertPrice).toHaveBeenCalled());expect(upsertPrice.mock.calls[0][0].price).toBe(22000);
 expect(updateCost).not.toHaveBeenCalled();
});


it('입고 전표 상세 진입은 기존 매입 수정 모달을 보기로 열고 구형 규격은 표시만 보정한다', async () => {
 const statement: IssuedStatement = {id:'inbound-view',companyId:'taebaek',type:'매입',partnerId:partner.id,partnerName:'은하산업',tradeDate:'2026-10-10',issuedAt:'2026-10-10',docNo:'261010-001',orderId:'',totalSupply:40000,totalTax:4000,totalAmount:44000,
 items:[{itemId:item.id,name:'생들기름-캔',spec:'16.5kgml',qty:2,price:22000,supply:40000,tax:4000,total:44000,isTaxExempt:false,accountCode:'500'}]};
 const close=vi.fn(),composerClose=vi.fn();
 render(<TradeStatement orders={[]} allItems={[item]} partners={[partner]} partnerItems={[price]} issuedStatements={[statement]} detailStatementId={statement.id} onDetailClose={close} onComposerClose={composerClose} composerOnly/>);
 const dialog=await screen.findByRole('dialog',{name:'매입 전표 수정'});
 expect(screen.queryByRole('dialog',{name:/발행 전표 상세/})).not.toBeInTheDocument();
 expect(within(dialog).getByText('16.5kg')).toBeInTheDocument();expect(statement.items[0].spec).toBe('16.5kgml');
 fireEvent.click(within(dialog).getByRole('button',{name:'수정'}));
 expect(within(dialog).getByDisplayValue('16.5kgml')).toHaveAttribute('placeholder','규격');
 fireEvent.click(within(dialog).getByRole('button',{name:'매입 전표 수정 닫기'}));
 expect(close).toHaveBeenCalledOnce();expect(composerClose).toHaveBeenCalledOnce();
});


it('외부 상세 선택 변경은 기존 composer에서 다른 전표로 바뀌고 닫힌 선택은 갱신 때 다시 열리지 않는다', async () => {
 const first: IssuedStatement={id:'detail-a',companyId:'taebaek',type:'매입',partnerId:partner.id,partnerName:partner.name,tradeDate:'2026-10-10',issuedAt:'2026-10-10',docNo:'A',orderId:'',items:[{name:'첫 품목',spec:'350ml',qty:1,price:100,supply:100,tax:0,total:100,isTaxExempt:true}],totalSupply:100,totalTax:0,totalAmount:100};
 const second={...first,id:'detail-b',docNo:'B',items:[{...first.items[0],name:'둘째 품목'}]};
 const close=vi.fn();const props={orders:[],allItems:[item],partners:[partner],partnerItems:[price],issuedStatements:[first,second],onDetailClose:close,composerOnly:true};
 const view=render(<TradeStatement {...props} detailStatementId={first.id}/>);
 expect(await screen.findByText('첫 품목')).toBeInTheDocument();
 view.rerender(<TradeStatement {...props} detailStatementId={second.id}/>);
 await waitFor(()=>expect(screen.getByText('둘째 품목')).toBeInTheDocument());
 fireEvent.click(screen.getByRole('button',{name:'매입 전표 수정 닫기'}));
 view.rerender(<TradeStatement {...props} issuedStatements={[{...first}, {...second}]} detailStatementId={second.id}/>);
 expect(screen.queryByRole('dialog',{name:'매입 전표 수정'})).not.toBeInTheDocument();expect(close).toHaveBeenCalledOnce();
 view.rerender(<TradeStatement {...props} companyId="punghoe" detailStatementId={first.id}/>);
 expect(screen.queryByRole('dialog',{name:'매입 전표 수정'})).not.toBeInTheDocument();
});
it('외부 noncash 적용 전표 상세는 일반 composer 수정으로 확대하지 않고 기존 적용 취소를 유지한다',async()=>{
 const statement: IssuedStatement={id:'noncash-view',companyId:'taebaek',type:'비용',partnerId:partner.id,partnerName:partner.name,tradeDate:'2026-10-10',issuedAt:'2026-10-10',docNo:'N',orderId:'',items:[],totalSupply:100,totalTax:0,totalAmount:100,
 noncashApplication:{kind:'advance-application',version:1,companyId:'taebaek',partnerId:partner.id,operationId:'apply',purpose:'합성',requestFingerprint:'hash',sourceFingerprints:{},targetFingerprints:{},allocations:[]}};
 const close=vi.fn();render(<TradeStatement orders={[]} allItems={[]} partners={[partner]} partnerItems={[]} issuedStatements={[statement]} detailStatementId={statement.id} onDetailClose={close} composerOnly/>);
 expect(await screen.findByRole('dialog',{name:`발행 전표 상세 — ${partner.name}`})).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'적용 취소'})).toBeInTheDocument();expect(screen.queryByRole('button',{name:'수정'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:`발행 전표 상세 — ${partner.name} 닫기`}));expect(close).toHaveBeenCalledOnce();
});


it('저장 원문 금액이 수량×단가와 달라도 보기·인쇄는 그대로이고 수정 진입 뒤에만 계산한다',async()=>{
 const statement: IssuedStatement={id:'original-rounding',companyId:'taebaek',type:'매입',partnerId:partner.id,partnerName:partner.name,tradeDate:'2026-10-10',issuedAt:'2026-10-10',docNo:'261010-123',orderId:'',totalSupply:271,totalTax:28,totalAmount:299,
 items:[{name:'원문 품목',spec:'350ml',qty:3,price:100,supply:271,tax:28,total:299,isTaxExempt:false,accountCode:'500'}]};
 render(<TradeStatement orders={[]} allItems={[]} partners={[partner]} partnerItems={[]} issuedStatements={[statement]} detailStatementId={statement.id} composerOnly/>);
 const dialog=await screen.findByRole('dialog',{name:'매입 전표 수정'});
 const row=within(dialog).getByText('원문 품목').closest('tr')!;
 expect(within(row).getByText('271')).toBeInTheDocument();expect(within(row).getByText('28')).toBeInTheDocument();expect(within(row).getByText('299')).toBeInTheDocument();
 const totals=dialog.querySelector<HTMLTableRowElement>('tbody > tr:last-child')!;
 expect(within(totals).getByText('271')).toBeInTheDocument();expect(within(totals).getByText('28')).toBeInTheDocument();expect(within(totals).getByText('299')).toBeInTheDocument();
 fireEvent.click(within(dialog).getByRole('button',{name:'거래명세서'}));
 const html=issueMocks.print.mock.calls.at(-1)?.[0];expect(html).toContain('261010-123');expect(html).toContain('299');expect(html).toContain('271');
 fireEvent.click(within(dialog).getByRole('button',{name:'수정'}));
 expect(within(row).queryByText('299')).not.toBeInTheDocument();expect(within(row).getByText('300')).toBeInTheDocument();expect(statement.totalAmount).toBe(299);
});
it('외부 일반 전표에서 적용 전표로 선택을 바꾸면 일반 composer는 남지 않는다',async()=>{
 const first: IssuedStatement={id:'normal-before',companyId:'taebaek',type:'매출',partnerId:partner.id,partnerName:partner.name,tradeDate:'2026-10-10',issuedAt:'2026-10-10',docNo:'A',orderId:'',items:[],totalSupply:100,totalTax:0,totalAmount:100};
 const special: IssuedStatement={...first,id:'special-after',noncashApplication:{kind:'advance-application',version:1,companyId:'taebaek',partnerId:partner.id,operationId:'apply',purpose:'합성',requestFingerprint:'hash',sourceFingerprints:{},targetFingerprints:{},allocations:[]}};
 const props={orders:[],allItems:[],partners:[partner],partnerItems:[],issuedStatements:[first,special],composerOnly:true};
 const view=render(<TradeStatement {...props} detailStatementId={first.id}/>);expect(await screen.findByRole('dialog',{name:'매출 전표 수정'})).toBeInTheDocument();
 view.rerender(<TradeStatement {...props} detailStatementId={special.id}/>);
 expect(await screen.findByRole('dialog',{name:`발행 전표 상세 — ${partner.name}`})).toBeInTheDocument();expect(screen.getAllByRole('dialog')).toHaveLength(1);
 expect(screen.queryByRole('dialog',{name:'매출 전표 수정'})).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'적용 취소'})).toBeInTheDocument();
});
