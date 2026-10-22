import { useEffect, useRef, useState } from 'react';
import type { CompanyId, CompanyInfo } from '../../../shared/types';
import type { CompanyInfoRead } from '../../../shared/hooks/useCompanyInfoRead';
export type StatementCompanyInfoRead = CompanyInfoRead;
export interface StatementCompanyInfoLease {
    companyInfo: CompanyInfo;
    isCurrent(): boolean;
}
export function useStatementCompanyInfoGuard(options: {
    companyId: CompanyId;
    companyInfo?: CompanyInfo | null;
    read?: StatementCompanyInfoRead;
    onOpenSettings?: () => void;
}) {
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const owner = useRef({ companyId: options.companyId, identity: {} });
    if (owner.current.companyId !== options.companyId)
        owner.current = { companyId: options.companyId, identity: {} };
    const latest = useRef(options);
    latest.current = options;
    const [changed, setChanged] = useState(false);
    const ready = options.read?.companyId === options.companyId && options.read?.status === 'ready' && !!options.read.value
        && options.read.value === options.companyInfo
        && options.read.isCurrent(options.read.observationToken);
    const message = changed ? '회사 정보가 바뀌었습니다. 작성 내용은 유지했습니다. 회사 정보를 확인한 뒤 다시 시도해 주세요.'
        : options.read?.status === 'error' ? '회사 정보를 읽지 못했습니다. 다시 읽거나 회사 설정을 확인해 주세요.'
            : options.read?.status === 'missing' ? '현재 회사 정보가 없습니다. 회사 설정을 확인해 주세요.'
                : '현재 회사 정보를 확인하고 있습니다. 확인 후 발행·출력을 다시 시도해 주세요.';
    const acquire = (): StatementCompanyInfoLease | null => {
        if (!ready || !options.read?.value)
            return null;
        setChanged(false);
        const value = options.read.value;
        const captured = options, read = options.read, token = read.observationToken, identity = owner.current.identity;
        return { companyInfo: value, isCurrent() {
                const now = latest.current;
                const current = mounted.current && owner.current.identity === identity && now.read?.companyId === captured.companyId && now.companyId === captured.companyId && now.read?.status === 'ready'
                    && now.companyInfo === read.value && now.read.value === read.value
                    && now.read.observationToken === token && now.read.isCurrent(token) && read.isCurrent(token);
                if (!current && mounted.current && owner.current.identity === identity)
                    setChanged(true);
                return current;
            } };
    };
    return { blocked: !ready || changed, message, acquire,
        retry: () => { setChanged(false); options.read?.retry(); },
        openSettings: options.onOpenSettings };
}
