import { useState } from 'react';
import { today, weekMonday, weekSunday } from '../../../shared/day';
import type { StatementType } from '../../../shared/statementLines';

/** 전표 작성 창 한 번을 열어 거래처·주문·일자와 발행 옵션을 고르는 상태. */
export function useStatementComposerSession() {
  const [createMode, setCreateMode] = useState<StatementType | null>(null);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [partnerSearch, setPartnerSearch] = useState('');
  const [onlyActive, setOnlyActive] = useState(true);
  const [activeVisible, setActiveVisible] = useState(30);
  const [dateFrom, setDateFrom] = useState(weekMonday);
  const [dateTo, setDateTo] = useState(weekSunday);
  const [orderDateQuick, setOrderDateQuick] = useState<'당일'|'금주'|'당월'|'전체'|''>('금주');
  const [tradeDate, setTradeDate] = useState(today);
  const [showPreview, setShowPreview] = useState(false);
  const [stmtMemo, setStmtMemo] = useState('');
  const [loadedPoIds, setLoadedPoIds] = useState<string[]>([]);
  const [manageExpense, setManageExpense] = useState(false);
  const [tradeNote, setTradeNote] = useState('');
  const [issuePay, setIssuePay] = useState(false);
  const [issuePayAmount, setIssuePayAmount] = useState('');

  return {
    createMode, setCreateMode, selectedClientId, setSelectedClientId, selectedOrderIds, setSelectedOrderIds,
    partnerSearch, setPartnerSearch, onlyActive, setOnlyActive, activeVisible, setActiveVisible,
    dateFrom, setDateFrom, dateTo, setDateTo, orderDateQuick, setOrderDateQuick,
    tradeDate, setTradeDate, showPreview, setShowPreview, stmtMemo, setStmtMemo,
    loadedPoIds, setLoadedPoIds, manageExpense, setManageExpense, tradeNote, setTradeNote,
    issuePay, setIssuePay, issuePayAmount, setIssuePayAmount,
  };
}
