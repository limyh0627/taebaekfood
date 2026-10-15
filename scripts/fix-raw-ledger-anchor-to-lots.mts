/** 완료된 고정 정정 CLI의 안내만 유지한다. */
const args = process.argv.slice(2);
console.error('옛 과거 다섯 원료 원장 앵커 정정·복원 명령은 폐기되었습니다. 원격 접속과 자료 변경은 하지 않습니다.');
console.error('2026-09-10 완료된 일회성 작업입니다. 당시 다섯 원료의 정정과 검증을 완료했습니다. 현재 실사 기능이나 실사 정책을 종료하는 것이 아닙니다.');
console.error('이 옛 명령에는 undo가 없었습니다. 과거 수동 삭제 설명은 실행 기록에 보존하며, 새 정정·복원은 현재 원문과 후속 변경을 대조하고 별도 검수를 받은 계획으로 준비하세요.');
console.error('과거 백업 위치와 수동 복원 설명은 DB-CHANGELOG.md의 2026-09-10 기록을 확인하세요. 현재 파일 존재는 확인하지 않습니다.');
console.error('제거 조건: docs/deprecated-field-audit-20261006.md. 과거 백업·작업 이력은 보존합니다.');
if (args.includes('--apply') || args.includes('--undo')) {
  console.error('쓰기 요청을 거절했습니다. 과거 고정 정정이나 무조건 복원은 실행할 수 없습니다.');
  process.exitCode = 1;
} else if (args.some(arg => arg !== '--dry' && arg !== '--help')) {
  console.error('지원하지 않는 인수입니다. 기본 실행 또는 --dry, --help로 폐기 안내를 확인하세요.');
  process.exitCode = 1;
}
