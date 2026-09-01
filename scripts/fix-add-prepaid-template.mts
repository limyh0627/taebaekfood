// 선급금 템플릿을 만든다 — 초과지급이 갈 자리.
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// 선수금(259)은 있는데 **선급금(131)이 없었다.** 그래서 거래처에 갚을 것보다 더 보냈을 때
// 갈 데가 없어 251 외상매입금이 음수로 밀렸다 — "안 진 빚을 갚았다"가 되는 자리다.
// 초과수금은 259 선수금, 초과지급은 131 선급금이 맞다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const ID = 'fct-builtin-prepaid';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

if (UNDO) { await deleteDoc(doc(db, 'fixedCostTemplates', ID)); console.log('✅ 삭제'); process.exit(0); }

const tpls = (await getDocs(collection(db, 'fixedCostTemplates'))).docs.map(d => ({ id: d.id, ...d.data() } as any));
if (tpls.some((t: any) => t.id === ID)) { console.log('이미 있다.'); process.exit(0); }

//  회사를 안 단다 — 계정만 붙은 뼈대라 두 회사가 같이 쓴다(선수금과 같은 자리)
const T = {
  id: ID, builtin: 'prepaid', kind: 'voucher',
  name: '선급금', accountCode: '131', dir: '출금', mode: '일반',
  group: '거래처', category: '기타', amount: 0, active: false, hidden: false,
  note: '초과지급·선지급',
};
console.log(`만들 템플릿:  ${T.name}  ${T.dir}  ${T.accountCode} 선급금  묶음 ${T.group}`);
const adv = tpls.find((t: any) => t.builtin === 'advance');
console.log(`짝이 되는 것: ${adv ? `${adv.name} ${adv.dir} ${adv.accountCode}` : '(선수금 템플릿이 없다)'}`);
if (!APPLY) { console.log('\n(--dry) 적용하려면 --apply'); process.exit(0); }
await setDoc(doc(db, 'fixedCostTemplates', ID), T);
console.log('\n✅ 만들었다.  되돌리기: npx tsx scripts/fix-add-prepaid-template.mts --undo');
process.exit(0);
