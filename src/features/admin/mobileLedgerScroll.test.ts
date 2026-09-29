import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 모바일을 고정 높이에 가두면 긴 원장/로트가 화면 아래에서 잘려 접근할 수 없다.
describe('모바일 원장·로트의 문서 흐름', () => {
  it('제품별원장은 모바일 높이를 제한하지 않고 데스크톱만 패널 스크롤한다', () => {
    const app = readFileSync('src/features/admin/AdminApp.tsx', 'utf8');
    const ledger = readFileSync('components/ItemLedger.tsx', 'utf8');
    expect(app).toMatch(/currentView === 'item-ledger'[\s\S]*?className="h-auto lg:h-full flex flex-col lg:overflow-hidden"/);
    expect(ledger).toContain('gap-3 lg:gap-4 h-auto lg:h-full min-h-0');
    expect(ledger).toContain('flex-none lg:flex-1 min-h-0 lg:overflow-y-auto p-4');
    expect(ledger).toContain('flex-none lg:flex-1 min-h-0 overflow-x-auto lg:overflow-y-auto');
  });
  it('활성·완료 로트 모두 모바일에서 높이가 늘어나고 가로 표 스크롤을 보존한다', () => {
    const source = readFileSync('components/ItemList.tsx', 'utf8');
    expect(source).toContain("mode === 'lots' ? 'h-auto lg:h-full' : 'h-full'");
    const lots = source.slice(source.indexOf("{(activeTab === 'lots' || activeTab === 'lot-history') && ("),source.indexOf('{selectedLotItem && selectedLotData'));
    expect(lots).toContain('gap-3 flex-none lg:flex-1 min-h-0');
    expect(lots).toContain('flex-none lg:flex-1 min-h-0 lg:overflow-y-auto custom-scrollbar');
    expect(lots).toContain('overflow-x-auto');
  });
});
