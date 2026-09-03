import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

admin.initializeApp();
const db = admin.firestore();

// ─────────────────────────────────────────────────────────────────────────
// 거래처 홈페이지(taebaekfood-web) 계정 찾기 — 미인증 사용자가 호출.
// 이름+연락처(또는 +아이디) 역검색은 개인정보라 클라이언트에 users 조회를
// 열어줄 수 없으므로, 서버에서 본인 확인만 수행하고 최소 정보만 회신한다.
// 호출형(onCall) 함수는 실제 호출 시에만 과금되며 평소 비용은 0이다.
// ─────────────────────────────────────────────────────────────────────────

const REGION = 'asia-northeast3';

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
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);

    // 오늘이 해당 월의 마지막 날인지 확인
    const nextDay = new Date(kst);
    nextDay.setDate(kst.getDate() + 1);
    const isLastDay = nextDay.getDate() === 1;
    if (!isLastDay) return;

    const year = kst.getFullYear();
    const month = kst.getMonth() + 1;
    const yearMonth = `${year}-${String(month).padStart(2, '0')}`;

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
    const 회사별 = new Map<string, number>();
    for (const doc of itemsSnap.docs) {
      const data = doc.data();
      const stock: number = Number(data.stock) || 0;
      const cost: number = Number(data.cost) || 0;
      if (!stock || !cost) continue;
      //  회사가 안 붙은 옛 품목은 태백 것으로 본다(앱의 companyOf 와 같다)
      const co: string = data.companyId ?? 'taebaek';
      회사별.set(co, (회사별.get(co) ?? 0) + stock * cost);   // 음수도 그대로 더한다
    }
    //  회사를 안 쓰는 곳에서도 태백 스냅샷은 늘 서야 한다
    if (!회사별.has('taebaek')) 회사별.set('taebaek', 0);

    for (const [co, value] of 회사별) {
      //  문서 id 규칙은 앱의 invSnapDocId 와 같다 — 태백은 옛 문서 이름을 그대로 쓴다
      const id = co === 'taebaek' ? `inv-snap-${yearMonth}` : `inv-snap-${co}-${yearMonth}`;
      const ref = db.collection('inventorySnapshots').doc(id);
      if ((await ref.get()).exists) {
        console.log(`Snapshot ${id} already exists, skipping.`);
        continue;
      }
      await ref.set({ id, yearMonth, value: Math.round(value), companyId: co, recordedAt: new Date().toISOString() });
      console.log(`Inventory snapshot saved: ${id} = ${Math.round(value)}원`);
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
// 규칙은 앱과 같아야 해서 src/shared/autoVoucher.ts와 같은 판정을 여기 옮겨 적었다.
// (functions는 별도 빌드라 앱 소스를 import 못 한다. 고칠 땐 양쪽을 같이 고쳐야 한다.)
// ─────────────────────────────────────────────────────────────────────────
export const dailyAutoVoucher = onSchedule(
  { schedule: '0 22 * * *', timeZone: 'UTC', region: REGION },
  async () => {
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const y = kst.getUTCFullYear();
    const m = kst.getUTCMonth() + 1;
    const d = kst.getUTCDate();
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    const today = `${ym}-${String(d).padStart(2, '0')}`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();

    const tplSnap = await db.collection('fixedCostTemplates').get();
    let created = 0;

    for (const doc of tplSnap.docs) {
      const t = doc.data() as Record<string, any>;
      const id = doc.id;
      if (!t.autoIssue || !t.accountCode) continue;
      if (!(Number(t.amount) > 0)) continue;
      if (t.startYm && ym < t.startYm) continue;
      if (t.endYm && ym > t.endYm) continue;

      const day = Math.min(Math.max(Number(t.issueDay ?? 1), 1), lastDay);
      if (`${ym}-${String(day).padStart(2, '0')}` !== today) continue;

      // 갈래 하나로 정한다 — 출금·입금은 자금전표, 줄돈·받을돈·대체는 전표
      const dir: string = t.dir ?? (t.postMode === '분리' ? '줄돈' : '출금');
      const isCash = dir === '출금' || dir === '입금';
      // 비현금 갈래는 거래처가 있어야 자동으로 낼 수 있다 —
      // 거래처가 있으면 매입전표(상대변 251이 자동), 없으면 차·대를 직접 세워야 해서 손으로만.
      if (!isCash && !t.partnerId) {
        console.warn(`[autoVoucher] ${t.name}: 거래처 없는 대체는 자동 발행 안 함`);
        continue;
      }

      const key = `AUTO-${id}-${ym}`;
      const amount = Number(t.amount);

      if (!isCash) {
        const ref = db.collection('issuedStatements').doc(key);
        if ((await ref.get()).exists) continue;
        const exempt = !!t.taxExempt;
        const supply = exempt ? amount : Math.round(amount / 1.1);
        const tax = exempt ? 0 : amount - supply;
        /*
         * 문서번호 — **그날(YYMMDD) 쓰인 가장 큰 번호 + 1.**  `260901-001`
         *
         * 앱은 2026-08-21(커밋 1a421f5)에 이 규칙으로 바꿨는데 **여기만 안 바꿨다.**
         * 그래서 스케줄러가 만든 정기 전표만 옛 형식(`2026-09-0001`)으로 나온다.
         * 옛 방식은 '그 달 전표 개수 + 1'이라 —
         *   · 전표를 하나 지우면 개수가 줄어 **지워진 번호를 다시 쓴다.**
         *   · 실제로 `2026-08-0216` 이 두 전표에 붙어 있다.
         *
         * 위 주석대로 functions 는 앱 소스를 import 못 한다.
         * `shared/voucherStamp.ts` 의 `nextDocNo` 와 **같은 규칙을 손으로 옮겨 둔 것**이다.
         * 한쪽을 고치면 반드시 다른 쪽도 고쳐야 한다.
         */
        const dayHead = `${today.slice(2).replace(/-/g, '')}-`;
        const daySnap = await db.collection('issuedStatements').where('tradeDate', '==', today).get();
        let maxNo = 0;
        daySnap.forEach(doc => {
          const no = String(doc.data().docNo ?? '');
          if (!no.startsWith(dayHead)) return;
          const tail = no.slice(dayHead.length);
          if (/^[0-9]+$/.test(tail)) maxNo = Math.max(maxNo, Number(tail));
        });
        await ref.set({
          id: key,
          issuedAt: new Date().toISOString(),
          tradeDate: today,
          type: dir === '받을돈' ? '매출' : (t.partnerId ? '매입' : '비용'),
          partnerId: t.partnerId,
          partnerName: t.partnerName ?? '',
          orderId: key,
          docNo: `${dayHead}${String(maxNo + 1).padStart(3, '0')}`,
          totalSupply: supply,
          totalTax: tax,
          totalAmount: amount,
          items: [{
            name: t.name, spec: '', qty: 1, price: amount,
            supply, tax, total: amount,
            isTaxExempt: exempt,
            accountCode: t.accountCode,
          }],
        });
      } else {
        const ref = db.collection('cashEntries').doc(key);
        if ((await ref.get()).exists) continue;
        await ref.set({
          id: key,
          date: today,
          cashAccountId: '',
          dir,
          amount,
          accountCode: t.accountCode,
          ...(t.partnerId ? { partnerId: t.partnerId, partnerName: t.partnerName ?? '' } : {}),
          note: `정기 · ${t.name}${t.partnerName ? ` · ${t.partnerName}` : ''}`,
          createdAt: new Date().toISOString(),
        });
      }
      created++;
      console.log(`[autoVoucher] ${today} ${t.name} ${amount}원 (${dir})`);
    }
    console.log(`[autoVoucher] ${today} — ${created}건 발행`);
  }
);
