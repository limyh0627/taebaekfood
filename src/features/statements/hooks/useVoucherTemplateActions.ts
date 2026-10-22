import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../../shared/firebase';
import { appNotice } from '../../../shared/components/appDialog';
import type { CompanyId } from '../../../shared/types';
let nextScope = 0;
export function useVoucherTemplateActions(companyId: CompanyId) {
    const uid = auth.currentUser?.uid ?? '';
    const owner = useRef({ companyId, uid, key: ++nextScope });
    if (owner.current.companyId !== companyId || owner.current.uid !== uid)
        owner.current = { companyId, uid, key: ++nextScope };
    const captured = owner.current;
    const mounted = useRef(false), running = useRef<{
        owner: typeof captured;
    } | null>(null);
    const [, paint] = useState(0);
    const isCurrent = () => mounted.current && owner.current === captured && !!captured.uid && auth.currentUser?.uid === captured.uid;
    const canInteract = () => isCurrent() && running.current?.owner !== captured;
    useEffect(() => {
        mounted.current = true;
        let first = true;
        const stop = onAuthStateChanged(auth, user => {
            if (first && user?.uid === owner.current.uid) {
                first = false;
                return;
            }
            first = false;
            if (!mounted.current)
                return;
            owner.current = { companyId: owner.current.companyId, uid: user?.uid ?? '', key: ++nextScope };
            paint(value => value + 1);
        });
        return () => { mounted.current = false; stop(); };
    }, []);
    const runAction = async (action: (current: () => boolean) => Promise<void>) => {
        if (!canInteract())
            return;
        const run = { owner: captured };
        running.current = run;
        paint(value => value + 1);
        const current = () => isCurrent() && running.current === run;
        try {
            if (current())
                await action(current);
        }
        catch (error) {
            if (current())
                await appNotice('처리하지 못했습니다. 화면과 입력을 유지합니다. 다시 시도해 주세요. ' + String(error), '저장 실패');
        }
        finally {
            if (running.current === run) {
                running.current = null;
                if (mounted.current && owner.current === captured)
                    paint(value => value + 1);
            }
        }
    };
    return { scopeKey: captured.key, busy: running.current?.owner === captured, isCurrent, canInteract, runAction };
}
export type VoucherTemplateActions = ReturnType<typeof useVoucherTemplateActions>;
