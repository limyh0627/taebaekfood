import React, { useState } from 'react';
export interface StatementEditRecoveryRow<Entry> {
    entry: Entry;
    currentState: string;
    cause: string;
    nextAction: string;
}
export interface StatementEditRecoveryPanelProps<Entry> {
    initialView?: 'failure' | 'history';
    recoveryMessage?: string;
    discardLabel?: (entry: Entry) => string;
    failureRows: StatementEditRecoveryRow<Entry>[];
    historyRows: StatementEditRecoveryRow<Entry>[];
    busy: boolean;
    readLoading: boolean;
    readError: string;
    historyLoading: boolean;
    historyError: string;
    historyMore: boolean;
    refresh: () => unknown;
    loadHistory: () => unknown;
    nextHistory: () => unknown;
    inspect: (entry: Entry) => unknown;
    retry: (entry: Entry) => unknown;
    stop: (entry: Entry) => unknown;
    discardCopy: (entry: Entry) => unknown;
    canInspect: (entry: Entry) => boolean;
    canRetry: (entry: Entry) => boolean;
    canStop: (entry: Entry) => boolean;
    canDiscard: (entry: Entry) => boolean;
    describe: (entry: Entry) => string;
    onOpenTerms: () => void;
}
/** 저장·복구 판정은 controller가 소유하고 이 영역은 관측한 행과 동작을 그대로 전달한다. */
export default function StatementEditRecoveryPanel<Entry>(props: StatementEditRecoveryPanelProps<Entry>) {
    const [view, setView] = useState<'failure' | 'history'>(props.initialView ?? 'failure');
    const rows = view === 'failure' ? props.failureRows : props.historyRows;
    const button = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 disabled:opacity-50';
    return (
        <section aria-label="전표 수정 처리 확인" className="space-y-3 border-b border-slate-200 pb-4">
            <h3 className="font-bold text-slate-800">전표 수정 처리 확인</h3>
            <div className="flex flex-wrap gap-2">
                <button className={button} type="button" disabled={props.busy} onClick={() => setView('failure')}>미해결 수정</button>
                <button className={button} type="button" disabled={props.busy || props.historyLoading} onClick={() => { setView('history'); void props.loadHistory(); }}>수정 처리 기록</button>
                <button className={button} type="button" disabled={props.busy || props.readLoading} onClick={() => void props.refresh()}>수정 요청 새로 읽기</button>
            </div>
            {props.recoveryMessage && <p role="status" className="text-sm">{props.recoveryMessage}</p>}
            {props.readLoading && <p role="status">보관한 수정 요청을 읽고 있습니다.</p>}
            {props.readError && <p role="alert">{props.readError}</p>}
            {view === 'history' && props.historyLoading && <p role="status">수정 처리 기록을 확인하고 있습니다.</p>}
            {view === 'history' && props.historyError && <p role="alert">{props.historyError}</p>}
            {!rows.length && !props.readLoading && (
                <p className="text-sm text-slate-600">{view === 'failure' ? '현재 확인이 필요한 수정 요청이 없습니다.' : '이번 목록에 표시할 수정 기록이 없습니다. 목록에 없다는 이유만으로 처리되지 않았다고 단정하지 않습니다.'}</p>
            )}
            {rows.map((row, index) => (
                <article key={index} className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                    <p className="font-bold text-slate-800">{props.describe(row.entry)}</p>
                    <p className="text-sm">현재 상태: {row.currentState}</p>
                    {row.cause && <p className="whitespace-pre-wrap text-sm">내용: {row.cause}</p>}
                    <p className="whitespace-pre-wrap text-sm">다음 행동: {row.nextAction}</p>
                    <div className="flex flex-wrap gap-2">
                        {props.canInspect(row.entry) && <button className={button} type="button" disabled={props.busy} onClick={() => void props.inspect(row.entry)}>수정 결과 확인</button>}
                        {props.canRetry(row.entry) && <button className={button} type="button" disabled={props.busy} onClick={() => void props.retry(row.entry)}>보관한 수정 다시 시도</button>}
                        {props.canStop(row.entry) && <button className={button} type="button" disabled={props.busy} onClick={() => void props.stop(row.entry)}>미처리 수정 중단</button>}
                        {props.canDiscard(row.entry) && <button className={button} type="button" disabled={props.busy} onClick={() => void props.discardCopy(row.entry)}>{props.discardLabel?.(row.entry) ?? '이 기기 수정 사본 정리'}</button>}
                    </div>
                </article>
            ))}
            {view === 'history' && props.historyMore && <button type="button" className={button} disabled={props.busy || props.historyLoading} onClick={() => void props.nextHistory()}>수정 기록 더 보기</button>}
            <p className="text-sm text-slate-600">전표 본문과 거래조건·원가 후속 처리는 따로 확인합니다. 과거 수정 결과를 확인해도 현재 작성 입력은 바뀌지 않습니다.</p>
            <button className={button} type="button" disabled={props.busy} onClick={props.onOpenTerms}>거래조건 후속 확인 열기</button>
            <p className="text-xs text-slate-600">원가는 해당 품목의 현재 원가에서 확인해 주세요. 결과 확인 없이 후속 처리를 다시 실행하지 않습니다.</p>
        </section>
    );
}
