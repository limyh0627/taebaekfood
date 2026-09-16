import { useEffect, useState } from 'react';
import { monthEnd, monthStart, shiftDateRange, today, weekMonday, weekSunday, yearStart } from '../../../shared/day';
import { fetchCollection } from '../../../shared/services/firebaseService';
import type { TaxonomyRow } from '../../../shared/taxonomy';
import type { TimelineSort } from '../../../shared/timelineColumnSort';
import type { VoucherKind } from '../../../shared/vouchers';

/** 전표 조회 탭의 필터·검색·정렬 상태와 분류표 로딩. */
export function useStatementHistoryFilters(defaultTab: 'history' | 'taxinvoice') {
  const [mainTab, setMainTab] = useState<'history' | 'taxinvoice'>(defaultTab);
  const [histFrom, setHistFrom] = useState(today);
  const [histTo, setHistTo] = useState(today);
  const [histKind, setHistKind] = useState<'전체' | VoucherKind>('전체');
  const [histAccount, setHistAccount] = useState('');
  const [taxonomyRows, setTaxonomyRows] = useState<TaxonomyRow[]>([]);
  const [acctPickerOpen, setAcctPickerOpen] = useState(false);
  const [acctQuery, setAcctQuery] = useState('');
  const [histSearch, setHistSearch] = useState('');
  const [histPartner, setHistPartner] = useState('');
  const [partnerPickerOpen, setPartnerPickerOpen] = useState(false);
  const [partnerQuery, setPartnerQuery] = useState('');
  const [acctAxis, setAcctAxis] = useState<'' | '손익' | '재무'>('');
  const [acctBranch, setAcctBranch] = useState('');
  const [acctGroup, setAcctGroup] = useState('');
  const [histQuick, setHistQuick] = useState<'당일'|'금주'|'당월'|'당년'|'ALL'|''>('당일');
  const [historyPage, setHistoryPage] = useState(1);
  const [histSort, setHistSort] = useState<TimelineSort[]>([]);

  useEffect(() => { fetchCollection<TaxonomyRow>('itemTaxonomy').then(setTaxonomyRows).catch(() => {}); }, []);

  const setQuickRange = (preset: '당일'|'금주'|'당월'|'당년'|'ALL') => {
    setHistQuick(preset);
    if (preset === 'ALL') { setHistFrom(''); setHistTo(''); return; }
    const current = today();
    if (preset === '당일') { setHistFrom(current); setHistTo(current); }
    if (preset === '금주') { setHistFrom(weekMonday()); setHistTo(weekSunday()); }
    if (preset === '당월') { setHistFrom(monthStart()); setHistTo(monthEnd()); }
    if (preset === '당년') { setHistFrom(yearStart()); setHistTo(current); }
  };

  const moveRange = (direction: -1 | 1) => {
    const next = shiftDateRange(histFrom, histTo, direction);
    setHistFrom(next.from); setHistTo(next.to); setHistQuick('');
  };

  const resetFilters = () => {
    setQuickRange('당일'); setHistKind('전체'); setHistPartner(''); setHistAccount('');
    setHistSearch(''); setPartnerQuery(''); setAcctQuery(''); setAcctAxis(''); setAcctBranch('');
    setAcctGroup(''); setPartnerPickerOpen(false); setAcctPickerOpen(false);
  };

  return {
    mainTab, setMainTab, histFrom, setHistFrom, histTo, setHistTo, histKind, setHistKind,
    histAccount, setHistAccount, taxonomyRows, acctPickerOpen, setAcctPickerOpen,
    acctQuery, setAcctQuery, histSearch, setHistSearch, histPartner, setHistPartner,
    partnerPickerOpen, setPartnerPickerOpen, partnerQuery, setPartnerQuery,
    acctAxis, setAcctAxis, acctBranch, setAcctBranch, acctGroup, setAcctGroup,
    histQuick, setHistQuick, historyPage, setHistoryPage, histSort, setHistSort,
    setQuickRange, moveRange, resetFilters,
  };
}
