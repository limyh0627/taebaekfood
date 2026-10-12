import React from 'react';

/** 기존 업무 모달과 확인창의 최상층 초점 순환·복원을 공유합니다. Escape와 닫기 정책은 변경하지 않습니다. */
export function useDialogFocus(dialogRef: React.RefObject<HTMLDivElement | null>) {
  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const topDialog = (exclude?: HTMLElement) => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'))
      .filter(node => node !== exclude)
      .sort((a, b) => (Number(getComputedStyle(a.parentElement!).zIndex) || 0) - (Number(getComputedStyle(b.parentElement!).zIndex) || 0)).at(-1);
    const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'))
      .filter(node => node.tabIndex >= 0 && node.closest('[role="dialog"]') === dialog && !node.closest('[hidden], [aria-hidden="true"]') && node.getClientRects().length > 0)
      .sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    const focusFirst = () => (controls()[0] ?? dialog).focus();
    const onFocus = (event: FocusEvent) => {
      if (topDialog() === dialog && !dialog.contains(event.target as Node)) focusFirst();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || topDialog() !== dialog) return;
      const nodes = controls();
      const first = nodes[0], last = nodes.at(-1);
      if (!first || !dialog.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last ?? dialog : first ?? dialog).focus();
      }
    };
    if (topDialog() === dialog && !dialog.contains(document.activeElement)) focusFirst();
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocus, true);
      const remaining = topDialog(dialog);
      if (previous?.isConnected && (!remaining || remaining.contains(previous))) previous.focus();
    };
  }, []);
}
