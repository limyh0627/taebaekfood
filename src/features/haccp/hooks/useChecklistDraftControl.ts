import React, {useRef} from 'react';
import {appConfirm} from '../../../shared/components/appDialog';

export function useChecklistDraftControl() {
  const active = useRef(false), generation = useRef(0), busy = useRef(false), dirty = useRef(false), changing = useRef(false);
  React.useLayoutEffect(() => { active.current = true; return () => { active.current = false; generation.current++; }; }, []);
  const current = (token: number) => active.current && generation.current === token;
  const change = async (action: () => void) => {
    if (busy.current || changing.current) return;
    changing.current = true;
    const token = generation.current;
    try {
      if (dirty.current && !await appConfirm('작성 중인 초안을 버리고 선택한 기록을 여시겠습니까?')) return;
      if (!current(token) || busy.current) return;
      dirty.current = false; generation.current++; action();
    } finally { changing.current = false; }
  };
  return { active, generation, busy, dirty, current, change };
}
