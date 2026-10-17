import { describe, expect, it } from 'vitest';
import { buildCatalogItemMergePlan, normalizeCatalogItemMergeRequest, serializeCatalogItemMergeRequest, type CatalogItemMergeDoc, type CatalogItemMergeSnapshot } from './catalogItemMerge';
const doc = (id: string, data: Record<string, unknown>): CatalogItemMergeDoc => ({ id, version: '123:000000001', data });
const item = (id: string, over: Record<string, unknown> = {}) => doc(id, { companyId: 'taebaek', name: '같은 품목', type: 'raw', unit: 'kg', stock: 0, ...over });
const link = (id: string, itemId: string, over: Record<string, unknown> = {}) => doc(id, { companyId: 'taebaek', itemId, partnerId: 'p', Direction: 'in', price: 550, taxType: null, packing: { label: '유리', count: 12 }, ...over });
const fixture = (over: Partial<CatalogItemMergeSnapshot> = {}): CatalogItemMergeSnapshot => ({ companyId: 'taebaek', keepId: 'keep', donorIds: ['old'], items: [item('keep'), item('old')], links: [link('source', 'old')], boms: [], packs: [], activeOrders: [], rawInventories: [], purchaseUnits: [], purchaseOrders: [], returnRequests: [], coverage: { complete: true, estimatedWriteCount: 10 }, ...over });
const codes = (snapshot: CatalogItemMergeSnapshot) => buildCatalogItemMergePlan(snapshot).blockers.map(row => row.code);
describe('중복 품목 통합 순수 계획', () => {
  it('원문 후보를 참조하고 새 목적지와 donor 삭제만 계획하며 입력은 바꾸지 않는다', () => {
    const snapshot = fixture(), before = JSON.stringify(snapshot), result = buildCatalogItemMergePlan(snapshot);
    expect(result).toMatchObject({ phase: 'ready', deleteLinkIds: ['source'], deleteOwnBomIds: [], groups: [{ destinationKey: '["p","in"]', destinationLinkId: 'keep_p_in', selectedSourceLinkId: 'source', differingFields: [] }] });
    expect(snapshot.links[0].data).toMatchObject({ partnerId: 'p', price: 550, taxType: null, packing: { label: '유리', count: 12 } });
    expect(JSON.stringify(snapshot)).toBe(before);
  });
  it('같은 목적지의 동등 donor들은 한 그룹으로 모으고 기존 keep ID를 유지한다', () => {
    const result = buildCatalogItemMergePlan(fixture({ donorIds: ['old', 'other'], items: [item('keep', { stock: 33 }), item('old'), item('other')], links: [link('a', 'old'), link('b', 'other'), link('original-id', 'keep')] }));
    expect(result.phase).toBe('ready'); expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({ destinationLinkId: 'original-id', selectedSourceLinkId: 'original-id' });
    expect(result.deleteLinkIds).toEqual(['a', 'b']);
  });
  it.each(['price', 'taxType', 'packing', 'shipToIds', 'unknownBusinessField'])('%s 차이를 버리지 않고 실제 후보 전체를 선택하게 한다', field => {
    const snapshot = fixture({ links: [link('keep-link', 'keep'), link('source', 'old', { [field]: field === 'price' ? 0 : '다른 값' })] });
    const pending = buildCatalogItemMergePlan(snapshot);
    expect(pending.phase).toBe('needs-resolution'); expect(pending.groups[0].differingFields).toContain(field);
    expect(pending.groups[0].selectedSourceLinkId).toBeNull();
    expect(buildCatalogItemMergePlan(snapshot, [{ destinationKey: '["p","in"]', sourceLinkId: 'source' }]).groups[0].selectedSourceLinkId).toBe('source');
    expect(buildCatalogItemMergePlan(snapshot, [{ destinationKey: '["p","in"]', sourceLinkId: 'invented' }]).phase).toBe('blocked');
  });
  it('누락과 null·빈값은 동등한 값으로 합치지 않는다', () => {
    const snapshot = fixture({ links: [link('a', 'old'), link('k', 'keep', { taxType: undefined })] });
    expect(buildCatalogItemMergePlan(snapshot).phase).toBe('needs-resolution');
  });
  it.each([undefined, null, '0', NaN, Infinity])('잘못된 재고 %s를 0으로 추정하지 않는다', stock => {
    expect(codes(fixture({ items: [item('keep'), item('old', { stock })] }))).toContain('invalid-data');
  });
  it('남길 품목의 재고는 유지하고 donor의 재고·로트·예약만 소멸 안전성을 확인한다', () => {
    expect(codes(fixture({ items: [item('keep', { stock: 12 }), item('old', { stock: -1, lots: [{ kgRemaining: 2 }], inventoryReservations: [{ qty: 1 }] })] }))).toEqual(expect.arrayContaining(['nonzero-stock', 'active-lots', 'reservation']));
    expect(codes(fixture({ items: [item('keep'), item('old', { lots: [{ id: 'bad' }] })] }))).toContain('invalid-data');
  });
  it('원료 문서가 있으면 회사·품목·버전·잔량을 검사하고 없는 legacy는 자동 0값을 만들지 않는다', () => {
    const state = doc('taebaek__old', { companyId: 'taebaek', rawItemId: 'old', revision: 0, stockKg: 0, activeLots: [] });
    expect(buildCatalogItemMergePlan(fixture({ rawInventories: [state] })).phase).toBe('ready');
    expect(codes(fixture({ rawInventories: [{ ...state, data: { ...state.data, stockKg: '0' } }] }))).toContain('raw-inventory-mismatch');
    expect(codes(fixture({ rawInventories: [{ ...state, data: { ...state.data, stockKg: 3 } }] }))).toContain('nonzero-stock');
  });
  it('진행 주문과 외부 배합 참조가 있으면 통합하지 않는다', () => {
    const result = codes(fixture({ activeOrders: [doc('order', { companyId: 'taebaek', status: 'SHIPPED', items: [{ itemId: 'old' }] })], boms: [doc('bom', { companyId: 'taebaek', parent_id: 'outside', child_id: 'old', quantity: 1 })] }));
    expect(result).toEqual(expect.arrayContaining(['active-order', 'external-bom']));
  });
  it('own BOM은 업무필드 multiset이 같을 때만 donor 줄을 삭제한다', () => {
    const boms = [doc('k', { parent_id: 'keep', child_id: 'child', quantity: 0.5, unit: 'kg' }), doc('d', { parent_id: 'old', child_id: 'child', quantity: 0.5, unit: 'kg' })];
    expect(buildCatalogItemMergePlan(fixture({ boms })).deleteOwnBomIds).toEqual(['d']);
    expect(codes(fixture({ boms: [...boms, doc('duplicate', { parent_id: 'old', child_id: 'child', quantity: 0.5, unit: 'kg' })] }))).toContain('own-bom-mismatch');
  });
  it('회사·보관·품목 호환과 목적지 충돌을 막는다', () => {
    expect(codes(fixture({ items: [item('keep'), item('old', { companyId: 'punghoe', archived: true, density: 0.9 })] }))).toEqual(expect.arrayContaining(['foreign', 'archived', 'incompatible-item']));
    expect(codes(fixture({ links: [link('source', 'old'), link('keep_p_in', 'unrelated')] }))).toContain('destination-collision');
    expect(codes(fixture({ links: [link('source', 'old'), link('k1', 'keep'), link('k2', 'keep')] }))).toContain('destination-collision');
  });
  it('조회 미완료·문서 버전 누락·처리 한도 초과는 확정하지 않는다', () => {
    expect(codes(fixture({ coverage: { complete: false, estimatedWriteCount: 1 } }))).toContain('capacity');
    expect(codes(fixture({ coverage: { complete: true, estimatedWriteCount: 401 } }))).toContain('capacity');
    expect(codes(fixture({ links: [{ ...link('source', 'old'), version: '' }] }))).toContain('invalid-data');
  });
  it.each(['procureType', 'packageType', 'packageKg', 'unpackable'])('%s 업무 경로가 다른 품목은 통합하지 않는다', field => {
    expect(codes(fixture({ items: [item('keep'), item('old', { [field]: field === 'packageKg' ? 20 : '다름' })] }))).toContain('incompatible-item');
  });
  it('이전 예약 값도 확정된 0·빈 배열만 허용하고 이력 앵커는 보존한다', () => {
    expect(buildCatalogItemMergePlan(fixture({items:[item('keep'),item('old',{allocated:0,inventoryAllocations:[],stocktakeAnchors:[{id:'history'}]})]})).phase).toBe('ready');
    for (const value of [1, '0', null, {}, [{ qty: 0 }]]) expect(codes(fixture({items:[item('keep'),item('old',{allocated:value})]}))).toContain('reservation');
  });
  it('kg가 0이어도 개수 잔량이 있거나 불명확한 로트는 통합하지 않는다', () => {
    expect(codes(fixture({items:[item('keep'),item('old',{lots:[{kgRemaining:0,qtyRemaining:2}]})]}))).toContain('active-lots');
    expect(codes(fixture({items:[item('keep'),item('old',{lots:[{kgRemaining:0,qtyRemaining:null}]})]}))).toContain('invalid-data');
    expect(buildCatalogItemMergePlan(fixture({items:[item('keep'),item('old',{lots:[{kgRemaining:0,qtyRemaining:0}]})]})).phase).toBe('ready');
  });
  it('포장 구성의 전체 업무필드 multiset이 같을 때만 donor 포장을 삭제 계획에 넣는다', () => {
    const pack = (id: string, item_id: string, over: Record<string, unknown> = {}) => doc(id, { companyId: 'taebaek', item_id, box: 'b', count: 12, label: '같은 라벨', ...over });
    const packs = [pack('keep-pack','keep'), pack('donor-pack','old')];
    const result = buildCatalogItemMergePlan(fixture({packs}));
    expect(result.phase).toBe('ready'); expect(result.deletePackIds).toEqual(['donor-pack']);
    expect(codes(fixture({packs:[packs[0],pack('donor-pack','old',{count:24})]}))).toContain('pack-mismatch');
    expect(codes(fixture({packs:[packs[0]]}))).toContain('pack-mismatch');
    expect(codes(fixture({packs:[...packs,pack('duplicate','old')]}))).toContain('pack-mismatch');
    expect(codes(fixture({packs:[pack('foreign','old',{companyId:'punghoe'})]}))).toContain('invalid-data');
  });
  it('활성 매입단위만 현재 참조로 막고 비활성 원문은 남긴다', () => {
    const unit = doc('unit', {companyId:'taebaek',itemId:'old',active:true});
    expect(codes(fixture({purchaseUnits:[unit]}))).toContain('active-purchase-unit');
    expect(buildCatalogItemMergePlan(fixture({purchaseUnits:[{...unit,data:{...unit.data,active:false}}]})).phase).toBe('ready');
  });
  it.each(['pending','invoiced'])('진행 %s 발주의 단일·복수품목·OEM 원료 참조를 확인한다', status => {
    for (const data of [{itemId:'old'}, {items:[{itemId:'old'}]}, {oemSent:[{rawItemId:'old'}]}]) expect(codes(fixture({purchaseOrders:[doc('po',{companyId:'taebaek',status,...data})]}))).toContain('active-purchase-order');
  });
  it('OEM 미완료는 보호하되 완료·취소 발주와 이름뿐인 과거 원료를 추정하지 않는다', () => {
    expect(codes(fixture({purchaseOrders:[doc('po',{companyId:'taebaek',status:'received',oemIssueStatus:'failed',itemId:'old'})]}))).toContain('active-purchase-order');
    for (const data of [{status:'received',itemId:'old'}, {status:'cancelled',itemId:'old',oemIssueStatus:'failed'}, {status:'invoiced',itemId:'old',oemCancelledAt:'2026-10-01'}, {status:'received',oemSent:[{material:'같은 품목'}]}]) expect(buildCatalogItemMergePlan(fixture({purchaseOrders:[doc('po',{companyId:'taebaek',...data})]})).phase).toBe('ready');
  });
  it('대기 반품만 막고 처리·취소된 과거 반품은 삭제 계획에 넣지 않는다', () => {
    expect(codes(fixture({returnRequests:[doc('return',{companyId:'taebaek',status:'pending',items:[{itemId:'old'}]})]}))).toContain('pending-return');
    for (const status of ['processed','cancelled']) expect(buildCatalogItemMergePlan(fixture({returnRequests:[doc('return',{companyId:'taebaek',status,items:[{itemId:'old'}]})]})).phase).toBe('ready');
  });
  it.each([
    {rawConsumedLots:[{rawItemId:'old'}]}, {productConsumedLots:[{itemId:'old'}]},
    {itemInventory:{line:{applied:true,itemId:'product',rawConsumedLots:[{rawItemId:'old'}]}}},
    {itemInventory:{line:{applied:true,production:{stockDeltas:[{itemId:'old',delta:0}]}}}},
    {itemInventory:{line:{applied:true,production:{bomLines:[{parentItemId:'product',childItemId:'old'}]}}}},
    {shippedOut:true,inventorySnapshots:{shipment:{productConsumedLots:[{itemId:'old'}]}}},
  ])('진행 주문 하위의 현재 ID 복구 참조도 확인한다 %j', evidence => {
    expect(codes(fixture({activeOrders:[doc('order',{companyId:'taebaek',status:'PROCESSING',items:[{itemId:'product'}],...evidence})]}))).toContain('active-order');
  });
  it('취소된 품목별 증거·완료 주문 이력·이름뿐인 trace는 현재 ID 참조로 추정하지 않는다', () => {
    for (const evidence of [
      {status:'DELIVERED',rawConsumedLots:[{rawItemId:'old'}]},
      {status:'PROCESSING',itemInventory:{line:{applied:false,rawConsumedLots:[{rawItemId:'old'}]}}},
      {status:'PROCESSING',rawConsumedLots:[{material:'같은 품목',kg:1}]},
    ]) expect(buildCatalogItemMergePlan(fixture({activeOrders:[doc('order',{companyId:'taebaek',items:[{itemId:'product'}],...evidence})]})).phase).toBe('ready');
  });
});
describe('통합 최초 요청 정규화', () => {
  const request = () => ({ version: 1, companyId: 'taebaek', operationId: 'op', releaseId: 'release', keepId: 'keep', donorIds: ['z', 'a'], snapshotDigest: 'A'.repeat(64), resolutions: [{ destinationKey: '["p","in"]', sourceLinkId: 'source' }] });
  it('원문 키 순서와 대상 순서를 고정하고 원자료는 변경하지 않는다', () => {
    const input = request(), before = JSON.stringify(input), value = normalizeCatalogItemMergeRequest(input);
    expect(value.donorIds).toEqual(['a', 'z']); expect(value.snapshotDigest).toBe('a'.repeat(64));
    expect(serializeCatalogItemMergeRequest(value)).toBe(serializeCatalogItemMergeRequest({ ...value, donorIds: ['z', 'a'] }));
    expect(JSON.stringify(input)).toBe(before);
  });
  it.each([{ extra: true }, { donorIds: ['a', 'a'] }, { donorIds: ['keep'] }, { snapshotDigest: '' }, { keepId: ' keep' }, { resolutions: [{ destinationKey: '["p","in"]', sourceLinkId: 's' }, { destinationKey: '["p","in"]', sourceLinkId: 't' }] }])('잘못된 요청은 사본으로 저장하지 않는다 %j', patch => { expect(() => normalizeCatalogItemMergeRequest({ ...request(), ...patch })).toThrow(); });
});
