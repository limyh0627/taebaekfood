import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE",
  authDomain: "taebaek-3abe4.firebaseapp.com",
  projectId: "taebaek-3abe4",
  storageBucket: "taebaek-3abe4.firebasestorage.app",
  messagingSenderId: "426912093935",
  appId: "1:426912093935:web:2bd399b729b553edf82d1a"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// PRODUCT_FORMULA & DENSITY (App.tsx 동일)
const FORMULA = {
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
const DENSITY = { '통깨참기름': 0.916, '깨분참기름': 0.916, '통들깨들기름': 0.924, '수입들기름': 0.924 };

function toKg(용량, raw, qty) {
  const m = 용량.match(/^([\d.]+)\s*(ml|l|g|kg)/i);
  if (!m) return 0;
  const val = parseFloat(m[1]), unit = m[2].toLowerCase(), d = DENSITY[raw] ?? 1.0;
  if (unit === 'ml') return val / 1000 * d * qty;
  if (unit === 'l')  return val * d * qty;
  if (unit === 'g')  return val / 1000 * qty;
  if (unit === 'kg') return val * qty;
  return 0;
}

// 엑셀에서 추출한 생산 데이터 (품목명 ①②③④ → 1234 변환)
const production = [
  // 2026-01-02
  { date: '2026-01-02', 품목: '시골향참기름1', 용량: '350ml', qty: 400 },
  { date: '2026-01-02', 품목: '시골향참기름3', 용량: '1800ml', qty: 42 },
  { date: '2026-01-02', 품목: '시골향참기름4', 용량: '1800ml', qty: 624 },
  { date: '2026-01-02', 품목: '시골향들기름2', 용량: '350ml',  qty: 400 },
  { date: '2026-01-02', 품목: '시골향들기름2', 용량: '1800ml', qty: 12 },
  { date: '2026-01-02', 품목: '시골향볶음참깨',       용량: '1kg', qty: 200 },
  { date: '2026-01-02', 품목: '시골향들깨가루',       용량: '1kg', qty: 380 },
  { date: '2026-01-02', 품목: '시골향탈피들깨가루',   용량: '1kg', qty: 40 },
  { date: '2026-01-02', 품목: '시골향볶음검정참깨',   용량: '1kg', qty: 50 },

  // 2026-01-05
  { date: '2026-01-05', 품목: '시골향참기름1', 용량: '350ml',  qty: 20 },
  { date: '2026-01-05', 품목: '시골향참기름1', 용량: '1750ml', qty: 58 },
  { date: '2026-01-05', 품목: '시골향참기름2', 용량: '1750ml', qty: 30 },
  { date: '2026-01-05', 품목: '시골향참기름4', 용량: '1750ml', qty: 10 },
  { date: '2026-01-05', 품목: '시골향들기름2', 용량: '350ml',  qty: 60 },
  { date: '2026-01-05', 품목: '시골향들기름2', 용량: '1750ml', qty: 2 },
  { date: '2026-01-05', 품목: '시골향볶음참깨',       용량: '1kg', qty: 29 },
  { date: '2026-01-05', 품목: '시골향들깨가루',       용량: '1kg', qty: 40 },
  { date: '2026-01-05', 품목: '시골향볶음검정참깨',   용량: '1kg', qty: 2 },

  // 2026-01-06
  { date: '2026-01-06', 품목: '시골향참기름1', 용량: '300ml',  qty: 1200 },
  { date: '2026-01-06', 품목: '시골향참기름1', 용량: '350ml',  qty: 40 },
  { date: '2026-01-06', 품목: '시골향참기름1', 용량: '1750ml', qty: 10 },
  { date: '2026-01-06', 품목: '시골향참기름1', 용량: '1800ml', qty: 36 },
  { date: '2026-01-06', 품목: '시골향참기름2', 용량: '1750ml', qty: 12 },
  { date: '2026-01-06', 품목: '시골향참기름3', 용량: '1800ml', qty: 60 },
  { date: '2026-01-06', 품목: '시골향들기름2', 용량: '300ml',  qty: 1200 },
  { date: '2026-01-06', 품목: '시골향들기름2', 용량: '1800ml', qty: 12 },
  { date: '2026-01-06', 품목: '시골향볶음참깨',       용량: '1kg', qty: 45 },
  { date: '2026-01-06', 품목: '시골향들깨가루',       용량: '1kg', qty: 4 },
  { date: '2026-01-06', 품목: '시골향탈피들깨가루',   용량: '1kg', qty: 24 },
  { date: '2026-01-06', 품목: '시골향볶음검정참깨',   용량: '1kg', qty: 34 },

  // 2026-01-07
  { date: '2026-01-07', 품목: '시골향참기름1', 용량: '1800ml', qty: 30 },
  { date: '2026-01-07', 품목: '시골향참기름2', 용량: '350ml',  qty: 20 },
  { date: '2026-01-07', 품목: '시골향참기름2', 용량: '1750ml', qty: 118 },
  { date: '2026-01-07', 품목: '시골향참기름3', 용량: '1800ml', qty: 426 },
  { date: '2026-01-07', 품목: '시골향참기름4', 용량: '1750ml', qty: 24 },
  { date: '2026-01-07', 품목: '시골향들기름2', 용량: '1500ml', qty: 30 },
  { date: '2026-01-07', 품목: '시골향들기름2', 용량: '1750ml', qty: 12 },
  { date: '2026-01-07', 품목: '시골향볶음참깨',       용량: '1kg', qty: 640 },
  { date: '2026-01-07', 품목: '시골향들깨가루',       용량: '1kg', qty: 40 },
  { date: '2026-01-07', 품목: '시골향탈피들깨가루',   용량: '1kg', qty: 20 },
  { date: '2026-01-07', 품목: '시골향볶음검정참깨',   용량: '1kg', qty: 170 },
];

// 날짜 × 원료별 사용량 집계
const usageMap = {}; // { 'YYYY-MM-DD|원료명': kg }
for (const p of production) {
  const formula = FORMULA[p.품목];
  if (!formula) { console.warn('배합비 없음:', p.품목); continue; }
  for (const f of formula) {
    const kg = toKg(p.용량, f.raw, p.qty) * f.ratio;
    const key = `${p.date}|${f.raw}`;
    usageMap[key] = (usageMap[key] || 0) + kg;
  }
}

// Firebase에 추가
let count = 0;
for (const [key, used] of Object.entries(usageMap)) {
  const [date, material] = key.split('|');
  const rounded = Math.round(used * 1000) / 1000;
  const id = `manual-${date}-${material.replace(/\s/g, '_')}`;
  await setDoc(doc(db, 'rawMaterialLedger', id), {
    material,
    date,
    received: 0,
    used: rounded,
    note: '엑셀 직접 입력',
    createdAt: new Date().toISOString(),
  });
  console.log(`✓ ${date} | ${material}: ${rounded} kg`);
  count++;
}
console.log(`\n총 ${count}건 추가 완료`);
process.exit(0);
