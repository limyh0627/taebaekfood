/** 과거 규격 일괄 보정 명령은 폐기했다. 원격 자료를 읽거나 수정하지 않는다. */
const args = process.argv.slice(2);
console.error('옛 낱개·벌크 규격 일괄 보정·복원 명령은 폐기되었습니다. 원격 접속과 자료 변경은 하지 않습니다.');
console.error('현재 규격은 품목 관리에서 원문을 확인해 수정합니다. 과거 규격으로 현재 편집을 덮거나 boxSize를 부활시키지 않습니다.');
console.error('과거 백업: scripts/fix-spec-loose-bulk-backup.json / 실행 기록: DB-CHANGELOG.md');
console.error('제거 조건: docs/deprecated-field-audit-20261006.md. 현재 규격 관리 UI·BOM·item_pack과 과거 백업·기록은 보존합니다.');
if (args.includes('--apply') || args.includes('--undo')) {
  console.error('쓰기 요청을 거절했습니다. 과거 일괄 보정이나 무조건 복원은 실행할 수 없습니다.');
  process.exitCode = 1;
} else if (args.some(arg => arg !== '--dry' && arg !== '--help')) {
  console.error('지원하지 않는 인수입니다. 기본 실행 또는 --dry, --help로 폐기 안내를 확인하세요.');
  process.exitCode = 1;
}
