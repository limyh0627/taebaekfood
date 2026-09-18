import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, collection, query, where } from 'firebase/firestore';

/**
 * **회사별·메뉴별 권한을 규칙이 실제로 막는가.**
 *
 * 2026-09-16 코덱스 인수인계 · 사장님: "회사별 권한과 메뉴별 권한을 Firestore 규칙에서
 * 실제로 강제할 것. **화면 메뉴 숨김만으로 끝내면 안 된다.**"
 *
 * 화면에서 숨기는 것은 권한이 아니다 — 브라우저 콘솔에서 질의 한 줄이면 다 읽힌다.
 * 그래서 **규칙이 막는지**를 여기서 확인한다. 네 주체로 본다:
 *
 *     미로그인       아무것도 못 한다
 *     태백 직원      태백 현장 자료만. 풍회도, 돈·인사도 못 본다
 *     풍회 직원      풍회 현장 자료만
 *     태백 관리자     태백 것만 — **돈·인사까지. 그래도 풍회는 못 본다**
 *     풍회 관리자     풍회 것만
 *
 * **회사 경계는 관리자도 못 넘는다**(사장님) — 운영 계정이 회사마다 따로 있다
 * (`admin`·`admin-punghoe`). `isAdmin` 은 메뉴만 가른다.
 *
 * 시험 대상은 실제 배포 파일인 `firestore.rules`다.
 *
 * **에뮬레이터가 있어야 돈다.** `npm run emulators:local` 을 켜고 돌린다.
 * 안 켜져 있으면 이 파일은 통째로 건너뛴다(`describe.skipIf`) — 다른 시험까지 막지 않는다.
 */

const 에뮬있나 = async () => {
  try {
    const r = await fetch('http://127.0.0.1:8082/', { signal: AbortSignal.timeout(1500) });
    return r.status < 500;
  } catch { return false; }
};

const 켜짐 = await 에뮬있나();
let env: RulesTestEnvironment;

//  주체 넷 — claim 모양은 `functions/src/employeeLogin.ts` 가 발급하는 것 그대로다.
const 태백직원 = () => env.authenticatedContext('u-taebaek', { employeeId: 'e1', companyId: 'taebaek', isAdmin: false }).firestore();
const 풍회직원 = () => env.authenticatedContext('u-punghoe', { employeeId: 'e9', companyId: 'punghoe', isAdmin: false }).firestore();
const 관리자 = () => env.authenticatedContext('u-admin', { employeeId: 'admin', companyId: 'taebaek', isAdmin: true }).firestore();
const 풍회관리자 = () => env.authenticatedContext('u-admin-ph', { employeeId: 'admin-punghoe', companyId: 'punghoe', isAdmin: true }).firestore();
const 미로그인 = () => env.unauthenticatedContext().firestore();
//  익명 로그인 — Firebase 계정은 있지만 `employeeId` claim 이 없다. 예전에 이걸로 다 열렸다.
const 익명 = () => env.authenticatedContext('anon', {}).firestore();

describe.skipIf(!켜짐)('회사별·메뉴별 권한 (Firestore 규칙)', () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: 'demo-rules-test',
      firestore: { rules: readFileSync('firestore.rules', 'utf-8'), host: '127.0.0.1', port: 8082 },
    });
  });
  afterAll(async () => { await env?.cleanup(); });

  beforeEach(async () => {
    await env.clearFirestore();
    //  규칙을 끄고 밑자료를 깐다 — 시험하려는 건 **읽고 쓰는 쪽**이지 심는 쪽이 아니다.
    await env.withSecurityRulesDisabled(async ctx => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'orders', 'o-taebaek'), { companyId: 'taebaek', partnerName: '수카페' });
      await setDoc(doc(db, 'orders', 'o-punghoe'), { companyId: 'punghoe', partnerName: '풍회거래처' });
      await setDoc(doc(db, 'orders', 'o-없음'), { partnerName: '회사없는옛주문' });
      await setDoc(doc(db, 'items', 'i-taebaek'), { companyId: 'taebaek', name: '참기름' });
      await setDoc(doc(db, 'cashEntries', 'c-taebaek'), { companyId: 'taebaek', amount: 1000 });
      await setDoc(doc(db, 'issuedStatements', 's-taebaek'), { companyId: 'taebaek', totalAmount: 5000 });
      await setDoc(doc(db, 'employees', 'e1'), { companyId: 'taebaek', name: '이지영', fcmTokens: [] });
      await setDoc(doc(db, 'employees', 'e9'), { companyId: 'punghoe', name: '우용', fcmTokens: [] });
      await setDoc(doc(db, 'leaveRequests', 'lv-e1'), { companyId: 'taebaek', employeeId: 'e1', status: 'pending' });
      await setDoc(doc(db, 'leaveRequests', 'lv-e9'), { companyId: 'punghoe', employeeId: 'e9', status: 'pending' });
      await setDoc(doc(db, 'adjustmentRequests', 'adj-1'), { companyId: 'taebaek', itemId: 'i-taebaek', qty: 5, requestedBy: 'e1', status: 'pending' });
      //  오피스톡 — 방과 메시지, 알림
      await setDoc(doc(db, 'chatRooms', 'room-taebaek'), { companyId: 'taebaek', participantIds: ['e1'], participantCompanies: { e1: 'taebaek' } });
      await setDoc(doc(db, 'chatRooms', 'room-punghoe'), { companyId: 'punghoe', participantIds: ['e9'], participantCompanies: { e9: 'punghoe' } });
      await setDoc(doc(db, 'chatMessages', 'msg-1'), { companyId: 'taebaek', roomId: 'room-taebaek', senderId: 'e1' });
      await setDoc(doc(db, 'notifications', 'n-1'), { companyId: 'taebaek', targetId: 'e1', title: '개인 알림', readBy: [] });
      //  문서함 — 실제 컬렉션 이름이다(`fileCabinet` 이 아니다)
      await setDoc(doc(db, 'fileCabinetDocs', 'fc-1'), { companyId: 'taebaek', fileName: '원료수불부.xlsx' });
      await setDoc(doc(db, 'fileCabinetCategories', 'fcc-1'), { companyId: 'taebaek', name: '서류관리' });
      await setDoc(doc(db, 'fileCabinetSubCategories', 'fcs-1'), { companyId: 'taebaek', name: '원료수불부' });
    });
  });

  describe('미로그인·익명은 아무것도 못 한다', () => {
    it('미로그인은 못 읽는다', async () => {
      await assertFails(getDoc(doc(미로그인(), 'orders', 'o-taebaek')));
    });

    it('**익명 계정도 못 읽는다** — 예전엔 이걸로 다 열렸다', async () => {
      //  2026-09-16 규칙 강화 전에는 `request.auth != null` 만 봐서 익명이 통과했다.
      await assertFails(getDoc(doc(익명(), 'orders', 'o-taebaek')));
      await assertFails(setDoc(doc(익명(), 'orders', 'o-새것'), { companyId: 'taebaek' }));
    });
  });

  describe('회사 경계', () => {
    it('원자화 명령이 같은 회사의 아직 없는 작업 문서를 확인할 수 있다', async () => {
      const snap = await assertSucceeds(getDoc(doc(태백직원(), 'rawMaterialLedger', 'op-아직없음')));
      expect(snap.exists()).toBe(false);
    });

    it('로그인하지 않은 사용자는 없는 작업 문서도 확인할 수 없다', async () => {
      await assertFails(getDoc(doc(미로그인(), 'rawMaterialLedger', 'op-아직없음')));
    });

    it('태백 직원은 태백 것을 읽는다', async () => {
      await assertSucceeds(getDoc(doc(태백직원(), 'orders', 'o-taebaek')));
    });

    it('**태백 직원은 풍회 것을 못 읽는다**', async () => {
      await assertFails(getDoc(doc(태백직원(), 'orders', 'o-punghoe')));
    });

    it('**풍회 직원은 태백 것을 못 읽는다**', async () => {
      await assertFails(getDoc(doc(풍회직원(), 'orders', 'o-taebaek')));
      await assertFails(getDoc(doc(풍회직원(), 'items', 'i-taebaek')));
    });

    it('풍회 직원은 풍회 것을 읽는다', async () => {
      await assertSucceeds(getDoc(doc(풍회직원(), 'orders', 'o-punghoe')));
    });

    it('**남의 회사 것을 내 회사로 바꿔 가져올 수 없다**', async () => {
      //  쓸 때 들어오는 값만 보면, 풍회 문서를 태백으로 덮어써 제 것으로 만들 수 있다.
      await assertFails(updateDoc(doc(태백직원(), 'orders', 'o-punghoe'), { companyId: 'taebaek' }));
    });

    it('**내 회사 것을 남의 회사로 넘길 수 없다**', async () => {
      await assertFails(updateDoc(doc(태백직원(), 'orders', 'o-taebaek'), { companyId: 'punghoe' }));
    });

    it('태백 관리자는 태백 것을 읽는다', async () => {
      await assertSucceeds(getDoc(doc(관리자(), 'orders', 'o-taebaek')));
    });

    it('**태백 관리자도 풍회 것은 못 읽는다** — 회사 경계는 관리자도 못 넘는다', async () => {
      //  회사를 바꾸려면 그 회사 계정(`admin-punghoe`)으로 로그인한다.
      await assertFails(getDoc(doc(관리자(), 'orders', 'o-punghoe')));
    });

    it('풍회 관리자는 풍회 것을 읽는다', async () => {
      await assertSucceeds(getDoc(doc(풍회관리자(), 'orders', 'o-punghoe')));
      await assertFails(getDoc(doc(풍회관리자(), 'orders', 'o-taebaek')));
    });
  });

  describe('회사가 안 적힌 문서는 아무도 못 본다', () => {
    it('직원도 관리자도 못 읽는다 — 조용히 새느니 막는다', async () => {
      await assertFails(getDoc(doc(태백직원(), 'orders', 'o-없음')));
      await assertFails(getDoc(doc(관리자(), 'orders', 'o-없음')));
    });

    it('**회사를 안 붙이고는 못 만든다**', async () => {
      await assertFails(setDoc(doc(태백직원(), 'orders', 'o-새것'), { partnerName: '회사없음' }));
      await assertSucceeds(setDoc(doc(태백직원(), 'orders', 'o-새것2'), { companyId: 'taebaek', partnerName: '있음' }));
    });
  });

  describe('메뉴 경계 — 돈·인사는 관리자만', () => {
    it('생산판매일지는 관리자만 자기 회사값을 붙여 저장한다', async () => {
      await assertFails(setDoc(doc(태백직원(), 'productionSalesLogs', 'psl-직원'), { companyId: 'taebaek', date: '2026-09-17' }));
      await assertFails(setDoc(doc(관리자(), 'productionSalesLogs', 'psl-회사없음'), { date: '2026-09-17' }));
      await assertFails(setDoc(doc(관리자(), 'productionSalesLogs', 'psl-풍회'), { companyId: 'punghoe', date: '2026-09-17' }));
      await assertSucceeds(setDoc(doc(관리자(), 'productionSalesLogs', 'psl-태백'), { companyId: 'taebaek', date: '2026-09-17' }));
    });

    it('**일반 직원은 자금원장을 못 읽는다**', async () => {
      await assertFails(getDoc(doc(태백직원(), 'cashEntries', 'c-taebaek')));
    });

    it('**일반 직원은 전표를 못 읽는다**', async () => {
      await assertFails(getDoc(doc(태백직원(), 'issuedStatements', 's-taebaek')));
    });

    it('일반 직원은 전표를 못 만든다', async () => {
      await assertFails(setDoc(doc(태백직원(), 'issuedStatements', 's-새것'), { companyId: 'taebaek', totalAmount: 1 }));
    });

    it('관리자는 자금·전표를 읽고 쓴다', async () => {
      await assertSucceeds(getDoc(doc(관리자(), 'cashEntries', 'c-taebaek')));
      await assertSucceeds(setDoc(doc(관리자(), 'issuedStatements', 's-새것'), { companyId: 'taebaek', totalAmount: 1 }));
    });

    it('**태백 관리자는 풍회 전표를 못 만든다**', async () => {
      await assertFails(setDoc(doc(관리자(), 'issuedStatements', 's-풍회'), { companyId: 'punghoe', totalAmount: 1 }));
    });

    it('풍회 관리자는 풍회 전표를 만든다', async () => {
      await assertSucceeds(setDoc(doc(풍회관리자(), 'issuedStatements', 's-풍회'), { companyId: 'punghoe', totalAmount: 1 }));
    });

    it('현장 자료(주문·품목)는 일반 직원도 쓴다', async () => {
      await assertSucceeds(setDoc(doc(태백직원(), 'items', 'i-새것'), { companyId: 'taebaek', name: '들기름' }));
    });
  });

  describe('직원 문서', () => {
    it('같은 회사 직원은 서로 읽는다', async () => {
      await assertSucceeds(getDoc(doc(태백직원(), 'employees', 'e1')));
    });

    it('**다른 회사 직원은 못 읽는다**', async () => {
      await assertFails(getDoc(doc(태백직원(), 'employees', 'e9')));
    });

    it('본인은 **푸시 표만** 고친다', async () => {
      await assertSucceeds(updateDoc(doc(태백직원(), 'employees', 'e1'), { fcmTokens: ['t1'] }));
    });

    it('**본인이 자기를 관리자로 못 올린다**', async () => {
      await assertFails(updateDoc(doc(태백직원(), 'employees', 'e1'), { adminAccess: true }));
    });

    it('**남의 푸시 표도 못 고친다**', async () => {
      await assertFails(updateDoc(doc(태백직원(), 'employees', 'e9'), { fcmTokens: ['t1'] }));
    });

    it('직원을 만들거나 지우는 건 관리자만', async () => {
      await assertFails(setDoc(doc(태백직원(), 'employees', 'e-새것'), { companyId: 'taebaek', name: '새사람' }));
      await assertSucceeds(setDoc(doc(관리자(), 'employees', 'e-새것'), { companyId: 'taebaek', name: '새사람' }));
    });
  });

  describe('연차 — 본인이 내고 관리자가 결재한다', () => {
    it('본인 이름으로만 낸다', async () => {
      await assertSucceeds(setDoc(doc(태백직원(), 'leaveRequests', 'lv-새것'), { companyId: 'taebaek', employeeId: 'e1', status: 'pending' }));
    });

    it('**남의 이름으로 못 낸다**', async () => {
      await assertFails(setDoc(doc(태백직원(), 'leaveRequests', 'lv-남'), { companyId: 'taebaek', employeeId: 'e2', status: 'pending' }));
    });

    it('**본인이 자기 연차를 승인 못 한다**', async () => {
      await assertFails(updateDoc(doc(태백직원(), 'leaveRequests', 'lv-e1'), { status: 'approved' }));
    });

    it('관리자는 승인한다', async () => {
      await assertSucceeds(updateDoc(doc(관리자(), 'leaveRequests', 'lv-e1'), { status: 'approved', companyId: 'taebaek' }));
    });

    it('다른 회사 연차는 못 본다', async () => {
      await assertFails(getDoc(doc(태백직원(), 'leaveRequests', 'lv-e9')));
    });
  });

  describe('재고 조정 요청 — 직원이 올리고 관리자가 처리한다', () => {
    it('직원이 올린다', async () => {
      await assertSucceeds(setDoc(doc(태백직원(), 'adjustmentRequests', 'adj-새것'), { companyId: 'taebaek', itemId: 'i-taebaek', status: 'pending' }));
    });

    it('**직원이 스스로 승인 못 한다**', async () => {
      await assertFails(updateDoc(doc(태백직원(), 'adjustmentRequests', 'adj-1'), { status: 'approved' }));
    });

    it('관리자가 처리한다', async () => {
      await assertSucceeds(updateDoc(doc(관리자(), 'adjustmentRequests', 'adj-1'), { status: 'approved', companyId: 'taebaek' }));
    });
  });

  describe('문서함 — 실제 컬렉션 이름으로 잠근다', () => {
    //  2026-09-16 코덱스 검수 3번: 규칙이 `fileCabinet` 을 잠갔는데 실제 이름은 셋이다.
    //  이름이 틀리면 포괄 규칙으로 떨어져 **일반 직원에게 열린다.**
    it('**일반 직원은 문서함을 못 읽는다**', async () => {
      await assertFails(getDoc(doc(태백직원(), 'fileCabinetDocs', 'fc-1')));
      await assertFails(getDoc(doc(태백직원(), 'fileCabinetCategories', 'fcc-1')));
      await assertFails(getDoc(doc(태백직원(), 'fileCabinetSubCategories', 'fcs-1')));
    });

    it('관리자는 문서함을 읽고 쓴다', async () => {
      await assertSucceeds(getDoc(doc(관리자(), 'fileCabinetDocs', 'fc-1')));
      await assertSucceeds(setDoc(doc(관리자(), 'fileCabinetDocs', 'fc-2'), { companyId: 'taebaek', fileName: 'x.xlsx' }));
    });
  });

  describe('연차 — 본인이 고칠 수 있는 칸을 못 박는다', () => {
    //  2026-09-16 코덱스 검수 4번: `status` 만 보면 본인이 **남의 것으로 바꾸거나**
    //  회사를 옮기거나 날짜·일수를 마음대로 고칠 수 있다.
    it('**본인이 신청자를 남으로 못 바꾼다**', async () => {
      await assertFails(updateDoc(doc(태백직원(), 'leaveRequests', 'lv-e1'), { employeeId: 'e2' }));
    });

    it('**본인이 회사를 못 옮긴다**', async () => {
      await assertFails(updateDoc(doc(태백직원(), 'leaveRequests', 'lv-e1'), { companyId: 'punghoe' }));
    });

    it('본인은 날짜·사유만 고친다', async () => {
      await assertSucceeds(updateDoc(doc(태백직원(), 'leaveRequests', 'lv-e1'), { startDate: '2026-10-01', reason: '개인' }));
    });

    it('**본인이 결재 칸을 못 건드린다**', async () => {
      await assertFails(updateDoc(doc(태백직원(), 'leaveRequests', 'lv-e1'), { approvedBy: 'e1' }));
    });
  });

  describe('재고 조정 요청 — 직원이 고칠 수 있는 칸을 못 박는다', () => {
    it('**직원이 요청자를 못 바꾼다**', async () => {
      await assertFails(updateDoc(doc(태백직원(), 'adjustmentRequests', 'adj-1'), { requestedBy: 'e2' }));
    });

    it('**직원이 회사를 못 옮긴다**', async () => {
      await assertFails(updateDoc(doc(태백직원(), 'adjustmentRequests', 'adj-1'), { companyId: 'punghoe' }));
    });

    it('직원은 수량·사유만 고친다', async () => {
      await assertSucceeds(updateDoc(doc(태백직원(), 'adjustmentRequests', 'adj-1'), { qty: 9, reason: '파손' }));
    });

    it('**직원이 처리 칸을 못 건드린다**', async () => {
      await assertFails(updateDoc(doc(태백직원(), 'adjustmentRequests', 'adj-1'), { processedBy: 'e1' }));
    });
  });

  describe('오피스톡 — 메시지 회사는 방 회사여야 한다', () => {
    //  2026-09-16 코덱스 검수 5번: 회사 검사만으로는 **태백 방에 태백 메시지를 넣되
    //  방이 풍회인 경우**를 못 막는다. 방을 직접 읽어 견준다.
    it('같은 회사 방에 메시지를 넣는다', async () => {
      await assertSucceeds(setDoc(doc(태백직원(), 'chatMessages', 'msg-2'), { companyId: 'taebaek', roomId: 'room-taebaek', senderId: 'e1' }));
    });

    it('**방 회사와 다른 메시지는 막는다**', async () => {
      //  풍회 방에 태백 메시지를 넣으려는 시도 — 회사 검사만 있으면 통과해 버린다.
      await assertFails(setDoc(doc(태백직원(), 'chatMessages', 'msg-3'), { companyId: 'taebaek', roomId: 'room-punghoe', senderId: 'e1' }));
    });

    it('**없는 방에는 못 넣는다**', async () => {
      await assertFails(setDoc(doc(태백직원(), 'chatMessages', 'msg-4'), { companyId: 'taebaek', roomId: 'room-없음', senderId: 'e1' }));
    });

    it('같은 회사 사람끼리 방을 만든다', async () => {
      await assertSucceeds(setDoc(doc(태백직원(), 'chatRooms', 'room-새것2'), { companyId: 'taebaek', participantIds: ['e1'], participantCompanies: { e1: 'taebaek' } }));
    });

    it('기존 방에 같은 회사 멤버를 초대한다', async () => {
      await assertSucceeds(updateDoc(doc(태백직원(), 'chatRooms', 'room-taebaek'), {
        companyId: 'taebaek',
        participantIds: ['e1', 'e2'],
        participantCompanies: { e1: 'taebaek', e2: 'taebaek' },
      }));
    });

    it('**다른 회사 참여자 회사값이나 누락된 회사값을 쓰지 못한다**', async () => {
      await assertFails(setDoc(doc(태백직원(), 'chatRooms', 'room-섞임'), { companyId: 'taebaek', participantIds: ['e1', 'e9'], participantCompanies: { e1: 'taebaek', e9: 'punghoe' } }));
      await assertFails(setDoc(doc(태백직원(), 'chatRooms', 'room-누락'), { companyId: 'taebaek', participantIds: ['e1'] }));
    });

    it('**남의 회사 방은 만들지도 못한다**', async () => {
      await assertFails(setDoc(doc(태백직원(), 'chatRooms', 'room-풍회'), { companyId: 'punghoe', participantIds: ['e9'], participantCompanies: { e9: 'punghoe' } }));
    });
  });

  describe('알림 — 수신자 회사가 알림 회사여야 한다', () => {
    it('같은 회사 직원에게 보낸다', async () => {
      await assertSucceeds(setDoc(doc(태백직원(), 'notifications', 'n-2'), { companyId: 'taebaek', targetId: 'e1' }));
    });

    it('**다른 회사 직원에게 못 보낸다**', async () => {
      await assertFails(setDoc(doc(태백직원(), 'notifications', 'n-3'), { companyId: 'taebaek', targetId: 'e9' }));
    });

    it('**없는 직원에게 못 보낸다**', async () => {
      await assertFails(setDoc(doc(태백직원(), 'notifications', 'n-4'), { companyId: 'taebaek', targetId: 'e-없음' }));
    });

    it('targetId가 없으면 같은 회사 전체 알림으로 만든다', async () => {
      await assertSucceeds(setDoc(doc(태백직원(), 'notifications', 'n-방송'), {
        companyId: 'taebaek', title: '신규 주문', body: '주문이 등록되었습니다.', readBy: [],
      }));
    });

    it('확인 상태만 바꿀 수 있고 본문·수신자·회사는 못 바꾼다', async () => {
      const ref = doc(태백직원(), 'notifications', 'n-1');
      await assertSucceeds(updateDoc(ref, { readBy: ['e1'] }));
      await assertSucceeds(updateDoc(ref, { dismissedBy: ['e1'] }));
      await assertFails(updateDoc(ref, { title: '바꾼 알림' }));
      await assertFails(updateDoc(ref, { targetId: 'e9' }));
      await assertFails(updateDoc(ref, { companyId: 'punghoe' }));
    });
  });

  describe('목록 질의 — 규칙은 필터가 아니다', () => {
    it('**회사 조건 없이 훑으면 막힌다** — 앱이 조건을 붙여야 하는 까닭', async () => {
      await assertFails(getDocs(collection(태백직원(), 'orders')));
    });

    it('내 회사 조건을 붙이면 통한다', async () => {
      await assertSucceeds(getDocs(query(collection(태백직원(), 'orders'), where('companyId', '==', 'taebaek'))));
    });

    it('**남의 회사 조건을 붙이면 막힌다**', async () => {
      await assertFails(getDocs(query(collection(태백직원(), 'orders'), where('companyId', '==', 'punghoe'))));
    });

    it('**관리자도 자기 회사 조건이라야 훑는다**', async () => {
      await assertSucceeds(getDocs(query(collection(관리자(), 'orders'), where('companyId', '==', 'taebaek'))));
      await assertFails(getDocs(query(collection(관리자(), 'orders'), where('companyId', '==', 'punghoe'))));
    });
  });

  describe('지우기', () => {
    it('**남의 회사 것을 못 지운다**', async () => {
      await assertFails(deleteDoc(doc(태백직원(), 'orders', 'o-punghoe')));
    });

    it('내 회사 것은 지운다', async () => {
      await assertSucceeds(deleteDoc(doc(태백직원(), 'orders', 'o-taebaek')));
    });
  });
});

