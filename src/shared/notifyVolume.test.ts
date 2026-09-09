import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadNotifyVolume, saveNotifyVolume, NOTIFY_VOLUME_KEY, playChime } from './notify';

/**
 * **알림음 크기**(2026-09-09 사장님: "알림소리 조절할 수 있게 해줄 수 있음?").
 *
 * ⚠ 앱을 닫았을 때 나는 소리는 폰이 제 알림음으로 울리는 것이라 여기서 못 만진다.
 * 이 크기는 **앱이 열려 있을 때** 나는 소리에만 걸린다.
 */
const 저장소: Record<string, string> = {};
beforeEach(() => {
  for (const k of Object.keys(저장소)) delete 저장소[k];
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => 저장소[k] ?? null,
    setItem: (k: string, v: string) => { 저장소[k] = v; },
  });
});

describe('알림음 크기', () => {
  it('안 골랐으면 보통이다', () => {
    expect(loadNotifyVolume()).toBe('mid');
  });

  it('고른 값을 기억한다', () => {
    saveNotifyVolume('high');
    expect(저장소[NOTIFY_VOLUME_KEY]).toBe('high');
    expect(loadNotifyVolume()).toBe('high');
  });

  it('모르는 값이 들어 있으면 보통으로 돌아간다 — 옛 값이나 손으로 고친 것', () => {
    저장소[NOTIFY_VOLUME_KEY] = '아주크게';
    expect(loadNotifyVolume()).toBe('mid');
  });

  it('꺼짐이면 소리를 안 만든다 — AudioContext 를 아예 안 연다', () => {
    const Ctx = vi.fn();
    vi.stubGlobal('window', { AudioContext: Ctx });
    playChime('off');
    expect(Ctx).not.toHaveBeenCalled();
  });

  it('저장된 값이 꺼짐이면 안 넘겨도 안 운다', () => {
    저장소[NOTIFY_VOLUME_KEY] = 'off';
    const Ctx = vi.fn();
    vi.stubGlobal('window', { AudioContext: Ctx });
    playChime();
    expect(Ctx).not.toHaveBeenCalled();
  });
});
