import { useCallback, useEffect, useState } from 'react';

type LoadOptions = {
  suppressBootError?: boolean;
};

type UsePolledStateOptions<T> = {
  fetcher: () => Promise<T>;
  normalize: (payload: T) => T;
  pollIntervalMs?: number;
  pausePolling?: boolean;
  defaultErrorMessage: string;
};

export function usePolledState<T>(options: UsePolledStateOptions<T>) {
  const {
    fetcher,
    normalize,
    pollIntervalMs = 5000,
    pausePolling = false,
    defaultErrorMessage
  } = options;
  const [state, setState] = useState<T | null>(null);
  const [bootError, setBootError] = useState('');

  const reload = useCallback(
    async (loadOptions: LoadOptions = {}) => {
      try {
        const payload = await fetcher();
        const nextState = normalize(payload);
        setBootError('');
        setState(nextState);
        return nextState;
      } catch (error) {
        if (!loadOptions.suppressBootError) {
          setBootError(error instanceof Error ? error.message : defaultErrorMessage);
        }
        throw error;
      }
    },
    [defaultErrorMessage, fetcher, normalize]
  );

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      try {
        const payload = await fetcher();
        if (cancelled) {
          return;
        }
        setBootError('');
        setState(normalize(payload));
      } catch (error) {
        if (cancelled) {
          return;
        }
        setBootError(error instanceof Error ? error.message : defaultErrorMessage);
      }
    };

    void bootstrap();
    const timer = window.setInterval(() => {
      if (pausePolling) {
        return;
      }

      void reload({ suppressBootError: true }).catch(() => undefined);
    }, pollIntervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [defaultErrorMessage, fetcher, normalize, pausePolling, pollIntervalMs, reload]);

  return {
    state,
    setState,
    bootError,
    setBootError,
    reload
  };
}
