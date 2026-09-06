/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { loadStartView, saveView } from './startView';

describe('앱을 켤 때 여는 화면', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

  it('처음 켜면 첫 화면이다', () => {
    expect(loadStartView('tb_admin_view', 'dashboard')).toBe('dashboard');
    expect(loadStartView('tb_staff_view', 'orders')).toBe('orders');
  });

  it('같은 탭에서 새로고침하면 보던 자리를 지킨다', () => {
    saveView('tb_admin_view', 'tax-statement');
    expect(loadStartView('tb_admin_view', 'dashboard')).toBe('tax-statement');
  });

  it('옛 방식(localStorage)에 적힌 화면은 따라오지 않는다 — 이게 세금계산서가 뜨던 까닭이다', () => {
    localStorage.setItem('tb_admin_view', 'tax-statement');
    expect(loadStartView('tb_admin_view', 'dashboard')).toBe('dashboard');
    expect(localStorage.getItem('tb_admin_view')).toBeNull();   // 지워야 다음에도 안 따라온다
  });

  it('앱마다 열쇠가 달라 서로 안 섞인다', () => {
    saveView('tb_admin_view', 'tax-statement');
    expect(loadStartView('tb_staff_view', 'orders')).toBe('orders');
  });
});

/**
 * **켤 때 여는 화면 규칙은 한 곳에만 있다.**
 *
 * 관리자 앱과 직원 앱이 똑같은 코드를 따로 들고 있었고, 죽은 App.tsx 에 세 번째가 있었다.
 */
describe('시작 화면 규칙을 손으로 적지 않는다', () => {
  it('화면 이름을 localStorage 에 직접 넣고 빼는 곳이 없다', () => {
    const 걸림: string[] = [];
    const 볼파일 = globSync('{apps,components,src}/**/*.{ts,tsx}')
      .filter(f => !f.includes('.test.') && !f.replace(/\\/g, '/').endsWith('src/shared/startView.ts'));
    for (const file of 볼파일) {
      readFileSync(file, 'utf8').split('\n').forEach((l, i) => {
        const t = l.trim();
        if (t.startsWith('//') || t.startsWith('*')) return;
        if (/localStorage\.(?:get|set)Item\(\s*'tb_\w*_view'/.test(l)) 걸림.push(`  ${file}:${i + 1}  ${t.slice(0, 90)}`);
      });
    }
    expect(걸림, `시작 화면을 손으로 저장·복원하는 곳:\n${걸림.join('\n')}\n\n` +
      `shared/startView 의 loadStartView · saveView 를 써라.`).toEqual([]);
  });
});
