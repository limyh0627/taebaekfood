/** 과거 거래처 배열 이관 명령은 폐기했다. 원격 자료를 읽거나 수정하지 않는다. */
const args = process.argv.slice(2);
console.error('옛 partnerIds 일괄 이관·복원 명령은 폐기되었습니다. 거래처 관계와 구 필드는 변경하지 않습니다.');
console.error('SMARTSTORE의 partnerIds 읽기 호환은 유지해야 합니다. 과거 연결을 현재 판매 관계로 추정해 복원하지 않습니다.');
console.error('현재 제거 조건: docs/deprecated-field-audit-20261006.md / 과거 실행 기록: DB-CHANGELOG.md');
if (args.includes('--apply') || args.includes('--undo')) {
  console.error('쓰기 요청을 거절했습니다. 실제 관계와 회사별 이관 근거를 확인한 별도 검토가 필요합니다.');
  process.exitCode = 1;
} else if (args.some(arg => arg !== '--dry' && arg !== '--help')) {
  console.error('지원하지 않는 인수입니다. 이 명령은 안내만 제공합니다.');
  process.exitCode = 1;
}
