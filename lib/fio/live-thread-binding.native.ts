import AsyncStorage from '@react-native-async-storage/async-storage';
import type { FioApiClient, JsonObject } from './fio-api-client';
import type { Artifact, Thread } from './types';

export interface LiveThreadBinding {
  localThreadId: string;
  serverThreadId: string;
  artifactIds: Record<string, string>;
}

function record(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject : null;
}

function requiredId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`Live did not confirm ${label}.`);
  return value;
}

function key(localThreadId: string): string { return `@fio/live-binding/v1/${localThreadId}`; }

export async function saveLiveBinding(binding: LiveThreadBinding): Promise<void> {
  await AsyncStorage.setItem(key(binding.localThreadId), JSON.stringify(binding));
}

export async function readLiveBinding(localThreadId: string): Promise<LiveThreadBinding | null> {
  const raw = await AsyncStorage.getItem(key(localThreadId));
  if (!raw) return null;
  const parsed: unknown = JSON.parse(raw);
  const value = record(parsed);
  if (!value || value.localThreadId !== localThreadId || typeof value.serverThreadId !== 'string') {
    throw new Error('The saved Live thread binding is invalid. Manual writing remains available.');
  }
  const ids = record(value.artifactIds);
  if (!ids || Object.values(ids).some((id) => typeof id !== 'string')) {
    throw new Error('The saved Live artifact binding is invalid. Manual writing remains available.');
  }
  return { localThreadId, serverThreadId: value.serverThreadId, artifactIds: ids as Record<string, string> };
}

/** Preserve local IDs while server tools keep their own stable target IDs. */
export async function ensureLiveBinding(api: FioApiClient, thread: Thread): Promise<LiveThreadBinding> {
  let binding = await readLiveBinding(thread.id);
  if (!binding) {
    const firstTurn = thread.turns.find((turn) => turn.text.trim());
    const firstArtifact = thread.artifacts.find((artifact) => artifact.text.trim());
    if (!firstTurn && !firstArtifact) throw new Error('Start with writing or speech before a Live artifact tool can save.');
    const initial: JsonObject = firstTurn
      ? { type: 'turn_append', role: firstTurn.role, text: firstTurn.text }
      : { type: 'artifact_create', title: firstArtifact!.title, kind: 'note', text: firstArtifact!.text };
    const result = await api.createThread(thread.id, thread.title.slice(0, 120) || 'Writing', initial);
    const serverThread = record(result.thread);
    const serverThreadId = requiredId(serverThread?.thread_id, 'thread_id');
    binding = { localThreadId: thread.id, serverThreadId, artifactIds: {} };
    if (!firstTurn && firstArtifact) {
      const artifacts = serverThread?.artifacts;
      const initialArtifact = Array.isArray(artifacts) ? record(artifacts[0]) : null;
      binding.artifactIds[firstArtifact.id] = requiredId(initialArtifact?.artifact_id, 'artifact_id');
    }
    await saveLiveBinding(binding);
  }
  for (const artifact of thread.artifacts) {
    if (binding.artifactIds[artifact.id] || !artifact.text.trim()) continue;
    const data = await api.invokeTool(binding.serverThreadId, 'artifact_create', {
      operation_id: artifact.id, title: artifact.title, text: artifact.text,
    });
    const saved = record(data.artifact);
    binding.artifactIds[artifact.id] = requiredId(saved?.artifact_id, 'artifact_id');
    await saveLiveBinding(binding);
  }
  return binding;
}

export function serverArtifactId(binding: LiveThreadBinding, localId: string): string {
  return binding.artifactIds[localId] ?? localId;
}

export function localArtifactId(binding: LiveThreadBinding, serverId: string): string {
  return Object.keys(binding.artifactIds).find((localId) => binding.artifactIds[localId] === serverId) ?? serverId;
}

export function serverView(binding: LiveThreadBinding, artifact: Artifact): Artifact {
  return { ...artifact, id: serverArtifactId(binding, artifact.id) };
}
