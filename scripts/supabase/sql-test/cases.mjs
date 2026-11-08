// 새 ERP DB 규칙(supabase/sql) 시험 — 메모리 Postgres(pglite)에 시험 이전 SQL을 처음부터 다 돌리고
// 업무 흐름(주문→생산→출고→전표→반품, 발주·입고, 임가공, 휴가, 채팅, 업무…)을 차례로 실행해 결과를 남긴다.
// run.mjs가 이 결과를 expected.txt와 견준다. 일부러 바꾼 결과면 `node run.mjs --update`로 다시 적는다.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
export const lines=[];
const out=(...a)=>lines.push(a.join(' '));
const dir=new URL('../../../supabase/sql/', import.meta.url).pathname;
const copy=name=>fs.readFileSync(dir+fs.readdirSync(dir).find(f=>f.endsWith('_'+name+'.sql')),'utf8');
// 시계를 2026-11-05 12:00(한국)에 고정한다. 오늘 날짜로 매기는 번호·날짜가 돌리는 날마다 바뀌지 않게.
const realNow=Date.now.bind(Date), clockOff=Date.UTC(2026,10,5,3,0,0)-realNow();
Date.now=()=>realNow()+clockOff;
const db=new PGlite();
await db.exec(`create role anon; create role authenticated;
create schema auth; create table auth.users(id uuid primary key, email text, last_sign_in_at timestamptz, raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('t.uid', true),'')::uuid $$;
create schema storage; create table storage.buckets(id text primary key, name text, public boolean); create table storage.objects(id uuid, bucket_id text, name text, owner uuid);
create function storage.foldername(n text) returns text[] language sql as $$ select string_to_array(n,'/') $$;`);

await db.exec(fs.readFileSync(dir+'000_raw.sql','utf8'));
// 이관 기준일(cutover)은 아래 기능 시험이 끝난 뒤 따로 시험한다 — 처음에는 끈다(실제 이관 기본값은 2026-10-01에 켬)
await db.exec(`create schema if not exists app; create table app.migration_settings (company_id text primary key, cutoff date not null default date '2026-10-01', apply boolean not null default true);
insert into app.migration_settings values ('taebaek', date '2026-10-01', false), ('punghoe', date '2026-10-01', false);`);
const docs=[
 ['partners','P1','taebaek',{name:'모란식품',partnerType:'매출처'}],
 ['partners','P7','taebaek',{name:'쿠팡',type:'택배',phone:'02-1',shipTos:[{id:'st1',name:'쿠팡 이천센터'},{id:'st2',name:'쿠팡 덕평',archived:true}],defaultShipMethod:'택배'}],
 ['items','FG1','taebaek',{name:'참기름 300ml',type:'product',unit:'개',stock:120,cost:3000}],
 ['items','WIP1','taebaek',{name:'통깨참기름',type:'wip',unit:'kg',stock:5}],
 ['partners','S1','taebaek',{name:'참깨상회',partnerType:'매입처'}],
 ['items','RAW1','taebaek',{name:'참깨',type:'raw',unit:'kg',stock:0}],
 ['items','RAW2','taebaek',{name:'참깨 ',type:'raw',unit:'kg',stock:0}],
 ['item_bom','B1','taebaek',{parent_id:'FG1',child_id:'WIP1',quantity:0.3}],
 ['items','WIP1x','taebaek',{name:'통깨참기름2',type:'wip',unit:'kg',stock:2}],
 ['pallets','PL1','taebaek',{name:'아주파렛트',total:50}],
 ['partner_item','PIX','taebaek',{partnerId:'P1',itemId:'FG1',Direction:'out',price:5500}],
 ['item_pack','K1','taebaek',{item_id:'FG1',units_per_box:20}],
 ['employees','E9','taebaek',{name:'정직원',status:'working',authUid:'fbuid9'}],
 ['chatRooms','R1','taebaek',{name:'옛방',isGroup:false,participantIds:['fbuid9','fbx'],lastUpdatedAt:'2026-10-01T00:00:00Z',lastReadBy:{fbuid9:'2026-10-01'}}],
 ['chatMessages','M1','taebaek',{roomId:'R1',senderId:'fbuid9',senderName:'정직원',text:'안녕',createdAt:'2026-10-01T00:00:00Z',reactions:{'👍':['fbuid9','fbx'],'😢':[]},mentions:['E1','admin']}],
 ['notices','N1','taebaek',{title:'옛 공지',blocks:[{type:'text',text:'첫 줄'},{type:'image',url:'https://x/y.png'}],tag:'공지',date:'2026-10-01'}],
 ['users','OLDU','taebaek',{uid:'fb1',username:'moran',name:'모란',email:'moran@x.com',phone:'010-1',type:'business',status:'approved',linkedPartnerId:'P1'}],
 ['haccp_templates','sanitation','taebaek',{items:[{item:'바닥',standard:'깨끗'}]}],
 ['haccp_sanitation','HS1','taebaek',{checkDate:'2026-11-03',checkTime:'08:30',rows:[{result:'pass',note:'',inspector:'이'}],createdBy:'이은경'}],
 ['haccp_cleaning','HC1','taebaek',{month:'2026-11',machineRows:[{machine:'착유기 1호'}],areaRows:[]}],
 ['employees','E1','taebaek',{name:'이은경',status:'working',joinDate:'2020-03-01'}],
 ['items','BOX1','taebaek',{name:'참기름 300ml 박스(10)',type:'product',unit:'박스',stock:5,category:'참기름',spec:'300ml * 10'}],
 ['item_bom','B2','taebaek',{parent_id:'BOX1',child_id:'FG1',quantity:10}],
 ['items','BULK1','taebaek',{name:'참기름 벌크',type:'wip',subtype:'벌크',unit:'kg',stock:0}],
 ['items','CAN1','taebaek',{name:'참기름 18L 캔',type:'product',unit:'개',stock:3,unpackable:true}],
 ['item_bom','B3','taebaek',{parent_id:'CAN1',child_id:'BULK1',quantity:16.5}],
 ['items','SES','taebaek',{name:'참깨/중국산',type:'raw',unit:'kg',stock:0}],
 ['items','OIL1','taebaek',{name:'통깨참기름/벌크',type:'wip',subtype:'벌크',unit:'kg',stock:0}],
 ['items','OEMP','taebaek',{name:'볶음참깨 1kg',type:'product',unit:'개',spec:'1kg',procureType:'임가공',stock:0}],
 ['adjustmentRequests','AR1','taebaek',{itemId:'FG1',type:'quantity_change',status:'pending',reason:'파손',originalQuantity:100,requestedQuantity:95,requestedAt:'2026-11-01T00:00:00Z'}],
 ['adjustmentRequests','AR2','taebaek',{itemId:'RAW1',type:'reorder_alert',status:'pending',reason:'부족',requestedAt:'2026-11-01T00:00:00Z'}],
 ['purchaseOrders','POI','taebaek',{partnerId:'S1',status:'invoiced',items:[{itemId:'RAW1',quantity:200}],createdAt:'2026-11-01T00:00:00Z'}],
 ['settings','deliveryOrdering','taebaek',{byDate:{'2026-11-05':{ordering:['O1'],timeSlots:{O1:'오후'},done:[],by:{name:'이은경',at:'2026-11-04T09:00:00Z'},groups:[{id:'g1',name:'김포',orderIds:['O1']}]}},timeSlots:{}}],
 ['orders','O9','taebaek',{partnerId:'P1',partnerName:'모란식품',status:'PENDING',deliveryDate:'2026-11-07',createdAt:'2026-11-01T01:00:00.000Z',items:[{lineId:'a',itemId:'FG1',name:'참기름',quantity:20,price:5000},{lineId:'b',itemId:'RAW1',name:'참깨',quantity:5,price:1000}]}],
 ['orders','O1','taebaek',{partnerId:'P1',partnerName:'모란식품',status:'PENDING',deliveryDate:'2026-11-05',totalAmount:100000,sourceChatMessageId:'M1',createdAt:'2026-11-01T01:00:00.000Z',items:[{lineId:'l1',itemId:'FG1',name:'참기름',quantity:20,price:5000}]}],
 ['leaveRequests','LV1','taebaek',{employeeId:'E9',employeeName:'정직원',type:'연차',startDate:'2026-11-10',endDate:'2026-11-11',daysUsed:2,status:'approved',modifyRequest:{startDate:'2026-11-12',endDate:'2026-11-12',daysUsed:1,reason:'하루만',status:'pending'}}],
 ['leaveRequests','LV2','taebaek',{employeeId:'E9',employeeName:'정직원',type:'연차',startDate:'2026-12-01',endDate:'2026-12-01',daysUsed:1,status:'cancel_pending'}],
 ['leaveRequests','LV3','taebaek',{employeeId:'E9',type:'연차',startDate:'2026-09-01',endDate:'2026-09-01',daysUsed:1,status:'cancelled'}],
 ['orders','OB1','taebaek',{partnerId:'P1',partnerName:'모란식품',status:'DELIVERED',deliveryDate:'2026-10-10',createdAt:'2026-10-09T01:00:00.000Z',items:[{lineId:'q',itemId:'FG1',name:'참기름',quantity:1,price:1000}]}],
 ['orders','OB2','taebaek',{partnerId:'P1',partnerName:'모란식품',status:'DELIVERED',deliveryDate:'2026-10-10',createdAt:'2026-10-09T01:00:00.000Z',items:[{lineId:'q',itemId:'FG1',name:'참기름',quantity:2,price:1000}]}],
 ['issuedStatements','STB','taebaek',{docNo:'B-1',tradeDate:'2026-10-10',type:'명세서',partnerId:'P1',partnerName:'모란식품',orderId:'OB1, OB2',totalSupply:3000,totalTax:0,totalAmount:3000,createdAt:'2026-10-10T01:00:00.000Z',items:[{name:'참기름',qty:3,price:1000,supply:3000,tax:0,total:3000,accountCode:'401',isTaxExempt:true}]}],
 ['orders','O7','taebaek',{partnerId:'P1',partnerName:'모란식품',status:'SHIPPED',deliveryDate:'2026-10-20',createdAt:'2026-10-19T01:00:00.000Z',invoiceType:'C',pallets:[{type:'PL1',quantity:3},{type:'PL1x',quantity:2},{type:'PL1',quantity:1,isExchange:true}],deliveryBoxes:[{itemId:'FG1',quantity:2}],items:[{lineId:'z',itemId:'FG1',name:'참기름',quantity:1,price:1000}]}],
 ['palletTransactions','PT1','taebaek',{palletId:'PL1',partnerId:'P1',type:'out',quantity:5,isTransfer:true,date:'2026-10-01'}],
 ['productionWorkDocuments','taebaek__production-work__2026-10-02','taebaek',{documentDate:'2026-10-02',specialNotes:'이상 없음',preparedByName:'이은경',revision:3}],
 ['productionWorkDocumentLines','WL1','taebaek',{documentId:'taebaek__production-work__2026-10-02',sortOrder:1,manufacturedDate:'2026-10-02',itemId:'FG1',itemNameSnapshot:'참기름 300ml',manufacturingLotNo:'261002-1',productionQty:40,productionUnit:'개',rawNameSnapshot:'통깨참기름',rawUsedKg:12,workerNameSnapshot:'이',source:{kind:'production',sourceId:'x'}}],
 ['workProjectsV1','WP1','taebaek',{title:'추석 선물세트',ownerEmployeeId:'E1',participantIds:['E1'],status:'active',createdAt:'2026-10-01T00:00:00Z'}],
 ['workProjectsV1','WP2','taebaek',{title:'지운 것',ownerEmployeeId:'E1',participantIds:['E1'],status:'deleted'}],
 ['workProjectTasks','WP1:t1','taebaek',{projectId:'WP1',taskId:'t1',title:'박스 발주',status:'doing',assigneeEmployeeId:'E1',startDate:'2026-10-02',endDate:'2026-10-10',priority:'high',tags:['포장'],checklist:{b:{title:'견적',checked:true},a:{title:'샘플',checked:false}},deletedAt:null}],
 ['workProjectComments','WP1:t1:c1','taebaek',{projectId:'WP1',taskId:'t1',authorEmployeeId:'E1',body:'견적 받음',revision:1,deletedAt:null}],
];
const files=fs.readdirSync(dir).filter(f=>f.endsWith('.sql')&&!/^0(00|3|4)/.test(f)).sort();
const strip=s=>s.split('\n').filter(l=>!l.startsWith('\\')).join('\n');
// 실제 이전처럼 두 번 돈다: erp 스키마는 지우고 다시 만들지만 public 함수는 남아 있어서, 매개변수 이름이 바뀐 함수 등은 두 번째에 걸린다.
for(const pass of [1,2]) for(const f of files){
  if(pass===1&&f==='020_transform.sql'){ for(const [c,id,co,d] of docs) await db.query('insert into raw.docs(collection,id,company_id,data) values($1,$2,$3,$4)',[c,id,co,JSON.stringify(d)]); }
  try{ await db.exec(strip(fs.readFileSync(dir+f,'utf8'))); await db.exec('discard temp'); }catch(e){ throw new Error('SQL 파일 실행 실패('+pass+'번째) '+f+': '+e.message); }
}
const U='00000000-0000-0000-0000-000000000001';
await db.exec(`insert into auth.users(id,email) values('${U}','boss@erp.local'); insert into app.memberships(user_id,company_id,role) values('${U}','taebaek','admin'); select set_config('t.uid','${U}',false);`);
const q=async(s,p=[])=>{try{const r=await db.query(s,p);return r.rows;}catch(e){return 'ERR '+e.message;}};
const log=async(l,s,p)=>out(l,JSON.stringify(await q(s,p)));

const one=async(s,p)=>{const r=await q(s,p); if(typeof r==='string') throw new Error('필수 조회 실패: '+r); return r[0];};
// ---- orderflow ----
await log('prev', `select public.preview_order_line('O1',1,10)`);
await log('ship-early', `select public.ship_order('O1','배송')`);
await log('chk', `select public.check_order_line('O1',1,true,10,'2026-11-04')`);
await log('after-chk', `select o.status, l.run_id is not null has_run, l.made_on, (select qty from erp.stock_balances where item_id='FG1') fg, (select qty from erp.stock_balances where item_id='WIP1') wip from erp.orders o join erp.order_lines l on l.order_id=o.id where o.id='O1'`);
await log('reserved', `select * from erp.item_reserved`);
await log('unchk', `select public.check_order_line('O1',1,false)`);
await log('after-unchk', `select o.status, (select qty from erp.stock_balances where item_id='FG1') fg, (select qty from erp.stock_balances where item_id='WIP1') wip from erp.orders o where o.id='O1'`);
await log('hold', `select public.set_order_status('O1','ON_HOLD'), (select status from erp.orders where id='O1')`);
await log('manual', `select public.set_order_status('O1','DISPATCHED')`);
await log('unhold', `select public.set_order_status('O1','PENDING'), (select status from erp.orders where id='O1')`);
await log('chk2', `select public.check_order_line('O1',1,true,0)`);
await log('shipprev', `select public.ship_order('O1','배송',null,true)`);
await log('ship', `select public.ship_order('O1','택배')`);
await log('after-ship', `select status, ship_method, voucher_id from erp.orders where id='O1'`);
await log('unchk-shipped', `select public.check_order_line('O1',1,false)`);
await log('excl-noreason', `select public.set_order_meta('O1','{"accounting_excluded":true}')`);
const sv=(await one(`select public.create_sales_voucher($1) r`,[JSON.stringify({company_id:'taebaek',partner_id:'P1',date:'2026-11-05',order_ids:['O1'],extra:[{name:'택배비',qty:1,price:4000}]})])).r.voucher_id;
await log('sv-again', `select public.create_sales_voucher($1)`,[JSON.stringify({company_id:'taebaek',partner_id:'P1',order_ids:['O1']})]);
await log('sv', `select voucher_no,kind,supply,tax,amount,order_id from erp.vouchers where id=$1`,[sv]);
await log('unship-blocked', `select public.cancel_shipment('O1')`);
await log('src', `select line_no,qty,supply,tax,amount,account_code from erp.voucher_lines where voucher_id=$1`,[sv]);
await log('bal0', `select receivable from erp.partner_balances where partner_id='P1'`);
await log('stock0', `select qty from erp.stock_balances where item_id='FG1'`);
const r1=await one(`select public.create_return($1) r`,[JSON.stringify({voucher_id:sv,lines:[{line_no:1,qty:3,restock:true}]})]);
out('ret1',JSON.stringify(r1));
await log('over', `select public.create_return($1)`,[JSON.stringify({voucher_id:sv,lines:[{line_no:1,qty:18}]})]);
const r2=await one(`select public.create_return($1) r`,[JSON.stringify({voucher_id:sv,lines:[{line_no:1,qty:17,restock:false}]})]);
await log('retlines', `select v.voucher_no,l.qty,l.supply,l.tax,l.amount,l.note from erp.vouchers v join erp.voucher_lines l on l.voucher_id=v.id where v.return_of=$1 order by 1`,[sv]);
await log('returned', `select * from erp.returned_lines where voucher_id=$1`,[sv]);
await log('bal1', `select receivable from erp.partner_balances where partner_id='P1'`);
await log('stock1', `select qty from erp.stock_balances where item_id='FG1'`);
await log('jr', `select account_code,debit,credit from erp.journal_lines where voucher_id=$1`,[r1.r.voucher_id]);
await log('skipped', `select count(*) from erp.journal_skipped`);
await log('open', `select voucher_no,claim,settled,open from erp.open_items where partner_id='P1'`);
await log('unship', `select public.cancel_shipment('O1')`);
await log('cancelret', `select public.cancel_return($1)`,[r1.r.voucher_id]);
await log('stock2', `select qty from erp.stock_balances where item_id='FG1'`);
await log('bal2', `select receivable from erp.partner_balances where partner_id='P1'`);
// 매입 반품
const po=(await one(`select public.save_purchase_order($1) v`,[JSON.stringify({company_id:'taebaek',partner_id:'S1',date:'2026-11-04',lines:[{item_id:'RAW1',qty:400,price:4253,tax_exempt:true}]})])).v;
await log('rcv-early', `select public.receive_purchase($1)`,[po]);
const rc=(await one(`select public.create_purchase_voucher($1) r`,[JSON.stringify({company_id:'taebaek',partner_id:'S1',date:'2026-11-04',po_ids:[po]})])).r;
await log('pv', `select v.voucher_no,v.amount,(select status from erp.purchase_orders where id=$2) st, (select account_code from erp.voucher_lines where voucher_id=v.id limit 1) acc from erp.vouchers v where id=$1`,[rc.voucher_id,po]);
await log('pv-again', `select public.create_purchase_voucher($1)`,[JSON.stringify({company_id:'taebaek',partner_id:'S1',po_ids:[po]})]);
await log('rawpre', `select qty from erp.stock_balances where item_id='RAW1'`);
const b1=(await one(`select public.receive_purchase($1,'[{"line_no":1,"qty":100}]') r`,[po])).r;
await log('partial', `select status from erp.purchase_orders where id=$1`,[po]);
await log('cancelrcv', `select public.cancel_receipt($1), (select status from erp.purchase_orders where id=$2)`,[b1.batch_id,po]);
await log('rcv', `select public.receive_purchase($1)`,[po]);
await log('pocancel', `select public.cancel_purchase_order($1)`,[po]);
// 개봉
await log('targets', `select item_id,kind,child_id,per from erp.unpack_targets order by 1`);
const up=(await one(`select public.unpack_item('BOX1',2) r`)).r;
await log('unpacked', `select item_id,qty from erp.stock_balances where item_id in ('BOX1','FG1') order by 1`);
await log('cancelunpack', `select public.cancel_unpack($1)`,[up.id]);
await log('unpacked2', `select item_id,qty from erp.stock_balances where item_id in ('BOX1','FG1') order by 1`);
await log('can', `select public.unpack_item('CAN1',2)`);
await log('canres', `select item_id,qty,(select sum(qty_left) from erp.lots where item_id='BULK1') lot from erp.stock_balances where item_id in ('CAN1','BULK1') order by 1`);
await log('toomany', `select public.unpack_item('CAN1',5)`);
await log('notbox', `select public.unpack_item('RAW1',1)`);
// 장부
await db.exec(`insert into erp.accounts(id,company_id,code,name) values ('a108','taebaek','108','외상매출금'),('a251','taebaek','251','외상매입금'),('a259','taebaek','259','선수금'),('a811','taebaek','811','복리후생비'),('a103','taebaek','103','보통예금'),('a260','taebaek','260','단기차입금'),('a930','taebaek','930','잡이익') on conflict do nothing`);
const ca9=(await one(`select public.save_cash_account($1) v`,[JSON.stringify({company_id:'taebaek',name:'국민',type:'통장',opening_balance:1000000,opening_date:'2026-01-01'})])).v;
await log('cash-in', `select public.record_cash($1) is not null`,[JSON.stringify({company_id:'taebaek',dir:'입금',partner_id:'P1',amount:20000,date:'2026-11-03',cash_account_id:ca9})]);
await log('jbad', `select public.save_journal($1)`,[JSON.stringify({company_id:'taebaek',date:'2026-11-05',lines:[{account_code:'811',side:'차변',amount:5000},{account_code:'103',side:'대변',amount:4000}]})]);
await log('jnoacc', `select public.save_journal($1)`,[JSON.stringify({company_id:'taebaek',lines:[{account_code:'999',side:'차변',amount:1},{account_code:'103',side:'대변',amount:1}]})]);
const j1=(await one(`select public.save_journal($1) r`,[JSON.stringify({company_id:'taebaek',date:'2026-11-05',memo:'회식',lines:[{account_code:'811',side:'차변',amount:50000},{account_code:'103',side:'대변',amount:50000}]})])).r;
await log('jl', `select account_code,debit,credit from erp.journal_lines where voucher_id=$1`,[j1.voucher_id]);
await log('off-nopartner', `select public.save_journal($1)`,[JSON.stringify({company_id:'taebaek',kind:'대체',lines:[{account_code:'251',side:'차변',amount:1000},{account_code:'108',side:'대변',amount:1000}]})]);
await log('bal-before', `select receivable,payable from erp.partner_balances where partner_id='P1'`);
await log('off', `select public.save_journal($1) is not null`,[JSON.stringify({company_id:'taebaek',kind:'대체',partner_id:'P1',date:'2026-11-05',lines:[{account_code:'251',side:'차변',amount:1000},{account_code:'108',side:'대변',amount:1000}]})]);
await log('bal-after', `select receivable,payable from erp.partner_balances where partner_id='P1'`);
await log('cancelj', `select public.cancel_voucher($1)`,[j1.voucher_id]);
await log('pl', `select date,voucher_no,kind,account_code,debit,credit,balance from public.partner_ledger('taebaek','P1','2026-11-05','2026-11-30') limit 6`);
await log('tb', `select account_code,account_name,opening,debit,credit,closing from public.trial_balance('taebaek','2026-11-01','2026-11-30') limit 8`);
await log('tbsum', `select sum(debit)-sum(credit) d, sum(closing) c from public.trial_balance('taebaek','2026-01-01','2026-12-31')`);
await log('bs', `select * from public.balance_sheet('taebaek','2026-11-30')`);
await log('bscheck', `select sum(case when section='자산' then amount else -amount end) from public.balance_sheet('taebaek','2026-11-30')`);
await log('cb', `select name,balance from erp.cash_balances where cash_account_id=$1`,[ca9]);
await log('adj', `select public.adjust_cash_balance($1)`,[JSON.stringify({company_id:'taebaek',cash_account_id:ca9,actual:999000,reason:'통장 확인'})]);
await log('cb2', `select balance from erp.cash_balances where cash_account_id=$1`,[ca9]);
await log('book', `select date,kind,memo,inflow,outflow,balance from public.cash_book('taebaek',$1,'2026-01-01','2026-12-31')`,[ca9]);
const adjv=(await one(`select id from erp.unclassified_cash where company_id='taebaek' limit 1`));
out('unc', JSON.stringify(adjv));
await log('skipped', `select reason from erp.journal_skipped where voucher_id=$1`,[adjv?.id]);
await log('setbad', `select public.set_voucher_account($1,'108')`,[adjv?.id]);
await log('set', `select public.set_voucher_account($1,'930')`,[adjv?.id]);
await log('jl2', `select account_code,debit,credit from erp.journal_lines where voucher_id=$1 order by 1`,[adjv?.id]);
await log('setagain', `select public.set_voucher_account($1,'930')`,[adjv?.id]);
await log('wo', `select public.save_work_order('taebaek','2026-11-05',array['O1:1','O2:1'])`);
await log('wo2', `select public.save_work_order('taebaek','2026-11-05',array['O2:1'])`);
await log('wo3', `select keys from erp.work_orders`);
await log('link', `select public.save_dashboard_link('{"company_id":"taebaek","url":"hometax.go.kr"}') is not null`);
await log('links', `select label,url,sort_order from erp.dashboard_links`);
await log('dp', `select day,ordering,groups,by_name from erp.delivery_plans`);
await log('slot', `select delivery_slot from erp.orders where id='O1'`);
await log('dps', `select public.save_delivery_plan('taebaek','2026-11-05','{"done":["O1"]}')`);
await log('dp2', `select ordering,done,groups from erp.delivery_plans where day='2026-11-05'`);
await log('slot2', `select public.set_order_meta('O1','{"delivery_slot":"오전","delivery_date":"2026-11-06"}'), (select delivery_slot from erp.orders where id='O1')`);
await log('slot3', `select delivery_slot, delivery_date from erp.orders where id='O1'`);
await log('split-all', `select public.split_order('O9','{"lines":[{"line_no":1,"qty":20},{"line_no":2,"qty":5}]}')`);
await log('split-over', `select public.split_order('O9','{"lines":[{"line_no":1,"qty":21}]}')`);
const sp=(await one(`select public.split_order('O9','{"lines":[{"line_no":1,"qty":8},{"line_no":2,"qty":5}],"delivery_date":"2026-11-09"}') r`)).r;
await log('split-src', `select o.total_amount, l.line_no,l.qty from erp.orders o join erp.order_lines l on l.order_id=o.id where o.id='O9'`);
await log('split-new', `select o.card_no,o.delivery_date,o.total_amount,o.note,l.line_no,l.name,l.qty from erp.orders o join erp.order_lines l on l.order_id=o.id where o.id=$1 order by 5`,[sp.order_id]);
await log('p7', `select partner_type,channel,phone,default_ship_method,ship_tos from erp.partners where id='P7'`);
await log('savep', `select public.save_partner($1) is not null`,[JSON.stringify({id:'P7',company_id:'taebaek',name:'쿠팡',partner_type:'매출처',channel:'스마트스토어',ship_tos:[{id:'st1',name:'쿠팡 이천센터'}],note:'월말 정산'})]);
await log('p7b', `select channel,note,ship_tos from erp.partners where id='P7'`);
await log('savebad', `select public.save_partner($1)`,[JSON.stringify({company_id:'taebaek',name:'x',partner_type:'매출처',ship_tos:[{id:'a'}]})]);
const so=(await one(`select public.save_order($1) v`,[JSON.stringify({company_id:'taebaek',partner_id:'P7',delivery_date:'2026-11-08',ship_to_id:'st1',lines:[{item_id:'FG1',qty:2,price:100}]})])).v;
await log('so', `select ship_to_id, ship_method from erp.orders where id=$1`,[so]);
const bx=(await one(`select public.make_box_item('FG1',12) v`)).v;
await log('bx', `select name,unit,spec,(select string_agg(child_item_id||'x'||quantity,',') from erp.item_boms where parent_item_id=$1) bom, (select kind from erp.unpack_targets where item_id=$1) unpack from erp.items where id=$1`,[bx]);
await log('bx2', `select public.make_box_item('FG1',12)`);
await log('cat', `select public.rename_item_category('taebaek','참기름','참기름류')`);
await log('extra', `select public.set_leave_extra('E1',2,3.5), (select annual_leave from erp.employees where id='E1')`);
await log('ex2', `select annual_leave from erp.employees where id='E1'`);
await log('vac', `select public.company_vacation($1)`,[JSON.stringify({company_id:'taebaek',employee_ids:['E1','E9'],start_date:'2026-12-24',end_date:'2026-12-26',days:2,deducts:false})]);
await log('vac2', `select employee_name,type,days_used,status,deducts_leave,reason from erp.leave_requests where type='휴가'`);
// 확인사항
await log('poi', `select status,(select received_qty from erp.purchase_order_lines where po_id='POI') r from erp.purchase_orders where id='POI'`);
await log('counts', `select public.checklist_counts('taebaek')`);
await log('adj1', `select public.decide_adjustment('AR1', true), (select qty from erp.stock_balances where item_id='FG1')`);
await log('fg', `select qty from erp.stock_balances where item_id='FG1'`);
await log('adj2', `select public.decide_adjustment('AR2', false)`);
await log('adjagain', `select public.decide_adjustment('AR1', true)`);
await log('counts2', `select public.checklist_counts('taebaek')`);
// 생산 관리
await log('rules', `select raw_id,product_id,rate from public.press_rules('taebaek') order by 1`);
const in1=(await one(`select public.record_raw($1) r`,[JSON.stringify({company_id:'taebaek',item_id:'SES',kind:'입고',qty:100,partner_id:'S1',date:'2026-11-01'})])).r;
await log('raw-nopartner', `select public.record_raw($1)`,[JSON.stringify({company_id:'taebaek',item_id:'SES',kind:'입고',qty:50,date:'2026-11-02'})]);
const in2=(await one(`select public.record_raw($1) r`,[JSON.stringify({company_id:'taebaek',item_id:'SES',kind:'입고',qty:50,partner_id:'S1',date:'2026-11-02'})])).r;
const lot2=(await one(`select id from erp.lots where item_id='SES' and received_at='2026-11-02'`)).id;
const use1=(await one(`select public.record_raw($1) r`,[JSON.stringify({company_id:'taebaek',item_id:'SES',kind:'사용',qty:30.5,lot_id:lot2,date:'2026-11-03'})])).r;
out('use1', JSON.stringify(use1));
await log('lots', `select received_at,qty_left from erp.lots where item_id in ('SES','OIL1') order by item_id,received_at`);
await log('daily', `select * from public.raw_daily('taebaek','SES','2026-11-02','2026-11-30')`);
const oilLot=(await one(`select id from erp.lots where item_id='OIL1'`)).id;
await log('trace', `select at,kind,qty,note from public.lot_trace($1)`,[lot2]);
await log('cancel', `select public.cancel_raw($1)`,[use1.id]);
await log('after', `select item_id,qty from erp.stock_balances where item_id in ('SES','OIL1') order by 1`);
await log('raw-writer', `select id like 'un%' un, kind, created_by from erp.stock_ledger where source_type='raw' and source_id in ($1,$2) order by un, kind`,[in2.id,use1.id]);
await log('cancel-in-used', `select public.record_raw($1)`,[JSON.stringify({company_id:'taebaek',item_id:'SES',kind:'사용',qty:120})]);
await log('cancel-in', `select public.cancel_raw($1)`,[in1.id]);
await log('notraw', `select public.record_raw($1)`,[JSON.stringify({company_id:'taebaek',item_id:'FG1',kind:'입고',qty:1})]);
await log('saveitem', `select public.save_item($1)`,[JSON.stringify({id:'CAN1',company_id:'taebaek',name:'참기름 18L 캔',type:'FINISHED',unit:'개',category:'참기름',spec:'18L',unpackable:true})]);
await log('cat', `select name,category,spec,unpackable from erp.items where id in ('BOX1','CAN1')`);
await log('raw0', `select qty from erp.stock_balances where item_id='RAW1'`);
await log('pret', `select public.create_return($1)`,[JSON.stringify({voucher_id:rc.voucher_id,lines:[{line_no:1,qty:40}]})]);
await log('raw1', `select s.qty, (select sum(qty_left) from erp.lots where item_id='RAW1') lots from erp.stock_balances s where item_id='RAW1'`);
await log('payable', `select payable from erp.partner_balances where partner_id='S1'`);
await log('tax', `select public.build_tax_invoices('taebaek', to_char(current_date,'YYYY-MM'), '매입')`);
await log('taxrow', `select kind,supply,tax from erp.tax_invoices where direction='매입'`);
// 회사 정보
await log('ci', `select public.save_company_info('taebaek', $1)`,[JSON.stringify({name:'태백식품',bizNo:'139-04-37157',ceoName:'임기주',adminPassword:'x'})]);
await log('ci2', `select data from erp.settings where id='taebaek'`);
await log('cibad', `select public.save_company_info('taebaek', $1)`,[JSON.stringify({name:'태백식품',bizNo:'12'})]);
// 매입 단위
const u=(await one(`select public.save_purchase_unit($1) v`,[JSON.stringify({item_id:'RAW1',purchase_unit:'포대',unit_kg:40,is_default:true})])).v;
await log('u2', `select public.save_purchase_unit($1)`,[JSON.stringify({item_id:'RAW1',partner_id:'S1',purchase_unit:'톤백',unit_kg:1000,is_default:true})]);
await log('units', `select partner_id,purchase_unit,unit_kg,is_default from erp.item_units where item_id='RAW1' and kind='purchase' order by unit_kg`);
await log('urm', `select public.remove_purchase_unit($1)`,[u]);
// 기초
await log('po1', `select public.set_partner_opening('taebaek','P1','108',500000,'2026-01-01')`);
await log('po2', `select public.set_partner_opening('taebaek','P1','108',700000,'2026-01-01')`);
await log('bal3', `select receivable from erp.partner_balances where partner_id='P1'`);
await log('po3', `select public.set_partner_opening('taebaek','S1','251',300000,'2026-01-01')`);
await log('pay2', `select payable from erp.partner_balances where partner_id='S1'`);
const ca=(await one(`select public.save_cash_account($1) v`,[JSON.stringify({company_id:'taebaek',name:'농협',type:'통장',opening_balance:1000000,opening_date:'2026-01-01'})])).v;
await log('cash', `select account_code,debit,credit from erp.journal_lines where voucher_id like 'opening-cash-%'`);
await log('ca0', `select public.save_cash_account($1)`,[JSON.stringify({id:ca,company_id:'taebaek',name:'농협',type:'통장',opening_balance:0})]);
await log('cash2', `select status from erp.vouchers where id like 'opening-cash-%' order by status`);
await log('loan', `select public.save_loan($1)`,[JSON.stringify({company_id:'taebaek',name:'운전자금',lender_name:'농협',account_code:'260',opening_date:'2026-01-01',opening_principal:50000000})]);
await log('loanj', `select account_code,debit,credit from erp.journal_lines where voucher_id like 'opening-loan-%'`);
await log('skipped2', `select count(*) from erp.journal_skipped`);

// ---- more.sql ----
await log('merge', `select public.merge_items('WIP1','WIP1x')`);
await log('merged', `select (select qty from erp.stock_balances where item_id='WIP1') q, (select archived from erp.items where id='WIP1x') a`);
await log('cost', `select item_id,type,cost,last_buy,computed,missing from public.item_cost_estimate('taebaek') where item_id in ('RAW1','FG1','WIP1')`);
await log('applycost', `select public.apply_item_costs('taebaek','[{"item_id":"WIP1","cost":5000}]')`);
await log('profit', `select * from public.profit_report('taebaek','2026-01-01','2026-12-31')`);
await log('stmt', `select kind,voucher_no,receivable,payable from public.partner_statement('taebaek','P1','2026-11-01','2026-11-30')`);
const qid=(await one(`select public.save_quote($1) v`,[JSON.stringify({company_id:'taebaek',partner_id:'P1',date:'2026-11-04',lines:[{item_id:'FG1',qty:10,price:5000},{name:'택배비',qty:1,price:4000}]})])).v;
await log('quote', `select quote_no,supply,tax,amount,jsonb_array_length(lines) from erp.quotations where id=$1`,[qid]);
const tid=(await one(`select public.save_template($1) v`,[JSON.stringify({company_id:'taebaek',name:'임차료',direction:'출금',account_code:'819',amount:1100000,issue_day:25})])).v;
await log('issue', `select public.issue_template($1,'2026-11')`,[tid]);
await log('issue2', `select public.issue_template($1,'2026-11')`,[tid]);
await log('issued', `select date,amount,memo from erp.vouchers where template_id=$1`,[tid]);
const lid=(await one(`select id from erp.loan_contracts limit 1`)).id;
await log('repay', `select public.record_cash($1)`,[JSON.stringify({company_id:'taebaek',dir:'출금',amount:5000000,account_code:'260',loan_id:lid,note:'상환'})]);
await log('loanbal', `select opening,moved,balance from erp.loan_balances`);
const po2=(await one(`select public.save_purchase_order($1) v`,[JSON.stringify({company_id:'taebaek',partner_id:'S1',po_type:'oem',lines:[{item_id:'FG1',qty:100,price:300}]})])).v;
await log('potype', `select po_type from erp.purchase_orders where id=$1`,[po2]);
await log('oem', `select public.send_oem($1,'[{"item_id":"RAW1","qty":50}]')`,[po2]);
const ol=(await one(`select id from erp.stock_ledger where source_type='oem' limit 1`)).id;
await log('oemcancel', `select public.cancel_oem_send($1)`,[ol]);
await log('raw', `select qty from erp.stock_balances where item_id='RAW1'`);
// 가공입고
await log('oemstatus', `select status from erp.purchase_orders where id=$1`,[po2]);
await log('oem2', `select public.send_oem($1,'[{"item_id":"RAW1","qty":100}]')`,[po2]);
await log('rcv-oem', `select public.receive_purchase($1)`,[po2]);
await log('kg', `select erp.item_kg('OEMP') a, erp.item_kg('BOX1') b, erp.item_kg('FG1') c`);
await log('prev', `select public.oem_receive($1)`,[JSON.stringify({po_id:po2,products:[{item_id:'OEMP',qty:40}],bulk:[{item_id:'BULK1',kg:50}],preview:true})]);
await log('noterms', `select public.oem_receive($1)`,[JSON.stringify({po_id:po2,products:[{item_id:'OEMP',qty:40}]})]);
await log('t1', `select public.save_oem_term($1) is not null`,[JSON.stringify({company_id:'taebaek',partner_id:'S1',item_id:'OEMP',kind:'processing',unit:'kg',price:2200,tax_exempt:false})]);
await log('t2', `select public.save_oem_term($1) is not null`,[JSON.stringify({company_id:'taebaek',partner_id:'S1',item_id:'OEMP',kind:'packaging',unit:'piece',price:330})]);
await log('t3', `select public.save_oem_term($1) is not null`,[JSON.stringify({company_id:'taebaek',partner_id:'S1',item_id:'BULK1',kind:'processing',unit:'kg',price:1100,tax_exempt:true})]);
const orc=(await one(`select public.oem_receive($1) r`,[JSON.stringify({po_id:po2,products:[{item_id:'OEMP',qty:40}],bulk:[{item_id:'BULK1',kg:50}]})])).r;
out('orc', JSON.stringify(orc));
await log('pending', `select partner_name,amount from erp.oem_fee_pending`);
await log('stocks', `select item_id,qty from erp.stock_balances where item_id in ('OEMP','BULK1') order by 1`);
await log('cancel-blocked', `select public.oem_receive($1)`,[JSON.stringify({po_id:po2,products:[{item_id:'OEMP',qty:0}]})]);
const fv=(await one(`select public.issue_oem_fee($1) r`,[orc.id])).r;
await log('feev', `select v.amount,l.name,l.qty,l.account_code,l.amount la from erp.vouchers v join erp.voucher_lines l on l.voucher_id=v.id where v.id=$1 order by l.line_no`,[fv.voucher_id]);
await log('again', `select public.issue_oem_fee($1)`,[orc.id]);
await log('cancelrc', `select public.cancel_oem_receive($1)`,[orc.id]);
await log('cancelv', `select public.cancel_purchase_voucher($1)`,[fv.voucher_id]);
await log('cancelrc2', `select public.cancel_oem_receive($1), (select qty from erp.stock_balances where item_id='OEMP')`,[orc.id]);
// 임가공 정석(2026-11-09): 공장 보관 재고(공장별) · BOM 소모 · 업체 부자재 빼기 · 낱개(1/n 박스) · 잔량 마감 · 공장 재고 정리
await db.exec(`insert into erp.items (id, company_id, name, type, unit, archived) values ('ZIP1','taebaek','지퍼백 1kg','SUB','개',false),('OBX','taebaek','볶음참깨 1kg 박스(10)','FINISHED','박스',false),('CTN','taebaek','택배박스','SUB','개',false);
 insert into erp.item_boms (id, company_id, parent_item_id, child_item_id, quantity) values ('ob1','taebaek','OEMP','RAW1',1),('ob2','taebaek','OEMP','ZIP1',1),('ob3','taebaek','OBX','OEMP',10),('ob4','taebaek','OBX','CTN',1);`);
await log('fs0', `select partner_id,item_id,qty from erp.oem_stock_balances where abs(qty)>0.0005 order by 1,2`);
const po3=(await one(`select public.save_purchase_order($1) v`,[JSON.stringify({company_id:'taebaek',partner_id:'S1',po_type:'oem',lines:[{item_id:'OBX',qty:5}]})])).v;
await log('need1', `select public.oem_need($1)`,[po3]);
const zt=(await one(`select id from erp.oem_terms where item_id='OEMP' and kind='packaging'`)).id;
await log('supplied', `select public.set_oem_term_supplied($1,'ZIP1')`,[zt]);
await log('need2', `select public.oem_need($1)`,[po3]);
await log('send3', `select public.send_oem($1,'[{"item_id":"RAW1","qty":60},{"item_id":"CTN","qty":5}]')`,[po3]);
await log('fs1', `select item_id,qty from erp.oem_stock_balances where partner_id='S1' and abs(qty)>0.0005 order by 1`);
await log('need3', `select public.oem_need($1)`,[po3]);
await log('prev-boxfee', `select public.oem_receive($1)->'fee'`,[JSON.stringify({po_id:po3,products:[{item_id:'OBX',qty:1}],preview:true})]);
await log('t-obx', `select public.save_oem_term($1) is not null`,[JSON.stringify({company_id:'taebaek',partner_id:'S1',item_id:'OBX',kind:'processing',unit:'piece',price:5000})]);
await log('prev3', `select public.oem_receive($1)`,[JSON.stringify({po_id:po3,products:[{item_id:'OBX',qty:4},{item_id:'OEMP',qty:3}],preview:true})]);
const r3=(await one(`select public.oem_receive($1) r`,[JSON.stringify({po_id:po3,products:[{item_id:'OBX',qty:4},{item_id:'OEMP',qty:3}]})])).r;
await log('po3', `select p.status, l.received_qty from erp.purchase_orders p join erp.purchase_order_lines l on l.po_id=p.id where p.id=$1`,[po3]);
await log('fs2', `select item_id,qty from erp.oem_stock_balances where partner_id='S1' and abs(qty)>0.0005 order by 1`);
await log('close0', `select public.close_purchase_order($1,'0.7박스 안 옴')`,[po3]);
await log('closed', `select status, closed_note from erp.purchase_orders where id=$1`,[po3]);
await log('rcv-closed', `select public.oem_receive($1)`,[JSON.stringify({po_id:po3,products:[{item_id:'OEMP',qty:1}]})]);
await log('reopen', `select public.reopen_purchase_order($1), (select status from erp.purchase_orders where id=$1)`,[po3]);
await log('unsend-used', `select public.cancel_oem_send((select id from erp.stock_ledger where source_type='oem' and source_id=$1 and item_id='RAW1' and reversal_of is null limit 1))`,[po3]);
await log('adj', `select public.oem_adjust($1)`,[JSON.stringify({company_id:'taebaek',partner_id:'S1',lines:[{item_id:'RAW1',kind:'손실',qty:2},{item_id:'RAW1',kind:'회수',qty:15},{item_id:'CTN',kind:'회수',qty:1}]})]);
await log('fs3', `select item_id,qty from erp.oem_stock_balances where partner_id='S1' and abs(qty)>0.0005 order by 1`);
await log('back', `select kind, qty from erp.stock_ledger where source_type='oem_back' order by item_id`);
await log('unadj', `select public.cancel_oem_adjust((select id from erp.oem_stock where kind='손실' limit 1)), (select qty from erp.oem_stock_balances where partner_id='S1' and item_id='RAW1')`);
const fv3=(await one(`select public.issue_oem_fee($1) r`,[r3.id])).r;

await log('fee3', `select l.name,l.qty,l.price,l.account_code from erp.voucher_lines l where l.voucher_id=$1 order by l.line_no`,[fv3.voucher_id]);
await db.exec(`select public.cancel_purchase_voucher('${fv3.voucher_id}')`);
await log('unrc3', `select public.cancel_oem_receive($1)`,[r3.id]);
await log('after-unrc', `select p.status, l.received_qty, (select qty from erp.oem_stock_balances where partner_id='S1' and item_id='RAW1') raw from erp.purchase_orders p join erp.purchase_order_lines l on l.po_id=p.id where p.id=$1`,[po3]);
await log('pal', `select public.pallet_move('taebaek','PL1','P1',10,'지급')`);
await log('pal2', `select public.pallet_move('taebaek','PL1','P1',3,'회수')`);
await log('palout', `select item_id,partner_id,out_qty from erp.pallet_outstanding`);
await log('palstock', `select qty from erp.stock_balances where item_id='PL1'`);
const eid=(await one(`select public.save_employee($1) v`,[JSON.stringify({company_id:'taebaek',name:'김직원',position:'사원',department:'생산',join_date:'2025-01-02',annual_days:15})])).v;
await log('emp', `select name,department,annual_leave from erp.employees where id=$1`,[eid]);
await log('leave', `select public.request_leave($1)`,[JSON.stringify({company_id:'taebaek',employee_id:eid,type:'연차',start_date:'2026-11-10',end_date:'2026-11-11',days:2})]);
await log('leaves', `select status,days_used from erp.leave_requests`);
await log('qt', `select public.save_quality_test($1)`,[JSON.stringify({company_id:'taebaek',product_name:'참기름',result:'0.5',judgment:'적합'})]);
await log('proj', `select public.save_project($1)`,[JSON.stringify({company_id:'taebaek',title:'HACCP 갱신',status:'doing'})]);
await log('checks', `select kind,detail from public.data_checks('taebaek')`);
await db.exec(`update app.memberships set role='staff'`);
await log('staffdeny', `select public.set_partner_opening('taebaek','P1','108',1,'2026-01-01')`);
await log('staffleave', `select public.request_leave($1)`,[JSON.stringify({company_id:'taebaek',type:'연차',start_date:'2026-11-10',end_date:'2026-11-10',days:1})]);
await db.exec(`update app.memberships set role='admin'`);
await log('hrec', `select id,type,date,rows,meta from erp.haccp_records order by id`);
const today=(await one(`select to_char((now() at time zone 'Asia/Seoul')::date,'YYYY-MM-DD') d`)).d;
await log('hs', `select public.save_haccp($1)`,[JSON.stringify({company_id:'taebaek',type:'sanitation',date:'2026-11-03',slot:'08:30',rows:[{result:'fail'}],meta:{items:[{item:'바닥',standard:'깨끗'}]}})]);
await log('hs2', `select id,rows,meta->>'revisionCount' rc from erp.haccp_records where type='sanitation'`);
await log('wk', `select erp.haccp_current_key('periodic_sanitation','weekly')`);
await log('conf', `select public.confirm_haccp('haccp_sanitation:HS1')`);
await log('tpl', `select public.save_haccp_template('taebaek','temp_zones','{"zones":[{"name":"냉장","standard":"0~10"}]}')`);
await log('tpls', `select id,data from erp.haccp_templates order by id`);
await db.exec(`update app.memberships set role='staff'`);
await log('staffpast', `select public.save_haccp($1)`,[JSON.stringify({company_id:'taebaek',type:'temp',date:'2026-01-01',rows:[]})]);
await log('stafftoday', `select public.save_haccp($1)`,[JSON.stringify({company_id:'taebaek',type:'temp',date:today,rows:[{zone:'냉장',temp:'3'}]})]);

// ---- portal ----
await db.exec(`update app.memberships set role='admin'`);
const P='00000000-0000-0000-0000-0000000000a1', Q='00000000-0000-0000-0000-0000000000a2';
await db.exec(`insert into auth.users(id,email) values('${P}','moran@x.com'),('${Q}','new@y.com')`);
await log('avail-old-otheremail', `select public.portal_username_available('moran','z@z.com')`);
await log('avail-old-sameemail', `select public.portal_username_available('moran','MORAN@x.com')`);
await db.exec(`select set_config('t.uid','${P}',false)`);
await log('reg-old', `select public.portal_register('{"username":"moran","name":"모란","phone":"010-1"}')`);
await log('me', `select public.portal_me()`);
await log('items', `select * from public.portal_items()`);
await log('order', `select public.portal_place_order('{"lines":[{"item_id":"FG1","qty":12}],"note":"빨리","delivery_date":"2026-11-08"}')`);
await log('bad', `select public.portal_place_order('{"lines":[{"item_id":"RAW1","qty":1}]}')`);
await log('orders', `select jsonb_array_length(public.portal_orders())`);
await log('bal', `select public.portal_balance()`);
await log('email', `select public.portal_login_email('MORAN')`);
await db.exec(`select set_config('t.uid','${Q}',false)`);
await log('reg-new', `select public.portal_register('{"username":"newco","name":"신규","phone":"010-2"}')`);
await log('new-items', `select * from public.portal_items()`);
await db.exec(`select set_config('t.uid','00000000-0000-0000-0000-000000000001',false)`);
await log('signups', `select username,status,partner_name from public.partner_signups('taebaek')`);
await log('approve', `select public.decide_partner_user('taebaek','${Q}','approved','P1')`);
await log('staffreg', `select public.portal_register('{"username":"boss2","name":"x"}')`);

// ---- comms ----
await db.exec(`select set_config('t.uid','00000000-0000-0000-0000-000000000001',false); update app.memberships set role='admin'`);
const U2='00000000-0000-0000-0000-000000000002';
await db.exec(`insert into auth.users(id,email) values('${U2}','jung@erp.local'); insert into app.memberships(user_id,company_id,role) values('${U2}','taebaek','staff');
  insert into app.member_employees(user_id,company_id,employee_id) values('${U2}','taebaek','E9');`);
await db.exec(copy('comms'));
await log('remap', `select participant_ids, last_read from erp.chat_rooms where id='R1'`);
await log('msgsender', `select sender_id from erp.chat_messages where id='M1'`);
await log('notice-old', `select content from erp.notices where id='N1'`);
await log('people', `select name,role from public.company_people('taebaek')`);
const room=(await one(`select public.open_chat_room('taebaek', array['${U2}']::uuid[]) v`)).v;
await log('room-again', `select public.open_chat_room('taebaek', array['${U2}']::uuid[]) = $1 same`,[room]);
await log('send', `select public.send_chat($1)`,[JSON.stringify({room_id:room,text:'출고 확인 부탁'})]);
await log('roomrow', `select last_message, array_length(participant_ids,1) n from erp.chat_rooms where id=$1`,[room]);
const mid=(await one(`select id from erp.chat_messages where room_id=$1`,[room])).id;
await log('del', `select public.delete_chat($1)`,[mid]);
await log('notice', `select public.save_notice('{"company_id":"taebaek","title":"설 연휴","content":"휴무","tag":"공지","pinned":true}')`);
await log('portalnotify', `select type,title,body from erp.notifications where type='new_order'`);
await log('readn', `select public.read_notifications('taebaek')`);
await log('self', `select public.open_chat_room('taebaek', array[]::uuid[])`);
// ---- projects ----
await log('pj-import', `select id,status,participant_ids from erp.work_projects order by id`);
await log('pj-task', `select id,status,assignee_id,priority,tags,checklist from erp.project_tasks`);
await log('pj-cmt', `select id,task_id,author_id,body from erp.project_comments`);
await db.exec(`select set_config('t.uid','${U2}',false)`);
await log('pj-notmember', `select public.save_project_task('{"project_id":"WP1","title":"x"}')`);
const np=(await one(`select public.save_project('{"company_id":"taebaek","title":"직원 업무"}') v`)).v;
await log('pj-own', `select owner_id, participant_ids, status from erp.work_projects where id=$1`,[np]);
await db.exec(`select set_config('t.uid','${U}',false)`);
await log('pj-add', `select public.set_project_member('WP1','E9',true)`);
await db.exec(`select set_config('t.uid','${U2}',false)`);
await log('pj-mgr', `select public.set_project_member('WP1','E9',false)`);
await log('pj-badassignee', `select public.save_project_task('{"project_id":"WP1","title":"y","assignee_id":"E404"}')`);
const tk=(await one(`select public.save_project_task('{"project_id":"WP1","title":"라벨 인쇄","assignee_id":"E9","start_date":"2026-11-05","end_date":"2026-11-07","tags":["포장"," 라벨 ",""],"checklist":[{"title":"시안"},{"title":""}]}') v`)).v;
await log('pj-newtask', `select status,priority,tags,jsonb_array_length(checklist) n from erp.project_tasks where id=$1`,[tk]);
const ci=(await one(`select checklist->0->>'id' v from erp.project_tasks where id=$1`,[tk])).v;
await log('pj-check', `select public.check_task_item($1,$2,true)`,[tk,ci]);
await log('pj-move', `select public.save_project_task(jsonb_build_object('id',$1::text,'project_id','WP1','title','라벨 인쇄','status','review','assignee_id','E9'))`,[tk]);
await log('pj-keepcheck', `select checklist->0->>'checked' c from erp.project_tasks where id=$1`,[tk]);
const cm=(await one(`select public.save_task_comment($1,null,'시안 올림') v`,[tk])).v;
await log('pj-othercmt', `select public.save_task_comment('WP1:t1','WP1:t1:c1','바꿈')`);
await log('pj-delcmt', `select public.save_task_comment($1,$2,'')`,[tk,cm]);
await log('pj-delproj', `select public.delete_project('WP1')`);
await db.exec(`select set_config('t.uid','${U}',false)`);
await log('pj-rm', `select public.set_project_member('WP1','E9',false)`);
await log('pj-unassigned', `select assignee_id from erp.project_tasks where id=$1`,[tk]);
await log('pj-delt', `select public.delete_project_task($1)`,[tk]);
await log('pj-delproj2', `select public.delete_project('WP1')`);
await log('pj-afterdel', `select public.save_project_task('{"project_id":"WP1","title":"z"}')`);
await log('pj-act', `select action, detail from erp.project_activity where project_id='WP1' order by id`);
// ---- officetalk ----
await log('ot-import', `select reactions, mentions, order_id from erp.chat_messages where id='M1'`);
await db.exec(copy('officetalk'));
await db.exec(`select set_config('t.uid','${U2}',false)`);
const room2=(await one(`select public.open_chat_room('taebaek', array['${U}']::uuid[]) v`)).v;
const m2=(await one(`select public.send_chat($1) v`,[JSON.stringify({room_id:room2,text:'@임영훈 @관리자 출고 확인',mentions:[U,'admin','99999999-0000-0000-0000-000000000000']})])).v;
await log('ot-msg', `select mentions from erp.chat_messages where id=$1`,[m2]);
await log('ot-ntf', `select type,title,target_id from erp.notifications where type='mention' order by created_at`);
await log('ot-adj', `select type,status,reason from erp.adjustment_requests where type='chat_mention'`);
await log('ot-react', `select public.react_chat($1,'👍'), public.react_chat($1,'❤️')`,[m2]);
await log('ot-react2', `select public.react_chat($1,'👍')`,[m2]);
await log('ot-reactions', `select reactions from erp.chat_messages where id=$1`,[m2]);
await log('ot-bademoji', `select public.react_chat($1,'💩')`,[m2]);
await log('ot-mark', `select public.mark_chat_order($1,'O1')`,[m2]);
await log('ot-markbad', `select public.mark_chat_order($1,'NOPE')`,[m2]);
await log('ot-alias', `select public.save_order_aliases('taebaek','P1','[{"alias":"참기름","item_id":"FG1"},{"alias":"x","item_id":"NOPE"}]')`);
await log('ot-alias2', `select public.save_order_aliases('taebaek','P1','[{"alias":"참 기름","item_id":"WIP1"}]')`);
const rid=(await one(`select id from erp.order_interpretation_rules where partner_id='P1' order by alias limit 1`)).id;
await log('ot-alias-del', `select public.delete_order_alias($1)`,[rid]);
await log('ot-alias-left', `select alias, item_id from erp.order_interpretation_rules where partner_id='P1' and status='approved' order by alias`);
await log('ot-alias-del2', `select public.delete_order_alias($1)`,[rid]);
await log('ot-rules', `select partner_id, alias, item_id, status from erp.order_interpretation_rules`);
await db.exec(`select set_config('t.uid','${U}',false)`);
// ---- adjustment request ----
await db.exec(`select set_config('t.uid','${U2}',false)`);
await log('adj-staff-stocktake', `select public.stocktake('taebaek','FG1',90,null,'x')`);
await log('adj-req-noreason', `select public.request_adjustment('taebaek','FG1',90,'')`);
const aq=(await one(`select public.request_adjustment('taebaek','FG1',90,'파손 2개') v`)).v;
await log('adj-dup', `select public.request_adjustment('taebaek','FG1',80,'또')`);
await db.exec(`select set_config('t.uid','${U}',false)`);
await log('adj-row', `select qty_before, qty_after, reason, status from erp.adjustment_requests where id=$1`,[aq]);
await log('adj-approve', `select public.decide_adjustment($1, true)`,[aq]);
await log('adj-stock', `select qty from erp.stock_balances where item_id='FG1'`);
// ---- leave change ----
await log('lv-import', `select id,status,change_request->>'kind' k, change_request->>'start_date' s from erp.leave_requests where id in ('LV1','LV2','LV3') order by id`);
await log('lv-count', `select public.checklist_counts('taebaek')->'leave' n`);
await log('lv-decide1', `select public.decide_leave_change('LV1', true)`);
await log('lv-decide2', `select public.decide_leave_change('LV2', false)`);
await log('lv-after', `select id,status,start_date,days_used,change_request,change_note from erp.leave_requests where id in ('LV1','LV2') order by id`);
await db.exec(`select set_config('t.uid','${U2}',false)`);
await log('lv-req', `select public.request_leave_change('LV2','{"kind":"cancel","reason":"일정 바뀜"}')`);
await log('lv-req2', `select public.request_leave_change('LV2','{"kind":"cancel"}')`);
await log('lv-nonadmin', `select public.decide_leave_change('LV2', true)`);
await db.exec(`select set_config('t.uid','${U}',false)`);
await log('lv-notmine', `select public.request_leave_change('LV1','{"kind":"cancel"}')`);
await log('lv-decide3', `select public.decide_leave_change('LV2', true)`);
await log('lv-after2', `select status from erp.leave_requests where id='LV2'`);
// ---- taxdoc ----
await log('tx-vouchers', `select kind, to_char(date,'YYYY-MM') m, count(*) from erp.vouchers where status='active' and kind='매출' group by 1,2`);
const txm=(await one(`select to_char(max(date),'YYYY-MM') v from erp.vouchers where status='active' and kind='매출' and partner_id is not null`)).v;
await log('tx-cand0', `select count(*) n, count(*) filter (where (tax_supply<>0 and not tax_bound) or (exempt<>0 and not exempt_bound)) open from public.tax_invoice_candidates('taebaek',$1,'매출')`,[txm]);
const txc=(await one(`select voucher_id from public.tax_invoice_candidates('taebaek',$1,'매출') where (tax_supply<>0 and not tax_bound) or (exempt<>0 and not exempt_bound) limit 1`,[txm]));
await log('tx-for-none', `select public.build_tax_invoices_for('taebaek',$1,'매출','{}')`,[txm]);
await log('tx-for', `select public.build_tax_invoices_for('taebaek',$1,'매출',array[$2])`,[txm, txc?.voucher_id]);
await log('tx-for-again', `select public.build_tax_invoices_for('taebaek',$1,'매출',array[$2])`,[txm, txc?.voucher_id]);
await log('tx-cand1', `select bool_or(tax_bound or exempt_bound) some_bound from public.tax_invoice_candidates('taebaek',$1,'매출') where voucher_id=$2`,[txm, txc?.voucher_id]);
await log('tx-build', `select public.build_tax_invoices('taebaek',$1,'매출')`,[txm]);
const ti=(await one(`select id, supply, tax from erp.tax_invoices order by supply desc limit 1`));
await log('tx-lines', `select public.tax_invoice_lines($1)`,[ti.id]);
await log('tx-bad', `select public.save_tax_invoice_items($1, $2)`,[ti.id, JSON.stringify([{name:'참기름',supply:1,tax:0}])]);
await log('tx-ok', `select public.save_tax_invoice_items($1, $2)`,[ti.id, JSON.stringify([{name:'참기름 세트',spec:'',qty:1,supply:Number(ti.supply)-100,tax:Number(ti.tax)},{name:'운반',supply:100,tax:0}])]);
await log('tx-after', `select item_summary, items from erp.tax_invoices where id=$1`,[ti.id]);
await log('tx-lines2', `select public.tax_invoice_lines($1)->'edited' e`,[ti.id]);
await log('tx-reset', `select public.save_tax_invoice_items($1, null)`,[ti.id]);
// ---- voucher edit request ----
const ve=(await one(`select id from erp.vouchers where status='active' and id<>'STB' limit 1`)).id;
await log('ve-empty', `select public.request_voucher_edit($1,'')`,[ve]);
await log('ve-ok', `select public.request_voucher_edit($1,'수량 20→18') is not null ok`,[ve]);
await log('ve-dup', `select public.request_voucher_edit($1,'또')`,[ve]);
await log('ve-row', `select type, status, reason, voucher_id is not null v from erp.adjustment_requests where type='voucher_edit'`);
// ---- orderextra ----
await log('ox-import', `select invoice_type, pallets, delivery_boxes from erp.orders where id='O7'`);
await log('ox-hist', `select id, qty, partner_id, stock_effect from erp.stock_ledger where source_type='pallet' order by qty, id`);
await log('ox-out', `select item_id, partner_id, out_qty from erp.pallet_outstanding`);
const oo=(await one(`select id from erp.orders where shipped_at is null and partner_id is not null and id not in ('OB1','OB2') limit 1`));
out('ox-order', JSON.stringify(oo));
if (oo) {
  await log('ox-badtype', `select public.set_order_pack($1,'{"invoice_type":"Z"}')`,[oo.id]);
  await log('ox-set', `select public.set_order_pack($1,'{"invoice_type":"B","pallets":[{"item_id":"PL1","qty":2},{"item_id":"PL1","qty":1,"exchange":true}],"delivery_boxes":[{"item_id":"FG1","qty":3}]}')`,[oo.id]);
  const before=(await one(`select qty from erp.stock_balances where item_id='PL1'`));
  await log('ox-ship', `update erp.orders set shipped_at=now() where id=$1 returning id`,[oo.id]);
  await log('ox-bal', `select qty, $1::text before from erp.stock_balances where item_id='PL1'`,[String(before?.qty)]);
  await log('ox-locked', `select public.set_order_pack($1,'{"pallets":[]}')`,[oo.id]);
  await log('ox-unship', `update erp.orders set shipped_at=null where id=$1 returning id`,[oo.id]);
  await log('ox-bal2', `select qty from erp.stock_balances where item_id='PL1'`);
}
// ---- workdoc ----
await log('wd-import', `select w.id, w.special_notes, w.revision, l.item_name, l.lot_no, l.raw_used_kg from erp.work_documents w join erp.work_document_lines l on l.doc_id=w.id`);
await log('wd-produce', `select public.produce('taebaek','FG1',5,null,false,'작업일지 시험')`);
const rd=(await one(`select run_date::text d from erp.production_runs where canceled_at is null order by run_date desc limit 1`));
out('wd-rundate', JSON.stringify(rd), JSON.stringify(await q(`select count(*), count(canceled_at) from erp.production_runs`)));
if (rd) {
  await log('wd-fresh', `select public.work_document('taebaek',$1::date) v`,[rd.d]);
  await log('wd-save', `select public.save_work_document(jsonb_build_object('company_id','taebaek','date',$1::text,'special_notes','x','lines', public.work_document('taebaek',$1::date)->'lines'))`,[rd.d]);
  await log('wd-stale', `select public.save_work_document(jsonb_build_object('company_id','taebaek','date',$1::text,'revision',0,'lines','[]'::jsonb))`,[rd.d]);
  await log('wd-saved', `select (public.work_document('taebaek',$1::date)->'doc'->>'revision') r, jsonb_array_length(public.work_document('taebaek',$1::date)->'lines') n`,[rd.d]);
}
// ---- inventory opening ----
await log('io-set', `select public.set_inventory_opening('taebaek','FG1','2026-01-01',100,300000)`);
await log('io-v', `select v.kind, v.amount, v.memo, l.line_no, l.qty, l.price, l.account_code, l.side from erp.vouchers v join erp.voucher_lines l on l.voucher_id=v.id where v.id='opening-inventory-taebaek-FG1' order by l.line_no`);
await log('io-tb', `select account_code, debit, credit from erp.journal_lines where voucher_id='opening-inventory-taebaek-FG1'`);
await log('io-zero', `select public.set_inventory_opening('taebaek','FG1','2026-01-01',0,0)`);
await log('io-st', `select status from erp.vouchers where id='opening-inventory-taebaek-FG1'`);
// ---- analytics ----
await log('an-m', `select * from public.analysis_monthly('taebaek','2026-01-01','2026-12-31') limit 6`);
await log('an-cf', `select * from public.analysis_cashflow('taebaek','2026-01-01','2026-12-31') limit 6`);
await log('an-p', `select partner_name, sales, sales_count, purchases, receivable, payable from public.analysis_partners('taebaek','2026-01-01','2026-12-31') limit 5`);
// ---- return request ----
const rv=(await one(`select v.id from erp.vouchers v join erp.voucher_lines l on l.voucher_id=v.id where v.kind='매출' and v.status='active' and v.return_of is null and l.qty>0
  and l.qty > coalesce((select qty from erp.returned_lines x where x.voucher_id=v.id and x.line_no=l.line_no),0) limit 1`)).id;
await db.exec(`select set_config('t.uid','${U2}',false)`);
await log('rr-direct', `select public.create_return($1)`,[JSON.stringify({voucher_id:rv,lines:[{line_no:1,qty:1}]})]);
const rq=(await one(`select public.request_return($1) v`,[JSON.stringify({voucher_id:rv,lines:[{line_no:1,qty:1,restock:true}],memo:'파손'})])).v;
await log('rr-dup', `select public.request_return($1)`,[JSON.stringify({voucher_id:rv,lines:[{line_no:1,qty:1}]})]);
await db.exec(`select set_config('t.uid','${U}',false)`);
await log('rr-row', `select reason from erp.adjustment_requests where id=$1`,[rq]);
await log('rr-approve', `select public.decide_adjustment($1, true)`,[rq]);
await log('rr-made', `select count(*) from erp.vouchers where return_of=$1`,[rv]);
// ---- order edit keeps checks ----
const eo=(await one(`select public.save_order('{"company_id":"taebaek","partner_id":"P1","delivery_date":"2026-11-20","ship_method":"택배","lines":[{"item_id":"FG1","qty":2},{"item_id":"RAW1","qty":1}]}') v`)).v;
await log('ed-check', `select public.check_order_line($1, 2, true)`,[eo]);
await log('ed-meta', `select public.set_order_line_meta($1, 1, '{"label_stage":"날인","made_on":"2026-11-01"}')`,[eo]);
await log('ed-edit', `select public.save_order(jsonb_build_object('id',$1::text,'company_id','taebaek','partner_id','P1','delivery_date','2026-11-21','lines','[{"item_id":"RAW1","qty":1},{"item_id":"FG1","qty":3}]'::jsonb))`,[eo]);
await log('ord-notify', `select type,title,body,sender_id is not null by_someone from erp.notifications where type='new_order' and linked_id=$1`,[eo]);
// 여러 주문을 합쳐 명세서: 같은 품목·단가는 한 줄로
const eo2=(await one(`select public.save_order('{"company_id":"taebaek","partner_id":"P1","delivery_date":"2026-11-22","lines":[{"item_id":"FG1","qty":2}]}') v`)).v;
const mv=(await one(`select public.create_sales_voucher($1) v`,[JSON.stringify({company_id:'taebaek',partner_id:'P1',date:'2026-11-22',order_ids:[eo,eo2]})])).v;
await log('merge-lines', `select item_id, qty, (note like '%,%') two_orders from erp.voucher_lines where voucher_id=$1 order by line_no`,[mv.voucher_id]);
await db.query(`select public.cancel_sales_voucher($1)`,[mv.voucher_id]);
// 화면에서 고친 줄 그대로(lines): 품목·규격·면세·계정
const lv=(await one(`select public.create_sales_voucher($1) v`,[JSON.stringify({company_id:'taebaek',partner_id:'P1',date:'2026-11-22',order_ids:[eo2],lines:[{item_id:'FG1',name:'참기름 300ml',spec:'300ml',qty:2,price:5500,tax_exempt:false},{name:'택배비',qty:1,price:4000,tax_exempt:true,account_code:'404'}]})])).v;
await log('vlines', `select name, spec, qty, supply, tax, amount, account_code, tax_exempt from erp.voucher_lines where voucher_id=$1 order by line_no`,[lv.voucher_id]);
// 바로 입고: 발주를 만들고 확정·입고까지 한 번에 → 입고 끝 발주·로트·재고
const qr=(await one(`select public.quick_receive($1) v`,[JSON.stringify({company_id:'taebaek',partner_id:'S1',date:'2026-11-05',lines:[{item_id:'RAW1',qty:30}]})])).v;
await log('qr-po', `select status, note, (select sum(received_qty) from erp.purchase_order_lines where po_id=$1) got from erp.purchase_orders where id=$1`,[qr.po_id]);
await log('qr-lot', `select count(*) from erp.purchase_receipts where po_id=$1 and canceled_at is null`,[qr.po_id]);
await log('print-bal', `select public.voucher_print_balance($1)`,[lv.voucher_id]);
await db.query(`select public.cancel_sales_voucher($1)`,[lv.voucher_id]);
const pr=(await one(`select public.save_line_preset('{"company_id":"taebaek","name":"택배비","amount":4000,"tax":"과세"}') v`)).v;
await log('preset', `select name, amount, note from erp.voucher_templates where id=$1`,[pr]);
await log('preset-del', `select public.delete_line_preset($1)`,[pr]);
await db.query(`select public.delete_order($1)`,[eo2]);
await log('ed-lines', `select line_no,item_id,qty,checked_at is not null c,label_stage,made_on from erp.order_lines where order_id=$1 order by line_no`,[eo]);
await log('ed-ship', `select ship_method from erp.orders where id=$1`,[eo]);
await log('ed-block', `select public.save_order(jsonb_build_object('id',$1::text,'company_id','taebaek','partner_id','P1','delivery_date','2026-11-21','lines','[{"item_id":"FG1","qty":3}]'::jsonb))`,[eo]);
await log('ed-status', `select status from erp.orders where id=$1`,[eo]);
// ---- stock order ----
await log('so-nopartner', `select public.save_order('{"company_id":"taebaek","delivery_date":"2026-11-20","lines":[{"item_id":"FG1","qty":2}]}')`);
const sto=(await one(`select public.save_order('{"company_id":"taebaek","purpose":"stock","delivery_date":"2026-11-20","lines":[{"item_id":"FG1","qty":2}]}') v`)).v;
await log('so-row', `select purpose, partner_name, status from erp.orders where id=$1`,[sto]);
await log('so-check', `select public.check_order_line($1,1,true,2,null)->>'status' s`,[sto]);
await log('so-ship', `select public.ship_order($1,'배송',null,true)`,[sto]);
// 완료한 줄 나누기 → 같은 생산을 같이 가리킨다. 한쪽 체크 풀기는 생산을 남기고, 마지막 쪽을 지우면 생산을 되돌린다. 주문 삭제.
const ds=(await one(`select public.save_order($1) v`,[JSON.stringify({company_id:'taebaek',partner_id:'P7',delivery_date:'2026-11-08',lines:[{item_id:'FG1',qty:10,price:100}]})])).v;
const fgq=`(select qty from erp.stock_balances where item_id='FG1')`;
await log('ds-0', `select ${fgq} q`);
await log('ds-chk', `select public.check_order_line($1,1,true,10)->>'status' s`,[ds]);
await log('ds-chk-q', `select ${fgq} q`);
await log('ds-prev-cancel', `select public.uncheck_preview($1,1) p`,[ds]);
const dsn=(await one(`select public.split_order($1,'{"lines":[{"line_no":1,"qty":4}]}') r`,[ds])).r.order_id;
await log('ds-split', `select o.id=$1 src, o.status, l.qty, l.checked_at is not null chk, l.run_id is not null run from erp.orders o join erp.order_lines l on l.order_id=o.id where o.id in ($1,$2) order by 1 desc`,[ds,dsn]);
await log('ds-same-run', `select count(distinct run_id) from erp.order_lines where order_id in ($1,$2)`,[ds,dsn]);
await log('ds-prev-keep', `select public.uncheck_preview($1,1) p`,[dsn]);
await log('ds-unchk-new', `select public.check_order_line($1,1,false)->>'status' s`,[dsn]);
await log('ds-unchk-q', `select ${fgq} q, (select r.canceled_at is null from erp.production_runs r join erp.order_lines l on l.run_id=r.id where l.order_id=$1) run_alive`,[ds]);
await log('ds-prev-none', `select public.uncheck_preview($1,1) p`,[dsn]);
await log('ds-del', `select public.delete_order($1)`,[ds]);
await log('ds-del-q', `select ${fgq} q, (select count(*) from erp.production_runs where order_id=$1 and canceled_at is null) alive`,[ds]);
await log('ds-del-after', `select status, (select count(*) from erp.order_lines where order_id=$1 and checked_at is not null) chk, (select changes->>'deleted' from erp.order_history where order_id=$1 and kind='status' order by at desc limit 1) h from erp.orders where id=$1`,[ds]);
await log('ds-del-again', `select public.delete_order($1)`,[ds]);
await log('ds-chk-deleted', `select public.check_order_line($1,1,true)`,[ds]);
await log('ds-del-shipped', `select public.delete_order('O1')`);
await log('bundled-stmt', `select id, voucher_id from erp.orders where id in ('OB1','OB2') order by id`);
// 전표 목록: 담당자 이름, 거래내역 요약, 누적잔액, 남은 돈, 증빙
await log('vlist', `select voucher_no is not null n, kind, writer, summary, has_items, ar_balance, ap_balance, open_amount, open_side, evidence from public.voucher_list('taebaek','2026-01-01','2026-12-31') where status='active' order by kind, voucher_no, id limit 12`);
const vsale=(await one(`select id from erp.vouchers where kind='매출' and status='active' order by id limit 1`)).id;
await log('ev-bad', `select public.set_voucher_evidence($1,'간이영수증')`,[vsale]);
await log('ev-ok', `select public.set_voucher_evidence($1,'세금계산서')`,[vsale]);
await log('ev-after', `select evidence from erp.vouchers where id=$1`,[vsale]);
// 선수금·선급금: 일반전표 259·131 줄에도 거래처가 달려 거래처 잔액에 잡힌다
await log('adv-j', `select public.save_journal($1) is not null ok`,[JSON.stringify({company_id:'taebaek',kind:'비용',date:'2026-11-05',partner_id:'P1',memo:'선수금 받음',lines:[{account_code:'103',side:'차변',amount:50000},{account_code:'259',side:'대변',amount:50000}]})]);
await log('adv-bal', `select advance_received, advance_paid from erp.partner_balances where partner_id='P1'`);
await log('paymethod', `select (public.record_cash($1)->>'voucher_id') is not null ok`,[JSON.stringify({company_id:'taebaek',dir:'입금',date:'2026-11-05',partner_id:'P1',amount:1000,pay_method:'어음',note:'pm'})]);
await log('paymethod-row', `select pay_method from erp.vouchers where memo='pm'`);
// 월말 재고 조정(기존 앱 journalizeInventory): 기말재고 증감만큼 146 ↔ 500
await log('inv-base', `select coalesce(sum(debit-credit),0) base from erp.journal_lines where account_code='146' and voucher_id not like 'inv-adj-%'`);
await db.exec(`insert into erp.inventory_snapshots (id, company_id, year_month, value) values ('inv-snap-2026-09','taebaek','2026-09',1000000),('inv-snap-2026-10','taebaek','2026-10',700000)`);
await log('inv-adj', `select voucher_id, date, account_code, debit, credit from erp.journal_lines where voucher_id like 'inv-adj-%' order by voucher_id, account_code`);
await log('inv-bal', `select sum(debit)=sum(credit) ok from erp.journal_lines`);
await log('inv-save', `select public.save_inventory_snapshot('taebaek','2026-11') >= 0 ok`);
await log('inv-save-row', `select id, year_month, jsonb_typeof(items) t from erp.inventory_snapshots where year_month='2026-11'`);
await log('inv-save-bad', `select public.save_inventory_snapshot('taebaek','2026-1')`);
await log('inv-del', `select public.delete_inventory_snapshot('taebaek','2026-11')`);
await db.exec(`delete from erp.inventory_snapshots where company_id='taebaek'`);
// 판매 때 원가 박기: 새 매출 명세서 줄에 unit_cost가 들어간다
await log('cost-stamp', `select v.kind, l.item_id, l.unit_cost is not null stamped from erp.voucher_lines l join erp.vouchers v on v.id=l.voucher_id where v.created_at > now() - interval '1 hour' and l.item_id is not null and v.kind in ('매출','매입') order by v.kind, l.item_id limit 6`);
await log('auto-snap', `select erp.auto_inventory_snapshot() n`);
await log('inv-save-src', `select public.save_inventory_snapshot('taebaek','2026-10') >= 0 ok`);
await log('inv-src', `select year_month, source from erp.inventory_snapshots where company_id='taebaek'`);
await db.exec(`delete from erp.inventory_snapshots where company_id='taebaek'`);
// 휴대폰 푸시: 구독 넣기 → 채팅 알림이 생기면 받는 사람 구독이 push_job에 → 끊긴 구독 지우기
await db.exec(`select set_config('t.uid','${U2}',false)`);
await log('push-bad', `select public.save_push_subscription('{"endpoint":"http://x"}')`);
await log('push-sub', `select public.save_push_subscription($1)`,[JSON.stringify({endpoint:'https://push.example/u2',keys:{p256dh:'P',auth:'A'},ua:'test'})]);
await log('push-mine', `select public.my_push_devices() n`);
await db.exec(`select set_config('t.uid','${U}',false)`);
await log('push-key', `select public.push_public_key() is null no_key_yet`);
const proom=(await one(`select public.open_chat_room('taebaek', array['${U2}']::uuid[]) v`)).v;
await db.query(`select public.send_chat($1)`,[JSON.stringify({room_id:proom,text:'푸시 시험'})]);
const pn=(await one(`select id from erp.notifications where body like '푸시 시험%' order by created_at desc limit 1`)).id;
await log('push-job', `select j->>'title' t, j->>'body' b, j->>'url' like '/chat?room=%' url, jsonb_array_length(j->'subs') n, j->'subs'->0->>'endpoint' ep, length(j->>'secret')>10 s from public.push_job($1) j`,[pn]);
await log('push-gone', `select public.push_result('https://push.example/u2', false, true)`);
await log('push-left', `select count(*) from app.push_subscriptions`);
// 전표 템플릿: 저장·이름 겹침·없는 계정·고치기·지우기
// 스마트스토어 구매자 → 고객: 전표 없는 스마트스토어 거래처는 고객으로, 주문은 네이버 거래처로
await db.exec(`insert into erp.partners (id, company_id, name, partner_type, channel, mobile, address, archived) values ('SS1','taebaek','홍길동','매출처','스마트스토어','010-1111-2222','서울시',false)`);
const ssOrder=(await one(`select public.save_order('{"company_id":"taebaek","partner_id":"SS1","delivery_date":"2026-11-09","lines":[{"item_id":"FG1","qty":1}]}') v`)).v;
await db.exec(copy('customers'));
await log('cust-mv', `select c.name, c.phone, o.partner_name, p.marketplace from erp.orders o join erp.customers c on c.id=o.customer_id join erp.partners p on p.id=o.partner_id where o.id=$1`,[ssOrder]);
await log('cust-old', `select archived from erp.partners where id='SS1'`);
await db.exec(copy('customers'));
await log('cust-again', `select count(*) from erp.customers where legacy_partner_id='SS1'`);
const nc=(await one(`select public.save_customer('{"company_id":"taebaek","name":"김철수","phone":"010-3333-4444"}') v`)).v;
await log('cust-set', `select public.set_order_customer($1,$2)`,[ssOrder,nc]);
await log('cust-bad', `select public.save_customer('{"company_id":"taebaek","name":" "}')`);
await db.query(`select public.delete_order($1)`,[ssOrder]);
await log('jt-noname', `select public.save_journal_template('{"company_id":"taebaek","lines":[{"account_code":"103","side":"차변"}]}')`);
await log('jt-badacc', `select public.save_journal_template('{"company_id":"taebaek","name":"x","lines":[{"account_code":"999999","side":"차변"}]}')`);
const jt=(await one(`select public.save_journal_template($1) v`,[JSON.stringify({company_id:'taebaek',name:'월 통신비',kind:'비용',memo:'통신비',lines:[{account_code:'103',side:'대변',amount:'55000',note:''},{account_code:'259',side:'차변',amount:'',note:'회선'}]})])).v;
await log('jt-row', `select name, kind, memo, lines, created_by from erp.journal_templates where id=$1`,[jt]);
await log('jt-dup', `select public.save_journal_template('{"company_id":"taebaek","name":"월 통신비","lines":[{"account_code":"103","side":"차변"}]}')`);
await log('jt-edit', `select public.save_journal_template($1) = $2 same`,[JSON.stringify({id:jt,company_id:'taebaek',name:'월 통신비',kind:'대체',partner_id:'P1',lines:[{account_code:'251',side:'차변'},{account_code:'108',side:'대변'}]}),jt]);
await log('jt-after', `select kind, partner_id, memo, jsonb_array_length(lines) n from erp.journal_templates where id=$1`,[jt]);
await log('jt-del', `select public.delete_journal_template($1)`,[jt]);
await log('jt-left', `select count(*) from erp.journal_templates`);
// 용역 품목: 기본 계정 저장 → 매입 계정으로 쓰인다(거래처 연결 계정이 있으면 그게 먼저)
const svc=(await one(`select public.save_item('{"company_id":"taebaek","name":"택배비","type":"SERVICE","unit":"건","cost":3000,"account_code":"824"}') v`)).v;
await log('svc-acc', `select type, account_code, erp.purchase_account('P1', $1) acc from erp.items where id=$1`,[svc]);
// 비재고 품목도 발주·입고는 되지만 재고 수량은 안 바뀐다
const glove=(await one(`select public.save_item('{"company_id":"taebaek","name":"니트릴 장갑","type":"SERVICE","unit":"박스"}') v`)).v;
const gq=(await one(`select public.quick_receive($1) v`,[JSON.stringify({company_id:'taebaek',partner_id:'S1',date:'2026-11-08',lines:[{item_id:glove,qty:5,price:12000}]})])).v;
await log('svc-rcv', `select l.received_qty, (select count(*) from erp.stock_balances where item_id=$1) bal, (select bool_or(stock_effect) from erp.stock_ledger where item_id=$1) eff, (select count(*) from erp.voucher_lines where item_id=$1) vl from erp.purchase_order_lines l where l.po_id=$2`,[glove, gq.po_id]);
// 메뉴 권한: 관리자가 직원 메뉴를 바꾸고, 목록·내 회사에 보이고, null이면 기본값
await log('menus-set', `select public.set_member_menus('taebaek', $1, array['/orders','/stock'])`,[U2]);
await log('menus-list', `select login, menus from public.company_members('taebaek') where login='jung'`);
await log('menus-reset', `select public.set_member_menus('taebaek', $1, null)`,[U2]);
await log('menus-mine', `select role, menus from public.my_companies()`);
// 이관 기준일: 2026-10-15 전 전표는 보관, 그 전날 잔액을 기초 전표로. 기준일 전날까지 계정별 잔액(375 빼고)이 앞뒤로 같아야 한다.
await db.exec(`update app.migration_settings set cutoff = date '2026-10-15', apply = true where company_id = 'taebaek'`);
const tb=`select account_code, partner_id, round(sum(debit-credit)) b from erp.journal_lines where company_id='taebaek' and date < '2026-10-15' and account_code ~ '^[123]' and account_code <> '375' group by 1,2 having round(sum(debit-credit)) <> 0 order by 1,2`;
await db.exec(`insert into erp.orders (id, company_id, partner_id, partner_name, status, delivery_date, total_amount, created_at) values
  ('OLD1','taebaek','P1','모란식품','PENDING','2026-10-05',5000,'2026-10-04'), ('OLD2','taebaek','P1','모란식품','SHIPPED','2026-10-06',7000,'2026-10-05');
  update erp.orders set shipped_at = '2026-10-06' where id = 'OLD2';
  insert into erp.order_lines (order_id, line_no, item_id, name, qty, price) values ('OLD1',1,'FG1','참기름',5,1000), ('OLD2',1,'FG1','참기름',7,1000);
  insert into app.migration_picks (company_id, kind, ref_id) values ('taebaek','order','OLD1');
  insert into erp.vouchers (id, company_id, voucher_no, date, kind, partner_id, amount, status, legacy_collection) values
    ('X253a','taebaek','X-1','2026-10-10','비용','P1',1000,'active','app'), ('X253b','taebaek','X-2','2026-10-10','비용','S1',2000,'active','app');
  insert into erp.voucher_lines (voucher_id, line_no, line_kind, name, amount, account_code, side) values
    ('X253a',1,'account','a',1000,'830','차변'), ('X253a',2,'account','a',1000,'253','대변'), ('X253b',1,'account','b',2000,'830','차변'), ('X253b',2,'account','b',2000,'253','대변');`);
const before=JSON.stringify((await db.query(tb)).rows);
await db.exec(strip(copy('cutover')));
await log('cut-cands', `select kind, count(*) from app.migration_candidates where company_id='taebaek' group by 1 order by 1`);
out('cut-same', JSON.stringify((await db.query(tb)).rows) === before, before);
await log('cut-archived', `select count(*) filter (where status='archived' and date < '2026-10-15') arch, count(*) filter (where status='active' and date < '2026-10-14') left_active from erp.vouchers where company_id='taebaek'`);
await log('cut-openings', `select count(*) n, sum(amount) > 0 pos from erp.vouchers where company_id='taebaek' and kind='기초' and status='active' and date='2026-10-14'`);
await log('cut-balanced', `select round(sum(debit)) = round(sum(credit)) ok from erp.journal_lines where company_id='taebaek'`);
await log('cut-old', `select id, status, accounting_excluded from erp.orders where id in ('OLD1','OLD2') order by id`);
await log('cut-list', `select kind, ref_id, summary, amount, picked, cutoff from public.migration_list('taebaek') where ref_id like 'OLD%' order by ref_id`);
await log('cut-pick', `select public.set_migration_pick('taebaek','unbilled',array['OLD2','nope'],true)`);
await log('cut-orders', `select count(*) from erp.orders where company_id='taebaek' and accounting_excluded_reason like '이관 안 함%'`);
// 마이페이지 내 급여: 직원 카드가 연결된 계정만, 급여 전표까지 낸 달만
await log('myslip', `select count(*) from public.my_payslips('taebaek')`);
// 승인 전 내 휴가 고치기: 대기면 됨, 승인 뒤·남의 것은 막힘
await db.exec(`update erp.employees set auth_uid='${U2}' where id = (select employee_id from app.member_employees where user_id='${U2}' limit 1); select set_config('t.uid','${U2}',false)`);
const myLv=(await one(`select public.request_leave('{"company_id":"taebaek","type":"연차","start_date":"2026-12-01","end_date":"2026-12-01","days":1}') v`)).v;
await log('lv-edit', `select public.update_my_leave($1, '{"type":"오전반차","start_date":"2026-12-02","end_date":"2026-12-02","days":0.5,"reason":"병원"}')`,[myLv]);
await log('lv-after', `select type, start_date, days_used, reason, status from erp.leave_requests where id=$1`,[myLv]);
await db.exec(`select set_config('t.uid','${U}',false)`);
await log('lv-other', `select public.update_my_leave($1, '{"start_date":"2026-12-03","end_date":"2026-12-03","days":1}')`,[myLv]);
await db.exec(`select public.set_leave_status('${myLv}','approved'); select set_config('t.uid','${U2}',false)`);
await log('lv-approved', `select public.update_my_leave($1, '{"start_date":"2026-12-03","end_date":"2026-12-03","days":1}')`,[myLv]);
await db.exec(`select set_config('t.uid','${U}',false)`);
// 스마트스토어 판매가: 기존 앱 값으로 비어 있는 것만 채움, save_item으로 고침
await db.exec(`update raw.docs set data = data || '{"smartStorePrice":12000}' where collection='items' and id='FG1'`);
await db.exec(strip(copy('smartstore_price')));
await log('ssp', `select smartstore_price from erp.items where id='FG1'`);
await db.exec(`update erp.items set smartstore_price = 13000 where id='FG1'`); await db.exec(strip(copy('smartstore_price')));
await log('ssp-keep', `select smartstore_price from erp.items where id='FG1'`);
for (const f of ['030_checks.sql','031_checks_more.sql']) {
  const qs=strip(fs.readFileSync(dir+f,'utf8')).split(/;\s*\n/).map(s=>s.trim()).filter(s=>s && !s.startsWith('--') || s.includes('select'));
  let bad=0; for(const s of qs){ if(s.includes('pg_database_size')) continue; try{ await db.query(s);}catch(e){bad++; out('CHKERR',f,e.message.slice(0,120));} }
  out(f,'errors',bad);
}
