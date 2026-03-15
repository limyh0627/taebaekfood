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

await setDoc(doc(db, "submaterials", "container-165kg-can"), {
  name: "16.5kg캔",
  category: "용기",
  용량: "16.5kg",
  price: 0,
  stock: 0,
  minStock: 0,
  unit: "개",
  image: "",
});

console.log("추가 완료: 16.5kg캔");
process.exit(0);
