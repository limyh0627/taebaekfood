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
  ['orders', 'order-hold', { cardNo:'ORD-LOCAL-05', partnerId:'partner-unlinked', partnerName:'연결품목없는거래처', items:[{itemId:'oil-350',name:'가상 참기름/350ml',quantity:3,price:5000,labelType:'대기'}], totalAmount:15000, status:'ON_HOLD', createdAt:atDay(-3), deliveryDate:day(2), email:'', source:'택배', region:'부산 중구' }],
];
for (const [collection, id, data] of docs) await db.collection(collection).doc(id).set(data);
console.log(`로컬 테스트 데이터 ${docs.length}건 준비 완료`);
console.log('로그인: testadmin / localtest');
