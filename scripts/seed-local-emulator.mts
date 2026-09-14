/** 운영 자료를 복사하지 않고 주문·배송 화면 검수에 필요한 가상 자료만 만든다. */
const projectId = 'demo-taebaekfood-local';
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8082';
if (!projectId.startsWith('demo-') || !/^127\.0\.0\.1:\d+$/.test(firestoreHost)) {
  throw new Error('가상 데이터는 로컬 demo 에뮬레이터에만 넣을 수 있습니다.');
}
process.env.FIRESTORE_EMULATOR_HOST = firestoreHost;
process.env.GCLOUD_PROJECT = projectId;

const flush = await fetch(`http://${firestoreHost}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
if (!flush.ok && flush.status !== 404) throw new Error(`로컬 데이터 초기화 실패: ${flush.status}`);

const [{ initializeApp }, { getFirestore }] = await Promise.all([
  import('firebase-admin/app'), import('firebase-admin/firestore'),
]);
const db = getFirestore(initializeApp({ projectId }));
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
  ['partners', 'partner-direct', { name:'가상직배송마트', type:'일반', partnerType:'매출처', address:'강원특별자치도 태백시 테스트로 1', region:'태백시', companyId:'taebaek' }],
  ['partners', 'partner-courier', { name:'가상온라인몰', type:'스마트스토어', partnerType:'매출처', address:'서울특별시 중구 테스트로 2', region:'서울 중구', companyId:'taebaek' }],
  ['partners', 'partner-unlinked', { name:'연결품목없는거래처', type:'택배', partnerType:'매출처', address:'부산광역시 중구 테스트로 3', region:'부산 중구', companyId:'taebaek' }],
  //  **매입처가 하나는 있어야 한다** — 없으면 매입전표를 아예 못 열어 발주카드·품목 원가 경로를
  //  로컬에서 시험할 수 없다(2026-09-13, 전표 원자 저장 검수 때 막혔다).
  ['partners', 'partner-supplier', { name:'가상부자재상사', type:'일반', partnerType:'매입처', address:'경기도 김포시 테스트로 4', region:'김포시', companyId:'taebaek' }],
  //  **계정과목이 없으면 매입전표를 발행할 수 없다** — 줄마다 계정을 골라야 하는데 고르개가
  //  비어 있어 "계정과목이 설정되지 않았다"에서 영영 막힌다(2026-09-13 검수 때 막혔다).
  //  전표·분개를 로컬에서 보려면 최소 이 넷은 있어야 한다.
  ['accountCodes', '500', { code:'500', name:'상품매입', type:'expense', normalBalance:'debit' }],
  ['accountCodes', '505', { code:'505', name:'소모품비', type:'expense', normalBalance:'debit' }],
  ['accountCodes', '800', { code:'800', name:'상품매출', type:'revenue', normalBalance:'credit' }],
  ['accountCodes', '108', { code:'108', name:'외상매출금', type:'asset', normalBalance:'debit' }],
  ['accountCodes', '251', { code:'251', name:'외상매입금', type:'liability', normalBalance:'credit' }],
  ['items', 'raw-sesame', { name:'가상 참깨 원료', type:'raw', category:'참깨', subtype:'벌크', stock:100, minStock:10, unit:'kg', image:'', lots:[{id:'local-lot-1',lotNo:'LOCAL-001',supplierName:'가상원료상사',receivedDate:day(-10),remainingKg:100,kg:100}] }],
  ['items', 'oil-350', { name:'가상 참기름/350ml', type:'product', category:'참기름', subtype:'낱개', stock:20, minStock:5, unit:'병', image:'', spec:'350ml', netContent:'350ml', weightInKg:0.32 }],
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
  ['item_bom', 'bom-oil-raw', { parent_id:'oil-350', child_id:'raw-sesame', quantity:0.4 }],
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
    items:[{ itemId:'oil-box', name:'가상 참기름/350ml (12개입)', spec:'350ml', qty:2, price:60000, supply:120000, tax:12000, total:132000, accountCode:'800' }],
    totalSupply:120000, totalTax:12000, totalAmount:132000, companyId:'taebaek' }],
  ['issuedStatements', 'stmt-sale-2', { docNo:'L-매출-0002', type:'매출', partnerId:'partner-courier', partnerName:'가상온라인몰', tradeDate:day(-1), issuedAt:atDay(-1, 10),
    items:[{ itemId:'powder-1kg', name:'가상 고춧가루/1kg', spec:'1kg', qty:10, price:12000, supply:120000, tax:0, total:120000, isTaxExempt:true, accountCode:'800' }],
    totalSupply:120000, totalTax:0, totalAmount:120000, companyId:'taebaek' }],
  //  반품(음수 수량) — 표에서 빨갛게 서는 줄이 있어야 색을 확인할 수 있다.
  ['issuedStatements', 'stmt-return', { docNo:'L-매출-0003', type:'매출', partnerId:'partner-direct', partnerName:'가상직배송마트', tradeDate:day(-1), issuedAt:atDay(-1, 16),
    items:[{ itemId:'oil-350', name:'가상 참기름/350ml', spec:'350ml', qty:-2, price:5000, supply:-10000, tax:-1000, total:-11000, accountCode:'800' }],
    totalSupply:-10000, totalTax:-1000, totalAmount:-11000, companyId:'taebaek' }],
  ['issuedStatements', 'stmt-buy-1', { docNo:'L-매입-0001', type:'매입', partnerId:'partner-supplier', partnerName:'가상부자재상사', tradeDate:day(-5), issuedAt:atDay(-5, 11),
    items:[{ itemId:'bottle-350', name:'가상 350ml 병', qty:200, price:150, supply:30000, tax:3000, total:33000, accountCode:'500' }],
    totalSupply:30000, totalTax:3000, totalAmount:33000, companyId:'taebaek' }],
  //  자금원장 — 입금(수금)·출금(비용)·지불. 수금·지불 줄은 `partnerId` 가 붙어야 표에 선다.
  ['cashEntries', 'cash-expense', { docNo:'L-자금-0001', date:day(-2), dir:'출금', amount:84000, accountCode:'505', note:'로컬 소모품 구입', method:'계좌', createdAt:atDay(-2, 9), companyId:'taebaek' }],
  ['cashEntries', 'cash-collect', { docNo:'L-자금-0002', date:day(-1), dir:'입금', amount:132000, partnerId:'partner-direct', partnerName:'가상직배송마트', note:'매출 대금 수금', method:'계좌', createdAt:atDay(-1, 15), companyId:'taebaek' }],
  ['cashEntries', 'cash-pay', { docNo:'L-자금-0003', date:day(0), dir:'출금', amount:33000, partnerId:'partner-supplier', partnerName:'가상부자재상사', note:'부자재 대금 지불', method:'현금', createdAt:atDay(0, 9), companyId:'taebaek' }],
];
for (const [collection, id, data] of docs) await db.collection(collection).doc(id).set(data);
console.log(`로컬 테스트 데이터 ${docs.length}건 준비 완료`);
console.log('로그인: testadmin / localtest');
