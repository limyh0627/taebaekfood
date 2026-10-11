import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { auditRawInventoryFile, rawInventoryAxes, rawInventoryReport, rawInventoryReportMarkdown } from './todo011-raw-report';
import type { RawInventoryState } from '../src/shared/rawInventoryCore';
import type { Item, RawMaterialEntry } from '../src/shared/types';
const state = (stockKg=6): RawInventoryState => ({id:'state',companyId:'taebaek',rawItemId:'raw',materialSnapshot:'원료',stockKg,activeLots:[{kgRemaining:6}]} as RawInventoryState);
describe('원료 전산 네 축 보고서',()=>{
 it('L 품목도 저장 kg 그대로 대조하고 실측 미확인 표시를 보존한다',()=>{
  const input={states:[state()],items:[{id:'raw',companyId:'taebaek',stock:6,unit:'L'}] as Item[],entries:[{id:'e',companyId:'taebaek',rawItemId:'raw',balanceAfterKg:6,sequence:1}] as RawMaterialEntry[]};
  const original=JSON.stringify(input); const rows=rawInventoryReport('taebaek',input.states,input.items,input.entries);
  expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({stateKg:6,lotKg:6,itemKg:6,ledgerKg:6,stateMinusLotsKg:0,stateMinusItemKg:0,stateMinusLedgerKg:0,physicalStatus:'실측 미확인',unit:'kg'});
  expect(rawInventoryReportMarkdown(rows).join('\n')).toContain('| 6 | 6 | 6 | 6 | 0 | 0 | 0 |');expect(JSON.stringify(input)).toBe(original);
 });
 it('각 축 차이를 따로 표시하고 다른 회사 원문을 제외한다',()=>{
  const rows=rawInventoryReport('taebaek',[state(10),{...state(900),id:'foreign',companyId:'punghoe'}],[{id:'raw',companyId:'taebaek',stock:8}] as Item[],[{id:'e',rawItemId:'raw',balanceAfterKg:9,sequence:1},{id:'f',companyId:'punghoe',rawItemId:'raw',balanceAfterKg:999,sequence:2}] as RawMaterialEntry[]);
  expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({ledgerRows:1,stateMinusLotsKg:4,stateMinusItemKg:2,stateMinusLedgerKg:1});
 });
 it('미기록·비유한 값을 실재고로 추정하지 않고 실제 파일 CLI를 인증 없이 실행한다',()=>{
  const rows=rawInventoryReport('taebaek',[state()],[],[]);
  expect(rows[0]).toMatchObject({itemKg:null,stateMinusItemKg:null,itemPresent:false,ledgerRows:0,ledgerKg:0,physicalStatus:'실측 미확인'});
  expect(rawInventoryReportMarkdown(rows).join('\n')).toContain('원장 미기록');
  expect(rawInventoryReport('taebaek',[state()],[{id:'raw',stock:Infinity}] as Item[],[])[0].itemKg).toBeNull();
  const dir = mkdtempSync(join(tmpdir(), 'todo011-raw-'));
  try {
   const inputPath = join(dir, 'input.json'); const outputPath = join(dir, 'report.json');
   const input = {companyId:'taebaek', snapshotDate:'2026-10-11', complete:true, rawInventories:[state()], items:[], rawMaterialLedger:[]};
   const original = JSON.stringify(input); writeFileSync(inputPath, original);
   const run = () => spawnSync(process.execPath, ['--import','tsx',resolve('scripts/diag-daily-integrity.mts'),'--raw-input',inputPath,'--output',outputPath], {
    cwd:process.cwd(), encoding:'utf8', timeout:30000, env:{...process.env, GOOGLE_APPLICATION_CREDENTIALS:join(dir,'인증파일없음.json')},
   });
   const success = run(); expect(success.status, success.stderr).toBe(0);
   const report = JSON.parse(readFileSync(outputPath,'utf8'));
   expect(report).toMatchObject({companyId:'taebaek', snapshotDate:'2026-10-11'});
   expect(report.rows[0]).toMatchObject({itemKg:null, physicalStatus:'실측 미확인',ledgerKg:0});
   expect(readFileSync(inputPath,'utf8')).toBe(original);
   const before = readFileSync(outputPath,'utf8'); expect(run().status).toBe(1); expect(readFileSync(outputPath,'utf8')).toBe(before);
   rmSync(outputPath); writeFileSync(inputPath,JSON.stringify({...input,complete:false}));
   expect(run().status).toBe(1); expect(existsSync(outputPath)).toBe(false);
   expect(() => auditRawInventoryFile({...input,rawMaterialLedger:undefined})).toThrow('전체 배열');
  } finally { rmSync(dir,{recursive:true,force:true}); }
 }, 100000);
 it('작은 차이를 반올림해 지우지 않고 감사 기본값과 표시 미확인을 구분한다',()=>{
  const s=state(6.0001);
  const rows=rawInventoryReport('taebaek',[s],[],[]);
  expect(rows[0].stateMinusLotsKg).toBeGreaterThan(0);
  expect(rows[0].stateMinusLotsKg).toBeLessThan(0.001);
  const holder={id:'raw'} as Item;
  expect(rawInventoryAxes('taebaek',[state()],[holder],[])[0].holderStock).toBe(0);
  expect(rawInventoryReport('taebaek',[state()],[holder],[])[0].itemKg).toBeNull();
 });});