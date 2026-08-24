
import React, { useState, useMemo, useEffect } from 'react';
import { matchesSearch } from '../src/shared/hangul';
import { Plus, Edit, Search, Trash2, LayoutGrid, Link, X, Copy, ChevronDown, ChevronUp, ChevronRight, GitMerge, Save, Settings, Store, Package, User, Truck, ChevronLeft, Check } from 'lucide-react';
import { Item, InventoryCategory, Partner, PartnerItem, ItemBom, SubmaterialComponent } from '../types';
import ConfirmModal from './ConfirmModal';
import PageHeader from './PageHeader';
import CategoryManager from './CategoryManager';
import { buildTaxonomy, TaxonomyRow } from '../src/shared/taxonomy';
import { fetchCollection } from '../src/shared/services/firebaseService';
import { isBoxStockItem, unpackComponent, boxSiblings, groupLooseBoxRows } from '../src/shared/orderUnits';
import { bomOf, BomLine } from '../src/shared/bomIndex';
import { subDotClass } from '../src/shared/submaterialStyle';
import { ProductNameRow, ProductCard, renderColoredName, splitNameVolume, specText, catOrder, categoryChipClass } from '../src/shared/productChip';
import { isBulkItem } from '../src/shared/itemTaxonomy';

interface ItemManagerProps {
  items: Item[];
  partners: Partner[];
  partnerItems?: PartnerItem[];
  itemBoms?: ItemBom[];
  onEditProduct: (_product: Item) => void;
  onAddItem: () => void;
  onDeleteItem: (_id: string, _category: string) => void;
  onLinkItem: (_productId: string, _clientId: string) => void;
  onUnlinkItem: (_productId: string, _clientId: string) => void;
  onLinkSupplier?: (_productId: string, _supplierId: string) => void;
  onUnlinkSupplier?: (_productId: string, _supplierId: string) => void;
  onMergeItems?: (_keepId: string, _deleteIds: string[]) => Promise<void>;
  onSaveItemCustomer?: (_ic: Partial<PartnerItem> & { id: string }) => Promise<void>;
  onUpsertPartnerItem?: (_ps: PartnerItem) => void;
  /** 낱개 → 박스 품목 생성. 품목과 item_bom(낱개×개입수 + 겉박스·테이프)을 함께 만든다. */
  onCreateBoxItem?: (_unit: Item, _opts: { name: string; count: number; components: { id: string; qty: number }[] }) => Promise<void>;
  isAdmin?: boolean;
}

const inferSubtype = (item: { subtype?: string; name: string; type: string }): string => {
  if (item.subtype) return item.subtype;
  const n = item.name;
  if (n.includes('들기름')) return '들기름';
  if (n.includes('참기름')) return '참기름';
  if (n.includes('검정깨') || n.includes('검정참깨')) return '검정깨';
  if (n.includes('들깨')) return '들깨';
  if (n.includes('참깨')) return '참깨';
  if (n.includes('고춧가루')) return '고춧가루';
  if (n.includes('향미유')) return '향미유';
  return CATEGORY_LABELS[item.type] || item.type;
};

//  탭 이름·순서·숨김은 전부 분류 관리(itemTaxonomy)가 쥔다 — 여기 표는 저장본이 없을 때의 이름뿐이다.
const CATEGORY_LABELS: Record<string, string> = {
  product: '완제품', goods: '상품', wip: '반제품', raw: '원료',
  submaterial: '부자재',
};
const LINK_CATEGORIES = ['product', 'goods', 'wip', 'raw', 'submaterial'];
/**
 * 부자재 정렬 — **분류 관리에 적힌 순서 그대로.**
 *
 * 예전엔 라벨→용기→마개→테이프→박스를 코드에 박아 뒀다. 분류를 새로 만들면(비닐 같은)
 * 그 목록에 없어서 늘 맨 뒤로 밀렸고, 화면에서 순서를 바꿔도 여긴 안 따라왔다.
 * rankOf는 분류 관리 저장본에서 만든 순위다(아래 catRank).
 */
const sortSubs = (subs: BomLine[], rankOf: (l: BomLine) => number) =>
  [...subs].sort((a, b) => rankOf(a) - rankOf(b));

// ── 한글 초성 검색 ──
//  초성·겹자음 처리는 shared/hangul 하나뿐이다 — 복사본을 두면 화면마다 다르게 찾는다.
const matchKo = (name: string, q: string) => matchesSearch(name, q);

/**
 * 필터 드롭다운 하나 — 라벨 + 고른 값 + 펼치면 선택지(한 줄에 하나).
 * 재고관리(ItemList)와 같은 모양이다 — 화면마다 다르게 생기면 같은 일을 두 번 배운다.
 */
const FilterDrop: React.FC<{
  label: string; summary: string; active: boolean; width?: string;
  children: (close: () => void) => React.ReactNode;
}> = ({ label, summary, active, width = 'w-[240px]', children }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 border rounded-xl px-2.5 py-1.5 text-[11px] font-black bg-white outline-none transition-all max-w-[200px] ${
          active ? 'border-indigo-300 text-indigo-700' : 'border-slate-200 text-slate-500 hover:border-slate-400'}`}>
        <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest shrink-0">{label}</span>
        <span className="truncate">{summary}</span>
        <ChevronDown size={11} className="shrink-0 opacity-50"/>
      </button>
      {open && (<>
        <div className="fixed inset-0 z-30" onClick={() => setOpen(false)}/>
        <div className={`absolute left-0 top-full mt-1.5 z-40 ${width} max-w-[90vw] bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden`}>
          {children(() => setOpen(false))}
        </div>
      </>)}
    </div>
  );
};

const FilterRow: React.FC<{ on: boolean; onClick: () => void; children: React.ReactNode; tone?: string }> =
  ({ on, onClick, children, tone = 'text-indigo-600 bg-indigo-50' }) => (
    <button type="button" onClick={onClick}
      className={`w-full text-left px-3 py-2 text-[11px] font-black transition-colors flex items-center justify-between gap-2 ${
        on ? tone : 'text-slate-500 hover:bg-slate-50'}`}>
      <span className="truncate">{children}</span>
      {on && <Check size={12} className="shrink-0"/>}
    </button>
  );

/**
 * 등급(골드·A·분·특·특A·원액) — 재고관리와 같은 규칙.
 * A·특은 정확일치라야 한다(부분포함이면 '골드A'·'특A'·'특골드'가 죄다 걸린다).
 */
const GRADES = ['골드', 'A', '분', '특', '특A', '원액'] as const;
const matchGrade = (p: Item, g: string): boolean => {
  const toks = `${(p as { 품목?: string }).품목 ?? ''}/${p.name}`.split(/[/()]/).map(t => t.trim());
  return (g === 'A' || g === '특') ? toks.some(t => t === g) : toks.some(t => t.includes(g));
};

/** 용량은 개입수를 뗀 낱개 용량으로 묶는다 — '1kg * 20'과 '1kg'은 같은 용량이다 */
const baseSpec = (sp?: string) => String(sp ?? '').split(/[*x×]/)[0].trim();

const ItemManager: React.FC<ItemManagerProps> = ({ items, partners, partnerItems = [], itemBoms = [], onEditProduct, onAddItem, onDeleteItem, onLinkItem, onUnlinkItem, onLinkSupplier, onUnlinkSupplier, onMergeItems, onSaveItemCustomer, onUpsertPartnerItem, onCreateBoxItem, isAdmin = true }) => {
  // ── 박스 품목 만들기 ──
  // 낱개에서 'N개입' 박스 품목을 만든다. BOM = 낱개×N + 겉박스·테이프(고르면).
  // 이름·id는 기존 규칙을 따라 자동으로 채우고('{낱개} (N개입)' / box-{낱개id}-{N}) 편집 가능.
  const [boxModal, setBoxModal] = useState<Item | null>(null);
  const [boxForm, setBoxForm] = useState<{ name: string; count: string; comps: { id: string; qty: string }[] }>({ name: '', count: '10', comps: [] });
  const openBoxModal = (unit: Item) => {
    setBoxModal(unit);
    setBoxForm({ name: `${unit.name} (10개입)`, count: '10', comps: [] });
  };
  // 개입수를 바꾸면 이름도 따라 바뀐다 — 단, 이름을 직접 고쳤으면 건드리지 않는다.
  const setBoxCount = (v: string) => setBoxForm(f => {
    const auto = boxModal ? `${boxModal.name} (${f.count}개입)` : '';
    return { ...f, count: v, name: f.name !== auto ? f.name : `${boxModal?.name ?? ''} (${v}개입)` };
  });
  const saveBoxItem = async () => {
    if (!boxModal || !onCreateBoxItem) return;
    const count = parseFloat(boxForm.count) || 0;
    if (count <= 0) { window.alert('개입수를 입력하세요.'); return; }
    const name = boxForm.name.trim() || `${boxModal.name} (${count}개입)`;
    if (items.some(i => !i.archived && i.name === name)) { window.alert('같은 이름의 품목이 이미 있습니다.'); return; }
    await onCreateBoxItem(boxModal, {
      name, count,
      components: boxForm.comps.filter(c => c.id).map(c => ({ id: c.id, qty: parseFloat(c.qty) || 0 })),
    });
    setBoxModal(null);
  };

  const products = items;
  const itemCustomers = partnerItems;
  //  BOM 줄의 자식 품목 — 부자재 칩 정렬이 제 카테고리(용기·마개·라벨)를 봐야 해서 필요하다.
  const itemById = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);
  const subCatOf = (l: BomLine) => String(l.child?.category ?? '');
  //  분류 관리에 없는 카테고리(또는 카테고리가 빈 품목)는 맨 뒤로.
  const subRank = (l: BomLine) => catRank.get(subCatOf(l)) ?? Number.MAX_SAFE_INTEGER;
  /**
   * BOM 한 줄 — "마개 이중캡 골드 ×2" 꼴로 **카테고리를 앞에 단다.**
   * 이름만 깔아 두면 목록에서 그게 용기인지 마개인지 라벨인지 안 갈린다.
   * 근거는 자식 품목의 category다(SubmaterialComponent.category엔 자식의 type이 들어 있다).
   */
  /**
   * BOM 수량 표시 — **저장은 언제나 kg**이라 기름은 그대로 찍으면 실제 용량보다 작아 보인다.
   * 300ml 병에 든 들기름은 0.2772kg으로 저장된다 — 'L'로 보여줄 땐 밀도로 나눠야 0.3L이 나온다.
   */
  const bomQtyLabel = (l: BomLine) => {
    const d = l.child?.density;
    const v = d ? Math.round((l.qty / d) * 10000) / 10000 : l.qty;
    const u = l.child?.unit;
    return d ? `${v}${u ?? 'L'}` : String(v);
  };

  const bomChip = (l: BomLine, i: number) => {
    const cat = subCatOf(l);
    return (
      <span key={`${l.childId}-${i}`} className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 whitespace-nowrap">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${subDotClass(l.child)}`} />
        {cat && <span className="text-slate-400">{cat}</span>}
        {l.child?.name ?? l.childId}
        {l.qty !== 1 && <span className="text-slate-300">×{bomQtyLabel(l)}</span>}
      </span>
    );
  };
  const partnerOut = partnerItems.filter(pi => pi.Direction === 'out');
  const partnerIn = partnerItems.filter(pi => pi.Direction === 'in');
  const [mainView, setMainView] = useState<'flat' | 'by-partner'>(isAdmin ? 'flat' : 'by-partner');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(true);
  const [showNoClient, setShowNoClient] = useState(false);
  const [activeCategory, setActiveCategory] = useState<InventoryCategory>('product');
  /**
   * 분류 3단으로 좁힌다 — 타입 > 서브타입 > 카테고리. 빈 문자열이면 '전체'.
   * 위 단을 바꾸면 아래 단은 푼다(반제품에 '낱개'가 남아 있으면 아무것도 안 나온다).
   */
  const [activeSubtype, setActiveSubtype] = useState('');
  const [activeItemCat, setActiveItemCat] = useState('');
  const [activeSpec, setActiveSpec] = useState('');    // 용량 — 하나
  const [activeGrade, setActiveGrade] = useState('');  // 등급 — 하나
  const pickType = (t: InventoryCategory) => { setActiveCategory(t); setActiveSubtype(''); setActiveItemCat(''); setActiveSpec(''); setActiveGrade(''); setPage(1); };
  const pickSubtype = (v: string) => { setActiveSubtype(v); setActiveItemCat(''); setPage(1); };
  /** 용량 후보 — 지금 타입에 실제로 쓰이는 규격만(개입수는 뗀다) */
  const specOptions = useMemo(() => {
    const set = new Set(items.filter(p => !p.archived && p.type === activeCategory).map(p => baseSpec(p.spec)).filter(Boolean));
    const rank = (v: string): [number, number] => {
      const m = v.match(/([\d.]+)\s*(ml|l|g|kg)/i);
      if (!m) return [2, 0];
      const n = Number(m[1]); const u = m[2].toLowerCase();
      if (u === 'ml') return [0, n];
      if (u === 'l') return [0, n * 1000];
      if (u === 'g') return [1, n];
      return [1, n * 1000];
    };
    return [...set].sort((a, b) => { const [ka, va] = rank(a), [kb, vb] = rank(b); return ka !== kb ? ka - kb : va - vb; });
  }, [items, activeCategory]);
  const [partnerAllCats, setPartnerAllCats] = useState(true); // 거래처별 뷰: 전체 카테고리(연결된 전 품목) 표시
  const [searchTerm, setSearchTerm] = useState('');
  const [partnerSearch, setClientSearch] = useState('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;
  const [linkSearch, setLinkSearch] = useState('');
  const [showLinkPanel, setShowLinkPanel] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{ message: string; subMessage?: string; onConfirm: () => void } | null>(null);
  const [linkCategory, setLinkCategory] = useState('product');
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false); // 분류 관리(품목관리로 이동)
  // 분류 체계 — 타입 탭 이름·순서·숨김, 부자재 칩 정렬이 전부 이걸 본다. 저장본이 없으면 기본값.
  const [taxonomyRows, setTaxonomyRows] = useState<TaxonomyRow[]>([]);
  useEffect(() => { fetchCollection<TaxonomyRow>('itemTaxonomy').then(setTaxonomyRows).catch(() => {}); }, [categoryManagerOpen]);
  const taxo = useMemo(() => buildTaxonomy(taxonomyRows), [taxonomyRows]);
  /**
   * 카테고리 순위 — 분류 관리에 보이는 순서를 그대로 편다(타입 순서 → 그 안의 카테고리 순서).
   * 사장님 저장본은 부자재가 첫 타입이라 용기·마개·라벨이 앞에 서고 원료·완제품 계열이 뒤에 선다.
   */
  const catRank = useMemo(() => {
    const m = new Map<string, number>();
    let n = 0;
    for (const t of taxo.allTypes) for (const c of taxo.categoriesOf(t.key)) if (!m.has(c)) m.set(c, n++);
    return m;
  }, [taxo]);
  // 분류를 쓰는 품목 수 — 삭제 경고용
  const taxonomyUsage = useMemo(() => {
    const u: Record<string, number> = {};
    for (const p of items) {
      if (p.archived) continue;
      const t = p.type, sub = p.subtype, cat = p.category;
      u[`type:${t}`] = (u[`type:${t}`] ?? 0) + 1;
      if (sub) u[`sub:${t}:${sub}`] = (u[`sub:${t}:${sub}`] ?? 0) + 1;
      if (cat) u[`cat:${t}:${cat}`] = (u[`cat:${t}:${cat}`] ?? 0) + 1;
    }
    return u;
  }, [items]);
  const [partnerTypeFilter, setClientTypeFilter] = useState<string | null>(null);
  const [expandedClientRowId, setExpandedClientRowId] = useState<string | null>(null);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [dupExpandedKeys, setDupExpandedKeys] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const [selectedKeepId, setSelectedKeepId] = useState<Record<string, string>>({});
  const [selectedMergeIds, setSelectedMergeIds] = useState<Record<string, Set<string>>>({});
  const [editingIc, setEditingIc] = useState<Record<string, Partial<PartnerItem>>>({});
  const [partnerTab, setPartnerTab] = useState<'sales' | 'purchase'>('sales');
  const [partnerScopeTab, setClientScopeTab] = useState<'sales' | 'purchase'>('sales');
  const [salesPriceEdits, setSalesPriceEdits] = useState<Record<string, string>>({});
  // 카드에서 고른 변형(낱개/N개입) — 낱개 id → 보여줄 품목 id
  const [variantPick, setVariantPick] = useState<Record<string, string>>({});

  const TYPE_ORDER: Record<string, number> = { '일반': 0, '택배': 1, '스마트스토어': 2 };
  const salesClients = useMemo(() =>
    partners
      .filter(c => !c.partnerType || c.partnerType === '매출처' || c.partnerType === '매출+매입처')
      .sort((a, b) => {
        const tDiff = (TYPE_ORDER[a.type] ?? 0) - (TYPE_ORDER[b.type] ?? 0);
        return tDiff !== 0 ? tDiff : a.name.localeCompare(b.name, 'ko');
      }),
    [partners]
  );
  const purchaseClients = useMemo(() =>
    partners
      .filter(c => c.partnerType === '매입처' || c.partnerType === '매출+매입처')
      .sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    [partners]
  );
  const activePartnerClients = partnerTab === 'sales' ? salesClients : purchaseClients;

  const duplicateGroups = useMemo(() => {
    const finished = items.filter(p => !p.archived && ['product', 'wip'].includes(p.type));
    const pcByProduct: Record<string, PartnerItem[]> = {};
    for (const pc of partnerOut) {
      const key = pc.itemId;
      if (!key) continue;
      if (!pcByProduct[key]) pcByProduct[key] = [];
      pcByProduct[key].push(pc);
    }
    const subMap = Object.fromEntries(items.map(p => [p.id, p.name]));

    /**
     * 중복 판정 = **이름 + BOM**. 구성이 다르면 다른 물건이다.
     *
     *   낱개  볶음참깨-낱개/1kg      ← 벌크 ×1
     *   박스  볶음참깨/1kg (10개입)  ← 낱개 ×10 + 겉박스 + 테이프
     *
     * 구성이 통째로 다르니 한 그룹에 못 들어간다. 예전엔 용기·마개 이름만 봤는데
     * BOM 파생(buildSubmaterialsFromBom)이 category에 자식의 **type**을 넣게 되면서
     * 그 필터가 아무것도 안 걸러, 사실상 **이름만으로** 묶고 있었다.
     */
    const bomKey = (p: Item) => bomOf(p.id)
      .map(l => `${l.childId}×${l.qty}`)
      .sort()
      .join(',');

    const groups: Record<string, typeof finished> = {};
    for (const p of finished) {
      const key = `${p.name}||${bomKey(p)}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    }

    return Object.entries(groups)
      .filter(([, prods]) => prods.length > 1)
      .map(([key, prods]) => {
        //  한 그룹은 이름도 BOM도 같다 — 구성은 아무거나 하나에서 뽑으면 그룹 전체를 대표한다.
        //  예전엔 라벨이 다르면 '통합 불가'로 갈랐는데, 라벨도 BOM이라 이제 그런 그룹 자체가 안 생긴다.
        const items = prods.map(p => ({
          product: p,
          pcs: pcByProduct[p.id] || [],
          directClients: [...new Set([...(p.partnerIds || [])])],
          subMap,
        }));
        return { key, name: key.split('||')[0], subs: bomOf(prods[0].id), items };
      });
  }, [products, partnerItems]);

  // 삭제/통합된 품목을 가리키는 유령 연결은 카운트에서 제외 (목록과 개수 일치)
  const validItemIds = useMemo(() => new Set(items.filter(p => !p.archived).map(p => p.id)), [items]);

  const partnerItemCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const pc of partnerOut) {
      const cid = pc.partnerId ?? (pc as any).partnerId;
      const iid = pc.itemId ?? (pc as any).itemId;
      if (cid && validItemIds.has(iid)) map.set(cid, (map.get(cid) ?? 0) + 1);
    }
    return map;
  }, [partnerItems, validItemIds]);

  const inboundPartnerItemCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const ps of partnerIn) {
      const sid = ps.partnerId;
      const iid = ps.itemId;
      if (sid && validItemIds.has(iid)) map.set(sid, (map.get(sid) ?? 0) + 1);
    }
    return map;
  }, [partnerItems, validItemIds]);

  const filteredClients = useMemo(() =>
    activePartnerClients.filter(c =>
      matchKo(c.name, partnerSearch) &&
      (!partnerTypeFilter || c.type === partnerTypeFilter)
    ),
    [activePartnerClients, partnerSearch, partnerTypeFilter]
  );

  const handleClientTypeFilter = (type: string) => {
    const next = partnerTypeFilter === type ? null : type;
    setClientTypeFilter(next);
    if (next && selectedClientId) {
      const cur = partners.find(c => c.id === selectedClientId);
      if (cur && cur.type !== next) {
        setSelectedClientId(null);
        setShowAll(false);
      }
    }
  };

  const selectedClient = selectedClientId ? partners.find(c => c.id === selectedClientId) : null;

  const filteredItems = useMemo(() => {
    const isByClientPurchase = mainView === 'by-partner' && partnerScopeTab === 'purchase' && selectedClientId;
    let result = mainView === 'flat' || showAll || showNoClient
      ? items.filter(p => !p.archived && p.type === activeCategory)
      : selectedClientId
        ? isByClientPurchase
          ? items.filter(p => !p.archived && partnerIn.some(ps => (ps.itemId) === p.id && (ps.partnerId) === selectedClientId))
          : items.filter(p => !p.archived && (partnerAllCats || p.type === activeCategory) && (p.partnerIds ?? []).includes(selectedClientId))
        : [];

    if (showNoClient) {
      result = result.filter(p => (p.partnerIds ?? []).length === 0);
    }

    //  고른 만큼만 좁힌다 — 안 고른 단은 거르지 않는다.
    if (activeSubtype) result = result.filter(p => (p.subtype ?? '') === activeSubtype);
    if (activeItemCat) result = result.filter(p => (p.category ?? '') === activeItemCat);
    if (activeSpec) result = result.filter(p => baseSpec(p.spec) === activeSpec);
    if (activeGrade) result = result.filter(p => matchGrade(p, activeGrade));

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      if (mainView === 'flat') {
        result = result.filter(p =>
          p.name.toLowerCase().includes(term) ||
          partners.some(c => (p.partnerIds ?? []).includes(c.id) && c.name.toLowerCase().includes(term))
        );
      } else {
        result = result.filter(p => p.name.toLowerCase().includes(term) || p.id.toLowerCase().includes(term));
      }
    }
    // 카테고리 순 → 같은 카테고리 안에서는 이름 순.
    // 참기름·들기름·깨류 순서가 실제로 보는 순서라 이름 순만으로는 섞여 보인다.
    return [...result].sort((a, b) => {
      const d = catOrder(inferSubtype(a)) - catOrder(inferSubtype(b));
      return d !== 0 ? d : a.name.localeCompare(b.name, 'ko');
    });
  }, [products, activeCategory, activeSubtype, activeItemCat, activeSpec, activeGrade, selectedClientId, showAll, showNoClient, searchTerm, mainView, partners, partnerScopeTab, partnerItems, partnerAllCats]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedItems = filteredItems.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  //  박스는 제 낱개 밑에 붙인다. **묶고 나서** 쪽을 나눠야 둘이 다른 쪽으로 안 갈린다.
  const pagedRows = useMemo(
    () => groupLooseBoxRows(filteredItems).slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filteredItems, safePage],
  );

  const handleSelectClient = (id: string) => {
    setSelectedClientId(id);
    setShowAll(false);
    setShowNoClient(false);
    setPartnerAllCats(true); // 거래처 선택 시 연결된 전체 품목이 기본
    setPage(1);
    setSearchTerm('');
    setClientScopeTab(partnerTab);
  };

  const handleShowAll = () => {
    setSelectedClientId(null);
    setShowAll(true);
    setShowNoClient(false);
    setPage(1);
    setSearchTerm('');
  };

  // 클라이언트 목록 패널 (공통)
  const clientListPanel = (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={14} />
        <input
          type="text"
          placeholder="거래처 검색..."
          value={partnerSearch}
          onChange={e => setClientSearch(e.target.value)}
          className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs font-bold outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all"
        />
      </div>
      <div className="flex gap-1">
        {([['일반 거래처', '일반'], ['택배사/대행', '택배'], ['스마트스토어', '스마트스토어']] as const).map(([label, type]) => (
          <button
            key={type}
            onClick={() => handleClientTypeFilter(type)}
            className={`flex-1 px-1.5 py-1.5 rounded-lg text-[9px] font-black transition-all whitespace-nowrap ${
              partnerTypeFilter === type
                ? 'bg-indigo-600 text-white shadow'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex flex-col overflow-y-auto max-h-[calc(100vh-280px)] divide-y divide-slate-100">
        {filteredClients.map(c => {
          const count = partnerItemCount.get(c.id) ?? 0;
          const isSelected = selectedClientId === c.id;
          return (
            <button
              key={c.id}
              onClick={() => handleSelectClient(c.id)}
              className={`flex items-center justify-between px-3 py-2.5 text-left transition-all ${
                isSelected
                  ? 'bg-indigo-600 text-white'
                  : 'hover:bg-slate-50 text-slate-700'
              }`}
            >
              <span className={`text-xs font-bold truncate ${isSelected ? 'text-white' : ''}`}>{c.name}</span>
              {count > 0 && (
                <span className={`text-[10px] font-black shrink-0 ml-2 ${isSelected ? 'text-indigo-200' : 'text-indigo-400'}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
        {filteredClients.length === 0 && (
          <p className="text-center text-slate-400 text-xs py-6">거래처 없음</p>
        )}
      </div>
    </div>
  );

  // 연결 가능한 품목 (모달 카테고리 기준, 이미 연결된 것 제외)
  const linkableProduts = useMemo(() => {
    if (!selectedClientId) return [];
    const term = linkSearch.toLowerCase().trim();
    const alreadyLinked = partnerScopeTab === 'purchase'
      ? new Set(partnerIn.filter(ps => (ps.partnerId) === selectedClientId).map(ps => ps.itemId))
      : null;
    return products
      .filter(p => p.type === linkCategory && (alreadyLinked ? !alreadyLinked.has(p.id) : !(p.partnerIds ?? []).includes(selectedClientId)))
      .filter(p => !term || p.name.toLowerCase().includes(term))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }, [products, selectedClientId, linkCategory, linkSearch, partnerScopeTab, partnerIn]);

  // 품목 테이블 패널 (공통)
  // 거래처별 뷰는 위에 헤더(메인탭+거래처명+매출/매입토글)가 더 쌓이므로 데스크톱 고정높이 오프셋을 키운다.
  // 모바일에서는 고정높이를 주지 않고 페이지 자체가 스크롤되게 한다.
  const panelHeightClass = (mainView === 'by-partner' && selectedClientId)
    ? 'lg:h-[calc(100vh-330px)]'
    : 'lg:h-[calc(100vh-240px)]';
  const productPanel = (
    <div className="flex flex-col gap-3 min-w-0">
      {/* 모바일 — 신규 등록은 아래 탭 줄에 이미 있다(중복이라 뺐다).
          거래처를 고른 상태에서는 여기에 '품목 연결'을 둔다. */}
      {isAdmin && mainView === 'by-partner' && selectedClientId && (
        <div className="flex items-center justify-end lg:hidden">
          <button
            onClick={() => { setShowLinkPanel(true); setLinkSearch(''); setLinkCategory('product'); }}
            className="flex items-center gap-1.5 bg-emerald-600 text-white px-4 py-2 rounded-xl font-black text-xs shadow-md active:scale-95 transition-all"
          >
            <Link size={14} />
            품목 연결
          </button>
        </div>
      )}

      <div className="hidden lg:flex items-center justify-between">
        {/* 거래처를 고르면 아래 파란 바가 이름·품목수를 이미 보여준다 → 여기선 숨긴다(중복) */}
        <div>
          {showAll && (
            <>
              <h3 className="text-lg font-black text-slate-900">전체 품목</h3>
              <p className="text-xs text-slate-400 font-medium">모든 품목</p>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* 신규 품목은 '분류 관리' 옆으로, 품목 연결은 거래처 바 안으로 모았다.
              같은 동작을 여러 자리에 두면 어디가 진짜인지 헷갈린다. */}
        </div>
      </div>

      <div className={`bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col ${panelHeightClass} ${mainView === 'by-partner' && selectedClientId ? 'lg:w-3/4 lg:mx-auto' : ''}`}>
        <div className="p-3 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center gap-2">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar flex-1">
            {(isAdmin || (!isAdmin && !selectedClientId)) && (() => {
              const inPartner = mainView === 'by-partner' && !!selectedClientId;
              const active = inPartner ? partnerAllCats : (showAll && !showNoClient);
              return (
                <button
                  onClick={() => { if (inPartner) { setPartnerAllCats(true); } else { handleShowAll(); } setPage(1); }}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all border whitespace-nowrap flex items-center gap-1 ${
                    active
                      ? 'bg-indigo-600 border-indigo-600 text-white shadow'
                      : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'
                  }`}
                >
                  <LayoutGrid size={11} />
                  전체 품목
                </button>
              );
            })()}
            {isAdmin && mainView !== 'by-partner' && (
              <button
                onClick={() => { setShowNoClient(p => !p); setShowAll(true); setSelectedClientId(null); setPage(1); }}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all border whitespace-nowrap flex items-center gap-1 ${
                  showNoClient
                    ? 'bg-rose-500 border-rose-500 text-white shadow'
                    : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'
                }`}
              >
                거래처 없는 것만
              </button>
            )}
            {isAdmin && taxo.types.map(t => t.key as InventoryCategory).map(cat => {
              const inPartner = mainView === 'by-partner' && !!selectedClientId;
              const active = inPartner ? (!partnerAllCats && activeCategory === cat) : (activeCategory === cat);
              return (
                <button
                  key={cat}
                  onClick={() => { setPartnerAllCats(false); pickType(cat); }}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all border whitespace-nowrap ${
                    active
                      ? 'bg-indigo-600 border-indigo-600 text-white shadow'
                      : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'
                  }`}
                >
                  {taxo.labelOf(cat)}
                </button>
              );
            })}
          </div>
          <div className="relative shrink-0 w-full sm:w-44">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={13} />
            <input
              type="text"
              placeholder="품목명 검색..."
              value={searchTerm}
              onChange={e => { setSearchTerm(e.target.value); setPage(1); }}
              className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs font-bold outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all"
            />
          </div>
        </div>

        {/* 서브타입 · 카테고리 — 위 단을 골라야 아래 단이 뜬다(분류 관리 순서 그대로) */}
        {isAdmin && (() => {
          const subs = taxo.subtypesOf(activeCategory);
          const cats = taxo.categoriesOf(activeCategory);
          if (subs.length === 0 && cats.length === 0 && specOptions.length === 0) return null;
          //  재고관리와 같은 드롭다운 줄 — 서브타입·분류·용량·등급.
          return (
            <div className="px-3 py-2 border-b border-slate-100 bg-white flex items-center gap-2 flex-wrap">
              {subs.length > 0 && (
                <FilterDrop label="서브타입" active={!!activeSubtype} summary={activeSubtype || '전체'}>
                  {close => (
                    <div className="max-h-[280px] overflow-y-auto py-1">
                      <FilterRow on={!activeSubtype} onClick={() => { pickSubtype(''); close(); }}>전체</FilterRow>
                      {subs.map(v => (
                        <FilterRow key={v} on={activeSubtype === v} onClick={() => { pickSubtype(v); close(); }}>{v}</FilterRow>
                      ))}
                    </div>
                  )}
                </FilterDrop>
              )}
              {cats.length > 0 && (
                <FilterDrop label="분류" active={!!activeItemCat} summary={activeItemCat || '전체'}>
                  {close => (
                    <div className="max-h-[280px] overflow-y-auto py-1">
                      <FilterRow on={!activeItemCat} onClick={() => { setActiveItemCat(''); setPage(1); close(); }}>전체</FilterRow>
                      {cats.map(v => (
                        <FilterRow key={v} on={activeItemCat === v} onClick={() => { setActiveItemCat(v); setPage(1); close(); }}>{v}</FilterRow>
                      ))}
                    </div>
                  )}
                </FilterDrop>
              )}
              {specOptions.length > 0 && (
                <FilterDrop label="용량" active={!!activeSpec} summary={activeSpec || '전체'}>
                  {close => (
                    <div className="max-h-[280px] overflow-y-auto py-1">
                      <FilterRow on={!activeSpec} onClick={() => { setActiveSpec(''); setPage(1); close(); }}>전체</FilterRow>
                      {specOptions.map(v => (
                        <FilterRow key={v} on={activeSpec === v} tone="text-sky-600 bg-sky-50"
                          onClick={() => { setActiveSpec(v); setPage(1); close(); }}><span className="tabular-nums">{v}</span></FilterRow>
                      ))}
                    </div>
                  )}
                </FilterDrop>
              )}
              <FilterDrop label="등급" width="w-[180px]" active={!!activeGrade} summary={activeGrade || '전체'}>
                {close => (
                  <div className="py-1">
                    <FilterRow on={!activeGrade} onClick={() => { setActiveGrade(''); setPage(1); close(); }}>전체</FilterRow>
                    {GRADES.map(g => (
                      <FilterRow key={g} on={activeGrade === g} tone="text-amber-600 bg-amber-50"
                        onClick={() => { setActiveGrade(activeGrade === g ? '' : g); setPage(1); close(); }}>{g}</FilterRow>
                    ))}
                  </div>
                )}
              </FilterDrop>
              {(activeSubtype || activeItemCat || activeSpec || activeGrade) && (
                <button onClick={() => { setActiveSubtype(''); setActiveItemCat(''); setActiveSpec(''); setActiveGrade(''); setPage(1); }}
                  className="px-2.5 py-1.5 rounded-xl text-[11px] font-black text-slate-400 hover:bg-slate-100 transition-colors">모두 해제</button>
              )}
            </div>
          );
        })()}

        {/* 거래처별 품목 — 주문 생성 화면과 같은 카드 그리드로 본다.
            (품목 목록 뷰는 열이 많아 표가 낫다 → 아래 표를 그대로 쓴다) */}
        {mainView === 'by-partner' && selectedClientId ? (
          <div className="overflow-y-auto lg:flex-1 px-4 pb-4">
            {pagedItems.length === 0 ? (
              <p className="py-16 text-center text-slate-400 font-medium text-sm">이 거래처에 연결된 품목이 없습니다.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {(() => {
                  // 낱개 + 그 박스들을 한 카드로 묶는다(주문 생성과 같은 방식).
                  //   · 박스만 연결돼 있으면 그 박스가 앵커가 된다
                  //   · 짝이 없으면 낱개 하나만 → 상단 토글 없음
                  const shown = new Set(pagedItems.map(p => p.id));
                  const anchors: { anchor: Item; variants: { item: Item; label: string }[] }[] = [];
                  const taken = new Set<string>();
                  for (const p of pagedItems) {
                    if (taken.has(p.id)) continue;
                    const uc = unpackComponent(p);
                    // 박스면 그 낱개가 이 거래처에도 연결돼 있을 때만 낱개를 앵커로 삼는다
                    const loose = uc && shown.has(uc.itemId) ? pagedItems.find(x => x.id === uc.itemId)! : p;
                    if (taken.has(loose.id)) continue;
                    const sibs = boxSiblings(loose, pagedItems);
                    const variants = [
                      ...(shown.has(loose.id) ? [{ item: loose, label: '낱개' }] : []),
                      ...sibs.map(s => ({ item: s.item as Item, label: `${s.count}개입` })),
                    ];
                    variants.forEach(v => taken.add(v.item.id));
                    anchors.push({ anchor: loose, variants });
                  }
                  return anchors.map(({ anchor, variants }) => {
                    const activeId = variantPick[anchor.id] && variants.some(v => v.item.id === variantPick[anchor.id])
                      ? variantPick[anchor.id] : variants[0]?.item.id ?? anchor.id;
                    const item = variants.find(v => v.item.id === activeId)?.item ?? anchor;
                    return (
                <React.Fragment key={anchor.id}>
                {(() => {
                  const subs = bomOf(item.id)
                    .map(l => l.child)
                    .filter((c): c is Item => !!c && c.type === 'submaterial' && !isBulkItem(c) && !c.phantom);
                  // 겉박스·테이프는 박스 품목 BOM에 들어 있다 — 거래처별 포장설정은 폐기했다.
                  return (
                    <ProductCard key={item.id} product={item} subs={subs}
                      categoryLabel={inferSubtype(item)}
                      topChips={<>
                        {/* 낱개↔박스 전환 — 짝이 없으면 안 뜬다 */}
                        {variants.length > 1 && variants.map(v => (
                          <button key={v.item.id} type="button"
                            onClick={() => setVariantPick(prev => ({ ...prev, [anchor.id]: v.item.id }))}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-black border transition-all ${
                              activeId === v.item.id ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-slate-400 hover:border-indigo-300'
                            }`}>{v.label}</button>
                        ))}
                      </>}
                    >
                      <div className="flex items-center justify-between gap-1 pt-1.5 border-t border-slate-50 flex-wrap">
                        {/* 원가 · 판매단가 — 표에서 쓰던 것과 같은 동작(관리자만) */}
                        <div className="flex items-center gap-1.5 min-w-0">
                          {isAdmin && (
                            <span className="text-[11px] font-bold text-slate-400 whitespace-nowrap">
                              원가 {item.cost != null ? item.cost.toLocaleString() : '-'}
                            </span>
                          )}
                          {isAdmin && partnerScopeTab === 'sales' && (() => {
                            const psOut = partnerOut.find(ps => ps.itemId === item.id && ps.partnerId === selectedClientId);
                            const curPrice = psOut?.price;
                            const editKey = `${item.id}_${selectedClientId}`;
                            const editVal = salesPriceEdits[editKey];
                            const savePrice = () => {
                              if (editVal === undefined || !onUpsertPartnerItem) return;
                              const num = editVal === '' ? 0 : Number(editVal);
                              if (isNaN(num)) return;
                              onUpsertPartnerItem({ ...(psOut ?? {}), id: psOut?.id ?? `${item.id}_${selectedClientId}_out`, itemId: item.id, partnerId: selectedClientId, Direction: 'out', price: num } as PartnerItem);
                              setSalesPriceEdits(prev => { const n = { ...prev }; delete n[editKey]; return n; });
                            };
                            const cancelEdit = () => setSalesPriceEdits(prev => { const n = { ...prev }; delete n[editKey]; return n; });
                            return editVal === undefined ? (
                              <button
                                onClick={e => { e.stopPropagation(); setSalesPriceEdits(prev => ({ ...prev, [editKey]: String(curPrice ?? '') })); }}
                                className="flex items-center gap-1 text-[11px] font-black px-1.5 py-0.5 rounded-md hover:bg-indigo-50 transition-all whitespace-nowrap"
                                title="판매단가 수정">
                                <span className={curPrice != null ? 'text-slate-700' : 'text-slate-300'}>
                                  {curPrice != null ? Number(curPrice).toLocaleString() : '미설정'}
                                </span>
                                <Edit size={11} className="text-slate-400 shrink-0" />
                              </button>
                            ) : (
                              <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                <input
                                  type="number" min={0} autoFocus value={editVal} placeholder="단가"
                                  onChange={e => setSalesPriceEdits(prev => ({ ...prev, [editKey]: e.target.value }))}
                                  onKeyDown={e => { if (e.key === 'Enter') savePrice(); if (e.key === 'Escape') cancelEdit(); }}
                                  className="w-16 text-right bg-white border border-indigo-300 rounded-lg px-2 py-1 text-[11px] font-bold outline-none focus:ring-2 focus:ring-indigo-400"
                                />
                                <button onClick={savePrice} className="p-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 shrink-0" title="저장"><Save size={12} /></button>
                                <button onClick={cancelEdit} className="p-1 rounded-md text-slate-400 hover:bg-slate-100 shrink-0" title="취소"><X size={12} /></button>
                              </div>
                            );
                          })()}
                        </div>
                        {/* 연결 해제는 관리자만 — 직원 뷰는 보기 전용 */}
                        {isAdmin && (
                          <button
                            onClick={() => {
                              if (partnerScopeTab === 'purchase' && onUnlinkSupplier) onUnlinkSupplier(item.id, selectedClientId);
                              else onUnlinkItem(item.id, selectedClientId);
                            }}
                            className="shrink-0 text-[11px] font-black text-rose-500 bg-rose-50 hover:bg-rose-100 px-2 py-1 rounded-lg transition-all"
                          >해제</button>
                        )}
                      </div>
                    </ProductCard>
                  );
                })()}
                </React.Fragment>
                    );
                  });
                })()}
              </div>
            )}
          </div>
        ) : (
        <div className="overflow-x-auto lg:overflow-y-auto lg:flex-1">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="px-2 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">카테고리</th>
                <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest min-w-[100px]">품목 정보</th>
                {!(mainView === 'by-partner' && selectedClientId) && activeCategory === 'product' && <th className="px-2 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">거래처</th>}
                {!(mainView === 'by-partner' && selectedClientId) && activeCategory !== 'product' && <th className="px-2 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">매입거래처</th>}
                {/* 부자재는 BOM 그대로 한 칸에 — 용기·마개·라벨로 칸을 갈라 두면 그 셋 말고는 못 보여준다. */}
                <th className="px-2 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">부자재</th>
                {isAdmin && <th className="px-2 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap text-right">원가</th>}
                {(isAdmin && mainView === 'by-partner' && selectedClientId && partnerScopeTab === 'sales') && <th className="px-2 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap text-right">판매단가</th>}
                {(isAdmin || (mainView === 'by-partner' && !!selectedClientId)) && <th className="px-2 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {!selectedClientId && !showAll ? (
                <tr>
                  <td colSpan={isAdmin ? 6 : 5} className="px-6 py-16 text-center text-slate-300 font-medium text-sm">
                    거래처를 선택하세요.
                  </td>
                </tr>
              ) : pagedItems.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 6 : 5} className="px-6 py-16 text-center text-slate-400 font-medium text-sm">
                    {showAll ? '등록된 품목이 없습니다.' : '이 거래처에 연결된 품목이 없습니다.'}
                  </td>
                </tr>
              ) : (
                pagedRows.map(({ p: item, isChild }) => (
                  <React.Fragment key={item.id}>
                  {/* 박스는 낱개 밑에 딸린 줄 — 들여쓰기와 바탕색으로 가른다 */}
                  <tr className={`transition-colors group ${isChild ? 'bg-slate-200/70 hover:bg-slate-200' : 'hover:bg-slate-50/50'}`}>
                    <td className={`px-2 py-3 ${isChild ? 'pl-6' : ''}`}>
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[9px] font-black whitespace-nowrap ${categoryChipClass(inferSubtype(item))}`}>
                        {inferSubtype(item)}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {/* 주문 생성 화면과 같은 표기 — 이름 토큰 색 + 규격칩 (src/shared/productChip) */}
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />
                        <p className="text-[11px] font-bold text-slate-600 whitespace-nowrap">
                          {renderColoredName(splitNameVolume(item).base)}
                        </p>
                        {/* 규격 — 색 칩을 벗기고 품목명과 같은 크기로 옆에 (주문카드와 같은 규칙) */}
                        {(() => {
                          const sp = specText(item.spec) || splitNameVolume(item).vol;
                          return sp ? <span className="text-[11px] font-bold text-slate-400 whitespace-nowrap">{sp}</span> : null;
                        })()}
                      </div>
                    </td>
                    {!(mainView === 'by-partner' && selectedClientId) && activeCategory === 'product' && (
                      <td className="px-2 py-3">
                        {(() => {
                          const BADGE_COLORS = [
                            'bg-indigo-100 text-indigo-700','bg-emerald-100 text-emerald-700','bg-amber-100 text-amber-700',
                            'bg-rose-100 text-rose-700','bg-sky-100 text-sky-700','bg-violet-100 text-violet-700',
                            'bg-teal-100 text-teal-700','bg-orange-100 text-orange-700','bg-pink-100 text-pink-700',
                          ];
                          const partnerList = partners.filter(c => !c.partnerType || c.partnerType === '매출처' || c.partnerType === '매출+매입처');
                          const matched = (item.partnerIds ?? []).map(id => partnerList.find(c => c.id === id)).filter(Boolean) as typeof partnerList;
                          if (!matched.length) return <span className="text-slate-200">-</span>;
                          const isExp = expandedClientRowId === item.id;
                          const shown = isExp ? matched : matched.slice(0, 1);
                          return (
                            <div className="flex flex-wrap gap-1 items-center" onClick={e => e.stopPropagation()}>
                              {shown.map((c) => {
                                const colorIdx = partnerList.indexOf(c) % BADGE_COLORS.length;
                                return (
                                  <span key={c.id} className={`inline-flex px-1.5 py-0.5 rounded-full text-[9px] font-black ${BADGE_COLORS[colorIdx]}`}>{c.name}</span>
                                );
                              })}
                              {!isExp && matched.length > 1 && (
                                <button onClick={() => setExpandedClientRowId(item.id)} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 transition-colors">+{matched.length - 1}</button>
                              )}
                              {isExp && (
                                <button onClick={() => setExpandedClientRowId(null)} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 transition-colors">접기</button>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                    )}
                    {!(mainView === 'by-partner' && selectedClientId) && activeCategory !== 'product' && (
                      <td className="px-2 py-3">
                        {(() => {
                          const BADGE_COLORS = [
                            'bg-indigo-100 text-indigo-700','bg-emerald-100 text-emerald-700','bg-amber-100 text-amber-700',
                            'bg-rose-100 text-rose-700','bg-sky-100 text-sky-700','bg-violet-100 text-violet-700',
                            'bg-teal-100 text-teal-700','bg-orange-100 text-orange-700','bg-pink-100 text-pink-700',
                          ];
                          const inIds = [...new Set(
                            partnerIn
                              .filter(ps => (ps.itemId) === item.id)
                              .map(ps => (ps.partnerId))
                              .filter(Boolean)
                          )];
                          const matched = inIds.map(id => partners.find(c => c.id === id)).filter(Boolean) as typeof partners;
                          if (!matched.length) return <span className="text-slate-200">-</span>;
                          const isExp = expandedClientRowId === item.id;
                          const shown = isExp ? matched : matched.slice(0, 1);
                          return (
                            <div className="flex flex-wrap gap-1 items-center" onClick={e => e.stopPropagation()}>
                              {shown.map((c) => {
                                const colorIdx = partners.indexOf(c) % BADGE_COLORS.length;
                                return (
                                  <span key={c.id} className={`inline-flex px-1.5 py-0.5 rounded-full text-[9px] font-black ${BADGE_COLORS[colorIdx]}`}>{c.name}</span>
                                );
                              })}
                              {!isExp && matched.length > 1 && (
                                <button onClick={() => setExpandedClientRowId(item.id)} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 transition-colors">+{matched.length - 1}</button>
                              )}
                              {isExp && (
                                <button onClick={() => setExpandedClientRowId(null)} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 transition-colors">접기</button>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                    )}
                    <td className="px-2 py-3">
                      {/* 품목이 품은 것 전부 — 주문 생성 화면과 같은 부자재 색 칩 */}
                      {bomOf(item.id).length > 0 ? (
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          {sortSubs(bomOf(item.id), subRank).map(bomChip)}
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-200">-</span>
                      )}
                    </td>
                    {isAdmin && (
                      <td className="px-2 py-3 text-right">
                        {item.cost != null
                          ? <span className="text-[11px] font-bold text-slate-500 whitespace-nowrap">{item.cost.toLocaleString()}원</span>
                          : <span className="text-[10px] text-slate-200">-</span>}
                      </td>
                    )}
                    {(isAdmin && mainView === 'by-partner' && selectedClientId && partnerScopeTab === 'sales') && (() => {
                      const psOut = partnerOut.find(ps => (ps.itemId) === item.id && (ps.partnerId) === selectedClientId);
                      const curPrice = psOut?.price ?? psOut?.price;
                      const editKey = `${item.id}_${selectedClientId}`;
                      const editVal = salesPriceEdits[editKey];
                      const savePrice = () => {
                        if (editVal === undefined || !onUpsertPartnerItem) return;
                        const num = editVal === '' ? 0 : Number(editVal);
                        if (isNaN(num)) return;
                        onUpsertPartnerItem({ ...(psOut ?? {}), id: psOut?.id ?? `${item.id}_${selectedClientId}_out`, itemId: item.id, partnerId: selectedClientId, Direction: 'out', price: num } as PartnerItem);
                        setSalesPriceEdits(prev => { const n = { ...prev }; delete n[editKey]; return n; });
                      };
                      const cancelEdit = () => setSalesPriceEdits(prev => { const n = { ...prev }; delete n[editKey]; return n; });
                      return (
                        <td className="px-2 py-3 text-right">
                          {editVal === undefined ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <span className={`text-[11px] font-bold whitespace-nowrap ${curPrice != null ? 'text-slate-700' : 'text-slate-300'}`}>
                                {curPrice != null ? `${Number(curPrice).toLocaleString()}원` : '미설정'}
                              </span>
                              <button
                                onClick={() => setSalesPriceEdits(prev => ({ ...prev, [editKey]: String(curPrice ?? '') }))}
                                className="p-1 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-all shrink-0"
                                title="판매단가 수정">
                                <Edit size={13} />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-1">
                              <input
                                type="number"
                                min={0}
                                autoFocus
                                value={editVal}
                                onChange={e => setSalesPriceEdits(prev => ({ ...prev, [editKey]: e.target.value }))}
                                onKeyDown={e => { if (e.key === 'Enter') savePrice(); if (e.key === 'Escape') cancelEdit(); }}
                                placeholder="단가"
                                className="w-16 text-right bg-white border border-indigo-300 rounded-lg px-2 py-1 text-[11px] font-bold outline-none focus:ring-2 focus:ring-indigo-400"
                              />
                              <button onClick={savePrice} className="p-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition-all shrink-0" title="저장">
                                <Save size={12} />
                              </button>
                              <button onClick={cancelEdit} className="p-1 rounded-md text-slate-400 hover:bg-slate-100 transition-all shrink-0" title="취소">
                                <X size={12} />
                              </button>
                            </div>
                          )}
                        </td>
                      );
                    })()}
                    {(isAdmin || (mainView === 'by-partner' && !!selectedClientId)) && (
                      <td className="px-2 py-3 text-center">
                        {isAdmin && mainView === 'by-partner' && selectedClientId ? (
                          // 거래처별 뷰: 포장설정 + 연결 해제 버튼
                          <div className="flex items-center gap-1 justify-center">
                          </div>
                        ) : isAdmin ? (
                          // 품목 목록 뷰: 품목 수정 / 삭제 버튼
                          <div className="flex items-center justify-end gap-1.5">
                            {/* 낱개 완제품 → N개입 박스 품목 만들기. 이미 박스인 품목엔 안 띄운다. */}
                            {onCreateBoxItem && item.type === 'product' && !isBoxStockItem(item) && (
                              <button
                                onClick={() => openBoxModal(item)}
                                className="px-2 py-1.5 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 hover:text-emerald-700 transition-all text-[10px] font-black"
                                title="이 낱개로 박스 품목 만들기"
                              >
                                + 박스
                              </button>
                            )}
                            <button
                              onClick={() => onEditProduct(item)}
                              className="p-1.5 rounded-lg bg-indigo-50 text-indigo-500 hover:bg-indigo-100 hover:text-indigo-700 transition-all"
                              title="수정"
                            >
                              <Edit size={13} />
                            </button>
                            <button
                              onClick={() => {
                                if (!window.confirm(`"${item.name}" 품목을 삭제하시겠습니까?\n\n삭제 후 복구할 수 없습니다.`)) return;
                                onDeleteItem(item.id, item.type);
                              }}
                              className="p-1.5 rounded-lg bg-rose-50 text-rose-400 hover:bg-rose-100 hover:text-rose-600 transition-all"
                              title="삭제"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ) : null}
                      </td>
                    )}
                  </tr>
                </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
        )}
        <div className="flex flex-col items-center gap-2 px-4 py-3 border-t border-slate-100">
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}
                className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-400 hover:bg-slate-100 disabled:opacity-30 transition-all">←</button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                <button key={p} onClick={() => setPage(p)}
                  className={`w-8 h-8 rounded-lg text-xs font-black transition-all ${safePage === p ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:bg-slate-100'}`}>
                  {p}
                </button>
              ))}
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
                className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-400 hover:bg-slate-100 disabled:opacity-30 transition-all">→</button>
            </div>
          )}
          <span className="text-[10px] font-bold text-slate-300">
            총 {filteredItems.length}개 · {safePage}/{totalPages} 페이지
          </span>
        </div>
      </div>

    </div>
  );

  return (
    <div className="space-y-4 animate-in slide-in-from-right-4 duration-500">
      <PageHeader
        title="품목 정보 관리"
        subtitle="거래처를 선택하거나 전체 품목을 조회하세요."
        right={isAdmin ? (
          <div className="flex bg-slate-100 rounded-xl p-1 gap-1">
            {([['flat', '품목 목록'], ['by-partner', '거래처별 품목']] as const).map(([v, label]) => (
              <button key={v} onClick={() => { setMainView(v); setSelectedClientId(null); setShowAll(true); setPage(1); setSearchTerm(''); }}
                className={`px-3 py-2 rounded-lg text-xs font-black transition-all whitespace-nowrap ${mainView === v ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                {label}
              </button>
            ))}
          </div>
        ) : undefined}
      />

      {/* 액션 버튼 줄 (헤더/탭 아래, 우측 정렬) */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setShowDuplicates(p => !p)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl font-black text-xs shadow-sm transition-all whitespace-nowrap ${showDuplicates ? 'bg-amber-50 text-amber-600 border border-amber-300' : 'bg-white text-slate-500 border border-slate-200 hover:border-slate-300'}`}
        >
          <Copy size={13} />
          중복 품목
          {duplicateGroups.length > 0 && (
            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${showDuplicates ? 'bg-amber-200 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>{duplicateGroups.length}</span>
          )}
        </button>
        {isAdmin && (
          <button
            onClick={() => setCategoryManagerOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl font-black text-xs shadow-sm whitespace-nowrap bg-white text-slate-500 border border-slate-200 hover:border-indigo-300 hover:text-indigo-600 transition-all"
          >
            <Settings size={13} />
            분류 관리
          </button>
        )}
        {isAdmin && (
          <button
            onClick={onAddItem}
            className="flex items-center gap-1.5 bg-white text-indigo-600 border border-indigo-200 px-3 py-2 rounded-xl font-black text-xs hover:bg-indigo-50 transition-all active:scale-95 whitespace-nowrap"
          >
            <Plus size={14} />
            신규 품목
          </button>
        )}
      </div>

      {/* 중복 품목 패널 */}
      {showDuplicates && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-amber-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Copy size={15} className="text-amber-600" />
              <span className="text-sm font-black text-amber-800">중복 품목 목록</span>
              <span className="text-[10px] font-bold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">이름+BOM 같은 것 {duplicateGroups.length}그룹</span>
            </div>
            <button onClick={() => setShowDuplicates(false)} className="p-1 hover:bg-amber-100 rounded-lg transition-colors">
              <X size={14} className="text-amber-500" />
            </button>
          </div>
          <div className="divide-y divide-amber-100 max-h-[60vh] overflow-y-auto">
            {duplicateGroups.map(group => {
              const isExpanded = dupExpandedKeys.has(group.key);
              return (
                <div key={group.key} className="px-5 py-3">
                  <button
                    className="w-full flex items-start justify-between gap-3 text-left"
                    onClick={() => setDupExpandedKeys(prev => { const next = new Set(prev); next.has(group.key) ? next.delete(group.key) : next.add(group.key); return next; })}
                  >
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <span className="text-sm font-black text-slate-800">{group.name}</span>
                      {sortSubs(group.subs, subRank).map(bomChip)}
                      <span className="text-[10px] font-bold text-amber-600">{group.items.length}개</span>
                    </div>
                    {isExpanded ? <ChevronUp size={14} className="text-amber-500 shrink-0 mt-0.5" /> : <ChevronDown size={14} className="text-amber-500 shrink-0 mt-0.5" />}
                  </button>

                  {isExpanded && (
                    <div className="mt-3 space-y-2">
                      {group.items.map(({ product, pcs, directClients, subMap }) => {
                        return (
                        <div key={product.id} className="bg-white rounded-xl border border-amber-100 px-4 py-3">
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            {/* 구성은 그룹 전체가 같으니 헤더에 한 번만 — 여기는 어느 문서인지·누구한테 물렸는지만 */}
                            <span className="text-[10px] font-black text-slate-400 font-mono">{product.id}</span>
                          </div>
                          {pcs.length > 0 ? (
                            <div className="space-y-1">
                              {pcs.map(pc => {
                                const cname = partners.find(c => c.id === pc.partnerId)?.name || pc.partnerId;
                                const boxName = pc.boxTypeId ? (subMap[pc.boxTypeId] || pc.boxTypeId) : null;
                                const tapeName = pc.tapeTypeId ? (subMap[pc.tapeTypeId] || pc.tapeTypeId) : null;
                                return (
                                  <div key={pc.id} className="flex flex-wrap items-center gap-3 text-[11px]">
                                    <span className="font-bold text-slate-700 min-w-[80px]">{cname}</span>
                                    <span className="text-slate-400">{boxName ? `박스: ${boxName}` : '박스 없음'}</span>
                                    <span className="text-slate-400">{tapeName ? `테이프: ${tapeName}` : '테이프 없음'}</span>
                                    {pc.qtyPerBox && <span className="text-slate-400">{pc.qtyPerBox}개/박스</span>}
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="text-[11px] text-slate-400">
                              거래처: {directClients.map(id => partners.find(c => c.id === id)?.name || id).join(', ') || '없음'} — 포장 설정 없음
                            </div>
                          )}
                        </div>
                        );
                      })}

                      {onMergeItems && (() => {
                        const allIds = group.items.map(i => i.product.id);
                        const mergeSet = selectedMergeIds[group.key] ?? new Set(allIds);
                        const keepId = (() => {
                          const k = selectedKeepId[group.key] ?? allIds[0];
                          return mergeSet.has(k) ? k : (Array.from(mergeSet)[0] ?? allIds[0]);
                        })();
                        const selectedList = allIds.filter(id => mergeSet.has(id));
                        const deleteIds = selectedList.filter(id => id !== keepId);
                        const canMerge = selectedList.length >= 2;

                        const toggleMerge = (id: string) => {
                          setSelectedMergeIds(prev => {
                            const cur = new Set(prev[group.key] ?? allIds);
                            if (cur.has(id)) {
                              if (cur.size <= 1) return prev; // 최소 1개 유지
                              cur.delete(id);
                            } else {
                              cur.add(id);
                            }
                            return { ...prev, [group.key]: cur };
                          });
                        };

                        return (
                          <div className="border rounded-xl px-4 py-3 bg-emerald-50 border-emerald-200">
                            {/* 이름도 BOM도 같아야 한 그룹이라, 여기 온 것들은 언제나 합쳐도 되는 짝이다. */}
                            <p className="text-[11px] font-black mb-3 text-emerald-700">
                              합칠 품목을 선택하고, 남길 품목을 지정하세요
                            </p>

                            <div className="space-y-2 mb-3">
                              {group.items.map(({ product }) => {
                                const isSelected = mergeSet.has(product.id);
                                const isKeep = keepId === product.id && isSelected;
                                return (
                                  <div key={product.id} className={`flex items-center gap-2 p-2 rounded-lg border transition-all ${isSelected ? 'bg-white border-slate-200' : 'bg-slate-50 border-slate-100 opacity-50'}`}>
                                    {/* 선택 체크박스 */}
                                    <button
                                      onClick={() => toggleMerge(product.id)}
                                      className={`w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition-all ${isSelected ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300'}`}
                                    >
                                      {isSelected && <span className="text-white text-[9px] font-black">✓</span>}
                                    </button>
                                    <span className="text-[10px] font-bold text-slate-600 font-mono flex-1 truncate">
                                      {product.id}
                                    </span>
                                    {/* 남길 품목 선택 */}
                                    {isSelected && (
                                      <button
                                        onClick={() => setSelectedKeepId(prev => ({ ...prev, [group.key]: product.id }))}
                                        className={`px-2 py-0.5 rounded text-[9px] font-black border transition-all shrink-0 ${isKeep ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-400 border-slate-200 hover:border-indigo-300'}`}
                                      >
                                        {isKeep ? '남김 ✓' : '남기기'}
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                            </div>

                            {!canMerge && (
                              <p className="text-[10px] text-slate-400 mb-2">합칠 품목을 2개 이상 선택하세요</p>
                            )}

                            <button
                              disabled={merging || !canMerge}
                              onClick={async () => {
                                if (!window.confirm(`"${group.name}" 통합하시겠습니까?\n\n남기는 품목: ${keepId}\n삭제할 품목: ${deleteIds.join(', ')}\n\n삭제 품목의 거래처/포장설정이 남기는 품목으로 이전됩니다.`)) return;
                                setMerging(true);
                                try {
                                  await onMergeItems(keepId, deleteIds);
                                  setDupExpandedKeys(prev => { const n = new Set(prev); n.delete(group.key); return n; });
                                } finally {
                                  setMerging(false);
                                }
                              }}
                              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-[11px] font-black rounded-lg hover:bg-indigo-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <GitMerge size={13} />
                              {merging ? '통합 중...' : `선택 품목 통합 (${selectedList.length}개)`}
                            </button>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 뷰 탭 — 관리자만 */}
      {/* 품목 목록 뷰: 관리자만 */}
      {isAdmin && mainView === 'flat' && productPanel}

      {/* 거래처별 품목 뷰 */}
      {mainView === 'by-partner' && (
        <>
          {!selectedClientId ? (
            /* 거래처 그리드 */
            <div className="space-y-3">
              {/* 매출/매입 탭 */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex bg-slate-100 rounded-xl p-0.5 gap-0.5">
                  {([['sales', '매출처'], ['purchase', '매입처']] as const).map(([tab, label]) => (
                    <button key={tab}
                      onClick={() => { setPartnerTab(tab); setSelectedClientId(null); setClientSearch(''); }}
                      className={`px-4 py-1.5 rounded-lg text-xs font-black transition-all ${partnerTab === tab ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="relative flex-1 max-w-xs">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={14} />
                  <input
                    type="text"
                    placeholder="거래처 검색..."
                    value={partnerSearch}
                    onChange={e => setClientSearch(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-2xl pl-10 pr-4 py-2.5 text-xs font-bold outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all shadow-sm"
                  />
                </div>
              </div>
              {filteredClients.length === 0 ? (
                <p className="py-12 text-center text-slate-400 text-sm">거래처가 없습니다.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
                  {filteredClients
                    .map(c => {
                      const count = partnerTab === 'sales'
                        ? (partnerItemCount.get(c.id) ?? 0)
                        : (inboundPartnerItemCount.get(c.id) ?? 0);
                      const AV = [
                        { bg: 'bg-indigo-50 border-indigo-100 hover:bg-indigo-100', text: 'text-indigo-800', num: 'text-indigo-500' },
                        { bg: 'bg-emerald-50 border-emerald-100 hover:bg-emerald-100', text: 'text-emerald-800', num: 'text-emerald-500' },
                        { bg: 'bg-amber-50 border-amber-100 hover:bg-amber-100', text: 'text-amber-800', num: 'text-amber-500' },
                        { bg: 'bg-rose-50 border-rose-100 hover:bg-rose-100', text: 'text-rose-800', num: 'text-rose-500' },
                        { bg: 'bg-sky-50 border-sky-100 hover:bg-sky-100', text: 'text-sky-800', num: 'text-sky-500' },
                        { bg: 'bg-violet-50 border-violet-100 hover:bg-violet-100', text: 'text-violet-800', num: 'text-violet-500' },
                        { bg: 'bg-teal-50 border-teal-100 hover:bg-teal-100', text: 'text-teal-800', num: 'text-teal-500' },
                        { bg: 'bg-orange-50 border-orange-100 hover:bg-orange-100', text: 'text-orange-800', num: 'text-orange-500' },
                      ];
                      const av = AV[[...c.name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AV.length];
                      // 주문 생성의 거래처 카드와 같은 모양 — 흰 바탕 + 타입 아이콘 + 이름 + 타입 배지
                      const typeConfig = {
                        '일반': { icon: User, color: 'bg-indigo-100 text-indigo-600' },
                        '택배': { icon: Truck, color: 'bg-pink-100 text-pink-600' },
                        '스마트스토어': { icon: Store, color: 'bg-lime-100 text-lime-600' },
                      }[c.type as string] || { icon: LayoutGrid, color: 'bg-slate-100 text-slate-600' };
                      const TypeIcon = typeConfig.icon;
                      return (
                        <button key={c.id} onClick={() => handleSelectClient(c.id)}
                          className="bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md hover:border-indigo-100 transition-all p-4 text-left">
                          <div className="flex items-center space-x-3 min-w-0">
                            <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${typeConfig.color}`}>
                              <TypeIcon size={18} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <h3 className="text-sm font-bold text-slate-900 truncate">{c.name}</h3>
                                {c.type && <span className={`px-1.5 py-0.5 rounded text-[9px] font-black flex-shrink-0 ${typeConfig.color}`}>{c.type}</span>}
                              </div>
                              <p className="text-[11px] text-slate-400 mt-0.5">
                                <span className={`font-black ${count > 0 ? av.num : 'text-slate-300'}`}>{count}</span>개 품목
                              </p>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                </div>
              )}
            </div>
          ) : (
            /* 선택된 거래처 품목 테이블 */
            <div className="space-y-3">
              {/* 거래처 헤더 */}
              {/* 선택된 거래처 — 주문 생성의 파란 바와 같은 모양.
                  카드 패널과 폭을 맞춰야 따로 노는 느낌이 안 난다. */}
              <div className="lg:w-3/4 lg:mx-auto">
                {/* 머리 — **바탕색을 안 깐다.** 아래 카드에 연한 바탕이 깔려서, 머리까지 칠하면
                    색이 두 겹이 되어 정작 품목이 묻힌다. 아래 선 하나로 갈라 준다. */}
                <div className="px-1 pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex flex-col min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {/* 뒤로가기 — 거래처 이름 바로 왼쪽. 목록으로 돌아가는 것이니 이름 옆이 제자리다. */}
                        <button
                          onClick={() => { setSelectedClientId(null); setPage(1); setSearchTerm(''); }}
                          title="거래처 목록으로"
                          className="shrink-0 -ml-1 p-1 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-all"
                        >
                          <ChevronLeft size={18} />
                        </button>
                        <h4 className="font-black text-slate-900 text-base truncate">{selectedClient?.name}</h4>
                        {selectedClient?.type && (
                          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-black shrink-0">{selectedClient.type}</span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 font-bold mt-0.5 pl-6">{filteredItems.length}개 품목</p>
                    </div>
                    {/* 매출/매입 품목 토글 */}
                    <div className="flex bg-slate-100 rounded-lg p-0.5 gap-0.5 shrink-0">
                      <button
                        onClick={() => { setClientScopeTab('sales'); setPage(1); }}
                        className={`px-4 py-1.5 rounded-lg text-xs font-black transition-all ${partnerScopeTab === 'sales' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                      >매출 품목</button>
                      <button
                        onClick={() => { setClientScopeTab('purchase'); setPage(1); }}
                        className={`px-4 py-1.5 rounded-lg text-xs font-black transition-all ${partnerScopeTab === 'purchase' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                      >매입 품목</button>
                    </div>
                    {isAdmin && (
                      <button
                        onClick={() => { setShowLinkPanel(true); setLinkSearch(''); setLinkCategory('product'); }}
                        className="hidden lg:flex items-center gap-1.5 shrink-0 bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-black shadow-sm hover:bg-emerald-700 transition-all active:scale-95"
                      >
                        <Link size={13} /> 품목 연결
                      </button>
                    )}
                  </div>
                </div>
              </div>
              {productPanel}
            </div>
          )}
        </>
      )}

      {/* 품목 연결 모달 */}
      {showLinkPanel && selectedClientId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowLinkPanel(false)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl mx-4 flex flex-col h-[85vh] animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            {/* 헤더 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div>
                <h3 className="text-base font-black text-slate-900">품목 연결</h3>
                <p className="text-xs text-slate-400 font-medium mt-0.5">{selectedClient?.name}에 추가할 품목을 선택하세요</p>
              </div>
              <button onClick={() => setShowLinkPanel(false)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 transition-all">
                <X size={18} />
              </button>
            </div>
            {/* 카테고리 탭 */}
            <div className="px-6 pt-4 pb-1 flex flex-wrap gap-1.5">
              {LINK_CATEGORIES.map(cat => (
                <button
                  key={cat}
                  onClick={() => { setLinkCategory(cat); setLinkSearch(''); }}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all border whitespace-nowrap ${
                    linkCategory === cat
                      ? 'bg-emerald-600 border-emerald-600 text-white shadow'
                      : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            {/* 검색 */}
            <div className="px-6 py-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={14} />
                <input
                  type="text"
                  placeholder="품목명 검색..."
                  value={linkSearch}
                  onChange={e => setLinkSearch(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-emerald-400/30 focus:border-emerald-400"
                  autoFocus
                />
              </div>
            </div>
            {/* 목록 */}
            <div className="flex-1 overflow-y-auto px-6 pb-6">
              {linkableProduts.length === 0 ? (
                <p className="text-center text-sm text-slate-400 py-12">연결 가능한 품목이 없습니다.</p>
              ) : (
                <div className="flex flex-col divide-y divide-slate-50">
                  {linkableProduts.map(p => (
                    <div key={p.id} className="flex items-center justify-between py-2.5 hover:bg-slate-50 -mx-2 px-2 rounded-xl transition-colors">
                      {/* 주문 생성 화면과 같은 표기 — 이름 색 + 규격칩 + 부자재칩 (src/shared/productChip) */}
                      <div className="min-w-0 flex-1">
                        <ProductNameRow product={p} />
                        {bomOf(p.id).length > 0 && (
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1">
                            {sortSubs(bomOf(p.id), subRank).map(bomChip)}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => {
                          if (partnerScopeTab === 'purchase' && onLinkSupplier) {
                            onLinkSupplier(p.id, selectedClientId);
                          } else {
                            onLinkItem(p.id, selectedClientId);
                          }
                        }}
                        className="flex items-center gap-1 text-[10px] font-black text-emerald-600 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg transition-all shrink-0 ml-3"
                      >
                        <Plus size={11} /> 연결
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {confirmModal && (
        <ConfirmModal
          message={confirmModal.message}
          subMessage={confirmModal.subMessage}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}

      {/* ── 분류 관리 (재고관리에서 이동) ── */}
      {categoryManagerOpen && (
        <CategoryManager usage={taxonomyUsage} onClose={() => setCategoryManagerOpen(false)} />
      )}

      {/* 포장설정 모달 */}
      {/* ── 박스 품목 만들기 ── */}
      {boxModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setBoxModal(null)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black text-slate-800">박스 품목 만들기</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">낱개 · {boxModal.name}</p>
              </div>
              <button onClick={() => setBoxModal(null)} className="p-1 text-slate-400 hover:bg-slate-100 rounded-lg"><X size={16} /></button>
            </div>

            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">개입수 <span className="text-rose-400">*</span></label>
              <div className="flex items-center gap-2">
                <input type="number" min="1" step="1" value={boxForm.count} onChange={e => setBoxCount(e.target.value)}
                  className="w-24 border border-slate-200 rounded-xl px-3 py-2 text-sm font-black text-right outline-none focus:ring-2 focus:ring-emerald-300" />
                <span className="text-xs text-slate-400">개 / 박스</span>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">품목명 <span className="text-slate-300">(자동 · 수정 가능)</span></label>
              <input type="text" value={boxForm.name} onChange={e => setBoxForm(f => ({ ...f, name: e.target.value }))}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-300" />
            </div>

            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">BOM 구성</label>
              <div className="bg-emerald-50/60 border border-emerald-100 rounded-xl px-3 py-2 mb-2 flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-700 truncate">{boxModal.name}</span>
                <span className="text-xs font-black text-emerald-700 shrink-0">×{boxForm.count || 0}</span>
              </div>
              {boxForm.comps.map((c, i) => (
                <div key={i} className="flex items-center gap-1.5 mb-1.5">
                  <select value={c.id}
                    onChange={e => setBoxForm(f => ({ ...f, comps: f.comps.map((x, j) => j === i ? { ...x, id: e.target.value } : x) }))}
                    className="flex-1 min-w-0 border border-slate-200 rounded-xl px-2 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-emerald-300 bg-white">
                    <option value="">— 구성품 선택 —</option>
                    {items.filter(x => !x.archived && x.type !== 'product' && x.type !== 'raw')
                      .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
                      .map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                  <input type="number" min="0" step="0.001" value={c.qty}
                    onChange={e => setBoxForm(f => ({ ...f, comps: f.comps.map((x, j) => j === i ? { ...x, qty: e.target.value } : x) }))}
                    className="w-16 border border-slate-200 rounded-xl px-2 py-2 text-xs font-black text-right outline-none focus:ring-2 focus:ring-emerald-300" />
                  <button onClick={() => setBoxForm(f => ({ ...f, comps: f.comps.filter((_, j) => j !== i) }))}
                    className="text-slate-300 hover:text-rose-500 shrink-0"><X size={14} /></button>
                </div>
              ))}
              <button onClick={() => setBoxForm(f => ({ ...f, comps: [...f.comps, { id: '', qty: '1' }] }))}
                className="w-full py-2 rounded-xl border border-dashed border-slate-300 text-[11px] font-black text-slate-400 hover:border-emerald-300 hover:text-emerald-500 transition-colors">
                + 구성품 추가 (겉박스 · 테이프 등)
              </button>
              <p className="text-[10px] text-slate-400 mt-1.5">수량 0으로 두면 BOM에는 남고 차감·원가엔 안 들어갑니다.</p>
            </div>

            <div className="flex gap-2 pt-1">
              <button onClick={() => setBoxModal(null)} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-xs font-black hover:bg-slate-200">취소</button>
              <button onClick={saveBoxItem}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-black hover:bg-emerald-700 flex items-center justify-center gap-1.5">
                <Save size={12} />만들기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ItemManager;
