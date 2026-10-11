import { commandHash, operationDocId, legacyOperationDocId, type RawInventoryCommand, type RawInventoryMovement } from './rawInventoryCore';
import { companyOf, type CompanyId, type RawMaterialEntry } from './types';
import { rawPressYieldKg } from './rawPressAttempt';
type LedgerRow = RawMaterialEntry & Partial<RawInventoryMovement>;
export type DerivedRawDocEntry = { date:string;received:number;used:number;note:string;type:'auto';createdAt?:string };
/** 확정 영수증만 판독한다. 손상·옛 미기록 값은 적용0이라고 추정하지 않는다. */
function receipt(row:LedgerRow,companyId:CompanyId):RawInventoryCommand|null {
 try {
  if(companyOf(row)!==companyId||typeof row.commandHash!=='string'||!row.commandHash.startsWith('v1_'))return null;
  const encoded=row.commandHash.slice(3).replaceAll('-','+').replaceAll('_','/');
  const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
  const command=JSON.parse(new TextDecoder().decode(bytes)) as RawInventoryCommand;
  if(!['consume-lot','consume','ledger-consume','receive','reverse'].includes(command.kind)
   ||commandHash(command)!==row.commandHash||command.companyId!==companyId||!command.rawItemId
   ||row.rawItemId!==command.rawItemId||row.operationId!==command.operationId||row.kind!==command.kind
   ||row.effectiveAt!==command.effectiveAt||!Number.isFinite(Date.parse(command.effectiveAt))
   ||!command.source||row.source?.type!==command.source.type||row.source?.id!==command.source.id
   ||![operationDocId(command.operationId),legacyOperationDocId(command.operationId)].includes(row.id))return null;
  if(command.kind==='reverse')return row.reversalOf===command.originalOperationId&&Number.isFinite(row.reportedDeltaKg)&&Number.isFinite(row.appliedDeltaKg)
   &&row.received===(row.reportedDeltaKg!>0?row.reportedDeltaKg:0)&&row.used===(row.reportedDeltaKg!<0?-row.reportedDeltaKg!:0)?command:null;
  if(command.kind!=='consume-lot'&&command.kind!=='consume'&&command.kind!=='ledger-consume'&&command.kind!=='receive')return null;
  const kg=command.kg,reported=rawPressYieldKg(kg,1)*(command.kind==='receive'?1:-1);
  if(!Number.isFinite(kg)||kg<=0||row.reportedDeltaKg!==reported||!Number.isFinite(row.appliedDeltaKg)
   ||(row.appliedDeltaKg!==0&&row.appliedDeltaKg!==reported)
   ||row.received!==(reported>0?reported:0)||row.used!==(reported<0?-reported:0))return null;
  return command;
 }catch{return null;}
}
/** 화면과 엑셀이 함께 쓰는 표시용 파생행. 저장·현재 재고·수율 규칙은 바꾸지 않는다. */
export function derivedRawDocEntries(material:string,companyId:CompanyId,entries:readonly LedgerRow[],yieldRules:Record<string,{product:string;rate:number}>):DerivedRawDocEntry[]{
 const sourceEntry=Object.entries(yieldRules).find(([,rule])=>rule.product===material);
 if(!sourceEntry)return [];
 const [sourceMaterial,{rate}]=sourceEntry;
 const own=entries.filter(row=>companyOf(row)===companyId),rows:DerivedRawDocEntry[]=[];
 for(const entry of own.filter(row=>row.material===sourceMaterial&&row.used>0&&row.type!=='auto'&&row.type!=='correction')){
  const original=receipt(entry,companyId);
  const validSource=original&&original.kind!=='receive'&&original.kind!=='reverse'&&original.source.type==='manual'&&original.source.id===original.operationId;
  if(validSource){
   if(entry.appliedDeltaKg===0)continue;
   const exact=own.filter(row=>row.operationId===`yield:${original.operationId}`);
   if(exact.length===1){const stored=receipt(exact[0],companyId);if(stored?.kind==='receive'&&stored.rawItemId!==original.rawItemId
    &&stored.source.type==='manual'&&stored.source.id===original.source.id&&stored.effectiveAt===original.effectiveAt)continue;}
   const reversed=own.some(row=>{const command=receipt(row,companyId);return command?.kind==='reverse'&&command.originalOperationId===original.operationId&&command.source.type==='reversal'&&command.source.id===original.operationId&&command.rawItemId===original.rawItemId&&row.reportedDeltaKg===-entry.reportedDeltaKg!&&row.appliedDeltaKg===-entry.appliedDeltaKg!;});
   if(reversed)continue;
  }
  const derivedKg=rawPressYieldKg(entry.used,rate);
  // 옛 연결번호 없는 자료에 한정해 기존 날짜·비고·수량 판정을 보존한다.
  if(own.some(row=>(!validSource||(!row.operationId&&!row.commandHash))&&row.material===material&&row.date===entry.date&&(row.note??'').startsWith(`${sourceMaterial} 압착`)&&Math.abs((row.received??0)-derivedKg)<0.005))continue;
  rows.push({date:entry.date,received:derivedKg,used:0,note:`${sourceMaterial} 압착 (수율 ${rate*100}%)`,type:'auto',createdAt:entry.createdAt});
 }
 return rows;
}
