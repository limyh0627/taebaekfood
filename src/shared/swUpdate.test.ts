/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { 새버전확인, 새버전확인붙이기, 확인시각비우기 } from './swUpdate';

const 일꾼심기 = (update: () => Promise<void>) => {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: () => Promise.resolve({ update }) },
  });
};

describe('새 버전 확인', () => {
  beforeEach(() => { 확인시각비우기(); });

  it('일꾼에게 새 게 있나 물어본다', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    일꾼심기(update);
    expect(await 새버전확인()).toBe(true);
    expect(update).toHaveBeenCalledOnce();
  });

  it('1분 안에는 다시 안 묻는다 — 화면 왔다 갔다 할 때마다 물으면 쓸데없다', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    일꾼심기(update);
    const t = 1_000_000;
    expect(await 새버전확인(t)).toBe(true);
    expect(await 새버전확인(t + 30_000)).toBe(false);
    expect(await 새버전확인(t + 61_000)).toBe(true);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('일꾼이 없어도 터지지 않는다 — 앱은 그대로 돌아야 한다', async () => {
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined });
    expect(await 새버전확인()).toBe(false);
  });

  it('물어보다 터져도 삼킨다', async () => {
    일꾼심기(() => Promise.reject(new Error('막힘')));
    expect(await 새버전확인()).toBe(false);
  });
});

describe('앞으로 나올 때 걸기', () => {
  beforeEach(() => { 확인시각비우기(); });

  it('켜자마자 한 번 묻고, 뗄 수 있다', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    일꾼심기(update);
    const 떼기 = 새버전확인붙이기();
    await Promise.resolve();
    expect(update).toHaveBeenCalledOnce();

    확인시각비우기();
    떼기();
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
    expect(update, '뗀 뒤에는 안 물어야 한다').toHaveBeenCalledOnce();
  });
});
