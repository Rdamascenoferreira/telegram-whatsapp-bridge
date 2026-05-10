import { useCallback, useEffect, useState } from 'react';

export function useSessionStorageBoolean(key: string, fallback = false) {
  const [value, setValue] = useState(() => {
    if (typeof window === 'undefined') {
      return fallback;
    }

    return window.sessionStorage.getItem(key) === 'true';
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.sessionStorage.setItem(key, value ? 'true' : 'false');
  }, [key, value]);

  const setBoolean = useCallback((nextValue: boolean) => {
    setValue(Boolean(nextValue));
  }, []);

  return [value, setBoolean] as const;
}
