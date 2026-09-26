import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import { threadRepository } from './local-thread-repository';
import type { Thread } from './types';

interface ThreadStoreValue {
  active: Thread | null;
  history: Thread[];
  error: string | null;
  isLoading: boolean;
  open: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  persist: (thread: Thread) => Promise<boolean>;
  remove: (id: string) => Promise<void>;
  startNew: () => void;
  clearError: () => void;
}

const ThreadStore = createContext<ThreadStoreValue | null>(null);

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function ThreadStoreProvider({ children }: PropsWithChildren) {
  const [active, setActive] = useState<Thread | null>(null);
  const [history, setHistory] = useState<Thread[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setHistory(await threadRepository.list());
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause, 'History could not be loaded.'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const open = useCallback(async (id: string) => {
    setIsLoading(true);
    try {
      const thread = await threadRepository.get(id);
      if (!thread) throw new Error('This conversation is no longer available.');
      setActive(thread);
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause, 'Conversation could not be opened.'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const persist = useCallback(async (thread: Thread) => {
    setActive(thread);
    try {
      await threadRepository.save(thread);
      setHistory(await threadRepository.list());
      setError(null);
      return true;
    } catch (cause) {
      setError(errorMessage(cause, 'Your latest change could not be saved.'));
      return false;
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    try {
      await threadRepository.delete(id);
      setHistory(await threadRepository.list());
      setActive((current) => (current?.id === id ? null : current));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause, 'Conversation could not be deleted.'));
    }
  }, []);

  const value = useMemo<ThreadStoreValue>(
    () => ({
      active,
      history,
      error,
      isLoading,
      open,
      refresh,
      persist,
      remove,
      startNew: () => setActive(null),
      clearError: () => setError(null),
    }),
    [active, history, error, isLoading, open, persist, refresh, remove],
  );

  return <ThreadStore.Provider value={value}>{children}</ThreadStore.Provider>;
}

export function useThreadStore() {
  const value = useContext(ThreadStore);
  if (!value) throw new Error('useThreadStore must be used inside ThreadStoreProvider.');
  return value;
}
