import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const src = readFileSync('src/shared/services/unpackService.ts', 'utf8');
const timeline = readFileSync('components/LotTimeline.tsx', 'utf8');
function descendants(node:ts.Node):ts.Node[]{const nodes:ts.Node[]=[];const visit=(child:ts.Node)=>{nodes.push(child);ts.forEachChild(child,visit);};visit(node);return nodes;}

describe('캔 개봉 원자화 연결', () => {
  it('캔·벌크·원자화 상태·원장 이력을 같은 트랜잭션에서 쓴다', () => {
    expect(src).toContain('runTransaction(db');
    expect(src).toContain('COL.rawInventories');
    expect(src).toContain('COL.rawMaterialLedger');
    expect(src).toContain('tx.update(canRef');
    expect(src).toContain('tx.update(bulkRef');
    expect(src).toContain('tx.set(stateRef');
    expect(src).toContain('tx.set(movementRef');
  });

  it('벌크 계산은 items.lots가 아니라 원자화 상태의 활성 로트를 기준으로 한다', () => {
    expect(src).toContain('withCarryOverLot(state.activeLots, state.stockKg');
    expect(src).not.toContain('withCarryOverLot(\n        (bulkData.lots ?? [])');
  });

  it('기존 원장 작업번호가 있으면 개봉을 다시 적용하지 않는다', () => {
    const file=ts.createSourceFile('unpackService.ts',src,ts.ScriptTarget.Latest,true);
    const unpack=descendants(file).find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='unpack')!;
    const transaction=descendants(unpack).find(node=>ts.isCallExpression(node)&&node.expression.getText(file)==='runTransaction') as ts.CallExpression;
    const callback=transaction.arguments[1] as ts.ArrowFunction;
    const receiptRead=descendants(callback.body).find(node=>ts.isVariableDeclaration(node)&&node.initializer?.getText(file)==='await tx.get(movementRef)') as ts.VariableDeclaration;
    expect(receiptRead).toBeDefined();
    const receiptName=receiptRead.name.getText(file);
    const branch=descendants(callback.body).find(node=>ts.isIfStatement(node)&&node.expression.getText(file)===receiptName+'.exists()') as ts.IfStatement;
    expect(branch).toBeDefined();
    const saved=descendants(branch.thenStatement).find(node=>ts.isVariableDeclaration(node)&&node.initializer?.getText(file)===receiptName+'.data()') as ts.VariableDeclaration;
    expect(saved).toBeDefined();
    const returns=descendants(branch.thenStatement).filter(ts.isReturnStatement);
    expect(returns.some(node=>node.expression&&descendants(node.expression).some(child=>ts.isPropertyAccessExpression(child)&&child.expression.getText(file)===saved.name.getText(file)&&child.name.text==='unpackMoves'))).toBe(true);
    const writes=descendants(branch.thenStatement).filter(node=>ts.isCallExpression(node)&&/^tx\.(set|update|delete|create)$/.test(node.expression.getText(file)));
    expect(writes).toEqual([]);
    const currentItemReads=descendants(callback.body).filter(node=>ts.isCallExpression(node)&&node.expression.getText(file)==='tx.get'&&['canRef','bulkRef'].includes(node.arguments[0]?.getText(file)));
    expect(currentItemReads).toHaveLength(2);
    expect(currentItemReads.every(node=>branch.end<node.getStart(file)&&receiptRead.getStart(file)<node.getStart(file))).toBe(true);
  });

  it('벌크 로트 상세 타임라인에서 개봉 이력을 캔 개봉으로 표시한다', () => {
    expect(timeline).toContain("unpack ? '캔 개봉'");
    expect(timeline).toContain("source?.type === 'unpack'");
  });

  it('같은 날짜 출고는 타임라인에서 한 행으로 묶고 중복 출고처 영역은 두지 않는다', () => {
    expect(timeline).toContain('const byDate = new Map');
    expect(timeline).toContain("id: `ship-${lotId}-${date}`");
    expect(timeline).toContain('거래처별 상세보기');
    const productPanel = readFileSync('components/ProductLotPanel.tsx', 'utf8');
    expect(productPanel).not.toContain('출고처</div>');
  });
});
