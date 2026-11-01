import { preserveInventoryWriterProtocol } from './shared/inventoryWriterProtocol';
import { buildOemFeePlan, oemFeeLineAmount as lineAmount, type OemFeeProductInput } from './shared/oemFeePlan';
import { buildOemBatchCostPreview, finalizeOemBatchCost, oemFeeUnitKgFromSavedReceipt, validateOemCostIssueFingerprint, type OemBatchCost } from './shared/oemBatchCost';
import { readVoucherCounter, writeVoucherCounter } from './newScopeCounter';
import * as admin from 'firebase-admin';
import { createHash } from 'crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { formatVoucherNo, voucherSequenceKey } from './voucherIssue';
import { assertReleaseActive, assertVoucherDateAllowed, releaseGateRef } from './releaseGate';
import { commandHash, inventoryDocId, operationDocId } from './shared/rawInventoryCore';

type Row = Record<string, any>;
type Input = { poId: string; perKg: number; statement: Row; releaseId: string };
const fail = (message: string): never => { throw new HttpsError('failed-precondition', message); };
const invalid = (message: string): never => { throw new HttpsError('invalid-argument', message); };
const ownCompany = (row: Row) => row.companyId ?? 'taebaek';
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
const packageKg = (value: unknown) => {
  const matched = /([\d.]+)\s*kg/i.exec(String(value ?? ''));
  return matched ? Number(matched[1]) : 0;
};
const specCount = (value: unknown) => {
  const matched = /[*x×]\s*([\d.]+)/i.exec(String(value ?? ''));
  const count = matched ? Number(matched[1]) : NaN;
  return Number.isFinite(count) && count > 0 ? count : 1;
};
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value as Row).filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
    : value;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const business = (row: Row) => {
  const { id: _id, docNo: _no, issuedAt: _time, createdBy: _by,
    issueOperationId: _op, issuePayloadHash: _hash, issueVoucherNo: _savedNo, ...body } = row;
  return body;
};

/** One OEM fee, its PO link and the shared 가공 sequence are a single transaction. */
export async function issueOemFeeVoucher(db: admin.firestore.Firestore, companyId: string, input: Input): Promise<string> {
  if (!input || typeof input !== 'object') invalid('가공비 발행 요청이 잘못되었습니다.');
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(input.releaseId)) invalid('배포 전환 ID가 필요합니다.');
  const { poId, perKg, statement: supplied } = input;
  if (typeof poId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(poId)
    || !finite(perKg) || perKg <= 0 || !supplied || typeof supplied !== 'object' || Array.isArray(supplied)) invalid('가공비 입력이 잘못되었습니다.');
  const stmt = supplied as Row;
  const statementId = `OEMFEE-${poId}`;
  if (stmt.id !== statementId || stmt.orderId !== poId || stmt.type !== '매입'
    || (stmt.companyId !== undefined && stmt.companyId !== companyId)) invalid('가공비 전표 회사·배치가 일치하지 않습니다.');
  const date = stmt.tradeDate;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) invalid('가공비 전표일이 잘못되었습니다.');
  if (!Array.isArray(stmt.items) || !stmt.items.length || stmt.items.some((line: Row) =>
    !line || typeof line !== 'object' || !line.accountCode || !finite(line.qty)
    || line.qty <= 0 || !finite(line.price) || line.price <= 0
    || !finite(line.supply) || line.supply < 0 || !finite(line.tax) || line.tax < 0
    || !finite(line.total) || line.total <= 0 || line.supply + line.tax !== line.total
    || line.accountCode !== '540' || typeof line.isTaxExempt !== 'boolean'
    || lineAmount(1, line.total, line.isTaxExempt).supply !== line.supply)) invalid('가공비 전표 줄이 잘못되었습니다.');
  const sums = stmt.items.reduce((acc: number[], line: Row) => [acc[0] + line.supply, acc[1] + line.tax, acc[2] + line.total], [0, 0, 0]);
  if (![stmt.totalSupply, stmt.totalTax, stmt.totalAmount].every(finite)
    || sums.some((n: number, i: number) => n !== [stmt.totalSupply, stmt.totalTax, stmt.totalAmount][i])) invalid('가공비 전표 합계가 일치하지 않습니다.');
  const exempt = stmt.items.every((line: Row) => line.isTaxExempt === true);
  const taxable = stmt.items.every((line: Row) => line.isTaxExempt === false);
  if (!exempt && !taxable) invalid('가공비 과세 기준이 섞였습니다.');
  const semantic = { ...business(stmt), companyId };
  const payloadHash = hash({ statement: semantic, perKg });
  const poRef = db.collection('purchaseOrders').doc(poId);
  const statementRef = db.collection('issuedStatements').doc(statementId);
  const feeRef = db.collection('adjustmentRequests').doc(statementId);
  const counterRef = db.collection('appMeta').doc(voucherSequenceKey(companyId, date, '가공'));
  const sameBatchQuery = db.collection('issuedStatements').where('orderId', '==', poId);
  const codeQuery = db.collection('accountCodes');
  const releaseGate = releaseGateRef(db);
  return db.runTransaction(async tx => {
    const [poSnap, stmtSnap, feeSnap, batchStatements, codes, releaseSnap] = await Promise.all([
      tx.get(poRef), tx.get(statementRef), tx.get(feeRef), tx.get(sameBatchQuery), tx.get(codeQuery), tx.get(releaseGate),
    ]);
    assertReleaseActive(releaseSnap, input.releaseId);
    assertVoucherDateAllowed(releaseSnap, companyId, date);
    if (!poSnap.exists) fail('OEM 배치가 없습니다.');
    const po = poSnap.data()!;
    let receiptData: Row | undefined;
    if(po.oemCostEvidenceSource==='receipt'){
      const receiptId=po.oemReceiptOperationId;
      if(typeof receiptId!=='string' || receiptId!==`oem-receive:${poId}`)fail('OEM 원가의 원입고 작업 ID가 없습니다.');
      const receipt=await tx.get(db.collection('oemReceiptOperations').doc(receiptId));
      receiptData=receipt.data();
      if(!receipt.exists || receipt.data()!.companyId!==companyId || receipt.data()!.poId!==poId || po.oemCostEvidence===undefined
        || hash(receipt.data()!.oemCostEvidence)!==hash(po.oemCostEvidence))fail('OEM 입고 시 고정한 원가 근거가 변경되었습니다.');
    } else {
      if(po.oemCostEvidenceSource!==undefined && po.oemCostEvidenceSource!=='issue')fail('OEM 원가 입력 출처가 잘못되었습니다.');
      validateOemCostIssueFingerprint(po);
    }
    if (ownCompany(po) !== companyId || po.poType !== 'oem' || po.status !== 'received') fail('가공비를 발행할 수 없는 OEM 배치입니다.');
    if (feeSnap.exists) {
      const fee = feeSnap.data()!;
      if (ownCompany(fee) !== companyId || fee.type !== 'oem_fee' || fee.oemPoId !== poId
        || fee.oemFeePerKg !== perKg || fee.status !== 'pending' && fee.status !== 'processed') {
        fail('OEM 가공비 확인 요청이 입고와 일치하지 않습니다.');
      }
    }
    const partnerId = po.oemPartnerId ?? po.partnerId;
    if (!partnerId || stmt.partnerId !== partnerId) fail('OEM 거래처가 일치하지 않습니다.');
    const partner = await tx.get(db.collection('partners').doc(partnerId));
    if (!partner.exists || ownCompany(partner.data()!) !== companyId) fail('OEM 거래처 회사가 일치하지 않습니다.');
    if (!finite(po.oemReceivedKg) || po.oemReceivedKg <= 0) fail('가공입고 중량이 확인되지 않았습니다.');
    const gross = Math.round(po.oemReceivedKg * perKg);
    if (feeSnap.exists && feeSnap.data()!.oemTotal !== gross) fail('OEM 가공비 확인 요청 금액이 입고와 다릅니다.');
    if (gross <= 0 || stmt.totalAmount !== gross) fail('가공입고 중량·단가와 전표 금액이 다릅니다.');
    const poItems: Row[] = (po.items ?? []).filter((item: Row) => Number(item.quantity) > 0);
    const bulk: Row[] = (po.oemReceivedBulk ?? []).filter((item: Row) => Number(item.kg) > 0);
    // 벌크 원가는 수불 원문과 입고 시 고정한 명령으로 확인한다. 현재 원료 단가로 추정하지 않는다.
    const bulkReads = new Map<string, {item:admin.firestore.DocumentSnapshot;state:admin.firestore.DocumentSnapshot}>();
    if (bulk.length && po.oemCostEvidence !== undefined) {
      if (!receiptData) {
        const saved=await tx.get(db.collection('oemReceiptOperations').doc(`oem-receive:${poId}`));
        receiptData=saved.data();
      }
      const proofs: Row[]=receiptData?.bulkReceipts;
      if (!receiptData || receiptData.companyId!==companyId || receiptData.poId!==poId || !Array.isArray(proofs)
        || proofs.length!==bulk.length || hash(proofs)!==receiptData.bulkEvidenceHash) fail('OEM 벌크 원입고 근거가 변경되었습니다.');
      for (const row of bulk) {
        const proof=proofs.find(proof=>proof.rawItemId===row.rawItemId && proof.lotId===row.lotId);
        if (!proof) return fail('OEM 벌크 원입고 근거가 없습니다.');
        if (!row.rawItemId || !row.lotId || !row.operationId || proof.kg!==row.kg
          || proof.material!==row.material || proof.command?.materialSnapshot!==row.material
          || proof.commandHash!==row.commandHash || proof.operationId!==row.operationId
          || proof.reportedDeltaKg!==row.kg || proof.appliedDeltaKg!==row.appliedDeltaKg
          || proof.status!==row.status || !['applied','skipped-backdated'].includes(proof.status)
          || proof.command?.companyId!==companyId || proof.command?.rawItemId!==row.rawItemId
          || proof.command?.kind!=='receive' || proof.command?.kg!==row.kg
          || proof.command?.operationId!==row.operationId || proof.command?.source?.id!==poId || proof.command?.source?.type!=='oem'
          || commandHash(proof.command)!==row.commandHash) fail('OEM 벌크 원료·로트·명령 근거가 다릅니다.');
        const movement=await tx.get(db.collection('rawMaterialLedger').doc(operationDocId(row.operationId)));
        if (!movement.exists || hash(movement.data())!==hash(proof.movement)
          || proof.movement.companyId!==companyId || proof.movement.rawItemId!==row.rawItemId
          || proof.movement.operationId!==row.operationId || proof.movement.commandHash!==row.commandHash
          || proof.movement.kind!=='receive' || proof.movement.materialSnapshot!==row.material
          || proof.movement.source?.type!=='oem' || proof.movement.source?.id!==poId
          || proof.movement.reportedDeltaKg!==row.kg || proof.movement.appliedDeltaKg!==row.appliedDeltaKg
          || (row.appliedDeltaKg!==0 && row.appliedDeltaKg!==row.kg)
          || (row.appliedDeltaKg===0 ? row.status!=='skipped-backdated' || proof.movement.backdatedBeforeStocktake!==true : row.status!=='applied'))
          fail('OEM 벌크 원수불 기록이 변경되었습니다.');
        if(row.appliedDeltaKg!==0 && !proof.movement.lotChanges?.some((change:Row)=>change.lotId===row.lotId
          && change.deltaKg===row.kg && change.lotSnapshot?.poId===poId)) fail('OEM 벌크 원입고 로트 근거가 없습니다.');
        if (!bulkReads.has(row.rawItemId)) {
          const [item,state]=await Promise.all([tx.get(db.collection('items').doc(row.rawItemId)),
            tx.get(db.collection('rawInventories').doc(inventoryDocId(companyId as 'taebaek'|'punghoe',row.rawItemId)))]);
          if(!item.exists || ownCompany(item.data()!)!==companyId || !state.exists
            || state.data()!.companyId!==companyId || state.data()!.rawItemId!==row.rawItemId)
            fail('OEM 벌크 원료 상태를 확인할 수 없습니다.');
          bulkReads.set(row.rawItemId,{item,state});
        }
      }
    }
    const [products, bomRows] = await Promise.all([
      Promise.all(poItems.map(item => tx.get(db.collection('items').doc(item.itemId)))),
      Promise.all(poItems.map(item => tx.get(db.collection('item_bom').where('parent_id', '==', item.itemId)))),
    ]);
    const childIds = [...new Set(bomRows.flatMap(rows => rows.docs.map(snap => snap.data().child_id as string)).filter(Boolean))];
    const childDocs = await Promise.all(childIds.map(id => tx.get(db.collection('items').doc(id))));
    const children = new Map(childDocs.filter(snap => snap.exists).map(snap => [snap.id, snap.data()!]));
    const savedUnitKg = oemFeeUnitKgFromSavedReceipt(po as {items:{itemId:string;quantity:number}[]});
    const productInputs: OemFeeProductInput[] = [];
    for (const [index, product] of products.entries()) {
      const poItem = poItems[index];
      if (!product.exists || ownCompany(product.data()!) !== companyId) fail('현재 회사의 OEM 전표 품목을 찾을 수 없습니다.');
      const item = product.data()!;
      if (savedUnitKg) {
        const lots: Row[] = Array.isArray(item.lots) ? item.lots : [];
        const matches = lots.filter(lot => lot.id === `lot-oem-${poId}-${poItem.itemId}`);
        const row = po.oemBatchCost.rows.find((row: Row) => row.itemId === poItem.itemId);
        if (matches.length !== 1 || matches[0].poId !== poId || matches[0].qtyIn !== poItem.quantity || matches[0].kgIn !== row.kg)
          fail('OEM 원입고 로트 수량·중량이 변경되었습니다.');
      }
      const finishedChildren = bomRows[index].docs.map(snap => snap.data())
        .filter(row => ['product', '완제품'].includes(children.get(row.child_id)?.type));
      const boxed = (finishedChildren.length === 1 && Number(finishedChildren[0].quantity ?? 1) > 1)
        || item.unit === '박스';
      const kg = savedUnitKg?.get(poItem.itemId) ?? (item.packageKg || (packageKg(item.spec) || packageKg(item.name)) * (boxed ? specCount(item.spec) : 1));
      // 앱의 입력칸 coerce 정책으로 서버의 손상된 저장 kg가 0/fallback으로 바뀌지 않게 한다.
      if (!Number.isFinite(kg * perKg)) fail('가공비 전표 줄이 OEM 입고 내역과 다릅니다.');
      productInputs.push({name:poItem.name,spec:item.spec ?? poItem.unit ?? '',qty:poItem.quantity,unitKg:kg});
    }
    const sent = (po.oemSent ?? []).reduce((sum: number, row: Row) => sum + Number(row.kg || 0), 0);
    let expected: ReturnType<typeof buildOemFeePlan>['lines'];
    try {
      expected = buildOemFeePlan({receivedKg:po.oemReceivedKg,sentKg:sent,perKg,exempt,
        accountCode:'540',products:productInputs,bulk:bulk.map(row => ({material:row.material,kg:row.kg}))}).lines;
    } catch { return fail('가공입고 중량과 전표 줄이 일치하지 않습니다.'); }
    if (hash(stmt.items) !== hash(expected)
      || stmt.totalSupply !== expected.reduce((sum, line) => sum + line.supply, 0)
      || stmt.totalTax !== expected.reduce((sum, line) => sum + line.tax, 0)) {
      fail('가공비 전표 줄이 OEM 입고 내역과 다릅니다.');
    }
    const allowedCodes = new Set(codes.docs.filter(snap => ownCompany(snap.data()) === companyId).map(snap => snap.data().code));
    if (stmt.items.some((line: Row) => !allowedCodes.has(line.accountCode))) fail('가공비 회사 계정과목이 일치하지 않습니다.');
    if (batchStatements.docs.some(snap => snap.id !== statementId
      && ownCompany(snap.data()) === companyId && snap.data().type === '매입')) fail('연결되지 않은 기존 가공비 전표가 있습니다.');
    if (po.linkedStatementId && po.linkedStatementId !== statementId) fail('이미 다른 가공비 전표가 연결된 배치입니다.');
    if (po.linkedStatementId === statementId && !stmtSnap.exists) fail('연결된 가공비 전표가 없어 정합성 확인이 필요합니다.');
    let batchCost: OemBatchCost | undefined;
    const costLotUpdates = new Map<string,{ref:admin.firestore.DocumentReference;patch:Row}>();
    if (po.oemBatchCost?.status === 'blocked' && ['fee-changed','fee-deleted'].includes(po.oemBatchCost.reason)) {
      // 수정·삭제된 비용은 금융 전표 재발행으로 자동 재확정하지 않는다.
    } else if (po.oemBatchCost !== undefined) {
      const stored=po.oemBatchCost;
      const preview=buildOemBatchCostPreview(po.oemCostEvidence,{companyId,sent:po.oemSent ?? []},stored.rows ?? []);
      if ('receivedKg' in preview && preview.receivedKg !== po.oemReceivedKg) fail('OEM 원가 배분량이 입고 원문과 다릅니다.');
      if (preview.status === 'pending-fee') {
        batchCost=finalizeOemBatchCost(preview,{statementId,feeSupplyAmount:stmt.totalSupply});
        if (hash(stored)!==hash(stmtSnap.exists?batchCost:preview)) fail('OEM 원가 확인 근거가 변경되었습니다.');
        for(const allocation of batchCost.allocations){
          const metadata={poId,feeStatementId:statementId,receivedKg:allocation.kg,totalSupplyAmount:batchCost.totalSupplyAmount,
            allocatedSupplyAmount:allocation.supplyAmount,costPerKg:allocation.costPerKg};
          if(allocation.kind==='bulk'){
            const reads=bulkReads.get(allocation.rawItemId!);
            const saved=bulk.find(row=>row.rawItemId===allocation.rawItemId && row.lotId===allocation.lotId);
            if(!reads || !saved) return fail('OEM 원가의 벌크 입고 근거가 없습니다.');
            if(saved.kg!==allocation.kg) fail('OEM 원가의 벌크 입고 근거가 없습니다.');
            const itemLots:Row[]=reads.item.data()!.lots;
            const state=reads.state.data()!;
            if(!Array.isArray(itemLots) || !Array.isArray(state.activeLots) || !Array.isArray(state.recentDepletedLots)) fail('OEM 벌크 로트 상태 형식이 다릅니다.');
            const itemMatches=itemLots.filter(lot=>lot.id===allocation.lotId);
            const stateMatches=[...state.activeLots,...state.recentDepletedLots].filter(lot=>lot.id===allocation.lotId);
            if(itemMatches.length!==stateMatches.length || itemMatches.length>1
              || (itemMatches.length && hash(itemMatches[0])!==hash(stateMatches[0]))) fail('OEM 벌크 품목 로트와 원료 상태가 다릅니다.');
            for(const [snapshot,fields] of [[reads.item,['lots']],[reads.state,['activeLots','recentDepletedLots']]] as const){
              const data=snapshot.data()!;
              const pending=costLotUpdates.get(snapshot.ref.path)?.patch ?? {};
              for(const field of fields){
                const lots:Row[]=pending[field] ?? data[field];
                if(!Array.isArray(lots)) fail('OEM 벌크 로트 상태 형식이 다릅니다.');
                const matches=lots.filter(lot=>lot.id===allocation.lotId);
                if(matches.length>1 || matches.some(lot=>lot.poId!==poId || lot.kgIn!==allocation.kg
                  || !finite(lot.kgRemaining) || lot.kgRemaining<0 || lot.kgRemaining>allocation.kg)) fail('OEM 벌크 입고 로트가 변경되었습니다.');
                if(saved.appliedDeltaKg===0 && matches.length) fail('실사 이전 OEM 입고에 현재 로트가 생겼습니다.');
                // 소진·실사로 없는 로트는 원문을 보존하고 배치 원가만 확정한다. 재고를 되살리지 않는다.
                if(!matches.length) continue;
                if(stmtSnap.exists){if(hash(matches[0].oemBatchCost)!==hash(metadata))fail('기존 OEM 벌크 원가 근거가 변경되었습니다.');}
                else {pending[field]=lots.map(lot=>lot.id===allocation.lotId?{...lot,oemBatchCost:metadata}:lot);
                  costLotUpdates.set(snapshot.ref.path,{ref:snapshot.ref,patch:preserveInventoryWriterProtocol(data,pending)});}
              }
            }
            continue;
          }
          const product=products.find(product=>product.id===allocation.itemId);
          if(!product?.exists || !Array.isArray(product.data()!.lots)) fail('OEM 원가를 연결할 입고 로트가 없습니다.');
          const lotId=`lot-oem-${poId}-${allocation.itemId}`;
          const lots:Row[]=product!.data()!.lots;
          const matches=lots.filter(lot=>lot.id===lotId);
          if(matches.length!==1 || matches[0].poId!==poId || matches[0].kgIn!==allocation.kg)
            fail('OEM 원가의 입고 로트·원입고 kg가 다릅니다.');
          if(stmtSnap.exists){if(hash(matches[0].oemBatchCost)!==hash(metadata))fail('기존 OEM 로트 원가 근거가 변경되었습니다.');}
          else costLotUpdates.set(product!.ref.path,{ref:product!.ref,patch:preserveInventoryWriterProtocol(product!.data(),{lots:lots.map(lot=>lot.id===lotId?{...lot,oemBatchCost:metadata}:lot)})});
        }
      } else if(hash(stored)!==hash(preview)) fail('OEM 원가 미확인 근거가 변경되었습니다.');
    } else if(po.oemCostEvidence!==undefined) fail('과거 OEM 입고에는 원가 근거를 나중에 주입할 수 없습니다.');
    if (stmtSnap.exists) {
      const existing = stmtSnap.data()!;
      if (ownCompany(existing) !== companyId || existing.orderId !== poId || existing.type !== '매입'
        || existing.partnerId !== partnerId || existing.tradeDate !== date
        || typeof existing.docNo !== 'string' || !existing.docNo
        || hash({ ...business(existing), companyId }) !== hash(semantic)
        || (existing.issueOperationId && (existing.issueOperationId !== statementId || existing.issuePayloadHash !== payloadHash
          || existing.issueVoucherNo !== existing.docNo))) fail('기존 가공비 전표와 요청 내용이 다릅니다.');
      if (!po.linkedStatementId) {
        if (po.oemFeePerKg !== undefined && po.oemFeePerKg !== perKg) fail('기존 가공비 단가가 변경되었습니다.');
        tx.update(poRef, { linkedStatementId: statementId, oemFeePerKg: perKg, ...(batchCost ? {oemBatchCost:batchCost}: {}) });
      }
      else if ((existing.issueOperationId && po.oemFeePerKg !== perKg)
        || (po.oemFeePerKg !== undefined && po.oemFeePerKg !== perKg)) fail('기존 가공비 단가가 변경되었습니다.');
      if (feeSnap.exists && feeSnap.data()!.status === 'pending') tx.update(feeRef, { status: 'processed', processedAt: new Date().toISOString() });
      return statementId;
    }
    const sequence = await tx.get(counterRef);
    const state = await readVoucherCounter(db, tx, sequence, releaseSnap, companyId, date, '가공');
    if (state.companyId !== companyId || state.tradeDate !== date || state.prefix !== '가공'
      || !Number.isSafeInteger(state.last) || state.last < 0 || !Number.isSafeInteger(state.last + 1)) fail('가공비 전표 번호 카운터가 손상되었습니다.');
    const docNo = formatVoucherNo(date, state.last + 1, '가공');
    writeVoucherCounter(tx, sequence, state, state.last + 1);
    for(const update of costLotUpdates.values()) tx.update(update.ref,update.patch);
    tx.create(statementRef, { ...stmt, companyId, docNo, issueOperationId: statementId,
      issuePayloadHash: payloadHash, issueVoucherNo: docNo });
    tx.update(poRef, { linkedStatementId: statementId, oemFeePerKg: perKg, ...(batchCost ? {oemBatchCost:batchCost}: {}) });
    if (feeSnap.exists && feeSnap.data()!.status === 'pending') tx.update(feeRef, { status: 'processed', processedAt: new Date().toISOString() });
    return statementId;
  });
}

export const issueOemFeeVoucherCommand = onCall({ region: 'asia-northeast3' }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  const companyId = request.auth.token.companyId;
  if (!request.auth.token.isAdmin || (companyId !== 'taebaek' && companyId !== 'punghoe')) {
    throw new HttpsError('permission-denied', '관리자 회사 권한이 필요합니다.');
  }
  return issueOemFeeVoucher(admin.firestore(), companyId, request.data as Input);
});
