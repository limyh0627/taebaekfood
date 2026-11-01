// 첨부 원본의 양식과 기존 도형을 보존하며 현재 로컬 코드의 관계만 덧붙인다.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const original=readFileSync(resolve(root,'docs/태백푸드-ERD-원본-20261029.html'));
if(createHash('sha256').update(original).digest('hex')!=='904cb483f9d339da1acdc301ae1ebe5236b4cb5ddb995bd127919e5a262577d1')throw Error('첨부 원본의 해시가 다릅니다.');
let html=original.toString('utf8');
const match=html.match(/const D = (\{[^\r\n]*\});/);if(!match)throw Error('원본 데이터가 없습니다.');
const D=JSON.parse(match[1]);
// 근거와 로컬 상태는 docs/erd-current-and-target-20261007.md의 10/29 절에 있다.
const fk=(n,to,note)=>({n,t:'string',fk:to,ff:'id',note});
const f=(n,t,note)=>({n,t,...(note?{note}:{})});
const additions=[
 ['orderStockFullAttemptsV1','전체 재고 작업','order','op',[f('id','string','문서 ID'),f('reference','map'),fk('reference.orderId','orders','reference 안의 주문 ID'),f('owner','map'),f('state','string'),f('fullPlanHash','string'),f('receipt','map')]],
 ['orderRequestRetirementAuthorizations','요청 퇴역 승인','order','op',[f('id','string'),fk('orderId','orders'),f('actorUid','string'),f('expectedOrderHash','string'),f('backupHash','string')]],
 ['orderRequestRetirements','요청 퇴역 기록','order','op',[f('id','string'),fk('orderId','orders'),f('generation','map'),f('requestHash','string'),f('firstConsumer','map','조건부 최초 소비 근거')]],
 ['orderLockRecoveryOperations','이전 잠금 복구','order','op',[f('id','string'),fk('orderId','orders'),f('failedOperationId','string'),f('inventoryApplied','string'),f('status','string')]],
 ['rawManualCorrectionReceipts','원료 수동 정정 결과','prod','op',[f('id','string'),f('companyId','string'),f('operationId','string'),f('requestHash','string'),f('status','string')]],
 ['productionRecordOperations','생산기록 변경 결과','prod','op',[f('id','string'),f('reference','map'),fk('reference.targetId','productionRecords','reference 안의 대상 기록 ID'),f('actorUid','string'),f('status','string'),f('requestHash','string')]],
 ['inventoryWriterDeletions','품목 삭제 계보','item','op',[f('id','string'),fk('itemId','items'),f('companyId','string'),f('deletionRevision','number'),f('beforeRevision','number')]],
 ['orderStockReservationAttemptsV1','재고 예약 작업','order','op',[f('id','string'),f('owner','map'),f('intentText','string','최초 원문에 주문 참조 포함'),f('state','string'),f('receipt','map')]],
 ['workOrderItems','작업지시 항목','order','data',[f('id','string'),f('companyId','string')]],
 ['orderManualCorrectionsV1','수동 박스 정정 근거','order','op',[f('id','string'),f('reference','map'),fk('reference.orderId','orders','reference 안의 주문 ID'),f('owner','map'),f('approval','map'),f('manualEffects','map'),f('receipt','map')]],
 ['companyTransferGrants','회사 간 이체 권한','acct','data',[f('id','string','인증 UID 기준 문서'),f('revision','number')]],
 ['companyTransferOperations','회사 간 이체 작업','acct','op',[f('id','string'),f('companyId','string'),f('from','string'),f('to','string'),f('requestHash','string'),f('status','string')]],
 ['financialOpeningOperations','기초잔액 작업','acct','op',[f('id','string'),f('companyId','string'),f('kind','string'),f('requestHash','string'),f('status','string')]],
 ['item_purchase_unit','품목 매입단위','item','data',[f('id','string'),fk('itemId','items'),f('companyId','string')]],
 ['manualSettlementBatchOperations','상계 묶음 작업','acct','op',[f('id','string'),fk('partnerId','partners'),fk('cashEntryId','cashEntries'),f('companyId','string'),f('requestHash','string')]],
 ['manualSettlementOperations','상계 작업','acct','op',[f('id','string'),fk('partnerId','partners'),f('companyId','string'),f('requestHash','string'),f('settlementId','string')]],
 ['partnerAdvanceOperations','거래처 선급 작업','acct','op',[f('id','string'),f('companyId','string'),f('operationId','string')]],
 ['returnRequests','반품 요청','order','data',[f('id','string'),fk('partnerId','partners'),fk('linkedStatementId','issuedStatements'),f('companyId','string'),f('status','string'),f('items','array')]],
 ['returnApplications','반품 적용','acct','data',[f('id','string'),fk('returnRequestId','returnRequests'),fk('statementId','issuedStatements'),f('companyId','string'),f('operationId','string'),f('amount','number')]],
 ['returnOperations','반품 처리 결과','acct','op',[f('id','string'),fk('returnRequestId','returnRequests'),f('companyId','string'),f('operationId','string')]],
 ['returnSubmissionOperations','반품 접수 결과','order','op',[f('id','string'),fk('requestId','returnRequests'),f('companyId','string'),f('requestHash','string'),f('status','string')]],
 ['taxIssueOperations','세금 발행 작업','acct','op',[f('id','string'),f('companyId','string'),f('requestHash','string')]],
 ['taxIssueRecords','세금 발행 기록','acct','data',[f('id','string'),{n:'statementIds[]',t:'array',fk:'issuedStatements',ff:'id'},f('operationId','string'),f('companyId','string'),f('kind','string'),f('supply','number'),f('tax','number'),f('amount','number'),f('issuedAt','string'),f('actorId','string'),f('status','string')]],
];
for(const [id,label,group,kind,fields] of additions){if(D.tables[id])throw Error('이미 존재하는 표: '+id);D.tables[id]={l:label,g:group,k:kind,c:null,f:fields};D.groups.find(g=>g.k===group).ids.push(id);}
D.tables.orderManualCorrectionsV1.localStatus='배포 소스에 포함된 내부 모듈입니다. 공개 정정 실행·운영 적용은 미완료입니다.';
const updates={orders:[f('companyId','string'),f('inventoryWriterProtocolVersion','number'),f('inventoryWriteRevision','number'),f('inventoryOperation','map','원 작업 잠금과 세대'),f('inventoryGenerationCompletion','map'),f('inventorySnapshots','map'),f('itemInventory','map'),f('productionRecordIndex','map'),f('producedUnits','array'),f('productConsumedLots','array'),f('rawInventoryAttempt','number'),f('inventoryExecutionProtocol','string','서버 전체 재고 경로 표식'),f('orderListProjection','map','조회용 보조 값'),f('retirementId','string'),f('retirementClaimPending','bool'),f('orderManualCorrectionRefsV1','array','내부 정정 참조·공개 실행 미제공')],items:[f('companyId','string'),f('fullReservationRows','array','서버 보호 예약의 정확한 부분집합')],productionRecords:[f('companyId','string'),fk('orderId','orders'),f('lineId','string'),f('generation','map'),f('supersededBy','map'),f('legacySourceCandidates','array'),f('inventoryWriterProtocolVersion','number'),f('inventoryWriteRevision','number'),f('fullEffectAuthority','map')],rawMaterialLedger:[f('companyId','string'),f('fullEffectAuthority','map'),f('orderManualCorrectionEffectAuthority','map','내부 수동 정정 효과 표식·공개 실행 미제공')],rawInventoryReversalGuards:[f('companyId','string'),f('fullEffectAuthority','map')],orderStatusAudits:[f('companyId','string'),f('kind','string'),f('at','string'),f('cancelledBy','map'),f('fullProtocol','string')],rawInventoryJobs:[f('companyId','string'),f('generation','map')]};
for(const [id,fields] of Object.entries(updates))for(const field of fields){if(D.tables[id].f.some(x=>x.n===field.n))throw Error('기존 필드 중복: '+id+'.'+field.n);D.tables[id].f.push(field);}
// c7 배포 소스에서 실제 쓰는 필드만 추가한다. 운영 수량은 추정하지 않는다.
const c7Fields={partners:[f('oemReceiptTermsV2','map','품목별 가공·업체부자재 요율 편의설정. 회사·품목 권위 증거가 아니며 실제 입고에서 독립 검증.')],purchaseOrders:[f('oemFeeTermsV2','map'),f('oemFeeSnapshotV2','map')],adjustmentRequests:[f('oemFeeTermsV2','map'),f('oemFeeSnapshotV2','map')],oemReceiptOperations:[f('oemFeeTermsV2','map'),f('oemFeeSnapshotV2','map'),f('oemFeeTotalV2','number')]};
for(const [id,fields] of Object.entries(c7Fields))for(const field of fields){if(!D.tables[id]||D.tables[id].f.some(x=>x.n===field.n))throw Error('필드 대상 누락 또는 중복: '+id+'.'+field.n);D.tables[id].f.push(field);}
const snapshotItems=D.tables.inventorySnapshots.f.filter(x=>x.n==='items');if(snapshotItems.length!==1)throw Error('월말 품목 필드가 유일하지 않습니다.');
snapshotItems[0].note='월말 자동 저장도 같은 재고 평가 줄의 itemId·name·spec?·qty·value를 보관합니다. 기존 월 문서는 보존하며 과거 빈 배열이나 미기록은 재고 0의 증거가 아닙니다.';
for(const [id,,, ,fields] of additions){const primary=fields.find(x=>x.n==='id');if(!primary)throw Error('문서 ID 누락: '+id);const selected=[primary,...fields.filter(x=>x.fk),...fields.filter(x=>x.n!=='id'&&!x.fk)].slice(0,3);D.dia.rows[id]=selected.map(x=>[x.fk?'fk':x.n==='id'?'pk':'f',x.n,x.fk||null,0]);}
// 새 카드만 아래에 배치한다. 원래 85개 카드와 선의 좌표는 건드리지 않는다.
const H=1630+100+Math.ceil(additions.length/5)*170;D.dia.H=H;D.dia.groups.recovery={x:20,y:1630,w:2960,h:H-1660};
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const font="'Noto Sans KR','Malgun Gothic',sans-serif";
const positions=additions.map((_,i)=>({x:40+(i%5)*585,y:1680+Math.floor(i/5)*170,w:540,h:124}));
const oldCenters={orders:{x:1664,y:360},productionRecords:{x:456,y:359},items:{x:782,y:360}};
function originalCenter(id){if(oldCenters[id])return oldCenters[id];const m=html.match(new RegExp('<g data-card="'+id+'"><rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"'));return m?{x:Number(m[1])+Number(m[3])/2,y:Number(m[2])+Number(m[4])}:null;}
let edges='',cards='';
for(const [i,[id,label,group,kind,fields]] of additions.entries()){
 const {x,y,w,h}=positions[i],color=({item:'#0B8585',partner:'#2862D6',order:'#D9711A',acct:'#7448CC',prod:'#23915A',people:'#C9467F',docs:'#9A7417',haccp:'#C2413A',sys:'#5F6673'})[group],rows=D.dia.rows[id];
 if(!color)throw Error('알 수 없는 그룹: '+group);
 rows.forEach((row,j)=>{if(row[0]!=='fk')return;const targetIndex=additions.findIndex(entry=>entry[0]===row[2]),target=originalCenter(row[2])??(targetIndex>=0?{x:positions[targetIndex].x+positions[targetIndex].w/2,y:positions[targetIndex].y}:null);if(!target)throw Error('관계 대상 카드가 없습니다: '+row[2]);const sx=x+w/2,sy=y+44+j*21,ex=target.x,ey=target.y;edges+=`<g data-edge="1" data-s="${id}" data-i="${j}" data-t="${row[2]}" stroke="${color}" fill="none" stroke-width="1.6" stroke-opacity="0.7"><path d="M${sx},${sy} C${sx},${sy-80} ${ex},${ey+80} ${ex},${ey}"/></g>`;});
 cards+=`<g data-card="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9" fill="#FFFFFF" stroke="${color}" stroke-opacity="0.55" stroke-width="1.2"/><path d="M${x},${y+9} a9,9 0 0 1 9,-9 h${w-18} a9,9 0 0 1 9,9 v31 h-${w} z" fill="${color}"/><text x="${x+12}" y="${y+18}" font-family="${font}" font-size="14" font-weight="700" fill="#FFFFFF">${esc(label)}${kind==='op'?' · 작업 영수증':' · 보조 데이터'}</text><text x="${x+12}" y="${y+33}" font-family="${font}" font-size="11" fill="#FFFFFF">${id} · 문서 수 미측정</text>`;
 rows.forEach((row,j)=>{const yy=y+44+j*21;cards+=`<g data-row="${j}"><rect class="hit" x="${x+1}" y="${yy}" width="${w-2}" height="21" fill="#F5B301" fill-opacity="0"/><text x="${x+12}" y="${yy+14}" font-family="${font}" font-size="12" fill="#111827">${row[0]==='pk'?'PK ':row[0]==='fk'?'FK ':''}${esc(row[1])}${row[2]?' → '+esc(D.tables[row[2]].l):''}</text></g>`;});cards+='</g>';
}
const replaceOnce=(a,b)=>{if(html.split(a).length!==2)throw Error('원본 치환 지점 확인 실패: '+a.slice(0,80));html=html.replace(a,b);};
replaceOnce(match[0],'const D = '+JSON.stringify(D)+';');
replaceOnce('viewBox="0 0 3002 1617"','viewBox="0 0 3002 '+H+'"');
replaceOnce('<rect width="3002" height="1617" fill="#FFFFFF"/>','<rect width="3002" height="'+H+'" fill="#FFFFFF"/>');
const edgeStart=html.indexOf('<g data-edge="1"',html.indexOf('id="erdSvg"'));if(edgeStart<0)throw Error('기존 관계선 없음');html=html.slice(0,edgeStart)+'<g data-added-edges="1">'+edges+'</g>'+html.slice(edgeStart);
const end=html.indexOf('</svg>',html.indexOf('id="erdSvg"'));if(end<0)throw Error('SVG 없음');
html=html.slice(0,end)+`<rect x="20" y="1630" width="2960" height="${H-1660}" rx="14" fill="#F8FAFC" stroke="#CBD5E1"/><text x="40" y="1658" font-family="${font}" font-size="16" font-weight="700" fill="#334155">추가 작업·영수증 · 코드 정의 (문서 수 미측정)</text>`+cards+html.slice(end);
replaceOnce('Firestore taebaek-3abe4 · 컬렉션 85개 · 문서 수는 2026-10-21 운영 DB 기준',`코드 스키마 표 ${Object.keys(D.tables).length}개 · 기존 문서 수 2026-10-21 관측 · 신규 표 미측정 · 2026-11-02 배포 c7b11e3 · 함수 4개 갱신 · 정정 실행 미공개`);
replaceOnce('Firestore taebaek-3abe4 · 컬렉션 85개 · 2026-10-21 운영 DB를 읽어 만듦',`기존 85개 관측 + 코드 대조 ${additions.length}개 · 문서 수는 2026-10-21 기준 · 정정 실행 미공개`);
replaceOnce('모든 문서에 companyId(회사 구분)가 있다 — 이 선은 생략했다. 배열[] 안의 ID도 FK로 표시했다.','회사 구분은 문서별로 확인한다. 선은 애플리케이션의 논리 관계이며 DB의 강제 외래키가 아니다.');
replaceOnce('function rowHtml(id, m) {','const countText = n => n === null ? "미측정" : n.toLocaleString() + "건";\nfunction rowHtml(id, m) {');
replaceOnce("const realField = (id, text) => (id === 'fileCabinetDocs'", "const realField = (id, text) => T[id].f.some(f => f.n === text) ? text : (id === 'fileCabinetDocs'");
html=html.replaceAll('${t.c.toLocaleString()}건','${countText(t.c)}').replaceAll('${T[id].c.toLocaleString()}건','${countText(T[id].c)}');
replaceOnce('const docs = g.ids.reduce((s, id) => s + T[id].c, 0);','const docs = g.ids.reduce((s, id) => s + (T[id].c ?? 0), 0), missing = g.ids.filter(id => T[id].c === null).length;');
replaceOnce('문서 ${docs.toLocaleString()}건','문서 ${docs.toLocaleString()}건 (기존 관측)${missing ? ` · 미측정 ${missing}개` : ""}');
replaceOnce("+ (t.k === 'op' ? '<p class=\"kindnote\">", "+ (t.localStatus ? `<p class=\"kindnote\">${esc(t.localStatus)}</p>` : '')\n    + (t.k === 'op' ? '<p class=\"kindnote\">");
replaceOnce('모든 문서에 있는 companyId(회사 구분)는 뺐습니다. 필드는 이 컬렉션의 문서 30건을 읽어 모았습니다.','기존 필드는 2026-10-21 관측을 바탕으로 하며, 추가 필드는 기존 배포 소스와 2026-11-02 배포한 c7b11e3 변경 범위를 대조했습니다. 신규 표의 문서 수는 측정하지 않았습니다.');
writeFileSync(resolve(root,'docs/태백푸드-ERD-현재코드-20261029.html'),html,'utf8');
