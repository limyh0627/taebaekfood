// [읽기 전용 시뮬레이션] 신규주문 → 작업완료(생산) → 출고 전체 절차의 재고 차감을 DB쓰기 없이 재현.
//  orderStockEngine.ts의 produceOrder + shipOrder 순수 로직을 현재 코드 그대로 복제한다.
//  Part A: 볶음참깨 품목들에 합성 신규주문을 태워 "재고 숫자가 제대로 빠지는가" 검증(개단위/박스단위).
//  Part B: 전체 완제품에 1단위 주문을 태워 "아무것도 안 빠지는(먹통) 품목"을 색출.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { buildFormula } from '../src/features/admin/bom';
import { toKg, baseRawName, unitToKg } from '../src/constants/formula';
import { bomQty } from '../src/shared/bom';
import { stockUnits, isBoxStockItem } from '../src/shared/orderUnits';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const [items, itemFormulas, shippingRules] = await Promise.all([load('items'), load('item_formula'), load('shipping_rule')]);
const byId = new Map(items.map(i => [i.id, i]));
const submaterials = items.filter(i => i.category === 'submaterial' || i.category === 'box');
const bf = (key: string) => buildFormula(key, itemFormulas as any, items as any);

// ───────────────── 엔진(orderStockEngine.ts) 순수 로직 그대로 복제 ─────────────────
const isGoodsItem = (p: any) => p.subtype === '향미유' || p.subtype === '고춧가루' || p.category === '향미유' || p.category === '고춧가루' || p.category === 'goods' || p.procureType === '완사입' || p.procureType === '임가공';
const isShippingBox = (i: any) => i.category === 'box' || (i.category === 'submaterial' && i.subtype === '박스');
const addDelta = (m: Map<string, number>, id: string, d: number) => { if (d) m.set(id, (m.get(id) ?? 0) + d); };

const goodsShipQty = (item: any, product: any) => {
  if (isBoxStockItem(product)) return stockUnits(item, product);
  const uPerBox = item.unitsPerBox || product.defaultBoxConfig?.unitsPerBox || product.boxSize || 12;
  return item.isBoxUnit && item.boxQuantity ? item.boxQuantity * uPerBox : item.quantity;
};

const accrueRaw = (product: any, units: number, rawUsage: Record<string, number>) => {
  const isAssembly = product.category === 'wip' && product.unit === '개';
  const oilSubs = (product.submaterials ?? [])
    .map((s: any) => ({ s, comp: byId.get(s.id) }))
    .filter(({ comp }: any) => comp && (comp.category === 'raw' || (comp.category === 'wip' && comp.unit !== '개')));
  if (oilSubs.length > 0) {
    for (const { s, comp } of oilSubs) {
      const qty = bomQty(s); if (!comp || qty <= 0) continue;
      if (comp.phantom) {
        for (const f of bf(comp.name)) {
          const kg = isAssembly ? unitToKg(qty * units * f.ratio, f.raw) : toKg(product.spec || '', f.raw, units) * f.ratio * qty;
          if (kg > 0) rawUsage[f.raw] = (rawUsage[f.raw] ?? 0) + kg;
        }
      } else {
        const raw = baseRawName(comp.name);
        const kg = isAssembly ? unitToKg(qty * units, raw) : toKg(product.spec || '', raw, units) * qty;
        if (kg > 0) rawUsage[raw] = (rawUsage[raw] ?? 0) + kg;
      }
    }
    return;
  }
  for (const f of bf(product.품목 || product.name)) {
    const kg = toKg(product.spec || '', f.raw, units) * f.ratio;
    if (kg > 0) rawUsage[f.raw] = (rawUsage[f.raw] ?? 0) + kg;
  }
};

const accrueShippingBox = (order: any, product: any, item: any, deltas: Map<string, number>, sign: number) => {
  const boxesUsed = item.isBoxUnit && item.boxQuantity ? item.boxQuantity : item.unitsPerBox ? Math.ceil(item.quantity / item.unitsPerBox) : null;
  const rule = shippingRules.find((r: any) => r.item_id === product.id && r.partner_id === order.partnerId);
  const boxSubId = item.boxSubId || rule?.box_item_id;
  const boxSub = boxSubId ? submaterials.find((sm: any) => sm.id === boxSubId) : null;
  if (!boxSub) return;
  const dq = boxesUsed ?? Math.ceil(item.quantity / (boxSub.boxSize || 1));
  if (dq > 0) addDelta(deltas, boxSub.id, sign * dq);
};

const accrueBom = (order: any, product: any, units: number, deltas: Map<string, number>, rawUsage: Record<string, number>, sign: number, autoBuilt: any[], depth = 0): void => {
  if (units <= 0 || depth > 4) return;
  const isBox = isBoxStockItem(product);
  for (const s of (product.submaterials ?? [])) {
    const comp = byId.get(s.id); if (!comp) continue;
    if (isShippingBox(comp) && !isBox) continue;
    if (comp.category === 'raw' || (comp.category === 'wip' && comp.unit !== '개')) continue;
    const need = Math.round(units * bomQty(s) * 1000) / 1000; if (need <= 0) continue;
    if (sign < 0 && (comp.category === 'product' || (comp.category === 'wip' && comp.unit === '개')) && !isGoodsItem(comp)) {
      const have = (comp.stock ?? 0) + (deltas.get(comp.id) ?? 0);
      const short = Math.round((need - have) * 1000) / 1000;
      if (short > 0) { addDelta(deltas, comp.id, short); autoBuilt.push({ itemId: comp.id, qty: short }); accrueBom(order, comp, short, deltas, rawUsage, sign, autoBuilt, depth + 1); accrueRaw(comp, short, rawUsage); }
    }
    addDelta(deltas, comp.id, sign * need);
  }
};

// produceOrder 재현 → { deltas(재고), rawUsage(로트차감 kg), ledgerOnly(임가공 수불부 kg) }
const simulateProduce = (order: any) => {
  const deltas = new Map<string, number>(); const rawUsage: Record<string, number> = {}; const ledgerOnly: Record<string, number> = {}; const autoBuilt: any[] = [];
  for (const item of order.items ?? []) {
    const product = byId.get(item.itemId); if (!product || product.category !== 'product') continue;
    const units = stockUnits(item, product);
    if (product.procureType === '임가공') {
      for (const f of bf(product.품목 || product.name)) { const kg = toKg(product.spec || '', f.raw, units) * f.ratio; if (kg > 0) ledgerOnly[f.raw] = (ledgerOnly[f.raw] ?? 0) + kg; }
      continue;
    }
    if (isGoodsItem(product)) continue;
    accrueShippingBox(order, product, item, deltas, -1);
    accrueBom(order, product, units, deltas, rawUsage, -1, autoBuilt, 0);
    if (!isBoxStockItem(product)) accrueRaw(product, units, rawUsage);
    addDelta(deltas, product.id, units);
  }
  return { deltas, rawUsage, ledgerOnly };
};

// shipOrder 재현 → 출고 재고 델타
const simulateShip = (order: any) => {
  const deltas = new Map<string, number>();
  for (const item of order.items ?? []) {
    const product = byId.get(item.itemId); if (!product) continue;
    if (isGoodsItem(product)) addDelta(deltas, product.id, -goodsShipQty(item, product));
    else if (product.category === 'product') addDelta(deltas, product.id, -stockUnits(item, product));
  }
  return deltas;
};

// 전체 절차(작업완료+출고) 순변화
const mergeDelta = (a: Map<string, number>, b: Map<string, number>) => { const m = new Map(a); for (const [k, v] of b) m.set(k, (m.get(k) ?? 0) + v); return m; };

const nm = (id: string) => byId.get(id)?.name ?? id;
const fmt = (d: number) => (d > 0 ? '+' : '') + (Math.round(d * 1000) / 1000);

// ═══════════════════════════ Part A · 볶음참깨 신규주문 검증 ═══════════════════════════
console.log('\n═══════════ Part A · 볶음참깨 신규주문 전체절차(작업완료→출고) 차감 검증 ═══════════');
const bokkeum = items.filter((i: any) => i.category === 'product' && !i.archived && /볶음참깨/.test(i.name));
console.log(`볶음참깨 완제품 ${bokkeum.length}종:\n`);

for (const p of bokkeum) {
  const gaeip = isBoxStockItem(p) ? (byId.get((p.submaterials ?? []).find((s: any) => s.category === 'product' || s.category === '완제품')?.id) ? bomQty((p.submaterials ?? []).find((s: any) => s.category === 'product' || s.category === '완제품')) : null) : null;
  console.log(`──── ${p.name} (${p.id})`);
  console.log(`     spec="${p.spec}" 품목="${p.품목 ?? ''}" procureType="${p.procureType ?? ''}" category=${p.category} 재고=${p.stock} isGoods=${isGoodsItem(p)} isBoxStock=${isBoxStockItem(p)}${gaeip ? ` 개입=${gaeip}` : ''}`);

  // 시나리오: 박스품목이면 박스단위 1박스, 낱개품목이면 낱개 1개
  const box = isBoxStockItem(p);
  const qty = box ? (gaeip || 1) : 1;
  const item = box ? { itemId: p.id, quantity: qty, isBoxUnit: true, boxQuantity: 1, unitsPerBox: gaeip } : { itemId: p.id, quantity: 1 };
  const order = { id: 'SIM', status: 'SIM', partnerId: '', items: [item] };
  const { deltas: pd, rawUsage, ledgerOnly } = simulateProduce(order);
  const sd = simulateShip(order);
  const net = mergeDelta(pd, sd);
  const ownNet = net.get(p.id) ?? 0;
  const otherNeg = [...net].filter(([id, d]) => id !== p.id && d < 0);  // 부자재/구성품 차감
  const rawNames = Object.keys(rawUsage); const ledgerNames = Object.keys(ledgerOnly);

  console.log(`     주문: ${box ? '박스단위 1박스' : '낱개 1개'} (stockUnits=${stockUnits(item, p)})`);
  console.log(`     · 작업완료(생산) 재고델타: ${pd.size ? [...pd].map(([id, d]) => `${nm(id)} ${fmt(d)}`).join(', ') : '(없음)'}`);
  console.log(`     · 원료 로트 차감(rawUsage): ${rawNames.length ? rawNames.map(r => `${r} ${Math.round(rawUsage[r] * 100) / 100}kg`).join(', ') : '(없음)'}`);
  console.log(`     · 출고 재고델타: ${sd.size ? [...sd].map(([id, d]) => `${nm(id)} ${fmt(d)}`).join(', ') : '(없음)'}`);
  console.log(`     · 임가공 원료수불부(로트無): ${ledgerNames.length ? ledgerNames.map(r => `${r} ${Math.round(ledgerOnly[r] * 100) / 100}kg`).join(', ') : '(없음)'}`);
  // 정확한 판정: 임가공/완사입(goods)은 출고 시 자기재고 차감이 정상. 일반 제조는 원료·부자재 소진이 정상(자기재고 순0 OK).
  let verdict: string;
  if (isGoodsItem(p)) verdict = ownNet < 0 ? `✅ 정상 — 출고 시 자기재고 ${fmt(ownNet)}${ledgerNames.length ? ` + 수불부 ${ledgerNames.map(r => `${r} ${Math.round(ledgerOnly[r] * 100) / 100}kg`).join(',')}` : ''}` : `🔴 goods인데 자기재고 안 빠짐(${fmt(ownNet)})`;
  else if (rawNames.length || otherNeg.length) verdict = `✅ 정상 — ${[rawNames.length ? `원료 ${rawNames.join(',')}` : '', otherNeg.length ? `부자재/구성품 ${otherNeg.map(([id]) => nm(id)).join(',')}` : ''].filter(Boolean).join(' + ')} 소진 (자기재고는 생산+1/출고-1로 순0=정상)`;
  else verdict = `🔴 먹통 — 원료·부자재·자기재고 아무것도 안 빠짐(BOM/배합식 없음)`;
  console.log(`     ⇒ ${verdict}\n`);
}

// ═══════════════════════════ Part B · 전체 완제품 먹통 색출 ═══════════════════════════
console.log('\n═══════════ Part B · 전체 완제품 1주문 차감 스캔(먹통 품목 색출) ═══════════');
const products = items.filter((i: any) => i.category === 'product' && !i.archived);
const dead: any[] = []; const rawOnly: any[] = []; const ok: any[] = [];
for (const p of products) {
  const box = isBoxStockItem(p);
  const uc = box ? (p.submaterials ?? []).find((s: any) => s.category === 'product' || s.category === '완제품') : null;
  const gaeip = uc ? bomQty(uc) : null;
  const item = box ? { itemId: p.id, quantity: gaeip || 1, isBoxUnit: true, boxQuantity: 1, unitsPerBox: gaeip } : { itemId: p.id, quantity: 1 };
  const order = { id: 'SIM', status: 'SIM', partnerId: '', items: [item] };
  const { deltas: pd, rawUsage, ledgerOnly } = simulateProduce(order);
  const sd = simulateShip(order);
  const net = mergeDelta(pd, sd);
  const ownNet = net.get(p.id) ?? 0;
  const anyRaw = Object.keys(rawUsage).length > 0 || Object.keys(ledgerOnly).length > 0;
  // 자기재고 외에 빠지는 부자재/완제품 구성품
  const otherStock = [...net].filter(([id]) => id !== p.id).some(([, d]) => d < 0);
  const rec = { p, ownNet, anyRaw, otherStock, box, isGoods: isGoodsItem(p) };
  // "먹통" = 재고도 안 빠지고, 원료도 안 빠지고, 부자재도 안 빠짐
  if (ownNet >= 0 && !anyRaw && !otherStock) dead.push(rec);
  else if (!anyRaw && !otherStock && ownNet < 0 && isGoodsItem(p)) ok.push(rec); // 완사입/임가공: 자기재고만 = 정상
  else if (anyRaw && ownNet >= -0.0001 && !otherStock) rawOnly.push(rec);
  else ok.push(rec);
}
console.log(`완제품 ${products.length}종 스캔 → 정상 ${ok.length} / 원료만빠짐 ${rawOnly.length} / 🔴먹통(아무것도안빠짐) ${dead.length}\n`);
if (dead.length) {
  console.log('🔴 먹통 품목(신규주문 전체절차를 밟아도 재고·원료·부자재 아무것도 안 빠짐):');
  dead.sort((a, b) => a.p.name.localeCompare(b.p.name)).forEach(r => console.log(`   · ${r.p.name}  [${r.p.id}]  재고=${r.p.stock} spec="${r.p.spec}" box=${r.box} goods=${r.isGoods} sub개수=${(r.p.submaterials ?? []).length}`));
}
console.log('');
process.exit(0);
