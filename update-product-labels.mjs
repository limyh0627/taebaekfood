import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, updateDoc } from "firebase/firestore";

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

// 새 라벨 ID 생성 함수 (seed-labels.mjs 와 동일)
function toId(name) {
  return "label-" + name
    .replace(/[①②③④]/g, m => ({ '①': '1', '②': '2', '③': '3', '④': '4' }[m]))
    .replace(/[^\w가-힣]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

// 용량 정규화 (1750ml, 1800ml 등 숫자 형식으로)
function normVol(용량) {
  if (!용량) return '';
  const s = 용량.toLowerCase().trim();
  if (s === '1.75l' || s === '1750ml') return '1750ml';
  if (s === '1.8l' || s === '1800ml') return '1800ml';
  if (s === '1.5l' || s === '1500ml') return '1500ml';
  if (s === '1.0l' || s === '1000ml') return '1000ml';
  return s.replace(/\s/g, '');
}

// 구 라벨명 + 용량 + 품목명 → 새 라벨명 매핑
function getNewLabelName(oldName, 용량, productName, 품목) {
  const vol = normVol(용량);
  const name = productName || '';
  const is들 = name.includes('들') || (품목 || '').includes('들');
  const is생들 = name.includes('생들');
  const is참3 = (품목 || '').includes('참기름3') || name.includes('/분');

  switch (oldName) {
    // ── 가득찬 ────────────────────────────
    case '가득찬 병들':   return '가득찬 병들 300ml';
    case '가득찬 병참':   return '가득찬 병참 300ml';
    case '가득찬 순참':   return '가득찬 순참 1.8L';
    case '가득찬 참3':    return '가득찬 참 1.8L';

    // ── 국수기행 / 구월 ───────────────────
    case '국수기행 참1':  return '국수기행 1.8L';
    case '구월-큰흰사각': return '구월-큰흰사각 1.8L';

    // ── 대왕 ──────────────────────────────
    case '대왕참4':       return '대왕 참④ 1.8L';

    // ── 모란 ──────────────────────────────
    case '모란 들':       return '모란 들 1.75L';
    case '모란 병참':     return '모란 병참 350ml';
    case '모란 참1':      return '모란 참① 1.75L';
    case '모란 참3':      return '모란 참③ 1.75L';
    case '모란 참4':      return '모란 참④ 1.75L';

    // ── 알이네 ────────────────────────────
    case '알이네 들':
      if (vol === '350ml')  return '알이네 들-350ml';
      if (vol === '1800ml') return '알이네 들 1.8L';
      return null;
    case '알이네 참':
      if (vol === '350ml')  return '알이네 참④-350ml';
      if (vol === '1800ml') return is참3 ? '알이네 참③ 1.8L' : '알이네 참④ 1.8L';
      return null;

    // ── 양념나라 ──────────────────────────
    case '양념나라 들2':
      if (vol === '1750ml') return '양념나라 들② 1.75L';
      if (vol === '350ml')  return '양념나라 들② 350ml';
      return null;
    case '양념나라 참2':
      if (vol === '1750ml') return '양념나라 참② 1.75L';
      if (vol === '350ml')  return '양념나라 참② 350ml';
      return null;

    // ── 우리식품 ──────────────────────────
    case '우리식품 들2':  return '우리식품 들② 1.75L';
    case '우리식품 참2':  return '우리식품 참② 1.75L';
    case '우리식품 참4':
      if (vol === '1750ml') return '우리식품 참④ 1.75L';
      if (vol === '1800ml') return '우리식품 참④ 1.8L';
      return null;

    // ── 임진 / 지구 ───────────────────────
    case '임진 3':        return '임진 참③ 1.8L';
    case '지구 들2':      return '지구 들② 1.8L';
    case '지구 참1':      return '지구 참① 1.8L';

    // ── 청우 ──────────────────────────────
    case '청우참':
      if (vol === '1800ml') return '청우 참 1.8L';
      if (vol === '350ml')  return '청우 참 350ml';
      return null;
    case '청우들':
      if (vol === '1800ml') return '청우 들 1.8L';
      if (vol === '350ml')  return '청우 들 350ml';
      return null;

    // ── 토마토 ────────────────────────────
    case '토마토 참':     return '토마토 참 1.8L';

    // ── 해달 ──────────────────────────────
    case '수라간참기름(해달)': return '해달(수라간) 참 350ml';
    case '수라간들기름(해달)': return '해달(수라간) 들 350ml';
    case '첫느낌 그맛(해달)':
      return is들 ? '해달(첫느낌) 들 350ml' : '해달(첫느낌) 참 350ml';
    case '조선 참기름(해달)':
      return is들 ? '해달(조선) 들 350ml' : '해달(조선) 참 350ml';
    case '금빛 참기름(해달)': return '해달(금빛) 참 350ml';

    // ── 해내음 ────────────────────────────
    case '해내음 참4':    return '해내음 참④ 1.8L';

    // ── 하남댁(해피유통) ──────────────────
    case '참기름 사각(해피유통)': return '하남댁(참기름) 300ml(옆면)';
    case '들기름 사각(해피유통)': return '하남댁(들기름) 300ml(옆면)';
    case '생들기름 사각(해피유통)': return '하남댁(생들기름) 300ml(옆면)';
    case '해피유통':
      if (is생들) return '하남댁(생들기름) 300ml(옆면)';
      if (is들)   return '하남댁(들기름) 300ml(옆면)';
      return '하남댁(참기름) 300ml(옆면)';

    // ── 태백 흰정사각 ─────────────────────
    case '태백 들2(흰정사각)':  return '태백 들②-흰정사각 350ml';
    case '태백 참1(흰정사각)':
      if (vol === '1750ml') return '태백 참①-흰정사각 1.75L';
      // 참4 품목이면 참④-흰정사각
      if ((품목 || '').includes('참기름4') || name.includes('특A')) return '태백 참④-흰정사각 350ml';
      return '태백 참①-흰정사각 350ml';
    case '태백 참2(흰정사각)':  return '태백 참②-흰정사각 350ml';

    // ── 태백 들기름 ───────────────────────
    case '시골향들기름2(태백)':
      if (vol === '300ml')  return is생들 ? '태백 생들기름 300ml(사각)' : '태백 들② 300ml(사각)';
      if (vol === '1750ml') return '태백 들② 1.75L';
      if (vol === '1800ml') return is생들 ? '태백 들③ 1.8L' : '태백 들② 1.8L';
      return null;

    // ── 태백 참기름 ───────────────────────
    case '시골향 참기름1(태백)':
    case '시골향참기름1(태백)':
      if (vol === '300ml')  return '태백 참① 300ml(사각)';
      if (vol === '350ml')  return '태백 참①-350ml';
      if (vol === '1750ml') return '태백 참① 1.75L';
      if (vol === '1800ml') return '태백 참① 1.8L';
      return null;
    case '시골향참기름2(태백)':
      if (vol === '1750ml') return '태백 참② 1.75L';
      if (vol === '1800ml') return '태백 참② 1.8L';
      return null;
    case '시골향참기름3(태백)':
      if (vol === '1750ml') return '태백 참③ 1.75L';
      if (vol === '1800ml') return '태백 참③ 1.8L';
      return null;
    case '시골향참기름4(태백)':
      if (vol === '1750ml') return '태백 참④ 1.75L';
      if (vol === '1800ml') return '태백 참④ 1.8L';
      return null;

    default: return null;
  }
}

// 새 라벨 목록 로드
const labelSnap = await getDocs(collection(db, 'submaterials'));
const labelMap = {}; // name → {id, name}
for (const d of labelSnap.docs) {
  const data = d.data();
  if (data.category === '라벨') {
    labelMap[data.name] = { id: d.id, name: data.name };
  }
}
console.log(`새 라벨 ${Object.keys(labelMap).length}개 로드 완료\n`);

// 완제품 로드
const prodSnap = await getDocs(collection(db, 'products'));
const products = prodSnap.docs.map(d => ({ id: d.id, ...d.data() }));

let updated = 0, skipped = 0, notMapped = [];

for (const p of products) {
  if (!p.submaterials?.length) continue;

  const labelIdx = p.submaterials.findIndex(s => s.category === '라벨');
  if (labelIdx === -1) continue;

  const oldLabel = p.submaterials[labelIdx];
  const newLabelName = getNewLabelName(oldLabel.name, p.용량, p.name, p.품목);

  if (!newLabelName) {
    notMapped.push(`[SKIP] ${p.id} | ${p.name} | 용량:${p.용량} | 구라벨:${oldLabel.name}`);
    skipped++;
    continue;
  }

  const newLabel = labelMap[newLabelName];
  if (!newLabel) {
    notMapped.push(`[없음] ${p.id} | ${p.name} | 새라벨명:${newLabelName} — DB에 없음`);
    skipped++;
    continue;
  }

  // submaterials 업데이트
  const newSubs = [...p.submaterials];
  newSubs[labelIdx] = { ...oldLabel, id: newLabel.id, name: newLabel.name };

  await updateDoc(doc(db, 'products', p.id), { submaterials: newSubs });
  console.log(`✓ ${p.name} | ${p.용량} | ${oldLabel.name} → ${newLabel.name}`);
  updated++;
}

console.log(`\n=== 완료 ===`);
console.log(`업데이트: ${updated}개`);
console.log(`스킵: ${skipped}개`);
if (notMapped.length) {
  console.log(`\n--- 매핑 불가 / 새 라벨 없음 목록 ---`);
  notMapped.forEach(m => console.log(m));
}

process.exit(0);
