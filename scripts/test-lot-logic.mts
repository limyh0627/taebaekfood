// 로트 순수 로직 검증 (DB 미접속). 실행: npx tsx scripts/test-lot-logic.mts
import { baseRawName, parsePackageKg, kgToUnit, unitToKg, lotKgRemaining, lotStockInUnit } from '../src/constants/formula';
import { withCarryOverLot, buildReceiveLot, receiptToKg, nextLotNo, deductFromLots } from '../src/shared/lotUtils';
import type { RawMaterialLot } from '../src/shared/types';

let pass = 0, fail = 0;
const approx = (a: number, b: number, eps = 0.05) => Math.abs(a - b) <= eps;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}  (got: ${JSON.stringify(got)})`); }
}

console.log('── 이름/규격 파싱 ──');
check('baseRawName 접미사 제거', baseRawName('깨분참기름/16.5kg') === '깨분참기름');
check('baseRawName 접미사 없음', baseRawName('깨분참기름') === '깨분참기름');
check('parsePackageKg 16.5kg', parsePackageKg('16.5kg') === 16.5);
check('parsePackageKg 20kg', parsePackageKg('20kg') === 20);
check('parsePackageKg L은 무시', parsePackageKg('1.8L') === undefined);

console.log('── kg ↔ 단위 환산 (깨분참기름 밀도 0.916) ──');
check('kgToUnit 기름=L', approx(kgToUnit(1122, '깨분참기름'), 1224.9), kgToUnit(1122, '깨분참기름'));
check('unitToKg 기름', approx(unitToKg(1242, '깨분참기름'), 1137.67), unitToKg(1242, '깨분참기름'));
check('kgToUnit 가루=그대로', kgToUnit(100, '들깨') === 100);
check('round-trip', approx(unitToKg(kgToUnit(500, '통깨참기름'), '통깨참기름'), 500));

console.log('── 입고 kg 환산 ──');
check('68캔 × 16.5kg = 1122', receiptToKg({ quantity: 68, unit: '개', density: 0.916, packageKg: 16.5 }) === 1122);
check('100L × 0.916 = 91.6', approx(receiptToKg({ quantity: 100, unit: 'L', density: 0.916 }), 91.6));
check('50kg 그대로', receiptToKg({ quantity: 50, unit: 'kg', density: 1 }) === 50);

console.log('── 이월 로트 + 첫 입고 (깨분참기름 시나리오) ──');
// 시작: stock 1242L, 로트 없음 → 풍회 68캔 입고
const carry = withCarryOverLot([], 1242, '깨분참기름');
check('이월 로트 1개 생성', carry.length === 1 && carry[0].supplierName === '이월', carry);
check('이월 잔여 = 1242L→kg', approx(carry[0].kgRemaining, 1137.67), carry[0].kgRemaining);
const lot68 = buildReceiveLot({ material: '깨분참기름', supplierName: '풍회유통', qtyIn: 68, kgIn: 1122, packageKg: 16.5, packageType: '캔' });
const after: RawMaterialLot[] = [...carry, lot68];
check('로트 2개', after.length === 2);
check('잔여 kg 합 = 1137.67+1122', approx(lotKgRemaining(after), 2259.67), lotKgRemaining(after));
check('stock(L) 합 ≈ 2466.9', approx(lotStockInUnit(after, '깨분참기름'), 2466.9), lotStockInUnit(after, '깨분참기름'));

console.log('── 이월 중복 방지 (이미 로트 있으면 그대로) ──');
check('로트 있으면 이월 안 만듦', withCarryOverLot(after, 9999, '깨분참기름').length === 2);

console.log('── 가루 원료(들깨, kg단위) 입고 ──');
const dlLot = buildReceiveLot({ material: '들깨', supplierName: '직접입고', qtyIn: 0, kgIn: 500 });
const dlAfter = [...withCarryOverLot([], 0, '들깨'), dlLot]; // 기존재고 0 → 이월 없음
check('들깨 이월 없음(재고0) + 입고 500', dlAfter.length === 1 && lotStockInUnit(dlAfter, '들깨') === 500, dlAfter);

console.log('── 자동 로트번호 (입고일+순번) ──');
check('첫 입고 260615-01', nextLotNo([], '2026-06-15') === '260615-01', nextLotNo([], '2026-06-15'));
const oneLot = [{ lotNo: '260615-01' } as RawMaterialLot];
check('같은 날 두번째 260615-02', nextLotNo(oneLot, '2026-06-15') === '260615-02', nextLotNo(oneLot, '2026-06-15'));
check('이월 로트(번호없음)는 순번 무관', nextLotNo([{ supplierName: '이월' } as RawMaterialLot], '2026-06-15') === '260615-01');
check('다른 날은 01부터', nextLotNo(oneLot, '2026-06-16') === '260616-01', nextLotNo(oneLot, '2026-06-16'));

console.log('── 선입선출(FIFO) 차감 ──');
const mkLot = (id: string, kg: number, sup: string): RawMaterialLot =>
  ({ id, supplierName: sup, kgIn: kg, kgRemaining: kg, receivedDate: '2026-06-15', status: 'active', createdAt: '' });
// 청양 825, 청정 660 (앞=먼저)
const fifoLots = [mkLot('a', 825, '청양'), mkLot('b', 660, '청정')];
const d1 = deductFromLots(fifoLots, 300);
check('한 로트 내 차감 — 청양 825→525', d1.lots[0].kgRemaining === 525 && d1.lots[1].kgRemaining === 660, d1.lots.map(l => l.kgRemaining));
check('분배는 청양 300 한 건', d1.distribution.length === 1 && d1.distribution[0].kg === 300 && d1.distribution[0].supplierName === '청양');
check('부족 없음', d1.shortageKg === 0);

const d2 = deductFromLots(fifoLots, 900); // 청양 825 다 쓰고 청정 75
check('로트 경계 넘는 차감 — 청양 0(소진)/청정 585', d2.lots[0].kgRemaining === 0 && d2.lots[0].status === 'depleted' && d2.lots[1].kgRemaining === 585, d2.lots.map(l => `${l.kgRemaining}/${l.status}`));
check('분배 청양825+청정75', d2.distribution.length === 2 && d2.distribution[0].kg === 825 && d2.distribution[1].kg === 75);

const d3 = deductFromLots(fifoLots, 2000); // 총 1485 < 2000
check('부족분 계산 — 515kg 모자람', d3.shortageKg === 515, d3.shortageKg);
check('모든 로트 소진', d3.lots.every(l => l.kgRemaining === 0 && l.status === 'depleted'));
check('원본 불변(순수함수)', fifoLots[0].kgRemaining === 825);

console.log('── Firestore 쓰기 전 undefined 제거 (mutateRawMaterialLots와 동일 strip) ──');
// firebaseService.stripUndefined 와 동일 구현
const stripUndefined = (o: any): any => Array.isArray(o) ? o.map(stripUndefined)
  : (o !== null && typeof o === 'object'
      ? Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, stripUndefined(v)]))
      : o);
// 수동 입고처럼 옵션필드 미지정 → undefined 키 발생
const manualLot = buildReceiveLot({ material: '들깨', supplierName: '직접입고', qtyIn: 0, kgIn: 500 });
const rawKeysWithUndef = Object.entries(manualLot).filter(([, v]) => v === undefined).map(([k]) => k);
check('buildReceiveLot에 undefined 값 키 존재(strip 대상)', rawKeysWithUndef.length > 0, rawKeysWithUndef);
const stripped = stripUndefined(manualLot);
const leftover = Object.entries(stripped).filter(([, v]) => v === undefined).map(([k]) => k);
check('strip 후 undefined 값 키 0개', leftover.length === 0, leftover);
check('strip 후 필수필드 유지(kgIn/kgRemaining/status)', stripped.kgIn === 500 && stripped.kgRemaining === 500 && stripped.status === 'active');

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail === 0 ? 0 : 1);
