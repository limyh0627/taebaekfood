/** 완료된 고정 정정 CLI의 안내만 유지한다. */
const args = process.argv.slice(2);
console.error('옛 과거 볶음참깨 벌크 앵커 정정·복원 명령은 폐기되었습니다. 원격 접속과 자료 변경은 하지 않습니다.');
console.error('2026-08-13 완료된 일회성 작업입니다. 완료된 특정 벌크와 주문·원장 정정을 현재 자료에 재적용하지 않습니다. 현재 실사 기능이나 정책은 별개입니다.');
console.error('이 옛 명령에는 undo가 없었습니다. 새 정정·복원은 현재 원문과 후속 변경을 대조하고 별도 검수를 받은 계획으로 준비하세요.');
console.error('당시 자동 백업은 없었습니다. 기존 실행 기록과 보관 자료는 보존합니다. 실행 기록: DB-CHANGELOG.md');
console.error('제거 조건: docs/deprecated-field-audit-20261006.md. 현재 실사 기능을 종료하는 변경이 아닙니다.');
if (args.includes('--apply') || args.includes('--undo')) {
  console.error('쓰기 요청을 거절했습니다. 과거 고정 정정이나 무조건 복원은 실행할 수 없습니다.');
  process.exitCode = 1;
} else if (args.some(arg => arg !== '--dry' && arg !== '--help')) {
  console.error('지원하지 않는 인수입니다. 기본 실행 또는 --dry, --help로 폐기 안내를 확인하세요.');
  process.exitCode = 1;
}
