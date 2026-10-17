import {describe,expect,it} from 'vitest';
import {getHelpMenuGuides} from './shared/helpGuides';
import {exactOrderPasteHelp,helpKnowledgeFor} from './helpKnowledge';

describe('단일 기능 안내의 서버 근거 투영',()=>{
  it.each(['admin','staff'] as const)('%s 전체 기능의 절차·주의·복구가 서버 문맥에 있다',mode=>{
    const knowledge=helpKnowledgeFor(mode);
    for(const {viewId,guide} of getHelpMenuGuides(mode))for(const feature of guide.features){
      const row=knowledge.find(k=>k.id===`guide:${viewId}:${feature.id}`);
      expect(row,`${viewId}/${feature.id}`).toBeDefined();
      expect(row!.navId).toBe(viewId);
      for(const text of [...feature.steps,feature.note,feature.recovery].filter(Boolean))expect(row!.text).toContain(text);
    }
    expect(new Set(knowledge.map(row=>row.id)).size).toBe(knowledge.length);
    for(const row of knowledge){expect(row.id.length).toBeLessThanOrEqual(100);expect(row.title.length).toBeLessThanOrEqual(120);if(row.navId)expect(row.navId).toMatch(/^[a-z][a-z0-9-]{0,63}$/);}
    expect(Buffer.byteLength(JSON.stringify(knowledge),'utf8')).toBeLessThan(60000);
  });
  it('직원에게 관리자 기능·회계·승인·편집 근거가 섞이지 않는다',()=>{
    const rows=helpKnowledgeFor('staff');
    expect(rows.some(row=>row.id.startsWith('guide:trade-statement:'))).toBe(false);
    for(const suffix of ['notice-write','inventory-receive','item-edit','signup-review'])expect(rows.some(row=>row.id.endsWith(':'+suffix))).toBe(false);
    expect(rows.find(row=>row.id==='guide:orders:order-paste')?.text).toContain('새 주문을 만드는 입력 방식');
  });
});
describe('명시한 복사주문 정의·방법만 정적 응답',()=>{
  it.each(['복사주문 넣기는 뭔가요','복사주문 뭐예요?','복사주문은 무엇인가요','복사주문 뜻','복사해서 주문은 뭔가요','복사주문 넣기 어떻게 하나요?','주문 내역 붙여넣기 사용법','주문 내용 붙여넣기 하는 방법'])('%s를 단일 원본에서 답한다',question=>{
    const response=exactOrderPasteHelp(question,'staff');
    expect(response?.sourceId).toBe('guide:orders:order-paste');
    expect(response?.answer).toContain('새 주문을 만드는 입력 방식');
    expect(response?.answer).toContain('분석하기');expect(response?.answer).toContain('주문 생성 (N건)');
  });
  it.each(['복사주문 취소는 어떻게 하나요','복사주문 중복인가요','누가 복사주문 넣었나요','복사주문 오늘 금액','복사주문 넣기는 뭔가요 그리고 취소는요','복사주문 넣기는 뭔가요 전표도 알려줘','복사주문 넣기는 뭔가요? 오늘 금액도 알려줘'])('%s는 정적 단정하지 않는다',question=>expect(exactOrderPasteHelp(question,'staff')).toBeUndefined());
});
