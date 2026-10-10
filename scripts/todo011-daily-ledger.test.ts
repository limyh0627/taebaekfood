import { describe, expect, it } from 'vitest';
import { dailyLedgerAudit, auditLedgerFile, ledgerUnitInputs, partitionLedgerOrders, type DailyLedgerInput, type LedgerFile } from './todo011-daily-ledger';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildBomIndex } from '../src/shared/bomIndex';
import { buildPackIndex } from '../src/shared/packIndex';
import type { Item } from '../src/shared/types';

const item: Item = { id: 'p', name: '병', spec: '300ml', unit: '개', type: 'product', stock: 12,
  stocktakeAnchors: [{ id: 'stocktake-1', date: '2026-10-09', createdAt: '2026-10-09T01:00:00Z', beforeQty: 8, targetQty: 10, deltaQty: 2 }] };
function fixture(): DailyLedgerInput {
  return { companyId: 'taebaek', snapshotDate: '2026-10-10', items: [item], orders: [],
    receipts: [{ id: 'r', companyId: 'taebaek', itemId: 'p', itemName: '병', partnerName: '매입처', quantity: 2, date: '2026-10-10', createdAt: '2026-10-10T01:00:00Z' }],
    inventoryEntries: [], returnOperations: [], complete: true,
    unitInputs: { bom: buildBomIndex([item], []), pack: buildPackIndex([]) },
    physicalEvidence: [{ itemId: 'p', anchorId: 'stocktake-1', targetQty: 10, createdAt: '2026-10-09T01:00:00Z', evidenceRef: '실물 조사표/1' }] };
}
function fileFixture(): LedgerFile {
  const { unitInputs: _inputs, ...input } = fixture();
  return { ...input, itemBoms: [], itemPacks: [] };
}
describe('일일 제품 원장 읽기 후보', () => {
  it('items 없는 실제 형태의 주문은 별도 오류로 남기고 정상 입력/원문을 보존한다', () => {
    const rows = [{ id: 'placeholder', companyId: 'taebaek' as const, status: 'PENDING' },
      { id: 'normal', companyId: 'punghoe' as const, items: [{ itemId: 'p', quantity: 1 }] }];
    const before = JSON.stringify(rows); const result = partitionLedgerOrders(rows);
    expect(result.invalid).toEqual([{ id: 'placeholder', companyId: 'taebaek', status: 'PENDING', fields: ['companyId', 'id', 'status'], reason: '주문 items 배열 없음 또는 품목 줄 형식 오류' }]);
    expect(result.valid).toEqual([rows[1]]); expect(result.valid[0]).toBe(rows[1]); expect(JSON.stringify(rows)).toBe(before);
    expect(partitionLedgerOrders([{ id: 'bad-line', items: [null] }]).invalid).toHaveLength(1);
  });
  it('실측 이후 입고와 현재 재고 대조; 입력 원문 변경0', () => {
    const input = fixture(); const original = JSON.stringify(input);
    expect(dailyLedgerAudit(input)[0]).toMatchObject({ status: '기록일치', expectedStock: 12, gap: 0 });
    expect(JSON.stringify(input)).toBe(original);
    input.items = [{ ...item, stock: 13 }];
    expect(dailyLedgerAudit(input)[0]).toMatchObject({ status: '기록불일치', expectedStock: 12, gap: 1 });
  });
  it('stocktake 이름만으로 실측 추정0; 이후 보정은 기존 실측으로 합격0', () => {
    const input = fixture(); input.physicalEvidence = [];
    expect(dailyLedgerAudit(input)[0]).toMatchObject({ status: '전산기준만', expectedStock: 12, gap: 0, anchorAt: '2026-10-09T01:00:00Z' });
    input.physicalEvidence = fixture().physicalEvidence;
    input.items = [{ ...item, stocktakeAnchors: [...item.stocktakeAnchors!, { id: 'adjust-2', date: '2026-10-10', createdAt: '2026-10-10T02:00:00Z', targetQty: 12, beforeQty: 12, deltaQty: 0 }] }];
    expect(dailyLedgerAudit(input)[0].status).toBe('전산기준만');
  });
  it('역산 기초·자료누락·원료는 별도 진단하고 다른 회사 입고 배제', () => {
    const input = fixture(); input.receipts.push({ ...input.receipts[0], id: 'foreign', companyId: 'punghoe', quantity: 99 });
    expect(dailyLedgerAudit(input)[0]).toMatchObject({ expectedStock: 12 });
    input.items = [{ ...item, stocktakeAnchors: [] }];
    expect(dailyLedgerAudit(input)[0]).toMatchObject({ status: '기준없음' });
    expect(dailyLedgerAudit(input)[0]).not.toHaveProperty('expectedStock');
    input.complete = false; expect(() => dailyLedgerAudit(input)).toThrow('불완전');
    input.complete = true;
    input.items = [{ ...item, type: 'raw' }]; expect(dailyLedgerAudit(input)[0].status).toBe('원료별도대조');
  });
  it('미래 기록을 과거 종료 재고로 대조하지 않는다', () => {
    const input = fixture(); input.snapshotDate = '2026-10-09';
    expect(dailyLedgerAudit(input)[0].status).toBe('입력미확인');
  });
  it('불완전 배열/날짜/수량은 파일 보고서 생성 전 거절한다', () => {
    const input = fileFixture();
    expect(() => auditLedgerFile({ ...input, complete: false })).toThrow();
    expect(() => auditLedgerFile({ ...input, itemBoms: undefined })).toThrow();
    expect(() => auditLedgerFile({ ...input, snapshotDate: '2026-02-30' })).toThrow();
    expect(() => auditLedgerFile({ ...input, items: [{ ...item, stock: null }] })).toThrow();
    expect(auditLedgerFile(input).counts).toEqual({ 기록일치: 1 });
  });
  it('풍회 소유 품목의 회사 없는 공용 BOM/포장 입력은 유지하고 태백 명시 행은 제외', () => {
    const input = fileFixture(); input.companyId = 'punghoe'; input.receipts = []; input.physicalEvidence = [];
    input.items = [{ ...item, id: 'child', companyId: 'punghoe', stock: 8,
      stocktakeAnchors: [{ ...item.stocktakeAnchors![0], targetQty: 12 }] },
    { ...item, id: 'parent', companyId: 'punghoe', stock: 1, stocktakeAnchors: [] }];
    input.itemBoms = [{ parent_id: 'parent', child_id: 'child', quantity: 4 },
      { companyId: 'taebaek', parent_id: 'parent', child_id: 'child', quantity: 999 }];
    input.itemPacks = [{ item_id: 'child', units_per_box: 12 },
      { companyId: 'taebaek', item_id: 'child', units_per_box: 999 }];
    const inputs = ledgerUnitInputs(input.companyId, input.items, input.itemBoms, input.itemPacks);
    expect(inputs.bom.of('parent').map(row => row.qty)).toEqual([4]); expect(inputs.pack.of('child')).toBe(12);
    const report = auditLedgerFile({ ...input, orders: [{ id: 'production', companyId: 'punghoe', items: [],
      producedUnits: [{ itemId: 'parent', qty: 1 }], createdAt: '2026-10-10T01:00:00Z', producedAt: '2026-10-10T01:00:00Z' }] });
    expect(report.rows.find(row => row.itemId === 'child')).toMatchObject({ status: '전산기준만', expectedStock: 8, gap: 0 });
  });
  it('실제 audit:daily 파일 분기는 인증 없이 JSON 보고서를 쓰고 원본/기존보고서 보존', () => {
    const dir = mkdtempSync(join(tmpdir(), 'todo011-'));
    try {
      const inputPath = join(dir, 'input.json'); const outputPath = join(dir, 'report.json');
      const original = JSON.stringify(fileFixture()); writeFileSync(inputPath, original);
      const run = () => spawnSync(process.execPath, ['--import', 'tsx', resolve('scripts/diag-daily-integrity.mts'), '--input', inputPath, '--output', outputPath], {
        cwd: process.cwd(), encoding: 'utf8', timeout: 30000,
        env: { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: join(dir, 'credentials-do-not-exist.json') },
      });
      const success = run(); expect(success.status, success.stderr).toBe(0);
      const report = JSON.parse(readFileSync(outputPath, 'utf8'));
      expect(report).toMatchObject({ companyId: 'taebaek', snapshotDate: '2026-10-10', counts: { 기록일치: 1 } });
      expect(report.rows[0]).toMatchObject({ itemId: 'p', expectedStock: 12, gap: 0 });
      expect(readFileSync(inputPath, 'utf8')).toBe(original);
      const reportBefore = readFileSync(outputPath, 'utf8');
      expect(run().status).toBe(1); expect(readFileSync(outputPath, 'utf8')).toBe(reportBefore);
      rmSync(outputPath); writeFileSync(inputPath, JSON.stringify({ ...fileFixture(), complete: false }));
      expect(run().status).toBe(1); expect(existsSync(outputPath)).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 100000);
});
