import type {OemCostEvidence} from '../../admin/oemCostEvidence';
import type {OrderUnitInputs} from '../../../shared/orderUnits';
import type {CompanyId,Item,Partner,PurchaseOrder} from '../../../shared/types';
import type {OemIssueRetained} from '../../../shared/oemIssuePending';

/**
 * 임가공(OEM) 모달 호스트 — 목록은 기존 입고대기·입고이력에 녹아 있고,
 * 여기서는 발주/가공입고/가공비전표 모달만 띄운다. 열림 상태는 ItemList가 제어.
 */
export interface Props {
  actorUid?: string;
  isCurrentActor?: () => boolean;
  orderUnitInputs?: OrderUnitInputs;
  companyId: CompanyId;
  items: Item[];
  partners: Partner[];
  rawStockKg: (material: string) => number;
  issueDrafts: PurchaseOrder[];
  purchaseOrders?: PurchaseOrder[];
  issueOpen: boolean;
  receiveTarget: PurchaseOrder | null;
  feeTarget: PurchaseOrder | null;
  onClose: () => void;
  onIssue: (input: { jobId: string; oemPartnerId: string; partnerName: string; sent: { material: string; kg: number }[]; date: string; note?: string; oemCostEvidence?: OemCostEvidence },intent?:'new'|'resume',expectedActorUid?:string,retained?:OemIssueRetained) => Promise<void>;
  onReceive: (input: { po: PurchaseOrder; returns: { itemId: string; qty: number }[]; bulk: { material: string; kg: number }[]; unitPricePerKg: number; date: string; oemCostEvidence?: OemCostEvidence }, intent?: 'new' | 'resume',expectedActorUid?:string) => Promise<void>;
  onIssueFee: (input: { po: PurchaseOrder; unitPricePerKg: number; date: string }) => Promise<void>;
}

export type IssueInput = Parameters<Props['onIssue']>[0];

export type ReceiveInput = Parameters<Props['onReceive']>[0];
