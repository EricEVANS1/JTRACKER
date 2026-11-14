import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Modal } from './Modal';
import { ConfirmationContext, type Confirmation } from '../hooks/useConfirmation';

export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Confirmation | null>(null);
  const resolve = useRef<((confirmed: boolean) => void) | null>(null);

  const confirm = useCallback((options: Confirmation) => {
    if (resolve.current) return Promise.resolve(false);
    return new Promise<boolean>((complete) => {
      resolve.current = complete;
      setRequest(options);
    });
  }, []);

  function finish(confirmed: boolean) {
    const complete = resolve.current;
    resolve.current = null;
    setRequest(null);
    complete?.(confirmed);
  }

  return (
    <ConfirmationContext.Provider value={confirm}>
      {children}
      {request && (
        <Modal
          labelledBy="confirmation-title"
          describedBy="confirmation-description"
          onClose={() => finish(false)}
          className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-xl backdrop:bg-slate-950/50"
        >
          <h2 id="confirmation-title" className="text-lg font-semibold">{request.title}</h2>
          <p id="confirmation-description" className="mt-2 break-words text-sm leading-6 text-slate-600">{request.description}</p>
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => finish(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium hover:bg-slate-50">
              {request.cancelLabel ?? 'Cancel'}
            </button>
            <button type="button" onClick={() => finish(true)} className={`rounded-xl px-4 py-2 text-sm font-semibold text-white ${request.destructive ? 'bg-red-700 hover:bg-red-800' : 'bg-slate-900 hover:bg-slate-700'}`}>
              {request.action}
            </button>
          </div>
        </Modal>
      )}
    </ConfirmationContext.Provider>
  );
}
