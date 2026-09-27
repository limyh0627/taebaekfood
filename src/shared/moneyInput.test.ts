/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { changeMoneyInput, formatMoneyInput, parseMoneyInput } from './moneyInput';

describe('원화 입력값', () => {
  it('입력하는 동안 천 단위 쉼표를 붙인다', () => {
    expect(formatMoneyInput('1428000')).toBe('1,428,000');
    expect(formatMoneyInput(5_348_000)).toBe('5,348,000');
  });

  it('이미 붙은 쉼표와 원 글자를 걷고 같은 모양으로 만든다', () => {
    expect(formatMoneyInput('01,428,000원')).toBe('1,428,000');
    expect(formatMoneyInput('')).toBe('');
  });

  it('화면의 쉼표를 제거해 저장용 숫자로 되돌린다', () => {
    expect(parseMoneyInput('1,428,000')).toBe(1_428_000);
    expect(parseMoneyInput('')).toBe(0);
  });

  it('중간 숫자를 고쳐도 쉼표 뒤의 커서 위치를 보존한다', async () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    input.value = '12934';
    input.setSelectionRange(3, 3);
    let stored = '';
    changeMoneyInput(input, digits => { stored = digits; input.value = formatMoneyInput(digits); });
    await new Promise<void>(resolve => queueMicrotask(resolve));
    expect(stored).toBe('12934');
    expect(input.value).toBe('12,934');
    expect(input.selectionStart).toBe(4);
    input.remove();
  });
});
