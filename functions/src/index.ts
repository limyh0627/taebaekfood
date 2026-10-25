import {handleNewOrderNotification,handleChatMessageNotification} from './pushNotifications';
import { onSchedule } from 'firebase-functions/v2/scheduler';
export {submitOrderCopyCommand,listOrderInterpretationRulesCommand,reviewOrderInterpretationRuleCommand} from './orderCopyCommands';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { valueInventory } from './shared/inventoryValuation';
import { kstDateOf } from './shared/calculation';
import { assertReleaseActive, releaseGateRef } from './releaseGate';

admin.initializeApp();
const db = admin.firestore();

// ─────────────────────────────────────────────────────────────────────────
// 거래처 홈페이지(taebaekfood-web) 계정 찾기 — 미인증 사용자가 호출.
// 이름+연락처(또는 +아이디) 역검색은 개인정보라 클라이언트에 users 조회를
// 열어줄 수 없으므로, 서버에서 본인 확인만 수행하고 최소 정보만 회신한다.
// 호출형(onCall) 함수는 실제 호출 시에만 과금되며 평소 비용은 0이다.
// ─────────────────────────────────────────────────────────────────────────

const REGION = 'asia-northeast3';

//  **말로 온 주문을 읽어 표로 옮긴다** — 복사주문의 'AI로 다시 읽기'(2026-09-15 사장님).
//  열쇠를 앱에 두면 브라우저에서 그대로 보이므로 서버에만 둔다. 자세한 것은 그 파일에.
export { extractOrder } from './extractOrder';
export { employeeLogin } from './employeeLogin';
export { editIssuedStatementCommand } from './editIssuedStatementCommand';
export { issueNumberedVoucher } from './voucherIssue';
export { issueTradeStatementCommand } from './tradeStatementIssue';
export { issueOemFeeVoucherCommand } from './oemFeeVoucher';
export { receiveOemFinishedGoodsCommand } from './oemReceiptCommand';
export { rawManualCorrectionCommand } from './rawManualCorrectionCommand';
export { recordPartnerPaymentCommand, partnerPaymentRecoveryCommand } from './partnerPaymentCommand';
export { recordLoanMovementCommand } from './loanMovementCommand';
export { mutateManualSettlementCommand } from './manualSettlementCommand';
export { processGeneralStockReturnCommand } from './processReturnCommand';
export { savePayrollDraftCommand, issuePayrollVoucherCommand } from './payrollVoucher';
export { retirementBenefitCommand } from './retirementBenefitCommand';
import { issueScheduledVoucher } from './autoVoucherCommand';

// 아이디 찾기: 이름 + 연락처가 일치하는 계정의 username 반환
export const findUsername = onCall({ region: REGION }, async (request) => {
  const name = String(request.data?.name ?? '').trim();
  const phone = String(request.data?.phone ?? '').trim();
  if (!name || !phone) {
    throw new HttpsError('invalid-argument', '이름과 연락처를 입력해주세요.');
  }

  const snap = await db
    .collection('users')
    .where('name', '==', name)
    .where('phone', '==', phone)
    .limit(1)
    .get();

  if (snap.empty) return { username: null };
  return { username: (snap.docs[0].data().username as string) ?? null };
});

// 비밀번호 재설정: 아이디 + 이름 + 연락처로 본인 확인 후, 재설정 메일 발송용 이메일 회신
// (클라이언트가 회신받은 이메일로 sendPasswordResetEmail 호출 — 3요소 검증 통과 후에만 노출)
export const requestPasswordReset = onCall({ region: REGION }, async (request) => {
  const username = String(request.data?.username ?? '').trim();
  const name = String(request.data?.name ?? '').trim();
  const phone = String(request.data?.phone ?? '').trim();
  if (!username || !name || !phone) {
    throw new HttpsError('invalid-argument', '아이디·이름·연락처를 모두 입력해주세요.');
  }

  const snap = await db
    .collection('users')
    .where('username', '==', username)
    .where('name', '==', name)
    .where('phone', '==', phone)
    .limit(1)
    .get();

  if (snap.empty) {
    throw new HttpsError('not-found', '입력하신 정보와 일치하는 계정이 없습니다.');
  }

  const email = snap.docs[0].data().email as string | undefined;
  if (!email) {
    throw new HttpsError('failed-precondition', '해당 계정에 등록된 이메일이 없습니다.');
  }
  return { email };
});

// 매일 23:00 KST(= 14:00 UTC) 실행 → 해당 월의 마지막 날인지 체크 후 기말재고 스냅샷 저장
export const monthlyInventorySnapshot = onSchedule(
  {
    schedule: '0 14 * * *',
    timeZone: 'Asia/Seoul',
    region: 'asia-northeast3',
  },
  async () => {
    const now = new Date();
    const date = kstDateOf(now);
    const nextDay = new Date(date + 'T00:00:00Z');
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    if (nextDay.getUTCDate() !== 1) return;
    const startingRelease = await releaseGateRef(db).get();
    const releaseId = startingRelease.data()?.releaseId;
    assertReleaseActive(startingRelease, releaseId);

    const yearMonth = date.slice(0, 7);

    //  이미 있는지는 **회사마다 따로** 본다(아래 루프).
    //  전에는 태백 문서 하나만 보고 통째로 빠져나가서, 태백이 있으면 풍회는 영영 안 생겼다.

    /*
     * **재고 평가는 앱(ProfitAnalysis 재고평가 탭)과 같은 규칙이어야 한다.**
     * 이 값이 `journalizeInventory` 를 타고 매출원가로 흘러가므로,
     * 앱에서 본 숫자와 장부의 숫자가 다르면 어디가 맞는지 아무도 못 가린다.
     * 2026-09-03 에 재 보니 **1,050만원** 갈려 있었다. 규칙 셋 중 둘이 달랐다.
     *
     *   ① 회사    앱은 태백/풍회를 가르는데 여기는 안 갈랐다 → 풍회 재고 566만원이
     *              태백 재고자산에 얹혔다. 실지재고조사법이라 양쪽이 같이 틀어진다.
     *   ② 음수    앱은 넣는데 여기는 `stock > 0` 으로 뺐다 → 483만원. 어긋난 재고를
     *              감추면 장부만 맞아 보이고 창고는 안 맞는다.
     *   ③ 단가    `item.cost` 를 쓴다 — **이건 앱과 같다.** 앱이 BOM 롤업 결과를
     *              `recomputeAllCosts` 로 이 칸에 되써 두기 때문이다(차이 37원).
     *              BOM 롤업을 여기 또 옮겨 적으면 갈릴 자리만 하나 더 는다.
     */
    const itemsSnap = await db.collection('items').get();
    const 회사별 = valueInventory(itemsSnap.docs.map(doc => ({ ...doc.data(), id: doc.id })), yearMonth);

    for (const { companyId: co, value } of 회사별) {
      //  문서 id 규칙은 앱의 invSnapDocId 와 같다 — 태백은 옛 문서 이름을 그대로 쓴다
      const id = co === 'taebaek' ? `inv-snap-${yearMonth}` : `inv-snap-${co}-${yearMonth}`;
      const ref = db.collection('inventorySnapshots').doc(id);
      const created = await db.runTransaction(async tx => {
        const releaseSnap = await tx.get(releaseGateRef(db));
        assertReleaseActive(releaseSnap, releaseId);
        if ((await tx.get(ref)).exists) return false;
        tx.create(ref, { id, yearMonth, value, companyId: co, recordedAt: new Date().toISOString() });
        return true;
      });
      if (!created) {
        console.log(`Snapshot ${id} already exists, skipping.`);
        continue;
      }
      console.log(`Inventory snapshot saved: ${id} = ${value}원`);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────
// 정기 전표 자동 발행 — 매일 07:00 KST(= 22:00 UTC 전날) 실행.
//
// 템플릿에 발행일(issueDay)을 정해 두면 그날 전표가 저절로 생긴다. 앱을 안 켜도 된다.
//   합침  출금 자금전표 하나          (차) 비용 / (대) 보통예금
//   분리  매입전표로 채무만 세운다     (차) 비용 / (대) 외상매입금 → 지불은 사람이 따로
//
// **금액이 정해진 것만** 나간다(amount > 0). 매달 다른 전기세를 자동으로 만들면
// 틀린 숫자가 장부에 남는다 — 그런 건 템플릿만 두고 손으로 발행한다.
//
// 발행조건·금액·세액·초안은 autoVoucherDraft 계약 시험으로 앱과 대조하고,
// 번호와 저장은 앱 발행과 같은 issueVoucher transaction을 쓴다.
// ─────────────────────────────────────────────────────────────────────────
export const dailyAutoVoucher = onSchedule(
  { schedule: '0 22 * * *', timeZone: 'UTC', region: REGION },
  async () => {
    const releaseSnap = await releaseGateRef(db).get();
    const releaseId = releaseSnap.data()?.releaseId;
    assertReleaseActive(releaseSnap, releaseId);
    const today = kstDateOf(new Date());
    const ym = today.slice(0, 7);
    const tplSnap = await db.collection('fixedCostTemplates').get();
    let processed = 0;
    for (const doc of tplSnap.docs) {
      const template: Parameters<typeof issueScheduledVoucher>[1] = { ...doc.data(), id: doc.id };
      try {
        const outcome = await issueScheduledVoucher(db, template, ym, today, releaseId);
        if ('skip' in outcome) {
          if (template.autoIssue && outcome.skip !== '발행일 아님') console.warn(`[autoVoucher] ${doc.id}: ${outcome.skip}`);
          continue;
        }
        processed++;
        console.log(`[autoVoucher] ${today} ${doc.id}: ${outcome.result.docNo}`);
      } catch (error) {
        console.error(`[autoVoucher] ${today} ${doc.id}: 발행 실패`, error);
      }
    }
    console.log(`[autoVoucher] ${today} — ${processed}건 처리`);
  }
);

// ─────────────────────────────────────────────────────────────────────────
// 새 주문 푸시 알림 — 앱을 완전히 닫아도 온다.
//
// 화면 안의 알림(shared/newOrderAlert)은 앱이 살아 있을 때만 만든다. 최근앱에서
// 밀어 닫으면 코드가 안 돌아 알릴 방법이 없다. 그래서 **서버가 폰으로 직접 민다.**
//
// 규칙 —
//   · **알림을 켠 사람에게** (employees.fcmTokens 가 있는 사람 = 본인이 직접 켠 사람)
//   · **넣은 사람 빼고** (내가 넣고 내가 알림받을 일은 없다)
//   · 표(token)가 죽었으면 지운다 — 안 지우면 계속 쌓여 발송이 느려진다
// ─────────────────────────────────────────────────────────────────────────
export const notifyNewOrder = onDocumentCreated(
  { region: REGION, document: 'orders/{orderId}' },
  event => handleNewOrderNotification({db,messaging:admin.messaging(),log:console.log},event),
);

export const notifyChatMessage = onDocumentCreated(
  { region: REGION, document: 'chatMessages/{msgId}' },
  event => handleChatMessageNotification({db,messaging:admin.messaging(),log:console.log},event),
);

export { deleteIssuedStatementCommand } from './deleteIssuedStatementCommand';

export { cashMutationCommand, prepareTransferCashEditCommand } from './cashMutationCommand';
export { replaceManualSettlementBatchCommand } from './manualSettlementBatchCommand';

export { prepareInterCompanyTransferCommand } from './interCompanyTransferPreparation';

export { recordInterCompanyTransferCommand } from './interCompanyTransferCommand';

export { preparePartnerAdvanceCommand, applyPartnerAdvanceCommand, cancelPartnerAdvanceCommand } from './partnerAdvanceCommand';
export { financialOpeningCommand } from './financialOpeningCommand';
export { createOpeningInventoryCommand } from './inventoryOpeningCommand';
export { submitReturnRequestCommand } from './submitReturnRequestCommand';
export { updatePendingReturnQuantityCommand } from './updatePendingReturnQuantityCommand';
export { cancelPendingReturnCommand } from './cancelPendingReturnCommand';
export { recordTaxIssueCommand } from './taxIssueCommand';

export { recoverOrderInventoryLockCommand } from './orderLockRecovery';
export { retireOrderRequestCommand, claimRetiredOrderInventoryOperationCommand } from './orderRequestRetirement';
export { inspectTradeStatementCommand } from './inspectTradeStatementCommand';

export { cancelTradeStatementCommand } from './cancelTradeStatementCommand';

export { partnerItemCleanupCommand } from './partnerItemCleanupCommand';
export { askHelp } from './helpChat';

export { catalogItemMergeCommand } from './catalogItemMergeCommand';
export { catalogOrderReferenceProof } from './catalogOrderReferenceProof';

export { leaveRequestCommand } from './leaveRequestCommand';

export {orderEditCommand} from './orderEditCommand';
export {itemEditorCommand} from './itemEditorCommand';
export {employeeEditCommand} from './employeeEditCommand';
export {partnerItemTermsCommand} from './partnerItemTermsCommand';
export {directoryDeleteCommand} from './directoryDeleteCommand';
export {quotationCommand} from './quotationCommand';

export {accountManagementCommand} from './accountManagementCommand';

export {documentMetadataCommand,cleanupLateDocumentUpload} from './documentMetadataCommand';

export {documentCategoryCommand} from './documentCategoryCommand';

export {companyInfoCommand} from './companyInfoCommand';

export {noticeCommand,cleanupLateNoticeUpload} from './noticeCommand';
export { partnerAdvanceRecoveryCommand } from './partnerAdvanceCommand';
export { workOrderCommand } from './workOrderCommand';
export { productionRecordCommand } from './productionRecordCommand';

export { partnerEditCommand } from './partnerEditCommand';
export { palletTransactionCommand } from './palletTransactionCommand';
