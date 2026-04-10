import { useState, useCallback, useRef, useEffect } from 'react';

export type ToastType = 'success' | 'error' | 'warn' | 'info';

export interface Toast {
  id: number;
  msg: string;
  type: ToastType;
}

let _id = 0;

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    return () => {
      timersRef.current.forEach(t => clearTimeout(t));
      timersRef.current.clear();
    };
  }, []);

  const toast = useCallback((msg: string, type: ToastType = 'info') => {
    const id = ++_id;
    setToasts(prev => [...prev, { id, msg, type }]);
    const tid = setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
      timersRef.current.delete(id);
    }, 3200);
    timersRef.current.set(id, tid);
  }, []);

  return { toasts, toast };
}