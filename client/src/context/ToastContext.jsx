import { createContext, useCallback, useContext, useRef, useState } from 'react';

const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const timer = useRef();

  const notify = useCallback((message, type = 'success') => {
    clearTimeout(timer.current);
    setToast({ message, type });
    timer.current = setTimeout(() => setToast(null), 4500);
  }, []);

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-6 z-[2000] flex justify-center px-4"
      >
        {toast && (
          <div
            role="status"
            className={`pointer-events-auto rounded-xl px-5 py-3 text-sm font-medium text-paper shadow-lg ${
              toast.type === 'error' ? 'bg-clay-dark' : 'bg-ink'
            }`}
          >
            {toast.message}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useToast = () => useContext(ToastContext);
