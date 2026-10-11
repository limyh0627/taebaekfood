import {describe,expect,it} from 'vitest';
import {captureOemCostEvidence,validateAndMergeOemCostEvidence} from './oemCostEvidence';
import {oemIssueFingerprint,runOemIssueJob} from './oemIssueJob';
const time='2026-10-11T00:00:00Z';
const evidence=()=>captureOemCostEvidence('taebaek',[{rawItemId:'raw',kg:100,supplyAmount:'220000'}],'0',true,time).evidence!;
describe('OEM 직접 확인한 원가 근거',()=>{
 it('원가를 적지 않아도 기존 발주 입력을 유지한다',()=>{expect(captureOemCostEvidence('taebaek',[{rawItemId:'raw',kg:100,supplyAmount:''}],'',false,time)).toEqual({status:'empty'});});
 it('일부 입력은 저장 근거에 넣지 않고 미완성으로 표시한다',()=>{expect(captureOemCostEvidence('taebaek',[{rawItemId:'raw',kg:100,supplyAmount:'220000'}],'0',false,time)).toEqual({status:'incomplete'});});
 it('부자재0은 명시 확인해야 완성된다',()=>{expect(evidence()).toMatchObject({ownerCompanyId:'taebaek',rawMaterials:[{rawItemId:'raw',kg:100,supplyAmount:220000}],packaging:{confirmed:true,supplyAmount:0},capturedAt:time});});
 it('같은 원료 두 줄은 kg와 공급금액을 함께 합친다',()=>{const captured=captureOemCostEvidence('taebaek',[{rawItemId:'raw',kg:30,supplyAmount:'60000'},{rawItemId:'raw',kg:70,supplyAmount:'160000'}],'11000',true,time);expect(captured.evidence?.rawMaterials).toEqual([{rawItemId:'raw',kg:100,supplyAmount:220000}]);});
 it.each(['-1','1.1','Infinity','abc','9007199254740992'])('공급금액 %s는 완성 근거로 저장하지 않는다',supplyAmount=>{expect(captureOemCostEvidence('taebaek',[{rawItemId:'raw',kg:100,supplyAmount}],'0',true,time).status).toBe('incomplete');});
 it('회사나 출고kg가 다른 근거를 원료 작업 시작 전에 거절한다',async()=>{const ports={prepareDraft:async()=>{throw Error('호출하면 안 됨');}};await expect(runOemIssueJob({jobId:'job',companyId:'punghoe',partnerId:'oem',partnerName:'외주',sent:[{rawItemId:'raw',material:'들깨',kg:100}],date:'2026-10-11',oemCostEvidence:evidence()},ports as any)).rejects.toThrow('소유회사');expect(()=>validateAndMergeOemCostEvidence(evidence(),'taebaek',[{rawItemId:'raw',kg:99}])).toThrow('내보낼 원료');});
 it('동일 작업번호의 금액 변경은 fingerprint에 남는다',()=>{const base={jobId:'job',companyId:'taebaek' as const,partnerId:'oem',partnerName:'외주',sent:[{rawItemId:'raw',material:'들깨',kg:100}],date:'2026-10-11'};const first=oemIssueFingerprint({...base,oemCostEvidence:evidence()});const changed={...evidence(),packaging:{confirmed:true as const,supplyAmount:1000}};expect(oemIssueFingerprint({...base,oemCostEvidence:changed})).not.toBe(first);expect(oemIssueFingerprint(base)).not.toContain('oemCostEvidence');});
});
