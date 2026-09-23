import React from 'react';
import ModalShell, { type ModalShellProps } from './ModalShell';

type LargeModalShellProps = Omit<ModalShellProps, 'size'>;

/** 표·원장·이력처럼 가로 열이 많은 화면만 쓰는 대형 모달. */
const LargeModalShell: React.FC<LargeModalShellProps> = props => <ModalShell {...props} size="large" />;

export default LargeModalShell;
