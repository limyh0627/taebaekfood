// 수입들기름 재고를 330 L 로 맞추고, **늘어난 만큼** 생들기름을 줄인다.
//   기본 = --dry.  적용 = --apply.
//
// **왜** (2026-09-06 사장님: "수입들기름 재고를 330으로 바꾸고 수입들기름 늘어나는 만큼
//        생들기름 재고는 줄여줘")
//
// **앱이 쓰는 길을 그대로 쓴다** — 재고관리 화면의 실사조정(`commitStockEdit`)과 같은
// 함수·같은 순서다. 숫자만 덮어쓰면 로트·원장이 따로 놀아서, 다음에 실사할 때 어긋난다.
//   ① 로트를 목표 kg 에 맞춘다 (늘면 '실사조정' 로트를 새로, 줄면 오래된 것부터 깎는다)
//   ② 원장(rawMaterialLedger)에 `type:'correction'` 으로 같은 실사를 남긴다
//
// **화면은 L, 저장은 kg.** 밀도 0.924 — 330 L = 304.92 kg.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { withCarryOverLot, buildReceiveLot, nextLotNo, settleCarryOver, deductFromLots } from '../src/shared/lotUtils';
import { lotKgRemaining, lotStockInUnit, baseRawName } from '../src/constants/formula';
import type { RawMaterialLot } from '../src/shared/types';

const APPLY = process.argv.includes('--apply');
const 오늘 = new Date().toISOString().slice(0, 10);

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

const items = (await getDocs(collection(db, 'items'))).docs.map(d => ({ id: d.id, ...(d.data() as any) }));
const 수입 = items.find(i => i.id === 'raw-수입들기름')!;
const 생 = items.find(i => i.id === 'raw-생들기름')!;
const 밀도 = Number(수입.density);
if (!(밀도 > 0) || Number(생.density) !== 밀도) { console.error('밀도가 다르다 — 멈춘다.'); process.exit(1); }

const 목표L = 330;
const 수입목표kg = Math.round(목표L * 밀도 * 1000) / 1000;
const 수입현재kg = Number(수입.stock);
const 늘어난kg = Math.round((수입목표kg - 수입현재kg) * 1000) / 1000;
const 생현재kg = Number(생.stock);
const 생목표kg = Math.round((생현재kg - 늘어난kg) * 1000) / 1000;

const L = (kg: number) => Math.round((kg / 밀도) * 100) / 100;
console.log(`밀도 ${밀도}  (화면은 L, 저장은 kg)\n`);
console.log(`수입들기름  ${수입현재kg} kg (${L(수입현재kg)} L)  →  ${수입목표kg} kg (${목표L} L)   ${늘어난kg > 0 ? '+' : ''}${늘어난kg} kg`);
console.log(`생들기름    ${생현재kg} kg (${L(생현재kg)} L)  →  ${생목표kg} kg (${L(생목표kg)} L)   ${-늘어난kg} kg`);
if (생목표kg < 0) { console.error('\n생들기름이 음수가 된다 — 멈춘다.'); process.exit(1); }

//  로트 합이 stock 과 같은지 먼저 본다 — 다르면 손대면 안 된다(다른 문제가 있다는 뜻).
for (const it of [수입, 생]) {
  const 합 = Math.round(lotKgRemaining(it.lots as RawMaterialLot[]) * 1000) / 1000;
  const st = Math.round(Number(it.stock) * 1000) / 1000;
  console.log(`  ${it.name}: 로트 합 ${합} / stock ${st} ${합 === st ? '✔' : '✘ 어긋남'}`);
  if (합 !== st) { console.error('\n로트와 재고가 어긋나 있다 — 먼저 그걸 봐야 한다. 멈춘다.'); process.exit(1); }
}

if (!APPLY) { console.log('\n--dry (기본). 적용하려면 --apply'); process.exit(0); }

/** 앱의 commitStockEdit 과 같은 순서 — 로트를 목표에 맞추고 원장에 실사를 남긴다. */
const 실사 = async (it: any, 목표kg: number) => {
  const material = baseRawName(it.name);
  const 원래: RawMaterialLot[] = (it.lots ?? []) as RawMaterialLot[];
  const withCarry = withCarryOverLot(원래, Number(it.stock), material);
  const adjustKg = Math.round((목표kg - lotKgRemaining(withCarry)) * 1000) / 1000;
  let lots = withCarry;
  if (adjustKg > 0.001) {
    const lot = buildReceiveLot({ material, supplierName: '실사조정', qtyIn: 0, kgIn: adjustKg, receivedDate: 오늘 });
    lots = settleCarryOver([...withCarry, { ...lot, lotNo: nextLotNo(withCarry, lot.receivedDate) }]);
  } else if (adjustKg < -0.001) {
    lots = deductFromLots(withCarry, -adjustKg).lots;
  }
  const 새재고 = lotStockInUnit(lots, material);
  const 깨끗한 = JSON.parse(JSON.stringify(lots));   // Firestore 는 undefined 를 거부한다
  await setDoc(doc(db, 'items', it.id), { ...it, lots: 깨끗한, stock: 새재고 }, { merge: true });

  const val = Math.round((목표kg / 밀도) * 100) / 100;
  const id = `rm-stocktake-${Date.now()}-${it.id}`;
  await setDoc(doc(db, 'rawMaterialLedger', id), {
    id, material, date: 오늘,
    received: adjustKg > 0 ? adjustKg : 0,
    used: adjustKg < 0 ? -adjustKg : 0,
    targetKg: 목표kg,
    note: `재고실사 (${val}L로 맞춤) — 수입들기름↔생들기름 정정`,
    createdAt: new Date().toISOString(),
    type: 'correction', unit: 'kg', addedBy: '사장님',
  });
  console.log(`  ${it.name}: 로트 ${adjustKg > 0 ? '+' : ''}${adjustKg} kg, 재고 ${새재고} kg — 원장에 실사 남김`);
};

await 실사(수입, 수입목표kg);
await 실사(생, 생목표kg);
console.log('\n✅ 끝. 로트·원장까지 같이 맞췄다.');
process.exit(0);
