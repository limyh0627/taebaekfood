import {memo} from 'react';
import {Box,ChevronDown,ChevronUp} from 'lucide-react';
import type {Order,OrderSource,Partner,Item,PartnerItem,OrderItem,OrderStatus} from '../../../shared/types';
import type {OrderUnitInputs} from '../../../shared/orderUnits';
import {channelStyle} from '../../../shared/channelStyle';
import {OrderCard} from './OrderCard';

interface OrderSourceGroupProps {
  orderUnitInputs?: OrderUnitInputs;
  colId: string;
  source: OrderSource;
  orders: Order[];
  gridCols?: number;
  collapsedCategories: Set<string>;
  onToggleCategory: (colId: string, source: OrderSource) => void;
  partners: Partner[];
  items: Item[];
  partnerItems?: PartnerItem[];
  editingOrderId: string | null;
  setEditingOrderId: (id: string | null) => void;
  showAddProductSelect: string | null;
  setShowAddProductSelect: (id: string | null) => void;
  onUpdateItems?: (id: string, items: OrderItem[]) => void;
  onUpdateDeliveryDate: (id: string, date: string) => void;
  onUpdateStatus: (id: string, status: OrderStatus) => void;
  /**
   * 송장 칸을 바꾼다. `boolean` 은 옛 뜻(출력 했나/안 했나)이고,
   * `'printed' | 'attached' | undefined` 는 **세 단계**다(2026-09-11 사장님).
   * 받는 쪽이 둘을 같이 저장해 옛 화면과 어긋나지 않게 한다.
   */
  onToggleInvoicePrinted?: (id: string, value: boolean | 'printed' | 'attached' | undefined) => void;
  onToggleItemChecked?: (orderId: string, itemIdx: number, checkedBy?: string) => void;
  onDeleteOrder: (id: string) => Promise<boolean> | void;
  currentUserName?: string;
  isListView?: boolean;
  highlightOrderId?: string | null;
  onCardClick?: (orderId: string) => void;
  onEditOrder?: (orderId: string) => void;
  tintedHeader?: boolean;
}

const sourceConfig = (s: string) => {
  const c = channelStyle(s);
  return { icon: c.icon, color: c.fg, bgColor: c.bg };
};

export const OrderSourceGroup = memo<OrderSourceGroupProps>(({
  colId, source, orders, gridCols = 1,
  collapsedCategories, onToggleCategory,
  ...cardProps
}) => {
  const isCollapsed = collapsedCategories.has(`${colId}-${source}`);
  if (orders.length === 0) return null;

  const config = sourceConfig(source) || { icon: Box, color: 'text-slate-600', bgColor: 'bg-slate-50' };
  const Icon = config.icon;

  return (
    <div className="space-y-3">
      <button
        onClick={() => onToggleCategory(colId, source)}
        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl transition-all hover:bg-white/60 ${config.bgColor} border border-white/40 shadow-sm`}
      >
        <div className="flex items-center space-x-2">
          <Icon size={14} className={config.color} />
          <span className={`text-[11px] font-black uppercase tracking-wider ${config.color}`}>{source} ({orders.length})</span>
        </div>
        {isCollapsed ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronUp size={14} className="text-slate-400" />}
      </button>
      {!isCollapsed && (
        <div className={`${gridCols === 3 ? 'sm:columns-3' : gridCols === 2 ? 'sm:columns-2' : 'columns-1'} gap-3`}>
          {orders.map(order => (
            <div key={order.id} className="break-inside-avoid mb-3">
              <OrderCard order={order} {...cardProps} gridCols={gridCols} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
