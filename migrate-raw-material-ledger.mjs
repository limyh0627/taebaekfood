// migrate-raw-material-ledger.mjs
// 과거 DELIVERED 주문에서 rawMaterialLedger 자동 항목 생성 (idempotent)
// 이미 존재하는 항목(rm-auto-{orderId}-{raw})은 덮어쓰지 않음 (setDoc merge:false → skip)
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, getDoc, setDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE',
  authDomain: 'taebaek-3abe4.firebaseapp.com',
  projectId: 'taebaek-3abe4',
  storageBucket: 'taebaek-3abe4.firebasestorage.app',
  messagingSenderId: '426912093935',
  appId: '1:426912093935:web:2bd399b729b553edf82d1a',
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ── 상수 (formula.ts와 동일) ─────────────────────────────────────────────────
const PRODUCT_FORMULA = {
  '시골향참기름1': [{ raw: '통깨참기름', ratio: 1.0 }],
  '시골향참기름2': [{ raw: '통깨참기름', ratio: 0.5 }, { raw: '깨분참기름', ratio: 0.5 }],
  '시골향참기름3': [{ raw: '깨분참기름', ratio: 1.0 }],
  '시골향참기름4': [{ raw: '통깨참기름', ratio: 0.25 }, { raw: '깨분참기름', ratio: 0.75 }],
  '시골향들기름1': [{ raw: '통들깨들기름', ratio: 1.0 }],
  '시골향들기름2': [{ raw: '통들깨들기름', ratio: 0.1 }, { raw: '수입들기름', ratio: 0.9 }],
  '시골향볶음참깨': [{ raw: '볶음참깨', ratio: 1.0 }],
  '시골향들깨가루': [{ raw: '볶음들깨', ratio: 1.0 }],
  '시골향탈피들깨가루': [{ raw: '탈피들깨가루', ratio: 1.0 }],
  '시골향볶음검정참깨': [{ raw: '볶음검정참깨', ratio: 1.0 }],
};

const DENSITY = {
  '통깨참기름': 0.916,
  '깨분참기름': 0.916,
  '통들깨들기름': 0.924,
  '수입들기름': 0.924,
};

function toKg(용량, raw, qty) {
  const m = 용량.match(/^([\d.]+)\s*(ml|l|g|kg)/i);
  if (!m) return 0;
  const val = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  const d = DENSITY[raw] ?? 1.0;
  if (unit === 'ml') return val / 1000 * d * qty;
  if (unit === 'l') return val * d * qty;
  if (unit === 'g') return val / 1000 * qty;
  if (unit === 'kg') return val * qty;
  return 0;
}

async function migrate() {
  // 제품 목록 로드 (품목 필드 조회용)
  console.log('제품 목록 로드...');
  const productsSnap = await getDocs(collection(db, 'products'));
  const products = {};
  productsSnap.docs.forEach(d => { products[d.id] = d.data(); });

  // 거래처 목록 로드 (거래처명 조회용)
  const clientsSnap = await getDocs(collection(db, 'clients'));
  const clients = {};
  clientsSnap.docs.forEach(d => { clients[d.id] = d.data(); });

  // DELIVERED 주문 로드
  console.log('DELIVERED 주문 로드...');
  const ordersSnap = await getDocs(collection(db, 'orders'));
  const delivered = ordersSnap.docs.filter(d => d.data().status === 'DELIVERED');
  console.log(`  → DELIVERED 주문: ${delivered.length}개`);

  let skipped = 0;
  let written = 0;
  let noFormula = 0;

  for (const orderDoc of delivered) {
    const order = orderDoc.data();
    const clientName = (order.clientId && clients[order.clientId]?.name) || order.customerName || '';
    const dateStr = (order.deliveredAt || order.createdAt || '').slice(0, 10) || new Date().toISOString().slice(0, 10);

    for (const item of (order.items || [])) {
      const product = products[item.productId];
      if (!product) continue;

      const formulaKey = product.품목 || product.name;
      const formula = PRODUCT_FORMULA[formulaKey];
      if (!formula) { noFormula++; continue; }

      for (const f of formula) {
        const usedKg = toKg(product.용량 || '', f.raw, item.quantity) * f.ratio;
        if (usedKg <= 0) continue;

        const entryId = `rm-auto-${order.id}-${f.raw.replace(/\s/g, '_')}`;
        const entryRef = doc(db, 'rawMaterialLedger', entryId);

        // 이미 존재하면 건너뜀
        const existing = await getDoc(entryRef);
        if (existing.exists()) {
          skipped++;
          continue;
        }

        await setDoc(entryRef, {
          id: entryId,
          material: f.raw,
          date: dateStr,
          received: 0,
          used: Math.round(usedKg * 1000) / 1000,
          note: `자동: ${clientName}`,
          createdAt: new Date().toISOString(),
          type: 'auto',
          orderId: order.id,
        });
        console.log(`  ✓ [${order.id}] ${formulaKey} → ${f.raw} ${Math.round(usedKg * 1000) / 1000}kg (${dateStr})`);
        written++;
      }
    }
  }

  console.log(`\n✅ 완료: ${written}개 작성, ${skipped}개 건너뜀 (이미 존재), ${noFormula}개 배합표 없음`);
  process.exit(0);
}

migrate().catch(e => { console.error(e); process.exit(1); });
