import { FioApiError, type FioApiClient, type JsonObject, type JsonValue } from './fio-api-client';
import {
  functionCallOutputEvent, parseLiveFunctionCall, responseCreateEvent,
  type LiveDataChannel, type LiveFunctionCall,
} from './live-protocol';
import type { Artifact, VoiceSessionContext } from './types';

type Delegation = {
  id: string;
  responseId: string;
  calls: Map<string, LiveFunctionCall>;
  completed: boolean;
  invalid: boolean;
  awaitingResponse: boolean;
};

function record(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject : null;
}

function requiredString(value: JsonValue | undefined, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`Live is missing ${label}.`);
  return value;
}

function localArtifact(context: VoiceSessionContext, artifactId: string): Artifact {
  const artifact = context.getArtifacts().find(({ id }) => id === artifactId);
  if (!artifact) throw new Error('Live targeted an artifact outside the bound thread.');
  return artifact;
}

function backendArguments(call: LiveFunctionCall): JsonObject {
  const args = { ...call.arguments };
  delete args.thread_id;
  delete args.session_id;
  delete args.call_id;
  delete args.kind;
  if (['artifact_create', 'artifact_update', 'artifact_undo'].includes(call.name)) {
    const id = requiredString(args.operation_id, `${call.name}.operation_id`);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('Live supplied an invalid operation ID.');
  }
  if (call.name === 'artifact_create') return {
    operation_id: requiredString(args.operation_id, 'artifact_create.operation_id'),
    title: requiredString(args.title, 'artifact_create.title'),
    text: requiredString(args.text, 'artifact_create.text'),
  };
  return args;
}

function persistedArtifact(data: JsonObject, context: VoiceSessionContext): Artifact | null {
  const artifact = record(data.artifact);
  if (!artifact) return null;
  const id = typeof artifact.artifact_id === 'string' ? artifact.artifact_id : '';
  const existing = context.getArtifacts().find((item) => item.id === id);
  const title = typeof artifact.title === 'string' ? artifact.title : existing?.title;
  const text = typeof artifact.text === 'string' ? artifact.text : null;
  const createdAt = typeof artifact.created_at === 'string' ? artifact.created_at : existing?.createdAt;
  const updatedAt = typeof artifact.updated_at === 'string' ? artifact.updated_at : null;
  if (!id || !title || text === null || !createdAt || !updatedAt) return null;
  const kind = artifact.kind === 'document' ? 'document' : artifact.kind === 'message' ? 'message' : 'notes';
  return { id, kind, title, text, createdAt, updatedAt };
}

/** One ordered executor for a verified Live session and one captured backend thread. */
export class LiveToolDispatcher {
  private tail: Promise<void> = Promise.resolve();
  private active: Delegation | null = null;
  private seenDelegations = new Map<string, string>();
  private returnedCalls = new Set<string>();
  private cancelled = false;

  constructor(
    private readonly api: FioApiClient,
    private boundThreadId: string | null,
    private readonly context: VoiceSessionContext,
    private readonly channel: LiveDataChannel,
    private readonly isCurrent: () => boolean,
    private readonly onFirstArtifactCreated?: (serverThreadId: string, artifact: Artifact) => Promise<void>,
  ) {}

  handle(envelope: unknown): boolean {
    if (this.cancelled || !this.isCurrent()) return false;
    const event = record(envelope);
    if (!event) return false;
    if (event.type === 'session.delegation.created') {
      const delegation = record(event.delegation);
      if (delegation?.type !== 'delegation' || delegation.target !== 'responses' ||
          typeof delegation.id !== 'string' || typeof delegation.response_id !== 'string') return false;
      const prior = this.seenDelegations.get(delegation.id);
      if (prior && prior !== delegation.response_id) return false;
      this.seenDelegations.set(delegation.id, delegation.response_id);
      this.active = { id: delegation.id, responseId: delegation.response_id,
        calls: new Map(), completed: false, invalid: false, awaitingResponse: false };
      return true;
    }
    if (event.type !== 'response.event' || !this.active || event.delegation_id !== this.active.id) return false;
    const nested = record(event.event);
    if (!nested) return false;
    const response = record(nested.response);
    if ((nested.type === 'response.created' || nested.type === 'response.in_progress') &&
        this.active.completed && this.active.awaitingResponse &&
        typeof response?.id === 'string' && response.id !== this.active.responseId &&
        (event.response_id === undefined || event.response_id === response.id)) {
      this.active = { ...this.active, responseId: response.id, calls: new Map(),
        completed: false, invalid: false, awaitingResponse: false };
      return true;
    }
    if (this.active.invalid || this.active.completed) return false;
    if ([event.response_id, nested.response_id, response?.id].some(
      (id) => id !== undefined && id !== this.active!.responseId)) return false;
    if (nested.type === 'response.failed' || nested.type === 'response.incomplete' || nested.type === 'error') {
      this.active.invalid = true;
      this.active.calls.clear();
      return true;
    }
    if (nested.type === 'response.output_item.done') {
      const item = record(nested.item);
      if (item?.type !== 'function_call') return false;
      if (item.status !== undefined && item.status !== 'completed') { this.active.invalid = true; return true; }
      let call: LiveFunctionCall;
      try { call = parseLiveFunctionCall(event)!; } catch { this.active.invalid = true; return true; }
      const prior = this.active.calls.get(call.callId);
      if (prior && JSON.stringify(prior) !== JSON.stringify(call)) { this.active.invalid = true; return true; }
      this.active.calls.set(call.callId, call);
      return true;
    }
    if (nested.type !== 'response.completed') return false;
    if (response?.id !== this.active.responseId || response.status !== 'completed') {
      this.active.invalid = true;
      return true;
    }
    const calls = [...this.active.calls.values()];
    if (Array.isArray(response.output)) {
      const completed = response.output.map(record).filter((item) => item?.type === 'function_call');
      if (completed.length !== calls.length || completed.some((item) => {
        const call = calls.find((candidate) => candidate.callId === item?.call_id);
        if (!call || call.name !== item?.name || typeof item?.arguments !== 'string') return true;
        try { return JSON.stringify(call.arguments) !== JSON.stringify(JSON.parse(item.arguments)); }
        catch { return true; }
      })) { this.active.invalid = true; return true; }
    }
    this.active.completed = true;
    const delegation = this.active;
    if (calls.length) this.tail = this.tail.then(() => this.executeBatch(delegation, calls));
    return true;
  }

  cancel(): void { this.cancelled = true; }

  private assertCurrent(call: LiveFunctionCall): void {
    if (this.cancelled || !this.isCurrent()) throw new Error('The Live session is no longer current.');
    const supplied = call.arguments.thread_id;
    if (supplied !== undefined && supplied !== this.boundThreadId) throw new Error('Live targeted a different thread.');
  }

  private async executeBatch(delegation: Delegation, calls: LiveFunctionCall[]): Promise<void> {
    for (const call of calls) {
      if (this.cancelled || !this.isCurrent() || this.active !== delegation) return;
      if (this.returnedCalls.has(call.callId)) continue;
      this.returnedCalls.add(call.callId);
      let output: JsonObject;
      try {
        this.assertCurrent(call);
        let data: JsonObject;
        if (call.name === 'artifact_select') {
          const id = requiredString(call.arguments.artifact_id, 'artifact_select.artifact_id');
          localArtifact(this.context, id);
          this.context.onSelectArtifact(id);
          data = { artifact_id: id };
        } else if (!this.boundThreadId && call.name === 'artifact_create') {
          const args = backendArguments(call);
          const title = requiredString(args.title, 'artifact_create.title');
          const text = requiredString(args.text, 'artifact_create.text');
          const operationId = requiredString(args.operation_id, 'artifact_create.operation_id');
          const created = await this.api.createThread(operationId, title, {
            type: 'artifact_create', kind: 'note', title, text,
          });
          this.assertCurrent(call);
          if (this.active !== delegation) return;
          const thread = record(created.thread);
          const threadId = typeof thread?.thread_id === 'string' ? thread.thread_id : null;
          const saved = Array.isArray(thread?.artifacts) ? record(thread.artifacts[0]) : null;
          if (!threadId || !saved || typeof saved.artifact_id !== 'string')
            throw new Error('Live thread creation did not confirm an artifact.');
          data = { artifact: saved, can_undo: false, thread_id: threadId,
            operation_id: operationId, replayed: created.replayed === true };
          const artifact = persistedArtifact(data, this.context);
          if (!artifact) throw new Error('Live artifact creation returned an invalid snapshot.');
          await this.context.onPersistedArtifact(artifact, false);
          this.boundThreadId = threadId;
          await this.onFirstArtifactCreated?.(threadId, artifact);
        } else if (!this.boundThreadId && call.name === 'artifact_list') {
          data = { artifacts: [], next_cursor: null };
        } else {
          if (!this.boundThreadId) throw new Error('Live has no saved thread for this tool.');
          const id = call.arguments.artifact_id;
          if (call.name !== 'artifact_list' && call.name !== 'artifact_create')
            localArtifact(this.context, requiredString(id, `${call.name}.artifact_id`));
          data = await this.api.invokeTool(this.boundThreadId, call.name, backendArguments(call));
          this.assertCurrent(call);
          if (this.active !== delegation) return;
          const artifact = persistedArtifact(data, this.context);
          if (artifact) await this.context.onPersistedArtifact(artifact, data.can_undo === true);
        }
        output = { ok: true, data };
      } catch (cause) {
        if (this.cancelled || !this.isCurrent()) return;
        const operationId = typeof call.arguments.operation_id === 'string' ? call.arguments.operation_id : null;
        output = cause instanceof FioApiError
          ? { ok: false, operation_id: operationId, code: cause.code, outcome: cause.outcome }
          : { ok: false, operation_id: operationId, code: 'invalid_input', outcome: 'not_applied' };
      }
      if (this.cancelled || !this.isCurrent() || this.active !== delegation) return;
      this.channel.send(functionCallOutputEvent(call.callId, output));
    }
    if (!this.cancelled && this.isCurrent() && this.active === delegation) {
      delegation.awaitingResponse = true;
      this.channel.send(responseCreateEvent());
    }
  }
}
