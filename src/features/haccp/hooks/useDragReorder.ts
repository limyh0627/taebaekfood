import React, {useState, useRef} from 'react';

export function useDragReorder(move: (_from: number, _to: number) => void, onSettle?: () => void) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const dragRef = useRef<number | null>(null);

  const handleProps = (idx: number) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData('text/plain', ''); // Firefox는 데이터가 있어야 드래그 시작
      e.dataTransfer.effectAllowed = 'move';
      dragRef.current = idx;
      setDragIdx(idx);
    },
    onDragEnd: () => {
      dragRef.current = null;
      setDragIdx(null);
      onSettle?.();
    },
  });

  const rowProps = (idx: number) => ({
    onDragEnter: () => {
      const from = dragRef.current;
      if (from === null || from === idx) return;
      dragRef.current = idx;
      setDragIdx(idx);
      move(from, idx);
    },
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
  });

  return { dragIdx, handleProps, rowProps };
}

export const arrayMove = <T,>(arr: T[], from: number, to: number): T[] => {
  const next = [...arr];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
};
