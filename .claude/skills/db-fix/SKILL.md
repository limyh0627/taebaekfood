---
name: db-fix
description: 운영 Firestore 문서를 고칠 때 쓴다. fix-*.mts 정정 스크립트를 짜고 dry로 미리보고 백업을 남기고 --apply 한 뒤 DB-CHANGELOG.md에 기록하는 절차. 재고·원가·전표·거래처·품목 연결처럼 DB 문서 값을 직접 바꿔 달라는 요청이면 코드를 짜기 전에 먼저 읽는다. 읽기 전용 진단(diag-*.mts)도 여기서 다룬다.
---

# DB 정정 스크립트

운영 Firestore(`taebaek-3abe4`)는 **되돌릴 수 없는 곳**이다. 여기 적힌 순서를 건너뛰지 않는다.
근거는 [인수인계.md](../../../인수인계.md) 6장 "데이터를 고칠 때".

## 절대 규칙

1. **`--apply`는 사장님이 말할 때만.** dry 결과를 보여 주고 멈춘다. "적용할까요?"를 묻고 답을 받기 전엔 안 쓴다.
2. **백업 없이 안 쓴다.** 되돌릴 `before` 값을 JSON으로 먼저 남긴다.
3. **적용 뒤 재조회로 검증한다.** 썼다고 믿지 말고 다시 읽어 맞는지 본다.
4. **[DB-CHANGELOG.md](../../../DB-CHANGELOG.md)에 적는다.** 안 적으면 다음 사람이 왜 이 값인지 모른다.

## 순서

### 1. 무엇이 몇 건인지부터 센다

고칠 대상을 먼저 **읽기만** 해서 센다. 건수가 예상과 다르면 거기서 멈추고 묻는다.
한 번 쓰고 버릴 진단은 `scripts/diag-*.mts`로 만들고 **일이 끝나면 지운다.**

### 2. `scripts/fix-<무엇>.mts`를 짠다

아래 골격을 그대로 따른다. 실제로 쓰인 것: `scripts/fix-suip-cost-172000.mts`.

```ts
// <무엇을 왜 고치는지 한 줄>
// 기본 dry / 실제 적용 --apply / 되돌리기 --undo
import admin from 'firebase-admin';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const COMPANY = 'taebaek';
const BACKUP = '로컬전용/백업/<이름>.json';

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS가 없습니다.');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.applicationDefault() });
const db = admin.firestore();

type Saved = { before: Record<string, unknown>; after: Record<string, unknown> };
type Backup = { savedAt: string; rows: Record<string, Saved> };

// ── 되돌리기가 맨 앞이다. 급할 때 찾기 쉬우라고. ──
if (UNDO) {
  if (!existsSync(BACKUP)) throw new Error(`백업이 없습니다: ${BACKUP}`);
  const backup = JSON.parse(readFileSync(BACKUP, 'utf8')) as Backup;
  const batch = db.batch();
  for (const [id, saved] of Object.entries(backup.rows)) batch.set(db.collection('<컬렉션>').doc(id), saved.before);
  await batch.commit();
  console.log(`${Object.keys(backup.rows).length}건을 적용 전 값으로 복구했습니다.`);
  process.exit(0);
}

// ── 회사 조건은 항상 건다. 태백·풍회가 한 DB에 있다. ──
const load = async (name: string) => (await db.collection(name).where('companyId', '==', COMPANY).get())
  .docs.map(doc => ({ id: doc.id, ...doc.data() } as any));

const rows: Record<string, Saved> = {};
// … 여기서 before/after를 채운다. 값이 실제로 달라지는 것만 넣는다 …

// ── 미리보기: 무엇이 얼마→얼마로 바뀌는지 눈에 보이게 ──
console.log(`총 ${Object.keys(rows).length}건`);
for (const [id, saved] of Object.entries(rows).slice(0, 15)) {
  console.log(`- ${String(saved.before.name)} [${id}] ${saved.before.<필드>} → ${saved.after.<필드>}`);
}
if (Object.keys(rows).length > 15) console.log(`- 외 ${Object.keys(rows).length - 15}건`);
console.log(APPLY ? '실제 적용' : '미리보기(dry) — 쓰기 없음');
if (!APPLY) process.exit(0);

if (existsSync(BACKUP)) throw new Error(`기존 백업이 있습니다: ${BACKUP}`);
mkdirSync(dirname(BACKUP), { recursive: true });
writeFileSync(BACKUP, JSON.stringify({ savedAt: new Date().toISOString(), rows } satisfies Backup, null, 2), 'utf8');

// ── Firestore 배치는 500건까지. 400씩 끊는다. ──
for (const start of Array.from({ length: Math.ceil(Object.keys(rows).length / 400) }, (_, i) => i * 400)) {
  const batch = db.batch();
  for (const [id, saved] of Object.entries(rows).slice(start, start + 400)) {
    batch.update(db.collection('<컬렉션>').doc(id), { /* 바꿀 필드만 */ });
  }
  await batch.commit();
}

// ── 썼다고 믿지 않는다. 다시 읽어 맞는지 본다. ──
for (const [id, saved] of Object.entries(rows)) {
  const current = (await db.collection('<컬렉션>').doc(id).get()).data();
  if (current?.<필드> !== saved.after.<필드>) throw new Error(`${id}: 적용 뒤 재조회 검증 실패`);
}
console.log(`${Object.keys(rows).length}건 적용·재조회 검증 완료`);
```

### 3. dry로 돌리고 **사장님께 보여 준다**

```bash
node -r ./로컬전용/tsx-userinfo-preload.cjs --import tsx scripts/fix-<무엇>.mts
```

`-r ./로컬전용/tsx-userinfo-preload.cjs`는 Windows 한글 사용자명 때문에 `os.userInfo()`가
깨지는 걸 막는 우회다. 빼면 안 돈다. (`npx tsx` 만으로 도는 스크립트도 있지만 이쪽이 안전하다.)

건수와 "얼마 → 얼마"를 **표로** 보여 주고 멈춘다. 여기서 승인을 받는다.

### 4. `--apply`, 그 다음 `--undo` 경로 확인

적용은 승인받은 뒤에만. 적용 후 백업 JSON이 실제로 생겼는지 본다.

### 5. DB-CHANGELOG.md 맨 위에 적는다

```markdown
## YYYY-MM-DD — <한 줄 제목>

**작업자:** Claude Code (사장님 적용 승인)

- <무엇을 무엇으로 바꿨는지, 근거와 함께>
- <몇 건인지, 적용 후 재조회로 확인했다는 사실>
- 스크립트: `scripts/fix-<무엇>.mts --apply`
- 백업: `로컬전용/백업/<이름>.json`
- 되돌리기: `node -r ./로컬전용/tsx-userinfo-preload.cjs --import tsx scripts/fix-<무엇>.mts --undo`

---
```

**데이터 변경만 적는다.** 코드 변경은 git이 기록한다.

## 자주 틀리는 것

- **회사 조건을 빼먹는다** — 태백·풍회가 한 DB에 있다. `where('companyId','==',COMPANY)` 없이 훑으면 남의 회사 문서까지 고친다.
- **`batch.set`으로 통째 덮어쓴다** — 스크립트가 모르는 필드(원료 `lots`, `mixEnabled` 등)가 날아간다. 바꿀 필드만 `batch.update` 한다. 6/29 원료 로트 소실이 이 경로였다.
- **값이 안 바뀌는 문서까지 넣는다** — `before === after`면 건너뛴다. 건수가 부풀면 미리보기가 쓸모없어진다.
- **재고를 직접 고친다** — 재고 정정은 `adjustItemStock` 같은 공용 원자 명령을 먼저 본다. 구조 이관만 예외다(할일.md 사장님 판단 11번).
- **옛 필드를 대조 없이 지운다** — 새 원천과 **차이가 0인지** 확인하고 지운다.

## 하지 않는 것

커밋·푸시·배포는 이 절차에 없다. 사장님이 따로 말할 때만 한다.
