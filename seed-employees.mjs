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

const employees = [
  { id: "e1", name: "이지영",  department: "생산관리팀", position: "실장", phone: "010-0000-0000", joinDate: "2024-01-01", status: "working", carryOverLeave: 0, bonusLeave: 0, manualAdjustment: 0 },
  { id: "e2", name: "아브라함", department: "생산관리팀", position: "차장", phone: "010-0000-0000", joinDate: "2024-01-01", status: "working", carryOverLeave: 0, bonusLeave: 0, manualAdjustment: 0 },
  { id: "e3", name: "이총제",  department: "생산관리팀", position: "팀장", phone: "010-0000-0000", joinDate: "2024-01-01", status: "working", carryOverLeave: 0, bonusLeave: 0, manualAdjustment: 0 },
  { id: "e4", name: "남명숙",  department: "생산관리팀", position: "대리", phone: "010-0000-0000", joinDate: "2024-01-01", status: "working", carryOverLeave: 0, bonusLeave: 0, manualAdjustment: 0 },
  { id: "e5", name: "박은지",  department: "생산관리팀", position: "주임", phone: "010-0000-0000", joinDate: "2024-01-01", status: "working", carryOverLeave: 0, bonusLeave: 0, manualAdjustment: 0 },
  { id: "e6", name: "황준호",  department: "생산관리팀", position: "대리", phone: "010-0000-0000", joinDate: "2024-01-01", status: "working", carryOverLeave: 0, bonusLeave: 0, manualAdjustment: 0 },
];

for (const emp of employees) {
  const { id, ...data } = emp;
  await setDoc(doc(db, "employees", id), data);
  console.log(`추가 완료: ${emp.name} (${emp.position})`);
}

console.log("직원 데이터 추가 완료!");
process.exit(0);
