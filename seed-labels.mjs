import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, deleteDoc, doc, setDoc, query, where } from "firebase/firestore";

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

const LABELS = [
  "가득찬 병들 300ml",
  "가득찬 순참 1.8L",
  "가득찬 참 1.8L",
  "가득찬 병참 300ml",
  "국수기행 1.8L",
  "구월-큰흰사각 1.8L",
  "농가 참④ 1.75L",
  "대왕 참④ 1.8L",
  "모란 들 1.75L",
  "모란 병참 350ml",
  "모란 참① 1.75L",
  "모란 참③ 1.75L",
  "모란 참④ 1.75L",
  "수인들기름 350ml페트",
  "수인참기름 350ml페트",
  "알이네 들 1.8L",
  "알이네 들-350ml",
  "알이네 참③ 1.8L",
  "알이네 참④ 1.8L",
  "알이네 참④-350ml",
  "양념나라 들② 1.75L",
  "양념나라 들② 350ml",
  "양념나라 참② 1.75L",
  "양념나라 참② 350ml",
  "우리 병들 350ml",
  "우리 병참 350ml",
  "우리식품 들 1.8L",
  "우리식품 들② 1.75L",
  "우리식품 참② 1.75L",
  "우리식품 참③ 1.8L",
  "우리식품 참④ 1.75L",
  "우리식품 참④ 1.8L",
  "임진 들 1.8L",
  "임진 참③ 1.8L",
  "지구 들② 1.8L",
  "지구 참① 1.8L",
  "진식자재 들 1.8L",
  "진식자재 들(호승) 1.5L",
  "진식자재 참② 1.75L",
  "진식자재 참② 1.8L",
  "진식자재 참③(호승) 1.5L",
  "진식자재 참④(호승) 1.5L",
  "청우 들 1.8L",
  "청우 들 350ml",
  "청우 참 1.8L",
  "청우 참 350ml",
  "태백 들② 1.75L",
  "태백 들② 1.8L",
  "태백 들② 300ml(사각)",
  "태백 들②-흰정사각 350ml",
  "태백 들③ 1.8L",
  "태백 들기름2(중국산) 1.75L",
  "태백 생들기름 300ml(사각)",
  "태백 식품 참④ 1.75L",
  "태백 참① 1.75L",
  "태백 참① 1.8L",
  "태백 참① 300ml(사각)",
  "태백 참①-350ml",
  "태백 참①-흰정사각 1.75L",
  "태백 참①-흰정사각 350ml",
  "태백 참② 1.75L",
  "태백 참② 1.8L",
  "태백 참②-흰정사각 350ml",
  "태백 참③ 1.75L",
  "태백 참③ 1.8L",
  "태백 참③-흰정사각 350ml",
  "태백 참④ 1.75L",
  "태백 참④ 1.8L",
  "태백 참④ 350ml",
  "태백 참④-흰정사각 350ml",
  "태백① 1.75L",
  "태백① 300ml(사각)",
  "토마토 참 1.8L",
  "하남댁(생들기름) 300ml(옆면)",
  "하남댁(들기름) 300ml(옆면)",
  "하남댁(참기름) 300ml(옆면)",
  "해내음 참④ 1.8L",
  "해달(수라간) 들 350ml",
  "해달(첫느낌) 들 350ml",
  "해달(조선) 들 350ml",
  "해달(수라간) 참 350ml",
  "해달(첫느낌) 참 350ml",
  "해달(조선) 참 350ml",
  "해달(금빛) 참 350ml",
];

function toId(name) {
  return "label-" + name
    .replace(/[①②③④]/g, m => ({ '①': '1', '②': '2', '③': '3', '④': '4' }[m]))
    .replace(/[^\w가-힣]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

// 1. 기존 라벨 전부 삭제
console.log("▶ 기존 라벨 삭제 중...");
const snap = await getDocs(query(collection(db, "submaterials"), where("category", "==", "라벨")));
let deleted = 0;
for (const d of snap.docs) {
  await deleteDoc(doc(db, "submaterials", d.id));
  deleted++;
}
console.log(`  삭제 완료: ${deleted}건\n`);

// 2. 새 라벨 추가
console.log("▶ 새 라벨 추가 중...");
for (const name of LABELS) {
  const id = toId(name);
  await setDoc(doc(db, "submaterials", id), {
    name,
    category: "라벨",
    price: 0,
    stock: 0,
    minStock: 0,
    unit: "장",
    image: "",
  });
  console.log(`  ✓ ${name}`);
}

console.log(`\n총 ${LABELS.length}건 추가 완료`);
process.exit(0);
