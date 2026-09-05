import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { channelStyle, isDeliveryChannel, CHANNELS } from './channelStyle';

describe('channelStyle', () => {
  it('세 채널이 다 있다', () => {
    expect(CHANNELS).toEqual(['일반', '택배', '스마트스토어']);
    for (const c of CHANNELS) expect(channelStyle(c).icon).toBeTruthy();
  });

  it('색을 두 모양으로 낸다 — 한 덩어리(chip)와 나눈 것(fg·bg)', () => {
    const c = channelStyle('택배');
    expect(c.chip).toBe('bg-pink-100 text-pink-600');
    expect(c.fg).toBe('text-pink-600');
    expect(c.bg).toBe('bg-pink-50');
  });

  it('**모르는 채널은 회색 기타** — 옛 거래처엔 채널이 안 적힌 것이 있다', () => {
    expect(channelStyle(undefined).label).toBe('기타');
    expect(channelStyle('없는채널').chip).toContain('slate');
  });
});

describe('isDeliveryChannel — 물건을 실어 보내나', () => {
  it('택배·스마트스토어는 배송이 붙는다', () => {
    expect(isDeliveryChannel('택배')).toBe(true);
    expect(isDeliveryChannel('스마트스토어')).toBe(true);
  });
  it('일반은 아니다', () => {
    expect(isDeliveryChannel('일반')).toBe(false);
    expect(isDeliveryChannel(undefined)).toBe(false);
  });
});

/**
 * **채널 아이콘·색을 손으로 적지 않는다.**
 *
 * 다섯 곳에 따로 적혀 있었다(2026-09-05). 채널을 하나 더할 때 다섯 곳을 다 고쳐야 하고,
 * 한 곳을 놓치면 그 화면에서만 회색 네모로 보인다.
 * 실제로 [OrdersList](../../components/OrdersList.tsx) 만 색 모양이 달랐다.
 */
const 볼파일 = globSync('{components,src}/**/*.{ts,tsx}')
  .filter(f => !f.includes('.test.') && !f.replace(/\\/g, '/').endsWith('src/shared/channelStyle.ts'));

describe('채널 색표를 손으로 적지 않는다', () => {
  it("'택배'·'스마트스토어' 에 아이콘·색을 직접 붙인 곳이 없다", () => {
    const 걸림: string[] = [];
    for (const file of 볼파일) {
      readFileSync(file, 'utf8').split('\n').forEach((l, i) => {
        const t = l.trim();
        if (t.startsWith('//') || t.startsWith('*')) return;
        //  `'택배': { icon: ... }` 또는 `'스마트스토어': { ... color ... }` 꼴
        if (/'(택배|스마트스토어|일반)'\s*:\s*\{[^}]*(icon|color|bg-|text-)/.test(l)) {
          걸림.push(`  ${file}:${i + 1}  ${t.slice(0, 80)}`);
        }
      });
    }
    expect(걸림, `채널 색표를 손으로 적은 곳:\n${걸림.join('\n')}\n\n` +
      `shared/channelStyle 의 channelStyle(...) 을 써라.`).toEqual([]);
  });
});
