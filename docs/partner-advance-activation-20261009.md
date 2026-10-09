# 선급·선수 적용 활성화 — 2026-10-09

사용자의 ‘양사 모두 활성화’ 승인에 따라 태백·풍회 기능 설정을 적용했다. 오래된 적격 원천 지급과 대상 거래를 기본 선택하고 사용자가 확인하면 적용한다.

변경은 appMeta/partnerAdvanceCutover_taebaek 및 appMeta/partnerAdvanceCutover_punghoe 두 문서의 companyId, enabled:true, auditPassed:true뿐이다. 기존 지급 기능 설정·보류 거래처 제한은 계속 적용한다.

단일 조건부 transaction으로 설정 두 문서를 생성한 뒤 독립 읽기에서 정확한 본문과 나노초 버전을 확인했다. 전후 전표·자금·정산·대출·관련 operation 및 다른 appMeta의 본문/버전 해시는 동일했다. 적용 시각은 2026-10-09 03:40:22 UTC다. 백업과 최신 적용 내용/버전이 일치할 때만 가능한 되돌림을 비공개 work에 보존했다.

배포 근거는 c268ccf8의 13 Functions 원격 소스, Rules 및 양쪽 Hosting 검증이다. 신규 활성화가 과거 전표를 다시 발행하거나 금액을 변경한 것은 아니다. GitHub 푸시는 하지 않았다. 원본 전체 TODO 잔량은 35개를 유지한다.
