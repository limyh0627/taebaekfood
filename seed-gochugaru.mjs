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

const products = [
  {
    id: "gck-1",
    name: "고춧가루 1kg",
    category: "고춧가루",
    price: 0,
    stock: 0,
    minStock: 0,
    unit: "개",
    image: "",
    boxSize: 20,
  },
  {
    id: "gck-5",
    name: "고춧가루 5kg",
    category: "고춧가루",
    price: 0,
    stock: 0,
    minStock: 0,
    unit: "개",
    image: "",
    boxSize: 4,
  },
];

for (const product of products) {
  const { id, ...data } = product;
  await setDoc(doc(db, "submaterials", id), data);
  console.log(`추가 완료: ${product.name} (boxSize=${product.boxSize})`);
}

console.log("고춧가루 품목 추가 완료!");
process.exit(0);
