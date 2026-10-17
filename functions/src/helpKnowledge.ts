import {getHelpMenuGuides, getHelpMenuGuide} from './shared/helpGuides';
export const HELP_KNOWLEDGE_VERSION = '2026-10-17.2';
export interface HelpKnowledge { id:string; title:string; navId?:string; modes:readonly ('admin'|'staff')[]; text:string }
// 실제 동선만 고정하고 운영 자료·직원 이름을 문맥에 넣지 않는다.
export const HELP_KNOWLEDGE: readonly HelpKnowledge[] = [
  {id:'orders',title:'주문·배송',navId:'orders',modes:['admin','staff'],text:'주문·배송 메뉴에서 주문과 배송 정보를 확인합니다. 화면에 없는 실재고나 처리 결과는 도움말이 확인할 수 없습니다.'},
  {id:'inventory',title:'재고 관리',navId:'inventory',modes:['admin','staff'],text:'재고 관리 메뉴에서 재고를 확인합니다. 원료 소모량을 판매량으로 추정하지 않습니다.'},
  {id:'production-document',title:'생산작업일지 작성',navId:'documents',modes:['staff'],text:'직원 화면 서류 관리의 생산작업일지에서 작성일을 선택합니다. 실제 근거 불러오기로 저장된 생산·원료 근거를 읽고 빈 항목을 수동 보완한 뒤 저장합니다. 인쇄 미리보기에서 인쇄/PDF 저장을 엽니다. 판매량을 생산량으로 추정하지 않습니다.'},
  {id:'voucher-kinds',title:'일반전표 여섯 갈래',navId:'trade-statement',modes:['admin'],text:'전표 메뉴의 일반전표에서 매입·매출·대체·입금·출금·회사이체를 직접 고릅니다. 거래처나 현재 갈래에 맞는 양식을 골라도 선택한 종류를 유지합니다. 실제 금액·계정의 적정성은 도움말이 판단하지 않습니다.'},
  {id:'voucher-retry',title:'전표 결과 미확인과 재시도',navId:'trade-statement',modes:['admin'],text:'정상 저장 중에는 기다립니다. 결과 미확인이면 새 전표를 만들지 말고 일반전표의 이전 전표 재시도에서 같은 요청을 확인합니다. 전표 메뉴의 발행 실패/확인 필요 목록에서 상세를 열어 서버 상태를 확인하고 화면이 허용하는 동일 요청 재시도 또는 요청 중단 절차를 따릅니다. 사본을 임의로 모두 지우거나 새 요청으로 중복 발행하지 않습니다. 발행 완료 후 정리 오류는 발행 실패와 다릅니다.'},
  {id:'tax',title:'세금계산서 화면',navId:'tax-statement',modes:['admin'],text:'세금계산서 메뉴에서 작성과 발행내역을 확인합니다. 도움말은 세법·세액·발행 여부를 대신 판단하거나 발행하지 않습니다.'},
  {id:'quotation',title:'견적서',navId:'quotation',modes:['admin'],text:'견적서 메뉴에서 품목과 수량 등을 입력합니다. 도움말은 견적 저장이나 금액 변경을 실행하지 않습니다.'},
  {id:'leave',title:'연차 신청',navId:'leave-portal',modes:['staff'],text:'직원 화면 연차 신청 메뉴에서 신청합니다. 승인 여부나 잔여 연차는 실제 화면에서 확인하며 도움말은 승인하지 않습니다.'},
  {id:'mypage',title:'마이페이지와 알림',navId:'mypage',modes:['admin','staff'],text:'사이드바 계정 영역에서 마이페이지를 엽니다. 알림 권한과 설정, 로그아웃을 확인합니다. 브라우저 권한은 본인이 선택합니다.'},
  {id:'my-menu',title:'내 메뉴 표시와 순서',navId:'mypage',modes:['admin','staff'],text:'마이페이지의 이 브라우저의 내 메뉴에서 메뉴 설정 열기를 누릅니다. 표시 체크로 숨김을 바꾸고 위로/아래로 버튼으로 메뉴와 그룹 순서를 바꾸며 그룹 선택으로 메뉴를 옮깁니다. 이 브라우저의 회사·사용자·관리자/직원 화면별로 자동 저장하며 다른 기기에 동기화하지 않습니다. 내 메뉴 초기화로 기본값을 복원합니다. 마이페이지 접근과 권한 없는 메뉴는 바꾸지 않습니다.'},
  {id:'partner-delivery',title:'거래처 기본 배송방식',navId:'partners',modes:['admin'],text:'거래처 관리에서 거래처를 편집하고 기본 배송방식을 배송·화물·수령·택배 중 고릅니다. 개별 주문의 배송지를 바꾸는 것과 거래처 기본값 편집은 별개입니다.'},
  {id:'scope',title:'도움말의 범위',modes:['admin','staff'],text:'앱 사용법만 안내합니다. 재고·원가·전표·급여·회계·세무·법률 판단, 데이터 조회·저장·삭제·승인·복구 실행은 할 수 없습니다. 근거가 없는 내용은 확인할 수 없다고 안내합니다.'},
];
export function helpKnowledgeFor(mode:'admin'|'staff'):HelpKnowledge[] {
  const guides = getHelpMenuGuides(mode).flatMap(({viewId,guide}) => guide.features.map(feature => ({
    id:`guide:${viewId}:${feature.id}`,title:`${guide.menuTitle} · ${feature.title}`,navId:viewId,modes:[mode],
    text:[feature.title,...feature.steps.map((step,index)=>`${index+1}. ${step}`),feature.note?`안내: ${feature.note}`:'',feature.recovery?`복구: ${feature.recovery}`:''].filter(Boolean).join('\n'),
  })));
  return [...HELP_KNOWLEDGE.filter(row=>row.modes.includes(mode)),...guides];
}

/** 정의·사용법만 문장 전체로 확인한다. 취소·중복·실제 자료·복합 질문은 모델의 근거 검증 경로에 둔다. */
export function exactOrderPasteHelp(question:string,mode:'admin'|'staff'): {answer:string;sourceId:string}|undefined {
  const normalized=question.trim().replace(/[?？.!。]+$/u,'').replace(/\s+/gu,'');
  if(!/^(?:복사주문넣기|복사주문|복사해서주문|주문내역붙여넣기|주문내용붙여넣기)(?:(?:는|은|이|가)?(?:뭔가요|뭐예요|무엇인가요|뜻)|(?:는|은)?(?:어떻게하나요|사용법|하는방법))$/u.test(normalized))return undefined;
  const feature=getHelpMenuGuide('orders',mode).features.find(row=>row.id==='order-paste');
  if(!feature)return undefined;
  return {answer:[feature.title,...feature.steps.map((step,index)=>`${index+1}. ${step}`),feature.note??'',feature.recovery??''].filter(Boolean).join('\n'),sourceId:'guide:orders:order-paste'};
}
