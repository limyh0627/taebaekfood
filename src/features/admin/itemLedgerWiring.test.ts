import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('제품별 원장의 원료 이력 조회 배선', () => {
  const source = readFileSync('src/features/admin/AdminApp.tsx', 'utf8');
  it('제품별 원장 직접 진입도 전체 이력을 조회한다', () => {
    const guard = source.match(/if \((docTab !== '원료수불부'[^\n]+)\) return;/)?.[1];
    expect(guard).toBeDefined();
    const skips = new Function('docTab', 'currentView', `return ${guard}`);
    expect(skips('전체', 'item-ledger')).toBe(false);
    expect(skips('전체', 'inventory')).toBe(false);
    expect(skips('전체', 'dashboard')).toBe(true);
  });
  it('회사별 전체 이력을 화면에 전달한다', () => {
    const component = source.match(/<ItemLedger\s[\s\S]*?\/>/)?.[0];
    expect(component).toContain('rawEntries={mergedRawMaterialLedger}');
    expect(component).not.toContain('rawEntries={rawMaterialLedger}');
  });
});
