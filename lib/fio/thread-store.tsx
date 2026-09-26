import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';

import { referenceContextDraftRepository, threadRepository } from './local-thread-repository';
import { nextThread } from './thread-helpers';
import type { Thread } from './types';

interface ThreadStoreValue {
  active: Thread | null;
  history: Thread[];
  referenceContext: string;
  error: string | null;
  isLoading: boolean;
  open: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  persist: (thread: Thread) => Promise<boolean>;
  remove: (id: string) => Promise<void>;
  setReferenceContext: (value: string) => void;
  saveReferenceContext: (value: string) => Promise<boolean>;
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
  const [referenceContext, setReferenceContext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const shouldLoadInitialDraft = useRef(true);
  const editReferenceContext = useCallback((value: string) => {
    shouldLoadInitialDraft.current = false;
    setReferenceContext(value);
  }, []);

  useEffect(() => {
    void referenceContextDraftRepository
      .get()
      .then((draft) => {
        if (shouldLoadInitialDraft.current) setReferenceContext(draft);
      })
      .catch((cause: unknown) => {
        setError(errorMessage(cause, 'Reference context could not be loaded.'));
      });
  }, []);

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
    shouldLoadInitialDraft.current = false;
    setIsLoading(true);
    try {
      const thread = await threadRepository.get(id);
      if (!thread) throw new Error('This conversation is no longer available.');
      setActive(thread);
      setReferenceContext(thread.referenceContext ?? '');
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause, 'Conversation could not be opened.'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const persist = useCallback(
    async (thread: Thread) => {
      shouldLoadInitialDraft.current = false;
      const isFirstSave = active === null;
      setActive(thread);
      setReferenceContext(thread.referenceContext ?? '');
      try {
        await threadRepository.save(thread);
        if (isFirstSave) await referenceContextDraftRepository.clear();
        setHistory(await threadRepository.list());
        setError(null);
        return true;
      } catch (cause) {
        setError(errorMessage(cause, 'Your latest change could not be saved.'));
        return false;
      }
    },
    [active],
  );

  const saveReferenceContext = useCallback(
    async (value: string) => {
      setReferenceContext(value);
      if (active) {
        return persist(
          nextThread(active, {
            referenceContext: value.trim() ? value : undefined,
          }),
        );
      }

      try {
        await referenceContextDraftRepository.save(value);
        setError(null);
        return true;
      } catch (cause) {
        setError(errorMessage(cause, 'Reference context could not be saved.'));
        return false;
      }
    },
    [active, persist],
  );

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

  const startNew = useCallback(() => {
    shouldLoadInitialDraft.current = false;
    setActive(null);
    setReferenceContext('');
    void referenceContextDraftRepository.clear().catch((cause: unknown) => {
      setError(errorMessage(cause, 'New conversation could not be started cleanly.'));
    });
  }, []);

  const value = useMemo<ThreadStoreValue>(
    () => ({
      active,
      history,
      referenceContext,
      error,
      isLoading,
      open,
      refresh,
      persist,
      remove,
      setReferenceContext: editReferenceContext,
      saveReferenceContext,
      startNew,
      clearError: () => setError(null),
    }),
    [
      active,
      editReferenceContext,
      history,
      referenceContext,
      error,
      isLoading,
      open,
      persist,
      refresh,
      remove,
      saveReferenceContext,
      startNew,
    ],
  );

  return <ThreadStore.Provider value={value}>{children}</ThreadStore.Provider>;
}

export function useThreadStore() {
  const value = useContext(ThreadStore);
  if (!value) throw new Error('useThreadStore must be used inside ThreadStoreProvider.');
  return value;
}
