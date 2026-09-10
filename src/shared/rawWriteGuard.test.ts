import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';

/**
 * **원료 원장·상태·로트 쓰기 배선 시험** — 설계 §15 8단계.
 *
 * 원자화 5단계 이후로는 `rawMaterialLedger` 수량 쓰기와 `mutateRawMaterialLots` 로 원료 로트
 * 변경은 [rawInventoryService](./services/rawInventoryService.ts) 공용 명령만 한다.
 * 이 경로 밖에서 옛 쓰기가 되살아나지 않는지 소스에서 잡는다.
 */

const 파일들 = globSync('{components,src,scripts,functions/src}/**/*.{ts,tsx,mts}')
  .map(f => f.replace(/\\/g, '/'))
  .filter(f => !f.includes('.test.'));

const 허용 = new Set([
  //  공용 명령을 만드는 서비스 자체는 원장·상태 문서를 쓴다(이곳이 유일한 창구).
  'src/shared/services/rawInventoryService.ts',
]);
const 허용접두 = ['scripts/'];   // 옛 일회성 데이터 정정 스크립트. 운영 앱은 안 부른다.

const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*/g, ' ');

describe('원료 원장·상태·로트 쓰기는 공용 명령만 한다', () => {
  it('rawMaterialLedger 에 새 줄을 만드는 자리는 서비스 밖에서 없다', () => {
    const 걸림: string[] = [];
    for (const f of 파일들) {
      if (허용.has(f) || 허용접두.some(p => f.startsWith(p))) continue;
      const src = strip(readFileSync(f, 'utf8'));
      //  addItem/setDoc 첫 인자가 rawMaterialLedger 인 자리
      for (const m of src.matchAll(/(?:addItem|setDoc)\s*\(/g)) {
        const 뒤 = src.slice(m.index, m.index + 200);
        if (!/['"]rawMaterialLedger['"]/.test(뒤)) continue;
        //  대응되는 doc(...) 안에 rawMaterialLedger 가 있는 것도 잡는다
        걸림.push(`${f}: ${뒤.replace(/\s+/g, ' ').slice(0, 90)}`);
      }
    }
    expect(걸림, `서비스 밖 원장 쓰기:\n${걸림.join('\n')}\n\n서비스 executeRawInventoryCommand 만 원장을 쓴다.`)
      .toEqual([]);
  });

  it('rawMaterialLedger 를 지우는 자리는 서비스 밖에서 없다', () => {
    const 걸림: string[] = [];
    for (const f of 파일들) {
      if (허용.has(f) || 허용접두.some(p => f.startsWith(p))) continue;
      const src = strip(readFileSync(f, 'utf8'));
      //  deleteDoc / deleteItem 인자가 rawMaterialLedger 인 자리
      for (const m of src.matchAll(/(?:deleteDoc|deleteItem)\s*\(/g)) {
        const 뒤 = src.slice(m.index, m.index + 200);
        if (!/['"]rawMaterialLedger['"]/.test(뒤)) continue;
        걸림.push(`${f}: ${뒤.replace(/\s+/g, ' ').slice(0, 90)}`);
      }
    }
    expect(걸림, `서비스 밖 원장 삭제:\n${걸림.join('\n')}\n\n삭제 대신 reverse 명령을 뒤에 쌓는다(§9).`)
      .toEqual([]);
  });

  it('mutateRawMaterialLots 는 원료 홀더 대상으로 부르지 않는다', () => {
    //  완제품 로트(제품 재고)에는 아직 남아 있다 — 원료 홀더(subtype='벌크')만 감시한다.
    //  실제 판정은 어렵기 때문에 여기서는 "원료(raw/wip)" 로 판단되는 자리인지만 본다.
    //  이관이 끝난 지금은 5단계 대상 파일 목록이 짧다 — 부르는 자리 자체가 완제품 로트 전용이어야 한다.
    const 원료대상: string[] = [];
    for (const f of 파일들) {
      if (허용.has(f) || 허용접두.some(p => f.startsWith(p))) continue;
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/mutateRawMaterialLots\s*\(/g)) {
        const line = src.slice(Math.max(0, m.index - 40), m.index + 200);
        //  변수명·주석으로 원료(raw)를 대상으로 하는 곳만 골라 낸다
        if (/rawItem|holder|rawHolder|holderRaw|rawTarget/.test(line)) {
          원료대상.push(`${f}: ${line.replace(/\s+/g, ' ').slice(0, 90)}`);
        }
      }
    }
    expect(원료대상, `원료 로트를 손으로 바꾸는 자리:\n${원료대상.join('\n')}\n\nexecuteRawInventoryCommand 로 옮겨라.`)
      .toEqual([]);
  });
});
