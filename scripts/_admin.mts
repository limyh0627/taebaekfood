// **운영 DB 에 붙는 길 — 스크립트는 전부 여기를 지난다.**
//
// 2026-09-16 규칙이 바뀌었다(코덱스): 익명 로그인을 없애고 **직원 Callable 로그인이 발급한
// Custom Token** 만 업무 데이터에 닿게 했다(`firestore.rules` 의 `isEmployee()`).
// 좋은 변화다 — 되돌리지 않는다. 대신 스크립트는 **서비스 계정**으로 붙는다.
// Admin SDK 는 규칙을 우회하므로 사람 로그인을 흉내 낼 필요가 없다.
//
// ---
// **열쇠는 저장소 밖에 둔다.** 경로는 `GOOGLE_APPLICATION_CREDENTIALS` 환경변수로만 읽고,
// **경로도 키 내용도 코드·로그·백업에 적지 않는다**(2026-09-16 사장님 지시).
// 그래서 아래 오류 문구에도 변수 **이름**만 적지 값은 안 적는다.
//
//   setx GOOGLE_APPLICATION_CREDENTIALS "C:\\...\\.secrets\\taebaek-admin.json"
//
// **Admin SDK 는 규칙을 안 본다.** 그러니 스크립트는 규칙이 막아 주던 것을 스스로 지켜야 한다:
//   · 미리보기(dry)가 기본, `--apply` 라야 쓴다
//   · 쓰기 전에 **바꾸는 것만 열거**해 보여 준다
//   · 백업을 파일로 남기고 `--undo` 로 되돌린다
//   · 쓴 뒤에 **다시 읽어 확인**한다 — 썼다고 믿지 않는다
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

let db: Firestore | undefined;

/** 운영 Firestore. 열쇠가 없으면 **무엇을 해야 하는지 알려 주고 멈춘다.** */
export function adminDb(): Firestore {
  if (db) return db;

  const 열쇠경로 = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!열쇠경로) {
    console.error([
      '',
      '서비스 계정 열쇠가 없다.',
      '',
      '  1. https://console.firebase.google.com/project/taebaek-3abe4/settings/serviceaccounts/adminsdk',
      '     → 새 비공개 키 생성 (json 이 내려받아진다)',
      '  2. 저장소 **밖**에 둔다',
      '  3. setx GOOGLE_APPLICATION_CREDENTIALS "<그 파일 경로>"',
      '  4. 터미널을 새로 연다',
      '',
    ].join('\n'));
    process.exit(1);
  }

  if (!getApps().length) {
    try {
      //  파일을 직접 읽어 프로젝트를 못 박는다 — `applicationDefault()` 만 쓰면 다른 gcloud
      //  설정이 끼어들어 **엉뚱한 프로젝트에 쓸** 수 있다. 어느 프로젝트인지가 제일 위험한 값이다.
      const 키 = JSON.parse(readFileSync(열쇠경로, 'utf-8')) as { project_id?: string; type?: string };
      if (키.type !== 'service_account') {
        console.error('\nGOOGLE_APPLICATION_CREDENTIALS 가 서비스 계정 키가 아니다(type !== service_account).\n');
        process.exit(1);
      }
      if (키.project_id !== 'taebaek-3abe4') {
        console.error(`\n프로젝트가 다르다: ${키.project_id} — 태백 것이 아니다. 멈춘다.\n`);
        process.exit(1);
      }
      initializeApp({ credential: cert(열쇠경로), projectId: 'taebaek-3abe4' });
    } catch (error) {
      //  열쇠 경로·내용은 안 찍는다. 무엇이 잘못됐는지만 말한다.
      console.error(`\n열쇠를 읽지 못했다: ${error instanceof Error ? error.message.replace(열쇠경로, '<열쇠경로>') : '알 수 없음'}\n`);
      process.exit(1);
    }
  }
  db = getFirestore();
  return db;
}

/** 부르는 쪽이 매번 적던 것 — `--apply` 라야 쓴다. */
export function 실행모드(argv = process.argv.slice(2)) {
  return { APPLY: argv.includes('--apply'), UNDO: argv.includes('--undo'), 나머지: argv.filter(a => !a.startsWith('--')) };
}
