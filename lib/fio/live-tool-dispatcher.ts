import type { FioApiClient, JsonObject, JsonValue } from './fio-api-client';
import {
  functionCallOutputEvent,
  parseLiveFunctionCall,
  responseCreateEvent,
  type LiveDataChannel,
  type LiveFunctionCall,
} from './live-protocol';
import type { Artifact, ArtifactKind, VoiceSessionContext } from './types';

const WRITING_TOOLS = new Set(['artifact_create', 'artifact_update', 'artifact_undo']);

function requiredString(value: JsonValue | undefined, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`Live is missing ${label}.`);
  return value;
}

function localArtifact(context: VoiceSessionContext, artifactId: string): Artifact {
  const artifact = context.getArtifacts().find(({ id }) => id === artifactId);
  if (!artifact) throw new Error('Live targeted an artifact outside the bound thread.');
  return artifact;
}

function operationId(sessionId: string, callId: string): string {
  return `live:${sessionId}:${callId}`;
}

function backendArguments(call: LiveFunctionCall, sessionId: string): JsonObject {
  const argumentsValue = { ...call.arguments };
  delete argumentsValue.thread_id;
  delete argumentsValue.session_id;
  delete argumentsValue.call_id;
  delete argumentsValue.kind;
  if (WRITING_TOOLS.has(call.name)) {
    argumentsValue.operation_id = operationId(sessionId, call.callId);
  }
  if (call.name === 'artifact_create') {
    return {
      operation_id: requiredString(argumentsValue.operation_id, 'artifact_create.operation_id'),
      title: requiredString(argumentsValue.title, 'artifact_create.title'),
      text: requiredString(argumentsValue.text, 'artifact_create.text'),
    };
  }
  return argumentsValue;
}

function isArtifactKind(value: JsonValue | undefined): value is ArtifactKind {
  return value === 'message' || value === 'reply' || value === 'notes' || value === 'document';
}

function persistedArtifact(data: JsonObject, context: VoiceSessionContext): Artifact | null {
  const artifact = data.artifact;
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) return null;
  const id = typeof artifact.id === 'string' ? artifact.id : '';
  const existing = context.getArtifacts().find((item) => item.id === id);
  const kind = artifact.kind;
  if (!id || !isArtifactKind(kind)) return null;
  const title = typeof artifact.title === 'string' ? artifact.title : existing?.title;
  const text = typeof artifact.text === 'string' ? artifact.text : null;
  const createdAt =
    typeof artifact.created_at === 'string' ? artifact.created_at : existing?.createdAt;
  const updatedAt = typeof artifact.updated_at === 'string' ? artifact.updated_at : null;
  if (!title || text === null || !createdAt || !updatedAt) return null;
  return { id, kind, title, text, createdAt, updatedAt };
}

/**
 * Serializes Live tool calls and binds every target to the captured session/thread.
 * It is transport-agnostic and must only be attached after the effective contract gate opens.
 */
export class LiveToolDispatcher {
  private tail: Promise<void> = Promise.resolve();
  private readonly seenCallIds = new Set<string>();
  private cancelled = false;

  constructor(
    private readonly api: FioApiClient,
    private readonly sessionId: string,
    private readonly boundThreadId: string,
    private readonly context: VoiceSessionContext,
    private readonly channel: LiveDataChannel,
    private readonly isCurrent: () => boolean,
  ) {}

  handle(envelope: unknown): boolean {
    if (this.cancelled) return false;
    const call = parseLiveFunctionCall(envelope);
    if (!call) return false;
    if (this.seenCallIds.has(call.callId)) return true;
    this.seenCallIds.add(call.callId);
    this.tail = this.tail.then(() => this.execute(call));
    return true;
  }

  cancel(): void {
    this.cancelled = true;
  }

  private assertCurrent(call: LiveFunctionCall): void {
    if (this.cancelled || !this.isCurrent()) {
      throw new Error('The Live session is no longer current.');
    }
    const suppliedThreadId = call.arguments.thread_id;
    if (suppliedThreadId !== undefined && suppliedThreadId !== this.boundThreadId) {
      throw new Error('Live targeted a different thread.');
    }
  }

  private async execute(call: LiveFunctionCall): Promise<void> {
    try {
      this.assertCurrent(call);
      let data: JsonObject;
      if (call.name === 'artifact_select') {
        const artifactId = requiredString(
          call.arguments.artifact_id,
          'artifact_select.artifact_id',
        );
        localArtifact(this.context, artifactId);
        this.context.onSelectArtifact(artifactId);
        data = { ok: true, artifact_id: artifactId };
      } else {
        const artifactId = call.arguments.artifact_id;
        if (call.name !== 'artifact_list' && call.name !== 'artifact_create') {
          localArtifact(this.context, requiredString(artifactId, `${call.name}.artifact_id`));
        }
        data = await this.api.invokeTool(
          this.boundThreadId,
          call.name,
          backendArguments(call, this.sessionId),
        );
        this.assertCurrent(call);
        const artifact = persistedArtifact(data, this.context);
        if (artifact) await this.context.onPersistedArtifact(artifact, data.can_undo === true);
      }
      this.assertCurrent(call);
      this.channel.send(functionCallOutputEvent(call.callId, { ok: true, data }));
      this.channel.send(responseCreateEvent());
    } catch (cause) {
      if (this.cancelled || !this.isCurrent()) return;
      const message = cause instanceof Error ? cause.message : 'The Live tool call failed.';
      this.channel.send(functionCallOutputEvent(call.callId, { ok: false, error: message }));
      this.channel.send(responseCreateEvent());
    }
  }
}
