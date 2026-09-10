/**
 * **알림 시험 — 새 주문 알림을 골라서 보낸다.**
 *
 * 2026-09-09 사장님: "태백식품 계정에 알람 3개만 보내봐 새주문으로".
 *
 * 서버가 보내는 것과 **똑같은 모양**으로 쏜다(`functions/src/index.ts` 의 `notifyNewOrder`).
 * 특히 `tag` 를 `new-order:{번호}` 로 다르게 줘서 **세 개가 따로 쌓이는지**를 본다 —
 * 전에는 다 `'new-order'` 라 뒤엣것이 앞엣것을 덮었다.
 *
 * ── 쓰기 전에 ──────────────────────────────────────────────────────────────
 * 푸시를 **보내는 건 관리자 권한**이 필요하다. 앱 스크립트들이 쓰는 익명 인증으로는 안 된다.
 *
 *   Firebase 콘솔 → ⚙ 프로젝트 설정 → 서비스 계정 → [새 비공개 키 생성]
 *   받은 .json 을 `scripts/serviceAccountKey.json` 으로 둔다 (이미 .gitignore 에 있다)
 *
 * ── 쓰는 법 ────────────────────────────────────────────────────────────────
 *   npx tsx scripts/send-test-push.mts                 태백식품에게 3개
 *   npx tsx scripts/send-test-push.mts 이은경           그 사람에게 3개
 *   npx tsx scripts/send-test-push.mts 태백식품 1        1개만
 *
 * 시험이 끝나면 이 파일과 키는 지워도 된다.
 */
import { readFileSync, existsSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

const KEY = 'scripts/serviceAccountKey.json';
if (!existsSync(KEY)) {
  console.error(`${KEY} 가 없다.\n`
    + `Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → [새 비공개 키 생성] 으로 받아서 그 자리에 둬라.`);
  process.exit(1);
}

const 누구 = process.argv[2] ?? '태백식품';
const 몇개 = Number(process.argv[3] ?? 3);

initializeApp({ credential: cert(JSON.parse(readFileSync(KEY, 'utf8'))) });
const db = getFirestore();

const snap = await db.collection('employees').get();
const 사람 = snap.docs.find(d => d.id === 누구 || (d.data().name ?? '') === 누구);
if (!사람) {
  console.error(`'${누구}' 를 못 찾았다. 있는 사람: ${snap.docs.map(d => d.data().name ?? d.id).join(', ')}`);
  process.exit(1);
}

const tokens: string[] = (사람.data().fcmTokens ?? []).filter(Boolean);
console.log(`${사람.data().name ?? 사람.id} — 폰 ${tokens.length}대`);
if (tokens.length === 0) {
  console.error(`이 사람은 푸시 표가 없다. 폰에서 마이페이지 → '폰 알림 켜기' 를 먼저 눌러야 한다.`);
  process.exit(1);
}

const 거래처 = ['알림시험 하나', '알림시험 둘', '알림시험 셋'];
for (let i = 0; i < 몇개; i++) {
  //  서버와 같은 모양 — data 만 보내고 띄우는 건 firebase-messaging-sw.js 가 한다
  const res = await getMessaging().sendEachForMulticast({
    tokens,
    data: {
      title: '🧾 신규 주문',
      body: `${거래처[i % 거래처.length]} 주문이 들어왔습니다.`,
      //  **하나하나 다른 tag** — 이게 이번 시험의 요점이다
      tag: `new-order:test-${Date.now()}-${i}`,
      view: 'orders',
    },
    android: { priority: 'high' },
    webpush: { headers: { Urgency: 'high' } },
  });
  const 실패 = res.responses
    .map((r, k) => (r.success ? null : `${tokens[k].slice(0, 12)}… ${(r.error as { code?: string })?.code ?? '알 수 없음'}`))
    .filter(Boolean);
  console.log(`  ${i + 1}번째 — 보냄 ${res.successCount}/${tokens.length}${실패.length ? `  실패: ${실패.join(', ')}` : ''}`);
}
console.log(`\n폰 알림창을 내려 보세요. **${몇개}개가 따로 쌓여 있어야** 맞습니다.`);
process.exit(0);
