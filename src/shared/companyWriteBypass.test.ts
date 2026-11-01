import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const roots = ['src', 'components'];
const allowed = new Set([
  'src/shared/services/firebaseService.ts',
]);
const reviewedTransactionWriters = new Set([
  // 고정 회사·타입 ID를 읽어 검증하며 순서 전체를 한 TX로 저장한다. 실제 Rules SDK에서 부분 반영 거절을 확인한다.
  'src/features/items/infrastructure/taxonomyOrderWrites.ts',
  // 휴가 ACK 뒤 같은 회사 관리자에게 고정 알림을 보낸다. UID·회사와 기존 알림 원문을 TX에서 다시 확인한다.
  'src/features/hr/infrastructure/leaveRequestWrites.ts',
  // 주문·품목·원료 원본의 회사 일치를 확인하고 완료표에도 companyId를 남긴다.
  'src/features/admin/orderInventoryCancellation.ts',
  // appMeta 전 기기 잠금(회사 메타 예외)만 쓴다.
  'src/features/admin/AdminApp.tsx',
  // 쓰기 전 companyScopedWriteData를 통과한 배열만 트랜잭션에 넣는다.
  'src/features/statements/infrastructure/applyStatementWrites.ts',
  // 명령/상태 계약 자체에 companyId가 있고 서로 다르면 트랜잭션 전에 거부한다.
  'src/shared/services/rawInventoryJob.ts',
  'src/shared/services/rawInventoryService.ts',
  // 압착 양 품목·명령·state·job의 회사와 최초 UID를 대조하며 실제 Auth SDK의 타회사 거절을 검증했다.
  'src/shared/services/rawPressService.ts',
  // 실제 직원 Auth SDK에서 주문 세대·양쪽 원료 회사·UID를 검증하고 일괄 job/원장/상태를 한 TX로 쓴다.
  'src/shared/services/orderRawBatchService.ts',
  // 실제 직원 Auth SDK에서 원료 완료·주문 세대·기록 품목의 회사와 UID를 확인한 생산기록 TX만 허용한다.
  'src/shared/services/orderProductionRecordService.ts',
  // 실제 직원 Auth SDK의 회사·UID와 전체 품목 검증 후 batch/영수증을 동일 TX로 쓰며 타회사·분류 오류는 쓰기0이다.
  'src/shared/services/itemStockAddService.ts',
  // 캔·벌크의 companyId가 같은지 확인하고 회사가 박힌 rawInventories 열쇠만 쓴다.
  'src/shared/services/unpackService.ts',
  // 박스·낱개의 회사를 읽어 대조한 뒤 회사가 박힌 이동 기록과 두 품목을 한 거래로 쓴다.
  'src/shared/services/boxUnpackService.ts',
  // OEM 발주 초안은 회사와 fingerprint가 같은 작업번호일 때만 유지하고 새 문서에 companyId를 박는다.
  'src/features/admin/oemIssueJob.ts',
  // OEM 가공비 요청은 PO·입고 품목의 회사 확인 후 같은 트랜잭션에서 companyId와 함께 만든다.
  'src/features/admin/oemReceiptInventory.ts',
  // 가공비 전표와 OEM 카드 링크를 같은 회사 검증 후 한 트랜잭션에 넣는다.
  'src/features/admin/oemFeeStatement.ts',
  // 전표·연결 문서·사용자 claim의 회사 대조 후 거래처 정산 메타를 함께 쓴다.
  'src/shared/services/deleteIssuedStatementService.ts',
  // 회사별 작업순서 메타를 검증하며 workOrderItems 조회도 동일 회사로 한정한다.
  'src/shared/services/workOrderResetService.ts',
  // 생산 문서와 모든 행의 회사·부모·revision을 검사하고 동일 transaction으로 교체한다.
  // 실제 Auth SDK와 getAfter Rules에서 타회사/오래된 revision/독립 행 쓰기를 거부한다.
  'src/shared/services/productionWorkDocumentService.ts',
  // 새 환산표는 companyScopedWriteData와 원문 회사·품목 검증을 통과한다. 실제 회사별 Rules도 조회/등록/탈취 거절을 확인했다.
  'src/shared/services/itemPurchaseUnitService.ts',
  // 공유 원문의 회사·로그인 claim·방 참여를 같은 거래에서 확인하고 기존 원문을 덮지 않는다.
  'src/shared/services/sharedChatMessageService.ts',
  // 직원 claim과 최신 발주 원문 회사를 대조하고 확정 상태·시각만 같은 거래에서 갱신한다.
  'src/shared/services/confirmPendingPurchaseOrderService.ts',
]);
const audited=['src/shared/services/orgChartService.ts','src/shared/services/deliveryScheduleService.ts','src/shared/services/deliverySettingsService.ts','src/shared/services/purchaseOrderBatchService.ts'] as const;
function validBoundary(path:string,source:string):boolean{
  const file=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true);
  const fn=(name:string)=>file.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name)?.getText(file)??'';
  const has=(text:string,...parts:string[])=>parts.every(part=>text.includes(part));
  const allowedFunctions=path===audited[0]?['saveOrgChart']:path===audited[1]?['applyDeliverySchedule','cancelDeliverySchedule']:path===audited[2]?['applyDeliverySettings','cancelDeliverySettings']:['applyPurchaseOrderBatch','cancelPurchaseOrderBatch'];
  const writes:ts.CallExpression[]=[];const visit=(node:ts.Node)=>{if(ts.isCallExpression(node)&&/^(?:setDoc|addDoc|writeBatch|tx\.(?:set|update|delete|create))$/.test(node.expression.getText(file)))writes.push(node);ts.forEachChild(node,visit);};visit(file);
  if(!writes.length||writes.some(call=>{let parent:ts.Node|undefined=call;while(parent&&!ts.isFunctionDeclaration(parent))parent=parent.parent;return !parent||!allowedFunctions.includes((parent as ts.FunctionDeclaration).name?.text??'');}))return false;
  if(path===audited[0])return writes.length===1&&has(fn('capture'),'scope.isCurrent()','auth.currentUser !== user','withClaimCompany(\'settings\'','token.claims.companyId')&&has(fn('saveOrgChart'),'capture(scope)','await actor.ready()','withClaimCompany(\'settings\', payload','companySettingDocId(scope.companyId','await setDoc(ref, data');
  if(path===audited[1])return has(fn('owner'),'auth.currentUser !== user','user.uid !== request.actorUid','request.companyId !== companyId',"withClaimCompany('orders'",'token.claims.companyId')&&has(fn('applyDeliverySchedule'),'owner(scope, request)','await actor.ready()','captureInventoryWriterContext','runInventoryWriterTransaction','before?.companyId !== request.companyId','config.companyId !== request.companyId','tx.update(orderRef','tx.set(auditRef')&&has(fn('cancelDeliverySchedule'),'owner(scope, request)','await actor.ready()','runTransaction(store','actor.check()','tx.set(ref');
  if(path===audited[2])return has(fn('actor'),'auth.currentUser !== user','scope.companyId !== companyId','scope.actorUid !== uid',"withClaimCompany('settings'",'token.claims.companyId')&&has(fn('bound'),'request.companyId !== scope.companyId','request.actorUid !== scope.actorUid','actor(scope)')&&has(fn('applyDeliverySettings'),'bound(scope, request)','await owner.ready()','runTransaction(store','snapshot(current.exists(), current.data(), request.companyId)','order.data().companyId !== request.companyId','tx.set(settingsRef','tx.set(auditRef')&&has(fn('cancelDeliverySettings'),'bound(scope, request)','await owner.ready()','runTransaction(store','owner.check()','tx.set(ref');
  if(path===audited[3])return has(fn('actor'),'auth.currentUser === user','token.claims.companyId !== companyId','actorUid === uid')&&has(fn('bind'),'scope.companyId !== ref.companyId','scope.actorUid !== ref.actorUid')&&has(fn('applyPurchaseOrderBatch'),'bind(scope, reference)','await actor(scope)','captureInventoryWriterContext','runInventoryWriterTransaction','prepareCatalogOrderCommit','tx.set(target, prepared[index])','tx.set(receipt')&&has(fn('cancelPurchaseOrderBatch'),'bind(scope, reference)','await actor(scope)','runInventoryWriterTransaction','check()','tx.set(target');
  return false;
}
const rawWriter='src/shared/services/orderRawReversalTransaction.ts';
const rawFiles=[rawWriter,'src/features/admin/orderItemStock.ts','src/features/admin/orderRawInventory.ts','src/shared/rawHolder.ts','functions/src/shared/rawHolder.ts','src/shared/services/rawInventoryService.ts','functions/src/shared/rawInventoryPrepare.ts','functions/src/shared/rawInventoryCore.ts','functions/src/shared/rawPreparedWritePlan.ts','src/shared/orderInventoryGeneration.ts','firestore.rules'] as const;
function validRawReversal(sources:Record<string,string>):boolean{
  const src=(name:string)=>sources[name]??'';
  const file=(name:string)=>ts.createSourceFile(name,src(name),ts.ScriptTarget.Latest,true,name.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  const functionText=(name:string,fn:string)=>{const f=file(name);return f.statements.find((n):n is ts.FunctionDeclaration=>ts.isFunctionDeclaration(n)&&n.name?.text===fn)?.getText(f)??'';};
  const has=(text:string,...parts:string[])=>parts.every(part=>text.includes(part));
  const writer=functionText(rawWriter,'prepareOrderRawReversal'),authority=functionText(rawWriter,'assertLegacyReversalAuthority');
  const prepare=functionText('functions/src/shared/rawInventoryPrepare.ts','prepareRawCommand'),core=functionText('functions/src/shared/rawInventoryCore.ts','applyRawCommand'),plan=functionText('functions/src/shared/rawPreparedWritePlan.ts','buildPreparedRawWritePlan');
  const builder=functionText('src/features/admin/orderRawInventory.ts','buildOrderRawReversalPlan'),generation=src('src/shared/orderInventoryGeneration.ts');
  if(!has(src(rawWriter),"from './rawInventoryService'","from '../../../functions/src/shared/rawPreparedWritePlan'","from '../inventoryWriterProtocol'"))return false;
  if(!has(src('src/shared/services/rawInventoryService.ts'),"export { prepareRawCommand } from '../../../functions/src/shared/rawInventoryPrepare'"))return false;
  if(!has(src('src/shared/rawHolder.ts'),"rawLedgerKeys } from '../../functions/src/shared/rawHolder'"))return false;
  if(!has(src('functions/src/shared/rawHolder.ts'),'companyId: companyOf(holder), rawItemId: holder.id'))return false;
  if(!has(builder,'const companyId = companyOf(order)','companyOf(rawItem) !== companyId','...rawLedgerKeys(rawItem)',"source: { type: 'reversal', id: order.id }",'kind: \'reverse\', originalOperationId','companyId,source:'))return false;
  if(!has(prepare,"const actualCompany = itemData.companyId ?? 'taebaek'",'actualCompany !== command.companyId','status: \'rejected\'','const result = applyRawCommand({','state, command: resolvedCommand, existing, original, guard'))return false;
  if(!has(core,'state.companyId !== c.companyId || state.rawItemId !== c.rawItemId','original.companyId !== c.companyId || original.rawItemId !== c.rawItemId'))return false;
  if(!has(authority,'Object.prototype.hasOwnProperty.call(data,key)')||!has(src(rawWriter),"'fullEffectAuthority','orderManualCorrectionEffectAuthority'"))return false;
  if(!has(writer,"row.command.companyId!==plan.companyId","row.command.source.type!=='reversal'","row.command.source.id!==plan.source.id",'assertLegacyReversalAuthority(snap.data())',"origin.source?.type==='production'","origin.source?.type==='oem'&&origin.kind==='ledger-consume'",'origin.source.id!==plan.source.id','!origin.commandHash','c.originalOperationId',"result.status!=='applied'",'buildPreparedRawWritePlan(c,read,result,row.options)','virtual.get(c.rawItemId)','state:result.state','companyId:plan.companyId'))return false;
  if(writer.indexOf('assertLegacyReversalAuthority(snap.data())')>writer.indexOf('normalizeRawMovement(original.data()!)')||writer.indexOf("result.status!=='applied'")>writer.indexOf('buildPreparedRawWritePlan(c,read,result,row.options)'))return false;
  if(!has(plan,'state: () => stripRawWriteUndefined(result.state)','toLedgerDoc(result.movement, options.legacy)','guard: () => stripRawWriteUndefined(result.guard)','...result.state.activeLots','patch.stock = result.state.stockKg'))return false;
  const wf=file(rawWriter),calls:ts.CallExpression[]=[];const walk=(n:ts.Node)=>{if(ts.isCallExpression(n)&&/^tx\.(?:set|update|delete|create)$/.test(n.expression.getText(wf)))calls.push(n);ts.forEachChild(n,walk);};walk(wf);
  const sink=calls.map(c=>[c.expression.getText(wf),c.arguments[0]?.getText(wf),c.arguments[1]?.getText(wf)]);
  if(sink.length!==5)return false;
  for(const [method,ref,protect] of [['tx.set','p.read.movementRef','protectInventoryWriterPatch('],['tx.set','p.read.guardRef','protectInventoryWriterPatch('],['tx.set','p.read.stateRef','protectInventoryWriterPatch('],['tx.update','p.read.itemRef','protectItemInventoryPatch('],['tx.set','jobRef','protectInventoryWriterPatch(']])if(sink.filter(row=>row[0]===method&&row[1]===ref&&row[2]?.startsWith(protect)).length!==1)return false;
  const stateSink=calls.find(call=>call.expression.getText(wf)==='tx.set'&&call.arguments[0]?.getText(wf)==='p.read.stateRef');
  const protect=stateSink?.arguments[1];
  if(!protect||!ts.isCallExpression(protect)||protect.expression.getText(wf)!=='protectInventoryWriterPatch'||protect.arguments[0]?.getText(wf)!=='first.stateSnap.exists()?first.stateSnap.data():undefined')return false;
  const statePayload=protect.arguments[1];if(!statePayload||!ts.isObjectLiteralExpression(statePayload)||statePayload.properties.length!==2)return false;
  if(!statePayload.properties.every(ts.isSpreadAssignment)||statePayload.properties[0].expression.getText(wf)!=='first.stateSnap.data()'||statePayload.properties[1].expression.getText(wf)!=='p.state')return false;
  if(!writer.includes('const first=reads.find((_,i)=>plan.commands[i].command.rawItemId===id)!'))return false;
  if(/\b(?:runTransaction|runInventoryWriterTransaction|executeRawInventoryCommand)\s*\(/.test(writer))return false;
  const caller=src('src/features/admin/orderItemStock.ts');
  if(!has(caller,"import {prepareOrderRawReversal} from '../../shared/services/orderRawReversalTransaction'",'const applyItemStockDeltas = async','orderMutation.expectedOrderText','orderRawBatchOrderEvidence(order)','assertActor(generation)','assertOrderInventoryGeneration(order,generation)','snapshots.some(snapshot=>snapshot.data()?.companyId!==generation.companyId)','assertReservationExecution(reservation','const rawPrepared=fixedRawReversal?await prepareOrderRawReversal(tx,db,fixedRawReversal','await prepareCatalogOrderCommit(db,tx,current.order.id,current.order,patch)','rawPrepared?.write()'))return false;
  if(!(caller.indexOf('assertReservationExecution(reservation',caller.indexOf('const applyItemStockDeltas = async'))<caller.indexOf('const rawPrepared=fixedRawReversal')&&caller.indexOf('await prepareCatalogOrderCommit(db,tx,current.order.id,current.order,patch)')<caller.indexOf('rawPrepared?.write()')))return false;
  const callerFile=file('src/features/admin/orderItemStock.ts');let owner:ts.VariableDeclaration|undefined;const ownerWalk=(n:ts.Node)=>{if(ts.isVariableDeclaration(n)&&n.name.getText(callerFile)==='applyItemStockDeltas')owner=n;ts.forEachChild(n,ownerWalk);};ownerWalk(callerFile);if(!owner?.initializer)return false;
  let transaction:ts.CallExpression|undefined;const txWalk=(n:ts.Node)=>{if(ts.isCallExpression(n)&&n.expression.getText(callerFile)==='runInventoryWriterTransaction'&&n.getText(callerFile).includes('const rawPrepared=fixedRawReversal'))transaction=n;ts.forEachChild(n,txWalk);};txWalk(owner.initializer);
  if(!transaction||!ts.isArrowFunction(transaction.arguments[2]))return false;const callback=transaction.arguments[2].body.getText(callerFile);
  if(!has(callback,'assertReservationExecution(reservation','const rawPrepared=fixedRawReversal?await prepareOrderRawReversal','await prepareCatalogOrderCommit(db,tx,current.order.id,current.order,patch)','rawPrepared?.write()'))return false;
  if(!has(generation,'companyId:order.companyId!','sameOrderInventoryGeneration(generationFromOrder(order),generation)'))return false;
  const rules=src('firestore.rules');if(!has(rules,'match /{collection}/{document=**}','&& createUpdateOk()','&& rawWriterOk(collection)','&& fullEffectWriteOk(collection)'))return false;
  const count=roots.flatMap(sourceFiles).flatMap(path=>{const content=sources[path]??readFileSync(path,'utf8'),f=ts.createSourceFile(path,content,ts.ScriptTarget.Latest,true,path.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS),out:string[]=[],names=new Set(['prepareOrderRawReversal']);for(const statement of f.statements)if(ts.isImportDeclaration(statement)&&statement.importClause?.namedBindings&&ts.isNamedImports(statement.importClause.namedBindings))for(const entry of statement.importClause.namedBindings.elements)if((entry.propertyName?.text??entry.name.text)==='prepareOrderRawReversal')names.add(entry.name.text);const visit=(n:ts.Node)=>{if(ts.isCallExpression(n)&&names.has(n.expression.getText(f)))out.push(path);ts.forEachChild(n,visit);};visit(f);return out;});
  return count.length===1&&count[0]==='src/features/admin/orderItemStock.ts';
}
const readRawSources=()=>Object.fromEntries(rawFiles.map(path=>[path,readFileSync(path,'utf8')]));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name).replaceAll('\\', '/');
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(path) && !/\.test\.(ts|tsx)$/.test(path) ? [path] : [];
  });
}

describe('회사 쓰기 공통 경계 우회 방지', () => {
  it('화면 코드는 Firestore 생성·set·batch API를 직접 가져오지 않는다', () => {
    const offenders = roots.flatMap(sourceFiles).filter(path => {
      if (allowed.has(path)) return false;
      const source = readFileSync(path, 'utf8');
      if(path===rawWriter)return !validRawReversal(readRawSources());
      if(audited.includes(path as typeof audited[number]))return !validBoundary(path,source);
      const firestoreImports = [...source.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*['"]firebase\/firestore['"]/g)]
        .map(match => match[1]);
      const staticBypass = firestoreImports.some(names => /\b(addDoc|setDoc|writeBatch)\b/.test(names));
      const dynamicBypass = /import\(['"]firebase\/firestore['"]\)[\s\S]{0,300}\b(addDoc|setDoc|writeBatch)\b/.test(source);
      const transactionBypass = /\b(?:tx|transaction)\.set\s*\(/.test(source)
        && !reviewedTransactionWriters.has(path);
      return staticBypass || dynamicBypass || transactionBypass;
    });

    expect(offenders, '신규 업무문서는 firebaseService의 회사 경계를 통과해야 합니다').toEqual([]);
  });
  it.each(audited)('%s 예외는 실제 계정·회사 검증과 쓰기 연결이 있어야 한다',path=>{
    const source=readFileSync(path,'utf8');expect(validBoundary(path,source)).toBe(true);
    const guard=path===audited[3]?'token.claims.companyId !== companyId':'token.claims.companyId';
    expect(validBoundary(path,source.replace(guard,'undefined'))).toBe(false);
    expect(validBoundary(path,source+'\nfunction unauthorized(tx: any) { tx.set(ref, value); }')).toBe(false);
  });
  it('원료 역처리는 회사·원본·검증된 결과가 같은 트랜잭션 쓰기로 연결된다',()=>{
    const sources=readRawSources();expect(validRawReversal(sources)).toBe(true);
    const mutants:[string,string,string][]=[
      [rawWriter,'row.command.companyId!==plan.companyId','false'],
      ['functions/src/shared/rawInventoryPrepare.ts','actualCompany !== command.companyId','false'],
      ['functions/src/shared/rawInventoryCore.ts','original.companyId !== c.companyId || original.rawItemId !== c.rawItemId','false'],
      [rawWriter,'companyId:plan.companyId','companyId:foreignCompany'],
      [rawWriter,'buildPreparedRawWritePlan(c,read,result,row.options)','buildPreparedRawWritePlan(c,read,unvalidated,row.options)'],
      [rawWriter,"result.status!=='applied'",'false'],
      [rawWriter,'assertLegacyReversalAuthority(snap.data())','void snap.data()'],
      [rawWriter,'{...first.stateSnap.data(),...p.state}','{...p.state}'],
      [rawWriter,'tx.set(jobRef,','tx.set(extraRef, {});tx.set(jobRef,'],
      ['src/features/admin/orderItemStock.ts','const applyItemStockDeltas = async','const unrelated = () => prepareOrderRawReversal(tx,db,plan,ids);\n  const applyItemStockDeltas = async'],
    ];
    for(const [path,before,after] of mutants){expect(sources[path]).toContain(before);expect(validRawReversal({...sources,[path]:sources[path].replace(before,after)}),path+' '+before).toBe(false);}
  });
});
