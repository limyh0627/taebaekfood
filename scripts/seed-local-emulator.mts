/** 운영 자료를 복사하지 않고 주문·배송 화면 검수에 필요한 가상 자료만 만든다. */
const projectId = 'demo-taebaekfood-local';
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8082';
if (!projectId.startsWith('demo-') || !/^127\.0\.0\.1:\d+$/.test(firestoreHost)) {
  throw new Error('가상 데이터는 로컬 demo 에뮬레이터에만 넣을 수 있습니다.');
}
process.env.FIRESTORE_EMULATOR_HOST = firestoreHost;
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
process.env.GCLOUD_PROJECT = projectId;

const flush = await fetch(`http://${firestoreHost}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
if (!flush.ok && flush.status !== 404) throw new Error(`로컬 데이터 초기화 실패: ${flush.status}`);

const [{ initializeApp }, { getFirestore }, { getAuth }] = await Promise.all([
  import('firebase-admin/app'), import('firebase-admin/firestore'), import('firebase-admin/auth'),
]);
const adminApp = initializeApp({ projectId });
const db = getFirestore(adminApp);
const auth = getAuth(adminApp);
try { await auth.deleteUser('local-admin'); } catch { /* 첫 실행에는 없다 */ }
await auth.createUser({ uid: 'local-admin', email: 'testadmin@local.test', password: 'localtest', displayName: '테스트 관리자' });
await auth.setCustomUserClaims('local-admin', { employeeId: 'local-admin', companyId: 'taebaek', isAdmin: true });
const atDay = (offset: number, hour = 9) => {
  const value = new Date();
  value.setHours(hour, 0, 0, 0);
  value.setDate(value.getDate() + offset);
  return value.toISOString();
};
const day = (offset: number) => atDay(offset).slice(0, 10);
const docs: Array<[string, string, Record<string, unknown>]> = [
  ['settings', 'company', { name:'로컬 테스트 식품', ceoName:'테스트', bizNo:'000-00-00000', bizType:'제조업', bizItem:'식품', address:'운영 DB와 분리된 가상 주소', adminPassword:'0000' }],
  ['employees', 'local-admin', { name:'테스트 관리자', username:'testadmin', password:'localtest', position:'관리자', department:'테스트', joinDate:day(-365), status:'working', phone:'010-0000-0000', adminAccess:true, companyId:'taebaek' }],
  ['employees', 'local-staff', { name:'테스트 직원', username:'teststaff', password:'localtest', position:'사원', department:'생산', joinDate:day(-120), status:'working', phone:'010-0000-0001', adminAccess:false, companyId:'taebaek' }],
  // 오피스톡 초대·전송·모바일 줄바꿈을 운영 자료 없이 검수하기 위한 방이다.
  ['chatRooms', 'local-chat-room', { name:'로컬 검수방', participantIds:['local-admin'], participantCompanies:{'local-admin':'taebaek'}, createdBy:'local-admin', lastUpdatedAt:atDay(-1), isGroup:false, companyId:'taebaek' }],
  ['chatMessages', 'local-chat-message', { roomId:'local-chat-room', senderId:'local-admin', senderName:'테스트 관리자', text:'오피스톡 검수용 메시지입니다.', createdAt:atDay(-1), companyId:'taebaek' }],
  ['appMeta', 'workOrderReset_taebaek', { date:new Date().toLocaleDateString('ko-KR', { timeZone:'Asia/Seoul' }).replace(/\. /g, '-').replace('.', ''), companyId:'taebaek' }],
  ['partners', 'partner-direct', { name:'가상직배송마트', type:'일반', partnerType:'매출처', address:'강원특별자치도 태백시 테스트로 1', region:'태백시', companyId:'taebaek' }],
  ['partners', 'partner-courier', { name:'가상온라인몰', type:'스마트스토어', partnerType:'매출처', address:'서울특별시 중구 테스트로 2', region:'서울 중구', companyId:'taebaek' }],
  ['partners', 'partner-unlinked', { name:'연결품목없는거래처', type:'택배', partnerType:'매출처', address:'부산광역시 중구 테스트로 3', region:'부산 중구', companyId:'taebaek' }],
  //  **매입처가 하나는 있어야 한다** — 없으면 매입전표를 아예 못 열어 발주카드·품목 원가 경로를
  //  로컬에서 시험할 수 없다(2026-09-13, 전표 원자 저장 검수 때 막혔다).
  ['partners', 'partner-supplier', { name:'가상부자재상사', type:'일반', partnerType:'매입처', address:'경기도 김포시 테스트로 4', region:'김포시', companyId:'taebaek' }],
  //  **계정과목이 없으면 매입전표를 발행할 수 없다** — 줄마다 계정을 골라야 하는데 고르개가
  //  비어 있어 "계정과목이 설정되지 않았다"에서 영영 막힌다(2026-09-13 검수 때 막혔다).
  //  전표·분개를 로컬에서 보려면 최소 이 넷은 있어야 한다.
  ['accountCodes', '500', { code:'500', name:'원료매입', type:'비용', normalBalance:'debit' }],
  ['accountCodes', '505', { code:'505', name:'부자재매입', type:'비용', normalBalance:'debit' }],
  ['accountCodes', '404', { code:'404', name:'제품매출', type:'수익', normalBalance:'credit' }],
  ['accountCodes', '122', { code:'122', name:'비품', type:'자산', normalBalance:'debit', note:'오래 사용하는 컴퓨터·책상·장비' }],
  ['accountCodes', '830', { code:'830', name:'소모품비', type:'비용', normalBalance:'debit', note:'짧게 쓰고 소모되는 문구·청소용품·소형도구' }],
  ['accountCodes', '108', { code:'108', name:'외상매출금', type:'asset', normalBalance:'debit' }],
  ['accountCodes', '251', { code:'251', name:'외상매입금', type:'liability', normalBalance:'credit' }],
  // 혼합 사용·FIFO 순서·대기/사용중 상태를 화면에서 직접 검수할 수 있도록 한 품목에 활성 로트 3개를 둔다.
  ['items', 'raw-sesame', { name:'가상 참깨 원료', type:'raw', category:'참깨', subtype:'벌크', stock:100, minStock:10, unit:'kg', image:'', lots:[
    {id:'local-lot-1',lotNo:'LOCAL-001',supplierName:'가상원료상사',receivedDate:day(-10),createdAt:atDay(-10),kgIn:50,qtyIn:2.5,packageKg:20,packageType:'포',kgRemaining:30,status:'active'},
    {id:'local-lot-2',lotNo:'LOCAL-002',supplierName:'가상곡물유통',receivedDate:day(-7),createdAt:atDay(-7),kgIn:40,qtyIn:2,packageKg:20,packageType:'포',kgRemaining:40,status:'active'},
    {id:'local-lot-3',lotNo:'LOCAL-003',supplierName:'가상농산',receivedDate:day(-3),createdAt:atDay(-3),kgIn:30,qtyIn:1.5,packageKg:20,packageType:'포',kgRemaining:30,status:'active'},
  ] }],
  // 기름만 제공되는 다중 혼합 UI를 검수하는 전용 품목. 배열 순서가 실제 FIFO 차감 순서다.
  ['items', 'raw-oil', { name:'가상 참기름 원액', rawMaterialName:'가상 참기름 원액', isRawMaterial:true, type:'raw', category:'참기름', subtype:'벌크', stock:100, minStock:10, unit:'L', density:0.92, image:'', lots:[
    {id:'local-oil-lot-1',lotNo:'OIL-001',supplierName:'가상압착소A',receivedDate:day(-12),createdAt:atDay(-12),kgIn:40,qtyIn:2,packageKg:20,packageType:'캔',kgRemaining:25,status:'active'},
    {id:'local-oil-lot-2',lotNo:'OIL-002',supplierName:'가상압착소B',receivedDate:day(-8),createdAt:atDay(-8),kgIn:40,qtyIn:2,packageKg:20,packageType:'캔',kgRemaining:40,status:'active'},
    {id:'local-oil-lot-3',lotNo:'OIL-003',supplierName:'가상압착소C',receivedDate:day(-4),createdAt:atDay(-4),kgIn:35,qtyIn:1.75,packageKg:20,packageType:'캔',kgRemaining:35,status:'active'},
  ] }],
  // FIFO 순서 변경은 items 사본뿐 아니라 원자재 상태도 함께 갱신한다. 둘 다 있어야 실제 저장 경로를 검수할 수 있다.
  ['rawInventories', 'taebaek__raw-sesame', { id:'taebaek__raw-sesame', rawItemId:'raw-sesame', materialSnapshot:'가상 참깨 원료', stockKg:100, revision:0, lastProcessedAt:atDay(-1), recentDepletedLots:[], activeLots:[
    {id:'local-lot-1',lotNo:'LOCAL-001',supplierName:'가상원료상사',receivedDate:day(-10),createdAt:atDay(-10),kgIn:50,qtyIn:2.5,packageKg:20,packageType:'포',kgRemaining:30,status:'active'},
    {id:'local-lot-2',lotNo:'LOCAL-002',supplierName:'가상곡물유통',receivedDate:day(-7),createdAt:atDay(-7),kgIn:40,qtyIn:2,packageKg:20,packageType:'포',kgRemaining:40,status:'active'},
    {id:'local-lot-3',lotNo:'LOCAL-003',supplierName:'가상농산',receivedDate:day(-3),createdAt:atDay(-3),kgIn:30,qtyIn:1.5,packageKg:20,packageType:'포',kgRemaining:30,status:'active'},
  ] }],
  ['rawInventories', 'taebaek__raw-oil', { id:'taebaek__raw-oil', rawItemId:'raw-oil', materialSnapshot:'가상 참기름 원액', stockKg:100, revision:0, lastProcessedAt:atDay(-1), recentDepletedLots:[], activeLots:[
    {id:'local-oil-lot-1',lotNo:'OIL-001',supplierName:'가상압착소A',receivedDate:day(-12),createdAt:atDay(-12),kgIn:40,qtyIn:2,packageKg:20,packageType:'캔',kgRemaining:25,status:'active'},
    {id:'local-oil-lot-2',lotNo:'OIL-002',supplierName:'가상압착소B',receivedDate:day(-8),createdAt:atDay(-8),kgIn:40,qtyIn:2,packageKg:20,packageType:'캔',kgRemaining:40,status:'active'},
    {id:'local-oil-lot-3',lotNo:'OIL-003',supplierName:'가상압착소C',receivedDate:day(-4),createdAt:atDay(-4),kgIn:35,qtyIn:1.75,packageKg:20,packageType:'캔',kgRemaining:35,status:'active'},
  ] }],
  ['items', 'oil-350', { name:'가상 참기름/350ml', type:'product', category:'참기름', subtype:'낱개', stock:20, minStock:5, unit:'병', image:'', spec:'350ml', netContent:'350ml', weightInKg:0.32, lots:[{id:'local-product-lot-1',lotNo:'LOCAL-P01',supplierName:'자체생산',receivedDate:day(-3),createdAt:atDay(-3),qtyIn:26,qtyRemaining:20,kgRemaining:6.4,unitKg:0.32,status:'active'}] }],
  ['items', 'oil-box', { name:'가상 참기름/350ml (12개입)', type:'product', category:'참기름', subtype:'박스', stock:3, minStock:1, unit:'박스', image:'', spec:'350ml' }],
  ['items', 'powder-1kg', { name:'가상 고춧가루/1kg', type:'goods', category:'고춧가루', subtype:'낱개', stock:30, minStock:5, unit:'개', image:'', spec:'1kg' }],
  ['items', 'bottle-350', { name:'가상 350ml 병', type:'submaterial', category:'용기', stock:200, minStock:20, unit:'개', image:'' }],
  ['items', 'cap-350', { name:'가상 350ml 뚜껑', type:'submaterial', category:'마개', stock:200, minStock:20, unit:'개', image:'' }],
  ['items', 'label-350', { name:'가상 참기름 라벨', type:'submaterial', category:'라벨', stock:200, minStock:20, unit:'개', image:'' }],
  ['items', 'shipping-box-12', { name:'가상 12입 박스', type:'submaterial', category:'박스', stock:50, minStock:5, unit:'개', image:'' }],
  ['items', 'shipping-tape', { name:'가상 포장 테이프', type:'submaterial', category:'테이프', stock:20, minStock:2, unit:'개', image:'' }],
  ['items', 'archived-oil', { name:'노출되면 안 되는 archived 품목', type:'product', category:'참기름', subtype:'낱개', stock:0, minStock:0, unit:'병', image:'', archived:true }],
  ['partner_item', 'direct-oil', { partnerId:'partner-direct', itemId:'oil-350', Direction:'out', price:5000, taxType:'과세' }],
  //  매입 쪽 연결 — 병·뚜껑을 사 온다(Direction:'in'). 여기 단가가 매입전표의 기본값이 된다.
  //  **임가공 품목** — 우리가 만들지 않고 맡겨서 받아 오는 것(2026-09-14).
  //  작업완료를 눌러도 생산이 없어 재고 확인창(`buildStockUseRows`)이 건너뛴다.
  //  대신 재고를 쓰는지/모자라 음수가 되는지 알리는 창이 뜨는지 여기서 본다.
  ['items', 'oem-sesame', { name:'가상 볶음참깨/1kg', type:'product', procureType:'임가공', category:'참깨', subtype:'박스', stock:5, minStock:0, unit:'박스', price:12000, cost:9000, image:'' }],
  ['partner_item', 'direct-oem', { partnerId:'partner-direct', itemId:'oem-sesame', Direction:'out', price:12000, taxType:'과세' }],
  ['partner_item', 'supplier-bottle', { partnerId:'partner-supplier', itemId:'bottle-350', Direction:'in', price:330, taxType:'과세', Account_Code:'505' }],
  ['partner_item', 'supplier-cap', { partnerId:'partner-supplier', itemId:'cap-350', Direction:'in', price:88, taxType:'과세', Account_Code:'505' }],
  ['partner_item', 'direct-box', { partnerId:'partner-direct', itemId:'oil-box', Direction:'out', price:60000, taxType:'과세' }],
  ['partner_item', 'courier-powder', { partnerId:'partner-courier', itemId:'powder-1kg', Direction:'out', price:12000, taxType:'면세', isSmartStore:true }],
  ['item_bom', 'bom-oil-raw', { parent_id:'oil-350', child_id:'raw-oil', quantity:0.4 }],
  ['item_bom', 'bom-oil-bottle', { parent_id:'oil-350', child_id:'bottle-350', quantity:1 }],
  ['item_bom', 'bom-oil-cap', { parent_id:'oil-350', child_id:'cap-350', quantity:1 }],
  ['item_bom', 'bom-oil-label', { parent_id:'oil-350', child_id:'label-350', quantity:1 }],
  ['item_bom', 'bom-box-oil', { parent_id:'oil-box', child_id:'oil-350', quantity:12 }],
  ['item_bom', 'bom-box-carton', { parent_id:'oil-box', child_id:'shipping-box-12', quantity:1 }],
  ['item_bom', 'bom-box-tape', { parent_id:'oil-box', child_id:'shipping-tape', quantity:0.02 }],
  ['item_pack', 'pack-powder', { item_id:'powder-1kg', units_per_box:10 }],
  ['pallets', 'pallet-blue', { name:'가상 청색 팔레트', total:30, inUse:0, damaged:0 }],
  ['orders', 'order-pending', { cardNo:'ORD-LOCAL-01', partnerId:'partner-direct', partnerName:'가상직배송마트', items:[{itemId:'oil-box',name:'가상 참기름/350ml (12개입)',quantity:2,price:60000,isBoxUnit:true,boxQuantity:2,unitsPerBox:12,labelType:'대기'}], totalAmount:120000, status:'PENDING', createdAt:atDay(-2), deliveryDate:day(1), email:'', source:'일반', pallets:[{type:'pallet-blue',quantity:1}], region:'태백시' }],
  ['orders', 'order-processing', { cardNo:'ORD-LOCAL-02', partnerId:'partner-courier', partnerName:'가상온라인몰', items:[{itemId:'powder-1kg',name:'가상 고춧가루/1kg',quantity:10,price:12000,checked:true,checkedBy:'테스트 관리자',checkedAt:atDay(-1),labelType:'부착',mfgDate:day(-30)},{itemId:'oil-350',name:'가상 참기름/350ml',quantity:4,price:5000,labelType:'대기'}], totalAmount:140000, status:'PROCESSING', createdAt:atDay(-1), deliveryDate:day(0), email:'', source:'스마트스토어', invoicePrinted:false, region:'서울 중구' }],
  ['orders', 'order-done', { cardNo:'ORD-LOCAL-03', partnerId:'partner-direct', partnerName:'가상직배송마트', items:[{itemId:'oil-350',name:'가상 참기름/350ml',quantity:6,price:5000,checked:true,checkedBy:'테스트 관리자',checkedAt:atDay(-1),labelType:'날인',mfgDate:day(-20)}], totalAmount:30000, status:'DISPATCHED', createdAt:atDay(-4), deliveryDate:day(0), email:'', source:'일반', producedAt:atDay(-1), region:'태백시' }],
  ['orders', 'order-shipped', { cardNo:'ORD-LOCAL-04', partnerId:'partner-courier', partnerName:'가상온라인몰', items:[{itemId:'powder-1kg',name:'가상 고춧가루/1kg',quantity:5,price:12000,checked:true,checkedBy:'테스트 관리자',checkedAt:atDay(-2),labelType:'부착'}], totalAmount:60000, status:'SHIPPED', createdAt:atDay(-5), deliveryDate:day(-1), email:'', source:'택배', invoicePrinted:true, shipmentConfirmedBy:'테스트 관리자', shipmentConfirmedAt:atDay(-1), shippedOut:true, region:'서울 중구' }],
  //  임가공 품목 주문 둘 — **재고가 넉넉한 것**(3박스 ≤ 재고 5)과 **모자란 것**(9박스 > 5).
  ['orders', 'order-oem-enough', { cardNo:'ORD-LOCAL-08', partnerId:'partner-direct', partnerName:'가상직배송마트', items:[{itemId:'oem-sesame',name:'가상 볶음참깨/1kg',quantity:3,price:12000,labelType:'대기'}], totalAmount:36000, status:'PENDING', createdAt:atDay(-1), deliveryDate:day(0), email:'', source:'일반', region:'태백시' }],
  ['orders', 'order-oem-short', { cardNo:'ORD-LOCAL-09', partnerId:'partner-direct', partnerName:'가상직배송마트', items:[{itemId:'oem-sesame',name:'가상 볶음참깨/1kg',quantity:9,price:12000,labelType:'대기'}], totalAmount:108000, status:'PENDING', createdAt:atDay(-1), deliveryDate:day(0), email:'', source:'일반', region:'태백시' }],
  ['orders', 'order-hold', { cardNo:'ORD-LOCAL-05', partnerId:'partner-unlinked', partnerName:'연결품목없는거래처', items:[{itemId:'oil-350',name:'가상 참기름/350ml',quantity:3,price:5000,labelType:'대기'}], totalAmount:15000, status:'ON_HOLD', createdAt:atDay(-3), deliveryDate:day(2), email:'', source:'택배', region:'부산 중구' }],
  //  **전표 화면을 로컬에서 보려면 전표가 있어야 한다**(2026-09-15). 시드에 한 건도 없어서
  //  에뮬레이터로는 발행내역 표가 늘 비어 있었고, 전표 UI 를 손볼 때마다 운영 데이터를
  //  띄워 보는 수밖에 없었다. 표에 서는 **세 갈래를 다 넣는다** —
  //  매출·매입 전표 · 자금(입금/출금) · 수금/지불. 줄마다 그리는 코드가 달라 하나로는 못 본다.
  ['issuedStatements', 'stmt-sale-1', { docNo:'L-매출-0001', type:'매출', partnerId:'partner-direct', partnerName:'가상직배송마트', tradeDate:day(-3), issuedAt:atDay(-3, 14),
    items:[{ itemId:'oil-box', name:'가상 참기름/350ml (12개입)', spec:'350ml', qty:2, price:60000, supply:120000, tax:12000, total:132000, accountCode:'404' }],
    totalSupply:120000, totalTax:12000, totalAmount:132000, companyId:'taebaek' }],
  ['issuedStatements', 'stmt-sale-2', { docNo:'L-매출-0002', type:'매출', partnerId:'partner-courier', partnerName:'가상온라인몰', tradeDate:day(-1), issuedAt:atDay(-1, 10),
    items:[{ itemId:'powder-1kg', name:'가상 고춧가루/1kg', spec:'1kg', qty:10, price:12000, supply:120000, tax:0, total:120000, isTaxExempt:true, accountCode:'404' }],
    totalSupply:120000, totalTax:0, totalAmount:120000, companyId:'taebaek' }],
  //  반품(음수 수량) — 표에서 빨갛게 서는 줄이 있어야 색을 확인할 수 있다.
  ['issuedStatements', 'stmt-return', { docNo:'L-매출-0003', type:'매출', partnerId:'partner-direct', partnerName:'가상직배송마트', tradeDate:day(-1), issuedAt:atDay(-1, 16),
    items:[{ itemId:'oil-350', name:'가상 참기름/350ml', spec:'350ml', qty:-2, price:5000, supply:-10000, tax:-1000, total:-11000, accountCode:'404' }],
    totalSupply:-10000, totalTax:-1000, totalAmount:-11000, companyId:'taebaek' }],
  ['issuedStatements', 'stmt-buy-1', { docNo:'L-매입-0001', type:'매입', partnerId:'partner-supplier', partnerName:'가상부자재상사', tradeDate:day(-5), issuedAt:atDay(-5, 11),
    items:[{ itemId:'bottle-350', name:'가상 350ml 병', qty:200, price:150, supply:30000, tax:3000, total:33000, accountCode:'500' }],
    totalSupply:30000, totalTax:3000, totalAmount:33000, companyId:'taebaek' }],
  //  자금원장 — 입금(수금)·출금(비용)·지불. 수금·지불 줄은 `partnerId` 가 붙어야 표에 선다.
  ['cashEntries', 'cash-expense', { docNo:'L-자금-0001', date:day(-2), dir:'출금', amount:84000, accountCode:'505', note:'로컬 소모품 구입', method:'계좌', createdAt:atDay(-2, 9), companyId:'taebaek' }],
  ['cashEntries', 'cash-collect', { docNo:'L-자금-0002', date:day(-1), dir:'입금', amount:132000, partnerId:'partner-direct', partnerName:'가상직배송마트', note:'매출 대금 수금', method:'계좌', createdAt:atDay(-1, 15), companyId:'taebaek' }],
  ['cashEntries', 'cash-pay', { docNo:'L-자금-0003', date:day(0), dir:'출금', amount:33000, partnerId:'partner-supplier', partnerName:'가상부자재상사', note:'부자재 대금 지불', method:'현금', createdAt:atDay(0, 9), companyId:'taebaek' }],
  ['rawMaterialLedger', 'local-raw-in', { rawItemId:'raw-sesame', material:'가상 참깨 원료', date:day(-10), received:120, used:0, note:'가상원료상사 입고', createdAt:atDay(-10), recordedAt:atDay(-10), sequence:1, balanceAfterKg:120, type:'manual', unit:'kg' }],
  ['rawMaterialLedger', 'local-raw-use', { rawItemId:'raw-sesame', material:'가상 참깨 원료', date:day(-3), received:0, used:20, note:'가상 참기름 생산 사용', createdAt:atDay(-3), recordedAt:atDay(-3), sequence:2, balanceAfterKg:100, type:'auto', unit:'kg', orderId:'order-done' }],
];
for (const [collection, id, data] of docs) {
  // 회사 분리 규칙을 실제로 통과하는 시드여야 화면 검수가 된다. 옛 시드처럼 회사값이 없으면 전부 빈 목록이 된다.
  const scoped = collection === 'settings' ? data : { companyId: 'taebaek', ...data };
  await db.collection(collection).doc(id).set(scoped);
}
console.log(`로컬 테스트 데이터 ${docs.length}건 준비 완료`);
console.log('로그인: testadmin / localtest');
