export interface AppConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  tone?: 'indigo' | 'emerald' | 'amber' | 'rose';
}

export interface AppPromptOptions {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmText?: string;
}

type ConfirmRequest = AppConfirmOptions & { kind: 'confirm'; resolve: (value: boolean) => void };
type NoticeRequest = { kind: 'notice'; title: string; message: string; resolve: () => void };
type PromptRequest = AppPromptOptions & { kind: 'prompt'; resolve: (value: string | null) => void };
export type AppDialogRequest = ConfirmRequest | NoticeRequest | PromptRequest;

const listeners = new Set<(request: AppDialogRequest) => void>();

export const subscribeAppDialog = (listener: (request: AppDialogRequest) => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

const publish = (request: AppDialogRequest) => {
  const listener = [...listeners][0];
  if (!listener) {
    if (request.kind === 'confirm') request.resolve(false);
    else if (request.kind === 'notice') request.resolve();
    else request.resolve(null);
    return;
  }
  listener(request);
};

export const appConfirm = (messageOrOptions: string | AppConfirmOptions): Promise<boolean> =>
  new Promise(resolve => publish({
    kind: 'confirm',
    ...(typeof messageOrOptions === 'string' ? { message: messageOrOptions } : messageOrOptions),
    resolve,
  }));

/** 후속 상태 전환 전에 사용자가 내용을 확인해야 하는 알림. */
export const appNotice = (message: string, title = '확인 필요'): Promise<void> =>
  new Promise(resolve => publish({ kind: 'notice', title, message, resolve }));

export const appPrompt = (
  messageOrOptions: string | AppPromptOptions,
  defaultValue = '',
): Promise<string | null> => new Promise(resolve => publish({
  kind: 'prompt',
  ...(typeof messageOrOptions === 'string'
    ? { title: messageOrOptions, defaultValue }
    : messageOrOptions),
  resolve,
}));
