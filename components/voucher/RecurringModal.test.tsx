/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecurringModal from './RecurringModal';
import type { FixedCostTemplate, AccountCode, Partner } from '../../src/shared/types';

/**
 * **매달 저절로 서는 전표를 손으로 내는 창.**
 *
 * 여기서 두 번 내면 같은 비용이 장부에 두 줄로 남는다 — 저절로 난 것과 앱에서 낸 것이
 * 겹치는 게 제일 흔한 사고다. 그래서 **이미 났는지 보는 열쇠**와
 * **줄마다 낸다**는 두 가지를 잠근다.
 */
const 템플릿 = (over: Partial<FixedCostTemplate> = {}): FixedCostTemplate => ({
  id: 't1', name: '차량 할부금', amount: 470_280, accountCode: '253',
  autoIssue: true, issueDay: 10, dir: '출금',
  ...over,
} as FixedCostTemplate);

const 계정: AccountCode[] = [
  { id: 'a1', code: '253', name: '미지급금' },
  { id: 'a2', code: '821', name: '보험료' },
] as AccountCode[];
const 거래처: Partner[] = [{ id: 'p1', name: '수협은행' }] as Partner[];

function 띄우기(over: Partial<Parameters<typeof RecurringModal>[0]> = {}) {
  const onGenerate = vi.fn().mockResolvedValue(1);
  const onClose = vi.fn();
  render(<RecurringModal
    templates={[템플릿()]}
    accountCodes={계정}
    partners={거래처}
    isIssued={() => false}
    onClose={onClose}
    onGenerate={onGenerate}
    {...over}
  />);
  return { onGenerate, onClose };
}

/**
 * 발행 목록 — 창 위쪽 템플릿 관리 목록에도 같은 이름이 떠서, 어느 쪽인지 가려서 봐야 한다.
 */
const 목록 = () => within(screen.getByRole('list', { name: '자동 발행 대상' }));
const 줄 = (name: string) => within(목록().getByRole('listitem', { name }));
const 대상월 = () => screen.getByLabelText('대상 월') as HTMLInputElement;

describe('템플릿 창 — 자동 발행 대상', () => {
  it('스위치가 켜진 것만 목록에 올린다', () => {
    띄우기({ templates: [템플릿(), 템플릿({ id: 't2', name: '안 켠 것', autoIssue: false })] });
    expect(목록().getByRole('listitem', { name: '차량 할부금' })).toBeVisible();
    expect(목록().queryByRole('listitem', { name: '안 켠 것' })).toBeNull();
  });

  it('낼 게 없으면 스위치를 켜라고 말해 준다', () => {
    띄우기({ templates: [템플릿({ autoIssue: false })] });
    expect(screen.getByText(/자동 발행할 것이 없습니다/)).toBeVisible();
  });

  it('나가는 날을 띄운다 — 안 보이면 언제 서는 전표인지 모른다', () => {
    띄우기();
    expect(줄('차량 할부금').getByText(/-10$/)).toBeVisible();
  });

  it('issueDay 31은 그 달 말일로 친다 — 2월엔 31일이 없다', async () => {
    const u = userEvent.setup();
    띄우기({ templates: [템플릿({ issueDay: 31 })] });
    await u.clear(대상월()); await u.type(대상월(), '2026-02');
    expect(줄('차량 할부금').getByText('2026-02-28')).toBeVisible();
  });
});

describe('두 번 내지 않는다', () => {
  it('이미 난 것은 발행 단추 대신 **발행됨**으로 잠근다', () => {
    띄우기({ isIssued: () => true });
    expect(줄('차량 할부금').getByText('발행됨')).toBeVisible();
    expect(목록().queryByRole('button', { name: '발행' })).toBeNull();
  });

  it('이미 났는지는 **AUTO-{템플릿}-{월}** 열쇠로 묻는다 — 스케줄러와 같은 판정이라야 한다', () => {
    const isIssued = vi.fn().mockReturnValue(false);
    띄우기({ isIssued });
    expect(isIssued).toHaveBeenCalledWith('AUTO-t1-' + new Date().toISOString().slice(0, 7));
  });

  it('이미 난 것은 합계에서도 뺀다', () => {
    띄우기({ isIssued: () => true });
    expect(screen.queryByText(/생성 예정/)).toBeNull();
  });

  it('안 난 것만 합계에 넣는다', () => {
    띄우기({ templates: [템플릿(), 템플릿({ id: 't2', name: '보험료', amount: 240_600, accountCode: '821' })] });
    expect(screen.getByText('2건 생성 예정')).toBeVisible();
    expect(screen.getByText('합계 710,880원')).toBeVisible();   // 470,280 + 240,600
  });
});

describe('줄마다 낸다 — 통째로 내는 단추는 일부러 없다', () => {
  it('통째로 내는 단추가 없다', () => {
    띄우기({ templates: [템플릿(), 템플릿({ id: 't2', name: '보험료' })] });
    expect(screen.queryByRole('button', { name: /전부|모두|일괄/ })).toBeNull();
    expect(목록().getAllByRole('button', { name: '발행' })).toHaveLength(2);
  });

  it('그 줄의 그 달만 낸다', async () => {
    const u = userEvent.setup();
    const { onGenerate } = 띄우기({ templates: [템플릿(), 템플릿({ id: 't2', name: '보험료' })] });
    await u.clear(대상월()); await u.type(대상월(), '2026-08');
    await u.click(줄('보험료').getByRole('button', { name: '발행' }));
    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(onGenerate).toHaveBeenCalledWith('2026-08', 't2');
  });

  it('내고 나면 뭘 냈는지 말해 준다', async () => {
    const u = userEvent.setup();
    띄우기();
    await u.click(목록().getByRole('button', { name: '발행' }));
    expect(await screen.findByText('차량 할부금 발행했습니다.')).toBeVisible();
  });

  it('이미 있었으면 그렇게 말한다 — 냈다고 하면 안 된다', async () => {
    const u = userEvent.setup();
    띄우기({ onGenerate: vi.fn().mockResolvedValue(0) });
    await u.click(목록().getByRole('button', { name: '발행' }));
    expect(await screen.findByText(/이미 발행돼 있습니다/)).toBeVisible();
  });

  it('실패하면 삼키지 않고 이유를 띄운다', async () => {
    const u = userEvent.setup();
    띄우기({ onGenerate: vi.fn().mockRejectedValue(new Error('통장이 없습니다')) });
    await u.click(목록().getByRole('button', { name: '발행' }));
    expect(await screen.findByText(/발행 실패: 통장이 없습니다/)).toBeVisible();
  });

  it('내는 동안은 다시 못 누른다 — 두 번 누르면 두 건이 난다', async () => {
    const u = userEvent.setup();
    let 풀기: (_n: number) => void = () => {};
    const onGenerate = vi.fn(() => new Promise<number>(r => { 풀기 = r; }));
    띄우기({ templates: [템플릿(), 템플릿({ id: 't2', name: '보험료' })], onGenerate });
    await u.click(줄('차량 할부금').getByRole('button', { name: '발행' }));
    expect(줄('보험료').getByRole('button', { name: '발행' })).toBeDisabled();
    풀기(1);
  });

  it('달을 바꾸면 앞서 띄운 말은 지운다 — 다른 달 결과가 남아 있으면 헷갈린다', async () => {
    const u = userEvent.setup();
    띄우기();
    await u.click(목록().getByRole('button', { name: '발행' }));
    expect(await screen.findByText(/발행했습니다/)).toBeVisible();
    await u.clear(대상월()); await u.type(대상월(), '2026-07');
    expect(screen.queryByText(/발행했습니다/)).toBeNull();
  });
});
