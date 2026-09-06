import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
await signInAnonymously(getAuth(app));
const codes = (await getDocs(collection(getFirestore(app), 'accountCodes'))).docs.map(d => d.data() as any);
for (const c of codes.filter((c: any) => ['650','980','819','500','253','251'].includes(String(c.code))))
  console.log(JSON.stringify(c));
