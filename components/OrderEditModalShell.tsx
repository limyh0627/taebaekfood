import React from 'react';
import ModalActionFooter from '../src/shared/components/ModalActionFooter';
import ModalShell from '../src/shared/components/ModalShell';

interface OrderEditModalShellProps {
  title: string;
  partnerName: string;
  context: string;
  onClose: () => void;
  onSave: () => void;
  saveDisabled?: boolean;
  /**
   * 머리 오른쪽, 닫기 단추 왼쪽에 놓을 것 — 지금은 '로그' 단추가 여기 들어간다
   * (2026-09-14 사장님: "상단 헤더에 로그보기 버튼을 넣어서").
   */
  headerAction?: React.ReactNode;
  children: React.ReactNode;
}

const OrderEditModalShell: React.FC<OrderEditModalShellProps> = ({
  title,
  partnerName,
  context,
  onClose,
  onSave,
  saveDisabled = false,
  headerAction,
  children,
}) => (
  <ModalShell
    title={title}
    subtitle={`${partnerName} · ${context}`}
    onClose={onClose}
    footer={<ModalActionFooter
        onCancel={onClose}
        onPrimary={onSave}
        primaryLabel="변경 저장"
        primaryDisabled={saveDisabled}
      />}
  >
    {headerAction && <div className="mb-3 flex justify-end">{headerAction}</div>}
    {children}
  </ModalShell>
);

export default OrderEditModalShell;
