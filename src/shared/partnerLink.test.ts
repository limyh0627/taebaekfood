import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { partnersOfItem, isLinkedToPartner, isSmartStoreItem } from './partnerPrice';

/**
 * **거래처–품목 연결은 `partner_item` 한 군데가 정한다.**
 *
 * 예전엔 품목 문서 안 `items.partnerIds` 배열에도 같은 연결이 **두 벌로** 있었다.
 * 두 벌이 어긋나도 화면엔 아무 표시가 안 났고, 실제로 **동우 볶음참깨 한 건이
 * 어긋나 있었다**(2026-09-06) — 연결은 10개입에 걸려 있는데 옛 배열은 20개입을
 * 가리켜서, 9/1 주문 5박스가 **엉뚱한 품목에서 차감됐다**.
 *
 * 561개 연결 중 554개가 두 벌 다 있었고 7개만 옛 배열에만 있었다.
 * 그 7개를 `partner_item` 으로 옮기고 옛 배열은 지웠다.
 */
describe('거래처–품목 연결', () => {
  it('연결을 물어보는 자리가 partner_item 만 본다', () => {
    expect(partnersOfItem([{ itemId: 'A', partnerId: '동우', Direction: 'out' } as never], 'A')).toEqual(['동우']);
    expect(isLinkedToPartner([{ itemId: 'A', partnerId: '동우', Direction: 'out' } as never], '동우', 'A')).toBe(true);
    expect(isLinkedToPartner([{ itemId: 'A', partnerId: '동우', Direction: 'out' } as never], '한성', 'A')).toBe(false);
  });

  it('매입 줄은 매출 연결로 세지 않는다', () => {
    expect(partnersOfItem([{ itemId: 'A', partnerId: '농협', Direction: 'in' } as never], 'A')).toEqual([]);
  });

  it('스마트스토어 여부는 스위치와 옛 딱지를 둘 다 본다 — 화면마다 다르게 보면 안 된다', () => {
    expect(isSmartStoreItem({ isSmartStore: true })).toBe(true);
    expect(isSmartStoreItem({ partnerIds: ['SMARTSTORE'] })).toBe(true);
    expect(isSmartStoreItem({ partnerIds: ['동우'] })).toBe(false);
    expect(isSmartStoreItem(undefined)).toBe(false);
  });
});

//  `partnerPrice` 는 뺀다 — 옛 딱지를 보는 자리를 **거기 하나로** 모아 놨다.
const 볼파일 = globSync('{components,src}/**/*.{ts,tsx}')
  .filter(f => !f.includes('.test.') && !f.replace(/\\/g, '/').endsWith('src/shared/partnerPrice.ts'));

describe('옛 배열을 다시 읽지 않는다', () => {
  it('저장된 items.partnerIds 를 연결 확인에 쓰는 곳이 없다', () => {
    const 걸림: string[] = [];
    for (const file of 볼파일) {
      readFileSync(file, 'utf8').split('\n').forEach((l, i) => {
        const t = l.trim();
        if (t.startsWith('//') || t.startsWith('*')) return;
        //  `x.partnerIds` 를 **뒤져서 연결을 판단하는** 모양만 잡는다.
        //  화면에 넘길 값으로 partner_item 에서 새로 만들어 넣는 건 괜찮다.
        if (/\.partnerIds\s*(?:\?\.)?\s*(?:\.)?(?:includes|some|indexOf|find|filter)\s*\(/.test(l)
          || /\.partnerIds\s*\|\|\s*\[\]\s*\)\s*\.(?:includes|some)/.test(l)) {
          걸림.push(`  ${file}:${i + 1}  ${t.slice(0, 90)}`);
        }
      });
    }
    expect(걸림, `옛 배열로 거래처 연결을 판단하는 곳:\n${걸림.join('\n')}\n\n` +
      `shared/partnerPrice 의 partnersOfItem · isLinkedToPartner 를 써라 (partner_item 을 본다).`).toEqual([]);
  });

  it('품목 정보 저장이 옛 partnerIds로 매출 연결 전체를 다시 쓰지 않는다', () => {
    const adminApp = readFileSync('src/features/admin/AdminApp.tsx', 'utf8');

    // 품목 모달은 연결 편집 UI가 아니며 저장 payload에도 partnerIds가 없다.
    // 여기서 [] fallback으로 전체 동기화하면 이름·규격만 고쳐도 기존 연결이 모두 삭제된다.
    expect(adminApp).not.toMatch(/setProductClients\s*\(\s*p\.id\s*,\s*p\.partnerIds\s*\?\?\s*\[\]\s*\)/);
  });
});
