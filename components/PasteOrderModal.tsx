import { parseLine, scoreProduct, type ParsedLine } from '../src/features/orders/domain/pasteOrderParser';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { getApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { validateScopedExtract, catalogLine, historyLines, type HistoryOrder } from '../src/shared/orderExtract';
import { defaultShipToId, activeShipTos, linksForShipTo } from '../src/shared/shipTo';
import { ClipboardPaste, CheckCircle2, AlertCircle, ChevronDown, User, Truck, Store, LayoutGrid, Search, ArrowRight, ShoppingBag, Layers, CalendarDays, Sparkles } from 'lucide-react';
import { Item, PartnerItem, Order, Partner, OrderPallet, PalletStock, ShipMethod } from '../types';
import ModalActionFooter from '../src/shared/components/ModalActionFooter';
import { bomOf } from '../src/shared/bomIndex';
import { sellsTo } from '../src/shared/partnerRole';
import { channelStyle } from '../src/shared/channelStyle';
import { isSmartStoreItem } from '../src/shared/partnerPrice';
import { resolveOrderInterpretationAlias,normalizeOrderInterpretationUnits,matchOrderInterpretationExpressions,type OrderExpressionConfirmation,type OrderInterpretationJsonObject } from '../src/shared/orderInterpretation';
import type {OrderInterpretationRule} from '../src/shared/services/orderCopyService';
import {buildOrderCopyScopedSources,classifyOrderCopyRow,mergeOrderCopyScopedResult,type OrderCopyScopeRow} from '../src/shared/orderCopyInterpretationScope';
import { resolveDefaultShipMethod } from '../src/shared/partnerShipping';
import { buildNewOrderDraft } from '../src/shared/newOrderDraft';
import type { OrderUnitInputs } from '../src/shared/orderUnits';
import ModalShell from '../src/shared/components/ModalShell';
import { clampNote, NOTE_MAX } from '../src/shared/orderNote';

// ── 퍼지 매칭 ───────────────────────────────────────────────


/**
 * 붙여넣은 글과 품목이 얼마나 닮았나.
 *
 * **이름만 보면 안 된다** — 낱개와 그 박스들이 **같은 이름**을 쓴다(`볶음참깨/1kg`).
 * 규격으로만 갈리므로 이름만 보면 점수가 같아 아무거나 잡힌다.
 * 그래서 이름과 `이름 규격` 둘 다 재서 높은 쪽을 쓴다.
 */








// ── 초성 검색 ────────────────────────────────────────────────
const CHOSUNG = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const getChosung = (str: string) =>
  str.split('').map(c => {
    const code = c.charCodeAt(0) - 44032;
    return code >= 0 && code <= 11171 ? CHOSUNG[Math.floor(code / 588)] : c;
  }).join('');
const COMPOUND_MAP: Record<string, string> = {
  'ㄳ':'ㄱㅅ','ㄵ':'ㄴㅈ','ㄶ':'ㄴㅎ','ㄺ':'ㄹㄱ','ㄻ':'ㄹㅁ',
  'ㄼ':'ㄹㅂ','ㄽ':'ㄹㅅ','ㄾ':'ㄹㅌ','ㄿ':'ㄹㅍ','ㅀ':'ㄹㅎ','ㅄ':'ㅂㅅ',
};
const decompound = (str: string) => str.split('').map(c => COMPOUND_MAP[c] ?? c).join('');
const matchClient = (name: string, q: string) => {
  if (!q.trim()) return false;
  if (/^[ㄱ-ㅎ]+$/.test(q)) return getChosung(name).includes(decompound(q));
  return name.toLowerCase().includes(q.toLowerCase());
};

// ── Props ────────────────────────────────────────────────────
export interface OrderCopyEvidence {sourceText:string;firstAnalysis:OrderInterpretationJsonObject;inputLines:OrderInterpretationJsonObject[];expressionConfirmations?:OrderExpressionConfirmation[];}
interface PasteOrderModalProps {
  suspended?:boolean;
  isCurrentActor?:()=>boolean;
  companyId?:'taebaek'|'punghoe';
  actorUid?:string;
  orderUnitInputs?: OrderUnitInputs;
  items: Item[];
  partners: Partner[];
  /**
   * **지난 주문** — AI 가 "이 집이 늘 뭘 어떻게 시키나" 를 보는 데 쓴다(2026-09-16 사장님:
   * "거래처가 이전에 주문했던 내용을 참고하는 방식"). 앱이 이미 들고 있는 것을 그대로 받는다 —
   * 따로 물으러 가지 않으므로 기다림이 없다. 추리는 일은 `orderExtract.historyLines` 가 한다.
   */
  orders?: HistoryOrder[];
  partnerItems?: import('../src/shared/types').PartnerItem[];
  palletStocks: PalletStock[];
  /** 오피스톡에서 넘긴 메시지처럼 창을 열 때 이미 채워 둘 주문 원문. */
  initialText?: string;
  onClose: () => void;
  onBack?: () => void;
  onSave: (_order: Omit<Order, 'id' | 'status'>,evidence?:OrderCopyEvidence) => Promise<void>;
}

type Step = 'partner' | 'paste' | 'review';

const PasteOrderModal: React.FC<PasteOrderModalProps> = ({
  companyId,actorUid,suspended=false,isCurrentActor,items, partners, orders, partnerItems, palletStocks, orderUnitInputs, initialText = '', onClose, onBack, onSave,
}) => {
  const products = items;
  const partnerOut = (partnerItems ?? []).filter((pi: any) => pi.Direction === 'out');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const savingRef = useRef(false);
  const aiRequest = useRef({ generation: 0, sequence: 0, inFlight: 0, snapshot: '', open: true });
  const invalidateAiRead = () => { aiRequest.current.generation += 1; };
  const closeModal = () => { aiRequest.current.open = false; invalidateAiRead(); onClose(); };
  const backModal = () => { aiRequest.current.open = false; invalidateAiRead(); onBack?.(); };
  useEffect(() => {
    aiRequest.current.open = true;
    return () => { aiRequest.current.open = false; invalidateAiRead(); };
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !savingRef.current && !suspended) closeModal(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [isSaving, onClose,suspended]);

  const [step, setStep] = useState<Step>('partner');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  // 같은 ID의 거래처 원본이 바뀌어도 이전 배송지와 이름으로 주문하지 않는다.
  const selectedClient = partners.find(partner => partner.id === selectedClientId) ?? null;
  //  **어디로 보내나**(2026-09-16) — 주문 화면과 같은 규칙. 기본은 목록 맨 앞이고,
  //  바꾸면 품목 목록이 따라 바뀐다.
  const [shipToId, setShipToId] = useState<string | undefined>(undefined);
  useEffect(() => {
    setShipToId(current => activeShipTos(selectedClient ?? undefined).some(shipTo => shipTo.id === current)
      ? current : defaultShipToId(selectedClient ?? undefined));
  }, [selectedClient]);
  const [pasteText, setPasteText] = useState(initialText);
  const [parsedLines, setParsedLines] = useState<ParsedLine[]>([]);
  const sourceGeneration=useRef(0);
  const interpretationRules=useRef<OrderInterpretationRule[]>([]);
  const firstAnalysis=useRef<{sourceText:string;value:OrderInterpretationJsonObject}|null>(null);
  //  AI 로 다시 읽는 중인가, 그리고 그 결과 한 줄(2026-09-15).
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState<{ tone: 'good' | 'warn' | 'bad'; text: string } | null>(null);
  const [shipMethod, setShipMethod] = useState<ShipMethod>('배송');
  const manualShippingTarget = useRef<string | null>(null);
  const shippingTarget = JSON.stringify([selectedClientId, shipToId]);
  useEffect(() => {
    if (manualShippingTarget.current !== shippingTarget) { manualShippingTarget.current = null; setShipMethod(resolveDefaultShipMethod(selectedClient ?? undefined, shipToId)); }
  }, [selectedClient, shipToId, shippingTarget]);
  const [orderDate, setOrderDate] = useState(() => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()));
  const [deadline, setDeadline] = useState(() => {
    const d = new Date(Date.now() + 86400000 * 3);
    const day = d.getDay();
    if (day === 6) d.setDate(d.getDate() + 2);
    else if (day === 0) d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  });
  const [pallets, setPallets] = useState<OrderPallet[]>([]);
  const [showPallets, setShowPallets] = useState(false);
  const [orderNote, setOrderNote] = useState('');
  const [noteImportant, setNoteImportant] = useState(false);
  const [expressionOpen,setExpressionOpen]=useState(false);
  const automaticNote=useRef<{partnerId:string|null;sourceText:string;before:string;after:string}|null>(null);
  const [expressionInputs,setExpressionInputs]=useState<Record<number,{target:'note';value:string;scope:'partner'|'company';confirmed:boolean;suggest:boolean}>>({});
  const expressionLines=useMemo(()=>{let offset=0;return pasteText.split('\n').flatMap(raw=>{const start=offset;offset+=raw.length+1;const text=raw.replace(/\r$/,'');return text.trim()?[{sourceStart:start,sourceEnd:start+text.length,sourceText:text}]:[];});},[pasteText]);
  useEffect(()=>{setExpressionInputs({});if(automaticNote.current&&(automaticNote.current.partnerId!==selectedClientId||automaticNote.current.sourceText!==pasteText)){const previous=automaticNote.current;automaticNote.current=null;setOrderNote(current=>current===previous.after?previous.before:current);}},[pasteText,selectedClientId]);
  const appendNotes=(before:string,notes:string[])=>{const existing=before.split(/\r?\n/),added=[...new Set(notes)].filter(note=>!existing.includes(note));return added.length?before+(before&&!before.endsWith('\n')?'\n':'')+added.join('\n'):before;};
  const choice=(sourceText:string)=>({target:'note' as const,value:/스티커\s*[xX]/.test(sourceText)?'스티커 없이':sourceText.trim(),scope:'partner' as 'partner'|'company',confirmed:false,suggest:false});
  const confirmExpression=(start:number,row:ReturnType<typeof choice>,checked:boolean)=>{invalidateAiRead();setExpressionInputs(current=>({...current,[start]:{...row,confirmed:checked}}));if(checked){automaticNote.current=null;setOrderNote(current=>appendNotes(current,[row.value]));}};

  const selectClient = (client: Partner) => {
    invalidateAiRead();
    setSelectedClientId(client.id);
    setShipToId(defaultShipToId(client));
    manualShippingTarget.current = null;
    setShipMethod(resolveDefaultShipMethod(client, defaultShipToId(client)));
    setSearchTerm('');
    setStep('paste');
  };

  const changeClient = () => {
    invalidateAiRead();
    setSelectedClientId(null);
    setPasteText('');
    setParsedLines([]);
    setPallets([]);
    manualShippingTarget.current = null;
    setShipMethod('배송');
    setSearchTerm('');
    setStep('partner');
  };

  // 거래처별 품목 풀 — 거래처에 연결된 품목만 포함
  /**
   * 붙여넣은 글에서 찾아볼 품목들.
   *
   * **전에는 아무것도 안 나왔다**(2026-09-06) — `p.type !== '완제품'` 으로 걸렀는데
   * 타입 값은 `product` 다('완제품'은 화면에 보이는 이름이다). `향미유`·`고춧가루` 도
   * 타입이 아니라 **카테고리**라 마찬가지였다. 셋 다 늘 거짓이라 목록이 비어 있었다.
   *
   * 연결 판정도 주문 화면과 **같은 규칙**을 쓴다 — 거기는 `partner_item` 도 보는데
   * 여기는 `partnerIds` 만 봐서, 품목연결로 붙인 것이 통째로 빠졌다.
   */
  const partnerOutIds = useMemo(
    //  **배송지로 한 번 더 거른다** — 주문 화면과 같은 규칙(`shipTo.linksForShipTo`).
    () => new Set(linksForShipTo(
      (partnerItems ?? []).filter((r: any) => r.partnerId === selectedClient?.id && r.Direction !== 'in'),
      shipToId,
    ).map((r: any) => String(r.itemId))),
    [partnerItems, selectedClient?.id, shipToId]);

  const productPool = useMemo(() => {
    if (!selectedClient) return [];
    const catalog = items.filter(p => !p.archived && ['product', 'goods', 'wip', 'raw', 'submaterial'].includes(p.type));
    const linked = catalog.filter(p => partnerOutIds.has(p.id) || (selectedClient.type === '스마트스토어' && isSmartStoreItem(p)));
    return linked.length ? linked : catalog;
  }, [items, partnerOutIds, selectedClient, shipToId]);

  // 요청 당시의 회사·거래처·주소·원문과 검토 내용을 함께 견준다. 같은 ID 원본이
  // 구독으로 바뀌어도 예전 회사·배송지에 대한 AI 답으로 최신 입력을 갈아 끼우지 않는다.
  const aiSnapshot = JSON.stringify({
    companyId,actorUid,step, pasteText, client: selectedClient, shipToId: shipToId ?? null,
    catalog: productPool.map(item => ({ id: item.id, companyId: item.companyId ?? null,
      name: item.name, spec: item.spec, unit: item.unit, type: item.type })),
    parsedLines, orderDate, deadline, orderNote, noteImportant, shipMethod, pallets, expressionInputs,
  });
  if (aiRequest.current.snapshot !== aiSnapshot) {
    aiRequest.current.snapshot = aiSnapshot;
    aiRequest.current.generation += 1;
  }

  const filteredClients = useMemo(() => {
    if (!searchTerm.trim()) return [];
    return partners.filter(c =>
      sellsTo(c) &&
      matchClient(c.name || '', searchTerm)
    );
  }, [searchTerm, partners]);

  const quickClients = useMemo(() => {
    const seen = new Set<string>();
    return partners
      .filter(sellsTo)
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'))
      .filter(c => { if (seen.has(c.name)) return false; seen.add(c.name); return true; })
      .slice(0, 12);
  }, [partners]);

  const analyze = async () => {
    invalidateAiRead();
    const captured={generation:aiRequest.current.generation,snapshot:aiRequest.current.snapshot};
    let rules:OrderInterpretationRule[]=[];
    if(companyId&&actorUid){try{const service=await import('../src/shared/services/orderCopyService');rules=await service.listOrderInterpretationRules(companyId);}catch{/* 승인 조회 실패는 새 규칙을 추정하지 않고 기존 판독으로 남긴다. */}
      if(!aiRequest.current.open||aiRequest.current.generation!==captured.generation||aiRequest.current.snapshot!==captured.snapshot||isCurrentActor&&!isCurrentActor())return;
    }
    interpretationRules.current=rules;
    const generation=++sourceGeneration.current;
    const lines=Array.from(pasteText.matchAll(/[^\r\n]+/g)).filter(match=>match[0].trim());
    let aliasConflicted=false;
    const parsed=lines.map(match=>{
      const line=match[0],sourceStart=match.index??0;
      const result={...parseLine(normalizeOrderInterpretationUnits(line),productPool),rawText:line,sourceId:`source_${generation}_${sourceStart}`,sourceStart,sourceEnd:sourceStart+line.length};
      const suffix=/^(.*?)\s*(\d+(?:\.\d+)?)\s*(개|병|박스|캔|포)$/.exec(line.trim());
      const expression=suffix&&Number(suffix[2])===result.qty&&(result.isBox?suffix[3]==='박스':suffix[3]!=='박스')?suffix[1]:line;
      const approved=resolveOrderInterpretationAlias(normalizeOrderInterpretationUnits(expression),rules.map(rule=>({...rule,alias:normalizeOrderInterpretationUnits(rule.alias)})),selectedClientId??'');
      if(approved.status==='conflict'){aliasConflicted=true;return {...result,selectedProductId:null,aliasConflict:true};}
      return approved.status==='matched'&&productPool.some(item=>item.id===approved.itemId)?{...result,selectedProductId:approved.itemId}:result;
    });
    if(firstAnalysis.current?.sourceText!==pasteText)firstAnalysis.current={sourceText:pasteText,value:{kind:'rules',lines:parsed.map(line=>({...line}))}};
    const interpreted=matchOrderInterpretationExpressions(pasteText,rules,selectedClientId??'');
    setOrderNote(current=>{const after=appendNotes(current,interpreted.notes);if(after!==current)automaticNote.current={partnerId:selectedClientId,sourceText:pasteText,before:automaticNote.current?.before??current,after};return after;});
    setParsedLines(parsed);
    setAiNote(aliasConflicted?{tone:'warn',text:'같은 표현에 서로 다른 품목이 승인되어 자동 선택을 해제했습니다. 원문과 규격을 확인하고 품목을 직접 선택해 주세요.'}:interpreted.conflicted?{tone:'warn',text:'승인 표현의 비고 연결이 충돌했습니다. 비고를 직접 확인해 주세요.'}:null);
    setStep('review');
  };

  /**
   * **AI 로 다시 읽기**(2026-09-15 사장님: "api달아서 메시지에서 주문 추출하는 기능 …
   * 그냥 복사주문 업그레이드", "걔는 너무 못해").
   *
   * 규칙(정규식)은 `참기름 두 박스요`(숫자가 없다) · `볶음참깨 5, 참기름 3`(한 줄에 둘) ·
   * `내일 오전까지`(날짜) 같은 **사람 말**을 못 읽는다. 그런 글만 이쪽으로 보낸다 —
   * 깔끔한 주문은 규칙이 공짜로 읽으므로 값이 안 든다.
   *
   * **저장은 안 한다.** 읽어 온 것을 아래 확인 표에 채워 놓기만 하고, 사람이 보고 고쳐
   * 저장한다 — 수량 하나가 틀리면 재고·전표가 다 틀어진다.
   * 열쇠는 앱에 없다. Cloud Function(`extractOrder`)이 서버 시크릿으로 부른다.
   */
  const aiRead = async () => {
    if (aiBusy || aiRequest.current.inFlight || !aiRequest.current.open || savingRef.current) return;
    if (!pasteText.trim() || !productPool.length) return;
    let scopedSources:ReturnType<typeof buildOrderCopyScopedSources>;
    try{scopedSources=buildOrderCopyScopedSources(parsedLines,{catalog:productPool,rules:interpretationRules.current,partnerId:selectedClientId??''});}
    catch{setAiNote({tone:'bad',text:'다시 읽을 원문 구간을 확인하지 못했습니다. 내용을 줄이거나 품목을 직접 확인해 주세요.'});return;}
    if(!scopedSources.length){setAiNote(current=>current?.tone==='warn'?current:{tone:'good',text:'AI로 다시 읽을 애매한 품목이 없습니다. 확정된 품목과 직접 수정한 내용을 유지합니다.'});return;}
    const requestId = ++aiRequest.current.sequence;
    aiRequest.current.inFlight = requestId;
    const captured = { generation: aiRequest.current.generation, snapshot: aiRequest.current.snapshot };
    const current = () => (!isCurrentActor||isCurrentActor()) && aiRequest.current.open && aiRequest.current.inFlight === requestId &&
      aiRequest.current.generation === captured.generation && aiRequest.current.snapshot === captured.snapshot;
    const preserveInput = () => {
      if ((!isCurrentActor||isCurrentActor()) && aiRequest.current.open && aiRequest.current.inFlight === requestId)
        setAiNote({ tone: 'warn', text: 'AI가 읽는 동안 주문 입력이 바뀌어 응답을 적용하지 않았습니다. 현재 입력을 보존했습니다.' });
    };
    setAiBusy(true);
    setAiNote(null);
    try {
      const 부르기 = httpsCallable(getFunctions(getApp(), 'asia-northeast3'), 'extractOrder');
      const 답 = await 부르기({
        scopedSources,
        catalog: productPool.map(catalogLine),
        //  **이 집이 전에 시킨 것** — 고를 품목을 좁히고, 그 집 말버릇(`orderedAs`)을 전한다.
        history: historyLines(orders ?? [], selectedClient?.id ?? ''),
        //  거래처는 이미 골라 놓고 오는 화면이라 목록을 안 보낸다 — 값만 비싸진다.
        today: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()),
      });
      if (!current()) { preserveInput(); return; }
      const 읽은것 = validateScopedExtract(답.data as Record<string, unknown>, productPool, scopedSources);
      const first=firstAnalysis.current;
      if(first?.sourceText===pasteText&&!Object.hasOwn(first.value,'scopedAiEvidence'))firstAnalysis.current={sourceText:first.sourceText,value:{...first.value,scopedAiEvidence:{
        sources:scopedSources.map(source=>({...source})),targets:scopedSources.map(source=>{const row=parsedLines.find(row=>row.sourceId===source.sourceId);return {sourceId:source.sourceId,sourceStart:row?.sourceStart??null,sourceEnd:row?.sourceEnd??null};}),rawResponse:structuredClone(답.data) as OrderInterpretationJsonObject,
        validatedResult:JSON.parse(JSON.stringify({valid:읽은것.valid,results:읽은것.results,unresolvedSourceIds:읽은것.unresolvedSourceIds})) as OrderInterpretationJsonObject,
      }}};
      if(!읽은것.valid){setAiNote({tone:'bad',text:'AI 응답의 원문 연결을 확인하지 못했습니다. 기존 품목과 입력을 유지했습니다. 품목을 직접 확인해 주세요.'});return;}
      setParsedLines(rows=>mergeOrderCopyScopedResult(rows,scopedSources,읽은것));
      const unresolved=읽은것.unresolvedSourceIds.length,matched=읽은것.results.reduce((sum,result)=>sum+result.lines.length,0);
      setAiNote({tone:unresolved?'warn':'good',text:matched?`애매한 원문에서 ${matched}개 품목을 읽었습니다. 확정된 품목과 직접 입력한 내용은 유지했습니다.${unresolved?` 원문 ${unresolved}곳은 직접 확인해 주세요.`:''}`:'애매한 원문을 확정하지 못했습니다. 기존 행을 유지했습니다. 품목을 직접 확인해 주세요.'});
    } catch (error) {
      if (!current()) { preserveInput(); return; }
      console.error('[주문 AI 읽기] 실패', error);
      const 사유 = error instanceof Error ? error.message : String(error);
      setAiNote({ tone: 'bad', text: `읽지 못했습니다 — ${사유}` });
    } finally {
      if (aiRequest.current.inFlight === requestId) {
        aiRequest.current.inFlight = 0;
        if (aiRequest.current.open) setAiBusy(false);
      }
    }
  };
  const lineStatuses = parsedLines.map(line => classifyOrderCopyRow(line,{catalog:productPool,rules:interpretationRules.current,partnerId:selectedClientId??''}).status);
  const lineConfirmed = (index:number) => !!parsedLines[index].selectedProductId && ['confirmed','manual','resolved'].includes(lineStatuses[index]);
  const matchedLineCount = parsedLines.filter((_,index) => lineConfirmed(index)).length;
  const unmatchedLineCount = parsedLines.length - matchedLineCount;

  const handleSubmit = async () => {
    if (savingRef.current || isCurrentActor&&!isCurrentActor() || !orderDate || !deadline || !selectedClient) return;
    invalidateAiRead();
    const draft = buildNewOrderDraft({
      partner: selectedClient, items, partnerItems: partnerOut, orderUnitInputs,
      lines: parsedLines.filter(line => line.selectedProductId && line.qty > 0).map(line => ({
        itemId: line.selectedProductId!, quantity: line.qty, isBoxUnit: line.isBox,
        orderedAs: line.orderedAs?.trim()??line.rawText,
      })),
      orderDate, deliveryDate: deadline, shipToId, shipMethod,
      note: orderNote, noteImportant, pallets,
    });
    if (!draft.items.length) return;
    savingRef.current = true;
    setIsSaving(true);
    setSaveError('');
    try {
      await onSave(draft,{sourceText:pasteText,firstAnalysis:firstAnalysis.current?.sourceText===pasteText?firstAnalysis.current.value:{kind:'rules',lines:parsedLines.map(line=>({...line}))},inputLines:parsedLines.map(line=>({orderedAs:line.orderedAs?.trim()??line.rawText,rawName:line.rawName,itemId:line.selectedProductId,quantity:line.qty,isBoxUnit:line.isBox})),expressionConfirmations:expressionLines.flatMap(line=>{const row=expressionInputs[line.sourceStart];if(!row?.confirmed||!row.suggest)return [];if(!draft.note?.split(/\r?\n/).includes(row.value))return [];return [{...line,scope:row.scope,target:row.target,value:row.value}];})});
    } catch (error) {
      console.error('복사 주문 저장 실패', error);
      setSaveError(error instanceof Error ? error.message : '주문을 저장하지 못했습니다.');
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  //  채널 아이콘·색은 [shared/channelStyle](../src/shared/channelStyle) 한 곳이 정한다
  const typeConfig = (type: string) => ({ ...channelStyle(type), color: channelStyle(type).chip });

  const renderOrderSchedule = () => (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 text-slate-700"><CalendarDays size={16} /><h3 className="text-sm font-black">주문 일정</h3></div>
        <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-black text-rose-600">필수</span>
        <span className="text-xs font-medium text-slate-500">주문일과 출고예정일은 자동 설정되며 수정할 수 있습니다.</span>
      </div>
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-bold text-slate-600">주문일</span>
          <input type="date" required value={orderDate} onChange={event => { invalidateAiRead(); setOrderDate(event.target.value); }}
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold tabular-nums text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-bold text-slate-600">출고예정일</span>
          <input type="date" required min={orderDate} value={deadline} onChange={event => { invalidateAiRead(); setDeadline(event.target.value); }}
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold tabular-nums text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
        </label>
      </div>
    </section>
  );

  const clientSectionHeading = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-2 text-slate-700"><User size={16} /><h3 className="text-sm font-black">거래처</h3></div>
      <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-black text-rose-600">필수</span>
    </div>
  );

  const renderSelectedClient = () => {
    if (!selectedClient) return null;
    return (
      <div className="space-y-2">
        {/*  **배송지 딱지 토글**(2026-09-16) — 주문 화면과 같은 모양·같은 자리다.
             배송지를 쓰는 거래처에만 뜬다. 고르면 아래 품목 목록이 따라 바뀐다. */}
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-3">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-black text-slate-800">{selectedClient.name}</span>
              <span className="shrink-0 rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[8px] font-black text-slate-600">{selectedClient.type}</span>
            </div>
            {selectedClient.region && <span className="text-[10px] font-medium text-slate-500">{selectedClient.region}</span>}
          </div>
          <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5" role="group" aria-label="출고 방식">
            {(['배송','화물','수령','택배'] as const).map(method => <button key={method} type="button" onClick={() => { invalidateAiRead(); manualShippingTarget.current = shippingTarget; setShipMethod(method); }} aria-pressed={shipMethod===method} className={`min-h-9 rounded-md px-2.5 text-[11px] font-bold ${shipMethod===method?'bg-slate-700 text-white':'text-slate-500 hover:bg-slate-100'}`}>{method}</button>)}
          </div>
        </div>
        {activeShipTos(selectedClient).length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
            <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-slate-600">배송지</p>
            <div className="flex flex-wrap gap-1.5">
              {activeShipTos(selectedClient).map(st => (
                <button key={st.id} type="button" onClick={() => { invalidateAiRead(); setShipToId(st.id); }} aria-pressed={shipToId === st.id}
                  className={`rounded-lg px-3 py-1.5 text-xs font-black transition-all ${
                    shipToId === st.id ? 'bg-slate-700 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100'}`}
                >{st.name}</button>
              ))}
            </div>
          </div>
        )}
        <button type="button" onClick={changeClient}
          className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg px-3 text-xs font-bold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2">
          <User size={14} aria-hidden="true" />
          거래처 다시 선택
        </button>
      </div>
    );
  };

  return (
    <ModalShell title="주문 등록 · 주문 내역 붙여넣기" onClose={() => { if (!savingRef.current) closeModal(); }} bodyClassName="!p-0">
        {onBack && <button type="button" onClick={() => { if (!savingRef.current) backModal(); }} className="mx-5 mt-4 text-xs font-bold text-slate-500 hover:text-indigo-600">← 주문 입력 방식 선택</button>}

        {/* 스텝 인디케이터 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {renderOrderSchedule()}

          {/* ── STEP 1: 거래처 선택 ── */}
          {step === 'partner' && (
            <div className="space-y-4">
              {clientSectionHeading}
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input type="text" placeholder="거래처명 검색..." value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-12 pr-4 py-3 text-sm outline-none focus:ring-2 focus:ring-violet-400" />
                {filteredClients.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-100 rounded-2xl shadow-xl z-20 overflow-hidden max-h-60 overflow-y-auto">
                    {filteredClients.map(c => (
                      <button key={c.id} onClick={() => selectClient(c)}
                        className={`w-full px-5 py-3 text-left flex items-center justify-between transition-colors ${selectedClient?.id === c.id ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-slate-50'}`}>
                        <p className="font-bold text-slate-800 text-sm">{c.name}</p>
                        <ArrowRight size={16} className="text-slate-300" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {!searchTerm && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {quickClients.map(c => {
                    const cfg = typeConfig(c.type);
                    const Icon = cfg.icon;
                    return (
                      <button key={c.id}
                        onClick={() => selectClient(c)}
                        className={`rounded-2xl border p-3 text-left transition-all ${selectedClient?.id === c.id ? 'border-indigo-400 bg-indigo-50 ring-2 ring-indigo-100' : 'border-slate-200 bg-white hover:border-indigo-200 hover:bg-slate-50'}`}>
                        <div className="flex items-center gap-2">
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${cfg.color}`}><Icon size={16} /></div>
                          <span className="text-xs font-bold text-slate-900 truncate">{c.name}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── STEP 2: 붙여넣기 ── */}
          {step === 'paste' && selectedClient && (
            <div className="space-y-4">
              {clientSectionHeading}
              {renderSelectedClient()}

              <div>
                <p className="text-xs font-black text-slate-500 mb-2">주문 내용 붙여넣기</p>
                <textarea
                  autoFocus
                  value={pasteText}
                  onChange={e => { invalidateAiRead(); setPasteText(e.target.value); }}
                  placeholder={"주문 내용을 그대로 붙여넣으세요.\n\n예)\n청정 검정깨 3박스\n검정깨가루 3박스\n탈피들깨 5박스\n들깨중간 1kg 3박스"}
                  className="w-full h-52 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-violet-400 resize-none placeholder:text-slate-300 leading-relaxed"
                />
                <p className="text-[10px] text-slate-400 mt-1.5 px-1">한 줄에 품목 하나씩 — 품목명 + 수량 + 단위(박스/개)</p>
              </div>
            </div>
          )}

          {/* ── STEP 3: 확인 ── */}
          {step === 'review' && (
            <div className="space-y-5">
              {clientSectionHeading}
              {renderSelectedClient()}
              {/* 품목별 잘린 문장만 보면 누락·오인식을 찾기 어렵다. 판독 전 원문 전체를
                  결과 바로 위에 남겨 사용자가 원문과 매칭 결과를 직접 대조하게 한다. */}
              <section className="rounded-xl border border-slate-200 bg-slate-50/80 p-4" aria-labelledby="original-order-title">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 id="original-order-title" className="text-sm font-black text-slate-700">원본 주문</h3>
                  <button
                    type="button"
                    onClick={() => { invalidateAiRead(); setStep('paste'); }}
                    className="shrink-0 text-[11px] font-bold text-indigo-600 hover:text-indigo-800"
                  >
                    원문 수정
                  </button>
                </div>
                <p className="max-h-36 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-medium leading-5 text-slate-700">
                  {pasteText}
                </p>
              </section>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-slate-700">
                  <ShoppingBag size={16} />
                  <h3 className="text-sm font-black">주문 품목</h3>
                  <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-black text-rose-600">필수</span>
                </div>
                <button type="button" onClick={() => { invalidateAiRead(); setStep('paste'); }} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-xs font-bold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2">
                  <ClipboardPaste size={14} aria-hidden="true" />
                  주문 내용 다시 입력
                </button>
              </div>
              {/*  **못 읽었으면 AI 에게 다시 시킨다**(2026-09-15 사장님). 규칙이 잘 읽은 주문은
                   누를 일이 없으므로 값이 안 든다 — 말로 온 주문만 이쪽으로 간다. */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-bold text-slate-400">
                  확정된 줄은 유지하고 애매한 부분만 AI로 다시 읽습니다.
                </p>
                <button
                  type="button"
                  onClick={aiRead}
                  disabled={aiBusy || !pasteText.trim()}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-2.5 text-[11px] font-black text-indigo-600 transition-colors enabled:hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Sparkles size={12} aria-hidden="true" />{aiBusy ? '읽는 중…' : 'AI로 다시 읽기'}
                </button>
              </div>
              {aiNote && (
                <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold leading-4 text-slate-600">
                  {aiNote.text}
                </p>
              )}
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-3" role="status">
                <div className="flex items-start gap-2.5">
                  {unmatchedLineCount === 0 ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" /> : <AlertCircle size={18} className={`mt-0.5 shrink-0 ${matchedLineCount === 0 ? 'text-rose-600' : 'text-amber-600'}`} aria-hidden="true" />}
                  <div className="min-w-0">
                    <p className="text-xs font-black text-slate-800">
                      {unmatchedLineCount === 0 ? '모든 주문 품목을 확인했습니다.' : matchedLineCount === 0 ? '주문 품목과 수량을 확인해주세요.' : '일부 품목의 확인이 필요합니다.'}
                    </p>
                    <p className="mt-0.5 text-[11px] font-medium text-slate-500">
                      전체 <span className="font-black text-indigo-600">{parsedLines.length}건</span> · 성공 <span className="font-black text-emerald-600">{matchedLineCount}건</span> · 확인 필요 <span className={unmatchedLineCount > 0 ? 'font-black text-amber-600' : 'font-black text-slate-500'}>{unmatchedLineCount}건</span>
                      {unmatchedLineCount > 0 && ' — 품목·수량을 직접 확인하거나 애매한 부분만 AI로 다시 읽어주세요.'}
                    </p>
                  </div>
                </div>
              </div>
              {expressionLines.some(line=>!parsedLines.some(parsed=>parsed.selectedProductId&&parsed.rawText.trim()===line.sourceText.trim()))&&<section className="space-y-3 rounded-lg border border-slate-200 bg-white p-3"><button type="button" className="rounded border border-slate-300 bg-white px-3 py-2 text-sm" aria-expanded={expressionOpen} onClick={()=>setExpressionOpen(value=>!value)}>원문 표현 확인</button>{expressionOpen&&<><p className="text-xs">품목 외 요청은 필요한 비고로 직접 확인해주세요. 배송 방식과 날짜는 원문에서 추정하지 않습니다.</p>
                {expressionLines.filter(line=>!parsedLines.some(parsed=>parsed.selectedProductId&&parsed.rawText.trim()===line.sourceText.trim())).map(line=>{const row=expressionInputs[line.sourceStart]??choice(line.sourceText);const update=(patch:Partial<typeof row>)=>{invalidateAiRead();setExpressionInputs(current=>({...current,[line.sourceStart]:{...row,...patch,confirmed:false}}));};return <div key={line.sourceStart} className="space-y-2 border-t border-slate-200 pt-3"><p>{line.sourceText}</p><div className="flex flex-wrap gap-2"><input aria-label={`표현 ${line.sourceStart} 확인값`} className="rounded border border-slate-300 p-2" value={row.value} onChange={event=>update({value:event.target.value})}/></div><label className="block text-xs"><input type="checkbox" aria-label={`표현 ${line.sourceStart} 내용 확인`} checked={row.confirmed} disabled={!row.value.trim()||line.sourceText.length>200} onChange={event=>confirmExpression(line.sourceStart,row,event.target.checked)}/> 내용을 확인해 주문에 반영</label><label className="block text-xs"><input type="checkbox" aria-label={`표현 ${line.sourceStart} 규칙 제안`} checked={row.suggest} onChange={event=>setExpressionInputs(current=>({...current,[line.sourceStart]:{...row,suggest:event.target.checked}}))}/> 확인한 내용을 판독 규칙으로 제안</label>{row.suggest&&<select aria-label={`표현 ${line.sourceStart} 적용 범위`} value={row.scope} onChange={event=>setExpressionInputs(current=>({...current,[line.sourceStart]:{...row,scope:event.target.value as typeof row.scope}}))}><option value="partner">이 거래처만</option><option value="company">현재 회사 공통</option></select>}</div>;})}
              </>}</section>}
              {parsedLines.map((line, idx) => {
                const matched = line.selectedProductId
                  ? productPool.find(p => p.id === line.selectedProductId) : null;
                return (
                  <div key={idx} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
                    {/* 원문 + 상태 */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-xs font-medium text-slate-500">"{line.rawText}"</span>
                      <span className={`shrink-0 px-1 py-1 text-[11px] font-bold leading-none ${lineConfirmed(idx) ? 'text-emerald-700' : 'text-amber-700'}`}>
                        {lineConfirmed(idx) ? lineStatuses[idx]==='manual' ? '직접 확인' : lineStatuses[idx]==='resolved' ? 'AI 판독 반영' : '분석 성공' : '확인 필요'}
                      </span>
                    </div>
                    {!lineConfirmed(idx)&&<p className="text-xs text-slate-600">{lineStatuses[idx]==='conflict'?'승인된 별칭이 여러 품목과 겹칩니다. 품목과 수량을 직접 확인해주세요.':'품목이나 주문 수량을 확정하지 못했습니다. 표시된 수량은 기본값일 수 있습니다. 직접 확인하거나 AI로 다시 읽어주세요.'}</p>}
                    {/* 품목 선택 + 수량 */}
                    <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <div className="relative min-w-0">
                        <select
                          value={line.selectedProductId ?? ''}
                          onChange={e => {
                            invalidateAiRead();
                            const val = e.target.value || null;
                            setParsedLines(prev => prev.map((l, i) => i === idx ? { ...l, selectedProductId: val, manual:true } : l));
                          }}
                          className="h-11 w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 py-2 pl-4 pr-10 text-sm font-bold text-slate-700 outline-none transition-colors focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                        >
                          <option value="">— 제외 —</option>
                          {productPool.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                        <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <input type="number" min={1} value={line.qty}
                          onChange={e => {
                            invalidateAiRead();
                            const qty = Math.max(1, parseInt(e.target.value) || 1);
                            setParsedLines(prev => prev.map((l, i) => i === idx ? { ...l, qty, manual:true } : l));
                          }}
                          className="h-11 w-20 rounded-xl border border-slate-200 bg-slate-50 px-2 text-center text-sm font-black text-slate-700 outline-none transition-colors focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                        />
                        <div className="flex h-11 items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
                          {(['박스', '개'] as const).map(unit => (
                            <button key={unit} type="button"
                              onClick={() => { invalidateAiRead(); setParsedLines(prev => prev.map((l, i) => i === idx ? { ...l, isBox: unit === '박스', manual:true } : l)); }}
                              className={`h-9 min-w-12 rounded-lg px-2.5 text-xs font-bold transition-colors ${(unit === '박스') === line.isBox ? 'bg-violet-600 text-white shadow-sm' : 'text-slate-500 hover:bg-white hover:text-slate-700'}`}
                            >{unit}</button>
                          ))}
                        </div>
                      </div>
                    </div>
                    {matched && (() => {
                      // 포장 부자재는 현재 BOM에서만 읽는다.
                      const subs = (orderUnitInputs ? orderUnitInputs.bom.of(matched.id) : bomOf(matched.id))
                        .filter(l => ['마개', '테이프', '박스', '용기', '라벨', '비닐', '케이스'].includes(String(l.child?.category ?? '')))
                        .map(l => l.child!.name);
                      return (
                        <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-slate-50 px-3 py-2">
                          <CheckCircle2 size={14} className="shrink-0 text-emerald-500" />
                          <span className="text-xs font-bold text-slate-700">{matched.name} · {line.qty}{line.isBox ? '박스' : '개'}</span>
                          {subs.map((name, i) => (
                            <span key={i} className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-500">{name}</span>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
              {parsedLines.every(l => !l.selectedProductId) && (
                <div className="text-center py-8 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
                  <AlertCircle className="text-slate-300 mx-auto mb-2" size={28} />
                  <p className="text-slate-400 text-sm font-bold">매칭된 품목이 없습니다</p>
                  <p className="text-[11px] text-slate-300 mt-1">드롭다운에서 직접 선택해주세요</p>
                </div>
              )}

              <section className="space-y-2 border-t border-slate-200 pt-5">
                <label htmlFor="pasted-order-note" className="text-sm font-black text-slate-700">주문 비고</label>
                <textarea id="pasted-order-note" value={orderNote} onChange={event => { invalidateAiRead(); automaticNote.current=null; setOrderNote(clampNote(event.target.value)); }}
                  maxLength={NOTE_MAX} rows={2} placeholder="주문 전체에 전달할 내용을 적어 주세요."
                  className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-400" />
                <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
                  <input type="checkbox" checked={noteImportant} onChange={event => { invalidateAiRead(); setNoteImportant(event.target.checked); }} className="accent-rose-500" />
                  중요 비고
                </label>
              </section>

              {palletStocks.some(stock => !stock.hidden) && (
                <section className="space-y-3 border-t border-slate-200 pt-5">
                  <button type="button" aria-expanded={showPallets} onClick={() => setShowPallets(value => !value)}
                    className="flex w-full items-center gap-2 text-left text-sm font-black text-slate-700">
                    <Layers size={16} /> 팔레트
                    {pallets.length > 0 && <span className="text-xs text-slate-500">{pallets.reduce((sum, pallet) => sum + pallet.quantity, 0)}개</span>}
                    <ChevronDown size={15} className={`ml-auto transition-transform ${showPallets ? 'rotate-180' : ''}`} />
                  </button>
                  {showPallets && <div className="grid grid-cols-1 gap-2">
                    {palletStocks
                      .filter(stock => !stock.hidden)
                      .sort((a, b) => (a.name.toLowerCase().includes('kpp') ? 0 : 1) - (b.name.toLowerCase().includes('kpp') ? 0 : 1) || a.name.localeCompare(b.name, 'ko'))
                      .map(stock => {
                        const current = pallets.find(pallet => pallet.type === stock.id)?.quantity ?? 0;
                        const update = (quantity: number) => {
                          invalidateAiRead();
                          const next = Math.max(0, quantity);
                          setPallets(previous => {
                            const rest = previous.filter(pallet => pallet.type !== stock.id);
                            return next > 0 ? [...rest, { type: stock.id, quantity: next }] : rest;
                          });
                        };
                        return (
                          <div key={stock.id} className={`flex items-center justify-between gap-2 rounded-xl border p-3 transition-colors ${current > 0 ? 'border-indigo-300 bg-indigo-50/60' : 'border-slate-200 bg-white'}`}>
                            <div className="min-w-0">
                              <p className="truncate text-xs font-bold text-slate-800">{stock.name}</p>
                              {current > 0 && <p className="mt-0.5 text-[10px] font-bold text-indigo-500">{current}개 선택</p>}
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              <button type="button" onClick={() => update(current - 1)} aria-label={`${stock.name} 수량 줄이기`} className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-sm font-black text-slate-600 hover:bg-slate-200">−</button>
                              <span className="w-8 text-center text-xs font-black text-slate-800">{current}</span>
                              <button type="button" onClick={() => update(current + 1)} aria-label={`${stock.name} 수량 늘리기`} className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-sm font-black text-slate-600 hover:bg-slate-200">+</button>
                            </div>
                          </div>
                        );
                      })}
                  </div>}
                </section>
              )}
            </div>
          )}
        </div>

        {saveError && (
          <div className="mx-5 mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700">
            저장하지 못했습니다: {saveError}
          </div>
        )}

        {/* 하단 버튼 */}
        <div className="rounded-b-3xl">
          {step === 'partner' && (
            <ModalActionFooter
              onCancel={() => { if (!savingRef.current) closeModal(); }}
            />
          )}
          {step === 'paste' && (
            <ModalActionFooter
              onCancel={() => { if (!savingRef.current) closeModal(); }}
              onPrimary={analyze}
              primaryLabel="분석하기"
              primaryDisabled={!orderDate || !deadline || !pasteText.trim()}
            />
          )}
          {step === 'review' && (
            <ModalActionFooter
              onCancel={() => { if (!savingRef.current) closeModal(); }}
              onPrimary={handleSubmit}
              primaryLabel={isSaving ? '저장 중…' : `주문 생성 (${parsedLines.filter(line => line.selectedProductId).length}건)`}
              primaryDisabled={isSaving || !orderDate || !deadline || !parsedLines.some(line => line.selectedProductId && line.qty > 0)}
            />
          )}
        </div>
    </ModalShell>
  );
};

export default PasteOrderModal;
