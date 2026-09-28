import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type Tone = 'info' | 'good' | 'error' | 'warn';
interface Toast { id: number; message: string; tone: Tone }

interface ToastApi {
  push: (message: string, tone?: Tone) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  warn: (message: string) => void;
}

const ToastContext = createContext<ToastApi>({
  push: () => {}, success: () => {}, error: () => {}, warn: () => {},
});

let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, tone: Tone = 'info') => {
    seq += 1;
    const id = seq;
    setToasts((list) => [...list, { id, message, tone }]);
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), tone === 'error' ? 7000 : 4200);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      push,
      success: (m) => push(m, 'good'),
      error: (m) => push(m, 'error'),
      warn: (m) => push(m, 'warn'),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.tone}`}>
            <span aria-hidden="true">{t.tone === 'good' ? '✓' : t.tone === 'error' ? '!' : t.tone === 'warn' ? '⚠' : 'i'}</span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
