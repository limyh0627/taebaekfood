/** 완료된 고정 정정 CLI의 안내만 유지한다. */
const args = process.argv.slice(2);
console.error('옛 수입들기름 원/L 고정 원가 정정·복원 명령은 폐기되었습니다. 원격 접속과 자료 변경은 하지 않습니다.');
console.error('2026-08-27 완료된 일회성 작업입니다. 당시 원/L 정정은 같은 날 kg 기준 보정으로 대체되었습니다. 옛 환산값을 현재 원가에 재적용하지 않습니다.');
console.error('옛 undo도 종료되었습니다. 새 복원은 현재 원문과 후속 변경을 대조하고 별도 검수를 받은 계획으로 준비하세요.');
console.error('과거 기록의 백업 경로: scripts/fix-suip-deulgireum-unit-backup.json / 실행 기록: DB-CHANGELOG.md. 현재 파일 존재는 확인하지 않습니다.');
console.error('제거 조건: docs/deprecated-field-audit-20261006.md. 과거 백업·작업 이력은 보존합니다.');
if (args.includes('--apply') || args.includes('--undo')) {
  console.error('쓰기 요청을 거절했습니다. 과거 고정 정정이나 무조건 복원은 실행할 수 없습니다.');
  process.exitCode = 1;
} else if (args.some(arg => arg !== '--dry' && arg !== '--help')) {
  console.error('지원하지 않는 인수입니다. 기본 실행 또는 --dry, --help로 폐기 안내를 확인하세요.');
  process.exitCode = 1;
}
