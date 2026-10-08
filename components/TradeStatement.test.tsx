/** @vitest-environment jsdom */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import TradeStatement, { VoucherDateChip } from './TradeStatement';
import type { IssuedStatement, Item, Partner, PartnerItem, Settlement } from '../src/shared/types';
import { appConfirm } from '../src/shared/components/appDialog';
import { OrderStatus, type Order } from '../src/shared/types';

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
      docNo: '260924-01', type: '매출', tradeDate: '2026-09-24', totalAmount: 10000 } as IssuedStatement;
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
