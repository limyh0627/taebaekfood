// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PartnerAdvanceModal from './PartnerAdvanceModal';
const api = vi.hoisted(() => ({ prepare: vi.fn(), apply: vi.fn(), cancel: vi.fn(), pending: vi.fn(), confirm: vi.fn(), user: { uid: 'admin' } }));
vi.mock('../src/shared/firebase', () => ({ auth: { currentUser: api.user }, authReady: Promise.resolve() }));
vi.mock('../src/shared/components/appDialog', () => ({ appConfirm: api.confirm }));
vi.mock('../src/features/statements/infrastructure/partnerAdvanceCommands', () => ({ preparePartnerAdvance: api.prepare, applyPartnerAdvance: api.apply, cancelPartnerAdvance: api.cancel, readPendingPartnerAdvance: api.pending }));
const source = (id: string, date: string, remaining: number, code = '133') => ({ key: { collection: 'cashEntries', id, lineKey: code }, code, originalAmount: remaining, remaining, date, docNo: id, note: '', fingerprint: id.repeat(64).slice(0, 64) });
const target = (id: string, date: string, remaining: number, accountCode = '251') => ({ statementId: id, accountCode, remaining, date, docNo: id, fingerprint: id.repeat(64).slice(0, 64) });
const prepared = () => ({ enabled: true, revision: 7, releaseId: 'release', sources: [source('new', '2026-10-06', 50), source('old', '2026-09-01', 300)], targets: [target('recent', '2026-10-07', 1000), target('earliest', '2026-09-02', 200), target('sale', '2026-08-01', 100, '108')], applications: [], diagnostics: [] });
beforeEach(() => { vi.clearAllMocks(); api.prepare.mockResolvedValue(prepared()); api.pending.mockReturnValue(null); api.confirm.mockResolvedValue(true); api.apply.mockResolvedValue({ status: 'applied', id: 'result', docNo: 'result' }); });
afterEach(cleanup);
const open = () => render(<PartnerAdvanceModal companyId="taebaek" partnerId="partner" partnerName="거래처" onClose={vi.fn()} />);
describe('선급·선수 적용 확인', () => {
  it('오래된 호환 내역과 미결 전표를 기본 선택하고 확인 전에는 저장하지 않는다', async () => {
    open(); await waitFor(() => expect(screen.getByLabelText('미리 지급하거나 받은 내역')).toHaveValue('old:133'));
    expect(screen.getByLabelText('갚을 전표')).toHaveValue('earliest:251'); expect(screen.getByLabelText('적용 금액')).toHaveValue('200');
    expect(api.apply).not.toHaveBeenCalled(); expect(screen.queryByRole('option', { name: /sale/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '확인하고 적용' }));
    await waitFor(() => expect(api.apply).toHaveBeenCalledWith('taebaek', expect.objectContaining({ source: expect.objectContaining({ id: 'old' }), statementId: 'earliest', amount: 200, expectedRevision: 7, expectedSourceFingerprint: prepared().sources[1].fingerprint, expectedTargetFingerprint: prepared().targets[1].fingerprint })));
  });
  it('다른 전표 선택과 금액 수정이 가능하고 확인 취소 시 쓰지 않는다', async () => {
    open(); await waitFor(() => expect(screen.getByLabelText('갚을 전표')).toHaveValue('earliest:251'));
    fireEvent.change(screen.getByLabelText('갚을 전표'), { target: { value: 'recent:251' } }); expect(screen.getByLabelText('적용 금액')).toHaveValue('300');
    fireEvent.change(screen.getByLabelText('적용 금액'), { target: { value: '150' } }); api.confirm.mockResolvedValue(false);
    fireEvent.click(screen.getByRole('button', { name: '확인하고 적용' })); await waitFor(() => expect(api.confirm).toHaveBeenCalled()); expect(api.apply).not.toHaveBeenCalled();
  });
  it('잔액 초과를 바로잡은 뒤 정상 적용할 수 있다', async () => {
    open(); await waitFor(() => expect(screen.getByLabelText('적용 금액')).toHaveValue('200'));
    fireEvent.change(screen.getByLabelText('적용 금액'), { target: { value: '201' } }); fireEvent.click(screen.getByRole('button', { name: '확인하고 적용' }));
    expect((await screen.findAllByRole('alert')).some(row => row.textContent?.includes('남은 금액'))).toBe(true); expect(api.apply).not.toHaveBeenCalled();
    expect(screen.getByLabelText('적용 금액')).not.toBeDisabled(); fireEvent.change(screen.getByLabelText('적용 금액'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: '확인하고 적용' })); await waitFor(() => expect(api.apply).toHaveBeenCalled());
  });
  it('결과 불명 요청은 새 선택을 잠그고 보존된 원문으로 재시도한다', async () => {
    const input = { operationId: 'same', partnerId: 'partner', date: '2026-10-08', source: { collection: 'cashEntries', id: 'old', lineKey: '133' }, statementId: 'earliest', accountCode: '251', amount: 77, expectedRevision: 7, releaseId: 'release', expectedSourceFingerprint: 'a'.repeat(64), expectedTargetFingerprint: 'b'.repeat(64) };
    api.pending.mockReturnValue({ version: 1, companyId: 'taebaek', actorId: 'admin', action: 'apply', input }); open();
    fireEvent.click(await screen.findByRole('button', { name: '같은 요청으로 결과 확인' }));
    await waitFor(() => expect(api.apply).toHaveBeenCalledWith('taebaek', input)); expect(api.confirm).not.toHaveBeenCalled(); expect(screen.getByLabelText('적용 금액')).toBeDisabled();
  });
  it('활성화되지 않은 회사는 적용을 허용하지 않는다', async () => {
    api.prepare.mockResolvedValue({ ...prepared(), enabled: false, blockedReason: '준비 중' }); open();
    await screen.findByText('준비 중'); expect(screen.getByRole('button', { name: '확인하고 적용' })).toBeDisabled(); expect(api.apply).not.toHaveBeenCalled();
  });
  it('적용 취소는 원 적용을 지정하고 확인 뒤 별도 취소 요청으로 보낸다', async () => {
    api.prepare.mockResolvedValue({ ...prepared(), applications: [{ statementId: 'application', date: '2026-10-08', docNo: 'apply-001', amount: 200, source: { collection: 'cashEntries', id: 'old', lineKey: '133' }, targetStatementId: 'earliest' }] });
    api.cancel.mockResolvedValue({ status: 'applied', id: 'cancel', docNo: 'cancel-001' }); open();
    fireEvent.click(await screen.findByRole('button', { name: '적용 취소' }));
    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith('taebaek', expect.objectContaining({ applicationStatementId: 'application', partnerId: 'partner', expectedRevision: 7, reason: expect.any(String) })));
    expect(api.apply).not.toHaveBeenCalled(); expect(api.confirm).toHaveBeenCalledWith(expect.stringContaining('apply-001'));
  });
});

it('embedded는중첩모달없이표시하며외부현금처리중상계송신을막는다',async()=>{render(<PartnerAdvanceModal companyId="taebaek" partnerId="partner" partnerName="거래처" embedded externalBusy onClose={vi.fn()}/>);await screen.findByLabelText('적용 금액');expect(screen.queryByRole('dialog')).toBeNull();expect(screen.getByRole('button',{name:'확인하고 적용'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'확인하고 적용'}));expect(api.apply).not.toHaveBeenCalled();});
