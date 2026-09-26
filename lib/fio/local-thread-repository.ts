import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ReferenceContextDraftRepository, Thread, ThreadRepository } from './types';

const STORAGE_KEY = '@fio/threads/v1';
const REFERENCE_CONTEXT_DRAFT_KEY = '@fio/reference-context-draft/v1';

type StoredThreads = Record<string, Thread>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAttachment(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.kind === 'image' &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.uri === 'string' &&
    typeof value.mimeType === 'string' &&
    typeof value.createdAt === 'string'
  );
}

function isTurn(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.role === 'user' || value.role === 'fio') &&
    typeof value.id === 'string' &&
    typeof value.text === 'string' &&
    (value.contextText === undefined || typeof value.contextText === 'string') &&
    Array.isArray(value.attachmentIds) &&
    value.attachmentIds.every((id) => typeof id === 'string') &&
    typeof value.createdAt === 'string'
  );
}

function isArtifact(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.kind === 'message' || value.kind === 'reply' || value.kind === 'notes') &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.text === 'string' &&
    (value.previous === undefined ||
      (isRecord(value.previous) &&
        typeof value.previous.text === 'string' &&
        typeof value.previous.savedAt === 'string')) &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  );
}

function isThread(value: unknown): value is Thread {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    (value.referenceContext === undefined || typeof value.referenceContext === 'string') &&
    Array.isArray(value.turns) &&
    value.turns.every(isTurn) &&
    Array.isArray(value.attachments) &&
    value.attachments.every(isAttachment) &&
    Array.isArray(value.artifacts) &&
    value.artifacts.every(isArtifact) &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    typeof value.revision === 'number'
  );
}

export class LocalThreadRepository implements ThreadRepository {
  private operation = Promise.resolve();

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.operation.then(work, work);
    this.operation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async readAll(): Promise<StoredThreads> {
    const value = await AsyncStorage.getItem(STORAGE_KEY);
    if (!value) return {};
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) {
      throw new Error('Saved writing could not be read.');
    }
    const records: StoredThreads = {};
    for (const [id, thread] of Object.entries(parsed)) {
      if (!isThread(thread)) throw new Error('Saved writing could not be read.');
      records[id] = thread;
    }
    return records;
  }

  list(): Promise<Thread[]> {
    return this.enqueue(async () => {
      const records = await this.readAll();
      return Object.values(records).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  }

  get(id: string): Promise<Thread | null> {
    return this.enqueue(async () => {
      const records = await this.readAll();
      return records[id] ?? null;
    });
  }

  save(thread: Thread): Promise<void> {
    return this.enqueue(async () => {
      const records = await this.readAll();
      const current = records[thread.id];
      if (current && current.revision >= thread.revision) return;
      records[thread.id] = thread;
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    });
  }

  delete(id: string): Promise<void> {
    return this.enqueue(async () => {
      const records = await this.readAll();
      delete records[id];
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    });
  }
}

export const threadRepository: ThreadRepository = new LocalThreadRepository();

class LocalReferenceContextDraftRepository implements ReferenceContextDraftRepository {
  private operation = Promise.resolve();

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.operation.then(work, work);
    this.operation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  get(): Promise<string> {
    return this.enqueue(
      async () => (await AsyncStorage.getItem(REFERENCE_CONTEXT_DRAFT_KEY)) ?? '',
    );
  }

  save(value: string): Promise<void> {
    return this.enqueue(() => AsyncStorage.setItem(REFERENCE_CONTEXT_DRAFT_KEY, value));
  }

  clear(): Promise<void> {
    return this.enqueue(() => AsyncStorage.removeItem(REFERENCE_CONTEXT_DRAFT_KEY));
  }
}

export const referenceContextDraftRepository: ReferenceContextDraftRepository =
  new LocalReferenceContextDraftRepository();
