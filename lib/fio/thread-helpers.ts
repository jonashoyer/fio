import * as Crypto from 'expo-crypto';
import type { Artifact, ArtifactKind, Attachment, Thread, Turn } from './types';

export function createThread(firstTurn: Turn): Thread {
  const now = firstTurn.createdAt;
  return {
    id: Crypto.randomUUID(),
    title: firstTurn.text.trim().slice(0, 48) || 'Writing',
    turns: [firstTurn],
    attachments: [],
    artifacts: [],
    createdAt: now,
    updatedAt: now,
    revision: 1,
  };
}

export function createUserTurn(text: string, attachments: Attachment[]): Turn {
  return createTurn('user', text, attachments);
}

export function createFioTurn(text: string): Turn {
  return createTurn('fio', text, []);
}

function createTurn(role: Turn['role'], text: string, attachments: Attachment[]): Turn {
  return {
    id: Crypto.randomUUID(),
    role,
    text: text.trim(),
    attachmentIds: attachments.map(({ id }) => id),
    createdAt: new Date().toISOString(),
  };
}

export function createArtifact(text: string, kind: ArtifactKind = 'notes'): Artifact {
  const now = new Date().toISOString();
  return {
    id: Crypto.randomUUID(),
    kind,
    title:
      kind === 'notes'
        ? 'Notes'
        : kind === 'reply'
          ? 'Reply'
          : kind === 'document'
            ? 'Document'
            : 'Message',
    text,
    createdAt: now,
    updatedAt: now,
  };
}

export function nextThread(
  thread: Thread,
  patch: Partial<
    Pick<Thread, 'turns' | 'attachments' | 'artifacts' | 'title' | 'referenceContext'>
  >,
): Thread {
  return {
    ...thread,
    ...patch,
    updatedAt: new Date().toISOString(),
    revision: thread.revision + 1,
  };
}
